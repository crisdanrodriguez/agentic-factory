import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { validateConfiguration } from '../../src/core/configuration.js';
import { BOOTSTRAP_POLICY, BOOTSTRAP_CONTRACT_CATALOG } from '../../src/core/policy.js';
import { PostgresWorkflowStore, type ExternalPlanAuthorization } from '../../src/adapters/postgres/workflow-store.js';
import { PostgresWorkItemStore } from '../../src/adapters/postgres/work-item-store.js';
import { evidenceContext, type Run } from '../../src/core/workflow.js';

const url = (role = 'af_app') => `postgres://${role}:synthetic-local-runtime-only@127.0.0.1:55432/agentic_factory_local`;
const scope = { organizationId: 'synthetic-org-a', projectId: 'synthetic-software-project' };

test('AF-004 gates approval and start on the current durable GitHub WorkItem snapshot', async () => {
  const items = new PostgresWorkItemStore(url());
  let workflows: PostgresWorkflowStore | undefined;
  const reference = `owner/demo#${randomUUID()}`;
  const source = (objective: string) => ({ kind: 'github' as const,
    bytes: Buffer.from(JSON.stringify({ objective, context: 'Synthetic plan-safety fixture.' })),
    origin: { provider: 'github', reference, updatedAt: '2026-10-24T00:00:00Z' } });
  try {
    const intake = await items.ingest(scope, { kind: 'create', key: randomUUID() }, source('First objective'));
    const config = fixture(); config.workItem = intake.workItem;
    config.plan.workItemId = intake.workItem.id; config.plan.sourceSnapshot = intake.digest;
    const authorization: ExternalPlanAuthorization = { scope, workItemId: intake.workItem.id, sourceSnapshot: intake.digest,
      profileId: config.profile.id, capabilities: [...config.profile.requiredCapabilities],
      checks: config.profile.checks.map((check) => check.id), deliverables: [...config.profile.deliverables],
      limits: { ...config.plan.budget }, allowExecution: true };
    const denied = new PostgresWorkflowStore(url());
    try {
      const deniedId = randomUUID(); await denied.create(scope, deniedId, config);
      await assert.rejects(denied.apply(scope, deniedId, 0, 'approve', { type: 'approve', planRevision: config.plan.revision, policyRevision: BOOTSTRAP_POLICY.revision }), /owner-approved authorization/);
    } finally { await denied.close(); }
    workflows = new PostgresWorkflowStore(url(), undefined, [authorization]);
    const wrong = structuredClone(config); wrong.plan.sourceSnapshot = 'wrong-snapshot';
    const wrongId = randomUUID(); await workflows.create(scope, wrongId, wrong);
    await assert.rejects(workflows.apply(scope, wrongId, 0, 'approve', { type: 'approve', planRevision: wrong.plan.revision, policyRevision: BOOTSTRAP_POLICY.revision }), /stale/);
    const id = randomUUID(); await workflows.create(scope, id, config);
    const approval = { type: 'approve' as const, planRevision: config.plan.revision, policyRevision: BOOTSTRAP_POLICY.revision };
    const approved = await workflows.apply(scope, id, 0, 'approve', approval);
    assert.equal(approved.phase, 'ready');
    const withoutAuthorization = new PostgresWorkflowStore(url());
    try {
      await assert.rejects(withoutAuthorization.apply(scope, id, approved.version, 'start-without-authorization', { type: 'start' }), /owner-approved authorization/);
    } finally { await withoutAuthorization.close(); }
    const noExecution = new PostgresWorkflowStore(url(), undefined, [{ ...authorization, allowExecution: false }]);
    try {
      const noExecutionId = randomUUID(); await noExecution.create(scope, noExecutionId, config);
      const reviewOnly = await noExecution.apply(scope, noExecutionId, 0, 'approve', approval);
      await assert.rejects(noExecution.apply(scope, noExecutionId, reviewOnly.version, 'start', { type: 'start' }), /execution constraints/);
    } finally { await noExecution.close(); }
    await items.ingest(scope, { kind: 'revise', key: randomUUID(), id: intake.workItem.id, expectedRevision: 'r1' }, source('Changed objective'));
    await assert.rejects(workflows.apply(scope, id, approved.version, 'start', { type: 'start' }), /stale/);
    assert.equal((await workflows.get(scope, id)).phase, 'ready');
  } finally { await items.close(); await workflows?.close(); }
});
function fixture() { return validateConfiguration(JSON.parse(readFileSync('fixtures/software-general.json', 'utf8')) as unknown, BOOTSTRAP_POLICY, BOOTSTRAP_CONTRACT_CATALOG); }

