# AF-031 verification and review handoff

## Scope and baseline

Branch `feat/af-031-slack-control`, separate worktree, based exactly on reviewed AF-029 commit `9cf24d6da01fd008930614c39911537741ea3077`. Remote PR #7 head was verified before branch creation. The initial local checkpoint performed no publication. The owner subsequently authorized final review, commit, push, and a stacked Draft PR targeting `feat/af-029-telegram-control`, not main. Merge, retargeting, Slack app installation, token requests, live Slack API calls, and subsequent milestones remain unauthorized. AF-029 acceptance remains unchanged.

All new tests use synthetic Slack identities, fake API/socket objects, and a separate PostgreSQL Compose project `af031-tests` with independent `af031-tests_database` volume on the otherwise-free loopback test port. The existing Telegram live acceptance process, volume, private provisioning directory, credentials and database were neither accessed nor modified. The database name used by existing automated scripts remains `agentic_factory_local` inside this separate instance; it is not the Telegram acceptance database.

## Implementation and security mapping

| Requirement | Maintained evidence |
| --- | --- |
| Separate bot/admin, forced RLS, direct SQL denial, cross-organization access | `AF-031 SQL roles, forced RLS and project isolation preserve intake authority` |
| Five-minute random claim, pending state, exact operator confirmation, wrong/expired user | `AF-031 short-lived pairing requires pending claim and exact local confirmation`; `AF-031 expired pairing and untrusted identity are denied` |
| Both software and ML intake, provenance, metadata replies, unavailable cancel, no Run/queue mutation | Two `AF-031 canonical ... intake and metadata commands have no execution effects` cases |
| Workspace/app/authorization binding, Slack Connect denial | `AF-031 cross-workspace, app and authorization envelope attacks fail closed` |
| Stable event identity, conflict rejection | `AF-031 duplicate stable event IDs deduplicate across envelope IDs; conflicts stop` |
| Capture commit before ack, ack before processing | `AF-031 acknowledgment follows committed capture and precedes WorkItem processing` |
| Failed capture, 1,000-receipt retention stop | `AF-031 failed capture never acknowledges; retention does not discard evidence` |
| Durable restart and ack loss | `AF-031 pending capture survives restart and lost acknowledgment without duplicates`; `AF-031 acknowledgments lost after commit replay safely on a fresh socket` |
| Atomic intake/outbox rollback, attempts/deadlines, delayed success | `AF-031 operational retries are durable, delayed and atomic through exhaustion`; `AF-031 transient failure remains delayed across restart then succeeds exactly once` |
| Concurrent revocation commit order | `AF-031 concurrent revocation waits for the authoritative intake transaction` |
| Revocation/membership fail closed | `AF-031 revocation and membership loss fence processing and pending replies` |
| Rate and storage amplification bounds | `AF-031 burst and per-minute bounds consume no additional work or replies`; `AF-031 inbound abuse and oversized envelopes cannot grow per-event storage` |
| 429/uncertain sends and permanent failures | `AF-031 Web API errors are bounded, redacted and classify rate limits`; `AF-031 uncertain replies persist attempts and rate-limit deadlines without duplicate intake`; `AF-031 permanent reply failure exhausts without changing canonical intake` |
| Single adapter and lost session | `AF-031 exclusive session lock and database session loss stop ownership`; `AF-031 session termination loses ownership and aborts capture`; `AF-031 database outage during capture yields no acknowledgment` |
| App identity before background recovery | `AF-031 unverified Socket Mode app cannot trigger background recovery` |
| App hello, reconnect/rotated URL, disabled Socket Mode | `AF-031 hello app identity and disabled Socket Mode are terminal`; `AF-031 refresh reconnect obtains a new URL and revalidates installation identity`; `AF-031 rotated socket URLs are accepted only on reviewed TLS endpoints` |
| Process death after capture and after processing commit | Two `AF-031 killed process after ... commit recovers exactly one canonical request` cases |
| Original bounded DM only, no files/threads/bots/edited messages | `AF-031 only original bounded human private messages are supported` |
| Optional CLI and redacted diagnostics | `AF-031 Slack CLI stays optional and errors never expose configuration or token values` |
| Mandatory gates preserved | Updated existing workflow regression requires unconditional Slack setup/tests, preserving all prior commands and sandbox cleanup exception |

## Actual local verification

Node 24.22.0, npm 11.9.0, PostgreSQL 18.6 pinned image on the local macOS ARM64 Docker VM. Fresh migrations 001–005 applied successfully. Subsequent `npm run db:migrate` twice reported `No migrations to run!`. Synthetic setup scripts for local roles, Telegram, Slack and queue ran against the separate AF-031 test database only. Runtime/schema/permission controls were not weakened.

Final verification completed with **321 passing named tests**, zero failures/cancellations/skips, plus four compatibility checkpoints and two profile validations:

