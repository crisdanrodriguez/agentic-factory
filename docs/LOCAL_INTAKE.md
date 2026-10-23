# AF-023 — Local WorkItem intake

AF-023 is accepted and merged in `ce55b8d`; both required main CI jobs passed. See `AF023_VERIFICATION.md` for exact acceptance evidence. Intake records a request; it does not authorize execution. No GitHub, Linear, Telegram, AI provider, sandbox, plan, profile, or workflow Run is required. Both software and ML requests use the existing WorkItem contract with `origin.kind = "local"`.

## Install and configure

Use the pinned Node.js 24.22.0 / npm 11.9.0 and PostgreSQL setup in `DATABASE.md`:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run deps:patch
npm run db:migrate
npm run db:setup-local
npm run build
```

`db:migrate` requires `FACTORY_MIGRATION_URL`; it must never contain a runtime login. The synthetic setup script is restricted to `agentic_factory_local`. A normal installation needs operator-managed projects/memberships and non-privileged runtime roles, not the synthetic setup script. PostgreSQL can run natively or separately; Docker and a sandbox broker are not intake dependencies.

Create a private operator-owned directory and inbox (mode 0700), with private files (mode 0600). Use canonical absolute paths without symlink components. The installation JSON must live outside untrusted project workspaces. For example, `/absolute/private/intake/installation.json`:

```json
{
  "revision": "1",
  "databaseUrlEnvironment": "FACTORY_INTAKE_DATABASE_URL",
  "projects": {
    "local-demo": {
      "organizationId": "synthetic-org-a",
      "projectId": "synthetic-software-project",
      "inbox": "/absolute/private/intake/inbox"
    }
  }
}
```

Set `FACTORY_INTAKE_CONFIG` to that configuration file. Supply the runtime PostgreSQL URL through the configured environment variable, not request JSON, CLI arguments, or source control. Do not use migration/superuser credentials. Configuration revision labels identify operator configuration; they are not workflow approvals or execution policies.

For a provisioned runtime role, grant schema usage and SELECT on its RLS-protected memberships and intake tables; INSERT on the three intake tables; and UPDATE **only on the version column** of `factory.intake_heads`. Never grant history/receipt UPDATE or DELETE, TRUNCATE, DDL, membership changes, superuser, or BYPASSRLS. SQL policies require authenticated `session_user` membership and the matching owner for writes. `af_peer` is an additional synthetic test writer used to verify actor-scoped receipts; it receives no queue grants.

## Commands

A request file contains exactly two fields:

```json
{"objective":"Investigate a synthetic ML baseline","context":"Record the request only; no training is authorized."}
```

```sh
node dist/cli/index.js work-item create --project local-demo --key request-001 --file request.json
node dist/cli/index.js work-item create --project local-demo --key request-002 --objective 'Build a local utility' --context 'Record the request only.'
node dist/cli/index.js work-item revise --project local-demo --id WORK_ITEM_ID --expected-revision r1 --key revision-001 --file revised.json
node dist/cli/index.js work-item show --project local-demo --id WORK_ITEM_ID
node dist/cli/index.js work-item show --project local-demo --id WORK_ITEM_ID --revision r1
```

Use the actual returned UUID for `WORK_ITEM_ID`. File input and explicit fields are mutually exclusive. Duplicate/unknown options and request-supplied identity, authorization, execution, publication, or compute fields fail. The existing `validate` command is unchanged.

Create/revise print only a `recorded` receipt, identifier, revision, and content digest. They never echo request bodies. `show` deliberately returns the authorized normalized WorkItem and provenance; its output is sensitive and must not be sent to public logs. CLI argument text can appear in shell history/process listings: prefer a private file for sensitive requests. Error messages omit raw content, private paths and database URLs.

## Storage, revisions and recovery

Migration `002-work-items.cjs` adds only:

- `intake_heads`: organization/project/ID key, authorized owner, current version.
- `intake_revisions`: immutable exact source bytes, normalized objective/context, source kind, SQL-authenticated actor, timestamp, database-computed SHA-256 digest, and version.
- `intake_receipts`: immutable organization/project/actor/operation/key, request digest, and reference to the committed revision.

All three tables enable and force RLS. Owner checks and actor checks apply even to direct SQL from non-privileged runtime roles. Deferred foreign keys prevent a committed head without its revision; a trigger enforces initial version 1 and sequential updates. Existing workflow tables/migrations are unchanged. Historical revision/receipt mutation has neither a policy nor runtime grants. Administrators remain trusted.

Textual revision `rN` maps exactly to integer version N. Revisions start at `r1`. Revising requires the current expected revision; concurrent competitors cannot both succeed. Existing workflow snapshots and approvals are never changed by intake revisions.

File input retains exact bytes, including whitespace, separately from WorkItem normalization. CLI input retains the UTF-8 `JSON.stringify({objective, context})` envelope in that field order, before normalization. Source kind distinguishes the formats. Provenance records the authenticated actor, input kind, timestamp and digest; it deliberately omits private filenames/paths. Paths inside content are never followed.

Idempotency is scoped by organization, project, authenticated actor and operation. The operation digest binds the target, expected revision, source kind and exact input bytes. Identical retries return the original revision even after newer revisions exist. Conflicting reuse fails. Different keys can intentionally create separate requests with identical content.

Heads, revisions and receipts commit atomically. After interruption or an uncertain response, repeat the exact command with the same key and input. Do not generate a replacement key automatically. An uncommitted transaction rolls back; a committed operation returns its original receipt. Input files are never moved, edited or deleted. Recovery needs only PostgreSQL; it does not start a worker.

## Security boundaries and limits

Inputs are limited to 64 KiB, with each normalized objective/context limited to 4,000 characters. Only a single conservative filename is allowed within the configured inbox. Traversal, absolute names, separators, symlinks, hard links and special files fail. The reader checks ownership and POSIX permissions, opens with no-follow/nonblocking flags, validates descriptor identity, performs a bounded read, and compares identity/timestamps before and after reading. Malformed UTF-8 is rejected.

The operator must not grant additional untrusted access through ACLs or share the trusted OS account. These checks are not a boundary against the trusted account, root, a compromised host, or arbitrary hostile network filesystems. Mutation detection is best effort within that trust boundary; timestamps are not cryptographic proof of an immutable file. Root-owned sticky temporary ancestors are permitted, but the inbox itself must be private and owned by the operator.

Original content may contain secrets. It remains private in PostgreSQL and backups, accessible to authorized project readers. This increment provides no retention deletion, encryption/key-management service, large-data import, or ArtifactStore. Operator storage quotas and backup policy remain necessary; per-request limits do not bound aggregate database growth.

Recording a request consumes only bounded intake processing/storage. It does not create a Run, publish queue work, approve a plan, call an agent, start a sandbox, provision compute, or publish artifacts. The accepted AF-023 checkpoint implemented no Telegram or subsequent ticket. AF-029 now adds the optional adapter described below; it does not change this execution boundary. AF-007 remains restricted to its accepted Linux AMD64 synthetic scope; macOS ARM64 sandbox validation remains outstanding.

See `AF023_VERIFICATION.md` for actual verification and acceptance mapping.

## Optional Telegram channel

AF-029 reuses this store and its authenticated actor/RLS model. Its additive migration allows `source_kind = "telegram"`; file and CLI behavior are preserved. A metadata-only `WorkItemStore.list` returns at most ten IDs/revisions using a project-scoped keyset cursor. PostgreSQL intake also supports caller-owned transactions on the same authenticated connection; standalone create/revise behavior still owns its transaction. See `TELEGRAM.md` for the separately started adapter, pairing, and privacy boundaries. No Telegram configuration is needed by this CLI.
