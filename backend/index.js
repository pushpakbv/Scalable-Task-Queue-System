require('./tracing'); // ← Import tracing first
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const { createClient } = require('redis');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const prometheus = require('prom-client');
const winston = require('winston');
const rateLimit = require('express-rate-limit');

const app = express();
const server = createServer(app);

// Configure rate limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 100, // Limit each IP to 100 requests per window
  standardHeaders: 'draft-7', // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: 'Too many requests from this IP, please try again after 15 minutes'
});

// More strict limiter for task submission
const taskSubmissionLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  limit: 20, // Limit to 20 task submissions per 5 minutes
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: 'Too many task submissions, please try again later'
});

// PostgreSQL Pool Configuration with fallback values
const pgPool = new Pool({
  host: process.env.PG_HOST || 'postgres',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'password',
  database: process.env.PG_DATABASE || 'task_queue',
  port: process.env.PG_PORT || 5432,
  max: 20
});

// Redis Client Configuration with better error handling
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://redis:6379',
  socket: {
    reconnectStrategy: (retries) => {
      const delay = Math.min(retries * 500, 3000);
      return delay;
    }
  }
});

redisClient.on('error', (err) => {
  logger.error('Redis client error:', err);
});

// WebSocket Server with CORS validation
const wss = new WebSocketServer({
  server,
  verifyClient: (info, callback) => {
    const allowedOrigin = process.env.FRONTEND_URL || 'http://localhost:3001';
    if (info.origin === allowedOrigin) callback(true);
    else callback(false);
  }
});

// Configure logger with improved formatting and filtering
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp, ...meta }) => {
      return `${timestamp} ${level.toUpperCase()}: ${message} ${
        Object.keys(meta).length ? JSON.stringify(meta) : ''
      }`;
    })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
        winston.format.printf(({ level, message, timestamp, ...meta }) => {
          return `${timestamp} ${level}: ${message} ${
            Object.keys(meta).length ? JSON.stringify(meta) : ''
          }`;
        })
      )
    }),
    new winston.transports.File({ 
      filename: 'logs/combined.log',
      // Don't log metric and health check requests to file
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),
        winston.format(info => {
          if (info.path === '/metrics' || info.path === '/health') {
            return false;
          }
          return info;
        })()
      )
    })
  ]
});

// Initialize connections
async function initializeConnections() {
  try {
    await redisClient.connect();
    
    // Test PostgreSQL connection
    await pgPool.query('SELECT NOW()');
    
    console.log('Successfully connected to Redis and PostgreSQL');
  } catch (error) {
    console.error('Failed to initialize connections:', error);
    process.exit(1);
  }
}

// Subscribe to Redis updates after connection is established
redisClient.on('connect', async () => {
  try {
    const subscriber = redisClient.duplicate();
    await subscriber.connect();
    await subscriber.subscribe('task_updates', (message) => {
      wss.clients.forEach(client => {
        if (client.readyState === client.OPEN) client.send(message);
      });
    });
  } catch (error) {
    console.error('Failed to set up Redis subscription:', error);
  }
});

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3001'
}));
app.use(express.json());

// Apply global rate limiting to all requests
app.use(apiLimiter);

// Add HTTP request logging middleware (excluding metrics/health endpoints)
app.use((req, res, next) => {
  // Skip logging for metrics and health check endpoints to reduce noise
  if (req.path === '/metrics' || req.path === '/health') {
    return next();
  }
  
  const start = Date.now();
  
  // Log when the request completes
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`HTTP ${req.method} ${req.path}`, {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`
    });
  });
  
  next();
});

// Initialize Prometheus metrics
prometheus.collectDefaultMetrics();

// Custom Metrics
const taskMetrics = {
  incoming: new prometheus.Counter({
    name: 'tasks_incoming_total',
    help: 'Total incoming tasks',
    labelNames: ['type']
  }),
  processed: new prometheus.Counter({
    name: 'tasks_processed_total',
    help: 'Total processed tasks',
    labelNames: ['status']
  }),
  duration: new prometheus.Histogram({
    name: 'task_processing_duration_seconds',
    help: 'Task processing time distribution',
    buckets: [0.1, 0.5, 1, 2, 5]
  })
};

const queueLengthGauge = new prometheus.Gauge({
  name: 'task_queue_length',
  help: 'Current length of task queue'
});

// API Endpoints
// prometheus.collectDefaultMetrics();

app.get('/health', async (req, res) => {
  const checks = {
    database: await pgPool.query('SELECT 1').then(() => true).catch(() => false),
    redis: redisClient.isOpen,
    uptime: process.uptime()
  };
  
  res.json({
    status: Object.values(checks).every(Boolean) ? 'OK' : 'ERROR',
    ...checks
  });
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', prometheus.register.contentType);
  res.end(await prometheus.register.metrics());
});
// Create custom metrics
// const taskCounter = new prometheus.Counter({
//   name: 'tasks_processed_total',
//   help: 'Total number of tasks processed',
//   labelNames: ['status']
// });

app.post('/api/tasks', taskSubmissionLimiter, async (req, res) => {
  // Input validation
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Invalid request body' });
  }
  
  // Validate required fields
  if (!req.body.type) {
    return res.status(400).json({ error: 'Task type is required' });
  }
  
  // Sanitize and validate specific task types
  const validTaskTypes = ['image_resize', 'data_processing', 'report_generation'];
  const taskType = String(req.body.type);
  
  if (!validTaskTypes.includes(taskType)) {
    return res.status(400).json({ error: 'Invalid task type' });
  }
  
  // Validate imageUrl if provided for image_resize task

  const taskId = uuidv4();
  taskMetrics.incoming.inc({ type: taskType });
  
  try {
    logger.info('Task submitted', { taskId, taskType });
    // Begin transaction
    const client = await pgPool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Add to Redis stream
      await redisClient.xAdd('task_stream', '*', {
        task: JSON.stringify({ id: taskId, data: req.body })
      });
      
      // Insert into PostgreSQL
      await client.query(
        'INSERT INTO tasks(task_id, status, data, retries) VALUES ($1, $2, $3, $4)',
        [taskId, 'pending', JSON.stringify(req.body), 0]
      );
      
      // Publish status update
      await redisClient.publish('task_updates', JSON.stringify({
        id: taskId,
        status: 'pending',
        retries: 0
      }));
      
      await client.query('COMMIT');
      
      res.status(201).json({ taskId, status: 'pending' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Task submission failed:', error);
    res.status(500).json({ 
      error: 'Task submission failed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.get('/api/tasks', async (req, res) => {
  try {
    const result = await pgPool.query(
      'SELECT task_id as id, status, data, retries, created_at as "createdAt" FROM tasks ORDER BY created_at DESC LIMIT 100'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Failed to fetch tasks:', error);
    res.status(500).json({ 
      error: 'Failed to fetch tasks',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Graceful shutdown handler
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

async function gracefulShutdown() {
  logger.info('Graceful shutdown initiated');
  
  // Close server first to stop accepting new requests
  server.close(() => {
    logger.info('HTTP server closed');
  });
  
  // Close WebSocket connections
  wss.clients.forEach(client => {
    client.close(1000, 'Server shutdown');
  });
  
  try {
    // Close database connections
    if (redisClient.isOpen) {
      await redisClient.quit();
      logger.info('Redis connection closed');
    }
    
    await pgPool.end();
    logger.info('Database connection pool closed');
    
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
}

// Initialize connections before starting server
initializeConnections().then(() => {
  server.listen(3000, () => console.log('API & WebSocket running on port 3000'));
}).catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});