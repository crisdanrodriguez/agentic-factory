# Bootstrap trust boundaries and privacy

This document describes the AF-001–003 boundary and future requirements. It is not a claim that execution isolation, authentication, or durable approvals have been implemented.

| Input or component | Threat | Boundary or requirement |
|---|---|---|
| Project JSON, issue text, agent output | Policy injection or fabricated authority | Validate input; trusted global policy cannot be supplied or relaxed by project JSON. Identity fields are references, not authentication. |
| Configuration commands | Arbitrary code execution | Validation treats commands as data and never invokes them. Execution is deferred to the restricted broker. |
| Verification claims | Missing, stale, skipped, or fabricated evidence | Require matching revision context and nonempty evidence references for every required successful check. Completeness does not establish truth. |
| Local configuration files | Sensitive input in diagnostics, excessive input | Read only the explicitly requested configuration; bound file size and emit safe structural errors without echoing values or file contents. This CLI is not a filesystem sandbox. |
| Future agents and project processes | Secret theft or host access | Keep master keys, coordinator credentials, production secrets, unrestricted mounts, and Docker sockets outside project sandboxes. A worktree is not isolation. |
| Future artifacts | Cross-project access or accidental publication | Private project-scoped storage, immutable identity, quotas, retention, and authorized export belong to later tickets. A digest proves integrity, not scientific truth. |
| Future Telegram messages | Spoofing, replay, duplicate delivery, data disclosure | Pair numeric user/private-chat IDs locally; authorize every action; bind approvals to revision and expiry. No groups, arbitrary shell commands, or private artifact transfer. |

## Sources of truth

Trusted installation policy governs allowed effects. Project configuration describes requested work and can only tighten that policy. In this bootstrap no workflow state is persisted. PostgreSQL will hold workflow, approval, job, and evidence metadata after the persistence ticket. External messages, tickets, and model responses cannot replace that state or grant permissions.

## Data destinations

The bootstrap CLI reads a local configuration and writes a concise result to stdout/stderr. It makes no network calls and creates no workflow/artifact store. Examples contain synthetic identifiers only. Dependency installation contacts the package registry; repository CI will download dependencies and produce check logs when the owner later pushes the workflow. CI uses GitHub-hosted runners, read-only repository permissions, no business secrets, and no publication or deployment.

Future model/compute providers may receive source or data only under separately authorized configuration. Self-hosted coordination does not imply local inference. Telegram bot messages pass through Telegram infrastructure and should carry minimal metadata, never secrets, full logs, source, datasets, or weights.

## Review boundaries

Changes to CI, policies, instructions, evaluation inputs, authentication, authorization, sandbox settings, and migrations require explicit scope review. The approved bootstrap covers basic CI and pure policy constraints only. No live provider testing, business access, purchases, publication, or production actions are included. End-to-end authorization, adversarial sandbox tests, recovery, revocation, and retention remain unimplemented.
