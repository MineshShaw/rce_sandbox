# Baseline Architecture

This document records how the application works in the repository before adding the cloud and DevOps layers. It describes the checked-in implementation, not the eventual capstone target. The project is a local-development monorepo; parts of its README describe intended behavior that is not yet implemented.

## Repository and Runtime

The root `package.json` defines npm workspaces for `application/apps/*` and `application/packages/*`. Application and package code is primarily TypeScript and runs on Node.js.

| Path | Responsibility |
| --- | --- |
| `application/apps/client` | Next.js App Router frontend with Monaco code editor |
| `application/apps/api-server` | Express HTTP API and Socket.IO server |
| `application/apps/worker-node` | BullMQ consumer and Docker execution orchestration |
| `application/packages/database` | Prisma schema and PostgreSQL client singleton |
| `application/packages/queue` | BullMQ/ioredis queue publisher, worker, and event listener |
| `application/packages/storage` | S3-compatible storage interface and AWS SDK implementation |
| `application/packages/shared-types` | Supported language names and Docker runner commands |
| `infrastructure/docker` | Local PostgreSQL, Redis, and MinIO Compose setup and runner images |

The client uses Next.js, React, Monaco Editor, Axios, Socket.IO client, and Tailwind CSS. The API uses Express, Zod, and Socket.IO. The backend packages use Prisma with PostgreSQL, BullMQ with Redis, and the AWS SDK S3 client with MinIO-compatible settings. The worker uses Dockerode to control Docker containers. The checked-in runner images are based on Python 3.11 slim, Node 20 slim, and the GCC image.

## Local Supporting Services

`infrastructure/docker/docker-compose.yml` defines three services on a Compose bridge network:

- PostgreSQL 15 Alpine, exposed on host port `5433`, with a named persistent data volume.
- Redis 7 Alpine, exposed on host port `6379`, with append-only persistence and a named data volume.
- MinIO, exposing its S3 API on `9000` and console on `9001`, with a named data volume.

The Compose file does not start the client, API, worker, or runner containers. The client, API, and worker can run as separate Node.js processes during local development. The worker uses Dockerode to request a separate runner container per execution. Production-oriented API, worker, and client images are now defined as targets in `docker/Dockerfile`; the worker image still requires a separately secured Docker API/execution service.

## Components

### Client

`application/apps/client/src/app/page.tsx` renders a browser-based editor with Python, JavaScript, and C++ choices, initial sample code, a Run button, and an output pane. On mount, it connects to the API's Socket.IO server at `http://localhost:8000`. When the user submits, it posts `{ language, code }` to `/api/submissions`; after receiving the submission ID, it emits `subscribeToJob` with that ID. On `jobComplete`, it displays the result or error message.

The client does not currently provide authentication, problem selection, stdin entry, or status polling. Its API and Socket.IO URLs are hard-coded to localhost.

### API

`application/apps/api-server/src/index.ts` starts an Express server (port `8000` by default), enables CORS and JSON request parsing, and hosts a Socket.IO server. Socket clients join a room by sending `subscribeToJob` with a submission ID.

`POST /api/submissions` validates the request with Zod: `language` must be `PYTHON`, `JAVASCRIPT`, or `CPP`; `code` must be a non-empty string; and optional `problemId` must be a UUID. It then:

1. Generates a submission ID and an S3 object key, initializes the submissions and problems buckets, and uploads the source code to the submissions bucket.
2. If no problem ID was supplied, creates a sandbox problem record with a generated ID.
3. Creates a `PENDING` submission in PostgreSQL, using the placeholder user ID `anonymous_user`.
4. Publishes a BullMQ job whose ID is the submission ID. The payload includes the language, object key, fixed test-case key `mock/cases.json`, a 3000 ms time limit, and a 256 MB memory limit.
5. Returns HTTP 202 with the submission ID and `PENDING` status.

`GET /api/submissions/:id` reads the PostgreSQL submission and returns its status, language, execution time, memory-used value, error message, and standard output; unknown IDs return 404. Both routes return a generic 500 response on caught errors.

The API listens to BullMQ waiting, active, completed, failed, and error events. On completion or failure, it looks up the submission and emits `jobComplete` to that submission's Socket.IO room.

### Queue

`application/packages/queue` uses the `rce-submissions` BullMQ queue and connects through `REDIS_URL`, defaulting to local Redis. A publisher adds `execute-code` jobs with one attempt, completed jobs removed, and up to 1000 failed jobs retained. The worker processes up to five jobs concurrently. The queue package also exposes a QueueEvents listener for lifecycle events.

### Database

