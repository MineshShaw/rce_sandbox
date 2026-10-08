# Future RCE Sandbox DevOps Implementation Plan

This document preserves the planned DevOps work for the TypeScript Remote Code Execution sandbox before development moves to another project. It is a resumption guide for the current repository, not a claim that the future cloud, Kubernetes, CI/CD, monitoring, or GitOps capabilities already exist.

## Current Baseline

The repository is a TypeScript monorepo using npm workspaces. The current application is organized under `application/`:

- `application/apps/client`: Next.js App Router frontend with React, Monaco Editor, Axios, and Socket.IO client.
- `application/apps/api-server`: Express API with Zod validation, Socket.IO notifications, and submission endpoints.
- `application/apps/worker-node`: BullMQ worker that downloads source code, invokes Dockerode, and persists execution results.
- `application/packages/database`: Prisma client and PostgreSQL schema for problems and submissions.
- `application/packages/queue`: BullMQ and ioredis publisher, worker, and queue-event listener.
- `application/packages/storage`: AWS SDK S3-compatible storage service used with MinIO locally and object storage in a future cloud environment.
- `application/packages/shared-types`: Supported-language definitions and language runner commands.
- `infrastructure/docker`: Local PostgreSQL, Redis, MinIO, and Python/JavaScript/C++ runner image definitions.

The current submission path is client to API, API to S3-compatible storage and PostgreSQL, PostgreSQL/Redis-backed queueing through `@rce/queue`, worker execution in a constrained language runner, and completion notification through Socket.IO. The worker currently uses Dockerode and must not be granted an unrestricted host Docker socket in a production deployment.

## Target Repository Layout

```text
application/       TypeScript applications and @rce/* workspace packages
docker/            Production application and runner image Dockerfiles
terraform/         Cloud networking, registry, IAM, and Kubernetes infrastructure
kubernetes/        Raw Kubernetes manifests and environment overlays
helm/              Helm chart packaging and deployment values
security/          Security policies, scanning configuration, and exceptions
monitoring/        Logs, metrics, dashboards, alerts, and runbooks
gitops/            Declarative environments and reconciler configuration
.github/workflows/ CI, security, image publishing, and promotion workflows
docs/              Architecture, operations, recovery, and troubleshooting guides
```

Keep `@rce/storage` and `@rce/queue` as independently owned shared packages. Any change to their contracts, configuration, retry behavior, connection lifecycle, or deployment assumptions must be documented immediately in the architecture and operational documentation.

## Phase 1: Project Restructuring and Dockerization

### Objectives

Make the local monorepo reproducible and produce secure production images for the client, API, and worker without losing the local MinIO, PostgreSQL, Redis, or language-runner workflow.

### Planned work

- Preserve the completed workspace migration from `apps/` and `packages/` into `application/apps/` and `application/packages/`. Keep the root npm workspace manifest and lockfile authoritative.
- Keep TypeScript path aliases, Prisma configuration, local `file:` workspace dependencies, and package imports correct after future edits. Validate all `@rce/database`, `@rce/queue`, `@rce/storage`, and `@rce/shared-types` consumers after changes.
- Maintain the shared multi-stage `docker/Dockerfile` with independent API, worker, and Next.js client targets. Use a pinned lightweight base, deterministic `npm ci`, a dependency cache stage, and production-only dependencies in final stages.
- Keep all application images non-root. Use Next.js standalone output for the client and avoid copying build tools, test runners, source maps, credentials, or full development dependency trees into final images.
- Standardize the Python, JavaScript, and C++ runner images. Ensure runner users are non-root and retain network isolation, dropped capabilities, read-only roots where compatible, bounded memory/CPU/PIDs, and controlled temporary workspace storage.
- Define health endpoints for API and worker before adding image or Kubernetes probes. Add graceful shutdown handling for HTTP, Socket.IO, BullMQ, Redis, PostgreSQL, and S3 clients.
- Keep `.dockerignore` comprehensive. Exclude node modules, generated output, local environment files, private keys, Terraform state, logs, test artifacts, and unrelated infrastructure from application build contexts.
- Document the worker execution boundary. A general-purpose worker must not receive unrestricted host Docker access; evaluate a dedicated execution service, Kubernetes sandbox runtime, gVisor, or Kata Containers.

