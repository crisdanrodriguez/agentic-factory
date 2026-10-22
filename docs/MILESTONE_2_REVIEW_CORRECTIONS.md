# Milestone 2 final review corrections — 2026-10-19

> Acceptance update (2026-10-21): AF-004–006 were accepted and merged in `2705aac`. The owner confirmed that GitHub Actions on main passed. The historical evidence and limitations below describe their original checkpoints; no hosted run URL or ID has been independently verified in this session.

## Scope and status

The four approved review findings are corrected within AF-004–006. The complete local suite passed on a fresh, isolated PostgreSQL database. Human review is pending. No AF-007 work, provider integration, real training, commit, push, merge, publication, or deployment occurred.

The original migrations, accepted pg-boss patch, dependency versions/lockfile, strict compiler settings, baseline configuration fixtures, and MIT LICENSE were preserved. Previously passing behavior remains covered. Historical verification reports retain earlier results and limitations; personal repository paths were normalized to `/path/to/agentic-factory` with an explicit note.

## Corrections and acceptance mapping

| Finding / acceptance requirement | Correction | Actual regression evidence |
|---|---|---|
| CI must run every required check and fail when unavailable | A pinned PostgreSQL service with synthetic credentials is provisioned per hosted job. Explicit patch verification, lint, typecheck, unit tests/build, migrations, restricted-role setup, queue setup, compatibility, state, queue/recovery, and simulation commands are mandatory sequential steps. No conditional skipping or failure suppression. | `review regression: CI provisions PostgreSQL and runs every mandatory check without skip or failure suppression`; fresh local database setup and every corresponding suite passed; database-unavailable and missing-migration-URL checks exited 1. Hosted Actions has not been run. |
| Organization/project isolation must extend to synthetic jobs | Each operation resolves scope from database-role membership and a persisted run whose evidence context matches. The installation-selected scope is not trusted without this database check. Job identity includes resolved organization/project scope; journal reads compare persisted scope before returning or mutating a record. | `review regression: database-authorized organizations cannot retrieve overwrite cancel or reconcile each other’s synthetic jobs` uses non-privileged `af_app` and `af_other`, identical owner/project/run/operation identifiers, and one shared journal directory. It proves distinct IDs, denied cross-scope inspection/cancellation/reconciliation, unchanged other-organization bytes, and denial of forged organization/project requests. Existing RLS and privilege tests also pass. |
| Delayed reconciliation must preserve logically completed synthetic jobs | The fake's persisted completion schedule wins only when completion occurs strictly before the deadline. Genuine deadline overruns fail. Terminal reconciliation is stable. This is exclusively a deterministic fake rule, not evidence for real external completion. | `review regression: completion before deadline survives late process restart and repeated reconciliation`; `review regression: genuine timeout remains failed after process restart and repeated reconciliation`. Both restart in another OS process after 301 seconds of injected time. Repeated inspection does not create more jobs; the completed record remains byte-identical. Existing bounded-timeout and restart scenarios pass. |
| Missing/invalid artifact metadata must not advance completion | New completion commands require unique `kind:identifier` references and coverage of every required deliverable kind. Valid metadata leaves verification unverified. No filesystem existence claim is made. | Six `review regression: artifact references reject ...` cases cover blank, whitespace, malformed, unknown kind, duplicate, and missing-kind-with-sufficient-count inputs; `review regression: valid artifact references cover all kinds without claiming physical verification`. Existing missing-artifact/evidence simulations pass. |

The original AF-004–006 acceptance-to-test mapping in `MILESTONE_2_VERIFICATION.md` still applies, supplemented by this table. The former 89-test result is preserved as a historical checkpoint; the current result is 100 tests.

## Files changed by this correction

