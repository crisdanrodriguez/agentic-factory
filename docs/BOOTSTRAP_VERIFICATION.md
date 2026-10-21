# Bootstrap verification — AF-001–003

Personal repository paths in historical output are normalized to `/path/to/agentic-factory`; diagnostics and results are otherwise preserved.

## Acceptance update

AF-001–003 were accepted by the owner and merged in `4a0ce53`. The outputs and limitations below are historical evidence from the bootstrap sessions. References to pending review, untracked files, or no commit/merge describe those sessions, not the current repository. No additional hosted CI result is inferred from the merge. Milestone 2 evidence is recorded separately in `CORE_ENGINE_VERIFICATION.md`.

## Scope and environment

Implemented only AF-001, AF-002, and AF-003. Human review is pending. The master plan, backlog, amendments, prompts, AGENTS.md, and existing LICENSE are preserved. Backlog checkboxes are intentionally unchanged; this report provides implementation evidence for review.

Checks ran on macOS arm64 with Node.js 24.22.0 and npm 11.9.0. The session selected the checksum-verified temporary Node binary by prepending `/private/tmp/af-node-bin` to PATH; the system runtime was not replaced. Run the commands below after selecting the pinned versions on another machine. Other operating systems and hosted CI have not been executed.

## Acceptance evidence

| Ticket | Evidence |
|---|---|
| AF-001 | README, ARCHITECTURE.md, and SECURITY.md describe scope, both profiles, threats, privacy, authoritative state, and optional Telegram. MIT is the current repository license; future licensing changes remain owner decisions. |
| AF-002 | Strict TypeScript monolith; exact dependency pins and lockfile; CLI help/validation; real lint, typecheck, terminating tests, and build; pinned CI actions with read-only permissions and no deployment. |
| AF-003 | Core schemas and port contracts; both local profile fixtures; deterministic policy, capability, evidence, and CLI tests. Execution, verification, objective assessment, and human decisions have separate types. |

The test evidence covers disabling mandatory policy, removing checks, skipped/cancelled/failed/missing verification, absent evidence references, duplicate results, stale revision/environment/data identities, project mismatch, and missing capabilities. It also exercises tighter policies and successful validation without external integrations. These are synthetic contract tests, not runs of a workflow or scientific experiments.

## Installation and initial issues

- Initial sandbox downloads failed with DNS errors (`ENOTFOUND registry.npmjs.org` and `Could not resolve host: nodejs.org`). Approved network retries succeeded.
- `npm install --ignore-scripts --no-audit --no-fund --cache /private/tmp/af-npm-cache --fetch-retries=0 --fetch-timeout=20000` installed 98 packages. It warned about Node 25.5.0 because the temporary runtime had not yet been selected.
- The Node archive SHA-256 was checked against the official release checksum file. An extraction helper failed because the system Python lacked `tarfile.extractall(filter=...)`; extraction then succeeded with `tar`. No package or source changes were needed for that environment issue.
- A clean installation then succeeded under pinned Node 24.22.0/npm 11.9.0 using the populated cache:

```text
$ npm ci --ignore-scripts --no-audit --no-fund --cache /private/tmp/af-npm-cache --offline

added 98 packages in 815ms
```

The offline flag verifies lockfile installation from the downloaded cache. Normal onboarding uses `npm ci --ignore-scripts --no-audit --no-fund` with registry access. Install scripts, audit submission, and funding notices are disabled; no vulnerability-audit result is claimed.

## Exact final command output

The following output was captured after the clean lockfile installation. Commands run from the repository root; exit codes are recorded separately.

```text
$ node --version
v24.22.0
```

Exit code: 0.

```text
$ npm --version
11.9.0
```

Exit code: 0.

```text
$ npm ls --depth=0
agentic-factory@0.0.0 /path/to/agentic-factory
├── @types/node@24.19.2
├── eslint@10.13.0
├── typescript-eslint@8.71.2
├── typescript@5.9.3
└── zod@4.6.7

```

Exit code: 0.

```text
$ npm run lint

> agentic-factory@0.0.0 lint
> eslint src tests --max-warnings=0

```

Exit code: 0.

```text
$ npm run typecheck

> agentic-factory@0.0.0 typecheck
> tsc --noEmit

```

Exit code: 0.

