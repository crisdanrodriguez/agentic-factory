# Agentic Factory — Master Plan, Revision 2.1 (Telegram Priority Amendment)

**Status:** revision 2.1 specification; AF-001–003 accepted and merged in `4a0ce53`. Milestone 2 (AF-004–006) is accepted and merged in `2705aac`, with the successful main-branch GitHub Actions run confirmed by the owner; see `MILESTONE_2_VERIFICATION.md`. The accepted baseline provides configuration validation and persistent synthetic workflows, not a complete executing Factory. Revision 2 remains the product baseline; 2.1 changes Telegram implementation priority only.
**Latest accepted increment:** AF-023 local WorkItem intake is merged in `ce55b8d`; both required main CI jobs passed in run `39737704211`. No next implementation increment has been initiated. AF-007 is accepted for the reviewed Linux AMD64 synthetic scope only; macOS ARM64 sandbox validation remains outstanding. See `LOCAL_INTAKE.md` and `AF023_VERIFICATION.md`.

**Guiding change:** develop projects and experiments with verifiable deliverables, rather than exclusively developing web applications or processing tickets that must end in a pull request or deployment.  
**Document scope:** supersedes the previous revision for work not yet implemented. It does not establish that repositories, accounts, or infrastructure have been changed.  
**Language:** All project-authored files and engineering materials must be in English, as defined in `AGENTS.md`. The original 28 ticket IDs and project scope remain; AF-029 and AF-030 add a Telegram control channel. See `docs/CHANGES_TELEGRAM_PRIORITY.md`.

## 1. Vision and Promise

Agentic Factory will be an open-source, self-hosted, extensible tool that turns authorized ideas or tasks into plans, executed work, reviewable results, and deliverables, with evidence and human oversight.

A web application is one type of project. A deployment, pull request, installable package, notebook, trained model, or report is a possible outcome; none is the mandatory endpoint of every workflow.

The long-term ambition is for someone without programming knowledge to describe a goal, approve an understandable plan, and evaluate the result. That ambition does not imply immediate compatibility with every discipline, hardware platform, or idea. Documentation must distinguish the vision, implemented profiles, and actual compatibility tests.

### First Verifiable Scope

Demonstrate two real profiles before finalizing the architecture:

- **General software:** a small utility or library, with tests and a source/package deliverable. A pull request is optional, according to project policy.
- **Computational ML research:** a small baseline-versus-neural-network experiment, runnable on a CPU with synthetic data, a comparison, and a report. No mandatory web application, hosting, publication, or cloud GPU.

The ML demo will test the workflow and its traceability. Working on synthetic data does not establish external scientific relevance. A web application will become a third, specialized demonstration when its deployment extension is developed.

Out of the initial scope: managed SaaS, a plugin marketplace, automatic app-store distribution, physical robot execution, clinical or laboratory scientific trials, unlimited optimization, and advertised support for untested platforms.

## 2. What Remains from the Previous Plan

Retain the modular core, adapters, PostgreSQL, persistent queue, isolated execution, versioned approvals, resource limits, evidence, organization isolation, and a design prepared for parallel execution.

The Factory may live in a public personal repository while a private instance operates across several independent organizations. Distributed source code must not contain business data, credentials, or private results. Each user hosts their own instance and connections; they do not depend on the author's instance.

Self-hosted describes where coordination is hosted. The selected AI or compute provider may receive code or data; document those destinations before authorization. Do not equate self-hosting with running every model locally.

## 3. Principles That Change

| Previous Emphasis | Revision 2 |
|---|---|
| Tickets as the only input | Ideas, local requests, or external tickets |
| Pull requests as the universal default output | A results package; a pull request when applicable |
| Done after merge/deployment | Completion according to approved deliverables and criteria |
| Tests centered on a web application | Profile-specific validation |
| An agent worker executes everything | Reasoning separated from compute jobs |
| Evidence tied mainly to a commit | Evidence tied to code, data, environment, parameters, and execution |
| Repair until checks are green | Bounded technical repairs; scientific exploration with its own protocol and budget |
| An exclusively technical day-to-day interface | A goals-and-results API that can later support a guided interface |

Adding `deployment: false` to a pull-request-centered workflow is not sufficient.

## 3A. Early Telegram Control Channel (Revision 2.1)

Telegram is now the **first prioritized external control channel**, implemented after the persistent simulated engine and native/local WorkItem entry. It is **not** a replacement for the core or the source of truth. GitHub Issues remains the first repository-integrated issue provider, with Linear later. CLI/local input always remains available; Telegram is opt-in per self-hosted instance.