- `.github/workflows/ci.yml`: isolated PostgreSQL service, explicit patch check, required setup/integration/simulation steps.
- `src/adapters/postgres/workflow-store.ts`: resolve authorized synthetic-job scope from runtime-role membership and stored context.
- `src/adapters/synthetic/execution.ts`: scope-bound identity/access and correct deterministic completion/deadline ordering.
- `src/runtime/simulation.ts`: bind the configured scope, enforce wake scope, and emit typed artifact-reference strings.
- `src/core/workflow.ts`: reference syntax, uniqueness, and deliverable-kind coverage checks.
- `tests/review-regressions.test.ts`, `tests/database/synthetic-isolation.test.ts`: new focused regressions.
- `tests/simulations/profiles.test.ts`: bound-scope composition and delayed-reconciliation regressions; existing scenarios retained.
- `tests/database/state.test.ts`, `tests/database/recovery.test.ts`, `tests/workflow-limits.test.ts`: valid references updated to the checked format; assertions retained.
- `package.json`: include the new database isolation regression in sequential state tests.
- README and architecture/security/database/backlog/verification documents: current behavior, evidence, limitations, and generic personal-path replacements.

The final Git diff/status also contains preserved earlier Milestone 2 work. The migrations and patch files already present in that status were not changed by this correction.

## Commands and results

Toolchain: Node.js 24.22.0, npm 11.9.0, TypeScript 5.9.3. Database: PostgreSQL 18.6, pinned image digest in Compose and CI. Local host: macOS arm64; PostgreSQL runs Linux arm64 in Docker Desktop.

The original database stayed stopped. `docker compose -p agentic-factory-review-ci ps -a` found no existing containers. `docker compose -p agentic-factory-review-ci up -d --wait postgres` created a fresh isolated container and `agentic-factory-review-ci_database` volume and exited 0. The normal `FACTORY_MIGRATION_URL` synthetic loopback value was provided only for approved setup. No existing application migration was edited.

| Command | Exit / result |
|---|---|
| `npm run deps:check` | 0; accepted patch checksum verified |
| `npm run test:deps` | 0; 7 passed |
| `npm run lint` | 0 |
| `npm run typecheck` | 0; strict, `skipLibCheck: false` |
| `npm test` | 0; 56 passed |
| `npm run build` | 0 |
| `npm run db:migrate` | 0; fresh `001-workflow` applied |
| `npm run db:setup-local` | 0; restricted roles/memberships installed |
| `npm run db:setup-queue` | 0; queue initialized with separate runtime DML grants |
| `npm run test:compatibility` | 0; all four compatibility assertions passed |
| `npm run test:state` | 0; 5 passed |
| `npm run test:queue` | 0; 8 passed |
| `npm run test:simulations` | 0; 24 passed |
| Built CLI validation of both original profiles | 0 each; configuration only, no execution |
| `git diff --check` | 0; no diagnostics |

**Total: 100 tests passed, zero failures, cancellations, skips, or TODOs in the final suite.** All 89 earlier tests remain, with 11 added regressions. The full database/integration/simulation sequence ran after the corrections on fresh database state.

Expected negative checks, separate from the passing suite:

- With PostgreSQL stopped, `npm run test:state` exited 1: 5 tests failed, 0 passed, 0 skipped; each failed with `connect ECONNREFUSED 127.0.0.1:55432`. The negative check was run twice with the same outcome. Required tests did not silently skip.
- `env -u FACTORY_MIGRATION_URL node scripts/migrate.mjs` exited 1 with `FACTORY_MIGRATION_URL is required; migrations never use runtime credentials.` No database mutation occurred.
- The personal-path scan returned no matches (`rg` exit 1 denotes no matches, not a failing test).

There were no unexpected failures in the complete correction suite. The isolated PostgreSQL container was stopped afterward (`docker compose -p agentic-factory-review-ci stop postgres`, exit 0). Both the original and new named database volumes are preserved. To repeat using the isolated volume, start that same project; do not start the default Compose project concurrently on port 55432.

## Installation and CI reproduction

