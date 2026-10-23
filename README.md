# Agentic Factory

**Status: AF-001–003 accepted and merged in `4a0ce53`.** AF-004–006 are accepted and merged in `2705aac`; the owner confirmed the successful main-branch GitHub Actions run. See [`docs/MILESTONE_2_REVIEW_CORRECTIONS.md`](docs/MILESTONE_2_REVIEW_CORRECTIONS.md). The two profiles run through synthetic end-to-end simulations using local PostgreSQL. No real agents, ML training, or GitHub integration are implemented. AF-029 adds an optional Telegram intake adapter; live bot verification is not yet authorized or completed.

AF-007 is accepted and merged in `df1f4f5` for the exact reviewed Linux AMD64 synthetic execution scope. Both required [main CI jobs](https://github.com/crisdanrodriguez/agentic-factory/actions/runs/39724230244) passed. macOS ARM64 remains unverified and blocked from normal broker execution; no production or general hostile-workload security certification is claimed. See [the acceptance record](docs/AF007_VERIFICATION.md).

Agentic Factory is intended to be an open-source, self-hosted, provider-agnostic system that transforms authorized ideas and tasks into verifiable project outcomes. Initial profiles: general software and computational ML research. Pull requests, web deployments, and publication are optional project-specific actions. A future guided experience may support nontechnical consumers.

The first prioritized external control channel is **Telegram**, after the persistent workflow engine and local WorkItem intake are implemented. Users will connect their own Telegram bot; no account, API key, organization, or externally hosted service is needed for the initial docs/CLI scaffold.

## Start here

Read [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md) for the local bootstrap commands and [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md) for the longer-term plan. The accepted baseline includes **AF-001 through AF-007**, with AF-007 limited to its reviewed Linux AMD64 synthetic scope. **AF-023 local intake is accepted and merged in `ce55b8d`**, with both required [main CI jobs](https://github.com/crisdanrodriguez/agentic-factory/actions/runs/39737704211) passing. AF-029 is the active approved increment, with local fake/PostgreSQL verification and human review tracked in [`docs/AF029_VERIFICATION.md`](docs/AF029_VERIFICATION.md). Keep implementation separate from any existing MOLVEX or ADDIV repository.

Use the tested Node.js 24 LTS version `24.22.0` and npm `11.9.0`, then run:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run deps:patch
npm run test:deps
npm run lint
npm run typecheck
npm test
npm run build
node dist/cli/index.js --help
node dist/cli/index.js validate fixtures/software-general.json
node dist/cli/index.js validate fixtures/ml-research.json
```

For PostgreSQL-backed queue and synthetic end-to-end tests, follow [`docs/DATABASE.md`](docs/DATABASE.md), then run `npm run test:state`, `npm run test:queue`, and `npm run test:simulations` sequentially.

Validation does not run the fixtures' Python commands or verify installed providers. Neither fixture needs credentials, a remote repository, Telegram, or deployment. The package is private and has not been published; use the local commands above.

## Documentation

- [`docs/DATABASE.md`](docs/DATABASE.md) — local database setup and explicit migrations
- [`docs/MILESTONE_2_REVIEW_CORRECTIONS.md`](docs/MILESTONE_2_REVIEW_CORRECTIONS.md) — final review fixes, current results, and CI requirements
- [`docs/MILESTONE_2_VERIFICATION.md`](docs/MILESTONE_2_VERIFICATION.md) — acceptance mapping, exact verification output, and limitations
- [`docs/CORE_ENGINE_VERIFICATION.md`](docs/CORE_ENGINE_VERIFICATION.md) — historical checkpoints and accepted dependency-patch maintenance

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

### Local WorkItem intake (AF-023, accepted and merged)

Use `work-item create`, `work-item revise`, and `work-item show` with an operator-configured project and authenticated PostgreSQL role. Intake requires no ticket service, AI provider, or running sandbox and grants no execution rights. See [setup and usage](docs/LOCAL_INTAKE.md) and [verification](docs/AF023_VERIFICATION.md).

### Optional Telegram control (AF-029, awaiting review)

See [`docs/TELEGRAM.md`](docs/TELEGRAM.md) for separate bot/admin identities, local confirmation of pairing, strict intake commands, durable receipts/outbox, recovery, and conservative limits. Local intake remains independent. No execution or approval capabilities are introduced. Hosted and separately authorized live development-bot verification remain outstanding.