A user should eventually be able to send a private Telegram message to their own bot to create a WorkItem, check its status, and receive concise updates. Once versioned plan approval exists, authorized users can approve or reject a specific plan revision over Telegram. The same underlying WorkItem and approval APIs must serve CLI, Telegram, and future interfaces. No Telegram-specific fields in the generic project profile or required deliverables.

**Prioritization:** AF-001–003 foundation; AF-004–006 simulated engine; AF-007/AF-023 local execution and intake; **AF-029 Telegram intake and status before GitHub/Codex adapters**; AF-030 Telegram plan approval after AF-012. Research projects still require neither GitHub nor deployment. Telegram does not require early Claude, remote runners, GitHub Actions AI execution, paid GPUs, or hosting a public webhook.

For the first Telegram integration use **long polling**, so a Mac or self-hosted machine can connect without opening an inbound HTTP endpoint. Only one active poller should own a bot token; store its update cursor and deduplicate updates. A process that is offline does not answer messages or execute work. Always-on use requires running the Factory on an always-on host; remote execution is a later, separate concern. Webhook support may be added later behind the same channel contract, with an authenticated webhook endpoint.

### Trust and privacy

- Register a separate Telegram bot per installation via BotFather. Store its token in a secret store or local ignored environment file, never in Git, public CI, screenshots, or agent workspaces.
- Pair the owner explicitly through a local CLI step with a short-lived, one-use code. Identify authorized people by **numeric Telegram user ID**, private chat ID, and local project permissions; never trust a username, chat title, forwarded message, or user-supplied project prefix as authorization.
- Support **private 1:1 chats only** initially. Default to no groups, no file uploads, no arbitrary shell commands, no project switching without authorization, and no publication of source, logs, model weights, or research data in chats.
- Treat all Telegram messages and callback payloads as untrusted input. Deduplicate delivery, validate state transitions, check actor permissions on every action, and bind approvals to a server-stored plan revision and expiring one-time action. Telegram message text alone is not approval.
- Telegram stores/processes messages on Telegram infrastructure. Do not send secrets or sensitive source/data through Telegram; messages and notifications should contain minimal metadata. Self-hosting the Factory does not make Telegram transport private or end-to-end encrypted.
- Start with `/help`, `/new`, `/status`, `/list` and `/cancel` only as supported by the engine. Add `/approve` and `/reject` after versioned approvals exist. Future consumer UX remains a separate milestone.

## 4. Minimal Architecture

The core will be written in TypeScript, but target projects do not have to use TypeScript, Node.js, Next.js, or web tooling. Each profile declares its environment and verification commands.

```text
CLI / local request / Telegram (optional control channel) / GitHub Issues / Linear / future guided interface
                                 |
                         Authorized objective
                                 |
                    Plan + profile + criteria + budget
                                 |
                        Persistent coordinator
                    /            |             \
              AgentRuntime   JobExecutor      Verifiers
                    \            |             /
                     Evidence + versioned artifacts
                                 |
                         Review and acceptance
                                 |
                        Local/private delivery
                                 |
                    Optional actions, if authorized
                      PR / release / publication / deployment
```

### Small Contracts, Not an Empty Universal Platform

- **WorkItem / ProjectPlan:** objective, context, task type, dependencies, scope, exclusions, criteria, budget, and optional source references.
- **ProjectProfile:** supported steps, required resources, deliverables, verifiers, and completion rules.
- **AgentRuntime:** an agent that proposes or modifies work; explicit tool, cancellation, and usage-reporting capabilities.
- **JobExecutor:** start, inspect, and cancel noninteractive jobs in an authorized environment. Local CPU first; remote compute as a later adapter.
- **ArtifactStore:** store/retrieve results within the authorized project, with immutable references and storage limits.
- **VerificationResult:** a structured outcome and evidence for a check, not an unsupported LLM opinion.
- **TicketProvider / RepositoryProvider / CIProvider:** optional integrations. GitHub will be the first repository/issue provider, not a mandatory field in every domain object.
- **ControlChannel (thin adapter):** optional inbound commands and outbound notifications mapped to existing WorkItem/approval services. Telegram is first; its messages are not durable workflow state. Do not implement a universal messaging platform during bootstrap.
- **DeliveryAction:** an explicit additional action on an approved result. Deployment is one specialization; app stores, firmware, and model publication will not be implemented during bootstrap.

