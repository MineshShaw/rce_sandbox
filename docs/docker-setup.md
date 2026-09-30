# Docker Build and Migration Guide

This document describes the Phase 1 application relocation and the production-oriented multi-target image in `docker/Dockerfile`. All build commands use the repository root as the Docker build context so npm can see the root workspace manifest and lockfile.

## Application workspace migration

The application and shared package workspaces were moved together to `application/`. Starting from a checkout with the original root-level `apps/` and `packages/` directories, the exact tracked-file migration commands are:

Run these from the repository root before the workspace migration:

```sh
mkdir -p application
git mv apps application/apps
git mv packages application/packages
```

The move preserves the relative layout between each app and package. Thus API/worker TypeScript aliases that resolve `../../packages/*`, worker relative imports into `packages/shared-types`, and local workspace dependencies such as `file:../../packages/database` remain valid. Do not move `apps/` or `packages/` separately from one another.

The root `package.json` workspace configuration must be:

```json
{
  "devDependencies": {
    "@types/node": "^26.1.1"
  },
  "workspaces": [
    "application/apps/*",
    "application/packages/*"
  ],
  "private": true
}
```

After changing it, regenerate the root lockfile with `npm install --package-lock-only`. The API declares its shared package dependencies using the same relative local paths as the worker. `tsx` is a production dependency of the API and worker because their current start commands execute TypeScript directly in the container; build/test-only TypeScript tooling remains a development dependency.

For a safe review before committing, use `git status --short`, inspect the staged rename summary with `git diff --cached --summary`, run the workspace checks, and keep the migration and lockfile changes in the same commit.

## Building images

Run these commands from the repository root:

```sh
docker build --target api -f docker/Dockerfile -t rce-api:local .
docker build --target worker -f docker/Dockerfile -t rce-worker:local .
docker build --target client -f docker/Dockerfile -t rce-client:local .
```

The image targets are:

| Target | Entrypoint | Port | Runtime configuration |
| --- | --- | --- | --- |
| `api` | `tsx application/apps/api-server/src/index.ts` | 8000 | `PORT`, `DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` |
| `worker` | `tsx application/apps/worker-node/src/index.ts` | none | `DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, and `DOCKER_HOST` (plus `DOCKER_TLS_VERIFY`/`DOCKER_CERT_PATH` when using TLS) for the current Dockerode executor |
| `client` | `node application/apps/client/server.js` | 3000 | Current client API and Socket.IO URLs are hard-coded to `http://localhost:8000`; browser-facing runtime configuration remains to be implemented |

The API and worker images require PostgreSQL, Redis, and MinIO/S3-compatible storage to be reachable at the configured endpoints. Supply credentials through the deployment environment or a secret manager; do not put them in Docker build arguments, image layers, or committed `.env` files.

The worker image runs as the unprivileged `node` user. The current executor uses Dockerode and expects access to a Docker API. Do not mount the host Docker socket into a general-purpose worker in production: it grants extensive host control. Use a dedicated, access-controlled execution service or an appropriately isolated container runtime, and provide the worker a protected endpoint. The worker may need a future executor adapter to use Kubernetes sandboxing, gVisor, or Kata Containers directly.

## Multi-stage build structure

`docker/Dockerfile` uses `node:22-alpine` as a common base and installs the small runtime OS dependencies needed by Prisma and Node native modules. The `deps` stage copies only workspace manifests and Prisma schema/config first, installs the locked workspace dependencies, and generates the Prisma client. Keeping app source out of this stage preserves dependency and Prisma engine cache layers across ordinary source edits. Prisma generation receives a disposable local placeholder `DATABASE_URL` because the Prisma config requires a URL; it does not connect to a database, and the value is not set as a runtime environment variable.

The `build` stage then copies application sources and creates the optimized Next.js production build with standalone output. The `api`, `worker`, and `client` final stages start again from the lightweight base rather than inheriting build tools. Each runs an npm workspace production-only install (`npm ci --omit=dev`) for its runtime workspace and dependencies. The API and worker copy in the generated Prisma client. All targets run as the non-root `node` user. No image-level `HEALTHCHECK` is declared because the API does not yet expose a health/readiness endpoint; add one when those endpoints are implemented. Dockerfile targets share a single source file while producing independently deployable images.

The API and worker currently run TypeScript through `tsx` at runtime. `tsx` is therefore included as a production dependency for those two workspaces; type declarations, test runners, and other build-only dependencies are omitted from their final images. The client enables Next.js standalone output and copies only its traced runtime, static assets, and public files into the final image; development dependencies and the full workspace dependency tree are not copied.

The root `.dockerignore` removes local dependencies, generated output, credentials, logs, and repository-only infrastructure/docs from the build context. Keep the root `package.json`, root `package-lock.json`, and `application/` in the build context because workspace installation requires them.

## Validation

After installing the workspace dependencies, validate the Dockerfile from the root with:

```sh
docker build --target api -f docker/Dockerfile -t rce-api:local .
docker build --target worker -f docker/Dockerfile -t rce-worker:local .
docker build --target client -f docker/Dockerfile -t rce-client:local .
```

The API and worker need their external services configured when run. The images do not package PostgreSQL, Redis, MinIO, Docker Engine, or language-runner images.