```text
$ npm test

> agentic-factory@0.0.0 test
> tsc --project tsconfig.test.json && node --test --test-reporter=spec .test-build/tests/*.test.js

✔ CLI help exits successfully without configuration or credentials (51.825167ms)
✔ CLI validates software-general without provider credentials (48.492208ms)
✔ CLI validates ml-research without provider credentials (49.243292ms)
✔ CLI rejects unknown commands, extra arguments, and missing files (177.759708ms)
✔ CLI rejects malformed or oversized input without disclosing content (133.613625ms)
✔ CLI rejects disabled policy and never executes configured commands (97.220167ms)
✔ software-general validates with local input and no external integration or deployment (5.238875ms)
✔ ml-research validates with local input and no external integration or deployment (0.693ms)
✔ rejects disabling mandatory requirePlanApproval (0.332583ms)
✔ rejects disabling mandatory requireEvidence (0.191334ms)
✔ rejects removing a mandatory verification even when project lists agree (0.227709ms)
✔ rejects making a mandatory verification optional (0.21625ms)
✔ accepts stricter project limits and additional required checks (0.236ms)
✔ rejects raising the global maxTechnicalAttempts limit (0.131042ms)
✔ rejects raising the global maxVariants limit (0.119709ms)
✔ rejects raising the global maxDurationSeconds limit (0.168042ms)
✔ rejects raising the global maxMemoryMb limit (0.118541ms)
✔ rejects raising the global maxArtifactBytes limit (0.101125ms)
✔ rejects missing capabilities with an actionable error (0.200833ms)
✔ rejects removing a profile capability requirement (0.1335ms)
✔ requested deployment requires an explicit compatible capability (0.173042ms)
✔ rejects missing required research protocol and deliverables (0.29475ms)
✔ rejects unknown keys, empty identity, and invalid policy revision (0.936084ms)
✔ rejects duplicate profile check identifiers (0.218292ms)
✔ cannot claim verification success with a missing required result (0.204417ms)
✔ cannot claim verification success after a failed required check (0.178584ms)
✔ cannot claim verification success after a missing required check (0.5555ms)
✔ cannot claim verification success after a skipped required check (0.193209ms)
✔ cannot claim verification success after a cancelled required check (0.126333ms)
✔ rejects passed status with no evidence references (0.134541ms)
✔ rejects fabricated results and duplicate check outcomes (0.206334ms)
✔ rejects evidence with stale or mismatched ownerId (0.154875ms)
✔ rejects evidence with stale or mismatched projectId (0.10725ms)
✔ rejects evidence with stale or mismatched workItemId (0.096333ms)
✔ rejects evidence with stale or mismatched runId (0.093125ms)
✔ rejects evidence with stale or mismatched planRevision (0.087416ms)
✔ rejects evidence with stale or mismatched policyRevision (0.08925ms)
✔ rejects evidence with stale or mismatched sourceSnapshot (0.086209ms)
✔ rejects evidence with stale or mismatched environmentFingerprint (0.089791ms)
✔ rejects evidence with stale or mismatched protocolRevision (0.092292ms)
✔ rejects evidence with stale or mismatched datasetVersion (0.090833ms)
✔ rejects evidence with stale or mismatched splitVersion (0.092042ms)
✔ rejects evidence with stale or mismatched parametersDigest (0.089792ms)
✔ rejects an old context even if every result matches that old context (0.07775ms)
✔ evidence validation rechecks mandatory policy rather than trusting callers (0.065083ms)
✔ verification does not alter an unmet objective or pending human decision (0.097959ms)
ℹ tests 46
ℹ suites 0
ℹ pass 46
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 595.096791
```

Exit code: 0.

```text
$ npm run build

> agentic-factory@0.0.0 build
> tsc --project tsconfig.build.json

```

Exit code: 0.

```text
$ node dist/cli/index.js --help
Agentic Factory bootstrap

Usage:
  node dist/cli/index.js --help
  node dist/cli/index.js validate <configuration.json>

Validates synthetic profile configuration against trusted bootstrap policy.
Does not execute commands, approve work, or connect to providers.
```

Exit code: 0.

```text
$ node dist/cli/index.js validate fixtures/software-general.json
Valid configuration: software-general.
Contract validation only; no work executed or providers verified.
```

