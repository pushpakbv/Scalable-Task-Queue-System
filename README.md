# Scalable Distributed Task Queue System  

A high-performance task queue system designed to handle asynchronous operations (e.g., image resizing, data scraping) with fault tolerance, real-time monitoring, and horizontal scalability.  

---

## ✨ Features  
- **Task Submission**: Submit tasks via REST API with automatic queuing.  
- **Asynchronous Processing**: Redis Streams for ordered, persistent task queues.  
- **Retry Mechanism**: Exponential backoff (1s → 2s → 4s) for failed tasks.  
- **Real-Time Dashboard**: WebSocket + Redis Pub/Sub integration for live updates.  
- **Scalability**: Dockerized services for horizontal scaling (e.g., `--scale worker=5`).  
- **Monitoring**: Prometheus metrics and Grafana dashboards for system health.  
- **Audit Logging**: PostgreSQL for task history and status tracking.  

---

## 🛠️ Technologies  
- **Backend**: Node.js, Express, Redis Streams  
- **Database**: PostgreSQL (JSONB for task metadata)  
- **Infrastructure**: Docker, Docker Compose  
- **Frontend**: Next.js, Tailwind CSS, WebSocket  
- **Monitoring**: Prometheus, Grafana, Jaeger (distributed tracing)  

---

## 📁 Project Structure  
```plaintext
task-queue-system/  
├── backend/               # API and worker logic  
├── frontend/              # Next.js dashboard  
├── worker/                # Task processing logic  
├── docker-compose.yml     # Multi-container orchestration  
├── prometheus.yml         # Metrics collection config  
└── grafana/               # Dashboard templates (optional)
## 🚀 Usage

### Running the System

```bash
# Start all services  
docker-compose up --build  

# Scale workers  
docker-compose up --scale worker=3  
```

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tasks` | POST | Submit new task |
| `/api/tasks` | GET | Retrieve recent tasks |
| `/metrics` | GET | Prometheus metrics |
| `/health` | GET | System health check |

### Monitoring

- **Grafana Dashboard**: `http://localhost:3002` (pre-built dashboards for Redis, PostgreSQL, and Node.js metrics)
- **Prometheus**: `http://localhost:9090` (metric queries)

## 📊 Key Metrics Tracked

- Task throughput and success/failure rates
- Redis memory usage and queue length
- PostgreSQL query latency and connection pool
- Worker processing time and error rates

## 📜 License

MIT License. See LICENSE for details.

## Acknowledgments

- Redis Streams for robust task queuing
- Prometheus/Grafana for observability
- Docker for seamless scaling
