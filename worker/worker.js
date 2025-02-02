const { createClient } = require('redis');
const { Client } = require('pg');

// Initialize Redis & PostgreSQL Clients
const redisClient = createClient({ url: 'redis://redis:6379' });
const pgClient = new Client({
  user: 'postgres',
  host: 'postgres',
  database: 'task_queue',
  password: 'password',
  port: 5432,
});

(async () => {
  await redisClient.connect();
  await pgClient.connect();
  let lastId = '0';

  while (true) {
    try {
      const result = await redisClient.xRead(
        { key: 'task_stream', id: lastId },
        { COUNT: 10, BLOCK: 5000 }
      );

      if (!result || result.length === 0) continue;

      for (const stream of result) {
        const messages = stream.messages;
        for (const message of messages) {
          const { id: messageId, message: taskData } = message;
          lastId = messageId;

          // --- Parse task FIRST to ensure ID is available in error handling ---
          const task = JSON.parse(taskData.task); // Parse ONCE here
          const { id, data } = task;

          try {
            console.log(`Processing task ${id}`);
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Update to COMPLETED
            await pgClient.query(
              'UPDATE tasks SET status=$1 WHERE task_id=$2',
              ['completed', id]
            );

            // ✅ Add publish for SUCCESS (after successful update)
            await redisClient.publish(
              'task_updates',
              JSON.stringify({ id, status: 'completed' })
            );

          } catch (error) {
            console.error('Error processing task:', error);

            // Update to FAILED
            const { rows } = await pgClient.query(
              'UPDATE tasks SET status=$1, retries = retries + 1 WHERE task_id=$2 RETURNING retries',
              ['failed', id] // Use `id` from parsed task (already available)
            );
            const retries = rows[0].retries;

            // ✅ Add publish for FAILURE (after failed update)
            await redisClient.publish(
              'task_updates',
              JSON.stringify({ id, status: 'failed', retries })
            );

            if (retries < 3) {
              const delay = Math.pow(2, retries) * 1000;
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