import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresWorkItemStore } from '../../src/adapters/postgres/work-item-store.js';
import { PostgresRefinementIntentStore } from '../../src/adapters/postgres/refinement-intent-store.js';
import { GitHubIssueIntake } from '../../src/core/github-intake.js';
import type { WorkItemStore } from '../../src/ports/work-item-store.js';

const databaseUrl = process.env.MVP01B_INTAKE_DATABASE_URL;
const refinerUrl = process.env.MVP01B_REFINER_DATABASE_URL;
const readerUrl = process.env.MVP01B_READER_DATABASE_URL;
if (process.env.CI === 'true' && (!databaseUrl || !refinerUrl || !readerUrl)) {
  throw new Error('Required MVP-01B PostgreSQL credentials are missing in CI.');
}
const scope = { organizationId: 'synthetic-org-a', projectId: 'synthetic-software-project' };

test('MVP-01B PostgreSQL canonical origin and intent transaction', { skip: !databaseUrl || !refinerUrl }, async () => {
  let store = new PostgresWorkItemStore(databaseUrl!);
  const reference = `owner/demo#${Math.floor(Math.random() * 1000000)}`;
  const source = { kind: 'github' as const, bytes: Buffer.from(JSON.stringify({ objective: 'Synthetic durable intake', context: 'No execution.' })), origin: { provider: 'github', reference, updatedAt: '2026-10-24T00:00:00Z' } };
  try {
    assert.equal((await store.pool.query<{ session_user: string }>('SELECT session_user')).rows[0]?.session_user, 'af_github_intake');
    const serverVersion = (await store.pool.query<{ server_version: string }>('SHOW server_version')).rows[0]?.server_version;
    assert.match(serverVersion ?? '', /^18\.6(?:\s|$)/, 'MVP-01B integration requires PostgreSQL 18.6');
    const results = await Promise.all(Array.from({ length: 2 }, (_, index) => store.ingestWithRefinementIntent!(scope, { kind: 'create', key: `mvp01b-${Math.floor(Math.random() * 1000000)}-${index}` }, source, { sourceRevision: 'r1', originProvider: 'github', originReference: reference })));
    assert.equal(results[0]!.workItem.id, results[1]!.workItem.id);
    assert.equal((await store.pool.query('SELECT count(*)::int AS count FROM factory.github_origins WHERE organization_id=$1 AND project_id=$2 AND reference=$3', [scope.organizationId, scope.projectId, reference])).rows[0].count, 1);
    assert.equal((await store.pool.query('SELECT count(*)::int AS count FROM factory.refinement_intents WHERE organization_id=$1 AND project_id=$2 AND origin_reference=$3', [scope.organizationId, scope.projectId, reference])).rows[0].count, 1);
    assert.equal((await store.pool.query('SELECT count(*)::int AS count FROM factory.intake_receipts WHERE organization_id=$1 AND project_id=$2 AND id=$3', [scope.organizationId, scope.projectId, results[0]!.workItem.id])).rows[0].count, 1);
    assert.equal(await store.getByOrigin({ organizationId: 'synthetic-org-b', projectId: scope.projectId }, 'github', reference), undefined);
    const rls = await store.pool.query("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relnamespace='factory'::regnamespace AND relname IN ('github_origins','refinement_intents')");
    assert.equal(rls.rowCount, 2); assert.ok(rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity));
    const reader = new PostgresWorkItemStore(readerUrl ?? databaseUrl!.replace('af_github_intake:', 'af_reader:'));
    try { await assert.rejects(reader.pool.query('INSERT INTO factory.refinement_intents (organization_id,project_id,work_item_id,source_revision,origin_provider,origin_reference) VALUES ($1,$2,$3,$4,$5,$6)', [scope.organizationId, scope.projectId, results[0]!.workItem.id, 'r1', 'github', reference]), /row-level security|permission denied/); }
    finally { await reader.close(); }
    const privileges = await store.pool.query<{ intake_run_insert: boolean; intake_run_update: boolean; refiner_run_insert: boolean; refiner_run_update: boolean; refiner_event_insert: boolean; intake_can_approve: boolean; refiner_can_approve: boolean }>(`SELECT
      has_table_privilege('af_github_intake','factory.runs','INSERT') AS intake_run_insert,
      has_table_privilege('af_github_intake','factory.runs','UPDATE') AS intake_run_update,
      has_table_privilege('af_github_refiner','factory.runs','INSERT') AS refiner_run_insert,
      has_table_privilege('af_github_refiner','factory.runs','UPDATE') AS refiner_run_update,
      has_table_privilege('af_github_refiner','factory.events','INSERT') AS refiner_event_insert,
      (SELECT can_approve FROM factory.memberships WHERE database_role=session_user AND organization_id=$1 AND project_id=$2) AS intake_can_approve`, [scope.organizationId, scope.projectId]);
    assert.deepEqual(privileges.rows[0], { intake_run_insert: false, intake_run_update: false, refiner_run_insert: true, refiner_run_update: false, refiner_event_insert: false, intake_can_approve: false });
    const roleAttributes = await store.pool.query<{ rolname: string; rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolbypassrls: boolean; rolinherit: boolean; member_of_app: boolean }>(`SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls,rolinherit,
      pg_has_role(rolname,'af_app','MEMBER') AS member_of_app FROM pg_roles WHERE rolname IN ('af_github_intake','af_github_refiner') ORDER BY rolname`);
    assert.equal(roleAttributes.rowCount, 2);
    assert.ok(roleAttributes.rows.every((role) => !role.rolsuper && !role.rolcreatedb && !role.rolcreaterole && !role.rolbypassrls && !role.rolinherit && !role.member_of_app));
    const refiner = new PostgresWorkItemStore(process.env.MVP01B_REFINER_DATABASE_URL!);
    try {
      assert.equal((await refiner.pool.query<{ session_user: string }>('SELECT session_user')).rows[0]?.session_user, 'af_github_refiner');
      assert.equal((await refiner.pool.query<{ can_approve: boolean }>('SELECT can_approve FROM factory.memberships WHERE database_role=session_user AND organization_id=$1 AND project_id=$2', [scope.organizationId, scope.projectId])).rows[0]!.can_approve, false);
      await assert.rejects(refiner.pool.query(`INSERT INTO factory.runs (organization_id,project_id,id,version,state) VALUES ($1,$2,$3,0,$4)`, [scope.organizationId, scope.projectId, `forged-${results[0]!.workItem.id}`, JSON.stringify({ id: `forged-${results[0]!.workItem.id}`, phase: 'awaiting-approval', approval: { status: 'approved' }, outcome: { execution: 'pending', humanDecision: 'approved' }, job: null, config: { workItem: { id: results[0]!.workItem.id, revision: 'r1', ownerId: results[0]!.workItem.ownerId, projectId: scope.projectId } } })]), /non-approver may only create a pending Run/i);
    } finally { await refiner.close(); }
    await assert.rejects(store.pool.query(`UPDATE factory.refinement_intents SET status='running',lease_token='forged' WHERE organization_id=$1 AND project_id=$2 AND work_item_id=$3 AND source_revision='r1'`, [scope.organizationId, scope.projectId, results[0]!.workItem.id]), /Intake may only supersede obsolete refinement intents/i);

    const recoveryReference = `owner/lost-ack#${Math.floor(Math.random() * 1000000)}`;
    const recoveryIssue = { installationId: 7, repositoryId: 9, repositoryFullName: 'owner/demo', issueId: Math.floor(Math.random() * 1000000) + 1, issueNumber: 1, senderId: 13, senderLogin: 'synthetic-owner', title: 'Lost acknowledgement recovery', body: 'No execution.', action: 'opened' as const, updatedAt: '2026-10-24T00:00:00Z' };
    let committedId = '';
    const lostAckStore: WorkItemStore = {
      async get(scopeValue, id, revision) { return store.get(scopeValue, id, revision); },
      async getByOrigin(scopeValue, provider, origin) { return store.getByOrigin(scopeValue, provider, origin); },
      async ingest(scopeValue, operation, intakeSource) { return store.ingest(scopeValue, operation, intakeSource); },
      async ingestWithRefinementIntent(scopeValue, operation, intakeSource, intent) {
        const committed = await store.ingestWithRefinementIntent!(scopeValue, operation, intakeSource, intent);
        committedId = committed.workItem.id;
        throw new Error('Synthetic caller acknowledgement lost after transaction commit.');
      },
      async close() { await store.close(); },
    };
    const trust = { installationId: 7, repositoryId: 9, repositoryFullName: 'owner/demo', organizationId: scope.organizationId, ownerId: 'synthetic-owner', projectId: scope.projectId, authorizedSenderId: 13 };
    await assert.rejects(new GitHubIssueIntake(lostAckStore, trust).ingestDurably(recoveryIssue), /caller acknowledgement lost/i);
    await store.close();
    store = new PostgresWorkItemStore(databaseUrl!);
    const recovered = await new GitHubIssueIntake(store, trust).ingestDurably(recoveryIssue);
    assert.equal(recovered.workItem.id, committedId);
    for (const table of ['intake_heads', 'intake_revisions', 'intake_receipts', 'github_origins', 'refinement_intents'] as const) {
      const rows = await store.pool.query(`SELECT count(*)::int AS count FROM factory.${table} WHERE organization_id=$1 AND project_id=$2 AND ${table === 'github_origins' ? 'reference' : table === 'refinement_intents' ? 'origin_reference' : 'id'}=$3`, [scope.organizationId, scope.projectId, table === 'github_origins' || table === 'refinement_intents' ? recoveryReference : committedId]);
      assert.equal(rows.rows[0]!.count, 1, `${table} must reconcile to one durable record after restart`);
    }
  } finally { await store.close(); }
});

