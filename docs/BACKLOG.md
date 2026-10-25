# Agentic Factory — Backlog, Revision 2.1 (Telegram Priority Amendment)

**Status:** AF-001–003 accepted and merged in `4a0ce53`; AF-004–006 accepted and merged in `2705aac`; AF-007 is accepted and merged for its reviewed Linux AMD64 synthetic scope; AF-023 is accepted and merged in `ce55b8d`. The GitHub-centered MVP is now the active planning priority. AF-029 Telegram and AF-031 Slack remain optional paused increments; their branches and draft pull requests are preserved and are not part of this MVP implementation. Other later tickets remain unimplemented.
AF-001 through AF-028 remain from revision 2. AF-029 and AF-030 are new Telegram tickets; all previous acceptance criteria are preserved. Numbering alone does not define execution order. See the stage table in the master plan.

**Accepted first increment:** AF-001, AF-002, and AF-003. **Latest accepted increment:** AF-023 local intake, merged and main-verified. The current MVP priority is the GitHub-centered lifecycle documented in `docs/MVP_GITHUB_ROADMAP.md`; AF-029 Telegram and AF-031 Slack are optional paused adapters. AF-007: Linux AMD64 implementation and verification completed, accepted and squash-merged in `df1f4f5`; main CI passed. macOS ARM64 validation remains outstanding. Do not execute this entire document at once.

Web extensions and the nontechnical experience are separate roadmap branches. Telegram is an early optional input/control channel and does not block the first useful software and research workflows without messaging. AF-029 follows AF-023 and precedes GitHub/Codex adapter development; AF-030 follows the versioned approval engine in AF-012. If earlier implementations already exist, review their evidence before accepting or reopening a ticket.

**Language requirement:** all project-authored files, documentation, prompts, code comments, test descriptions, CLI messages, and engineering materials must be in English, as defined in AGENTS.md. The original 28 tickets retain their acceptance criteria; two English-language Telegram tickets are added.

## Current GitHub MVP-01 increment

**Status:** Active in the isolated `feat/mvp-01-github-control` worktree. This
increment combines the smallest AF-008/009/010/012 slice needed for one
authorized GitHub Issue to become a canonical WorkItem and receive a
revision-bound proposed plan and owner approval. The implementation is
offline-first; live App credentials, GitHub writes, model calls and execution
remain explicit operator gates. AF-029 and AF-031 remain paused and unchanged.

**Acceptance evidence:** migration 003 is applied and rerun on a dedicated
synthetic PostgreSQL instance; the deterministic suite covers provenance,
idempotency, edits, authorization, bounded Codex refinement and comments. A
real read-only App exchange, installation/repository validation, and discovery
of issue #1 in `agentic-factory-testbed` passed with no cursor, WorkItem,
comment, model, or execution side effects. Synchronization, plan refinement,
owner approval, and all writes remain unvalidated and separately gated.

## AF-001 — Define the Vision, Scope, and Trust Boundaries

**Stage:** 0  
**Dependencies:** None  
**Status:** Accepted and merged in `4a0ce53`; see `BOOTSTRAP_VERIFICATION.md`

**Acceptance Criteria**

- [x] Adopt revision 2 of MASTER_PLAN.md: ideas/tasks become verifiable results; do not require a web application, pull request, or deployment.
- [x] Document two initial profiles, general software and ML research; distinguish the technical engine from the future nontechnical experience.
- [x] Include threats, boundaries, sources of truth, privacy, and licensing as an explicit decision; examples must contain no business data. Document Telegram as an optional external control channel, not the durable source of truth.

**Evidence:** actual changes and commands, traceable results, tests not run, and limitations. No implicit merges, publication, paid resources, or deployment.

## AF-002 — Create a Buildable Structure, Minimal CLI, and Factory CI

**Stage:** 0  
**Dependencies:** AF-001  
**Status:** Accepted and merged in `4a0ce53`; see `BOOTSTRAP_VERIFICATION.md`

**Acceptance Criteria**

- [x] A modular TypeScript monolith with a pinned version and lockfile; real lint, typecheck, test, and build scripts for the Factory.
- [x] A CLI with help and validation; minimal installation documentation from the first increment.
- [x] CI without business secrets; do not impose these Node.js scripts on external projects using Python or other languages.

**Evidence:** actual changes and commands, traceable results, tests not run, and limitations. No implicit merges, publication, paid resources, or deployment.