test('AF-004 persists scoped workflows, revisions, approvals, evidence, and restart recovery', async () => {
  const first = new PostgresWorkflowStore(url());
  const id = randomUUID();
  let run = await first.create(scope, id, fixture());
  await assert.rejects(first.apply(scope, id, 0, 'invalid-start', { type: 'start' }), /Invalid/);
  await assert.rejects(first.apply(scope, id, 0, 'old-approval', { type: 'approve', planRevision: 'old', policyRevision: BOOTSTRAP_POLICY.revision }), /revision mismatch/);
  const approve = { type: 'approve' as const, planRevision: '1', policyRevision: BOOTSTRAP_POLICY.revision };
  run = await first.apply(scope, id, run.version, 'approve', approve);
  assert.deepEqual(await first.apply(scope, id, 0, 'approve', approve), run);
  await assert.rejects(first.apply(scope, id, 0, 'approve', { ...approve, planRevision: 'changed' }), /different content/);
  await first.close();
  const store = new PostgresWorkflowStore(url());
  try {
    assert.deepEqual(await store.get(scope, id), run);
    run = await store.apply(scope, id, run.version, 'start', { type: 'start' });
    await assert.rejects(store.apply(scope, id, 1, 'stale', { type: 'start' }), /Stale/);
    run = await store.apply(scope, id, run.version, 'job', { type: 'job-started', jobId: 'synthetic-job', operationKey: 'synthetic-operation' });
    await assert.rejects(store.apply(scope, id, run.version, 'missing-artifact', { type: 'job-completed', jobId: 'synthetic-job', artifactReferences: [] }), /Missing required artifacts/);
    run = await store.apply(scope, id, run.version, 'finish-job', { type: 'job-completed', jobId: 'synthetic-job', artifactReferences: ['source:synthetic-source', 'report:synthetic-report'] });
    await assert.rejects(store.apply(scope, id, run.version, 'missing-evidence', { type: 'verify', results: [] }), /no passing evidence/);
    const results = [{ checkId: 'software-tests', status: 'passed' as const, context: evidenceContext(run), evidenceReferences: ['synthetic-evidence'] }];
    await assert.rejects(store.apply(scope, id, run.version, 'stale-evidence', { type: 'verify', results: [{ ...results[0]!, context: { ...evidenceContext(run), sourceSnapshot: 'old' } }] }), /Stale or mismatched/);
    run = await store.apply(scope, id, run.version, 'verify', { type: 'verify', results });
    run = await store.apply(scope, id, run.version, 'assess', { type: 'assess', assessment: 'unmet' });
    run = await store.apply(scope, id, run.version, 'accept', { type: 'accept' });
    assert.deepEqual(run.outcome, { execution: 'completed', verification: 'verified', objective: 'unmet', humanDecision: 'accepted' });
    const changed = fixture(); changed.plan.revision = '2'; changed.plan.sourceSnapshot = 'new-source';
    run = await store.apply(scope, id, run.version, 'revision', { type: 'revise', config: changed });
    assert.equal(run.approval.status, 'invalidated'); assert.equal(run.evidence.length, 0);
    assert.equal(run.outcome.objective, 'not-assessed');
    const revisions = await store.pool.query('SELECT revision FROM factory.revisions WHERE run_id=$1 ORDER BY revision', [id]);
    assert.deepEqual(revisions.rows, [{ revision: '1' }, { revision: '2' }]);
  } finally { await store.close(); }
});

