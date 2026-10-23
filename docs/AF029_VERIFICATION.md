# AF-029 verification record

## Status and baseline

AF-029 is implemented locally on `feat/af-029-telegram-control`, based on verified main `023d32c64c36f720d77a7330453610884592e303`. Local verification on 2026-10-22 passed the commands below. Human acceptance, publication/hosted checks, and the separately authorized live development-bot test remain pending. No merge, deployment, live Telegram API call, bot creation, token acquisition, or subsequent milestone was performed.

Historical baseline: AF-023 and its documentation follow-up were accepted and merged. Main at `023d32c64c36f720d77a7330453610884592e303` passed both jobs in [run 39741125551](https://github.com/crisdanrodriguez/agentic-factory/actions/runs/39741125551). That is baseline evidence, **not hosted evidence for this uncommitted AF-029 working tree**. AF-007's accepted Linux AMD64 synthetic scope and historical evidence remain unchanged. macOS ARM64 sandbox validation remains outstanding and normal ARM64 broker execution remains disabled.

## Local environment and commands

Final verification used Node.js **v24.22.0**, npm **11.9.0**, and local PostgreSQL **18.6 (Debian 18.6-1.pgdg13+2), aarch64-unknown-linux-gnu** on a macOS ARM64 host. The existing disposable Compose database used only project-authored synthetic credentials/data. No package dependency or lockfile changed. Early exploratory lint/unit/typecheck commands used the shell's Node 25; all final applicable commands were rerun with the pinned Node 24 on PATH. Node 25 results are not the tested baseline.

Setup executed:

```sh
docker compose up -d --wait postgres
npm run db:migrate
npm run db:setup-local
npm run db:setup-telegram
```

`FACTORY_MIGRATION_URL` pointed to the existing synthetic loopback database. Migration output: `Migrating files: - 003-telegram`, `MIGRATION 003-telegram (UP)`, exit 0. Existing queue setup was already present locally; fresh CI runs both `db:setup-local` and `db:setup-queue` and additionally `db:setup-telegram`.

| Command | Actual final result |
| --- | --- |
| `npm run lint` | Exit 0, zero warnings |
| `npm run typecheck` | Exit 0; strict checks and `skipLibCheck: false` preserved |
| `npm run deps:check` | Exit 0, `pg-boss 12.38.0 declaration patch verified (already applied).` |
| `npm run test:deps` | 7 tests, 7 pass, 0 fail/cancelled/skipped/todo; includes minimal strict pg-boss import |
| `npm test` | 86 tests, 86 pass, 0 fail/cancelled/skipped/todo |
| `npm run build` | Exit 0 |
| `npm run test:compatibility` | Exit 0; all 4 PASS checkpoints: migration rerun, atomic commit, atomic rollback, non-privileged RLS/DDL denial |
| `npm run test:state` | 5 tests, 5 pass, 0 fail/cancelled/skipped/todo |
| `npm run test:queue` | 8 tests, 8 pass, 0 fail/cancelled/skipped/todo |
| `npm run test:simulations` | 24 tests, 24 pass, 0 fail/cancelled/skipped/todo |
| `npm run test:intake` | 10 tests, 10 pass, 0 fail/cancelled/skipped/todo |
| `npm run test:telegram` | 23 tests, 23 pass, 0 fail/cancelled/skipped/todo |
| `npm run test:sandbox-tools` | 121 tests, 121 pass, 0 fail/cancelled/skipped/todo |
| `node dist/cli/index.js validate fixtures/software-general.json` | Exit 0: `Valid configuration: software-general.`; contract validation only |
| `node dist/cli/index.js validate fixtures/ml-research.json` | Exit 0: `Valid configuration: ml-research.`; contract validation only |
| `git diff --check` | Exit 0 |

Total final named test cases across the listed suites: **284 passing**, plus four compatibility checkpoints and the two profile demonstrations. These are synthetic workflow/security tests, not real provider or scientific results.

Not run locally: `npm run test:sandbox` (14 actual broker tests and nine feasibility properties require the approved Linux AMD64 runtime); no attempt was made to bypass the ARM64 platform restriction. No new hosted run exists for AF-029. The mandatory Linux sandbox job, exact runtime/image pins, immutable image gate, and unconditional cleanup are unchanged. A future authorized PR must pass both CI jobs before merge.

## Acceptance-to-test mapping

Names below are exact maintained test names except where two profile/phase cases are explicitly grouped. Database cases live in `tests/database/telegram.test.ts`; unit/CLI cases live in `tests/telegram.test.ts`.

| Requirement | Actual maintained evidence |
| --- | --- |
| Separate bot/admin privileges, forced RLS, no role switching or execution access | `AF-029 SQL roles cannot activate, grant identities, escape project scope, or execute work` |
| Five-minute random challenge, expected identity, pending enrollment, local confirmation, generation fencing | `AF-029 pairing requires expected identity, pending claim, local confirmation and single-use generation` |
| Wrong/expired challenge rejection | `AF-029 expired and incorrect challenges cannot activate pairing` |
| Canonical software and ML intake, exact originals, duplicate receipt, no Run/queue side effects | `AF-029 canonical synthetic-software-project intake, exact provenance, duplicate recovery, and no execution effects`; corresponding `synthetic-ml-project` case |
| Revocation and membership loss | `AF-029 revocation fences captured operations and pending replies; lost membership fails closed`; `AF-029 loss of membership suppresses an already committed outbox reply` |
| Concurrent revoke/intake commit ordering | `AF-029 revocation serializes with an in-flight intake transaction` (actual processor blocks on receipt lock while holding pairing lock; revocation is observed waiting) |
| Atomic WorkItem/receipt/outbox rollback and retry exhaustion | `AF-029 receipt and WorkItem writes roll back together on outbox failure; retries exhaust` |
| Single poller, persisted capture/cursor, restart and seven-day discontinuity | `AF-029 one poller, durable capture/restart, cursor discontinuity, and conflict rollback` |
| Bot identity and webhook conflict | `AF-029 fake transport rejects wrong bot and webhook without polling or mutation` |
| Polling retry bound | `AF-029 fake polling retries are bounded and errors never disclose transport secrets` |
| Reply ambiguity, bounded attempts, no duplicate WorkItem | `AF-029 ambiguous outbox delivery may duplicate replies, never WorkItems, and exhausts retries` |
| Rate and unauthorized-traffic bounds | `AF-029 rate limit bounds burst and rolling minute; unauthorized traffic creates no rows or replies` |
| Metadata-only status/list and unavailable cancel | `AF-029 metadata-only status and stable bounded list never disclose request bodies` |
| Storage cap and offset rollback | `AF-029 storage bounds fail closed atomically rather than silently dropping receipts` |
| Session loss before work | `AF-029 session loss aborts polling before capture or reply delivery` |
| Forgery, forbidden message types, malformed batch, unexpected JSON fields | `AF-029 captured forbidden updates and malformed batches cannot produce work or replies`; `AF-029 accepts only bounded original private human messages`; `AF-029 strict JSON preserves exact decoded request bytes and rejects privilege fields` |
| External and standalone transaction behavior, direct SQL cross-project denial | `AF-029 standalone and caller-owned intake transactions retain SQL actor and rollback boundaries`; existing ten AF-023 integration tests |
| Abrupt process death after capture and after intake commit | `AF-029 killed process recovers captured update without duplicate intake`; corresponding `processed` case (real SIGKILL child processes) |
| No transaction during network wait; reject response after lock-session death | `AF-029 long polling holds no database transaction and session loss rejects returned updates` |
| Ambiguous update-ID reuse cannot silently deduplicate distinct messages | `AF-029 reused update ID with a different Telegram message identity fails closed` |
| Bounds, malformed UTF-8, token/API-description redaction, fixed TLS endpoint | `AF-029 transport envelopes are bounded, strict UTF-8, and redact secrets and API descriptions`; `AF-029 optional transport has a fixed TLS endpoint and no execution or webhook mutation dependencies` |
| Optional CLI, redacted errors, no credentials required for help | `AF-029 optional CLI help needs no token, network, database, or sandbox; errors are redacted`; existing AF-023 CLI tests and both profile demonstrations |
| Mandatory CI gates and unconditional sandbox cleanup preserved | Existing `review regression: CI provisions PostgreSQL and runs every mandatory check without skip or failure suppression`, extended to require Telegram setup/tests; existing cleanup regression |
| Live development-bot acceptance | **Not performed; separate owner authorization and credentials required.** |

The fake transport does not prove Telegram's actual network behavior, certificate chain availability, or live account configuration. TLS configuration is explicit in the adapter; live transport acceptance remains outstanding. SQL tests use real non-privileged bot/admin logins and actual PostgreSQL locking; migration credentials are used only for synthetic setup, controlled fault injection, and independent evidence inspection.

## Findings resolved during implementation

- Strict TypeScript initially rejected a dedicated `Client` where intake required a `PoolClient`. Caller-owned methods now require the shared `ClientBase` query interface; authentication and SQL authorization are unchanged, without unsafe casts or relaxed compiler settings.
- The first database attempt passed four cases, then fixture cleanup deleted heads before dependent revisions, causing 11 failures and an interrupted test runner. Cleanup now respects the existing foreign keys and closes failed setup connections. No existing migration was weakened.
- The next attempt passed 13 cases and exposed repeated store shutdown (`Called end on pool more than once`) plus a listing assertion that assumed the project contained no pre-existing local requests. Shutdown is idempotent; pagination is verified against all authorized project records without deleting unrelated records. Subsequent expanded runs passed all 23 cases and terminated normally.
- Intake copies caller-owned bytes before awaiting a standalone connection, preserving AF-023's snapshot boundary. New transaction-composition methods copy inputs before their first await.

## Remaining limitations and review gates

- No hosted AF-029 verification or live development-bot evidence yet; do not declare the full backlog live-test criterion accepted.
- One bot/human/project only. A dedicated database session is required; transaction-mode poolers and multi-user actor delegation are unsupported.
- Pairing and scoped RLS do not protect against compromise of the trusted adapter, its database credential, the host operator, or Telegram infrastructure. Request provenance is retained privately; ordinary bot chats are unsuitable for secrets.
- A hard 1,000-update retention cap fails closed. No automatic archival/deletion policy exists. Rate-limited commands create no WorkItem and require a new message later. Exhausted receipts/outbox attempts require operator inspection.
- Replies can duplicate after uncertain delivery. In-flight replies cannot be retracted by revocation. Telegram server retention can expire uncaptured messages during outages.
- Linux AMD64 sandbox verification must run in its unchanged hosted job; macOS ARM64 sandbox authorization remains absent.
- No execution, AI adapter, approval, deployment, publication, or subsequent-ticket capability was introduced. No commit, push, PR, merge, or deployment was performed in this implementation handoff.

Installation, grants, operator pairing, privacy, retention, and recovery instructions are in `TELEGRAM.md`. Existing acceptance and historical verification documents remain authoritative for their respective accepted increments.

## Historical local-checkpoint handoff

At the initial local handoff, branch `feat/af-029-telegram-control` HEAD remained the verified main baseline. No files were staged. That handoff contained 13 tracked modifications and 14 new files (27 total), all within AF-029:

- Existing code/contracts: `src/core/intake.ts`, `src/ports/work-item-store.ts`, `src/adapters/postgres/work-item-store.ts`.
- New channel code: `src/core/telegram.ts`, `src/ports/telegram-api.ts`, `src/adapters/telegram/https-api.ts`, `src/adapters/postgres/telegram-store.ts`, `src/runtime/telegram.ts`, `src/runtime/telegram-config.ts`, `src/cli/telegram.ts`.
- Schema/setup: `migrations/003-telegram.cjs`, `scripts/setup-local-telegram.mjs`.
- Verification/CI: `tests/telegram.test.ts`, `tests/database/telegram.test.ts`, `tests/helpers/telegram-crash.ts`, `tests/review-regressions.test.ts`, `.github/workflows/ci.yml`, `package.json`.
- Documentation: `README.md`, `docs/ARCHITECTURE.md`, `docs/BACKLOG.md`, `docs/DATABASE.md`, `docs/LOCAL_INTAKE.md`, `docs/MASTER_PLAN.md`, `docs/SECURITY.md`, `docs/TELEGRAM.md`, this verification record.

Tracked diff: 112 insertions and 59 deletions before this final evidence appendix (the appendix is in a new file). Secret/private-path pattern inspection of changed/new files returned no findings. No generated build directories, private configuration, certificates, tokens, or logs are included. The accepted dependency patch, lockfile, earlier migrations, core WorkItem schema, and sandbox implementation are unchanged. Test data remains only in the disposable local PostgreSQL volume; the service started for verification was stopped afterward to restore its initial state.

## Pre-publication security review

The owner subsequently authorized a Draft PR only, not merge or live activation. All 27 files were reviewed before staging. No critical security blocker was found within the documented trusted-adapter, single-human/project boundary. Direct possession of the bot database credential remains a trusted-component compromise, not a Telegram sender authentication mechanism.

A small privacy correction hashes every enrollment-shaped `/start CODE` payload, including messages received in an already active binding. Previously the active-binding path could temporarily retain that code as ordinary text. The regression `AF-029 enrollment-shaped messages never persist plaintext challenges in an active binding` verifies the correction. `AF-029 revocation during an in-flight reply prevents subsequent pending delivery` verifies that the already-started reply may complete, but later pending replies are suppressed. Direct SQL tests now explicitly cover unauthorized enrollment, revocation, all five channel reads, and other pairing transitions. The CLI error regression now requires a nonzero exit instead of accidentally catching its own failed assertion. No architecture, existing migration, dependency, sandbox baseline, or permission expansion was introduced.

All commands in the local-results table were rerun for publication using Node 24.22.0/npm 11.9.0. The final Telegram suite is now **25/25** and the total is **286 passing named cases**, with zero failures/cancellations/skips, plus the same four compatibility checkpoints and two profile demonstrations. The earlier 23/284 counts above are preserved as historical local-checkpoint evidence. Both application migration reruns exited 0 with `No migrations to run!`. All three setup scripts exited 0. A fresh, uniquely named disposable database was also used to apply migrations 001–003 and rerun them; five enabled/forced-RLS channel tables were verified, then that review database was removed. Existing local data was preserved. The first temporary migration-review harness omitted `migrationsTable` and failed with `relation "public.undefined" does not exist`; its database was cleaned up. Supplying the required option fixed that harness-only error; no project migration changed.

Hosted evidence for the published head will be recorded in the Draft PR and review handoff. The initial local-checkpoint statements about no commit/publication describe that earlier checkpoint; publication is now explicitly authorized. Live Telegram acceptance and macOS ARM64 sandbox validation remain outstanding.
