# Trust boundaries and privacy — AF-001–007

## AF-007 acceptance status and supported execution boundary

Linux AMD64 implementation and synthetic verification are completed on the exact
reviewed runtime. The owner accepted this limited scope; PR #3 was squash-merged in `df1f4f5` and main CI passed. Normal broker
execution rejects ARM64 and every other unverified platform; macOS ARM64
validation remains outstanding. This is not general hostile-workload or
production security certification. See SANDBOX.md and AF007_VERIFICATION.md
for exact versions, hosted evidence, trust boundaries and remaining limitations.

AF-007 adds a separate trusted broker, private authenticated Unix channel,
trusted scope/policy grants, bounded non-root network-disabled job containers,
AppArmor process checks, cancellation and durable cleanup/recovery. Coordinator
credentials and Docker control remain outside project containers. This job
boundary is distinct from future network-capable Agent Runtime implementations.

## Milestone 2 implementation status

AF-001–003 are accepted and merged. AF-004–006 are accepted and merged in `2705aac`; the owner confirmed the successful main-branch GitHub Actions run. PostgreSQL stores workflow and revision metadata; pg-boss owns durable claims, retries, and expiration; synthetic adapters exercise both profiles. The accepted declaration correction remains explicit and checksum-guarded. See `MILESTONE_2_VERIFICATION.md` and `DATABASE.md`. Bootstrap validation remains independent of the persistent simulation.


The sections below describe the accepted Milestone 2 simulation baseline, separately from the AF-007 review status above. Durable simulation approval records exist; target execution isolation and end-user authentication do not.

| Input or component | Threat | Boundary or requirement |
|---|---|---|
| Project JSON, issue text, agent output | Policy injection or fabricated authority | Validate input; trusted global policy cannot be supplied or relaxed by project JSON. Identity fields are references, not authentication. |
| Configuration commands | Arbitrary code execution | Validation treats commands as data and never invokes them. Execution is deferred to the restricted broker. |
| Verification claims | Missing, stale, skipped, or fabricated evidence | Require matching revision context and nonempty evidence references for every required successful check. Completeness does not establish truth. |
| Local configuration files | Sensitive input in diagnostics, excessive input | Read only the explicitly requested configuration; bound file size and emit safe structural errors without echoing values or file contents. This CLI is not a filesystem sandbox. |
| Future agents and project processes | Secret theft or host access | Keep master keys, coordinator credentials, production secrets, unrestricted mounts, and Docker sockets outside project sandboxes. A worktree is not isolation. |
| Future artifacts | Cross-project access or accidental publication | Private project-scoped storage, immutable identity, quotas, retention, and authorized export belong to later tickets. A digest proves integrity, not scientific truth. |
| Future Telegram messages | Spoofing, replay, duplicate delivery, data disclosure | Pair numeric user/private-chat IDs locally; authorize every action; bind approvals to revision and expiry. No groups, arbitrary shell commands, or private artifact transfer. |

## Current simulation boundary

The runtime database role cannot migrate, bypass RLS, grant itself membership, or assume the migration role. Integration tests exercise real non-privileged logins across organizations/projects. The coordinator and its queue remain trusted infrastructure: runtime SQL access is not exposed to a user, target process, or AI provider. A supplied organization/project identifier is never proof of authority.

Synthetic adapters execute no shell commands or model training. Their local temporary journal is a test double, with context checks and private file modes; it is not a security sandbox or the later ArtifactStore. CPU, memory, artifact quotas, retention, real external cancellation, and real-provider authorization remain unimplemented. Failed infrastructure wakes remain inspectable in pg-boss and require operator investigation; there is no automatic unlimited redrive or recovery CLI. No scientific claim follows from synthetic passing evidence.

## Sources of truth

Trusted installation policy governs allowed effects. Project configuration describes requested work and can only tighten that policy. The validation-only CLI persists no workflow state. The Milestone 2 engine stores workflow, approval, job, and evidence metadata in PostgreSQL. External messages, tickets, and model responses cannot replace that state or grant permissions.

## Data destinations

The bootstrap CLI reads a local configuration and writes a concise result to stdout/stderr. It makes no network calls and creates no workflow/artifact store. Examples contain synthetic identifiers only. Dependency installation contacts the package registry; repository CI will download dependencies and produce check logs when the owner later pushes the workflow. CI uses GitHub-hosted runners, read-only repository permissions, no business secrets, and no publication or deployment. Its isolated PostgreSQL service contains only synthetic data and public synthetic credentials; migrations and runtime tests use separate database roles.

The local synthetic suites additionally write synthetic state/audit metadata to loopback PostgreSQL and temporary private fake-job journals. No business data or real source/artifacts are sent to providers.

Future model/compute providers may receive source or data only under separately authorized configuration. Self-hosted coordination does not imply local inference. Telegram bot messages pass through Telegram infrastructure and should carry minimal metadata, never secrets, full logs, source, datasets, or weights.

## Review boundaries

Changes to CI, policies, instructions, evaluation inputs, authentication, authorization, sandbox settings, and migrations require explicit scope review. The approved Milestone 2 scope adds persistent simulations and tests of database-role authorization, lease recovery, and process restart. No live provider testing, business access, purchases, publication, or production actions are included. End-user authorization, adversarial sandbox tests, database disaster recovery, revocation, and retention remain future work.

Synthetic journal access now resolves organization/project authority against PostgreSQL membership and persisted run context for every operation. Organization scope participates in both identity and access checks, including when two organizations reuse every local identifier. This protects the intended API boundary; arbitrary code with direct access to coordinator files or credentials remains trusted and is not sandboxed by this change.

## AF-023 intake boundary

Local request files are untrusted data, never authorization. Trusted private installation configuration selects an inbox and project scope; authenticated PostgreSQL memberships establish owner identity and permissions. Forced RLS and SQL checks protect intake ownership and actor identity even for direct runtime SQL. Original requests remain sensitive private database records. Ordinary errors and create/revise receipts omit content and private paths; explicit `show` output is sensitive. See `LOCAL_INTAKE.md` for file protections, host-user trust, retention, and recovery limits. Intake does not authorize or schedule execution.
