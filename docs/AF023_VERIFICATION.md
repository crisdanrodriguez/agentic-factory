# AF-023 implementation and local verification

Status: accepted by the owner after independent review for the approved local intake scope; PR #5 was squash-merged into main as `ce55b8d72dd7317dff44d1fa4ba9ea66d50ef6ae`. Both required main CI jobs passed. No subsequent ticket has been initiated.

## Acceptance and main-branch verification — 2026-10-22

- Reviewed head: `4d4c1f14505ea1d23c92201be2eeaa83f114d5d8`.
- [PR #5](https://github.com/crisdanrodriguez/agentic-factory/pull/5) retained that exact head, one expected commit and the reviewed 22 files immediately before merge. Both mandatory jobs were successful; no blocking reviews, unresolved review threads or new issue comments were present.
- The PR was marked ready and squash-merged with an exact-head guard, without an administrator override or protection bypass. Merge time: `2026-10-22T07:01:47Z`.
- `git diff --exit-code 4d4c1f14505ea1d23c92201be2eeaa83f114d5d8 origin/main` returned exit 0 after fetching merge `ce55b8d72dd7317dff44d1fa4ba9ea66d50ef6ae`: the merged tree matched the reviewed implementation exactly.
- [PR workflow 39732609731](https://github.com/crisdanrodriguez/agentic-factory/actions/runs/39732609731) and [main workflow 39737704211](https://github.com/crisdanrodriguez/agentic-factory/actions/runs/39737704211) both passed `checks` and `sandbox` at their respective exact commits. Main logs were inspected independently; this is not an inference from PR results.

| Main verification | Actual result |
|---|---|
| Explicit dependency patch/check; lint; strict typecheck; build | Passed |
| Dependency tests | 7 passed |
| Unit/regression tests | 81 passed |
| Application migrations, local roles and queue setup | Passed |
| PostgreSQL compatibility | 4 PASS assertions |
| State/isolation tests | 5 passed |
| Queue/recovery tests | 8 passed |
| Intake tests | 10 passed |
| Simulations | 24 passed |
| CLI help and both profile validations | Passed |
| Sandbox tooling | 121 passed |
| Sandbox broker integration | 14 passed |
| Maintained feasibility properties | 9 passed |
| Unconditional sandbox cleanup | Passed; registered containers and test directory/socket resources absent |

All counted test suites reported zero failed, cancelled or skipped tests. Linux security preflight verified Engine `29.9.2` / Go `1.26.10`, containerd `v2.4.2` / Go `1.27.3`, runc `1.5.2`, cgroup v2, AppArmor and seccomp. The locked OCI index, selected AMD64 manifest and local configuration chain passed with TLS enabled. Actual project-process `docker-default (enforce)` confinement passed. This remains evidence for the reviewed Linux AMD64 runtime and synthetic execution scope only; macOS ARM64 sandbox validation is outstanding and normal execution remains blocked there.

Acceptance grants no execution, publication, deployment, AI activation or broader runtime authority. Original request retention and explicit `show` output remain sensitive; trusted host/OS account, non-privileged database roles, private storage and the documented ACL assumptions still apply. Historical local evidence and limitations below are preserved.

Base: verified main `a9f73c29e4632397d83cacbdf820d46e18d04f4f` (PR #4). Main workflow [39725289981](https://github.com/crisdanrodriguez/agentic-factory/actions/runs/39725289981) passed before this increment. Implementation was prepared on `feat/af-023-local-intake` before the squash merge.

## Scope and schema

The three CLI operations create, revise and show reuse the existing WorkItem schema. They require trusted installation configuration and an authenticated PostgreSQL role; no plan, profile, workflow run, queue, provider or sandbox is required.

The only application migration is additive `002-work-items.cjs`: `intake_heads`, `intake_revisions`, `intake_receipts`, forced RLS on each, owner/actor checks, sequential-version trigger and deferred head/revision consistency. Existing migrations, workflow transitions/tables, provider contracts, dependency pins/patch, and sandbox security controls are unchanged. Setup adds least-privilege intake grants and a synthetic second actor (`af_peer`) for isolation tests.

See `LOCAL_INTAKE.md` for installation, commands, original byte retention, idempotency scope, security assumptions and recovery instructions.

## Actual local verification

Environment: Node.js 24.22.0, npm 11.9.0, macOS ARM64 coordinator; PostgreSQL reports `18.6 (Debian 18.6-1.pgdg13+2) on aarch64-unknown-linux-gnu`. Only the existing synthetic local database was used. Installed dependencies were reused; no packages or runtime versions were upgraded.

| Command | Actual result |
|---|---|
| `npm run db:migrate` | Applied `002-work-items`; subsequent rerun: `No migrations to run!` |
| `npm run db:setup-local` | Successful role/membership/intake grant setup |
| `npm run db:setup-queue` | Successful explicit existing queue setup |
| `npm run lint` | Exit 0, no warnings/errors |
| `npm run typecheck` | Exit 0; strict options and explicit pg-boss patch verification preserved |
| `npm run build` | Exit 0 |
| `npm run test:deps` | 7 tests passed; 0 failed/skipped/cancelled |
| `npm test` | 81 tests passed; 0 failed/skipped/cancelled; includes 11 new intake unit/filesystem/argument tests |
| `npm run test:sandbox-tools` | 121 tests passed; 0 failed/skipped/cancelled |
| `npm run test:compatibility` | All 4 printed PASS assertions: migration/rerun, atomic state/queue commit, rollback, RLS/DDL denial |
| `npm run test:state` | 5 tests passed; 0 failed/skipped/cancelled |
| `npm run test:queue` | 8 tests passed; 0 failed/skipped/cancelled |
| `npm run test:simulations` | 24 tests passed; 0 failed/skipped/cancelled |
| `npm run test:intake` | 10 tests passed; 0 failed/skipped/cancelled |
| `node dist/cli/index.js validate fixtures/software-general.json` | `Valid configuration: software-general.`; no work executed/providers verified |
| `node dist/cli/index.js validate fixtures/ml-research.json` | `Valid configuration: ml-research.`; no work executed/providers verified |
| `git diff --check` | Exit 0 |

Commands used the pinned Node executable through a local PATH override. Database setup used the existing public synthetic migration URL documented in `DATABASE.md`. Tests use the separate non-privileged application roles. No credentials from a business installation were used.

Initial failures and resolution: the first database connection failed with `ECONNREFUSED 127.0.0.1:55432` because Docker Desktop/the database were stopped. Starting the installed Desktop application and existing pinned Compose PostgreSQL service restored availability; no installation or runtime upgrade was performed. Four initial filesystem tests used macOS's symlink-containing temporary path and were correctly rejected. Test fixtures now use the canonical temporary path; production checks were not relaxed. Lint initially caught a crypto import in core; digest calculation was moved into an adapter. All listed final runs passed.

## Acceptance-to-test mapping

Tests below are in `tests/database/intake.test.ts` unless noted.

| Acceptance/security property | Actual maintained test |
|---|---|
| Owner/project-bound requests for both profiles, no plan/Run requirement | `AF-023 durable intake and receipt recovery without a plan or run: synthetic-software-project` and `...synthetic-ml-project` |
| Existing WorkItem/local origin, exact originals, normalized fields | Those two database tests plus `AF-023 preserves original bytes while reusing normalized request fields for both profiles` in `tests/intake.test.ts` |
| No execution side effects | Both durable-intake tests compare workflow and queue counts before/after intake |
| CLI create/revise/show, private output, file unchanged, no provider/sandbox configuration | `AF-023 real CLI create/revise/show preserves input and reports safely without provider or sandbox configuration` |
| Sequential textual revisions and optimistic concurrency | `AF-023 revision identifiers map exactly to positive sequential integers` (unit); `AF-023 concurrent identical ingestion produces one receipt and conflicting retries fail` |
| Actor/operation-scoped idempotency and organization isolation | `AF-023 receipt identity includes actor and operation, with organization isolation` |
| Direct SQL RLS, forged owner/actor, reader denial, immutable history and DDL denial | `AF-023 SQL enforces forced RLS, owner and actor identity, read-only roles and immutable history` |
| Reused identifiers across organizations cannot collide or cross-update | `AF-023 identical local IDs remain isolated across organizations at the SQL boundary` |
| Atomic rollback | `AF-023 failed transaction leaves no head, revision or receipt and permits retry` |
| Interrupted transaction and commit/response loss | `AF-023 process interruption before-commit recovers without duplicate ingestion` and `...after-commit...`; both terminate real child processes |
| Traversal, absolute names, separators, links, permissions, oversize, special files, symlinked ancestors | Four focused file boundary tests in `tests/intake.test.ts` |
| Replacement and mutation during reading | `AF-023 detects file replace during descriptor reading` and `...modify...`; deterministic descriptor-read interception |
| Malformed UTF-8/JSON, unexpected fields, privilege injection, safe errors | Request/parser, actual-file, configuration, and CLI argument tests in `tests/intake.test.ts` |
| Mandatory CI intake checks and preserved sandbox cleanup | Existing workflow regression now requires `npm run test:intake` before simulations; conditional skip/failure suppression remains rejected except unconditional sandbox cleanup |

## Remaining evidence and limitations

At the original local checkpoint the branch had not been published and there was no hosted AF-023 CI result. Publication for Draft PR verification was subsequently authorized; the acceptance section above now records the verified PR and merged main results. The mandatory `checks` job now runs intake integration tests after database initialization; missing database/setup or a test failure fails CI. The existing mandatory sandbox job and its unconditional cleanup are unchanged.

Actual sandbox broker integration/feasibility tests were not rerun locally: this host is ARM64 and normal broker execution remains deliberately blocked on unverified platforms. The 121 tooling tests are offline evidence, not fresh image pulls or container confinement verification. Historical accepted AF-007 Linux evidence remains in `AF007_VERIFICATION.md`. macOS ARM64 secure sandbox validation remains outstanding; this intake test result does not change that status.

Filesystem controls assume a trusted operator/OS account and private local storage without untrusted ACL grants; they do not protect against that account or root. Exact original requests and backups can contain sensitive content. Aggregate retention/quota management and ArtifactStore remain outside this increment. Explicit `show` returns sensitive authorized content; CLI fields can enter shell history. Intake grants no execution or publication authority.

Synthetic test audit rows are retained. No unrelated data was truncated, and test-owned temporary files/directories are removed. Docker Desktop and the synthetic database were started for verification; no sandbox containers were launched. After verification, `docker compose stop postgres` succeeded, restoring the database service to its initially stopped state while preserving its volume/audit records. Docker Desktop was left running. No restore drill, production deployment, AI call, Telegram integration, or new infrastructure was performed.