A small collection of curated profiles is sufficient. Do not build a universal workflow editor or allow the model to add arbitrary executable integrations.

## 5. Shared Lifecycle

```text
Idea or task
 -> clarify objective and constraints
 -> propose plan, profile, evidence, and known/estimated cost
 -> approve scope, data, resources, and external effects
 -> execute authorized subtasks
 -> verify code, method, and outcome according to the profile
 -> repair technical errors within the limit
 -> review deliverables and limitations
 -> accept or request changes
 -> deliver a versioned result
 -> perform optional, approved external actions
```

A large project will contain multiple dependent tasks. In V1, users can provide a goal and small tasks; broad, conversational decomposition comes later. The Factory must not automatically turn a vague idea into a commitment to deliver a finished product.

During the pilot, all specifications and experimental protocols require approval. Low-risk gates may later be relaxed based on evidence. Authorized users, not the model, decide on additional spending, data access, publication, merges, and real hardware use.

### Do Not Confuse Four Separate Statuses

1. **Technical execution:** pending, running, completed, failed, or cancelled.
2. **Verification:** verified, rejected, or unverified.
3. **Objective assessment:** met, unmet, inconclusive, or not assessed.
4. **Human decision:** pending, accepted, rejected, or changes requested.

Example: an experiment can finish technically, pass methodological checks, and produce evidence that does not support the hypothesis. If the approved objective was a rigorous comparison, the work may be accepted as a completed study. If the commitment was to achieve a specific threshold, that objective remains unmet. Never change criteria retroactively to declare success.

Only steps declared and approved as applicable are required. A project without deployment may finish without it; a project that requires deployment cannot skip it by invoking flexibility. Missing, cancelled, or unsupported checks do not pass automatically.

## 6. ML Research: Workflow and Controls

### Example Initial Task

“Compare a baseline with a small neural network on a synthetic-data classification problem; deliver code, parameters, metrics, and a report without publishing anything.”

The plan defines data, splits, hypothesis, baseline, metric, search budget, justified seeds/repetitions, environment requirements, and study completion criteria. The user authorizes resources before execution.

The agent develops the pipeline. Fast tests check transformations, dimensions, split usage, nonfinite values, minimal training, and saving/loading results. A JobExecutor runs approved experiments; do not keep an LLM session occupied throughout training.

Then produce structured metrics, a comparison, a report, and limitations. Verify the relationship between reported figures and actual outputs; a JSON file alone does not prove the protocol is correct.

### Three Quality Layers

| Layer | Question | Expected Evidence |
|---|---|---|
| Software | Does the pipeline implement the specification and run? | Tests, logs, code, and commands |
| Methodology | Does the comparison answer the question without contaminating evaluation? | Versioned splits/protocol, independent review, transformations fitted only on authorized data |
| Findings | What does the evidence support? | Verifiable metrics, variability where applicable, comparison, and limitations |

The scikit-learn documentation explains that data leakage can produce optimistic estimates and that the test set must not guide model selection [S1]. The profile must protect final evaluation and distinguish exploratory search from final validation. Do not present an automated leakage check as universal proof that leakage is absent.

Document the conditions under which reproduction was attempted. PyTorch warns that identical reproducibility is not guaranteed across releases or platforms [S2]. The Factory must record the environment and tolerances; setting a seed does not justify a promise of bit-for-bit agreement on any machine.

### Two Different Loops

- **Technical repair:** a command fails, a test identifies a bug, or a file is missing. Initial limit: three total technical attempts per step.
- **Experimental exploration:** try a new configuration or hypothesis. It has its own budget, variant count, and protocol, approved beforehand. A metric that does not improve must not trigger unlimited exploration.

A metric below the baseline does not authorize editing results, deleting unfavorable runs, using the test set to tune hyperparameters, or changing the primary metric. When a study ends without improvement, preserve that finding and propose further experiments as new work.

### Costs, Pauses, and Compute

Start with bounded local CPU execution. Remote GPUs and compute servers are later extensions. Limits include concurrency, duration, memory, storage, and experiment count; distinguish agent costs from compute and storage costs.

Do not assume a provider exposes exact costs in real time. Show unknown usage as unknown, not zero. Use quotas/stopping mechanisms where supported, and explain accounting and cancellation limitations. Increasing a budget requires authorization.

