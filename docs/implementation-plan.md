# RCE Sandbox DevOps Capstone — Master Implementation Plan

## Objective

Transform the current TypeScript/npm-workspaces RCE sandbox into a secure, reproducible, observable, Kubernetes-hosted application with infrastructure managed as code, automated delivery, and GitOps-based deployment. Preserve the current submission lifecycle—client, API, Redis/BullMQ queue, worker, PostgreSQL, S3-compatible object storage, and isolated language runners—while making each component buildable, deployable, configurable, and testable.

The current implementation baseline and known gaps are documented in [baseline-architecture.md](baseline-architecture.md). Update that document and the root README whenever implementation changes alter current behavior.

## Target Repository Layout

```text
application/       Application source and shared workspace packages
docker/            Optimized application and language-runner Dockerfiles
kubernetes/        Kubernetes base manifests and environment overlays
helm/              Helm chart packaging for deployable application components
terraform/         Cloud resources, cluster, and supporting infrastructure
security/          Security policies, scanning configuration, and reports/rules
monitoring/         Metrics, dashboards, alerting, and logging configuration
gitops/             GitOps application and environment configuration
.github/workflows/ CI, security, image publishing, and release workflows
docs/               Baseline, implementation plan, operations, and architecture docs
```

The final layout may retain additional directories where they provide clear value. Keep workspace boundaries, package ownership, and build contexts explicit; do not break `@rce/*` package resolution when moving code.

## Phase 1: Project Restructuring & Dockerization

**Goal:** Move the existing application into `application/` and produce reproducible, production-oriented container images from Dockerfiles in `docker/`.

### Work

- Inventory the current root npm workspace, applications, packages, Prisma schema, tests, local Compose services, and runner images. Record the before/after path mapping before moving files.
- The current `apps/` and `packages/` workspace content has been moved into `application/apps/` and `application/packages/`. Keep package boundaries and npm workspace behavior intact, and maintain the root workspace manifest/lockfile, TypeScript configuration, Prisma configuration, and tests after the move.
- Preserve the client, API, worker, database, queue, storage, and shared-types responsibilities. Keep `@rce/storage` and `@rce/queue` as explicit shared packages; do not fold their configuration into only one service.
- Review the `@rce/storage` S3-compatible configuration and the `@rce/queue` BullMQ/Redis configuration for environment-driven endpoints, bucket/queue behavior, startup and shutdown behavior, and clear operational errors. Keep local MinIO/Redis workflows supported.
- Add a shared production multi-stage `docker/Dockerfile` with independent client, API, and worker targets, and standardize the existing Python, JavaScript, and C++ runner images under `infrastructure/docker/runner-images/`. Use deterministic dependency installation, minimal runtime layers, non-root users where compatible, health-check support where appropriate, and no development dependencies in production images.
- Ensure the worker can safely access the Docker execution mechanism in the target runtime. Document the chosen isolation/runtime design and its security tradeoffs; do not assume mounting the host Docker socket into a general-purpose worker is safe.
- Add or update a local Compose workflow for building and running the services with PostgreSQL, Redis, MinIO, and runner images. Supply example non-secret configuration through an environment template and keep real credentials out of version control.
- Update root workspace commands, ignore rules, build contexts, and developer documentation to match the new structure.

### Exit criteria

- A clean checkout can install dependencies, generate the database client, run existing tests, and build each production image using documented commands.
- Local client/API/worker execution still follows the baseline lifecycle and can use local PostgreSQL, Redis, and MinIO.
- Image users, exposed ports, entrypoints, environment variables, and required runtime privileges are documented.

## Phase 2: Infrastructure as Code

**Goal:** Provision the selected cloud foundation and Kubernetes cluster through reviewable, reusable Terraform.

### Work

