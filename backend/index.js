const express = require('express');
const { Client } = require('pg');
const { createClient } = require('redis');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const server = createServer(app);

// ✅ WebSocket Server with CORS validation
const wss = new WebSocketServer({
  server,
  verifyClient: (info, callback) => {
    // Allow only frontend origin (port 3001)
    if (info.origin === 'http://localhost:3001') callback(true);
    else callback(false);
  }
});

// Redis subscriber for task updates
const redisSubscriber = createClient({ url: 'redis://redis:6379' });
redisSubscriber.connect();
redisSubscriber.subscribe('task_updates', (message) => {
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) client.send(message);
  });
});

// CORS for HTTP routes
app.use(cors({ origin: 'http://localhost:3001' }));
app.use(express.json());

// PostgreSQL setup
const pgClient = new Client({
  user: 'postgres',
  host: 'postgres',
  database: 'task_queue',
  password: 'password',
  port: 5432
});
pgClient.connect();

// Redis setup
const redisClient = createClient({ url: 'redis://redis:6379' });
redisClient.connect();

// ✅ Publish "pending" status when a task is submitted
app.post('/api/tasks', async (req, res) => {
  try {
    const taskId = uuidv4();
    const taskData = req.body;

    // Add to Redis Stream
    await redisClient.xAdd('task_stream', '*', { 
      task: JSON.stringify({ id: taskId, data: taskData }) 
    });

    // Log to PostgreSQL
    await pgClient.query(
      'INSERT INTO tasks(task_id, status, data) VALUES ($1, $2, $3)',
      [taskId, 'pending', JSON.stringify(taskData)]
    );

    // ✅ Publish "pending" status to frontend
    await redisClient.publish('task_updates', JSON.stringify({ 
      id: taskId, 
      status: 'pending', 
      retries: 0 
    }));

    res.status(201).json({ taskId, status: 'pending' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit task' });
  }
});

// Get all tasks
app.get('/api/tasks', async (req, res) => {
  try {
    const result = await pgClient.query('SELECT task_id as id, status, data, retries FROM tasks');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

server.listen(3000, () => console.log('API & WebSocket running on port 3000'));