An external job has a persisted ID. After a coordinator restart, query its status before launching another job. Offer checkpoint resume only when the profile and executor actually implement it; otherwise document restart or blocked behavior.

## 7. Artifacts and Evidence as Core Concepts

A deliverable may be source code, a package, executable, notebook, model, report, or set of results. Store it separately from public source code where appropriate, with private permissions by default.

Minimum manifest:

- Project, task, plan, and run IDs.
- Source revision: commit or identifiable snapshot.
- Data, split, configuration, and environment version/fingerprint where applicable.
- Commands and jobs actually executed, timings, status, and available usage information.
- Outputs with internal path/reference, type, size, digest, and retention policy.
- Verification, limitations, and approval associated with that version.

A digest establishes file identity/integrity, not scientific truth. Do not mix datasets, checkpoints, or caches across organizations. Failed runs also retain enough information for diagnosis, subject to privacy and retention rules.

Do not require every user to install a full MLOps stack. The first store will be a private volume and small manifests. Do not store large output files as blobs in the operational database or upload them to Git by default.

MLflow supports recording parameters, code versions, metrics, and output files, and separates metadata from artifacts [S3]. DVC can describe stages, dependencies, parameters, metrics, and outputs [S4]. These are adapter candidates, not mandatory dependencies or capabilities to recreate in full.

GitHub Actions can also retain binaries, logs, and results as artifacts without turning them into a website [S5]. Do not confuse CI artifact storage with durable retention of scientific results; check its policies before using it as the only copy.

## 8. The Future Experience for Nontechnical Users

Provide an API for objectives, plans, approvals, progress, results, and costs that is independent of the CLI, GitHub, and Linear. This allows a guided interface to be added without rewriting the engine.

A future request might be “I want to organize my files” or “I want to compare these models,” rather than “create a branch and open a PR.” The interface must help decide whether to write code, adapt an existing tool, request data, or narrow the scope.

Before starting, show the expected result, exclusions, usage examples, required resources/data, known or estimated cost, risks, and validation conditions. A nontechnical user should not have to inspect YAML or diffs to approve behavior, but a high-risk task may require additional specialist review.

The interface must not merely ask users to “accept the PR.” It should present something to try, an explanation of changes and limitations, and actions such as approve, request changes, stop, or export. Publication, data sharing, and resource purchases remain explicit decisions.

### Installation and Usage Are Different Problems

The operator who installs and maintains the Factory may be technical while its users are not. Offering self-hosting does not automatically make installation suitable for every consumer.

First build a self-hosted experience for developers/researchers. Then validate a guided experience with a narrowly scoped use case and nontechnical users. A desktop installer or managed service may be evaluated later without removing the open-source/self-hosted option. This is not a promise of SaaS or universal compatibility.

## 9. Retained and Expanded Security Controls

Agents and project code must not receive master credentials, production secrets, the Docker socket, or access to the coordinator's private state. Do not treat containers as absolute isolation; test the execution-boundary configuration.

An implementer may change only its workspace. A trusted publisher manages pull requests when requested. The compute executor must not provision arbitrary paid resources. Treat external datasets, models, notebooks, and scripts as untrusted input.

Authorized policy lives outside the branch being evaluated. Changes to acceptance criteria, verification, environment, instructions, or privacy require review. Revisions must not weaken controls to declare themselves successful.

Never run public contributions on the persistent server that operates the businesses. Do not automatically attach private data to public tickets, CI logs, public reports, or prompts. Distributed examples must use synthetic data.

For physical hardware or high-impact uses, add an appropriate profile and validation before allowing real actions. An approved simulation does not itself authorize moving a robot or operating a machine.

## 10. Revised, Verifiable Roadmap (Telegram Priority)

