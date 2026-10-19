# Agentic Factory

**Status: AF-001–003 bootstrap implemented; awaiting human review.** A local CLI validates synthetic software and ML configurations. There is no workflow engine, working agent, experiment execution, GitHub integration, or Telegram bot.

Agentic Factory is intended to be an open-source, self-hosted, provider-agnostic system that transforms authorized ideas and tasks into verifiable project outcomes. Initial profiles: general software and computational ML research. Pull requests, web deployments, and publication are optional project-specific actions. A future guided experience may support nontechnical consumers.

The first prioritized external control channel is **Telegram**, after the persistent workflow engine and local WorkItem intake are implemented. Users will connect their own Telegram bot; no account, API key, organization, or externally hosted service is needed for the initial docs/CLI scaffold.

## Start here

Read [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md) for the local bootstrap commands and [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md) for the longer-term plan. Only **AF-001, AF-002, AF-003** are included. Keep implementation separate from any existing MOLVEX or ADDIV repository.

Use the tested Node.js 24 LTS version `24.22.0` and npm `11.9.0`, then run:

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

Validation does not run the fixtures' Python commands or verify installed providers. Neither fixture needs credentials, a remote repository, Telegram, or deployment. The package is private and has not been published; use the local commands above.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — bootstrap boundaries, contracts, and pending decisions
- [`docs/SECURITY.md`](docs/SECURITY.md) — threats, trusted policy, and data destinations
- [`docs/BOOTSTRAP_VERIFICATION.md`](docs/BOOTSTRAP_VERIFICATION.md) — actual check outputs and acceptance evidence
- [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md) — revision 2 baseline with Telegram priority amendment
- [`docs/BACKLOG.md`](docs/BACKLOG.md) — 30 proposed tickets and acceptance criteria
- [`docs/CHANGES_TELEGRAM_PRIORITY.md`](docs/CHANGES_TELEGRAM_PRIORITY.md) — what changed and what did not
- [`docs/CHANGES_V2.md`](docs/CHANGES_V2.md) — previous revision history
- [`AGENTS.md`](AGENTS.md) — coding and security instructions; English is required for project-authored files

No code should be committed, pushed, merged, published, or deployed merely because these documents are present. Human review comes first.

The current repository license is [MIT](LICENSE). The existing license is preserved; any future licensing change is an owner decision.