test('MVP-01B PostgreSQL rolls back the WorkItem, receipt, origin, and intent together', { skip: !databaseUrl }, async () => {
  const store = new PostgresWorkItemStore(databaseUrl!);
  const reference = `owner/rollback#${Math.floor(Math.random() * 1000000)}`;
  const source = { kind: 'github' as const, bytes: Buffer.from(JSON.stringify({ objective: 'Synthetic rollback', context: 'No execution.' })), origin: { provider: 'github', reference, updatedAt: '2026-10-24T00:00:00Z' } };
  try {
    const tables = ['intake_heads', 'intake_revisions', 'intake_receipts', 'github_origins', 'refinement_intents'] as const;
    const before = new Map<string, number>();
    for (const table of tables) before.set(table, (await store.pool.query(`SELECT count(*)::int AS count FROM factory.${table} WHERE organization_id=$1 AND project_id=$2`, [scope.organizationId, scope.projectId])).rows[0]!.count);
    await assert.rejects(store.ingestWithRefinementIntent!(scope, { kind: 'create', key: `mvp01b-rollback-${Math.floor(Math.random() * 1000000)}` }, source, { sourceRevision: 'invalid', originProvider: 'github', originReference: reference }));
    for (const table of tables) {
      const after = (await store.pool.query(`SELECT count(*)::int AS count FROM factory.${table} WHERE organization_id=$1 AND project_id=$2`, [scope.organizationId, scope.projectId])).rows[0]!.count;
      assert.equal(after, before.get(table), `${table} must not retain a partial intake`);
    }
  } finally { await store.close(); }
});