| Stage | Implementation | Exit Criterion |
|---|---|---|
| 0. Foundation | AF-001 through AF-003: vision, minimal CLI, and contracts | Two valid example configurations: software and ML; neither requires deployment |
| 1. Simulated engine | AF-004 through AF-006 | Both profiles handle success, failure, cancellation, duplicates, and restart; an unfavorable scientific result does not cause endless technical repair |
| 2. Isolated local intake | AF-007, AF-023 | Restricted sandbox and native local WorkItems with no mandatory GitHub/Linear/Vercel |
| **2A. Early Telegram control** | **AF-029, after AF-023** | An explicitly paired private user creates/checks a local WorkItem and cannot access another user/project; no GitHub, AI, or deployment required |
| 2B. Artifacts and compute | AF-024, AF-025 | A results manifest and bounded CPU job; no mandatory cloud, repo, or web hosting |
| 3. First real software workflow | AF-008 through AF-011 | Branch/PR when requested, tests, and a verifiable package; GitHub is an integration, not a requirement of the local ML profile |
| 4. Quality and real ML | AF-012 through AF-014 and AF-026 | Complete ML demo with a report and results reproduced under documented conditions, without publication or deployment |
| **4A. Telegram approvals and notifications** | **AF-030, after AF-012 and AF-029** | Only an authorized human can approve/reject the current plan revision; notifications expose no secrets or private artifacts |
| 5. Providers and organizations | AF-017, AF-018 | A second agent and isolated connections; no real business information in public examples |
| 6. Self-hosted adoption | AF-021, AF-022 | An independent user installs and completes both profiles without modifying the core or depending on the author; Telegram is optional and uses the user’s own bot |
| 7. Parallel execution | AF-020 | Two independent tasks respect quotas and do not duplicate external jobs |
| Web extension | AF-015, AF-016, AF-019 | Verified preview/release and a second target without rewriting the core; does not block other stages |
| Guided experience | AF-027, AF-028 | A nontechnical user completes a narrow use case, understands limits/cost, tries the result, and can stop/export |

Telegram is prioritized before the GitHub/Codex adapters but **not** before the minimal engine it controls. AF-030 requires the approved-plan mechanism from AF-012; a Telegram approval UI cannot substitute for that mechanism. The order of independent stages may be adjusted according to needs. Do not turn the entire list into one ticket. Minimal onboarding and documentation accompany development from the start; external validation must not be postponed until “everything is perfect.”

## 11. How to Start with This Revision

1. Copy this plan and the backlog to `docs/`, and `AGENTS.md` to the Factory repository root. Preserve existing changes; do not blindly overwrite implementations.
2. Use `docs/FIRST_PROMPT.txt` for AF-001 through AF-003 only. The first three tickets document a future Telegram channel seam; they **do not implement the bot**. Do not build real adapters or provision infrastructure yet.
3. Add two configuration fixtures: general software and ML research. They must validate without mandatory hosting, pull requests, or URLs.
4. Review the first diff and tests. Then implement the simulated engine for both profiles.
5. After AF-004–006, implement AF-007 and AF-023. Next implement AF-029 (Telegram intake/status) against those real services. Continue with AF-024–025 and the GitHub/Codex integrations; implement AF-030 approvals only after AF-012.
6. **Do not create a real Telegram bot token during the documentation/scaffold stage.** When AF-029 begins, use BotFather for a development-only bot and keep its token outside version control.

If development already started under the earlier plan, first audit web-specific assumptions: mandatory `pr_url` or `deployment_url` fields, universal merge stages, global `npm` commands, and statuses that conflate execution with outcome. Correct these with small changes rather than restarting the entire project.

## 12. Success Criteria

The first useful version will be demonstrated with software that needs no hosting and with a small ML study. It must show verifiable code/results, an unfavorable scientific finding where applicable, disclosed failures, task recovery, approval, and privacy.

The first version for nontechnical users will be evaluated separately: choose one type of need, observe new users without assistance, and record actual obstacles in understanding, permissions, evaluation, installation, and recovery. A polished interface does not replace that test.

**The promise is to help develop and evaluate projects with evidence and control, not to guarantee that every idea will work or every model will outperform its predecessor.**

## Telegram Primary References (for implementation; verify again during AF-029)

- Telegram Bot Features and BotFather: https://core.telegram.org/bots/features
- Telegram Bot API, including `getUpdates` and callback query authorization considerations: https://core.telegram.org/bots/api

## Technical Sources for This Revision

The product and architecture decisions above are proposals. These primary sources support the external capabilities and limitations discussed; they do not certify a Factory implementation. Source references are retained from revision 2; this English edition is a translation, not a fresh review of provider documentation.

- [S1] scikit-learn, Common pitfalls and recommended practices: https://scikit-learn.org/stable/common_pitfalls.html
- [S2] PyTorch, Reproducibility: https://docs.pytorch.org/docs/stable/notes/randomness.html
- [S3] MLflow, ML Experiment Tracking: https://mlflow.org/docs/latest/ml/tracking/
- [S4] DVC, dvc.yaml: https://doc.dvc.org/user-guide/project-structure/dvcyaml-files
- [S5] GitHub Actions, Workflow artifacts: https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts
