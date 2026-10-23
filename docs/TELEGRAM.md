# AF-029 — Optional Telegram intake and status

Current increment: AF-029, implemented locally and awaiting review/hosted verification. No live Telegram test has been authorized or performed. See `AF029_VERIFICATION.md`. AF-023 remains the canonical local intake path. Telegram is an independently started, optional adapter; neither local intake nor profile validation requires a token, network, or sandbox.

## Supported boundary

One installation binds one bot, one human, one project, and one dedicated authenticated PostgreSQL bot login. An additional, separate local administrative login can administer pairing. This is deliberately not a shared database actor for multiple Telegram users. Adding users, bots, projects, or delegated database impersonation requires a new security review.

The adapter records requests with WorkItem `origin.kind = "local"` and intake `source_kind = "telegram"`. It cannot approve a plan, schedule work, create a Run, publish queue work, invoke an agent, execute a sandbox, provision resources, or publish artifacts. `/cancel` is unavailable. AF-030 remains unimplemented. AF-007 remains restricted to its accepted Linux AMD64 synthetic scope; macOS ARM64 sandbox validation is outstanding.

## Installation and permissions

Use Node.js 24.22.0, npm 11.9.0, the existing PostgreSQL installation, and the accepted dependency patch:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run deps:patch
npm run db:migrate
npm run build
```

`FACTORY_MIGRATION_URL` is supplied to migration/setup processes only, never to the bot. Migration `003-telegram.cjs` adds five forced-RLS channel tables and extends the intake source-kind constraint. Previous migrations and workflow tables are unchanged.

For **disposable synthetic verification only**, after `db:setup-local` and `db:setup-queue`:

```sh
npm run db:setup-telegram
npm run test:telegram
```

This setup is restricted to `agentic_factory_local`. It installs synthetic numeric IDs, roles, and memberships; it does not configure a bot or token. Existing synthetic fixtures are not suitable for a real installation.

For a future owner-authorized installation, the migration administrator must provision the following explicitly, using trusted local values rather than Telegram input:

1. Create two distinct PostgreSQL LOGIN roles with NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOINHERIT, and NOBYPASSRLS. Do not grant either role membership in another role. Set credentials privately outside the repository.
2. Grant both roles USAGE on `factory`, SELECT on `memberships`, `telegram_installations`, and `telegram_pairings`. Give each exactly one existing project membership, the authorized owner, `can_write=true`, and `can_approve=false`.
3. Grant the administrator UPDATE only on `telegram_pairings(generation,state,challenge_hash,expires_at,chat_id,claimed_at)`. No intake, queue, execution, or channel-installation write grants.
4. Grant the bot UPDATE only on `telegram_pairings(state,chat_id,claimed_at)`; SELECT/UPDATE on `telegram_polling`, `telegram_updates`, and `telegram_outbox`; INSERT on updates/outbox; SELECT/INSERT on the three intake tables; and UPDATE only on `intake_heads(version)`. No membership, installation, DDL, DELETE, TRUNCATE, workflow, approval, or queue grants.
5. Insert one `telegram_installations` row with its installation ID, verified bot numeric ID, exact bot/admin database role names, expected human numeric ID, organization, project, and owner. Initialize matching pairing and polling rows using their defaults. Only the migration administrator can create/change this identity mapping. Do not reuse a bot principal for another human or project. Stop the adapter before any trusted installation mapping or role-provisioning change; revoke and re-enroll rather than silently rebinding an active identity.

`setup-local-telegram.mjs` is an executable reference for these grants using synthetic identities. Normal operator provisioning is intentionally separate from pairing and from the bot process. No `SET ROLE` or request-supplied authorization context is used. RLS uses `session_user`; canonical intake still checks membership/owner and records the actual database actor.

## Private configuration and local pairing

Create separate operator-owned configuration files, mode 0600, in a canonical private directory, mode 0700, outside project workspaces. The existing private-file reader rejects symlinks, hard links, unsafe ancestors, replacement, excessive size, and malformed UTF-8. Paths and credentials are not included in ordinary diagnostics.

A **synthetic administrative configuration** has this shape:

```json
{
  "installationId": "synthetic-telegram",
  "botId": 900001,
  "principal": "af_telegram_admin",
  "databaseUrlEnvironment": "FACTORY_TELEGRAM_ADMIN_URL"
}
```

The separate bot configuration names `af_telegram_bot`, its own database URL environment variable, and `"tokenEnvironment": "FACTORY_TELEGRAM_TOKEN"`. Tokens/URLs themselves never belong in JSON or source control. The bot process must not inherit the migration/admin database credentials. Set `FACTORY_TELEGRAM_CONFIG` to the relevant private absolute configuration path.

Local administrative commands (synthetic identities shown):

```sh
npm run telegram -- pair issue synthetic-software-project 900002
npm run telegram -- pair show
npm run telegram -- pair confirm 900002 900002 1
npm run telegram -- pair revoke
```

`issue` requires the configured project and expected numeric human ID. It generates 32 random bytes, displays a single-use `/start CODE` locally, and stores only its SHA-256 hash. Expiration is five minutes according to PostgreSQL time. Do not capture this intentional secret display in ordinary logs. A new issuance invalidates prior generations.

Only after separate live-test authorization may the human send that challenge to the configured bot in a private chat. A valid claim becomes **pending**, never active automatically. `pair show` exposes only state, generation, numeric chat ID, and expiration. The local operator checks the expected user and observed chat, then explicitly confirms the exact generation before expiry. Confirmation consumes the challenge. Revocation changes the generation and suppresses queued operations and replies. Re-pairing requires a new challenge and local confirmation. The bot cannot issue or activate pairings through its SQL grants and trigger restrictions.

After separate authorization and token provisioning, start the adapter independently with its bot configuration:

```sh
npm run telegram -- start
```

Startup checks the authenticated database principal and single membership, acquires a session advisory lock for the bot, calls `getMe` to match the trusted bot ID, and rejects an existing webhook. It never deletes a webhook or discards pending updates to resolve a conflict. Graceful SIGINT/SIGTERM stops polling; unexpected database-session loss fails closed and aborts in-flight transport. A pooler in transaction mode is unsupported: the lock requires a dedicated stable PostgreSQL session.

## Commands and privacy

- `/help`: fixed usage text and limits of intake.
- `/new {"objective":"Synthetic local utility","context":"Record only."}`: strict JSON with only objective/context. The exact decoded JSON request text after `/new ` is retained as immutable original bytes, alongside normalized WorkItem fields and a digest.
- `/status ID`: only ID/revision, recorded status, and the statement that execution has not been authorized. An unavailable ID has a generic response.
- `/list` and `/list after ID`: at most ten project-scoped IDs/revisions, no objective/context. Keyset ordering gives stable forward pagination without offset duplicates; newly inserted earlier IDs require a fresh scan. This is not a snapshot across pages.
- `/cancel`: an explicit unavailable response; no cancellation privilege or artificial execution state is introduced.

Group/channel messages, bot senders, forwarded/edited messages, callbacks, wrong users/chats, and unpaired senders cannot invoke these operations. Unauthorized messages receive **no reply**. Request text never selects organization, owner, project, database role, execution, or publication permissions. Unknown commands from an authorized human receive a fixed safe response.

Request text is potentially sensitive. Telegram and the trusted host/database operator can access it; bot chats are not an end-to-end encrypted confidential intake channel. Do not send credentials, source files, datasets, private logs, or artifacts. Replies contain no request bodies or context. `protect_content` is a transport hint, not a confidentiality guarantee. A compromised trusted host or bot/database credential is outside this boundary. The bot login can write canonical intake for its one authorized owner/project; RLS is not proof that a Telegram sender is authentic. That proof depends on the trusted adapter, verified TLS API responses, and local pairing confirmation.

## Transactions, recovery, and bounds

Capture stores authorized update payloads and their digests before committing a higher polling offset. Unauthorized traffic changes only a bounded aggregate counter/cursor, never per-sender rows or replies. Digests cover update ID, message ID/date, numeric user/chat IDs, and exact decoded text; conflicting reuse stops for operator review. Challenge text is replaced with its hash before payload persistence.

Processing locks the pairing row, rechecks generation/chat/user and current database membership, and uses the **same authenticated connection and transaction** for canonical intake, its idempotency receipt, channel receipt, and reply outbox. Pair revocation acquires that same row lock: either intake commits before revocation, or it observes the revoked generation. Changes do not revoke a WorkItem already committed. Existing standalone intake transactions remain available. Idempotency keys are stable `telegram:BOT_ID:UPDATE_ID`, additionally scoped by existing organization/project/actor/operation SQL keys.

No transaction remains open during long polling or reply transport. The session lock prevents cooperating pollers from overlapping; connection loss aborts processing rather than reconnecting and assuming ownership. Pending captured operations and committed replies are recovered on a fresh startup. A reply attempt is durably counted before sending, and authorization/generation is checked again for each attempt. Revocation cannot retract an already in-flight API call. A response lost after remote delivery can lead to duplicate replies. There is no exactly-once delivery claim; WorkItem creation remains idempotent.

After seven days without received updates, polling probes from offset zero rather than assuming the previous sequence continues. Retained receipts deduplicate replay; conflicting reuse fails closed. Telegram's finite server retention still means a host offline too long can miss uncaptured messages. No adapter can recover data Telegram has expired. See the official [getUpdates and Update documentation](https://core.telegram.org/bots/api#getupdates).

Enforced conservative bounds:

| Resource | Bound |
| --- | --- |
| Input | 4,000 UTF-16 code units (conservative character bound), 16,000 UTF-8 bytes |
| HTTP | Fixed `api.telegram.org:443`, verified TLS, no redirects/fallback endpoint; 524,288 response bytes; 40-second total request deadline |
| Polling | 25-second long poll, 20 updates per batch, three transport attempts per tick with bounded backoff |
| Commands | Ten per rolling minute, token bucket burst three, one token per six seconds; state persists across restart |
| Processing | At most three attempts per update; database-clock delays of 60 seconds then 300 seconds; savepoint rollback preserves atomicity on failure |
| Replies | 2,048 bytes; three persisted send attempts; bounded retry delay up to 3,600 seconds |
| Channel retention | 1,000 update receipts and at most one outbox row per update; 20,000 serialized payload bytes per row |

Rate-limited commands are recorded as consumed without a reply or WorkItem; the human must submit a new message later. Exhausted operations remain explicitly recorded, not treated as success. A trusted database operator can inspect only installation/update IDs, state and attempt counts for diagnosis; do not dump payloads or original content into logs. Successful/exhausted incoming payloads are cleared; accepted original request bytes remain in canonical immutable intake history under AF-023 retention/privacy rules. Receipt hashes and minimal outbox bodies are retained. At the hard retention cap, capture rolls back and the process stops without advancing the offset. There is no automatic pruning that would destroy deduplication evidence. Archival, deletion, expanded capacity, multi-user support, and high-volume service operation require a separate reviewed retention design. Protect database backups as sensitive data. The fixed cap is for this small first installation, not an indefinite production service.

## Verification and live-test gate

Fake API tests never contact Telegram. Real PostgreSQL tests use only synthetic identities and content, including killed child processes and session termination. CI must run `db:setup-telegram` and `test:telegram` in addition to all existing suites; no live token is needed. See `AF029_VERIFICATION.md` for exact results and acceptance mapping.

A future live development-bot acceptance test requires explicit owner authorization and credentials. It must check actual identity/webhook handling, pending pairing plus local confirmation, one synthetic `/new`, duplicate/restart recovery, metadata-only status/list, and revocation. It must not execute the request or authorize subsequent milestones. No bot creation, token acquisition, or live API call is included in this increment's verification.

## Durable processing retry correction

Migration `004-telegram-processing-retries.cjs` is additive; migration 003 is unchanged. Stop the adapter, run `npm run db:migrate` with the separate migration identity, then restart it. Fresh installations apply both migrations; existing installations apply only 004. Previously attempted pending updates receive a conservative 300-second delay at upgrade. Existing exhausted receipts remain exhausted: this migration does not replay or resurrect requests. Existing RLS and grants are unchanged (table-level update privileges cover the new columns).

Processing retries are independent of reply delivery retries. An operational failure rolls back the WorkItem, intake receipt, rate-limit debit, and outbox writes to the savepoint. The attempt count, redacted `failure_kind=processing`, and next eligibility timestamp commit together. If the database session or transaction itself fails, the transaction rolls back and the adapter stops; recovery must reconnect before processing. No exception text is persisted.

The first and second failed processing attempts schedule eligibility after 60 and 300 seconds respectively, using PostgreSQL time. The third failed attempt becomes exhausted and clears its private payload. Unknown operational failures, including persistent database constraints and membership errors, follow this same bounded policy. Known malformed commands are terminal validation results: they are consumed once with the existing generic invalid-command reply, rather than retried. Authorization is rechecked on every eligible attempt; a revoked generation cannot create a WorkItem.

Selection is ascending update ID **among eligible updates**, not strict global arrival order. A delayed update does not block independent later commands. Consequently a status/list command can precede an earlier delayed request's eventual creation. Polling may continue while retries wait; offsets still advance only after durable capture, not processing success. Polling latency and downtime may delay retries further; there is no exact-time execution guarantee. The 1,000-receipt cap and fail-closed behavior are unchanged.

A trusted database operator with existing read access can inspect only metadata:

```sql
SELECT installation_id, update_id, state, attempts, next_attempt_at, failure_kind
FROM factory.telegram_updates
WHERE state IN ('pending', 'exhausted')
ORDER BY installation_id, update_id;
```

Use the existing bot-scoped or privileged operator connection; this correction grants no new administrator table access. Do not select payloads or log connection strings. Exhaustion is not success and does not automatically replay; an operator must investigate before asking the human to submit another request. Request bodies are not disclosed in failure metadata.