test('MVP-01B PostgreSQL lease replacement, late fencing, supersession, and cancellation', { skip: !databaseUrl || !refinerUrl }, async () => {
  const store = new PostgresWorkItemStore(databaseUrl!); const intents = new PostgresRefinementIntentStore(refinerUrl!);
  const reference = `owner/fencing#${Math.floor(Math.random() * 1000000)}`;
  const source = (updatedAt: string) => ({ kind: 'github' as const, bytes: Buffer.from(JSON.stringify({ objective: 'Synthetic fencing', context: 'No execution.' })), origin: { provider: 'github', reference, updatedAt } });
  const operation = (key: string) => ({ kind: 'create' as const, key });
  try {
    const first = await store.ingestWithRefinementIntent!(scope, operation(`mvp01b-fence-${Math.floor(Math.random() * 1000000)}`), source('2026-10-24T00:00:00Z'), { sourceRevision: 'r1', originProvider: 'github', originReference: reference });
    const oldClaim = await intents.claimDue(scope, 'worker-old', 30); assert.ok(oldClaim);
    await intents.pool.query(`UPDATE factory.refinement_intents SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE organization_id=$1 AND project_id=$2 AND work_item_id=$3 AND source_revision='r1'`, [scope.organizationId, scope.projectId, first.workItem.id]);
    const replacement = await intents.claimDue(scope, 'worker-new', 30); assert.ok(replacement); assert.notEqual(replacement.leaseToken, oldClaim.leaseToken);
    await assert.rejects(intents.transaction((client) => intents.complete(client, oldClaim, 'late-old-run')), /stale|cancelled/i);
    await store.ingestWithRefinementIntent!(scope, { kind: 'revise', key: `mvp01b-fence-revise-${Math.floor(Math.random() * 1000000)}`, id: first.workItem.id, expectedRevision: 'r1' }, source('2026-10-24T00:01:00Z'), { sourceRevision: 'r2', originProvider: 'github', originReference: reference });
    const oldStatus = await intents.pool.query<{ status: string }>(`SELECT status FROM factory.refinement_intents WHERE organization_id=$1 AND project_id=$2 AND work_item_id=$3 AND source_revision='r1'`, [scope.organizationId, scope.projectId, first.workItem.id]);
    assert.equal(oldStatus.rows[0]!.status, 'superseded');
    await assert.rejects(intents.transaction((client) => intents.complete(client, replacement, 'late-replaced-run')), /stale|cancelled/i);
    const current = await intents.claimDue(scope, 'worker-current', 30); assert.equal(current?.sourceRevision, 'r2'); assert.ok(current);
    await intents.cancel(scope, first.workItem.id, 'r2');
    await assert.rejects(intents.transaction((client) => intents.complete(client, current, 'cancelled-run')), /stale|cancelled/i);
    const terminal = await intents.pool.query<{ status: string; lease_token: string | null }>(`SELECT status,lease_token FROM factory.refinement_intents WHERE organization_id=$1 AND project_id=$2 AND work_item_id=$3 AND source_revision='r2'`, [scope.organizationId, scope.projectId, first.workItem.id]);
    assert.equal(terminal.rows[0]!.status, 'cancelled'); assert.equal(terminal.rows[0]!.lease_token, null);
  } finally { await Promise.all([store.close(), intents.close()]); }
});