- Choose and document a cloud provider, region strategy, Kubernetes service, network topology, environment separation, and cost assumptions before writing provider-specific modules.
- Create Terraform root configurations in `terraform/` and reusable modules for networking, cluster/node pools, container registry, IAM/service identities, and required managed dependencies.
- Decide which stateful services are managed cloud services and which are deployed in-cluster. Define durable storage, backups, recovery objectives, encryption, and ownership for PostgreSQL, Redis, and S3-compatible object storage. Do not treat ephemeral pod storage as durable submission or database storage.
- Define least-privilege identities for CI, cluster workloads, image pulls, and GitOps deployment. Use workload identity or the provider's equivalent where available; avoid long-lived cloud keys.
- Parameterize environment-specific values, pin Terraform and provider versions, configure remote state with locking and encryption, and provide safe example variable files without credentials.
- Add `fmt`, `validate`, and plan checks, plus documented bootstrap, apply, change-review, and destroy procedures. Require explicit approval for production applies and destructive changes.

### Exit criteria

- Terraform formatting and validation pass from a clean checkout.
- Plans are reproducible and scoped to the intended environment; remote state and identity access follow documented security controls.
- The cluster, network, registry, and selected managed dependencies can be provisioned and torn down through documented procedures without embedding secrets in the repository.

## Phase 3: Kubernetes & Helm

**Goal:** Deploy the containerized application predictably with Kubernetes resources and package supported configuration in Helm.

### Work

- Create Kubernetes manifests under `kubernetes/` for API and worker Deployments, Services, ConfigMaps, Secrets references, Ingress, HPA, readiness/liveness/startup probes where appropriate, and storage/PVC resources only for components that require persistent volumes.
- Configure resource requests and limits, security contexts, non-root execution, read-only root filesystems where compatible, dropped capabilities, seccomp defaults, PodDisruptionBudgets, service accounts, and network policies. Treat the code-execution worker and runner workload as a separate trust boundary.
- Configure API and worker environment settings for PostgreSQL, Redis/BullMQ, S3-compatible storage, bucket names, and runner image references. Store secret values in the target secret-management system; commit only references or safe placeholders.
- Define scaling behavior intentionally: API scaling based on service load and worker scaling based on queue depth or a documented proxy metric. Set safe minimums, maximums, and concurrency so scaling does not overwhelm the database, Redis, storage, or execution capacity.
- Add environment overlays for non-production and production differences without duplicating common resource definitions.
- Package deployable resources in `helm/`, with documented values, validation, upgrade, rollback, and uninstall procedures. Ensure Helm and raw Kubernetes configuration cannot silently diverge; choose and document the source of truth.
- Include ingress TLS configuration, health endpoints, graceful termination periods, migrations strategy, and dependency startup behavior.

### Exit criteria

- Manifests render and validate; Helm lint/template checks pass for representative environments.
- API and worker become healthy, connect to their dependencies, and process an end-to-end submission using deployed services.
- Probes, rollout behavior, scaling limits, secrets handling, and persistent-data behavior are documented and exercised.

## Phase 4: DevSecOps & CI/CD Pipelines

**Goal:** Automate quality gates, security checks, image publication, and controlled release artifacts with GitHub Actions.

### Work

- Create least-privilege workflows under `.github/workflows/` for pull-request validation, tests, static analysis, dependency analysis, container builds, image scanning, and release/push to the selected registry.
- Run appropriate tests for the client, API, worker, queue, storage, and sandbox. Include focused tests for storage configuration and bucket operations, queue publication/consumption and lifecycle behavior, and API-to-worker integration where feasible.
- Add SAST, software composition analysis (SCA), secret scanning, and container/image vulnerability scanning. Define severity thresholds, failure policy, exception ownership, and expiration for accepted risks.
- Build immutable images tagged by commit SHA and release metadata; publish only from trusted branches/tags after required checks. Generate SBOMs, attach provenance/attestations where supported, and pin third-party actions by full commit SHA.
- Authenticate registry and cloud operations with GitHub OIDC and short-lived credentials when supported. Do not expose secrets to untrusted pull-request workflows or run privileged Docker builds on untrusted inputs.
- Separate CI build/test/image publication from deployment promotion. Store environment-specific deployment changes in the GitOps-controlled path rather than applying production changes directly from a general CI workflow.
- Add workflow concurrency, caching with safe keys, permissions minimization, artifact retention, and clear failure output.

### Exit criteria

- Pull requests receive required build, test, SAST, SCA, secret, and image-security results.
- Successful trusted builds publish immutable, traceable images to the registry with an SBOM and release identity.
- Workflow permissions and credentials are least-privilege and documented; no secrets or mutable-only image tags are required for deployment.

