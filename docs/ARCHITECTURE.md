# Bootstrap architecture — AF-001–003

Revision 2.1 of `MASTER_PLAN.md` is the approved baseline. Agentic Factory will develop software and computational experiments with versioned evidence and human oversight. This increment implements only contracts, configuration validation, and a local CLI. It cannot execute a WorkItem, run an experiment, or approve an external action.

## Initial profiles

- `software-general`: source and a report, with profile-specific software verification. A local utility needs no hosting, remote repository, or pull request.
- `ml-research`: source, experiment artifacts, and a report, with software, methodology, and findings verification. The fixture describes a synthetic CPU study; it contains no measured results. An investigation can be completed with an unfavorable result. A performance commitment remains unmet when its threshold is missed.

The future nontechnical goals-and-results interface is separate from this technical bootstrap. Node.js is the Factory's implementation environment; target projects declare their own environments and commands.

## Module boundaries

`cli` parses arguments, `runtime` composes validation, `adapters` reads local JSON, and `core` owns contracts and pure constraints. `ports` defines AgentRuntime, JobExecutor, and ArtifactStore interfaces. These interfaces do not claim implemented execution or storage capabilities. Core imports no provider SDKs, filesystem APIs, or transport clients.

Use one private TypeScript package, strict compilation, JSON configuration, ESLint, and Node's terminating test runner. Runtime schema validation checks untrusted JSON before use. Exact toolchain versions and a lockfile are recorded in AF-002. No empty packages, workflow DSL, database migrations, or provider implementations are needed.

## Configuration and policy

The CLI uses a trusted bootstrap policy defined in code. A project can tighten limits or add required verification but cannot disable mandatory controls, remove required checks, or grant capabilities. Project-declared capability requirements are compared with a separately supplied capability description. A configuration result means structurally compatible configuration, not proof of available tools, installed providers, authorization, or execution readiness.

WorkItems carry internal owner/project identity and optional origin references. Plans carry revisions, scope, deliverables, criteria, resources, and source identity. Evidence refers to a run and its plan/policy/source/environment revisions; data and split identities apply to research. Technical execution, verification, objective assessment, and human decisions remain independent. The bootstrap checks evidence completeness and identity only; it does not certify scientific validity or implement acceptance transitions.

## Future durable services

PostgreSQL will become the authoritative workflow store in AF-004. The persistent queue, leases, recovery, and cancellation follow in AF-005. AF-006 adds simulated workflows. These are not implemented by configuration validation.

AgentRuntime will perform reasoning/code changes. JobExecutor will run noninteractive computation without holding a model session open. ArtifactStore will keep project-scoped, versioned private outputs outside the coordinator database and public source repository. Optional external references never become mandatory domain identity.

Telegram is the first planned external control channel after AF-007/AF-023 and the persistent engine. AF-029 adds optional long polling over the same WorkItem services as local input; AF-030 adds revision-bound approvals after AF-012. PostgreSQL, not Telegram, remains authoritative. No token, bot, polling, pairing, or channel implementation exists here. An offline host cannot process requests. Future pairing uses numeric private-chat/user IDs, permissions, expiry, replay protection, deduplication, audit events, and minimal notifications.

## Pending decisions

- MIT is the current repository license, as recorded in the existing `LICENSE`, which is preserved unchanged. Any future licensing change is an owner decision.
- Persistence/queue libraries, sandbox technology, retention defaults, and real provider capabilities require their separately approved tickets.
- Broader runtime/OS support and remote hosting require actual validation. No production, publication, spending, or organization access is authorized by this scaffold.
