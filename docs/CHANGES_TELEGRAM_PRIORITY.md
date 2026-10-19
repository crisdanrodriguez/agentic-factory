# Revision 2.1 — Telegram Priority Amendment

## Decision

Keep Revision 2 as the product and architecture baseline. The single priority change is to implement Telegram as the first external **control channel** after core/local WorkItem functionality is reliable, before GitHub/Codex integration. Do not re-prioritize remote/cloud agent execution, subscription billing, deployment, or a web-only workflow. All source files, documentation, and engineering materials remain in English.

## Unchanged

- Open-source, self-hosted-first, provider-agnostic architecture; public core in the author's personal GitHub, separate installations for other users.
- Independent permissions, data, and credentials for the MOLVEX and ADDIV GitHub organizations; business repositories stay in their existing organizations.
- General software and ML research as early project profiles; deployment, GitHub, and PR optional according to the approved plan.
- Codex as the first planned real coding runtime; Claude Code as a later interchangeable runtime; deterministic tests, bounded repairs, human approvals, versioned evidence, and parallel-capable design.
- Bootstrap AF-001 to AF-003 first; no actual Telegram, cloud provider, or production access in this increment.

## Changes to the Roadmap

| When | Ticket | Result |
|---|---|---|
| After AF-004–006 and AF-007/AF-023; before AF-024–025 and GitHub/Codex adapters | **AF-029 (NEW)** | Optional local long-polling Telegram bot: owner pairing, `/new`, `/status`, `/list`, `/help`, and authorized `/cancel` |
| After AF-012 and AF-029 | **AF-030 (NEW)** | Revision-bound `/approve` and `/reject` and minimal opt-in notifications |
| AF-008–011 as before, but after AF-029 in the preferred execution order | Existing | GitHub App, GitHub Issues/PR and Codex integration |
| Later | Existing roadmap | Claude, Linear, organizations, parallel workers, external self-hosted validation, optional deployments and consumer UX |

Tickets AF-001 through AF-028 keep their identifiers. Only small wording changes to AF-001/AF-003 and the external-user release check (AF-022) reflect Telegram optionality; the previous 84 acceptance criteria are otherwise preserved. Two new tickets add eight criteria (92 total). Numbering is not execution order; stage and dependencies control implementation.

## Architecture and UX

Telegram is an untrusted transport adapter over a stable application service: a user request becomes a project-authorized WorkItem, and a human approval becomes a durable revision-bound approval record. The bot does not have credentials to run code, write to GitHub, or access sandbox secrets. It is not the authoritative state store; PostgreSQL remains authoritative. CLI remains available without Telegram.

Early local mode uses Telegram long polling: no public webhook or remote worker required. **When the Mac or self-hosted machine is off, no request is processed.** Always-on behavior requires an always-on host as a later deployment decision. Remote Claude Code execution is not a prerequisite.

Each self-hosted installer registers their **own bot** with BotFather. Pair with a short-lived code and verify numeric Telegram user and private chat IDs against local project authorization. No groups initially. Never publish tokens or private artifacts in messages; document that ordinary Telegram bot chats involve Telegram infrastructure and should not be used to transmit sensitive code/data.

## First Coding Block

AF-001–003 only. Read `docs/FIRST_PROMPT.txt`, ask Codex for a scoped plan, review it, and then use `docs/AFTER_APPROVAL_PROMPT.txt`. Do not create Telegram credentials before AF-029.

## Reference Documentation

- https://core.telegram.org/bots/features
- https://core.telegram.org/bots/api
