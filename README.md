# Asynchronous Job Processing System with Redis and Worker Queues

This project implements an asynchronous background job processing system using **Node.js**, **Redis**, **PostgreSQL**, and **Docker Compose**.  
It demonstrates how long-running tasks can be handled outside the main HTTP request lifecycle using a worker-based queue architecture.

---

## Objective

- Accept job requests via REST API
- Store job metadata in a database
- Enqueue jobs using Redis
- Process jobs asynchronously using a worker service
- Track job status and results
- Support retries for failed jobs
- Fully containerized and reproducible using Docker Compose

---

## Tech Stack

| Component | Technology |
|--------|-----------|
| API | Node.js + Express |
| Worker | Node.js |
| Queue | Redis |
| Database | PostgreSQL |
| Containerization | Docker + Docker Compose |

---

## System Architecture

### Components

#### 1. API Service (`app`)
- Exposes REST endpoints
- Inserts job metadata into PostgreSQL
- Pushes job IDs into Redis queue
- Does **not** execute jobs directly

#### 2. Worker Service (`worker`)
- Listens to Redis queue
- Fetches job data from PostgreSQL
- Executes background jobs
- Updates job status and results
- Handles retries on failure

#### 3. PostgreSQL (`db`)
- Stores job metadata:
  - id
  - type
  - status
  - payload
  - result
  - retry attempts

#### 4. Redis
- Acts as a message broker
- Holds job IDs in queue


---

## Job Lifecycle

1. Client creates job → `POST /jobs`
2. Job stored in DB with status `pending`
3. Job ID pushed to Redis queue
4. Worker picks job → status `processing`
5. Job executed
6. On success → status `completed`
7. On failure → retry (up to limit)
8. If retries exhausted → status `failed`

---

## Supported Job Types

### Email Sending Job (EMAIL_SEND)

- Sends email using a mock SMTP server (MailHog)
- Uses `nodemailer`
- Emails can be viewed at http://localhost:8025

#### Example Payload
```json
{
  "to": "test@example.com",
  "subject": "Job Notification",
  "body": "Your job has been processed successfully."
}
```
On success:
- Job status is updated to completed
- Email message ID is stored in the result column

### CSV Generation Job
- Converts payload JSON into a CSV file
- Stores output inside `output/` directory
- Updates database with file path

---

## Environment Configuration

### `.env.example`
```env
API_PORT=3000
DATABASE_URL=postgresql://user:password@db:5432/jobs_db
REDIS_URL=redis://redis:6379
MAIL_HOST=mailhog
```
.env should be created using .env.example before running the project.

---

### Database Schema

The database is automatically initialized using SQL scripts inside seeds/.

#### Jobs Table
```sql
CREATE TABLE jobs (
  id UUID PRIMARY KEY,
  type VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL,
  payload JSONB NOT NULL,
  result JSONB,
  error TEXT,
  attempts INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

---

### Running the Project

#### Prerequisites
- Docker
- Docker Compose

#### Step 1: Start all services

Open a terminal in the project root and run:
```bash
docker compose up -d
```
Wait until all containers are healthy.

#### Step 2: Verify containers
```bash
docker compose ps
```
Expected services:
- app
- worker
- db
- redis
- mailhog

MailHog UI is available at:
http://localhost:8025

---

### API Verification

- Open a NEW terminal for API testing
- Do not stop Docker containers
- In the new terminal window, run the following commands.

#### 1. Create a Job
```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "csv-generation",
    "payload": {
      "name": "Alice",
      "score": 95
    }
  }'
```
Expected response:
```json
{
  "job_id": "<uuid>",
  "status": "pending"
}
```
Copy the returned job_id.

---

### 2. Check Job Status
```bash
curl http://localhost:3000/jobs/<job-id>
```
Response example:
```json
{
  "job_id": "<uuid>",
  "type": "csv-generation",
  "status": "completed",
  "result": "output/<job-id>.csv"
}
```
---

### Worker Verification

In the original terminal, check worker logs:

#### View worker logs
```bash
docker logs -f async-job-system-worker-1
```
Expected logs:
- Job received
- Job marked as processing
- Job completed OR retried on failure

---

### Retry Mechanism
- Each job has an attempts counter
- Worker retries failed jobs automatically
- After retry limit → job marked as failed

#### Verify retry behavior

```bash
docker exec -it async-job-system-db-1 psql -U user -d jobs_db
```
then:

```sql
SELECT id, status, attempts FROM jobs;
```
#### Output Verification
CSV files are stored in:
```bash
output/<job-id>.csv
```
Example content:
```csv
key,value
name,Alice
score,95
```
---

### Failure Handling & Dead Letter Queue (DLQ)

- Jobs are retried automatically up to a maximum retry limit
- Attempts count is stored in the database
- If retries are exhausted:
  - Job status is set to `failed`
  - Job ID is pushed to Redis `job_dlq` queue for inspection


### Project Structure
```pgsql
async-job-system/
├── src/
│   ├── app.js
│   ├── worker.js
│   ├── db.js
│   ├── redis.js
│   └── routes/
│       └── jobs.js
├── seeds/
│   └── 001_create_jobs_table.sql
├── output/
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── package.json
├── package-lock.json
└── README.md
```
---

### Notes

- Database seeding is automatic
- Redis is used only as a queue
- No UI is required
- Designed for clarity and evaluation verification

---