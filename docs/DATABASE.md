# Local PostgreSQL setup — Milestone 2

AF-004–006 are implemented and locally verified, pending human review. The explicit pg-boss declaration patch remains required. See `MILESTONE_2_VERIFICATION.md` for acceptance mapping, exact outputs, and limitations; `CORE_ENGINE_VERIFICATION.md` preserves earlier checkpoints and patch-removal instructions.

## Tested local dependencies

- Node.js 24.22.0; npm 11.9.0.
- PostgreSQL 18.6, Linux arm64 inside Docker Desktop on macOS arm64.
- `pg` 8.23.1, `pg-boss` 12.38.0, `node-pg-migrate` 9.0.0, `@types/pg` 8.23.1.
- Compose pins the PostgreSQL image digest. Runtime and declaration checks pass with the explicit patch below. These are not claims of full milestone acceptance.

## Install dependencies explicitly

Use Node.js 24.22.0 and npm 11.9.0:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run deps:patch
npm run test:deps
```

Repeat patch application after every clean installation. No installation lifecycle hook applies it. See `CORE_ENGINE_VERIFICATION.md` for provenance and removal criteria.

## Start the disposable local database

```bash
docker compose up -d --wait postgres
export FACTORY_MIGRATION_URL='postgres://af_migrator:synthetic-local-migration-only@127.0.0.1:55432/agentic_factory_local'
npm run db:migrate
npm run db:setup-local
npm run db:setup-queue
```

These public synthetic credentials are only for the loopback-bound development database. Do not reuse them elsewhere. No business or owner credentials are required. Compose uses the named `agentic-factory-local_database` volume and port 55432. Stop if that port or database name belongs to another installation; do not reset an existing database to make setup work. No container receives a Docker socket or host filesystem mount.

`db:migrate` uses node-pg-migrate's migration tracking and transaction/locking behavior. `001-workflow.cjs` creates the domain schema; repeat execution leaves an applied migration unchanged. The setup scripts separately create local synthetic memberships and explicitly initialize the pg-boss schema. Runtime queue configuration has `migrate: false`; workers must not use the migration URL. Runtime schema compatibility checks beyond those provided by pg-boss are not finished.

The local migration login is the container administrator. Runtime logins `af_app`, `af_other`, and `af_reader` have no superuser, BYPASSRLS, role creation, database creation, or schema creation permissions. The runtime password is `synthetic-local-runtime-only`. Memberships are keyed by the authenticated PostgreSQL `session_user`, organization, and project. Project identifiers supplied by a task cannot add membership. Domain RLS is forced; runtime roles cannot change membership records. `af_reader` can read its assigned project but cannot write through policy or approve through the service.

The queue is trusted coordinator infrastructure. Only `af_app` has its DML grants; it contains minimal workflow references. It is not a per-user public API or a tenant-accessible store. No real coding agent or target process receives any database credentials. Application-level approval transitions are enforced by the service, not a claim that arbitrary SQL using a runtime login cannot alter its authorized rows. RLS protects organization/project access, not a compromised coordinator within its granted scope.

## Verification commands

```bash
npm run test:compatibility
npm run test:state
npm run test:queue
npm run test:simulations
npm run lint
npm run typecheck
npm test
npm run build
```

`test:compatibility` uses dedicated `af_compatibility` and `af_checkpoint_queue` schemas in the disposable local database. It applies a test migration, verifies atomic application/queue commit and rollback, and checks non-privileged RLS and DDL denial. `test:state` and `test:queue` require the full TypeScript compilation first and the explicit dependency patch. `test:simulations` composes the same state store and queue with synthetic agent/job adapters for both profiles. There is no simulation CLI or real WorkItem intake command.

Tests use unique run identifiers and retain synthetic audit records. They do not truncate unrelated data. Run these suites sequentially against the dedicated synthetic database: one active coordinator is intentionally enforced. Recovery tests terminate their own child process/database session and move only their own synthetic queue timestamps to simulate due or expired work. One timeout test uses a 1.05-second PostgreSQL sleep. Simulation job time is injected and queue due times are advanced explicitly; identifiers and test durations vary, but scenario outcomes are fixed. Test cleanup cancels only the test's outstanding wakes; synthetic workflow/audit rows remain. Simulated external job journals are private temporary files removed after each successful test fixture cleanup.

The accepted schema and migrations are unchanged. No migration is needed for this increment beyond the existing `001-workflow` and pg-boss schema 46 setup above: the new workflow commands use the existing versioned JSON state and audit records. Do not run tests against a business or production database.

## Backup, shutdown, and migration recovery

```bash
docker compose exec -T postgres pg_dump -U af_migrator -d agentic_factory_local -Fc > /private/tmp/agentic-factory-local.dump
docker compose stop postgres
```

Stopping preserves the named volume. Automatic destructive down migrations are intentionally refused. Restore backups only to a separately authorized disposable database; do not overwrite an existing installation. A restore drill and failure-injected application migration test have not been performed in this milestone. Future migrations must be additive/reviewed; do not edit an already applied migration to conceal a schema mismatch. pg-boss owns its separate schema version (46 for 12.38.0); downgrading its package is not a database downgrade strategy.

## Required GitHub Actions checks

The hosted workflow now provisions a fresh PostgreSQL 18.6 service per job, with the pinned image digest and synthetic-only credentials. It runs the explicit dependency patch and check, lint, strict typecheck, unit tests/build, application migrations, restricted local-role setup, queue setup, compatibility tests, state/isolation tests, queue/recovery tests, and simulations. Required steps have no conditional skip or failure suppression. Database service health or setup failures fail the job.

The same setup and test sequence was verified locally on a fresh separate Compose project, `agentic-factory-review-ci`, leaving the original volume untouched. The hosted workflow itself has not been executed. See `MILESTONE_2_REVIEW_CORRECTIONS.md` for current results and the negative database-unavailable check.
