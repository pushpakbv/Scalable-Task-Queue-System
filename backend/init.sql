-- backend/init.sql
CREATE TABLE IF NOT EXISTS tasks (
  task_id VARCHAR(255) PRIMARY KEY,
  status VARCHAR(50) NOT NULL,
  data JSONB,
  retries INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  processing_time DOUBLE PRECISION
);