### Exit criteria

- A clean checkout can install workspaces, generate Prisma, run tests, and build API, worker, client, and runner images.
- API, worker, and client images run as non-root with only required production dependencies.
- Local end-to-end execution still works with PostgreSQL, Redis, MinIO, and runner images.
- Image contracts, required environment variables, ports, health endpoints, and execution security assumptions are documented.

## Phase 2: Infrastructure as Code with Terraform

### Objectives

Provision a repeatable cloud foundation and Kubernetes cluster without embedding credentials or manually created infrastructure.

### Planned work

- Select and document the cloud provider, region, availability-zone strategy, Kubernetes service, environment model, cost limits, and disaster-recovery assumptions.
- Create Terraform roots and reusable modules under `terraform/` for networking, subnets, routing, security groups/firewall rules, Kubernetes cluster, node pools, container registry, IAM/service accounts, DNS, and TLS prerequisites.
- Decide which stateful components are managed services and which are deployed in Kubernetes. Prefer managed PostgreSQL, Redis-compatible queue infrastructure, and S3-compatible object storage when their availability, backup, encryption, and operational characteristics are appropriate.
- Map `@rce/storage` configuration to cloud object storage: endpoint, region, bucket names, path-style/virtual-hosted addressing, TLS, credentials or workload identity, encryption, retention, and lifecycle rules. Preserve MinIO-compatible local overrides.
- Map `@rce/queue` configuration to a managed or in-cluster Redis service. Define TLS, authentication, connection pooling, retry/backoff, queue retention, dead-letter handling, concurrency, and shutdown behavior.
- Provision durable database storage, automated backups, point-in-time recovery where available, encryption at rest, network restrictions, and database migration access.
- Use remote encrypted Terraform state with locking. Pin Terraform and provider versions and maintain safe `.tfvars.example` files containing no secrets.
- Use least-privilege IAM and workload identity/OIDC. Separate permissions for Terraform, CI image publishing, GitOps reconciliation, runtime API, runtime worker, storage access, queue access, and database migrations.
- Add `terraform fmt`, `terraform validate`, provider lockfile checks, plan review, apply approval, drift detection, and documented destroy procedures.

### Exit criteria

- A reviewed Terraform plan can create the network, registry, cluster, identities, and selected managed dependencies.
- State is remote, locked, encrypted, backed up, and inaccessible to untrusted pull requests.
- Infrastructure can be recreated for a non-production environment without manually editing generated resources.
- Database, Redis, and object-storage recovery responsibilities are documented.

## Phase 3: Kubernetes and Helm

### Objectives

Deploy the client, API, worker, and their supporting services using secure, reviewable Kubernetes configuration packaged through Helm.

### Planned work

- Create manifests under `kubernetes/` for API and worker Deployments, client Deployment, Services, Ingress, ConfigMaps, Secret references, ServiceAccounts, HPA, PodDisruptionBudgets, NetworkPolicies, and migration Jobs.
- Configure API environment variables for `DATABASE_URL`, `REDIS_URL`, S3 endpoint and credentials, bucket names, queue names, CORS/origin settings, and public client/API URLs.
- Configure worker environment variables for database, queue, and storage access, runner image names, execution limits, Docker API or sandbox-runtime endpoint, and worker concurrency.
- Keep secrets out of Git. Reference External Secrets, cloud secret managers, sealed secrets, or another documented secret-delivery mechanism. Never commit MinIO, Redis, PostgreSQL, registry, cloud, or signing credentials.
- Add readiness, liveness, and startup probes after health endpoints exist. Include graceful termination periods and rollout settings that allow in-flight queue jobs to finish safely.
- Apply security contexts: non-root users, dropped capabilities, seccomp profiles, read-only root filesystems where possible, restricted privilege escalation, resource requests/limits, ephemeral-storage limits, and distinct service accounts.
- Treat code execution as a separate trust boundary. Restrict worker egress, runner permissions, host access, node placement, runtime class, and access to the Docker or sandbox API.
- Configure durable storage only where required. Do not use ephemeral pod storage for PostgreSQL data, Redis persistence, or submission source/object data.
- Define API scaling from HTTP load and worker scaling from queue depth or a documented custom metric. Set safe min/max replicas and concurrency limits so scaling does not overload PostgreSQL, Redis, storage, or sandbox capacity.
- Package the supported resources in `helm/` with a versioned chart, `values.yaml`, environment values, schema validation, NOTES, upgrade/rollback instructions, and rendered-manifest checks.
- Choose one source of truth between raw manifests and Helm. Prevent raw Kubernetes files and chart templates from silently diverging.