## AF-003 — Define Profile Contracts and Configuration Without Web Dependencies

**Stage:** 0  
**Dependencies:** AF-002  
**Status:** Accepted and merged in `4a0ce53`; see `BOOTSTRAP_VERIFICATION.md`

**Acceptance Criteria**

- [x] Small contracts for objectives, profiles, agents, executors, artifacts, and verification, with no SDKs in the core; remote integrations and optional control channels (including Telegram) must not become core dependencies.
- [x] Valid software-general and ml-research fixtures without mandatory hosting, URLs, pull requests, or GitHub; understandable errors for missing capabilities.
- [x] Project policies cannot relax mandatory policies; distinguish execution, verification, objective assessment, and human decisions.

**Evidence:** actual changes and commands, traceable results, tests not run, and limitations. No implicit merges, publication, paid resources, or deployment.

## AF-004 — Implement the State Machine and PostgreSQL Persistence

**Stage:** 1  
**Dependencies:** AF-003  
**Status:** Accepted and merged in `2705aac`; main-branch GitHub Actions success confirmed by the owner. See MILESTONE_2_REVIEW_CORRECTIONS.md for current evidence.

**Acceptance Criteria**

- [x] Persist context, versioned plans/protocols and policies, subtasks, jobs, evidence, and approvals.
- [x] External identifiers are optional: a local request works without GitHub/Linear; every task retains an authorized owner/project.
- [x] Test invalid transitions, stale evidence, and restart; no deployment must not prevent completion of a profile that does not require it.

**Evidence:** actual changes and commands, traceable results, tests not run, and limitations. No implicit merges, publication, paid resources, or deployment.

## AF-005 — Implement a Durable Queue, Leases, Limits, and Cancellation

**Stage:** 1  
**Dependencies:** AF-004  
**Status:** Accepted and merged in `2705aac`; main-branch GitHub Actions success confirmed by the owner. See MILESTONE_2_REVIEW_CORRECTIONS.md for current evidence.

**Acceptance Criteria**

- [x] Use a maintained library; implement lease recovery and rejection of updates from stale lease owners.
- [x] Separate technical repair from new experimental variants; each has its own limits.
- [x] Waiting for approval or an external job releases the coordinating worker; verify cancellation, timeouts, and deduplication.

**Evidence:** actual changes and commands, traceable results, tests not run, and limitations. No implicit merges, publication, paid resources, or deployment.

## AF-006 — Simulate Software and ML End to End

**Stage:** 1  
**Dependencies:** AF-005  
**Status:** Accepted and merged in `2705aac`; main-branch GitHub Actions success confirmed by the owner. See MILESTONE_2_REVIEW_CORRECTIONS.md for current evidence.

**Acceptance Criteria**

- [x] Compose and fake adapters execute both profiles without external APIs or real data.
- [x] Test success, repairable failure, exhausted attempts, cancellation, approval, duplicate events, and restart.
- [x] A simulated ML outcome without improvement does not trigger endless repair; simulated results are labeled and never presented as real experiments.

**Evidence:** actual changes and commands, traceable results, tests not run, and limitations. No implicit merges, publication, paid resources, or deployment.

## AF-007 — Implement the Sandbox and Restricted Execution Broker

**Stage:** 2  
**Dependencies:** AF-006  
**Status:** Linux AMD64 implementation and verification completed for the exact reviewed runtime and synthetic scope. Accepted and squash-merged in `df1f4f5`; main CI passed; macOS ARM64 validation outstanding and blocked from normal broker execution. No general hostile-workload or production security certification. See SANDBOX.md and AF007_VERIFICATION.md.

**Acceptance Criteria — implemented and verified on reviewed Linux AMD64 only; accepted for this limited scope**

- [x] Workspace and processes are separate from the coordinator; no Docker socket, master key, control database, or unrestricted mounts.
- [x] Configurable project environment for Python or general software; network, CPU, memory, disk, and path limits.
- [x] Cancellation terminates child processes; test unauthorized access, path escapes, and leftover execution resources.

**Evidence:** actual changes and commands, traceable results, tests not run, and limitations. No implicit merges, publication, paid resources, or deployment.

## AF-008 — Implement the GitHub App and Installation-Level Authorization

**Stage:** 3  
**Dependencies:** AF-007  
**Status:** Pending implementation/verification

**Acceptance Criteria**

