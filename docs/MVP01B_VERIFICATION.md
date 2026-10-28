# MVP-01B — Independent Durable GitHub Intake

MVP-01B is implemented from main commit `9bac1468f5c76bc09aaff6cb3b547f6a4fb5a356`
on `feat/mvp-01b-durable-intake`. It separates read-only discovery, durable
GitHub intake, and Codex refinement.

Durable intake records a canonical WorkItem, immutable revision, idempotency
receipt, and PostgreSQL refinement intent in one transaction. PostgreSQL
enforces one GitHub origin per organization/project through
`factory.github_origins`. Refinement is manually triggered and scans
`refinement_intents` in PostgreSQL, the single source of truth for scheduling
and claims. There is no background scheduler or refinement queue. A worker
lease, revision fence, bounded retry count, cancellation flag, and supersession
state protect restart recovery. pg-boss remains reserved for core workflow
execution.

Issue polling replays a one-second overlap behind the committed `updated_at`
cursor. Canonical-origin reconciliation ignores older snapshots, deduplicates
same-timestamp identical objective/context, and records a same-timestamp content
change as a new immutable revision. This relies on the GitHub list response
being the current issue snapshot; provider timestamps alone cannot order two
different payloads carrying the same timestamp.

The dedicated `af_github_intake` role cannot insert or update workflow Runs and
has no approval permission. The separate `af_github_refiner` role can create
pending Runs but cannot update Runs, events, or approval state.

All live GitHub, Codex, comment, approval, execution, and publication gates
remain disabled. No external calls were made for this increment.

## Offline verification

The focused MVP-01B suite contains eight deterministic tests and three
PostgreSQL integration tests covering atomic canonical-origin intake, rollback,
lease replacement, stale-worker fencing, supersession, cancellation, forced
RLS, least-privilege grants, duplicate-origin concurrency, PostgreSQL 18.6
identity, and recovery after the caller loses the post-commit acknowledgment.
That final fault injection drops the application response after PostgreSQL has
committed; it does not emulate a network failure during the COMMIT protocol.
The exact
command is:

```text
npm run test:mvp01b
```

Docker was unavailable on the latest run because the configured Docker Desktop
socket did not exist. All three PostgreSQL integration tests were skipped, so
database acceptance is not claimed for this correction. An earlier isolated
PostgreSQL 18.6 run applied migrations 001–004, verified a no-op rerun, forced
RLS, role grants, and concurrent canonical-origin intake; that historical
evidence predates the queue and worker correction. The local deterministic
suite passed 113/113 tests; the focused MVP-01B suite passed 8 deterministic
tests and skipped all 3 PostgreSQL tests; dependency checks passed 7/7; lint,
strict typecheck, build, and `git diff --check` passed. Hosted CI now requires
the isolated PostgreSQL service, asserts PostgreSQL 18.6 and reruns migrations
to verify the no-op path; it fails if required database URLs are missing. No
live GitHub or Codex calls were made. A dropped TCP acknowledgment during the
COMMIT protocol and crash injection at every PostgreSQL worker checkpoint
remain unverified.

## Acceptance status

| Capability | Status |
| --- | --- |
| Read-only GitHub discovery | Accepted previously; historical evidence preserved |
| Durable WorkItem/revision/receipt/intent transaction | Offline implementation complete; PostgreSQL acceptance pending |
| Cursor acknowledgement after durable intake | Offline implementation complete; live intake acceptance pending |
| Refinement leases, fencing, retries, cancellation, restart | Offline implementation complete; PostgreSQL acceptance pending |
| Codex provider call | Disabled; no real model invocation performed |
| GitHub comments, approvals, execution, PR publication | Disabled and out of scope |
