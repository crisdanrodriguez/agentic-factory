# AF-031 — Optional Slack local intake and status

AF-031 is a stacked local increment based on AF-029 commit `9cf24d6da01fd008930614c39911537741ea3077`. AF-029 acceptance status is unchanged. Slack is optional and independently started; CLI and Telegram require neither Slack tokens nor a Slack connection. No live Slack call, app installation, credential request, publication, or merge is included in deterministic verification.

## Reviewed interface and dependency decisions

The adapter uses Socket Mode and ordinary private direct-message text commands. It uses exactly an app-level token with `connections:write`, bot scopes `im:history` and `chat:write`, and subscription `message.im`. No slash-command registration, public endpoint, webhook, user token, channel scopes, OAuth installation flow, modal, button, or approval support is implemented. Do not add scopes to make a failed check pass.

Official references reviewed for this increment:

- [Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/): authenticated WebSocket delivery, hello app identity, envelope acknowledgments, disconnect/refresh handling. Acknowledgment uses `envelope_id`; durable deduplication uses the Events API `event_id`.
- [apps.connections.open](https://docs.slack.dev/reference/methods/apps.connections.open/): obtain a fresh temporary WebSocket URL using the app token. The URL is sensitive and never logged or persisted.
- [message.im](https://docs.slack.dev/reference/events/message.im/): direct-message subscription using `im:history`.
- [auth.test](https://docs.slack.dev/reference/methods/auth.test/): verify the bot token's team, bot, and user identities. This is combined with Socket Mode hello `app_id`, trusted local installation mapping, and each event's app/team/authorization fields; auth.test alone does not establish app identity.
- [chat.postMessage](https://docs.slack.dev/reference/methods/chat.postMessage/) and [rate limits](https://docs.slack.dev/apis/web-api/rate-limits/): metadata-only replies, per-channel pacing, HTTP 429 and Retry-After. Replies are not exactly once.

Node 24's native WebSocket client was considered, but its public constructor does not provide a maximum reassembled message size. The transport therefore pins the small MIT-licensed `ws` **8.22.0** client and `@types/ws` **8.18.2**, rather than a Slack framework. Package metadata and upstream [API documentation](https://github.com/websockets/ws/blob/master/doc/ws.md), [releases](https://github.com/websockets/ws/releases), and [advisories](https://github.com/websockets/ws/security/advisories) were reviewed. It has no mandatory runtime dependencies; optional native accelerators are not required. Installation uses `npm ci --ignore-scripts`, followed explicitly by `npm run deps:patch`; the accepted pg-boss patch remains unchanged. No install hooks are required. See `AF031_VERIFICATION.md` for actual dependency checks rather than treating package choice as a security guarantee.

## Trust and identity

One configured installation binds one workspace, app, bot identity, bot user identity, human user, and synthetic project. Separate non-privileged PostgreSQL bot and pairing-admin logins retain session_user identity; there is no shared multi-user database actor, SET ROLE impersonation, RLS bypass, or message-supplied project selection.

`auth.test` is verified at startup and every connection attempt. The first WebSocket message must be hello for the configured app; background recovery waits for that verification. Each Events API callback must match the stored team/app, have exactly one matching bot authorization, and explicitly identify a non-shared event. Only original human `message` events with `channel_type=im`, a D-prefixed channel, and the expected user are considered. Groups, channels, Slack Connect, threads, files, bot messages, edits, unsupported subtypes, and interactive callbacks are rejected. Unknown or ambiguous transport identity fails closed.

The local operator issues a random 32-byte challenge for the configured project/user, expiring after five minutes. A private `pair CODE` claim can only become pending. The operator examines the channel/generation locally and explicitly confirms before activation. Hashes, never plaintext challenges, are stored in pending payloads. Revocation increments generation. Pairing row locks order revocation relative to capture and intake; every processing/reply attempt rechecks membership and pairing. A committed WorkItem cannot be retroactively revoked, and an in-flight remote reply cannot be recalled.

The host, adapter code, database administrator, and credentials are trusted. RLS isolates the configured principal/project; it does not independently authenticate a Slack sender against a compromised bot credential. The bot's direct SQL intake rights are intentionally limited to its existing owner/project. Request text and provenance are private database data but also transit Slack; this is not an end-to-end confidential intake channel.

## Database installation and grants

Apply additive migration `005-slack.cjs` using the migration role. It extends the intake source-kind constraint to include `slack`, preserving file/CLI/Telegram. Previous migrations are unchanged. It creates exactly four forced-RLS tables:

| Table | Purpose |
| --- | --- |
| `slack_installations` | Trusted team/app/bot/user/principal/project/owner mapping; no runtime writes |
| `slack_pairings` | Generation, challenge hash/expiry, pending/active/revoked state, channel binding, bounded rate state and reply pacing |
| `slack_updates` | Stable event identity/digest, private pending payload, processing state, three-attempt retry schedule |
| `slack_outbox` | Minimal replies, generation, delivery state, attempts and eligibility |

Use distinct bot/admin LOGIN roles with NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOINHERIT, NOBYPASSRLS and no inherited role memberships. Each receives exactly one project membership with the trusted owner, `can_write=true`, `can_approve=false`. Both receive schema USAGE and SELECT on memberships, installations, and pairings. The administrator receives only pairing UPDATE on generation/state/challenge_hash/expires_at/chat_id/claimed_at. The bot receives pairing UPDATE on state/chat_id/claimed_at plus rejected_count/command_times/tokens/token_time/next_send_at, SELECT/INSERT/UPDATE on update receipts and outbox, SELECT/INSERT on the three canonical intake tables, and UPDATE only on intake_heads(version). No runtime DELETE, TRUNCATE, schema creation, membership/installation writes, queue, Run, or approval grants.

The migration administrator inserts the trusted installation row and initial pairing row. Stop the adapter before modifying identity mappings; revoke and re-enroll. `scripts/setup-local-slack.mjs` is an executable reference restricted to the disposable `agentic_factory_local` test database, with explicitly synthetic credentials and IDs. Never use those shared fixture credentials for a live installation. The live Telegram acceptance environment is separate and must not be touched by these fixtures.

## Configuration and operation

Use Node 24.22.0/npm 11.9.0. Keep operator-owned configuration outside Git and project workspaces, in a directory mode 0700 with regular files mode 0600. The shared private-file reader rejects unsafe paths, links, oversized/malformed files, and replacement. `FACTORY_SLACK_CONFIG` points to the private absolute path. Example shape (synthetic identifiers; environment variable names only):

```json
{
  "installationId": "synthetic-slack",
  "principal": "af_slack_bot",
  "databaseUrlEnvironment": "FACTORY_SLACK_BOT_URL",
  "appTokenEnvironment": "FACTORY_SLACK_APP_TOKEN",
  "botTokenEnvironment": "FACTORY_SLACK_BOT_TOKEN"
}
```

The separate admin configuration uses the admin principal and URL variable and omits token variables. Inject credentials privately; never inherit migration/admin/provider credentials into the bot process. No token, temporary WebSocket URL, or database URL belongs in logs, source control, CLI arguments, or ordinary reports.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run deps:patch
npm run db:migrate
npm run build
npm run slack -- --help
```

After separately authorized installation and credential provisioning only:

```sh
npm run slack -- pair issue PROJECT USER
npm run slack -- pair show
npm run slack -- pair confirm USER CHANNEL GENERATION
npm run slack -- pair revoke
npm run slack -- start
```

Pair issue intentionally displays a secret in the private operator terminal; never record it. `pair show` contains private binding metadata and is not an ordinary public report. No live installation or app activation is authorized by this document.

Commands are `help`, `new {"objective":"...","context":"..."}`, `status ID`, `list [after ID]`, and `cancel` (explicitly unavailable). New requests retain the exact decoded event text after `new ` as Slack-source provenance, and use canonical WorkItem origin `local`. Status only reports recorded ID/revision and lack of execution authorization. List returns at most ten project-scoped IDs/revisions; no objective/context. Text formatting and link/media unfurling are disabled in replies. There are no execution, provider, sandbox, approval, or publication ports in this adapter.

## Delivery, recovery, and bounds

A dedicated session advisory lock prevents cooperating instances for the same team/app. The control connection uses separate short database timeouts from the processing connection. Capture locks pairing, validates membership, and commits the receipt before acknowledging the envelope. Processing and replies are not part of acknowledgment. Capture exceeding the 2.5-second acknowledgment budget closes the socket; a capture that subsequently commits is safely deduplicated on redelivery. Failed or conflicting capture is never acknowledged as accepted. Unauthorized messages are durably counted in one bounded aggregate without allocating per-sender rows or sending replies.

Stable event IDs, scoped by installation and bound team/app, deduplicate across different envelope IDs. The digest binds normalized relevant message identity/content. Conflicting reuse stops for review. Canonical WorkItem, revision, intake receipt, update completion, and reply insertion share one authenticated transaction/savepoint. Processing failures roll back all operation effects and persist attempts/deadlines. The first and second failure defer 60 and 300 seconds; the third exhausts. Invalid commands receive a terminal generic validation response rather than operational retries. Delayed events do not block independent eligible events. Successful/exhausted private pending payloads are cleared; canonical accepted originals remain under existing retention rules.

Reply attempts commit before sending, with one-second pacing and persisted backoff across the installation on failure. HTTP 429 Retry-After is honored up to a supported 3,600 seconds; malformed or greater values stop that delivery permanently rather than retrying earlier. Three attempts maximum; permanent API failures exhaust without further sends. Unknown send outcomes can duplicate replies after restart but never create another WorkItem. Operator inspection should select IDs/state/attempts/deadlines only, never payloads or credentials.

Each reconnect obtains a fresh apps.connections.open URL, repeats token identity validation, and checks hello app identity. Only TLS wss-primary/wss-backup/numeric wss hosts under slack.com with `/link/` are accepted. Compression and redirects are disabled. A 20-second ping/pong heartbeat detects dead sessions; a missing pong closes the connection. Refresh/warning reconnect; link_disabled stops. Three consecutive transport failures stop for operator review; temporary successful refreshes do not imply indefinite outage recovery. Database session loss aborts all work; restarting requires reacquiring ownership. No transaction spans network I/O. Slack's service retry/retention limits can still lose events never durably captured.

Limits: 65,536-byte reassembled WebSocket messages; 20 buffered envelopes; 4,000 input code units/16,000 UTF-8 bytes; 524,288-byte HTTP responses; 15-second HTTP deadlines; 10-second handshake; 10 commands/minute with burst three; 2,048-byte replies; 1,000 retained event receipts and one reply per event. Rate-limited commands are consumed without work/reply. The hard receipt cap stops capture without deleting evidence or acknowledging the new event. No automatic archival/pruning/replay is implemented. Exhausted operations need trusted operator review, not silent resubmission.

## Verification and future live gate

See `AF031_VERIFICATION.md` for exact tests and limitations. Mandatory CI includes Slack tests plus all prior Telegram, intake, state, queue, simulation, dependency and Linux AMD64 sandbox gates. Fake WebSocket/API tests make no Slack calls. A future development-app test requires separate owner approval, privately installed minimal scopes, trusted workspace/app/bot/human identity provisioning, private pairing/confirmation, synthetic DM requests, restart/revocation, and token revocation/cleanup. No live app was installed or tested here. Existing macOS ARM64 sandbox restrictions remain unchanged.