Use the existing documented clean install sequence:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run deps:patch
npm run deps:check
```

No lifecycle hook is required. This correction did not reinstall or upgrade dependencies; the accepted earlier clean-install evidence remains historical. CI explicitly performs this sequence, then runs all commands above. See `DATABASE.md` for database setup and migration instructions. No new migration is required by these corrections.

## Limits and pending review

Hosted GitHub Actions has not been executed. The workflow and mandatory-step regression were checked locally, and the database initialization/test sequence passed against a fresh local instance; this is not a claim of a hosted CI result or amd64 validation.

The synthetic executor is trusted coordinator test infrastructure. Database-backed scope resolution protects its API from forged scope/context requests; it is not protection against arbitrary trusted code or direct filesystem/database credential access. Its short-lived test journal is not a production artifact store, a distributed transaction, or power-loss-safe storage. Older temporary journals without scope are rejected. Historical database audit records are not rewritten.

Only the fake knows its scheduled completion time. Real executors must obtain reliable completion evidence from their external systems before reporting completion after a deadline. Synthetic timing does not establish real cancellation, performance, or scientific validity.

Artifact references validate metadata and kind coverage only. Physical existence, contents, digests, storage authorization, and scientific meaning remain unverified until later ArtifactStore/verifier work. No AF-024 implementation is included.

The previous limitations remain: one active coordinator, one sequential profile step, no real providers/training, no operational intake/recovery CLI, no production resource isolation, and no disaster-recovery or backup-restore drill. Telegram remains the first prioritized optional future interface, not implemented here. Human approval is required before committing or starting another ticket.

## Exact final suite output

```text
$ npm run deps:check

> agentic-factory@0.0.0 deps:check
> node scripts/apply-dependency-patches.mjs --check

pg-boss 12.38.0 declaration patch verified (already applied).

Exit code: 0

$ npm run test:deps

> agentic-factory@0.0.0 test:deps
> node --test --test-reporter=spec tests/dependency-patch.test.mjs

✔ dependency patch applies cleanly and repeated application preserves identical bytes (13.607625ms)
✔ missing application fails check without modifying declarations (2.431959ms)
✔ rejects version mismatch without writing (1.698125ms)
✔ rejects metadata checksum mismatch without writing (1.727709ms)
✔ rejects declaration checksum mismatch without writing (1.977458ms)
✔ rejects missing or modified patch payload (1.63725ms)
✔ minimal pg-boss import compiles with unchanged strict project options (797.676167ms)
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 982.033375

Exit code: 0

$ npm run lint

> agentic-factory@0.0.0 lint
> eslint src tests --max-warnings=0


Exit code: 0

$ npm run typecheck

> agentic-factory@0.0.0 typecheck
> npm run deps:check && tsc --noEmit


> agentic-factory@0.0.0 deps:check
> node scripts/apply-dependency-patches.mjs --check

pg-boss 12.38.0 declaration patch verified (already applied).

Exit code: 0

$ npm test

