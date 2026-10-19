# Revision 2 Changes and Package Usage

## Product Decision

Agentic Factory is not limited to creating web applications. Its goal is to help develop projects and conduct computational research, with a future path for nontechnical users to start from an idea.

The earlier revision included a no-deployment mode but still treated the pull request as the dominant output. Revision 2 changes the domain: deliverables and their evidence are central; an external ticket, pull request, publication, and deployment are optional according to the approved plan.

## Specific Changes

| Area | Change |
|---|---|
| Input | A native WorkItem from a local request or ticket system; a future ideas API |
| Profiles | Software-general and ml-research from the initial fixtures and tests |
| Execution | AgentRuntime separated from JobExecutor |
| Results | ArtifactStore and a manifest for code/data/environment/parameters/outputs |
| Acceptance | Separate execution, verification, objective assessment, and human decisions |
| Research | Protocol, experimental budget, protected evaluation, negative findings, and documented reproducibility |
| Quality | Profile-specific verifiers; Playwright/preview only when applicable |
| Roadmap | Web/deployment is no longer a dependency of ML, concurrency, or installation |
| Consumers | A guided UX path separate from the technical engine, with its own external validation |

## Backlog

AF-001 through AF-022 are retained to allow comparison with the earlier backlog. Their criteria and dependencies change in revision 2. AF-015, AF-016, and AF-019 form an optional web extension. AF-020 no longer depends on web portability; AF-021 no longer requires parallel execution first.

AF-023 through AF-028 add local input, results/artifacts, a compute executor, an ML demo, idea-based planning, and a nontechnical pilot. They will not all be implemented immediately or in numerical order.

## English Edition

This edition translates the complete revision 2 planning package into English. All 28 ticket IDs, dependencies, and acceptance-criteria counts are preserved. It does not expand the product scope or implement any functionality.

The canonical document names and all references now use English. AGENTS.md adds a persistent English-language convention for project-authored documentation, prompts, filenames, source comments, tests, CLI messages, and engineering materials. Original data and externally defined identifiers must not be altered merely to translate them.

FIRST_PROMPT.txt also incorporates the previously described bootstrap review procedure: present a plan, wait for approval when it has not already been given, run terminating checks, and leave changes uncommitted for human review.

## Included Files

- MASTER_PLAN.md: the complete revision 2 plan in English.
- BACKLOG.md: 28 proposed tickets with dependencies and criteria.
- AGENTS.md: aligned instructions for the Factory repository, including the language policy.
- FIRST_PROMPT.txt: the first increment, AF-001 through AF-003, with two profiles.
- README.md: instructions for using this planning package.
- CHANGES_V2.md: this revision and English-edition change record.

This package is documentation. It contains no executable application, published package, newly created GitHub tickets, or changes to your repositories.

## If Development Has Already Started

Do not delete existing work. Review mandatory PR/deployment fields, universal merge states, global web tests, hosting dependencies, and metric comparisons incorrectly treated as software tests. Migrate those assumptions with small changes and tests.

Replace or rename the planning documents and update all internal references. Merge the language policy into an existing AGENTS.md rather than discarding additional repository instructions. Do not keep conflicting active copies of the plan. Preserve Git history and review document changes before committing.

The revised first criterion is concrete: validate one software profile and one research profile without requesting hosting. Then demonstrate both with real execution; the ML demo must be able to finish with a report and results without publishing anything.

## Revision 2.1 Follow-Up

Telegram prioritization is documented separately in `CHANGES_TELEGRAM_PRIORITY.md`. This file remains the historical record of revision 2. The 28 original tickets and core cross-profile design remain the baseline.
