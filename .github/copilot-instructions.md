# Copilot Instructions

## Project Overview

This repository is a TypeScript monorepo for an asynchronous remote code execution sandbox. A Next.js browser client submits Python, JavaScript, or C++ source code to an Express API. The API stores the source in S3-compatible object storage, creates a submission record in PostgreSQL, and queues work in Redis through BullMQ. A worker retrieves the source and runs it in a constrained Docker container, then persists the execution result for the client.

The repository currently provides a local-development implementation; do not assume that every capability described as a goal or in older overview text is implemented. See [docs/baseline-architecture.md](../docs/baseline-architecture.md) for the as-is behavior and limitations, and [docs/docker-setup.md](../docs/docker-setup.md) for Phase 1 migration and image build details.

## Current Tech Stack & Structure

- **Languages and runtime:** TypeScript and Node.js, with npm workspaces.
- **Web client (`application/apps/client`):** Next.js App Router, React, Monaco Editor, Axios, Socket.IO client, and Tailwind CSS.
- **HTTP API (`application/apps/api-server`):** Express, Zod request validation, Socket.IO events, and shared database, queue, and storage packages.
- **Execution worker (`application/apps/worker-node`):** BullMQ consumer, Dockerode orchestration, and a Docker-based sandbox for Python, JavaScript, and C++.
- **Shared packages (`application/packages/`):**
  - `database`: Prisma schema/client with PostgreSQL and the `pg` Prisma adapter.
  - `queue`: BullMQ and ioredis publisher, worker, and queue-event listener.
  - `storage`: AWS SDK S3 client configured for S3-compatible storage such as MinIO.
  - `shared-types`: Supported-language definitions and runner commands.
- **Local infrastructure (`infrastructure/docker`):** Docker Compose services for PostgreSQL, Redis, and MinIO, plus language runner Dockerfiles.
- **Existing CI configuration:** `.gitlab-ci.yml` includes GitLab SAST and secret-detection templates. GitHub Actions, Terraform, Kubernetes, and GitOps deployment are not yet present as the target architecture.

## DevOps Capstone Goals

The project is being developed toward a Dockerized, Kubernetes-hosted, GitOps-driven architecture, provisioned with Terraform and automated using GitHub Actions. Treat these as future goals unless they are implemented in the repository; keep descriptions of current behavior distinct from proposed or planned behavior.

## Documentation Rule

CRITICAL: Any changes made to the architecture, infrastructure, configurations, or pipelines must be immediately recorded in the project documentation.
