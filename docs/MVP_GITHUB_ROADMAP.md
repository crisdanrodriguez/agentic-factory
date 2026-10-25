# GitHub-centered MVP roadmap

The accepted core (AF-001–007 and AF-023) remains authoritative. Telegram
and Slack are optional paused adapters; this roadmap does not alter their
branches or draft pull requests.

## Capability map

The repository already provides WorkItem persistence, organization/project RLS,
revisioned intake, durable workflow state, queue leases, sandbox execution on
the reviewed Linux AMD64 scope, deterministic software and ML simulations, and
separate execution, verification, objective, and human-decision states.

MVP-01 now includes the single-installation GitHub App transport, bounded
issue polling, model-backed refinement through an explicitly authorized local
Codex transport, and revision-bound approval. Codex implementation, Claude
review, parallel worktrees, controlled integration, and Draft PR publishing
remain outside this increment. Existing agent and executor ports remain seams
for later increments.

## Four delivery increments

1. **MVP-01 — issue intake and plan approval.** Authenticate one approved
   GitHub App installation and repository, poll issues with durable idempotency,
   map an issue to the canonical WorkItem, refine through a provider-neutral
   `PlanRefiner`, and create/approve a revision-bound workflow plan.
2. **MVP-02 — Codex execution and verification.** Add an opt-in Codex adapter,
   isolated worktrees, deterministic profile checks, bounded technical repair,
   and evidence tied to the approved revision.
3. **MVP-03 — parallel implementation and review.** Decompose an approved plan
   into two independently scoped worktrees, run two Codex tasks concurrently,
   integrate through a controlled coordinator, and perform read-only Claude
   review. Human approval remains required.
4. **MVP-04 — Draft PR and recovery.** Add installation-scoped Draft PR
   publication, crash reconciliation, revision-bound evidence, human feedback,
   and a bounded repair loop. Merge and deployment remain manual and outside
   this MVP.

## First demo

Use one synthetic software repository and one explicitly approved GitHub App
installation. An owner opens one real issue. The adapter records one canonical
`external-ticket` WorkItem and receipt, produces one revision-bound plan, and
waits for explicit human approval. Later increments implement two concurrent
subtasks, deterministic tests, independent review, bounded corrections, and a
Draft PR. No automatic merge, deployment, paid agent use, or production data is
allowed.

The current MVP-01 implementation provides the validated intake and approval
contracts, an additive migration for GitHub provenance, a bounded polling seam,
revision-bound comment formatting, and an explicitly authorized Codex
refinement seam. One owner-authorized read-only discovery against the approved
test repository has passed without creating WorkItems or advancing the cursor.
Synchronization, model calls, comments, approvals, and execution remain
separate owner-approved gates and are not accepted by discovery evidence.

The native REST transport uses Node's TLS HTTPS facilities, a fixed
`api.github.com` origin, installation-token exchange, repository identity
verification, bounded polling and no automatic comment retry after an uncertain
POST. The orchestration checkpoint is durable through an injected checkpoint
store and never starts a Run; approval only changes the persisted workflow
decision.
