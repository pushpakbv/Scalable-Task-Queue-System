const express = require('express');
const { Client } = require('pg');
const { createClient } = require('redis');
const { v4: uuidv4 } = require('uuid');
const app = express();
const cors = require('cors');
app.use(express.json());

// CORS Setup
const corsOptions = {
    origin: 'http://localhost:3001',
    methods: 'POST',
  };
  
  app.use(cors(corsOptions));


// PostgreSQL Client Setup
const pgClient = new Client({
    user: 'postgres',
    host: 'localhost', // Use the container name in a Docker network
    database: 'task_queue',
    password: 'password',
    port: 5432,
  });
  
pgClient.connect();

// Redis Client Setup
const redisClient = createClient();
redisClient.on('error', (err) => console.log('Redis Client Error', err));
redisClient.connect();

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

// Start Server
app.listen(3000, () => console.log('API running on port 3000'));
//test