- [ ] An instance-owned App is initially authorized only for the demo; verify permissions and authentication against current documentation.
- [ ] A trusted publisher obtains scoped credentials; master secrets never enter the sandbox.
- [ ] Reject unauthorized repositories, installations, and users; GitHub is not required for the local workflow.

**Evidence:** actual changes and commands, traceable results, tests not run, and limitations. No implicit merges, publication, paid resources, or deployment.

## AF-009 — Integrate GitHub Tickets and the Branch/PR Publisher

**Stage:** 3  
**Dependencies:** AF-008, AF-023, AF-024  
**Status:** Pending implementation/verification

**Acceptance Criteria**

- [ ] Map an authorized issue to the same WorkItem used by local input; use polling with backoff.
- [ ] Create a Draft PR only if the plan requests that outcome; evidence links source code and the run.
- [ ] Reconcile a crash after creation: a duplicate event must not produce a second PR or duplicate other actions.

**Evidence:** actual changes and commands, traceable results, tests not run, and limitations. No implicit merges, publication, paid resources, or deployment.

## AF-010 — Implement a Programmatic Codex Adapter

**Stage:** 3  
**Dependencies:** AF-007, AF-023, AF-024  
**Status:** Pending implementation/verification

**Acceptance Criteria**

- [ ] Documented authentication and a configurable model; explicitly handle structured output, cancellation, and available usage reporting.
- [ ] Operate on an authorized workspace without requiring a PR; fake adapters continue testing the core without real calls.
- [ ] A real demo generates code and a test; real integration is opt-in, with no unauthorized publication, additional spending, or data access.

**Evidence:** actual changes and commands, traceable results, tests not run, and limitations. No implicit merges, publication, paid resources, or deployment.

## AF-011 — Implement Profile-Specific Quality Gates and Bounded Technical Repairs

**Stage:** 3  
**Dependencies:** AF-009, AF-010, AF-025  
**Status:** Pending implementation/verification

**Acceptance Criteria**

- [ ] Local verification and CI when applicable, tied to the exact snapshot and plan; retain logs and results in the manifest.
- [ ] A technical failure triggers bounded repair; no improvement in an experimental metric is not a technical failure.
- [ ] A required check that is missing/skipped/cancelled, or invalid evidence, blocks progress; the deliverable/PR reaches review with evidence, not just an LLM summary.

**Evidence:** actual changes and commands, traceable results, tests not run, and limitations. No implicit merges, publication, paid resources, or deployment.

## AF-012 — Refine and Approve Plans or Experimental Protocols

**Stage:** 4  
**Dependencies:** AF-011  
**Status:** Pending implementation/verification

**Acceptance Criteria**

- [ ] Input includes objective, scope, exclusions, profile, deliverables, criteria, resources, budget, and external actions.
- [ ] For ML, define the baseline, splits, metrics, variants/repetitions, and completion criteria; approve every plan during the pilot.
- [ ] Changing the scope/protocol invalidates approval; the model cannot weaken deterministic constraints or invent user decisions.

**Evidence:** actual changes and commands, traceable results, tests not run, and limitations. No implicit merges, publication, paid resources, or deployment.

## AF-013 — Add Independent Review and Profile-Specific Verifiers

**Stage:** 4  
**Dependencies:** AF-012  
**Status:** Pending implementation/verification

**Acceptance Criteria**

- [ ] A reviewer operates in a separate, read-only context; findings must be verifiable and do not replace human approval.
- [ ] Software review covers behavior and regressions; ML review covers code, method, lineage, and limitations. Do not impose Playwright on projects without a UI.
- [ ] Changes to tests, evaluation, splits, CI, or criteria require explicit controls; passing a detector does not establish universal absence of leakage.

**Evidence:** actual changes and commands, traceable results, tests not run, and limitations. No implicit merges, publication, paid resources, or deployment.

## AF-014 — Deliver the Final Package, Acceptance, and Human Corrections

**Stage:** 4  
**Dependencies:** AF-013, AF-024  
**Status:** Pending implementation/verification

**Acceptance Criteria**

- [ ] The delivery includes source/results, instructions, evidence, known or unknown costs, and limitations, without universally requiring a URL/PR.
- [ ] Authorized feedback updates the version; new inputs/code invalidate affected evidence, and scope changes require approval.
- [ ] Distinguish completed execution from a met objective; an unfavorable result may be accepted only if it satisfies the approved research objective.

