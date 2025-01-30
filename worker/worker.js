const { createClient } = require('redis');
const { Client } = require('pg');

// Initialize Redis & PostgreSQL Clients
const redisClient = createClient({ url: 'redis://redis:6379' }); // Use Docker service name
const pgClient = new Client({
  user: 'postgres',
  host: 'postgres', // Docker service name
  database: 'task_queue',
  password: 'password',
  port: 5432,
});

(async () => {
  await redisClient.connect();
  await pgClient.connect();
  let lastId = '0'; // Track last processed task ID

  while (true) {
    try {
      const result = await redisClient.xRead(
        { key: 'task_stream', id: lastId },
        { COUNT: 10, BLOCK: 5000 }
      );

      if (!result) continue;

      for (const { messages } of result) {
        for (const message of messages) {
          const { task } = message;
          const { id, data } = JSON.parse(task.task);
          lastId = message.id;

          try {
            console.log(`Processing task ${id}`);
            // Simulate processing (e.g., image resize)
            await new Promise(resolve => setTimeout(resolve, 2000)); // Mock delay
            await pgClient.query(
              'UPDATE tasks SET status=$1 WHERE task_id=$2',
              ['completed', id]
            );
          } catch (error) {
            // Increment retries and re-enqueue
            const { rows } = await pgClient.query(
              'UPDATE tasks SET status=$1, retries = retries + 1 WHERE task_id=$2 RETURNING retries',
              ['failed', id]
            );
            const retries = rows[0].retries;
            if (retries < 3) { // Max 3 retries
              const delay = Math.pow(2, retries) * 1000; // Exponential backoff
              setTimeout(async () => {
                await redisClient.xAdd('task_stream', '*', { task: JSON.stringify({ id, data }) });
              }, delay);
            }
          }
        }
      }
    } catch (error) {
      console.error('Worker error:', error);
    }
  }
})();
//test