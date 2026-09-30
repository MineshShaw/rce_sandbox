# 🚀 Scalable Remote Code Execution (RCE) Sandbox
A high-performance, distributed code execution engine and sandbox (similar to Replit or LeetCode). This platform allows users to submit untrusted code in multiple languages (Python, JavaScript, C++), isolates the execution in secure Docker containers, and handles massive traffic spikes using an event-driven message queue architecture.

---

## 🧠 System Architecture
This project is structured as a Monorepo containing independent microservices.

Unlike standard web applications, running untrusted code is resource-intensive and dangerous. Therefore, the system is strictly decoupled:

1. The API Gateway instantly accepts requests and offloads them to a queue.

2. The Message Broker holds the jobs safely, preventing system crashes during traffic spikes.

3. The Worker Nodes pull jobs at their own pace, execute them in secure, locked-down Docker sandboxes, and update the database.

### Tech Stack: What & Why
* Gateway & Frontend: Node.js / Express (API) & Next.js + Monaco Editor (Client).

* Execution Engine: Docker (Hardened containers using tini to prevent zombie processes).

* Message Broker: Redis + BullMQ (Handles job queueing, retries, and rate-limiting).

* Database: PostgreSQL + Prisma ORM (Stores system state, problem descriptions, and submission metadata).

* Object Storage: MinIO / S3 (Stores raw code files and test cases to prevent bloating the SQL database).

---

## 📂 Repository Structure
```bash
rce_sandbox/
├── application/
│   ├── apps/                # Next.js client, Express API, and execution worker
│   └── packages/            # Database, queue, storage, and shared types
├── docker/                  # Multi-stage application Dockerfile
├── infrastructure/docker/  # Local PostgreSQL, Redis, MinIO, and runner images
└── docs/                    # Baseline architecture and implementation plan
```

---

## ⚙️ How a Code Submission Works (The Data Lifecycle)
1. User Submits Code: The Next.js client sends a POST request with the source code to the api-server.

2. Storage: The api-server uploads the raw code to the MinIO submissions bucket.

3. Ledger: The api-server creates a PENDING record in PostgreSQL.

4. Queueing: The api-server pushes the Job ID to the Redis submissionQueue and returns 202 Accepted to the client.

5. Consumption: A worker-node picks up the job from Redis and marks it RUNNING in the DB.

6. Execution: The worker downloads the code from MinIO, dynamically spins up a secure Docker container, injects the code, runs it, and captures stdout/stderr.

7. Resolution: The worker tears down the container and updates the DB with COMPLETED or FAILED.

---

## 🛠️ Getting Started
Follow these steps to boot the entire infrastructure locally.

### 1. Prerequisites
Ensure you have the following installed on your machine:

* Node.js (v20.9+)

* Docker Desktop (Must be actively running)

* Git

### 2. Install Dependencies
Run this at the root of the project to install all dependencies and link the local @rce/* packages:

```bash
npm install
```

### 3. Boot the Infrastructure (Data Layer)
Start PostgreSQL, Redis, and MinIO using Docker Compose:

```bash
cd infrastructure/docker
docker-compose up -d
```
(Verify they are running by typing docker ps).

### 4. Build the Secure Runner Images
The Worker Node needs specialized Docker images to run user code safely. You must build these locally on your machine once.

```bash
cd infrastructure/docker/runner-images

# Build Python Engine
docker build -t rce-python-runner -f python.Dockerfile .

# Build JS Engine (if file exists)
docker build -t rce-js-runner -f js.Dockerfile .

# Build C++ Engine (if file exists)
docker build -t rce-cpp-runner -f cpp.Dockerfile .
```

### 5. Database Migrations
Push the database schema to your running PostgreSQL container and generate the Prisma Client:

```bash
cd application/packages/database
npx prisma db push
npx prisma generate
```

### 🚀 Running the Microservices
You will need three separate terminal windows to run the application components simultaneously.

* Terminal 1: Start the API Server

```bash
cd application/apps/api-server
npm run dev
# Listens on http://localhost:8000
```

* Terminal 2: Start the Worker Node

```bash
cd application/apps/worker-node
npm run start
# Listens to Redis Queue. Watch this terminal for execution logs!
```

* Terminal 3: Start the Next.js Client

```bash
cd application/apps/client
npm run dev
# Visit http://localhost:3000 to see the Code Editor UI
```

---

## 🗺️ Roadmap (Upcoming Features)
[ ] The Evaluator: Inject hidden test cases via stdin and compare stdout against expected results (Accepted, Wrong Answer, TLE).

[ ] Observability: Mount Grafana/Prometheus dashboards to monitor queue latency and worker CPU usage.

## Phase 1 Docker Images

The application workspaces are under `application/`. Build the API, worker, and client images from the repository root using the commands and runtime configuration in [docs/docker-setup.md](docs/docker-setup.md). The worker image does not include Docker Engine or language runner images; it requires a separately secured execution endpoint.
