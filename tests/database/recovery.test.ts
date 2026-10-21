import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { WorkflowQueue, SingleWorker, type Wake } from '../../src/adapters/pg-boss-queue.js';
import { PostgresWorkflowStore } from '../../src/adapters/postgres/workflow-store.js';
import { validateConfiguration } from '../../src/core/configuration.js';
import { BOOTSTRAP_POLICY, BOOTSTRAP_CONTRACT_CATALOG } from '../../src/core/policy.js';

const url = 'postgres://af_app:synthetic-local-runtime-only@127.0.0.1:55432/agentic_factory_local';
const scope = { organizationId: 'synthetic-org-a', projectId: 'synthetic-software-project' };
const config = () => validateConfiguration(JSON.parse(readFileSync('fixtures/software-general.json', 'utf8')) as unknown, BOOTSTRAP_POLICY, BOOTSTRAP_CONTRACT_CATALOG);
const approval = { type: 'approve' as const, planRevision: '1', policyRevision: BOOTSTRAP_POLICY.revision };
async function setup() {
  const queue = new WorkflowQueue(url); await queue.start();
  const store = new PostgresWorkflowStore(url, (client, scope, run) => queue.publish(client, scope, run));
  const id = randomUUID(); await store.create(scope, id, config());
  const worker = new SingleWorker(store, queue); await worker.start();
  return { queue, store, id, worker, async close() {
    const jobs = await queue.boss.findJobs('workflow', { data: { runId: id } });
    for (const job of jobs) if (['created', 'retry', 'active'].includes(job.state)) await queue.boss.cancel('workflow', job.id);
    await worker.close(); await store.close(); await queue.close();
  } };
}

