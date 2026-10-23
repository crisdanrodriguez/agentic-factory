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


## Narrow protocol compatibility follow-up

Historical publication checkpoint: head `0962b3ffce8234b346d0bad65e347ae8b354db00` passed both mandatory jobs in [PR run 40025518096](https://github.com/crisdanrodriguez/agentic-factory/actions/runs/40025518096) and [push run 40025361404](https://github.com/crisdanrodriguez/agentic-factory/actions/runs/40025361404), with the local counts above plus 14 broker integration tests and nine feasibility properties.

Finding 1 is confirmed: the exact `wss.slack.com` hostname in Slack's official Socket Mode guide was rejected. The correction adds only that hostname and retains all existing transport controls. URL fixtures cover the documented hostname, existing reviewed hosts, lookalike domains, arbitrary subdomains, plaintext, userinfo, fragments, unexpected ports and paths.

Finding 2 is a documented unsupported variant, not a safe reason to remove authorization predicates. The representative message.im example describes a non-bot authorization and omits sharing evidence. Both conditions remain rejected. Documentation now distinguishes that generic example from the configured bot-installation subset, and explicitly discloses the missing-sharing-field live compatibility gate. See `SLACK.md` for official references and the rule. No migrations, privileges, persistence semantics or retry policy changed.

New maintained evidence:

- `AF-031 documented user-authorization example does not authorize the bot installation`: synthetic adaptation of the official example; rejects human authorization, unknown/shared metadata, duplicate or enterprise authorizations; accepts the fully evidenced bot variant.
- `AF-031 supported documented message fields stay on one socket and retain commit-before-ack`: optional ordinary fields, multiple deliveries, one canonical WorkItem, no reconnect dependency.
- `AF-031 ambiguous provider envelopes stop without acknowledgment or reconnect loops`: missing sharing evidence causes one connection to stop with no acknowledgment or accepted receipt/work.

The production change is limited to the exact hostname allowlist. Schema comments explain intentionally retained predicates. Live Slack testing remains unauthorized and no full provider compatibility claim is made.

Follow-up local verification: Node 24.22.0/npm 11.9.0; isolated AF-031 PostgreSQL only. `db:migrate` twice, all four setup commands, `deps:check`, `lint`, `typecheck`, `build`, and `git diff --check` exited 0. `test:deps` 7/7; `npm test` 92/92; `test:state` 5/5; `test:queue` 8/8; `test:intake` 10/10; `test:telegram` 28/28; `test:slack` 29/29; `test:simulations` 24/24; `test:sandbox-tools` 121/121. Total 324, no failures/cancellations/skips. `test:compatibility` reported four PASS checkpoints and both software-general/ml-research CLI validations passed. Actual Linux sandbox execution remains a hosted gate, not local macOS evidence.


Hosted correction evidence at `e94936ea94ace27d2b325652b3d8fdabed9f0fa7`: both mandatory jobs succeeded in [PR workflow 40032281773](https://github.com/crisdanrodriguez/agentic-factory/actions/runs/40032281773) and [push workflow 40032277081](https://github.com/crisdanrodriguez/agentic-factory/actions/runs/40032277081). Hosted named-test counts match the 324 local tests above, plus 14/14 Linux broker tests and all nine feasibility properties. No failures or skips. Runtime preflight verified Engine 29.9.2, containerd v2.4.2, runc 1.5.2 and enforced docker-default; immutable image verification passed. Unconditional cleanup reported registered containers and test directory/socket resources absent. These results do not establish live Slack compatibility or macOS ARM64 sandbox support. This evidence-only follow-up changes no executable code; final-head workflow links are recorded in Draft PR #8.

## Observation-only diagnostic publication checkpoint

This checkpoint extends the historical 324-test protocol-correction checkpoint; it does not replace or reinterpret that evidence. The initial local observer checkpoint had 336 passing tests (104 unit/CLI tests, including 12 observer cases). Final publication review adds one lifecycle test, for **337 passing tests**, including **105 unit/CLI tests and 13 observer cases**. No live Slack calls occurred.

The separate `slack:observe -- --synthetic-only` entry point reads private observer configuration, verifies auth.test identity and hello app identity, and consumes at most three exact synthetic-marker DMs from a preconfigured human/channel. Safe projection completes before acknowledgment; projection output follows local acknowledgment completion. Incompatible metadata is observable but does not authorize intake. Nonmatching events, identity errors, uncertain transport results and timeouts stop without a successful observation claim. Production intake/schema, migrations, grants, dependencies and AF-029 remain unchanged.

Review inspected every output path and the complete source import graph: observer CLI/runtime, private-file helper, core contracts/intake schema helpers, Slack schema, API port, HTTPS and socket transports. No PostgreSQL client, WorkItemStore, SlackStore, pairing, outbox or workflow component is imported or initialized. The shared HTTPS class has a reply method, but the observer runner receives only identity/open operations and never calls send. Third-party dependencies remain the pinned zod/ws graph and Node built-ins; no dependency change or installation hook was added.

The overall observation timer begins before auth.test, covers all network phases including acknowledgment, and excludes the preceding bounded local configuration read. Review added a cancellation check before each event read and a regression covering stalled open/connect/hello/ack phases. Finally blocks clear the timer, abort transport work and close the socket. The reviewed socket clears buffered events. Memory is not persisted; JavaScript/transport buffers and environment strings are not guaranteed to be zeroized. Dedicated process shutdown and private credential cleanup remain operator responsibilities.

Actual local commands/results (Node 24.22.0/npm 11.9.0, isolated AF-031 PostgreSQL):

| Command | Result |
| --- | --- |
| `npm run db:migrate` twice; four existing synthetic setup commands | Exit 0; no migrations pending |
| `npm run deps:check`, `lint`, `typecheck`, `build` | Exit 0 |
| `npm run test:deps` | 7/7 |
| `npm test` | 105/105 |
| `npm run test:compatibility` | Four PASS checkpoints |
| `npm run test:state`, `test:queue`, `test:intake` | 5/5, 8/8, 10/10 |
| `npm run test:telegram`, `test:slack` | 28/28, 29/29 |
| `npm run test:simulations`, `test:sandbox-tools` | 24/24, 121/121 |
| Both existing CLI profile validation commands | Valid |
| `git diff --check` | Exit 0 |

No failed, cancelled or skipped tests. The isolated test database was stopped afterward. Full Linux sandbox execution remains a hosted gate; macOS restrictions remain. Hosted results for this increment must be recorded against the published head in Draft PR #8; no live observation is claimed. `AF031_LIVE_ACCEPTANCE.md` defines separately authorized A/B stages and diagnostic consumption semantics. The observer does not relax missing-sharing or non-bot authorization restrictions for normal intake.
