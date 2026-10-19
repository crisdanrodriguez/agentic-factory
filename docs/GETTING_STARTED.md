# Getting Started — From Zero to the First Reviewed Increment

AF-001–003 now provide a local configuration-validation scaffold. All project-authored files are in English. The original planning instructions below are preserved as background; use the current bootstrap instructions first. No full Factory workflow runs yet.

## Current bootstrap installation and checks

Use the tested Node.js 24 LTS version `24.22.0` (also recorded in `.node-version`) and npm `11.9.0`. Select these through your preferred runtime manager. The implementation session used a temporary Node binary without replacing the system installation. Exact dependency versions are in `package.json` and `package-lock.json`.

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run lint
npm run typecheck
npm test
npm run build
node dist/cli/index.js --help
node dist/cli/index.js validate fixtures/software-general.json
node dist/cli/index.js validate fixtures/ml-research.json
```

The test command compiles tests and invokes Node's test runner without watch mode. The build writes `dist/`; tests write `.test-build/`. Both directories are ignored. No Python installation, database, Docker, bot token, or provider credentials are required for these checks. The fixture commands are descriptions and are never executed.

The CLI reads one JSON file (maximum 65,536 bytes). Exit status is `0` for valid configuration/help, `1` for validation/read failure, and `2` for invalid arguments. Unknown configuration properties are rejected. Error output avoids echoing input values.

Both examples are labeled `synthetic-configuration-only`. The current CLI intentionally supports these bootstrap contracts only. Required capabilities are checked against a contract catalog, not actual provider availability. The trusted policy is `BOOTSTRAP_POLICY` in `src/core/policy.ts`; project JSON cannot replace it. To require an extra verification, add its profile check with `required: true` and its ID to `policy.requiredChecks`. Lowering resource limits is allowed; disabling approval/evidence or dropping global checks is rejected. External delivery is unavailable in the bootstrap catalog.

See `BOOTSTRAP_VERIFICATION.md` for recorded results. Later tickets require separate approval. The historical setup steps below do not authorize a commit, push, publication, provider connection, or implementation beyond AF-003.

## Original planning guide

## Step 1 — Unpack

Extract `agentic-factory-starter-v2.1.zip` under your development directory. The ZIP already contains an `agentic-factory/` directory with `AGENTS.md`, `README.md`, and `docs/`. Avoid nesting a second `agentic-factory/` directory inside it.

If you already have a Factory repository, **do not initialize or replace it**: copy or merge the documentation and keep existing code/history.

## Step 2 — Verify prerequisites

Check:

```bash
git --version
node --version
npm --version
```

Install a supported Node.js LTS if missing. No Docker, database, Telegram token, GitHub App, cloud credentials, or GPU is necessary for the first coding block. Pin the exact tested runtime/toolchain version in AF-002.

## Step 3 — Initialize Git (new folder only)

```bash
cd ~/Developer/agentic-factory
git init -b main
git add .gitignore AGENTS.md README.md docs/
git diff --cached --stat
git commit -m "docs: add Agentic Factory planning baseline"
git switch -c feat/af-001-003-bootstrap
```

The path is an example: use the location where you extracted the package. Before committing, confirm the staged files contain no secrets. You can create and push a public personal GitHub repository later; it is not required for the initial local increment.

## Step 4 — Ask Codex for a plan, not implementation

Launch Codex within this directory (`codex` if installed/configured). Give it the contents of `docs/FIRST_PROMPT.txt`. Require a brief plan, file list, and tests **without edits or dependency installation yet**. It must not start AF-004 or AF-029.

## Step 5 — Approve the bounded implementation

After you review the proposed changes, send the text in `docs/AFTER_APPROVAL_PROMPT.txt`. The first increment only covers AF-001, AF-002, and AF-003: initial scaffold, CLI help/config validation, two fixtures, and deterministic checks. Do not authorize access to GitHub organizations or BotFather credentials.

## Step 6 — Verify the delivery

When Codex reports that it is finished, run the npm commands it created, normally:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Verify two fixtures: `software-general` and `ml-research`, both without GitHub, Telegram, or deployment. Confirm invalid policy/capability configurations are rejected. Review `git status --short`, `git diff`, and the test log. These npm scripts do not exist in the planning-only package; they are implementation acceptance checks.

## Step 7 — Continue in small approved increments

Next AF-004–006 (persistent simulated engine), then AF-007/AF-023 (sandbox/local intake). **AF-029 is the earliest external integration**, before completing artifacts/compute and GitHub/Codex adapters: the Telegram development bot with opt-in local long polling and owner pairing. Create the bot through BotFather only when starting AF-029; its token must never enter Git or an agent prompt. AF-030 approvals follow AF-012. GitHub/Codex integrations remain separate future tickets.

The Telegram bot will only respond while the Factory process runs. Hosting and remotely executing agents are independent, later choices.

## What not to do yet

- Do not paste Telegram bot tokens, personal access tokens, or subscription credentials into the repository or chat with an agent.
- Do not grant access to `molvex-ai` or `addiv-mx` until the demo and isolation tests pass.
- Do not ask Codex to implement the entire backlog or deploy the Factory.
- Do not expect a production Telegram chatbot or 24/7 execution from the documentation package.
