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
  let lastId = '0'; // Track last processed task ID

  while (true) {
    try {
      const result = await redisClient.xRead(
        { key: 'task_stream', id: lastId },
        { COUNT: 10, BLOCK: 5000 }
      );

      // Handle empty result
      if (!result || result.length === 0) continue;

      // Iterate over each stream (though there's only one stream: 'task_stream')
      for (const stream of result) {
        const messages = stream.messages; // Get messages from the stream
        for (const message of messages) {
          const { id: messageId, message: taskData } = message;
          lastId = messageId; // Update last processed ID

          try {
            // Parse the task from Redis
            const task = JSON.parse(taskData.task); // taskData contains { task: "..." }
            const { id, data } = task;

            console.log(`Processing task ${id}`);
            
            // Simulate processing (e.g., image resize)
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Mark task as completed
            await pgClient.query(
              'UPDATE tasks SET status=$1 WHERE task_id=$2',
              ['completed', id]
            );
          } catch (error) {
            console.error('Error processing task:', error);
            // Move this inside try block or store task ID in wider scope
            const taskInfo = JSON.parse(taskData.task);

            // Retry logic
            const { rows } = await pgClient.query(
              'UPDATE tasks SET status=$1, retries = retries + 1 WHERE task_id=$2 RETURNING retries',
              ['failed', taskInfo.id]
            );
            const retries = rows[0].retries;
            
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