### Exit criteria

- `kubectl` validation and Helm lint/template checks pass for development and production-like values.
- The client, API, and worker roll out successfully with healthy probes and least-privilege identities.
- A deployed submission can travel through `@rce/storage`, PostgreSQL, `@rce/queue`, the worker, and the selected sandbox runtime.
- Secrets, persistent storage, scaling, migration, rollback, and network boundaries are documented and tested.

## Phase 4: DevSecOps and CI/CD with GitHub Actions

### Objectives

Automate quality gates, security controls, reproducible image builds, and traceable registry publication.

### Planned work

- Add pull-request and trusted-branch workflows under `.github/workflows/`.
- Run workspace installation, Prisma generation, TypeScript checks, Next.js build/lint, worker sandbox tests, API tests, queue tests, storage tests, and integration tests where dependencies can be safely provisioned.
- Add SAST for TypeScript, dependency/SCA scanning for npm and container dependencies, secret scanning, IaC scanning for Terraform/Kubernetes/Helm, and container image scanning.
- Establish severity thresholds, false-positive handling, time-limited exceptions, security ownership, and an auditable remediation process. Track the existing npm audit findings rather than silently ignoring them.
- Build API, worker, client, and runner images with immutable commit-SHA tags. Publish only from trusted contexts after required checks pass.
- Generate SBOMs and provenance attestations. Sign images and verify signatures during deployment where the selected registry and cluster policy support it.
- Pin third-party GitHub Actions to full commit SHAs. Set minimal workflow permissions, concurrency controls, safe caching, artifact retention, and clear failure diagnostics.
- Use GitHub OIDC and short-lived cloud/registry credentials. Never expose production secrets to forked pull requests or run privileged Docker builds on untrusted source.
- Separate CI validation and image publication from environment deployment. Let GitOps consume reviewed image-digest changes rather than allowing arbitrary direct production applies.

### Exit criteria

- Pull requests receive required test, SAST, SCA, secret, IaC, and image-scan results.
- Trusted builds publish immutable, traceable images with SBOM and provenance metadata.
- CI credentials are short-lived and least-privilege, and no secrets are stored in source or image layers.

## Phase 5: Monitoring, Logging, and GitOps

### Objectives

Provide operational visibility and make the cluster converge from reviewed Git state.

### Monitoring and logging work

- Instrument the API with request count, latency, status codes, validation failures, active connections, and submission throughput metrics.
- Instrument `@rce/queue` with queue depth, waiting age, active jobs, completed/failed jobs, retries, stalled jobs, and event-listener errors.
- Instrument the worker with job processing duration, concurrency, sandbox exit statuses, timeout/OOM/runtime/compilation/system errors, runner startup failures, and storage/database failures.
- Instrument `@rce/storage` with request counts, latency, bucket initialization failures, upload/download failures, retries, and object-size limits. Never log source code, credentials, or full sensitive payloads.
- Collect structured JSON logs with submission/job correlation IDs, service name, environment, severity, and safe error context. Define retention, redaction, access control, and data-residency rules.
- Deploy dashboards and alerts for API availability, error rate, queue latency, worker backlog, execution failure rate, pod restarts, CPU/memory saturation, PostgreSQL, Redis, and object-storage health.
- Write runbooks for queue backlog, storage outage, database connectivity, runner capacity, failed rollout, probe failures, and exhausted cloud resources.