Exit code: 0.

```text
$ node dist/cli/index.js validate fixtures/ml-research.json
Valid configuration: ml-research.
Contract validation only; no work executed or providers verified.
```

Exit code: 0.

```text
$ git diff --check
```

Exit code: 0.

## Limits, privacy, cost, and pending decisions

No AF-004 work: no database, state machine, durable queue, local WorkItem intake service, sandbox, real AgentRuntime/JobExecutor/ArtifactStore, or approval engine. The CLI validates configuration only. Contract capability declarations do not establish runtime readiness or permissions. Evidence references are checked for completeness and matching identity; files, digests, truth, statistical methodology, and authorization are not independently verified here. Required-result checks do not accept a run, change objective assessment, or grant human approval.

Both fixture environments and research identities are synthetic labels, not installed Python environments, measured results, or real data digests. The checks named in those fixtures are not implemented target-project programs. No Python commands were executed. Budget fields are configuration constraints, not enforced process limits; usage/cost remain unknown until measured by a future implementation.

The bootstrap CLI makes no network calls. Toolchain and dependency installation fetched public software; no source, business data, credentials, artifacts, or logs were sent to providers. Hosted CI is configured but has not run, and no provider credentials or paid resources were used. No commit, push, merge, package publication, or deployment was performed.

Pending owner decisions: review the bootstrap and CI scope; separately approve any subsequent ticket. MIT is the current repository license, preserved unchanged; any future licensing change is an owner decision. Broader platform support, persistence, isolation, real providers, and artifact retention remain later design decisions. Stop at AF-003.

## Toolchain sources

