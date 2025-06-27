require('./tracing'); // ← Import tracing first
const { createClient } = require('redis');
const { Pool } = require('pg');
const winston = require('winston');

// Improve logging setup first
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/worker.log' })
  ]
});

// Redis Configuration with better error handling
const redisClient = createClient({
  socket: {
    host: process.env.REDIS_HOST || 'redis',
    port: process.env.REDIS_PORT || 6379
  },
  reconnectStrategy: (retries) => {
    const delay = Math.min(retries * 500, 3000);
    return delay;
  }
});

redisClient.on('error', (err) => {
  logger.error('Redis client error:', err);
});

// PostgreSQL Configuration with proper connection pooling
const pgPool = new Pool({
  host: process.env.PG_HOST || 'postgres',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'password',
  database: process.env.PG_DATABASE || 'task_queue',
  port: process.env.PG_PORT || 5432,
  max: 10,
  idleTimeoutMillis: 30000
});

// Handle uncaught exceptions and rejections
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled rejection:', err);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
  // Don't exit the process - allow the worker to continue if possible
});

// Graceful shutdown handler
let isShuttingDown = false;
async function gracefulShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  logger.info('Worker graceful shutdown initiated');
  
  try {
    // Close Redis connection
    if (redisClient.isOpen) {
      await redisClient.quit();
      logger.info('Redis connection closed');
    }
    
    // Close database pool
    await pgPool.end();
    logger.info('Database connection pool closed');
    
    process.exit(0);
  } catch (error) {
    logger.error('Error during worker shutdown:', error);
    process.exit(1);
  }
}

// Register shutdown handlers
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Main worker function
(async () => {
  try {
    await redisClient.connect();
    logger.info('Connected to Redis');
    
    await pgPool.query('SELECT NOW()');
    logger.info('Connected to PostgreSQL');

    // Create Consumer Group
    try {
      await redisClient.xGroupCreate('task_stream', 'workers_group', '0', { MKSTREAM: true });
      logger.info('Created Redis consumer group');
    } catch (err) {
      if (!err.message.includes('BUSYGROUP')) {
        logger.error('Error creating Redis consumer group:', err);
        throw err;
      }
      logger.info('Redis consumer group already exists');
    }

    // Worker Loop
    while(!isShuttingDown) {
      try {
        const result = await redisClient.xReadGroup(
          'workers_group',
          `worker-${process.pid}`,
          { key: 'task_stream', id: '>' },
          { COUNT: 5, BLOCK: 10000 }
        );

        if(!result) continue;

        for(const { messages } of result) {
          for(const { id: messageId, message } of messages) {
            try {
              const task = JSON.parse(message.task);
              const taskId = task.id;
              const taskType = task.data?.type || 'unknown';
              
              // Add at start of task processing
              const startTime = Date.now();
              
              logger.info(`Processing task`, { taskId, taskType });
              
              try {
                // Update status to in_progress first
                await pgPool.query(
                  'UPDATE tasks SET status=$1 WHERE task_id=$2',
                  ['in_progress', taskId]
                );
                
                // Publish status update
                await redisClient.publish('task_updates', JSON.stringify({
                  id: taskId,
                  status: 'in_progress',
                  retries: task.retries || 0
                }));
                
                // Process task based on type
                switch(taskType) {
                  case 'image_resize':
                    await processImageTask(task.data);
                    break;
                  case 'data_processing':
                    await processDataTask(task.data);
                    break;
                  case 'load_test':
                    await processLoadTestTask(task.data);
                    break;
                  default:
                    // Generic processing for other task types
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
                
                // Simulate realistic failures based on task type and conditions
                const shouldFail = simulateTaskFailure(taskType, task.data);
                if (shouldFail.fail) {
                  throw new Error(shouldFail.reason);
                }
                
                // Add after successful completion
                const processingTime = (Date.now() - startTime) / 1000; // store seconds
                
                // Mark as completed in DB and update processing time
                await pgPool.query(
                  'UPDATE tasks SET status=$1, processing_time=$2 WHERE task_id=$3',
                  ['completed', processingTime, taskId]
                );

                // Publish status update
                await redisClient.publish('task_updates', JSON.stringify({
                  id: taskId,
                  status: 'completed',
                  retries: task.retries || 0,
                  processingTime: processingTime
                }));
                
                // Acknowledge the message in Redis stream
                await redisClient.xAck('task_stream', 'workers_group', messageId);
                
                logger.info(`Task completed`, { 
                  taskId, 
                  taskType,
                  processingTime: processingTime
                });
              } catch (error) {
                logger.error(`Task processing failed`, { 
                  taskId, 
                  taskType,
                  error: error.message
                });
                
                // Use a client from the pool for transaction
                const client = await pgPool.connect();
                try {
                  await client.query('BEGIN');
                  
                  // Update the task status and increment retries
                  const { rows } = await client.query(
                    `UPDATE tasks 
                     SET status='failed', retries=retries+1 
                     WHERE task_id=$1 
                     RETURNING retries`,
                    [taskId]
                  );
                  
                  const retryCount = rows[0]?.retries || 0;
                  
                  // Publish status update
                  await redisClient.publish('task_updates', JSON.stringify({
                    id: taskId,
                    status: 'failed',
                    retries: retryCount
                  }));
                  
                  // If we haven't reached max retries, requeue the task
                  if(retryCount < 3) {
                    // Add delay before retry based on retry count (exponential backoff)
                    const delayMs = Math.pow(2, retryCount) * 1000; // 2s, 4s, 8s
                    
                    logger.info(`Requeuing task with delay`, { 
                      taskId, 
                      retryCount, 
                      delayMs 
                    });
                    
                    // Wait for the delay
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                    
                    // Requeue the task
                    await redisClient.xAdd('task_stream', '*', message);
                  } else {
                    logger.warn(`Maximum retries reached, task abandoned`, { 
                      taskId, 
                      retryCount 
                    });
                  }
                  
                  await client.query('COMMIT');
                } catch (txError) {
                  await client.query('ROLLBACK');
                  logger.error(`Transaction error during failure handling`, { 
                    taskId,
                    error: txError.message
                  });
                } finally {
                  client.release();
                }
                
                // Acknowledge the message even if processing failed
                // This removes it from the current worker's pending list
                await redisClient.xAck('task_stream', 'workers_group', messageId);
              }
            } catch (parseError) {
              logger.error('Failed to parse task message:', { 
                messageId, 
                error: parseError.message,
                rawMessage: message
              });
              // Acknowledge malformed messages to prevent infinite loops
              await redisClient.xAck('task_stream', 'workers_group', messageId);
            }
          }
        }
      } catch (error) {
        logger.error('Worker loop error:', error);
        // Add a small delay before retrying to prevent tight error loops
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  } catch (error) {
    logger.error('Fatal worker error:', error);
    process.exit(1);
  }
})();

// Task processing functions
async function processImageTask(data) {
  // Simulate image processing time
  await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 1000));
  logger.debug('Image processed', { url: data.imageUrl });
}

async function processDataTask(data) {
  // Simulate data processing time
  await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1500));
  logger.debug('Data processed', { type: data.subtype });
}