### GitOps work

- Select and document Argo CD, Flux, or an equivalent reconciler. Store environment-specific Helm values or rendered manifests under `gitops/`.
- Define development, staging, and production promotion paths. A promotion must update immutable image digests through a reviewed Git change.
- Configure repository/environment access controls, sync/prune policy, drift detection, reconciliation notifications, health checks, and rollback by Git revert.
- Integrate secret references without placing secret values in the GitOps repository.
- Add deployment verification, smoke tests, and an explicit rollback procedure for API, worker, client, queue, storage, and schema changes.

### Exit criteria

- A test deployment emits useful logs and metrics, dashboards show queue and execution health, and at least one alert is validated.
- A reviewed Git change deploys through reconciliation, drift is detected, and reverting the Git change restores the prior image/configuration.
- Operators can diagnose common failures using documented signals and runbooks.

## Phase 6: Troubleshooting Challenge and Final Documentation

### Objectives

Demonstrate operational debugging without compromising production or leaving undocumented behavior behind.

### Planned work

- Create an isolated, opt-in troubleshooting exercise with reversible faults such as an invalid `REDIS_URL`, wrong S3 endpoint, incorrect ConfigMap, failing readiness probe, incompatible image digest, broken Helm value, or queue concurrency mismatch.
- Keep fault injection outside the default production values. Never use real credentials, destructive migrations, data deletion, unrestricted sandbox permissions, or intentionally exploitable vulnerabilities.
- Document expected symptoms, relevant logs/metrics, safe investigation commands, likely hypotheses, root cause, remediation, and verification for each fault.
- Update `docs/baseline-architecture.md` to distinguish the original local baseline from the implemented cloud/DevOps architecture.
- Finalize the root `README.md` with architecture diagrams, prerequisites, local setup, image build commands, environment variables, test commands, Terraform workflow, Kubernetes/Helm deployment, GitOps promotion, security model, observability, backup/recovery, and troubleshooting links.
- Add operational runbooks for deployment, rollback, database migration, queue recovery, object-storage recovery, runner isolation, secret rotation, and incident response.
- Record all deviations from this future plan and all changes to architecture, infrastructure, configuration, or pipelines immediately in project documentation.

### Exit criteria

- A maintainer can reproduce local development and understand the production deployment path from the README.
- The troubleshooting challenge can be injected, diagnosed, repaired, and verified without affecting production.
- Documentation describes implemented behavior accurately and labels future work separately.

## Resumption Order

Resume in this order:

1. Re-check the repository and Phase 1 exit criteria, including the worker sandbox boundary and image vulnerabilities.
2. Choose the cloud provider and stateful-service ownership before writing Terraform.
3. Implement Terraform and validate a disposable non-production environment.
4. Implement Kubernetes manifests and Helm, then run an end-to-end submission.
5. Add GitHub Actions security gates and immutable image publication.
6. Add monitoring and GitOps promotion/reconciliation.
7. Complete the isolated troubleshooting exercise and final documentation.

## Non-Negotiable Rules

- Treat submitted code as hostile input and preserve isolation at every layer.
- Keep `@rce/storage` and `@rce/queue` configuration explicit, environment-driven, observable, and tested.
- Never commit credentials, private keys, Terraform state, generated secrets, or source-code payloads.
- Prefer managed durable state or explicitly configured persistent storage with backups; never rely on ephemeral pods for durable application data.
- Use least privilege for CI, Terraform, Kubernetes workloads, storage, queue, database, registry, and GitOps access.
- **CRITICAL: Any changes made to the architecture, infrastructure, configurations, or pipelines must be immediately recorded in the project documentation.**