test('AF-005 process crash recovers durable queued work and expired claims; old attempt cannot commit', { timeout: 15000 }, async () => {
  const h = await setup();
  try {
    await h.worker.close();
    await h.store.apply(scope, h.id, 0, 'approve', approval);
    // Separate OS process dies with a queue claim and coordinator session still open.
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { WorkflowQueue, SingleWorker } from './.test-build/src/adapters/pg-boss-queue.js';
      import { PostgresWorkflowStore } from './.test-build/src/adapters/postgres/workflow-store.js';
      const queue = new WorkflowQueue(${JSON.stringify(url)}); await queue.start();
      const store = new PostgresWorkflowStore(${JSON.stringify(url)});
      const worker = new SingleWorker(store, queue); await worker.start();
      const job = await queue.claim(); console.log(job.id);
      setInterval(() => {}, 1000);
    `], { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      let errors = ''; child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString(); });
      const output = await Promise.race([
        once(child.stdout, 'data').then((values: unknown[]) => { const chunk = values[0]; assert.ok(Buffer.isBuffer(chunk)); return chunk.toString().trim(); }),
        once(child, 'exit').then(() => { throw new Error(`Synthetic child exited before claim: ${errors}`); }),
      ]);
      const abandoned = await h.queue.boss.getJobById<Wake>('workflow', output); assert.ok(abandoned);
      assert.equal(abandoned.data.runId, h.id);
      const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
      await h.worker.start();
      // Move only this synthetic claim's timestamp, avoiding nondeterministic sleeps.
      await h.store.pool.query("UPDATE factory_queue.job SET started_on=clock_timestamp()-interval '1 hour' WHERE id=$1 AND name='workflow'", [output]);
      await assert.rejects(h.queue.settle(h.store, abandoned, async () => {}), /expired/);
      await h.queue.boss.supervise('workflow');
      const recovered = (await h.queue.boss.fetch<Wake>('workflow', { includeMetadata: true, ignoreStartAfter: true }))[0]; assert.ok(recovered);
      assert.equal(recovered.id, abandoned.id); assert.equal(recovered.retryCount, abandoned.retryCount + 1);
      await assert.rejects(h.queue.settle(h.store, abandoned, async () => {}), /Stale/);
      await h.queue.settle(h.store, recovered, async (client) => {
        await h.store.applyInTransaction(client, scope, h.id, 1, 'recovered-start', { type: 'start' });
      });
      assert.equal((await h.store.get(scope, h.id)).step.attempts, 1);
    } finally { child.kill('SIGKILL'); }
  } finally { await h.close(); }
});

test('AF-005 cancellation fences late completion and duplicate wakes across reconnect', async () => {
  const h = await setup();
  try {
    let run = await h.store.apply(scope, h.id, 0, 'approve', approval);
    run = await h.store.apply(scope, h.id, run.version, 'start', { type: 'start' });
    run = await h.store.apply(scope, h.id, run.version, 'job', { type: 'job-started', jobId: 'synthetic-job', operationKey: 'synthetic-key' });
    const beforeCancellation = run.version;
    run = await h.store.apply(scope, h.id, run.version, 'cancel', { type: 'request-cancellation' });
    const reconnected = new PostgresWorkflowStore(url);
    try {
      await assert.rejects(reconnected.apply(scope, h.id, beforeCancellation, 'late', { type: 'job-completed', jobId: 'synthetic-job', artifactReferences: ['source:synthetic-source', 'report:synthetic-report'] }), /Stale/);
      await assert.rejects(reconnected.apply(scope, h.id, run.version, 'late-current', { type: 'job-completed', jobId: 'synthetic-job', artifactReferences: ['source:synthetic-source', 'report:synthetic-report'] }), /Cancellation/);
    } finally { await reconnected.close(); }
    await h.queue.boss.send('workflow', { scope, runId: h.id, version: run.version });
    let confirmations = 0;
    for (let i = 0; i < 8; i++) {
      if (!await h.worker.once(async (job, client) => {
        confirmations++;
        await h.store.applyInTransaction(client, scope, h.id, job.data.version, 'confirm', { type: 'confirm-cancellation' });
      })) break;
    }
    assert.equal(confirmations, 1);
    assert.equal((await h.store.get(scope, h.id)).outcome.execution, 'cancelled');
    assert.deepEqual(await h.store.apply(scope, h.id, beforeCancellation, 'cancel', { type: 'request-cancellation' }), run);
  } finally { await h.close(); }
});

test('AF-005 approval and external-job waits release processing; reconciliation remains durable', async () => {
  const h = await setup();
  try {
    assert.equal(await h.worker.once(async () => { assert.fail('Approval must block execution.'); }), false);
    await h.store.apply(scope, h.id, 0, 'approve', approval);
    await h.worker.once(async (job, client) => { await h.store.applyInTransaction(client, scope, h.id, job.data.version, 'start', { type: 'start' }); });
    await h.worker.once(async (job, client) => { await h.store.applyInTransaction(client, scope, h.id, job.data.version, 'job', { type: 'job-started', jobId: 'synthetic-wait-job', operationKey: 'synthetic-operation' }); });
    await h.store.pool.query("UPDATE factory_queue.job SET start_after=clock_timestamp()+interval '1 hour' WHERE name='workflow' AND data->>'runId'=$1 AND state='created'", [h.id]);
    assert.equal(await h.worker.once(async () => { assert.fail('Delayed reconciliation should not hold a worker.'); }), false);
    const otherId = randomUUID();
    await h.store.create(scope, otherId, config());
    await h.store.apply(scope, otherId, 0, 'approve', approval);
    try {
      assert.equal(await h.worker.once(async (job, client) => {
        assert.equal(job.data.runId, otherId);
        await h.store.applyInTransaction(client, scope, otherId, job.data.version, 'start', { type: 'start' });
      }), true);
      assert.equal((await h.store.get(scope, otherId)).step.attempts, 1);
    } finally {
      for (const job of await h.queue.boss.findJobs('workflow', { data: { runId: otherId } })) {
        if (['created', 'active', 'retry'].includes(job.state)) await h.queue.boss.cancel('workflow', job.id);
      }
    }
    await h.worker.close();
    const next = new SingleWorker(h.store, h.queue); await next.start(); await next.close();
    const pending = (await h.queue.boss.findJobs('workflow', { data: { runId: h.id } })).filter((job) => job.state === 'created');
    assert.equal(pending.length, 1);
    assert.equal((await h.store.get(scope, h.id)).job?.id, 'synthetic-wait-job');
    // Reclaim the delayed wake as if due, then persist another poll in the same transaction.
    const poll = (await h.queue.boss.fetch<Wake>('workflow', { includeMetadata: true, ignoreStartAfter: true }))[0]; assert.ok(poll);
    await h.queue.settle(h.store, poll, async (client) => {
      const run = await h.store.getForUpdate(client, scope, h.id);
      await h.queue.defer(client, scope, run);
    });
    assert.equal((await h.queue.boss.findJobs('workflow', { data: { runId: h.id } })).filter((job) => job.state === 'created').length, 1);
  } finally { await h.close(); }
});

test('AF-005 coordinator session loss rolls back state and queue settlement', async () => {
  const h = await setup();
  try {
    await h.store.apply(scope, h.id, 0, 'approve', approval);
    await assert.rejects(h.worker.once(async (job, client) => {
      await h.store.applyInTransaction(client, scope, h.id, job.data.version, 'lost-start', { type: 'start' });
      const pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      await h.store.pool.query('SELECT pg_terminate_backend($1)', [pid]);
      await client.query('SELECT 1');
    }));
    assert.equal((await h.store.get(scope, h.id)).version, 1);
    assert.equal((await h.store.pool.query('SELECT * FROM factory.receipts WHERE run_id=$1 AND event_id=$2', [h.id, 'lost-start'])).rowCount, 0);
    await h.worker.close();
    const replacement = new SingleWorker(h.store, h.queue); await replacement.start(); await replacement.close();
  } finally { await h.close(); }
});

test('AF-005 lease expiry during a transaction rolls back its authoritative results', async () => {
  const h = await setup();
  try {
    await h.store.apply(scope, h.id, 0, 'approve', approval);
    const job = await h.queue.claim(); assert.ok(job);
    // Deliberately shorten only this synthetic lease to exercise the post-action check.
    await h.store.pool.query("UPDATE factory_queue.job SET expire_seconds=1 WHERE id=$1 AND name='workflow'", [job.id]);
    let enteredAction = false;
    await assert.rejects(h.queue.settle(h.store, job, async (client) => {
      enteredAction = true;
      await h.store.applyInTransaction(client, scope, h.id, 1, 'slow-start', { type: 'start' });
      await client.query('SELECT pg_sleep(1.05)');
    }), /expired/);
    assert.equal(enteredAction, true);
    assert.equal((await h.store.get(scope, h.id)).version, 1);
    assert.equal((await h.queue.boss.getJobById('workflow', job.id))?.state, 'active');
  } finally { await h.close(); }
});