| Command | Actual result |
| --- | --- |
| `npm run db:migrate` (twice) | Exit 0; no migrations pending after fresh 001–005 application |
| `npm run db:setup-local`, `db:setup-telegram`, `db:setup-slack`, `db:setup-queue` | Exit 0 |
| `npm run deps:check`, `lint`, `typecheck`, `build` | Exit 0; strict checks preserved |
| `npm run test:deps` | 7/7 |
| `npm test` | 91/91 |
| `npm run test:compatibility` | 4 PASS checkpoints |
| `npm run test:state` | 5/5 |
| `npm run test:queue` | 8/8 |
| `npm run test:intake` | 10/10 |
| `npm run test:telegram` | 28/28 |
| `npm run test:slack` | 27/27 |
| `npm run test:simulations` | 24/24 |
| `npm run test:sandbox-tools` | 121/121 |
| `node dist/cli/index.js validate fixtures/software-general.json` | Exit 0, valid |
| `node dist/cli/index.js validate fixtures/ml-research.json` | Exit 0, valid |
| `git diff --check` | Exit 0 |

The final complete command sequence ran with the pinned Node/npm and a migration URL containing synthetic automated-test credentials only. All integration tests terminated; none were watch-mode or silently skipped. These are local results; hosted evidence must be recorded separately against the published head. Production dependency audit (`npm audit --omit=dev --ignore-scripts --json`) reported **0 vulnerabilities** across all severities at review time. This does not prove absence of vulnerabilities. Exact package pins and lockfile integrity are retained.

## Findings corrected during implementation

- Final review added a fail-closed worker gate: background recovery waits until the Socket Mode hello validates the configured app. The negative regression verifies stored requests and replies remain untouched for a mismatched app.

- Initial integration pass: 12/17 passed. Four failures were synthetic fixture edits to pairing rate state attempted through the migration role, correctly rejected by the pairing trigger. Fixtures now use the authorized bot connection for those rate fields. A fifth test incorrectly expected a same-state no-op to fail; it now attempts an actual unauthorized state change. No trigger was relaxed.
- A full passing test run ended with `git diff --check` exit 2 for Markdown trailing spaces in the new backlog entry; removed those spaces and reran successfully.
- Strict TypeScript caught a promise-timer import colliding with the callback timer used for the acknowledgment deadline; corrected the import alias.
- Full-suite first run: Telegram 27/28 passed. Its historical five-minute check compared PostgreSQL expiry against host Date.now; a measured PostgreSQL/host query-start delta was about +2 ms. The worktree-only regression now measures remaining expiry with PostgreSQL clock_timestamp and requires `0 < remaining <= 300` seconds. The runtime and AF-029 branch were unchanged. This improves the assertion's authoritative clock without widening the expiration limit.

## Remaining limitations and separate live gate

Fake sockets model Slack protocol delivery and reconnect events; they are not evidence that an actual Slack installation, enterprise policy, TLS proxy, or workspace will accept these payloads/scopes. Strict host/schema allowlists intentionally reject new or ambiguous formats. Native ws raw-frame limits/compression settings are configured, while transport/provider compatibility still requires a separately authorized development-app test. No real Slack calls were used to obtain synthetic success.

macOS ARM64 sandbox execution remains unsupported/unverified; full actual sandbox tests must run on the approved Linux AMD64 CI runtime for the authorized stacked Draft PR. Local sandbox tooling tests are distinct from actual sandbox execution. Required CI gates are preserved and Slack tests are added without skips.

One human/workspace/project only; trusted host/adapter/SQL credentials; finite Slack retention/retry windows; no exactly-once reply delivery; no recall of committed requests or in-flight replies; fail-closed 1,000-receipt cap with no automatic archival; explicit operator review for exhausted operations. Source originals stay private in canonical storage. A future live test requires separately authorized app installation and credentials, minimal scopes, local pending/confirmation pairing, synthetic DM commands, restart/revocation, and explicit token/process cleanup. No execution permission is granted by intake or this handoff.

## Changed-file inventory

This inventory covers the 25 files reviewed for publication relative to the unchanged reviewed base. Prior migrations, accepted dependency patch, sandbox implementation and AF-029 branch are unchanged. Only the existing Telegram test clock assertion changes in this worktree; runtime behavior is preserved.

- `.github/workflows/ci.yml`
- `README.md`
- `docs/AF031_VERIFICATION.md`
- `docs/ARCHITECTURE.md`
- `docs/BACKLOG.md`
- `docs/SLACK.md`
- `migrations/005-slack.cjs`
- `package-lock.json`
- `package.json`
- `scripts/setup-local-slack.mjs`
- `src/adapters/postgres/slack-store.ts`
- `src/adapters/postgres/work-item-store.ts`
- `src/adapters/slack/https-api.ts`
- `src/adapters/slack/socket.ts`
- `src/cli/slack.ts`
- `src/core/intake.ts`
- `src/core/slack.ts`
- `src/ports/slack-api.ts`
- `src/runtime/slack-config.ts`
- `src/runtime/slack.ts`
- `tests/database/slack.test.ts`
- `tests/database/telegram.test.ts`
- `tests/helpers/slack-crash.ts`
- `tests/review-regressions.test.ts`
- `tests/slack.test.ts`