## Phase 5: Monitoring & GitOps

**Goal:** Make the system observable and deploy changes through a declarative GitOps reconciliation process.

### Work

- Configure `monitoring/` for centralized application and infrastructure logs, service metrics, dashboards, and actionable alerts. Include API availability/latency/error rate, queue depth and wait time, worker throughput/failures, execution timeout/OOM counts, database/Redis health, storage errors, pod restarts, and resource saturation.
- Define structured, correlation-friendly logs using submission/job identifiers while avoiding source-code, credentials, or unnecessary user data in logs. Set retention, access controls, and redaction expectations.
- Add service instrumentation and health/metrics endpoints as needed. Document metric names, alert severity, runbooks, and local validation.
- Configure `gitops/` with the selected reconciler (for example, Argo CD or Flux), declarative application/environment sources, and promotion strategy. Keep cluster state in version control and ensure drift is reconciled from reviewed Git changes.
- Set up image update/promotion flow that proposes reviewed GitOps changes to immutable image digests rather than applying ad hoc cluster mutations.
- Define access control, sync/prune behavior, secret integration, drift notifications, rollback/revert procedures, and separation between development, staging, and production environments.

### Exit criteria

- A test deployment produces useful logs and metrics, dashboards display service and queue health, and at least one actionable alert is validated.
- A reviewed Git change deploys through GitOps, reconciliation status is visible, and reverting the change restores the previous desired version.

## Phase 6: The Troubleshooting Challenge & Final Documentation

**Goal:** Demonstrate operational diagnosis and recovery, then make the final architecture and operating procedures reproducible for maintainers.

### Work

- Design a bounded, reversible troubleshooting exercise with intentional faults such as an incorrect ConfigMap value, unhealthy probe, invalid queue endpoint, or image-tag mismatch. Keep the exercise isolated from production and label the injection and recovery steps clearly.
- Do not introduce exploitable vulnerabilities, real credentials, destructive data loss, or hidden faults into the default branch. Store challenge-only changes in a dedicated branch, overlay, or explicit opt-in exercise that cannot be enabled accidentally.
- Write a challenge guide with symptoms, hypotheses, observability signals, safe diagnosis commands, expected root cause, remediation, and verification. Ensure participants can distinguish application, queue, storage, database, Kubernetes, and GitOps failure modes.
- Finalize the root `README.md` with the project purpose, current architecture diagram or flow, prerequisites, local setup, test/build commands, deployment overview, security model, environment configuration, and links to the baseline, implementation plan, runbooks, and troubleshooting challenge.
- Update `docs/baseline-architecture.md` to identify what has changed since the original baseline. Add operational, architecture, security, disaster recovery, and contribution documentation for the implemented system.
- Verify that all documentation reflects deployed behavior and that no planned capability is described as already implemented.

### Exit criteria

- A maintainer can follow the README from a clean checkout to a working local setup and can locate deployment and recovery procedures.
- The isolated challenge can be injected, diagnosed using documented signals, remediated, and verified without impacting shared or production environments.
- Architecture, infrastructure, configuration, and pipeline changes are documented as they are introduced.

## Cross-Phase Delivery Rules

- Execute phases in order; a later phase depends on the earlier phase's artifacts and exit criteria. Record decisions and blockers rather than silently assuming provider or tooling choices.
- Make small, reviewable changes. Keep local development usable throughout the migration and retain a tested rollback path for structural moves and infrastructure changes.
- Treat submitted code as hostile input. Reassess the sandbox boundary during every container, Kubernetes, and cloud design change.
- Never commit credentials, state files, private keys, generated secrets, or sensitive test submissions. Use secret-management integrations and safe examples.
- **CRITICAL: Any changes made to the architecture, infrastructure, configurations, or pipelines must be immediately recorded in the project documentation.**
- Update this plan and the root README as phases are completed, and record deviations from the target design with rationale.

## Completion Definition

The capstone is complete when all six phases meet their exit criteria, the end-to-end submission lifecycle works on the Kubernetes target, infrastructure and deployments are reproducible through Terraform and GitOps, CI/CD security gates publish traceable images, operational signals and recovery procedures are verified, and the repository documentation matches the implemented system.