> agentic-factory@0.0.0 test
> npm run deps:check && tsc --project tsconfig.test.json && node --test --test-reporter=spec .test-build/tests/*.test.js


> agentic-factory@0.0.0 deps:check
> node scripts/apply-dependency-patches.mjs --check

pg-boss 12.38.0 declaration patch verified (already applied).
✔ CLI help exits successfully without configuration or credentials (50.465709ms)
✔ CLI validates software-general without provider credentials (48.469042ms)
✔ CLI validates ml-research without provider credentials (48.861709ms)
✔ CLI rejects unknown commands, extra arguments, and missing files (182.185292ms)
✔ CLI rejects malformed or oversized input without disclosing content (138.344459ms)
✔ CLI rejects disabled policy and never executes configured commands (96.446083ms)
✔ software-general validates with local input and no external integration or deployment (4.759334ms)
✔ ml-research validates with local input and no external integration or deployment (0.60325ms)
✔ rejects disabling mandatory requirePlanApproval (0.336833ms)
✔ rejects disabling mandatory requireEvidence (0.20575ms)
✔ rejects removing a mandatory verification even when project lists agree (0.256042ms)
✔ rejects making a mandatory verification optional (0.243291ms)
✔ accepts stricter project limits and additional required checks (0.240458ms)
✔ rejects raising the global maxTechnicalAttempts limit (0.139959ms)
✔ rejects raising the global maxVariants limit (0.126084ms)
✔ rejects raising the global maxDurationSeconds limit (0.165917ms)
✔ rejects raising the global maxMemoryMb limit (0.118334ms)
✔ rejects raising the global maxArtifactBytes limit (0.096667ms)
✔ rejects missing capabilities with an actionable error (0.21675ms)
✔ rejects removing a profile capability requirement (0.143792ms)
✔ requested deployment requires an explicit compatible capability (0.1645ms)
✔ rejects missing required research protocol and deliverables (0.305875ms)
✔ rejects unknown keys, empty identity, and invalid policy revision (1.17625ms)
✔ rejects duplicate profile check identifiers (0.173208ms)
✔ cannot claim verification success with a missing required result (0.179541ms)
✔ cannot claim verification success after a failed required check (0.169208ms)
✔ cannot claim verification success after a missing required check (0.528458ms)
✔ cannot claim verification success after a skipped required check (0.116792ms)
✔ cannot claim verification success after a cancelled required check (0.119792ms)
✔ rejects passed status with no evidence references (0.119459ms)
✔ rejects fabricated results and duplicate check outcomes (0.206667ms)
✔ rejects evidence with stale or mismatched ownerId (0.149ms)
✔ rejects evidence with stale or mismatched projectId (0.105875ms)
✔ rejects evidence with stale or mismatched workItemId (0.095625ms)
✔ rejects evidence with stale or mismatched runId (0.090667ms)
✔ rejects evidence with stale or mismatched planRevision (0.089209ms)
✔ rejects evidence with stale or mismatched policyRevision (0.090792ms)
✔ rejects evidence with stale or mismatched sourceSnapshot (0.088166ms)
✔ rejects evidence with stale or mismatched environmentFingerprint (0.092917ms)
✔ rejects evidence with stale or mismatched protocolRevision (0.089875ms)
✔ rejects evidence with stale or mismatched datasetVersion (0.089875ms)
✔ rejects evidence with stale or mismatched splitVersion (0.089959ms)
✔ rejects evidence with stale or mismatched parametersDigest (0.089875ms)
✔ rejects an old context even if every result matches that old context (0.079292ms)
✔ evidence validation rechecks mandatory policy rather than trusting callers (0.0665ms)
✔ verification does not alter an unmet objective or pending human decision (0.100458ms)
✔ review regression: artifact references reject blank (4.481458ms)
✔ review regression: artifact references reject whitespace (0.5035ms)
✔ review regression: artifact references reject malformed (0.342875ms)
✔ review regression: artifact references reject unknown kind (0.249833ms)
✔ review regression: artifact references reject duplicate (0.316791ms)
✔ review regression: artifact references reject missing kind despite sufficient count (0.250791ms)
✔ review regression: valid artifact references cover all kinds without claiming physical verification (0.216292ms)
✔ review regression: CI provisions PostgreSQL and runs every mandatory check without skip or failure suppression (0.411958ms)
✔ AF-005 technical retries preserve variant identity and have an independent bound (4.369709ms)
✔ AF-005 explicit experimental iterations stop at their approved limit without metric-triggered repairs (1.931875ms)
ℹ tests 56
ℹ suites 0
ℹ pass 56
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 602.767375

Exit code: 0

$ npm run build

> agentic-factory@0.0.0 build
> npm run deps:check && tsc --project tsconfig.build.json


> agentic-factory@0.0.0 deps:check
> node scripts/apply-dependency-patches.mjs --check

pg-boss 12.38.0 declaration patch verified (already applied).

Exit code: 0

$ npm run db:migrate

> agentic-factory@0.0.0 db:migrate
> node scripts/migrate.mjs

> Migrating files:
> - 001-workflow
### MIGRATION 001-workflow (UP) ###

Exit code: 0

$ npm run db:setup-local

> agentic-factory@0.0.0 db:setup-local
> node scripts/setup-local-database.mjs

Synthetic local roles and memberships installed. No runtime role has DDL, superuser, or BYPASSRLS privileges.

Exit code: 0

$ npm run db:setup-queue

> agentic-factory@0.0.0 db:setup-queue
> node scripts/setup-local-queue.mjs

Queue schema migrated explicitly; runtime receives DML privileges only.

Exit code: 0

$ npm run test:compatibility

> agentic-factory@0.0.0 test:compatibility
> node scripts/check-database-compatibility.mjs

PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2) on aarch64-unknown-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit
PASS: node-pg-migrate applies and safely reruns the migration.
PASS: non-privileged application state and queue insertion commit atomically.
PASS: rollback removes both application state and queue insertion.
PASS: database RLS denies cross-organization reads/writes; runtime cannot perform DDL.

Exit code: 0

$ npm run test:state

> agentic-factory@0.0.0 test:state
> npm run deps:check && tsc --project tsconfig.test.json && node --test --test-concurrency=1 --test-reporter=spec .test-build/tests/database/state.test.js .test-build/tests/database/synthetic-isolation.test.js


> agentic-factory@0.0.0 deps:check
> node scripts/apply-dependency-patches.mjs --check

pg-boss 12.38.0 declaration patch verified (already applied).
✔ AF-004 persists scoped workflows, revisions, approvals, evidence, and restart recovery (80.064917ms)
✔ AF-004 enforces RLS and separate migration privileges under real non-privileged logins (38.289833ms)
✔ AF-004 transaction failure rolls back state, audit and deduplication records (12.298458ms)
✔ AF-004 allows only one competing state transition and preserves cancellation on reconnect (20.067209ms)
✔ review regression: database-authorized organizations cannot retrieve overwrite cancel or reconcile each other’s synthetic jobs (38.544125ms)
ℹ tests 5
ℹ suites 0
ℹ pass 5
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 326.82225

Exit code: 0

$ npm run test:queue

> agentic-factory@0.0.0 test:queue
> npm run deps:check && tsc --project tsconfig.test.json && node --test --test-concurrency=1 --test-reporter=spec .test-build/tests/database/queue.test.js .test-build/tests/database/recovery.test.js


> agentic-factory@0.0.0 deps:check
> node scripts/apply-dependency-patches.mjs --check

pg-boss 12.38.0 declaration patch verified (already applied).
✔ AF-005 atomic state/queue commit, rollback, duplicate event and stale attempt fencing (79.85675ms)
✔ AF-005 one coordinator, released ownership, and bounded infrastructure retries (35.587958ms)
✔ AF-005 repair budgets, approval waits, and cancellation are independent of experimentation (0.966625ms)
✔ AF-005 process crash recovers durable queued work and expired claims; old attempt cannot commit (204.401417ms)
✔ AF-005 cancellation fences late completion and duplicate wakes across reconnect (107.710083ms)
✔ AF-005 approval and external-job waits release processing; reconciliation remains durable (97.036792ms)
✔ AF-005 coordinator session loss rolls back state and queue settlement (49.941125ms)
✔ AF-005 lease expiry during a transaction rolls back its authoritative results (1115.896709ms)
ℹ tests 8
ℹ suites 0
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1863.54125

Exit code: 0

$ npm run test:simulations

> agentic-factory@0.0.0 test:simulations
> npm run deps:check && tsc --project tsconfig.test.json && node --test --test-concurrency=1 --test-reporter=spec .test-build/tests/simulations/*.test.js


> agentic-factory@0.0.0 deps:check
> node scripts/apply-dependency-patches.mjs --check

pg-boss 12.38.0 declaration patch verified (already applied).
✔ AF-006 software-general: synthetic success preserves approval, verification, objective and human decision (130.925291ms)
✔ AF-006 software-general: synthetic repairable failure recovers within technical budget (109.096083ms)
✔ AF-006 software-general: synthetic exhausted attempts stop permanently (97.730459ms)
✔ AF-006 software-general: synthetic cancellation stops persisted job and rejects late completion (98.836208ms)
✔ AF-006 software-general: synthetic approval changes invalidate old decisions and evidence (93.652125ms)
✔ AF-006 software-general: synthetic duplicate events and wakes do not duplicate jobs (106.890083ms)
✔ AF-006 software-general: synthetic process restart reconciles recorded job without resubmission (258.690667ms)
✔ AF-006 ml-research: synthetic success preserves approval, verification, objective and human decision (104.518334ms)
✔ AF-006 ml-research: synthetic repairable failure recovers within technical budget (113.304041ms)
✔ AF-006 ml-research: synthetic exhausted attempts stop permanently (99.526333ms)
✔ AF-006 ml-research: synthetic cancellation stops persisted job and rejects late completion (88.282334ms)
✔ AF-006 ml-research: synthetic approval changes invalidate old decisions and evidence (99.451583ms)
✔ AF-006 ml-research: synthetic duplicate events and wakes do not duplicate jobs (95.661375ms)
✔ AF-006 ml-research: synthetic process restart reconciles recorded job without resubmission (266.778791ms)
✔ AF-006 synthetic submission before state commit is reconciled idempotently after restart (256.385917ms)
✔ AF-006 synthetic cancellation reconciles submission whose state commit was lost (81.874125ms)
✔ AF-006 synthetic unfavorable ML performance remains unmet without automatic repair or search (86.571084ms)
✔ AF-006 synthetic external-job timeout consumes bounded technical attempts, not experimental variants (130.315625ms)
✔ AF-006 synthetic missingArtifacts cannot claim verified success (64.076875ms)
✔ AF-006 synthetic missingVerification cannot claim verified success (84.531833ms)
✔ AF-006 synthetic journal rejects another project context and invalid paths (69.378291ms)
✔ AF-006 synthetic research variants are explicit, bounded, and retained in audit history (172.889ms)
✔ review regression: completion before deadline survives late process restart and repeated reconciliation (268.934791ms)
✔ review regression: genuine timeout remains failed after process restart and repeated reconciliation (231.845583ms)
ℹ tests 24
ℹ suites 0
ℹ pass 24
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3295.6685

Exit code: 0

```

## Final Git diff and status

This snapshot includes preserved earlier work. The tracked diff summary does not include untracked file contents.

```text
$ git diff --stat
 .github/workflows/ci.yml       |  26 ++
 README.md                      |  13 +-
 docs/ARCHITECTURE.md           |  37 ++-
 docs/BACKLOG.md                |  52 ++--
 docs/BOOTSTRAP_VERIFICATION.md |  10 +-
 docs/GETTING_STARTED.md        |   6 +-
 docs/MASTER_PLAN.md            |   2 +-
 docs/SECURITY.md               |  25 +-
 package-lock.json              | 535 ++++++++++++++++++++++++++++++++++++++++-
 package.json                   |  29 ++-
 10 files changed, 681 insertions(+), 54 deletions(-)
Exit code: 0
```

```text
$ git status --short
 M .github/workflows/ci.yml
 M README.md
 M docs/ARCHITECTURE.md
 M docs/BACKLOG.md
 M docs/BOOTSTRAP_VERIFICATION.md
 M docs/GETTING_STARTED.md
 M docs/MASTER_PLAN.md
 M docs/SECURITY.md
 M package-lock.json
 M package.json
?? compose.yaml
?? docs/CORE_ENGINE_VERIFICATION.md
?? docs/DATABASE.md
?? docs/MILESTONE_2_REVIEW_CORRECTIONS.md
?? docs/MILESTONE_2_VERIFICATION.md
?? migrations/
?? patches/
?? scripts/
?? src/adapters/pg-boss-queue.ts
?? src/adapters/postgres/
?? src/adapters/synthetic/
?? src/core/workflow.ts
?? src/ports/workflow-store.ts
?? src/runtime/simulation.ts
?? tests/database/
?? tests/dependency-patch.test.mjs
?? tests/review-regressions.test.ts
?? tests/simulations/
?? tests/workflow-limits.test.ts
Exit code: 0
```

```text
$ git ls-files --others --exclude-standard
compose.yaml
docs/CORE_ENGINE_VERIFICATION.md
docs/DATABASE.md
docs/MILESTONE_2_REVIEW_CORRECTIONS.md
docs/MILESTONE_2_VERIFICATION.md
migrations/001-workflow.cjs
patches/pg-boss/12.38.0.types.d.ts
scripts/apply-dependency-patches.mjs
scripts/check-database-compatibility.mjs
scripts/migrate.mjs
scripts/setup-local-database.mjs
scripts/setup-local-queue.mjs
src/adapters/pg-boss-queue.ts
src/adapters/postgres/workflow-store.ts
src/adapters/synthetic/execution.ts
src/core/workflow.ts
src/ports/workflow-store.ts
src/runtime/simulation.ts
tests/database/migrations/001-compatibility.cjs
tests/database/queue.test.ts
tests/database/recovery.test.ts
tests/database/state.test.ts
tests/database/synthetic-isolation.test.ts
tests/dependency-patch.test.mjs
tests/review-regressions.test.ts
tests/simulations/profiles.test.ts
tests/workflow-limits.test.ts
Exit code: 0
```

