const express = require('express');
const { Client } = require('pg');
const { createClient } = require('redis');
const { v4: uuidv4 } = require('uuid');
const app = express();
const cors = require('cors');
const env = require('dotenv');

const { createServer } = require('http');
const { WebSocketServer } = require('ws');

const server = createServer(app);
const wss = new WebSocketServer({ server });


require('dotenv').config();
app.use(cors());
app.use(express.json());



// CORS Setup
const corsOptions = {
    origin: 'http://localhost:3001',
    methods: 'POST',
  };
  
  app.use(cors(corsOptions));


  const redisSubscriber = createClient({ url: 'redis://redis:6379' });
  redisSubscriber.connect();

  redisSubscriber.subscribe('task_updates', (message) => {
    // Broadcast message to all connected WebSocket clients
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });




// PostgreSQL Client Setup
// PostgreSQL Client Setup
const pgClient = new Client({
  user: process.env.PG_USER || 'postgres',
  host: process.env.PG_HOST || 'postgres',
  database: process.env.PG_DATABASE || 'task_queue',
  password: process.env.PG_PASSWORD || 'password',
  port: parseInt(process.env.PG_PORT || '5432')
});

pgClient.on('error', (err) => {
  console.error('PostgreSQL Client Error:', err);
});
  
pgClient.connect();

// Redis Client Setup
const redisClient = createClient({
  url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`
});
redisClient.on('error', (err) => console.log('Redis Client Error', err));
redisClient.connect();

process.on('SIGINT', async () => {
  await redisClient.quit();
  await pgClient.end();
  process.exit(0);
});

// Task Submission Endpoint
app.post('/api/tasks', async (req, res) => {
  try {
    const taskId = uuidv4();
    const taskData = req.body;

    // 1. Add task to Redis Stream
    await redisClient.xAdd('task_stream', '*', { task: JSON.stringify({ id: taskId, data: taskData }) });

    // 2. Log task to PostgreSQL
    await pgClient.query(
      'INSERT INTO tasks(task_id, status, data) VALUES ($1, $2, $3)',
      [taskId, 'pending', JSON.stringify(taskData)]
    );

    res.status(201).json({ taskId, status: 'pending' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit task' });
  }
});

// Add this endpoint to index.js
app.get('/api/tasks', async (req, res) => {
  try {
    const result = await pgClient.query('SELECT task_id as id, status, data, retries FROM tasks ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// Start Server
app.listen(3000, () => console.log('API running on port 3000'));
//test