async function processLoadTestTask(data) {
  // Simulate load test task processing time
  await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
  logger.debug('Load test task processed', { data: data.data });
}

// Simulate realistic task failures based on various conditions
function simulateTaskFailure(taskType, taskData) {
  const now = Date.now();
  const baseFailureRate = 0.05; // 5% base failure rate
  
  // Different failure scenarios
  switch(taskType) {
    case 'image_resize':
      // Simulate network/resource failures
      if (Math.random() < baseFailureRate) {
        return { 
          fail: true, 
          reason: 'Image processing failed: Invalid image format or network timeout' 
        };
      }
      break;
      
    case 'data_processing':
      // Simulate data validation failures
      if (Math.random() < baseFailureRate * 1.5) { // Slightly higher failure rate
        return { 
          fail: true, 
          reason: 'Data processing failed: Invalid data format or missing required fields' 
        };
      }
      break;
      
    case 'load_test':
      // Lower failure rate for load tests to get more realistic results
      if (Math.random() < baseFailureRate * 0.5) {
        return { 
          fail: true, 
          reason: 'Load test task failed: Simulated service unavailability' 
        };
      }
      break;
      
    default:
      // Generic failure simulation
      if (Math.random() < baseFailureRate) {
        return { 
          fail: true, 
          reason: 'Task processing failed: Unknown error occurred' 
        };
      }
  }
  
  // Simulate system overload failures during high load periods
  const highLoadThreshold = 50; // If more than 50 tasks per second
  const tasksPerSecond = Math.random() * 100; // Simulate varying load
  
  if (tasksPerSecond > highLoadThreshold && Math.random() < 0.02) {
    return { 
      fail: true, 
      reason: 'System overload: Task failed due to high system load' 
    };
  }
  
  return { fail: false };
}

