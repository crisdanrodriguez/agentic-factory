# Historical core-engine checkpoints and dependency correction

Current AF-004–006 implementation, acceptance mapping, and final results are in [`MILESTONE_2_VERIFICATION.md`](MILESTONE_2_VERIFICATION.md). The records below preserve earlier limitations and failures as historical evidence. The dependency patch maintenance/removal instructions remain applicable.


Personal repository paths in historical output are normalized to `/path/to/agentic-factory`; diagnostics and results are otherwise preserved.

## Approved dependency correction — 2026-10-18

The pg-boss 12.38.0 declaration defect is resolved locally by the approved declaration-only patch. Strict TypeScript checking remains enabled with `skipLibCheck: false`. Minimal import, full project, build, bootstrap, dependency, PostgreSQL compatibility, state, and queue checks pass. AF-005 remains subject to human review; AF-006 has not started. No runtime JavaScript, application code, schema, migration, dependency version, or lockfile was changed by this correction. Earlier working-tree changes remain preserved.

The patch restores only the exact `CompatibilityFlags` and `ResolvedConstructorOptions` interface definitions from [upstream commit 2c1005b](https://github.com/timgit/pg-boss/blob/2c1005b744952360e999c2000e155a1bfebb8951/src/types.ts). Upstream `stripInternal: true` removed these internal interfaces while emitted declarations retained references to them. Attribution and the upstream MIT notice accompany the payload in `patches/pg-boss/12.38.0.types.d.ts`; the repository LICENSE is unchanged.

### Installation and maintenance

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run deps:patch
npm run deps:check
npm run test:deps
```

Patch application is explicit in local instructions and GitHub Actions, with no postinstall or other lifecycle hook. Compilation scripts check application and fail with the recovery command when it is missing. The script validates the exact package name/version and fixed SHA-256 hashes for package metadata, target declarations, payload, and patched result. It refuses unknown contents; repeated application preserves identical bytes. Registry package integrity remains enforced by the lockfile and npm ci. The script verifies the files relevant to this correction, not every runtime file in node_modules.

Remove this workaround only after reviewing an upstream release with self-consistent declarations and confirming the required queue API and PostgreSQL schema compatibility. In a separately approved upgrade, pin the corrected version and update the lockfile; prove the minimal import and full strict compilation pass on an unpatched clean install. Then remove the payload, patch script, patch-specific tests, npm patch/check commands and guards, CI patch/test steps, and installation instructions. Preserve a minimal-import regression check and rerun bootstrap, build, compatibility, state, and queue suites. Never merely replace checksums to accept an unknown release. Package/schema upgrades and migration changes require their own review.

### Results and limitations

Tested Node.js 24.22.0, npm 11.9.0, TypeScript 5.9.3 and the pinned local PostgreSQL 18.6 stack. A clean installation used the same documented options plus `--cache /private/tmp/af-npm-cache --offline`: exit 0, `added 142 packages in 2s`. This validates clean installation from the existing integrity-checked cache, not a fresh online download. The pre-patch check intentionally exited 1; both patch applications and the subsequent check exited 0.

Seven dependency tests passed, including the minimal import; 46 bootstrap tests passed; four state tests passed; three queue tests passed. Lint, full strict typecheck, build and all four compatibility assertions passed. No remaining AF-005 runtime or integration failure was observed in these existing suites. These results do not establish full AF-005 acceptance or AF-006 simulations, process-kill recovery, a restore drill, or real-provider behavior.

The first database attempts failed with sandbox `connect EPERM 127.0.0.1:55432`; the approved network-access retry passed. The local database was started using the existing Compose configuration and preserved volume. No domain migrations or setup scripts were edited or run; the compatibility suite reran its existing dedicated test migration. GitHub Actions was updated within its existing read-only, hosted-runner restrictions, but hosted CI was not executed. No credentials, publication, commit, push, merge, deployment, or external service provisioning occurred.

The database was stopped afterward with `docker compose stop postgres` (exit 0); its named volume was preserved. Additional checks: `npx --no-install eslint scripts/apply-dependency-patches.mjs tests/dependency-patch.test.mjs --max-warnings=0` and `git diff --check` both exited 0 with no diagnostics. Both built CLI fixture validations exited 0, reporting `Valid configuration: software-general.` and `Valid configuration: ml-research.`, respectively, followed by `Contract validation only; no work executed or providers verified.`

### Exact local verification output

```text
$ npm --version
11.9.0
Exit code: 0

$ npm run deps:check

> agentic-factory@0.0.0 deps:check
> node scripts/apply-dependency-patches.mjs --check

Dependency patch failed: pg-boss declaration patch is missing. Run npm run deps:patch after npm ci --ignore-scripts.
Exit code: 1

$ npm run deps:patch

> agentic-factory@0.0.0 deps:patch
> node scripts/apply-dependency-patches.mjs

pg-boss 12.38.0 declaration patch applied and checksum verified.
Exit code: 0

$ npm run deps:patch

> agentic-factory@0.0.0 deps:patch
> node scripts/apply-dependency-patches.mjs

pg-boss 12.38.0 declaration patch verified (already applied).
Exit code: 0

$ npm run deps:check

> agentic-factory@0.0.0 deps:check
> node scripts/apply-dependency-patches.mjs --check

pg-boss 12.38.0 declaration patch verified (already applied).
Exit code: 0

$ npm run test:deps

> agentic-factory@0.0.0 test:deps
> node --test --test-reporter=spec tests/dependency-patch.test.mjs

✔ dependency patch applies cleanly and repeated application preserves identical bytes (11.560333ms)
✔ missing application fails check without modifying declarations (2.751541ms)
✔ rejects version mismatch without writing (2.251875ms)
✔ rejects metadata checksum mismatch without writing (2.009583ms)
✔ rejects declaration checksum mismatch without writing (2.312291ms)
✔ rejects missing or modified patch payload (1.833ms)
✔ minimal pg-boss import compiles with unchanged strict project options (835.041792ms)
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1015.13225
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
✔ CLI help exits successfully without configuration or credentials (51.011125ms)
✔ CLI validates software-general without provider credentials (53.405334ms)
✔ CLI validates ml-research without provider credentials (53.626875ms)
✔ CLI rejects unknown commands, extra arguments, and missing files (193.370625ms)
✔ CLI rejects malformed or oversized input without disclosing content (152.38625ms)
✔ CLI rejects disabled policy and never executes configured commands (106.857875ms)
✔ software-general validates with local input and no external integration or deployment (5.036875ms)
✔ ml-research validates with local input and no external integration or deployment (0.802875ms)
✔ rejects disabling mandatory requirePlanApproval (0.334584ms)
✔ rejects disabling mandatory requireEvidence (0.190125ms)
✔ rejects removing a mandatory verification even when project lists agree (0.245834ms)
✔ rejects making a mandatory verification optional (0.225625ms)
✔ accepts stricter project limits and additional required checks (0.25175ms)
✔ rejects raising the global maxTechnicalAttempts limit (0.132041ms)
✔ rejects raising the global maxVariants limit (0.116541ms)
✔ rejects raising the global maxDurationSeconds limit (0.217542ms)
✔ rejects raising the global maxMemoryMb limit (0.126375ms)
✔ rejects raising the global maxArtifactBytes limit (0.101917ms)
✔ rejects missing capabilities with an actionable error (0.209125ms)
✔ rejects removing a profile capability requirement (0.141416ms)
✔ requested deployment requires an explicit compatible capability (0.20625ms)
✔ rejects missing required research protocol and deliverables (0.451709ms)
✔ rejects unknown keys, empty identity, and invalid policy revision (1.163792ms)
✔ rejects duplicate profile check identifiers (0.260083ms)
✔ cannot claim verification success with a missing required result (0.210875ms)
✔ cannot claim verification success after a failed required check (0.866ms)
✔ cannot claim verification success after a missing required check (0.215209ms)
✔ cannot claim verification success after a skipped required check (0.162666ms)
✔ cannot claim verification success after a cancelled required check (0.118917ms)
✔ rejects passed status with no evidence references (0.126791ms)
✔ rejects fabricated results and duplicate check outcomes (0.196083ms)
✔ rejects evidence with stale or mismatched ownerId (0.155917ms)
✔ rejects evidence with stale or mismatched projectId (0.112208ms)
✔ rejects evidence with stale or mismatched workItemId (0.102375ms)
✔ rejects evidence with stale or mismatched runId (0.1065ms)
✔ rejects evidence with stale or mismatched planRevision (0.098958ms)
✔ rejects evidence with stale or mismatched policyRevision (0.096417ms)
✔ rejects evidence with stale or mismatched sourceSnapshot (0.096959ms)
✔ rejects evidence with stale or mismatched environmentFingerprint (0.097ms)
✔ rejects evidence with stale or mismatched protocolRevision (0.093125ms)
✔ rejects evidence with stale or mismatched datasetVersion (0.107167ms)
✔ rejects evidence with stale or mismatched splitVersion (0.117875ms)
✔ rejects evidence with stale or mismatched parametersDigest (0.106083ms)
✔ rejects an old context even if every result matches that old context (0.09875ms)
✔ evidence validation rechecks mandatory policy rather than trusting callers (0.071583ms)
✔ verification does not alter an unmet objective or pending human decision (0.108375ms)
ℹ tests 46
ℹ suites 0
ℹ pass 46
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 647.754209
Exit code: 0

$ npm run build

> agentic-factory@0.0.0 build
> npm run deps:check && tsc --project tsconfig.build.json


> agentic-factory@0.0.0 deps:check
> node scripts/apply-dependency-patches.mjs --check

pg-boss 12.38.0 declaration patch verified (already applied).
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
> npm run deps:check && tsc --project tsconfig.test.json && node --test --test-reporter=spec .test-build/tests/database/state.test.js


> agentic-factory@0.0.0 deps:check
> node scripts/apply-dependency-patches.mjs --check

pg-boss 12.38.0 declaration patch verified (already applied).
✔ AF-004 persists scoped workflows, revisions, approvals, evidence, and restart recovery (69.671834ms)
✔ AF-004 enforces RLS and separate migration privileges under real non-privileged logins (39.035125ms)
✔ AF-004 transaction failure rolls back state, audit and deduplication records (11.767292ms)
✔ AF-004 allows only one competing state transition and preserves cancellation on reconnect (22.064875ms)
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 231.389792
Exit code: 0

$ npm run test:queue

> agentic-factory@0.0.0 test:queue
> npm run deps:check && tsc --project tsconfig.test.json && node --test --test-reporter=spec .test-build/tests/database/queue.test.js


> agentic-factory@0.0.0 deps:check
> node scripts/apply-dependency-patches.mjs --check

pg-boss 12.38.0 declaration patch verified (already applied).
✔ AF-005 atomic state/queue commit, rollback, duplicate event and stale attempt fencing (90.7525ms)
✔ AF-005 one coordinator, released ownership, and bounded infrastructure retries (39.077292ms)
✔ AF-005 repair budgets, approval waits, and cancellation are independent of experimentation (0.968375ms)
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 222.188667
Exit code: 0

```

## Historical checkpoint report (before the approved correction)

The following record is preserved as historical evidence; its blocked status and no-patch statements describe the earlier checkpoint, not the corrected working tree above.


## Status and stop condition

AF-001–003 were accepted and merged in `4a0ce53`. This session is on `feat/af-004-006-core`. No commit, push, merge, publication, deployment, Telegram/provider integration, real training, or AF-007 work was performed.

The implementation stopped at AF-005 because the selected queue dependency does not pass the existing strict TypeScript checks. No architecture replacement, library patch, `skipLibCheck`, suppression, or test bypass was introduced. AF-006 has not started. Human review is required before resolving the dependency blocker and resuming.

## Critical dependency checkpoint

Node.js 24.22.0 / npm 11.9.0; PostgreSQL 18.6; pg 8.23.1; pg-boss 12.38.0; node-pg-migrate 9.0.0. PostgreSQL is local, loopback-bound, synthetic-only. The exact image digest is in `compose.yaml`.

The runtime checkpoint passed before domain implementation:

```text
PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2) on aarch64-unknown-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit
PASS: node-pg-migrate applies and safely reruns the migration.
PASS: non-privileged application state and queue insertion commit atomically.
PASS: rollback removes both application state and queue insertion.
PASS: database RLS denies cross-organization reads/writes; runtime cannot perform DDL.
```

Command: `node scripts/check-database-compatibility.mjs`, exit 0. Sandbox restrictions initially denied registry DNS, Docker access, and loopback networking; approved retries succeeded. A PostgreSQL 18.3 image was initially downloaded, but all database tests used 18.6. No system runtime was replaced.

This initial checkpoint validated JavaScript runtime behavior but missed declaration-file compatibility. That omission was exposed when AF-005 imported pg-boss from TypeScript. Future dependency checkpoints must include a TypeScript import under the project's unchanged compiler settings before domain work proceeds.

## AF-004 checkpoint

Implemented a pure transition function, transactional PostgreSQL run store, immutable revision history, scoped audit/receipt records, and database-role-backed membership checks. Run JSON stores the versioned configuration, current step counters, job identity, evidence, artifact references, approval, cancellation request, and four distinct outcome fields. The model currently represents one sequential profile step; generalized subtask scheduling is not implemented.

`npm run db:migrate` applied `001-workflow`, exit 0. `npm run db:setup-local` created synthetic memberships and restricted runtime grants, exit 0. At this checkpoint, typecheck and lint exited 0 and the unchanged 46 bootstrap tests passed.

The state suite used non-privileged database logins. It verified commit/rollback, duplicate request identity, competing version updates, evidence/revision invalidation, no-deployment completion, and reconnect recovery. It did not yet prove process-kill or database-restart recovery; those were planned for AF-006. No scientific truth or real resource-limit enforcement is claimed.

## AF-005 blocker

Exact AF-004 test output before the AF-005 import was introduced (`npm run test:state`, exit 0):

```text
✔ AF-004 persists scoped workflows, revisions, approvals, evidence, and restart recovery (87.134792ms)
✔ AF-004 enforces RLS and separate migration privileges under real non-privileged logins (43.628458ms)
✔ AF-004 transaction failure rolls back state, audit and deduplication records (13.11075ms)
✔ AF-004 allows only one competing state transition and preserves cancellation on reconnect (21.207167ms)
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 263.299167
```

The draft queue adapter uses pg-boss claim/retry/expiry APIs, transactional completion with state mutation, workflow version checks, and one advisory lock for the initial coordinator. It does not introduce an additional lease table. Queue schema initialization succeeded with a separate migration login.

The published declarations for both pg-boss 12.38.0 and 12.37.1 reference `types.ResolvedConstructorOptions`, which is not exported. TypeScript reports TS2724 in `manager.d.ts`, `notifier.d.ts`, and `timekeeper.d.ts`. The earlier release also uses a different queue schema version; it was inspected/typechecked only, never run against or used to downgrade the migrated queue. The package was restored to 12.38.0, the runtime-tested version, using the local cache.

AF-005 acceptance tests have not executed: compilation fails first. The draft queue implementation is unverified, including single-worker behavior, lease expiry, stale-attempt settlement, retries, and queue-driven cancellation. It must not be treated as completed. The complete working tree currently fails typecheck/build/test compilation even though AF-004 passed earlier.

## Limits and next decision

At handoff, the task's PostgreSQL container was stopped with `docker compose stop postgres` (exit 0). Its named volume was preserved. The JavaScript compatibility checkpoint was rerun after restoring pg-boss 12.38.0 and again passed all four checks (exit 0).

The final `git diff --check` exited 0 after removing trailing whitespace from the two edited status lines. The earlier whitespace failure remains in the transcript for accuracy. A preservation diff confirmed no changes to LICENSE, AGENTS.md, CI, the two bootstrap test files, or either bootstrap fixture. Final tracked diff: 9 files changed, 586 insertions, 29 deletions; additionally 15 new untracked files contain the database setup, migrations, domain/store implementation, draft queue adapter, tests, and reports.

Preserve the accepted bootstrap, MIT license, strict compiler settings, and scoped CI restrictions. No CI change has been made in this blocked session; hosted CI has not been run. No complete simulation, migration rollback drill, restart process test, or real execution has been claimed.

The owner must review the dependency failure before continuation. A future resolution should demonstrate strict TypeScript compatibility and repeat atomic rollback/isolation checks, then finish AF-005 before starting AF-006. No substantially different queue architecture is authorized by this report.

Database setup, role boundaries, migration commands, backup/shutdown instructions, and current command limitations are in `DATABASE.md`. Local container storage contains only synthetic test data. Dependency/image downloads used public registries; there were no model/provider calls or paid service provisioning. Cost/usage beyond these local operations was not measured.

## Exact final working-tree checks

Commands used the pinned temporary Node binary via `PATH=/private/tmp/af-node-bin:$PATH`. No database test is counted as passing when its compilation failed.

```text
$ node --version
v24.22.0
```

Exit code: 0.

```text
$ npm --version
11.9.0
```

Exit code: 0.

```text
$ npm ls --depth=0
agentic-factory@0.0.0 /path/to/agentic-factory
├── @types/node@24.19.2
├── @types/pg@8.23.1
├── eslint@10.13.0
├── node-pg-migrate@9.0.0
├── pg-boss@12.38.0
├── pg@8.23.1
├── typescript-eslint@8.71.2
├── typescript@5.9.3
└── zod@4.6.7

