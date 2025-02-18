require('./tracing'); // ← Import tracing first
const { createClient } = require('redis');
const { Pool } = require('pg');
const winston = require('winston');

// Redis Configuration
const redisClient = createClient({
  socket: {
    host: process.env.REDIS_HOST || 'redis',
    port: process.env.REDIS_PORT || 6379
  }
});

// PostgreSQL Configuration
const pgPool = new Pool({
  host: process.env.PG_HOST,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
  port: process.env.PG_PORT,
  max: 10
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

(async () => {
  await redisClient.connect();
  await pgPool.connect();

  // Create Consumer Group
  try {
    await redisClient.xGroupCreate('task_stream', 'workers_group', '0', { MKSTREAM: true });
  } catch (err) {
    if(!err.message.includes('BUSYGROUP')) throw err;
  }

//Add logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

  // Worker Loop
  while(true) {
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
          const task = JSON.parse(message.task);
          
          try {
            console.log(`Processing ${task.id}`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Random failure simulation
            if(Math.random() < 0.2) throw new Error('Processing failed');
            
            await pgPool.query(
              'UPDATE tasks SET status=$1 WHERE task_id=$2',
              ['completed', task.id]
            );

            // Publish status update
            await redisClient.publish('task_updates', JSON.stringify({
            id: task.id,
            status: 'completed',
            retries: 0
          }));
            
            await redisClient.xAck('task_stream', 'workers_group', messageId);
          } catch (error) {
            const { rows } = await pgPool.query(
              `UPDATE tasks 
               SET status='failed', retries=retries+1 
               WHERE task_id=$1 
               RETURNING retries`,
              [task.id]
            );
            
            if(rows[0].retries < 3) {
              await redisClient.xAdd('task_stream', '*', message);
            }
          }
        }
      }
    } catch (error) {
      console.error('Worker error:', error);
    }
  }
})();