**Evidence:** actual changes and commands, traceable results, tests not run, and limitations. No implicit merges, publication, paid resources, or deployment.

## AF-015 — Optional Extension: CI and Vercel Preview

**Stage:** Optional web extension  
**Dependencies:** AF-014  
**Status:** Pending implementation/verification

**Acceptance Criteria**

- [ ] An adapter outside the core, enabled only for profiles that require it; capabilities and artifact version are explicit.
- [ ] Production credentials remain outside agents; define a single release owner per project.
- [ ] UI tests target the correct preview with synthetic data; the extension does not block installation or software/ML usage without hosting.

**Evidence:** actual changes and commands, traceable results, tests not run, and limitations. No implicit merges, publication, paid resources, or deployment.

## AF-016 — Optional Extension: Release and Production Verification

**Stage:** Optional web extension  
**Dependencies:** AF-015  
**Status:** Pending implementation/verification

**Acceptance Criteria**

- [ ] Integration/merge and release are authorized; verify the published version and run smoke tests.
- [ ] Previews are isolated from production data; migrations require an approved procedure.
- [ ] Failure does not mark the deployment objective as met; document application recovery without promising automatic data rollback.

**Evidence:** actual changes and commands, traceable results, tests not run, and limitations. No implicit merges, publication, paid resources, or deployment.

## AF-017 — Add a Second Runtime: Claude

**Stage:** 5  
**Dependencies:** AF-014  
**Status:** Pending implementation/verification

**Acceptance Criteria**

- [ ] Verify supported programmatic authentication; do not assume chat subscriptions cover a distributed product.
- [ ] The contract and at least one real demo work without core changes; document capability differences.
- [ ] A user can install with one runtime; do not require two providers to complete a task.

**Evidence:** actual changes and commands, traceable results, tests not run, and limitations. No implicit merges, publication, paid resources, or deployment.

## AF-018 — Add Linear and Private Multi-Organization Configuration

**Stage:** 5  
**Dependencies:** AF-012, AF-014  
**Status:** Pending implementation/verification

**Acceptance Criteria**

- [ ] An optional ticket adapter resolves IDs through authorized configuration, not prefixes inferred by the agent.
- [ ] Isolate tokens, ML results, files, logs, caches, and resources across organizations; test independent revocation.
- [ ] Connect business repositories one at a time after their checks; testing isolation does not require deployment or a second agent.

**Evidence:** actual changes and commands, traceable results, tests not run, and limitations. No implicit merges, publication, paid resources, or deployment.

## AF-019 — Optional Extension: Demonstrate Real Deployment Portability

**Stage:** Optional web extension  
**Dependencies:** AF-016  
**Status:** Pending implementation/verification

**Acceptance Criteria**

- [ ] Run the demo on a second existing, authorized target; replace the adapter/configuration without modifying the core.
- [ ] Document nonequivalent capabilities and application-infrastructure migration.
- [ ] This ticket is not a dependency for research, basic onboarding, or parallel execution.

**Evidence:** actual changes and commands, traceable results, tests not run, and limitations. No implicit merges, publication, paid resources, or deployment.

## AF-020 — Run Tasks and Compute Jobs in Parallel

**Stage:** 7  
**Dependencies:** AF-018, AF-026  
**Status:** Pending implementation/verification

**Acceptance Criteria**

- [ ] Two independent tasks advance with separate agent and compute quotas per instance/organization/project.
- [ ] Jobs with dependencies wait; do not share a branch or writable checkpoint; serialize migrations/releases targeting the same destination.
- [ ] A conflict requires revalidation; restart does not duplicate external experiments; use serial code integration or a merge queue according to actual availability.

**Evidence:** actual changes and commands, traceable results, tests not run, and limitations. No implicit merges, publication, paid resources, or deployment.

## AF-021 — Build Guided Installation and Self-Hosted Diagnostics

**Stage:** 6  
**Dependencies:** AF-014, AF-026  
**Status:** Pending implementation/verification

**Acceptance Criteria**

- [ ] CLI init/doctor/status/start/pause/resume/cancel commands are advertised only when implemented and tested.
- [ ] Local input and optional connections; each installation uses its own credentials without a central server operated by the author.
- [ ] Doctor checks the profile, environment, tools, permissions, resources, results, and capabilities; distinguish errors, warnings, and unverified checks.

