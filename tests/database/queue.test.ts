import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { WorkflowQueue, SingleWorker, type Wake } from '../../src/adapters/pg-boss-queue.js';
import { PostgresWorkflowStore } from '../../src/adapters/postgres/workflow-store.js';
import { validateConfiguration } from '../../src/core/configuration.js';
import { BOOTSTRAP_POLICY, BOOTSTRAP_CONTRACT_CATALOG } from '../../src/core/policy.js';
import { createRun, transition } from '../../src/core/workflow.js';

const url = 'postgres://af_app:synthetic-local-runtime-only@127.0.0.1:55432/agentic_factory_local';
const scope = { organizationId: 'synthetic-org-a', projectId: 'synthetic-software-project' };
const config = () => validateConfiguration(JSON.parse(readFileSync('fixtures/software-general.json', 'utf8')) as unknown, BOOTSTRAP_POLICY, BOOTSTRAP_CONTRACT_CATALOG);
test('AF-005 atomic state/queue commit, rollback, duplicate event and stale attempt fencing', async () => {
  const queue = new WorkflowQueue(url); await queue.start();
  const store = new PostgresWorkflowStore(url, (client, scope, run) => queue.publish(client, scope, run));
  try {
    const id = randomUUID(); await store.create(scope, id, config());
    const approval = { type: 'approve' as const, planRevision: '1', policyRevision: BOOTSTRAP_POLICY.revision };
    await store.apply(scope, id, 0, 'approve', approval);
    await store.apply(scope, id, 0, 'approve', approval);
    const jobs = await queue.boss.findJobs('workflow', { data: { runId: id } });
    assert.equal(jobs.length, 1);
    const job = await queue.claim(); assert.ok(job); assert.equal(job.data.runId, id);
    await assert.rejects(queue.settle(store, job, async (client) => {
      await store.applyInTransaction(client, scope, id, 1, 'start', { type: 'start' });
      throw new Error('Synthetic failure after state and enqueue.');
    }), /Synthetic failure/);
    assert.equal((await store.get(scope, id)).version, 1);
    assert.equal((await queue.boss.getJobById('workflow', job.id))!.state, 'active');
    await queue.boss.fail('workflow', { id: job.id, retryCount: job.retryCount });
    const replacement = (await queue.boss.fetch<typeof job.data>('workflow', { includeMetadata: true, ignoreStartAfter: true }))[0]!;
    assert.equal(replacement.id, job.id); assert.equal(replacement.retryCount, job.retryCount + 1);
    await assert.rejects(queue.settle(store, job, async () => { throw new Error('Must not execute stale action.'); }), /Stale queue attempt/);
    await queue.settle(store, replacement, async (client) => { await store.applyInTransaction(client, scope, id, 1, 'start', { type: 'start' }); });
    assert.equal((await store.get(scope, id)).step.attempts, 1);
    const next = await queue.claim(); assert.ok(next);
    await store.pool.query("UPDATE factory_queue.job SET started_on=clock_timestamp()-interval '1 hour' WHERE id=$1 AND name='workflow'", [next.id]);
    await assert.rejects(queue.settle(store, next, async () => {}), /expired/);
    await queue.boss.cancel('workflow', { id: next.id, retryCount: next.retryCount });
  } finally { await store.close(); await queue.close(); }
});

test('AF-005 one coordinator, released ownership, and bounded infrastructure retries', async () => {
  const queue = new WorkflowQueue(url); await queue.start();
  const store = new PostgresWorkflowStore(url);
  const first = new SingleWorker(store, queue); const second = new SingleWorker(store, queue);
  try {
    await first.start(); await assert.rejects(second.start(), /already active/); await first.close(); await second.start();
    const id = await queue.boss.send('workflow', { scope, runId: randomUUID(), version: 0 }, { retryLimit: 1 });
    let job = await queue.claim(); assert.ok(job); assert.equal(job.id, id);
    await queue.boss.fail('workflow', { id: job.id, retryCount: job.retryCount });
    job = (await queue.boss.fetch<Wake>('workflow', { includeMetadata: true, ignoreStartAfter: true }))[0]; assert.ok(job);
    await queue.boss.fail('workflow', { id: job.id, retryCount: job.retryCount });
    assert.equal((await queue.boss.getJobById('workflow', id!))!.state, 'failed');
  } finally { await first.close(); await second.close(); await store.close(); await queue.close(); }
});

test('AF-005 repair budgets, approval waits, and cancellation are independent of experimentation', () => {
  let run = createRun('synthetic-run', config());
  assert.equal(run.phase, 'awaiting-approval');
  run = transition(run, { type: 'approve', planRevision: '1', policyRevision: BOOTSTRAP_POLICY.revision });
  for (let attempt = 0; attempt < 3; attempt++) {
    run = transition(run, { type: 'start' });
    run = transition(run, { type: 'technical-failure', generation: run.step.generation });
  }
  assert.equal(run.outcome.execution, 'failed'); assert.equal(run.step.attempts, 3); assert.equal(run.step.variants, 0);
  assert.throws(() => transition(run, { type: 'start' }), /Terminal/);
  let cancelled = createRun('synthetic-cancel', config());
  cancelled = transition(cancelled, { type: 'request-cancellation' });
  assert.throws(() => transition(cancelled, { type: 'approve', planRevision: '1', policyRevision: BOOTSTRAP_POLICY.revision }), /Cancellation/);
  cancelled = transition(cancelled, { type: 'confirm-cancellation' });
  assert.equal(cancelled.outcome.execution, 'cancelled');
});