test('AF-004 enforces RLS and separate migration privileges under real non-privileged logins', async () => {
  const store = new PostgresWorkflowStore(url());
  const other = new PostgresWorkflowStore(url('af_other'));
  const reader = new PostgresWorkflowStore(url('af_reader'));
  try {
    const id = randomUUID(); await store.create(scope, id, fixture());
    const hiddenScope = { ...scope, organizationId: 'synthetic-org-b' };
    await other.create(hiddenScope, id, fixture());
    await assert.rejects(store.get(hiddenScope, id), /unavailable/);
    assert.equal((await store.pool.query('SELECT * FROM factory.runs WHERE organization_id=$1', ['synthetic-org-b'])).rowCount, 0);
    const runId = randomUUID();
    await assert.rejects(
      store.pool.query('INSERT INTO factory.runs VALUES ($1,$2,$3,0,$4)', ['synthetic-org-b', scope.projectId, runId, { id: 'forged' }]),
      /(row-level security|A non-approver may only create a pending Run)/,
    );
    assert.equal((await other.pool.query('SELECT id FROM factory.runs WHERE organization_id=$1 AND project_id=$2 AND id=$3', ['synthetic-org-b', scope.projectId, runId])).rowCount, 0);
    const runRls = (await store.pool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='factory.runs'::regclass")).rows[0];
    assert.deepEqual(runRls, { relrowsecurity: true, relforcerowsecurity: true });
    await assert.rejects(store.pool.query("SET ROLE af_migrator"), /permission denied/);
    await assert.rejects(store.pool.query('CREATE TABLE factory.forbidden (id int)'), /permission denied/);
    await assert.rejects(store.pool.query("UPDATE factory.memberships SET can_approve=true"), /permission denied/);
    await assert.rejects(reader.apply(scope, id, 0, 'forbidden', { type: 'approve', planRevision: '1', policyRevision: BOOTSTRAP_POLICY.revision }), /not authorized/);
    assert.equal((await reader.pool.query("SELECT * FROM factory.memberships WHERE project_id='synthetic-ml-project'")).rowCount, 0);
    const forged = fixture(); forged.workItem.ownerId = 'forged-owner';
    await assert.rejects(store.create(scope, randomUUID(), forged), /ownership/);
    const role = (await store.pool.query('SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=session_user')).rows[0];
    assert.deepEqual(role, { rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false });
  } finally { await Promise.all([store.close(), other.close(), reader.close()]); }
});

test('AF-004 transaction failure rolls back state, audit and deduplication records', async () => {
  const store = new PostgresWorkflowStore(url(), async () => { throw new Error('Synthetic transaction failure.'); });
  try {
    const id = randomUUID(); const original = await store.create(scope, id, fixture());
    await assert.rejects(store.apply(scope, id, 0, 'rollback', { type: 'approve', planRevision: '1', policyRevision: BOOTSTRAP_POLICY.revision }), /Synthetic transaction failure/);
    assert.deepEqual(await store.get(scope, id), original);
    for (const table of ['events', 'receipts']) assert.equal((await store.pool.query(`SELECT * FROM factory.${table} WHERE run_id=$1`, [id])).rowCount, 0);
  } finally { await store.close(); }
});

test('AF-004 allows only one competing state transition and preserves cancellation on reconnect', async () => {
  const store = new PostgresWorkflowStore(url());
  const id = randomUUID();
  try {
    await store.create(scope, id, fixture());
    const outcomes = await Promise.allSettled(['one', 'two'].map((key) => store.apply(scope, id, 0, key, { type: 'approve', planRevision: '1', policyRevision: BOOTSTRAP_POLICY.revision })));
    assert.equal(outcomes.filter((value) => value.status === 'fulfilled').length, 1);
    const run = await store.get(scope, id);
    await store.apply(scope, id, run.version, 'cancel', { type: 'request-cancellation' });
  } finally { await store.close(); }
  const connection = new Pool({ connectionString: url() });
  try { const row = await connection.query<{ state: Run }>('SELECT state FROM factory.runs WHERE id=$1', [id]); assert.equal(row.rows[0]!.state.cancellationRequested, true); }
  finally { await connection.end(); }
});