```

Exit code: 0.

```text
$ npm run lint

> agentic-factory@0.0.0 lint
> eslint src tests --max-warnings=0

```

Exit code: 0.

```text
$ npm run typecheck

> agentic-factory@0.0.0 typecheck
> tsc --noEmit

node_modules/pg-boss/dist/manager.d.ts(18,19): error TS2724: '"/path/to/agentic-factory/node_modules/pg-boss/dist/types"' has no exported member named 'ResolvedConstructorOptions'. Did you mean 'ConstructorOptions'?
node_modules/pg-boss/dist/manager.d.ts(28,52): error TS2724: '"/path/to/agentic-factory/node_modules/pg-boss/dist/types"' has no exported member named 'ResolvedConstructorOptions'. Did you mean 'ConstructorOptions'?
node_modules/pg-boss/dist/notifier.d.ts(10,70): error TS2724: '"/path/to/agentic-factory/node_modules/pg-boss/dist/types"' has no exported member named 'ResolvedConstructorOptions'. Did you mean 'ConstructorOptions'?
node_modules/pg-boss/dist/timekeeper.d.ts(11,19): error TS2724: '"/path/to/agentic-factory/node_modules/pg-boss/dist/types"' has no exported member named 'ResolvedConstructorOptions'. Did you mean 'ConstructorOptions'?
node_modules/pg-boss/dist/timekeeper.d.ts(25,70): error TS2724: '"/path/to/agentic-factory/node_modules/pg-boss/dist/types"' has no exported member named 'ResolvedConstructorOptions'. Did you mean 'ConstructorOptions'?
```

Exit code: 2.

```text
$ npm test