`application/packages/database/prisma/schema.prisma` defines PostgreSQL-backed `Problem` and `Submission` models. A problem stores its title, description, time and memory limits, and an S3 key for test cases. A submission stores its problem and user IDs, language, lifecycle status, source-code S3 key, output/error text, execution metrics, and timestamps. Submission statuses include pending/running, completed/failed, timeout, memory, runtime, compilation, and system-error states. Status and user ID are indexed.

The Prisma client is configured with the PostgreSQL adapter and `DATABASE_URL`; the database package supplies a localhost connection-string fallback for development.

### Object Storage

`application/packages/storage` configures the AWS SDK S3 client for path-style requests, with `S3_ENDPOINT`, `S3_ACCESS_KEY`, and `S3_SECRET_KEY` overrides and local MinIO defaults. It manages the `rce-submissions` and `rce-problems` buckets and supports writing and reading text payloads. Submission code is stored in object storage; the database stores its object key rather than the code itself.

### Worker and Sandbox

`application/apps/worker-node/src/index.ts` starts the queue worker. For each job it:

1. Updates the submission status to `RUNNING`.
2. Downloads source code from the submissions bucket.
3. Creates a `DockerSandbox` using the job's time and memory limits and executes the selected language.
4. Updates the database with the resulting status, stdout, stderr/error message, elapsed time, and a placeholder memory usage of `0`.

An error while retrieving the code or processing the job is recorded as `SYSTEM_ERROR` and rethrown so BullMQ records a failed job. A sandbox result is mapped to `TIME_LIMIT_EXCEEDED`, `MEMORY_LIMIT_EXCEEDED`, `RUNTIME_ERROR`, or `COMPLETED`, based on timeout, OOM, and exit code.

`DockerSandbox` selects an image and command from `application/packages/shared-types/src/languages.ts`. It base64-encodes the source into `CODE_PAYLOAD`, then the runner command decodes it under `/workspace` and runs the language runtime or compiles and runs the C++ program. Containers run as `sandboxuser`, with networking disabled, all Linux capabilities dropped, a read-only root filesystem, and a 64 MB `/workspace` tmpfs. The sandbox config also sets memory and swap limits, a CPU quota of 0.5 CPU, and a process limit of 64. The default timeout is 10 seconds, but the API job payload currently overrides it to 3 seconds. Containers are force-removed after execution.

The worker handles `SIGINT` by closing its queue worker. The Docker runner images include Python 3.11 and Node 20 images with `tini`; the C++ image is based on GCC and runs as a non-root user.

## Submission Lifecycle

1. The user edits source code in the browser and submits a language and code string.
2. The API validates the request, writes the code to MinIO, creates a problem if this is a freeform submission, records the pending submission in PostgreSQL, then publishes the job to Redis.
3. The client subscribes to a Socket.IO room using the returned submission ID.
4. A worker receives the job, marks it running, downloads its code from MinIO, and starts an isolated Docker runner.
5. The worker persists the process result to PostgreSQL.
6. BullMQ emits a completion or failure event. The API looks up the stored submission and emits `jobComplete` to the matching Socket.IO room.
7. The client displays the final status/output or error.

## Current Scope and Limitations

- The runtime executes submitted code, but it does not currently evaluate hidden test cases. Although the job carries a test-case object key and the repository contains an `Evaluator` helper, the worker does not retrieve test cases or call the evaluator.
- `COMPLETED` currently means the executed program exited with code zero; it does not mean the submission passed test cases. `FAILED` and compilation-error verdict handling are not wired into the worker's result mapping.
- The worker does not pass stdin to the sandbox. Memory usage is stored as `0` rather than measured from Docker.
- User identity is a placeholder; there is no authentication or authorization flow.
- The client uses fixed localhost endpoints, and service configuration is primarily local-development oriented.
- The root `.gitlab-ci.yml` configures GitLab SAST and secret detection. There is no checked-in GitHub Actions workflow, Terraform configuration, Kubernetes deployment, or GitOps setup yet.
- `application/apps/worker-node/tests/DockerSandbox.test.ts` contains sandbox behavior tests. `application/apps/worker-node/src/evaluator.ts` is a whitespace-normalizing output comparison helper, but it is not part of the active submission path.

## Phase 1 Restructuring and Container Images

The application workspaces now live under `application/apps/` and `application/packages/`. The root npm workspace manifest and lockfile point to these paths; moving the two directories together preserves the TypeScript aliases and relative imports between apps and packages. The root `docker/Dockerfile` provides multi-stage `api`, `worker`, and `client` targets based on Node 22 Alpine. The Next.js client is configured for standalone output so its final image contains only traced runtime files. See [docker-setup.md](docker-setup.md) for migration commands, build commands, stage details, and the worker Docker API security constraint.