- [Node.js 24 release archive](https://nodejs.org/en/download/archive/v24): selected the LTS runtime; exact local execution is recorded above.
- [typescript-eslint supported dependency versions](https://typescript-eslint.io/users/dependency-versions/): checked the compatibility policy. Registry metadata for 8.71.2 reports TypeScript >=4.8.4 <6.1.0 and ESLint 8/9/10, so TypeScript 5.9.3 is pinned instead of selecting TypeScript 7 solely because it is newer.
- CI action tag commits were resolved with `git ls-remote` from the public `actions/checkout` and `actions/setup-node` repositories. This is version-resolution evidence, not a hosted CI execution claim.

## Follow-up verification: Node.js 24 LTS and MIT license

The full suite was rerun after documenting MIT as the current license and adding matching package metadata. Node.js remains pinned to 24.22.0 in the runtime file, manifest, and lockfile; CI reads that runtime file and is unchanged. These commands used `PATH=/private/tmp/af-node-bin:$PATH`. No system runtime was replaced.

```text
$ node --version
v24.22.0
```

Exit code: 0.

```text
$ npm --version
11.9.0
```

Exit code: 0.

```text
$ npm ci --ignore-scripts --no-audit --no-fund --cache /private/tmp/af-npm-cache --offline

added 98 packages in 900ms
```

Exit code: 0.

```text
$ npm ls --depth=0
agentic-factory@0.0.0 /path/to/agentic-factory
├── @types/node@24.19.2
├── eslint@10.13.0
├── typescript-eslint@8.71.2
├── typescript@5.9.3
└── zod@4.6.7

```

Exit code: 0.

```text
$ npm run lint

> agentic-factory@0.0.0 lint
> eslint src tests --max-warnings=0

```

Exit code: 0.

```text
$ npm run typecheck

> agentic-factory@0.0.0 typecheck
> tsc --noEmit

```

Exit code: 0.

```text
$ npm test

> agentic-factory@0.0.0 test
> tsc --project tsconfig.test.json && node --test --test-reporter=spec .test-build/tests/*.test.js

✔ CLI help exits successfully without configuration or credentials (48.852667ms)
✔ CLI validates software-general without provider credentials (48.727042ms)
✔ CLI validates ml-research without provider credentials (46.76175ms)
✔ CLI rejects unknown commands, extra arguments, and missing files (183.856084ms)
✔ CLI rejects malformed or oversized input without disclosing content (140.620416ms)
✔ CLI rejects disabled policy and never executes configured commands (97.374292ms)
✔ software-general validates with local input and no external integration or deployment (4.712458ms)
✔ ml-research validates with local input and no external integration or deployment (0.522917ms)
✔ rejects disabling mandatory requirePlanApproval (0.306417ms)
✔ rejects disabling mandatory requireEvidence (0.183458ms)
✔ rejects removing a mandatory verification even when project lists agree (0.22625ms)
✔ rejects making a mandatory verification optional (0.23025ms)
✔ accepts stricter project limits and additional required checks (0.236083ms)
✔ rejects raising the global maxTechnicalAttempts limit (0.151916ms)
✔ rejects raising the global maxVariants limit (0.13075ms)
✔ rejects raising the global maxDurationSeconds limit (0.167167ms)
✔ rejects raising the global maxMemoryMb limit (0.109708ms)
✔ rejects raising the global maxArtifactBytes limit (0.099333ms)
✔ rejects missing capabilities with an actionable error (0.212625ms)
✔ rejects removing a profile capability requirement (0.145333ms)
✔ requested deployment requires an explicit compatible capability (0.15275ms)
✔ rejects missing required research protocol and deliverables (0.287583ms)
✔ rejects unknown keys, empty identity, and invalid policy revision (0.925125ms)
✔ rejects duplicate profile check identifiers (0.15075ms)
✔ cannot claim verification success with a missing required result (0.168625ms)
✔ cannot claim verification success after a failed required check (0.557083ms)
✔ cannot claim verification success after a missing required check (0.116959ms)
✔ cannot claim verification success after a skipped required check (0.117916ms)
✔ cannot claim verification success after a cancelled required check (0.110834ms)
✔ rejects passed status with no evidence references (0.109084ms)
✔ rejects fabricated results and duplicate check outcomes (0.191291ms)
✔ rejects evidence with stale or mismatched ownerId (0.151375ms)
✔ rejects evidence with stale or mismatched projectId (0.103083ms)
✔ rejects evidence with stale or mismatched workItemId (0.09825ms)
✔ rejects evidence with stale or mismatched runId (0.100958ms)
✔ rejects evidence with stale or mismatched planRevision (0.091542ms)
✔ rejects evidence with stale or mismatched policyRevision (0.089416ms)
✔ rejects evidence with stale or mismatched sourceSnapshot (0.087125ms)
✔ rejects evidence with stale or mismatched environmentFingerprint (0.09425ms)
✔ rejects evidence with stale or mismatched protocolRevision (0.12ms)
✔ rejects evidence with stale or mismatched datasetVersion (0.095042ms)
✔ rejects evidence with stale or mismatched splitVersion (0.094208ms)
✔ rejects evidence with stale or mismatched parametersDigest (0.153833ms)
✔ rejects an old context even if every result matches that old context (0.136208ms)
✔ evidence validation rechecks mandatory policy rather than trusting callers (0.093709ms)
✔ verification does not alter an unmet objective or pending human decision (0.124958ms)
ℹ tests 46
ℹ suites 0
ℹ pass 46
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 602.576458
```

Exit code: 0.

```text
$ npm run build

> agentic-factory@0.0.0 build
> tsc --project tsconfig.build.json

```

Exit code: 0.

```text
$ node dist/cli/index.js --help
Agentic Factory bootstrap

Usage:
  node dist/cli/index.js --help
  node dist/cli/index.js validate <configuration.json>

Validates synthetic profile configuration against trusted bootstrap policy.
Does not execute commands, approve work, or connect to providers.
```

Exit code: 0.

```text
$ node dist/cli/index.js validate fixtures/software-general.json
Valid configuration: software-general.
Contract validation only; no work executed or providers verified.
```

Exit code: 0.

```text
$ node dist/cli/index.js validate fixtures/ml-research.json
Valid configuration: ml-research.
Contract validation only; no work executed or providers verified.
```

Exit code: 0.

```text
$ git diff --check
```

Exit code: 0.

```text
$ git status --short
 M README.md
?? .github/
?? .gitignore
?? .node-version
?? AGENTS.md
?? docs/
?? eslint.config.js
?? fixtures/
?? package-lock.json
?? package.json
?? src/
?? tests/
?? tsconfig.build.json
?? tsconfig.json
?? tsconfig.test.json
```

Exit code: 0.

Preservation check: SHA-256 unchanged for LICENSE, AGENTS.md, the master plan, backlog, amendments, prompts, and CI workflow.