> agentic-factory@0.0.0 test
> tsc --project tsconfig.test.json && node --test --test-reporter=spec .test-build/tests/*.test.js

node_modules/pg-boss/dist/manager.d.ts(18,19): error TS2724: '"/path/to/agentic-factory/node_modules/pg-boss/dist/types"' has no exported member named 'ResolvedConstructorOptions'. Did you mean 'ConstructorOptions'?
node_modules/pg-boss/dist/manager.d.ts(28,52): error TS2724: '"/path/to/agentic-factory/node_modules/pg-boss/dist/types"' has no exported member named 'ResolvedConstructorOptions'. Did you mean 'ConstructorOptions'?
node_modules/pg-boss/dist/notifier.d.ts(10,70): error TS2724: '"/path/to/agentic-factory/node_modules/pg-boss/dist/types"' has no exported member named 'ResolvedConstructorOptions'. Did you mean 'ConstructorOptions'?
node_modules/pg-boss/dist/timekeeper.d.ts(11,19): error TS2724: '"/path/to/agentic-factory/node_modules/pg-boss/dist/types"' has no exported member named 'ResolvedConstructorOptions'. Did you mean 'ConstructorOptions'?
node_modules/pg-boss/dist/timekeeper.d.ts(25,70): error TS2724: '"/path/to/agentic-factory/node_modules/pg-boss/dist/types"' has no exported member named 'ResolvedConstructorOptions'. Did you mean 'ConstructorOptions'?
```

Exit code: 2.

```text
$ npm run build

> agentic-factory@0.0.0 build
> tsc --project tsconfig.build.json

node_modules/pg-boss/dist/manager.d.ts(18,19): error TS2724: '"/path/to/agentic-factory/node_modules/pg-boss/dist/types"' has no exported member named 'ResolvedConstructorOptions'. Did you mean 'ConstructorOptions'?
node_modules/pg-boss/dist/manager.d.ts(28,52): error TS2724: '"/path/to/agentic-factory/node_modules/pg-boss/dist/types"' has no exported member named 'ResolvedConstructorOptions'. Did you mean 'ConstructorOptions'?
node_modules/pg-boss/dist/notifier.d.ts(10,70): error TS2724: '"/path/to/agentic-factory/node_modules/pg-boss/dist/types"' has no exported member named 'ResolvedConstructorOptions'. Did you mean 'ConstructorOptions'?
node_modules/pg-boss/dist/timekeeper.d.ts(11,19): error TS2724: '"/path/to/agentic-factory/node_modules/pg-boss/dist/types"' has no exported member named 'ResolvedConstructorOptions'. Did you mean 'ConstructorOptions'?
node_modules/pg-boss/dist/timekeeper.d.ts(25,70): error TS2724: '"/path/to/agentic-factory/node_modules/pg-boss/dist/types"' has no exported member named 'ResolvedConstructorOptions'. Did you mean 'ConstructorOptions'?
```

Exit code: 2.

```text
$ npm run test:state

> agentic-factory@0.0.0 test:state
> tsc --project tsconfig.test.json && node --test --test-reporter=spec .test-build/tests/database/state.test.js

node_modules/pg-boss/dist/manager.d.ts(18,19): error TS2724: '"/path/to/agentic-factory/node_modules/pg-boss/dist/types"' has no exported member named 'ResolvedConstructorOptions'. Did you mean 'ConstructorOptions'?
node_modules/pg-boss/dist/manager.d.ts(28,52): error TS2724: '"/path/to/agentic-factory/node_modules/pg-boss/dist/types"' has no exported member named 'ResolvedConstructorOptions'. Did you mean 'ConstructorOptions'?
node_modules/pg-boss/dist/notifier.d.ts(10,70): error TS2724: '"/path/to/agentic-factory/node_modules/pg-boss/dist/types"' has no exported member named 'ResolvedConstructorOptions'. Did you mean 'ConstructorOptions'?
node_modules/pg-boss/dist/timekeeper.d.ts(11,19): error TS2724: '"/path/to/agentic-factory/node_modules/pg-boss/dist/types"' has no exported member named 'ResolvedConstructorOptions'. Did you mean 'ConstructorOptions'?
node_modules/pg-boss/dist/timekeeper.d.ts(25,70): error TS2724: '"/path/to/agentic-factory/node_modules/pg-boss/dist/types"' has no exported member named 'ResolvedConstructorOptions'. Did you mean 'ConstructorOptions'?
```

Exit code: 2.

```text
$ npm run test:queue

> agentic-factory@0.0.0 test:queue
> tsc --project tsconfig.test.json && node --test --test-reporter=spec .test-build/tests/database/queue.test.js

node_modules/pg-boss/dist/manager.d.ts(18,19): error TS2724: '"/path/to/agentic-factory/node_modules/pg-boss/dist/types"' has no exported member named 'ResolvedConstructorOptions'. Did you mean 'ConstructorOptions'?
node_modules/pg-boss/dist/manager.d.ts(28,52): error TS2724: '"/path/to/agentic-factory/node_modules/pg-boss/dist/types"' has no exported member named 'ResolvedConstructorOptions'. Did you mean 'ConstructorOptions'?
node_modules/pg-boss/dist/notifier.d.ts(10,70): error TS2724: '"/path/to/agentic-factory/node_modules/pg-boss/dist/types"' has no exported member named 'ResolvedConstructorOptions'. Did you mean 'ConstructorOptions'?
node_modules/pg-boss/dist/timekeeper.d.ts(11,19): error TS2724: '"/path/to/agentic-factory/node_modules/pg-boss/dist/types"' has no exported member named 'ResolvedConstructorOptions'. Did you mean 'ConstructorOptions'?
node_modules/pg-boss/dist/timekeeper.d.ts(25,70): error TS2724: '"/path/to/agentic-factory/node_modules/pg-boss/dist/types"' has no exported member named 'ResolvedConstructorOptions'. Did you mean 'ConstructorOptions'?
```

Exit code: 2.

```text
$ git diff --check
docs/BACKLOG.md:3: trailing whitespace.
+**Status:** AF-001–003 accepted and merged in `4a0ce53`; AF-004 checkpoint verified locally, AF-005 blocked, AF-006 not started. See `CORE_ENGINE_VERIFICATION.md`. Later tickets remain unimplemented.  
docs/MASTER_PLAN.md:3: trailing whitespace.
+**Status:** revision 2.1 specification; AF-001–003 accepted and merged in `4a0ce53`. Milestone 2 is approved but incomplete; see `CORE_ENGINE_VERIFICATION.md`. The accepted baseline provides configuration validation, not a complete executing Factory. Revision 2 remains the product baseline; 2.1 changes Telegram implementation priority only.  
```

Exit code: 2.

```text
$ git diff --stat
 README.md                      |   7 +-
 docs/ARCHITECTURE.md           |   5 +
 docs/BACKLOG.md                |  34 +--
 docs/BOOTSTRAP_VERIFICATION.md |   4 +
 docs/GETTING_STARTED.md        |   2 +-
 docs/MASTER_PLAN.md            |   2 +-
 docs/SECURITY.md               |   5 +
 package-lock.json              | 535 ++++++++++++++++++++++++++++++++++++++++-
 package.json                   |  21 +-
 9 files changed, 586 insertions(+), 29 deletions(-)
```

Exit code: 0.

```text
$ git status --short
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
?? migrations/
?? scripts/
?? src/adapters/pg-boss-queue.ts
?? src/adapters/postgres/
?? src/core/workflow.ts
?? src/ports/workflow-store.ts
?? tests/database/
```

Exit code: 0.
