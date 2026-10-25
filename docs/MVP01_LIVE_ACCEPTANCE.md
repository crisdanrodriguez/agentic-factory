# MVP-01 GitHub issue acceptance

This procedure is a future operator gate. It does not install a GitHub App,
request credentials, post comments, invoke a model, execute a Run, publish a
pull request, or merge code by itself.

## Isolated setup

1. Create a dedicated PostgreSQL 18.6 instance with the reviewed image digest,
   a unique Compose project and volume, loopback-only networking, and
   synthetic data. Do not reuse AF-029, AF-031, or automated-test databases.
2. Apply migrations 001 through 003 with the migration-only identity. Run the
   migration command a second time and record the no-op result. Verify the
   GitHub origin columns and constraint, forced RLS on all application tables,
   and the separate runtime role grants.
3. Provision one organization, project, owner, installation binding, and one
   authorized repository. Keep identifiers and credentials in private files
   with mode 0600; never put them in GitHub issues, logs, reports, or the
   repository.

## GitHub App gate

The owner must install one reviewed GitHub App only in the approved repository
and provide credentials through the private local configuration mechanism.
The adapter must verify installation, repository, and sender identity from
authenticated GitHub responses. Issue text, labels, usernames, and comments
are untrusted data and cannot grant authorization. Read-only discovery must be
tested before any comment writer is enabled.

The REST transport uses the GitHub App private key only to mint a short-lived
installation token over TLS to `api.github.com`. It uses bounded responses,
timeouts, rate-limit handling, and no automatic retry of comment POSTs. A
timeout after a comment request is an uncertain remote outcome and requires
operator reconciliation before another comment with the same purpose is sent.

Codex refinement is a separate local gate. The operator must verify the
supported programmatic authentication method for the installed Codex runtime
(`codex login --help` currently documents device authentication and stdin-based
API-key/access-token login), inject it through the private local mechanism,
select a reviewed model and fixed call/output budget, and explicitly enable
refinement for this session. Check `codex login status` without recording its
response. Never put a token in command history, GitHub, issue text, ordinary
logs, or a sandbox. Without this authorization, deterministic fake refinement
is the only available mode.

## Acceptance sequence

1. Create one small synthetic software Issue from the authorized owner.
2. Run one bounded polling pass. Verify one canonical `external-ticket`
   WorkItem, one revision, and one idempotency receipt for the stable issue
   identity. Repeat polling and verify no new revision or receipt.
3. Edit the Issue once. Verify exactly one new WorkItem revision and that any
   prior plan approval is stale and cannot be used.
4. With explicit local authorization, invoke the configured Codex PlanRefiner
   once under its fixed model, output, and call budget. The proposed plan must
   be bound to the current WorkItem revision and policy revision.
5. Use the reviewed GitHub writer to post the plan or a clarification only
   after the owner authorizes that write. Approve or reject only the exact
   current revision through an authenticated owner operation; labels and free
   text are never approval.
6. Restart the local process and verify the current plan approval remains
   durable. Confirm that no Run started, no queue job was published, no agent
   or sandbox was invoked, and no pull request was created.

## Local entrypoint and private configuration

Build the reviewed worktree with Node.js 24.22.0 and npm 11.9.0, then create a
0600 JSON file outside the repository and set only its path in
`FACTORY_GITHUB_MVP_CONFIG`. Set the database password-bearing URL only in the
environment variable named by `databaseUrlEnvironment`; do not put the URL in
the JSON file.

The configuration fields are:

```json
{
  "databaseUrlEnvironment": "FACTORY_MVP01_DATABASE_URL",
  "scope": { "organizationId": "<approved organization>", "projectId": "<approved project>" },
  "trust": {
    "installationId": 0,
    "repositoryId": 0,
    "repositoryFullName": "owner/repository",
    "ownerId": "<approved owner>",
    "projectId": "<approved project>",
    "authorizedSenderId": 0
  },
  "github": {
    "appId": 0,
    "installationId": 0,
    "repositoryId": 0,
    "repositoryFullName": "owner/repository",
    "privateKeyPath": "/private/operator/github-app.pem"
  },
  "stateDirectory": "/private/operator/mvp01-state",
  "codex": {
    "executable": "/private/operator/codex",
    "workspace": "/private/operator/mvp01-workspace",
    "model": "<reviewed model>",
    "timeoutMs": 120000,
    "maxOutputBytes": 200000,
    "maxCalls": 1,
    "authorized": false,
    "codexHome": "/private/operator/codex-home"
  },
  "allowGitHubWrites": false,
  "allowOwnerApprovals": false
}
```

The numeric placeholders must be replaced only from authenticated first-party
records. The App key and state directory must be private. The first command is read-only discovery. It verifies the installation and
repository scope and lists bounded issue metadata without advancing the local
polling cursor or creating WorkItems:

```sh
npm run build
FACTORY_GITHUB_MVP_CONFIG=/private/operator/mvp01.json \
node dist/cli/index.js github-mvp discover
```

After discovery is reviewed, run synchronization only with the database and
Codex authorization configured. Synchronization records or revises canonical
WorkItems and may invoke the explicitly authorized local Codex refinement
transport; it does not publish comments or authorize execution:

```sh
FACTORY_GITHUB_MVP_CONFIG=/private/operator/mvp01.json \
node dist/cli/index.js github-mvp synchronize
```

Inject `FACTORY_MVP01_DATABASE_URL` through the owner’s private secret
mechanism in the same Terminal before the command; never place its value in
shell history or this document.

Set `codex.authorized` to `true` only after the owner has completed the private
Codex login gate. Set `allowGitHubWrites` to `true` only to publish the exact
current plan, and set `allowOwnerApprovals` to `true` only to process exact
owner comments. These are separate invocations; the runtime never escalates
between them automatically.

## Evidence and stop conditions

Record counts, revision identifiers, policy revision, authorization outcomes,
and database state without recording issue bodies, tokens, private paths, or
credentials. Stop on an identity mismatch, missing RLS evidence, ambiguous
transaction result, stale approval, duplicate side effect, unexpected network
call, or cleanup failure. A failed or unavailable live check is not a pass.

### Read-only discovery acceptance

The first owner-authorized live discovery completed successfully on the
reviewed MVP-01 worktree. The sanitized result was:

- Exit code: `0`.
- GitHub App authentication: passed.
- Installation and repository authorization: passed for the dedicated
  `agentic-factory-testbed` repository.
- One existing issue was discovered (`#1`, action `opened`).
- Intake tables and workflow runs remained empty; no polling cursor was
  advanced.
- No GitHub write, comment, WorkItem creation, Codex call, or agent execution
  occurred.

This proves only the bounded read-only discovery path. Synchronization,
canonical WorkItem creation, issue revision handling, Codex refinement,
comment publication, owner approval, restart recovery, and execution remain
separate gates and are not accepted by this result.

The current implementation has only deterministic offline evidence and an
isolated synthetic PostgreSQL verification. A real App installation,
authenticated GitHub exchange, and owner-authorized comment/model operation
are now partially verified for read-only discovery; all write, synchronization,
approval, model, and execution operations remain pending.

## Migration compatibility note

MVP-01 migration `003-github-issue-origin.cjs` and the paused AF-029 migration
`003-telegram.cjs` both modify the
`intake_revisions_source_kind_check` constraint. They must not be applied
together by filename order. A future combined branch needs an additive,
renumbered migration that reconciles both source kinds; AF-029 is unchanged in
this increment.
