// const express = require('express');
// const { Pool } = require('pg');
// const { createClient } = require('redis');
// const { v4: uuidv4 } = require('uuid');
// const cors = require('cors');
// const { createServer } = require('http');
// const { WebSocketServer } = require('ws');

// const app = express();
// const server = createServer(app);

// // Redis Client Configuration
// const redisClient = createClient({
//   socket: {
//     host: process.env.REDIS_HOST || 'redis',
//     port: process.env.REDIS_PORT || 6379
//   }
// });

// // PostgreSQL Pool Configuration
// const pgPool = new Pool({
//   host: process.env.PG_HOST,
//   user: process.env.PG_USER,
//   password: process.env.PG_PASSWORD,
//   database: process.env.PG_DATABASE,
//   port: process.env.PG_PORT,
//   max: 20
// });

// // WebSocket Server
// const wss = new WebSocketServer({ server });
// redisClient.connect().then(() => {
//   redisClient.subscribe('task_updates', (message) => {
//     wss.clients.forEach(client => {
//       if(client.readyState === client.OPEN) client.send(message);
//     });
//   });
// });

// // Middleware
// app.use(cors());
// app.use(express.json());

// // API Endpoints
// app.post('/api/tasks', async (req, res) => {
//   const taskId = uuidv4();
//   try {
//     await redisClient.xAdd('task_stream', '*', { 
//       task: JSON.stringify({ id: taskId, data: req.body }) 
//     });

//     await pgPool.query(
//       'INSERT INTO tasks(task_id, status, data) VALUES ($1, $2, $3)',
//       [taskId, 'pending', JSON.stringify(req.body)]
//     );

//     res.status(201).json({ taskId });
//   } catch (error) {
//     res.status(500).json({ error: 'Task submission failed' });
//   }
// });

// app.get('/api/tasks', async (req, res) => {
//   try {
//     const result = await pgPool.query(
//       'SELECT task_id as id, status, data, retries FROM tasks ORDER BY created_at DESC LIMIT 100'
//     );
//     res.json(result.rows);
//   } catch (error) {
//     res.status(500).json({ error: 'Failed to fetch tasks' });
//   }
// });

// server.listen(3000, () => console.log('API running on port 3000'));



const express = require('express');
const { Pool } = require('pg');
const { createClient } = require('redis');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const server = createServer(app);

// PostgreSQL Pool Configuration with fallback values
const pgPool = new Pool({
  host: process.env.PG_HOST || 'postgres',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'password',
  database: process.env.PG_DATABASE || 'task_queue',
  port: process.env.PG_PORT || 5432,
  max: 20
});

// Redis Client Configuration
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://redis:6379'
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

// API Endpoints
app.post('/api/tasks', async (req, res) => {
  const taskId = uuidv4();
  
  try {
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
      'SELECT task_id as id, status, data, retries FROM tasks ORDER BY created_at DESC LIMIT 100'
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

// Initialize connections before starting server
initializeConnections().then(() => {
  server.listen(3000, () => console.log('API & WebSocket running on port 3000'));
}).catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});