**Evidence:** actual changes and commands, traceable results, tests not run, and limitations. No implicit merges, publication, paid resources, or deployment.

## AF-022 — Prepare a Technical Release and Validate with an External User

**Stage:** 6  
**Dependencies:** AF-017, AF-018, AF-021, AF-029, AF-030  
**Status:** Pending implementation/verification

**Acceptance Criteria**

- [ ] Versioned releases/images; check advertised architectures, backup/restore, upgrades, retention, and cleanup.
- [ ] Document privacy, data destinations, opt-in telemetry, external costs, export, and revocation.
- [ ] An independent user completes software and ML workflows without modifying the core or using the author's infrastructure; validate optional Telegram setup with their own bot and validate operation with Telegram disabled; do not advertise consumer UX or untested extensions.

**Evidence:** actual changes and commands, traceable results, tests not run, and limitations. No implicit merges, publication, paid resources, or deployment.

## AF-023 — Add Local Input and a Ticket-Independent Work Origin

**Stage:** 2  
**Dependencies:** AF-006, AF-007  
**Status:** Accepted after independent review; squash-merged in `ce55b8d72dd7317dff44d1fa4ba9ea66d50ef6ae`. Both required main CI jobs passed in [run 39737704211](https://github.com/crisdanrodriguez/agentic-factory/actions/runs/39737704211). Exact results and historical evidence are recorded in `AF023_VERIFICATION.md`.

**Acceptance Criteria**

- [x] Accept a request from a file/CLI, validate it, and associate it with an owner/project; GitHub/Linear is not mandatory.
- [x] Preserve original content and revision; reuse the same domain model as the integrations.
- [x] File reads are limited to authorized paths; a request does not itself grant permissions, compute resources, or publication rights.

**Evidence:** actual changes and commands, traceable results, tests not run, and limitations. No implicit merges, publication, paid resources, or deployment.

## AF-024 — Implement a Results Manifest and Private Local ArtifactStore

**Stage:** 2  
**Dependencies:** AF-007, AF-023  
**Status:** Pending implementation/verification

**Acceptance Criteria**

- [ ] Store artifacts by run and project with type, size, digest, snapshot, and data/environment/configuration where applicable.
- [ ] Prevent path traversal, cross-run overwrites, and cross-project access; enforce quotas and retention; do not upload data or model weights to Git by default.
- [ ] Test missing files, digest mismatches, stale evidence, authorized export, and storage errors; a checksum is not scientific validation.

**Evidence:** actual changes and commands, traceable results, tests not run, and limitations. No implicit merges, publication, paid resources, or deployment.

## AF-025 — Implement a CPU JobExecutor and Experimental Budget

**Stage:** 2  
**Dependencies:** AF-007, AF-024  
**Status:** Pending implementation/verification

**Acceptance Criteria**

- [ ] Start/inspect/cancel a sandboxed job without holding an LLM session open; durable state, limits, and child-process handling.
- [ ] Separate experiment identity, technical attempt, variants, and known/unknown usage; do not provision cloud GPUs.
- [ ] Reconcile after restart before relaunching; offer checkpoint/resume only when support is tested, not merely because an interface defines it.

**Evidence:** actual changes and commands, traceable results, tests not run, and limitations. No implicit merges, publication, paid resources, or deployment.

## AF-026 — Run a Real ML Demo Without Web Hosting or Publication

**Stage:** 4  
**Dependencies:** AF-012, AF-014, AF-025  
**Status:** Pending implementation/verification

**Acceptance Criteria**

- [ ] A baseline and small CPU neural network on synthetic data, with a pinned environment and approved splits/protocol and evaluation.
- [ ] Deliver code, configuration, real metrics, artifacts, and a report with limitations; repeat under documented conditions and justified tolerances.
- [ ] No GitHub, PR, Linear, MLflow, DVC, or Vercel requirement; tests for unfavorable outcomes use labeled fixtures, without manipulating the real demo or requiring it to beat the baseline to mark the study as completed.

**Evidence:** actual changes and commands, traceable results, tests not run, and limitations. No implicit merges, publication, paid resources, or deployment.

## AF-027 — Define an Idea Contract and Guided Planning Experience

**Stage:** Future guided experience  
**Dependencies:** AF-012, AF-014  
**Status:** Pending implementation/verification

**Acceptance Criteria**

- [ ] An API for objectives, clarification, plans, scope, examples, resources, cost, and authorizations, independent of tickets/CLI.
- [ ] A prototype for a narrowly scoped need; it may recommend adapting an existing solution, requesting data, or not developing anything.
- [ ] A plan understandable without YAML or Git; make ambiguities and pending decisions explicit; do not invent market validation or feasibility.

**Evidence:** actual changes and commands, traceable results, tests not run, and limitations. No implicit merges, publication, paid resources, or deployment.

## AF-028 — Pilot with Nontechnical Users and Deliver Understandable Results

**Stage:** Future guided experience  
**Dependencies:** AF-021, AF-027  
**Status:** Pending implementation/verification

**Acceptance Criteria**

- [ ] A guided interface for one supported use case: approve a plan, try the result, request changes, cancel, and export.
- [ ] Publication, data access, and additional costs require consent; sensitive tasks retain specialist review.
- [ ] Observe new users without assistance; record installation, comprehension, and evaluation problems. A single pilot does not establish support for every consumer.

**Evidence:** actual changes and commands, traceable results, tests not run, and limitations. No implicit merges, publication, paid resources, or deployment.

## AF-029 — Telegram Control: Pairing, Local Intake, and Status

**Stage:** 2A — Early Telegram control (after the local WorkItem path; before the GitHub/Codex provider integrations)  
**Dependencies:** AF-005, AF-023  
**Status:** Pending implementation/verification

**Acceptance Criteria**

- [ ] Use a self-hosted Telegram bot connected by long polling initially, with a token stored outside source control. A local CLI-assisted, short-lived pairing flow binds an authorized numeric Telegram user ID and private chat to an instance user; unpaired/group/unauthorized senders cannot create or read work.
- [ ] Implement `/help`, `/new`, `/status`, and `/list` against the existing WorkItem and status services, not a separate Telegram ticket database. `/cancel` may cancel only authorized work in a cancellable state; unknown/forbidden actions return a safe, non-sensitive response.
- [ ] Deduplicate Telegram update IDs, persist the polling cursor, enforce input limits and basic rate limits, and recover safely after restart; messages and callback data are untrusted inputs. No arbitrary shell commands, organization switching, secrets, logs, source code, or model outputs in default replies.
- [ ] Test the channel using fake Telegram API responses (including duplicate messages and unauthorized users); complete an opt-in live test with a development bot and a synthetic WorkItem. Running without Telegram configured must still work, and research must not require GitHub or deployment.

**Evidence:** bot pairing/revocation steps, exact test results, mock/live boundaries, token handling, privacy/cost notes. No implicit merges, publication, paid resources, or deployment.

## AF-030 — Telegram Approval and Notifications for Versioned Plans

**Stage:** 4A — Telegram approval and notifications (as soon as versioned plans exist)  
**Dependencies:** AF-029, AF-012  
**Status:** Pending implementation/verification

**Acceptance Criteria**

- [ ] Deliver concise optional notifications for existing state transitions and approval requests without uploading private source, datasets, model weights, logs, credentials, or deliverable contents. Notification failure must not change the authoritative workflow state.
- [ ] `/approve` and `/reject` (and any callback buttons) revalidate server-side actor identity, project authorization, current plan/policy revision, pending approval state, action scope, and expiry. Approval is recorded once by the core; stale, replayed, changed, or fabricated callbacks cannot approve work.
- [ ] The actor sees an understandable summary of the specific plan and external effects before approving, with an explicit confirmation for risky actions; absence of authorized approval blocks the task. A Telegram chat message is never interpreted as granting broad project or repository privileges.
- [ ] Test authorized, unauthorized, stale, duplicate, revoked, expired, mismatched-project, and offline/restart scenarios. Local/CLI approval still works when Telegram is disabled; Telegram does not bypass required human PR/production approvals.

**Evidence:** recorded scenario tests and accepted/rejected transitions, privacy review, and a live development-bot demo where permitted. No implicit merges, publication, paid resources, or deployment.

## Work Item Template

```text
Objective or research question:
Profile and task type:
Context, sources, and authorized data:
Scope / out of scope:
Plan or protocol:
Deliverables:
Quality and objective-assessment criteria:
Verifiers and required evidence:
Dependencies:
Resources, budget, and limits:
Authorized / prohibited external actions:
Review and approval:
Recovery procedure:
Stopping rule:
```
