# Architecture — AF-001–006

## Milestone 2 implementation status

AF-001–003 are accepted and merged. AF-004–006 are accepted and merged in `2705aac`; the owner confirmed the successful main-branch GitHub Actions run. PostgreSQL stores workflow and revision metadata; pg-boss owns durable claims, retries, and expiration; synthetic adapters exercise both profiles. The accepted declaration correction remains explicit and checksum-guarded. See `MILESTONE_2_VERIFICATION.md` and `DATABASE.md`. Bootstrap validation remains independently usable without database access.


Revision 2.1 of `MASTER_PLAN.md` is the approved baseline. Agentic Factory will develop software and computational experiments with versioned evidence and human oversight. The accepted baseline includes contracts, configuration validation, a local validation CLI, and persistent synthetic workflows. Real agents, real experiments, and external actions remain outside the accepted baseline. AF-007 job sandbox implementation and synthetic verification are completed on the reviewed Linux AMD64 runtime; the owner accepted this limited scope, PR #3 was squash-merged in `df1f4f5`, and main CI passed. Normal broker execution rejects unverified ARM64 runtimes. macOS ARM64 validation is outstanding; no general hostile-workload or production security certification is claimed.

## Initial profiles

- `software-general`: source and a report, with profile-specific software verification. A local utility needs no hosting, remote repository, or pull request.
- `ml-research`: source, experiment artifacts, and a report, with software, methodology, and findings verification. The fixture describes a synthetic CPU study; it contains no measured results. An investigation can be completed with an unfavorable result. A performance commitment remains unmet when its threshold is missed.

The future nontechnical goals-and-results interface is separate from this technical bootstrap. Node.js is the Factory's implementation environment; target projects declare their own environments and commands.

## Implemented persistent simulation architecture

`core/workflow.ts` owns pure transitions. One sequential profile step tracks technical attempts, explicit research variants, generation, job identity, four distinct outcomes, and revision-bound approval/evidence. A technical retry keeps the same experimental variant; a new variant requires a verified preceding result and the approved plan's remaining variant budget. Each variant has its own bounded technical attempts. Previous variant outcomes remain in append-only audit events. General subtask dependency scheduling and parallel workers remain later work.

`PostgresWorkflowStore` authorizes from the authenticated database role's project membership and applies optimistic workflow versions, event receipts, immutable revisions, and state in a transaction. Duplicate event IDs return their original result only when the command digest matches. RLS remains enforced for non-privileged runtime roles. `WorkflowQueue` inserts wakes and settles jobs using that same transaction.

`SingleWorker` holds one session advisory lock. Its authoritative transaction runs on that same session, so losing coordinator ownership rolls back its writes. pg-boss attempt identity fences stale claims; persisted claim timestamps are checked before and after the handler. Stale workflow-version wakes are consumed without invoking a handler. No second lease table or independent queue scheduler was added. Concurrent `once` calls are rejected. Waiting for approval has no wake; an external-job wait has a delayed reconciliation wake and releases processing between polls. Other ready runs can advance meanwhile. Handler transactions have five-second statement and ten-second transaction limits; they are not long-running compute sessions.

`runtime/simulation.ts` composes the store/queue with synthetic AgentRuntime and JobExecutor implementations. An idempotent private temporary job journal models submission and reconciliation across process restarts, including a submission accepted before its workflow transaction commits. Job completion, timeout, cancellation, and verification remain separate transitions. Verification and objective decisions use explicitly synthetic fixtures, never real measurements; human acceptance remains a separate command. The journal is not a production artifact store or a promise of exactly-once real-provider effects.

## Module boundaries

`cli` parses arguments, `runtime` composes validation, `adapters` reads local JSON, and `core` owns contracts and pure constraints. `ports` defines AgentRuntime, JobExecutor, and ArtifactStore interfaces. Their synthetic implementations exercise contracts only; real execution and artifact storage remain future work. Core imports no provider SDKs, filesystem APIs, or transport clients.

Use one private TypeScript package, strict compilation, JSON configuration, ESLint, and Node's terminating test runner. Runtime schema validation checks untrusted JSON before use. Exact toolchain versions and a lockfile are recorded in AF-002. No empty packages or workflow DSL are introduced. Database migrations belong to the persistent engine; real provider implementations remain deferred.

## Configuration and policy

The CLI uses a trusted bootstrap policy defined in code. A project can tighten limits or add required verification but cannot disable mandatory controls, remove required checks, or grant capabilities. Project-declared capability requirements are compared with a separately supplied capability description. A configuration result means structurally compatible configuration, not proof of available tools, installed providers, authorization, or execution readiness.

WorkItems carry internal owner/project identity and optional origin references. Plans carry revisions, scope, deliverables, criteria, resources, and source identity. Evidence refers to a run and its plan/policy/source/environment revisions; data and split identities apply to research. Technical execution, verification, objective assessment, and human decisions remain independent. Verification checks evidence completeness and identity only; it does not certify scientific validity. The persistent simulation adds explicit acceptance transitions, with the human decision supplied separately from technical evidence.

## Durable services and future integrations

PostgreSQL is the authoritative workflow store in AF-004. AF-005 implements the persistent queue, lease recovery, and cancellation. AF-006 composes synthetic workflows. These services are exercised separately from the configuration-validation CLI.

AgentRuntime will perform reasoning/code changes. JobExecutor will run noninteractive computation without holding a model session open. ArtifactStore will keep project-scoped, versioned private outputs outside the coordinator database and public source repository. Optional external references never become mandatory domain identity.

Telegram is the first planned external control channel after AF-007/AF-023 and the persistent engine. AF-029 adds optional long polling over the same WorkItem services as local input; AF-030 adds revision-bound approvals after AF-012. PostgreSQL, not Telegram, remains authoritative. No token, bot, polling, pairing, or channel implementation exists here. An offline host cannot process requests. Future pairing uses numeric private-chat/user IDs, permissions, expiry, replay protection, deduplication, audit events, and minimal notifications.

## Pending decisions

- MIT is the current repository license, as recorded in the existing `LICENSE`, which is preserved unchanged. Any future licensing change is an owner decision.
- Persistence uses pinned pg 8.23.1, pg-boss 12.38.0, and node-pg-migrate 9.0.0. Sandbox technology, retention defaults, and real provider capabilities remain later decisions.
- Broader runtime/OS support and remote hosting require actual validation. No production, publication, spending, or organization access is authorized by this scaffold.

## Final review corrections

The synthetic composition binds an installation-selected organization/project scope. Every fake job operation verifies write membership and the stored run context through the authenticated PostgreSQL role; supplied identifiers alone cannot authorize access. The resolved scope is included in the job key and persisted journal record, and is checked before inspection or cancellation. Scope is not inferred from a job filename or request prefix. The fake remains coordinator-owned trusted test infrastructure, not a public authorization API.

Synthetic completion uses its persisted deterministic schedule: completion strictly before the deadline wins even when reconciliation occurs after the deadline. At or beyond the deadline without earlier completion, the fake fails. Terminal outcomes remain stable on repeated inspection. This timing rule is exclusive to the fake; a real executor must obtain reliable external completion evidence.

New completion commands require artifact references in `kind:identifier` form, with kinds `source`, `report`, or `experiment-artifacts`. Identifiers contain 1–128 ASCII letters/digits/dots/underscores/hyphens and start with a letter or digit. References must be unique and cover every required deliverable kind. Valid reference metadata does not prove physical existence, integrity, or scientific validity; actual storage verification remains AF-024. Historical audit records are not rewritten. Old temporary synthetic journals without scope are rejected rather than silently trusted.
