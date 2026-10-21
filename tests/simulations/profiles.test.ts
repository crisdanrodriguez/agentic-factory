import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { SyntheticFactory, operationKey, type SimulationScenario } from '../../src/runtime/simulation.js';
import { SYNTHETIC_FINDING } from '../../src/adapters/synthetic/execution.js';
import { evidenceContext, type Command } from '../../src/core/workflow.js';
import { validateConfiguration } from '../../src/core/configuration.js';
import { BOOTSTRAP_POLICY, BOOTSTRAP_CONTRACT_CATALOG } from '../../src/core/policy.js';

const url = 'postgres://af_app:synthetic-local-runtime-only@127.0.0.1:55432/agentic_factory_local';
const profiles = ['software-general', 'ml-research'] as const;
async function setup(profile: typeof profiles[number], scenario: SimulationScenario = {}, performance = false) {
  const directory = await mkdtemp(join(tmpdir(), 'af-synthetic-'));
  let now = Date.UTC(2026, 0, 1);
  const config = validateConfiguration(JSON.parse(readFileSync(`fixtures/${profile}.json`, 'utf8')) as unknown, BOOTSTRAP_POLICY, BOOTSTRAP_CONTRACT_CATALOG);
  if (performance) {
    config.plan.objectiveKind = 'performance';
    config.plan.criteria = ['Synthetic fixture: candidate must outperform baseline under the frozen protocol.'];
    config.workItem.objective = 'Synthetic performance-commitment test; no real model or measured result.';
  }
  const scope = { organizationId: 'synthetic-org-a', projectId: config.workItem.projectId };
  const id = randomUUID();
  let factory = new SyntheticFactory(url, directory, () => now, scope, scenario); await factory.start();
  await factory.store.create(scope, id, config);
  const get = () => factory.store.get(scope, id);
  const apply = async (event: string, command: Command) => factory.store.apply(scope, id, (await get()).version, event, command);
  const approve = () => apply('owner-approval', { type: 'approve', planRevision: config.plan.revision, policyRevision: config.plan.policyRevision });
  const due = () => factory.store.pool.query("UPDATE factory_queue.job SET start_after=clock_timestamp() WHERE name='workflow' AND data->>'runId'=$1 AND state IN ('created','retry')", [id]);
  const tick = async (advance = 2000) => { now += advance; await due(); return factory.tick(); };
  return {
    get factory() { return factory; }, directory, id, scope, config, get, apply, approve, tick, due,
    async restartInAnotherProcess(advance = 2000) {
      await due(); now += advance; await factory.close();
      const script = `
        import { SyntheticFactory } from './.test-build/src/runtime/simulation.js';
        const factory = new SyntheticFactory(${JSON.stringify(url)}, ${JSON.stringify(directory)}, () => ${now}, ${JSON.stringify(scope)}, ${JSON.stringify(scenario)});
        await factory.start();
        try { await factory.tick(); console.log('Synthetic restart reconciliation completed.'); }
        finally { await factory.close(); }
      `;
      try {
        const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { timeout: 10000 });
        assert.equal(result.stdout.trim(), 'Synthetic restart reconciliation completed.');
      } finally {
        factory = new SyntheticFactory(url, directory, () => now, scope, scenario); await factory.start();
      }
    },
    async finish() {
      for (let step = 0; step < 25; step++) {
        const run = await get();
        if (run.phase === 'review' || run.phase === 'terminal') return run;
        assert.ok(await tick(), 'Synthetic workflow unexpectedly has no durable wake.');
      }
      throw new Error('Synthetic workflow exceeded its bounded test step limit.');
    },
    async close() {
      const jobs = await factory.queue.boss.findJobs('workflow', { data: { runId: id } });
      for (const job of jobs) if (['created', 'active', 'retry'].includes(job.state)) await factory.queue.boss.cancel('workflow', job.id);
      await factory.close(); await rm(directory, { recursive: true, force: true });
    },
  };
}

for (const profile of profiles) {
  test(`AF-006 ${profile}: synthetic success preserves approval, verification, objective and human decision`, async () => {
    const h = await setup(profile);
    try {
      assert.equal(await h.factory.tick(), false);
      await h.approve(); let run = await h.finish();
      assert.equal(run.simulation, true); assert.equal(run.config.workItem.origin.kind, 'local');
      assert.deepEqual(run.config.plan.deliveryActions, []);
      assert.deepEqual(run.outcome, { execution: 'completed', verification: 'verified', objective: 'met', humanDecision: 'pending' });
      assert.ok(run.artifactReferences.every((reference) => reference.includes(':synthetic-')));
      assert.equal(run.evidence.length, run.config.profile.checks.length);
      run = await h.apply('owner-accept', { type: 'accept' });
      assert.equal(run.phase, 'terminal'); assert.equal(run.outcome.humanDecision, 'accepted');
    } finally { await h.close(); }
  });
  test(`AF-006 ${profile}: synthetic repairable failure recovers within technical budget`, async () => {
    const h = await setup(profile, { technicalFailures: 1 });
    try {
      await h.approve(); const run = await h.finish();
      assert.equal(run.outcome.verification, 'verified'); assert.equal(run.step.attempts, 2);
      assert.equal(run.step.variants, profile === 'ml-research' ? 1 : 0);
    } finally { await h.close(); }
  });
  test(`AF-006 ${profile}: synthetic exhausted attempts stop permanently`, async () => {
    const h = await setup(profile, { technicalFailures: 99 });
    try {
      await h.approve(); const run = await h.finish();
      assert.equal(run.outcome.execution, 'failed'); assert.equal(run.step.attempts, 3);
      assert.equal(run.outcome.verification, 'unverified'); assert.equal(run.outcome.objective, 'not-assessed');
      assert.equal(await h.tick(), false);
    } finally { await h.close(); }
  });
  test(`AF-006 ${profile}: synthetic cancellation stops persisted job and rejects late completion`, async () => {
    const h = await setup(profile);
    try {
      await h.approve(); await h.tick(); await h.tick();
      const pending = await h.get(); assert.equal(pending.phase, 'awaiting-job'); assert.ok(pending.job);
      await h.apply('cancel', { type: 'request-cancellation' }); await h.finish();
      assert.equal((await h.get()).outcome.execution, 'cancelled');
      assert.equal((await h.factory.jobs.inspect(pending.job.id, evidenceContext(pending))).status, 'cancelled');
      await assert.rejects(h.apply('late', { type: 'job-completed', jobId: pending.job.id, artifactReferences: pending.config.profile.deliverables }), /Terminal/);
    } finally { await h.close(); }
  });
  test(`AF-006 ${profile}: synthetic approval changes invalidate old decisions and evidence`, async () => {
    const h = await setup(profile);
    try {
      await assert.rejects(h.apply('stale-approval', { type: 'approve', planRevision: 'old', policyRevision: h.config.plan.policyRevision }), /revision mismatch/);
      await h.approve(); await h.finish();
      const config = structuredClone(h.config); config.plan.revision = '2'; config.plan.sourceSnapshot = 'synthetic-revised-source';
      const revised = await h.apply('revise', { type: 'revise', config });
      assert.equal(revised.approval.status, 'invalidated'); assert.equal(revised.evidence.length, 0);
      assert.equal(await h.tick(), false);
      await assert.rejects(h.apply('old-approval', { type: 'approve', planRevision: '1', policyRevision: config.plan.policyRevision }), /revision mismatch/);
      await h.apply('reject', { type: 'reject', planRevision: '2', policyRevision: config.plan.policyRevision });
      assert.equal((await h.get()).outcome.humanDecision, 'rejected');
    } finally { await h.close(); }
  });
  test(`AF-006 ${profile}: synthetic duplicate events and wakes do not duplicate jobs`, async () => {
    const h = await setup(profile);
    try {
      const approval = await h.approve();
      await h.factory.store.apply(h.scope, h.id, 0, 'owner-approval', { type: 'approve', planRevision: '1', policyRevision: h.config.plan.policyRevision });
      await h.factory.queue.boss.send('workflow', { scope: h.scope, runId: h.id, version: approval.version });
      const run = await h.finish();
      assert.equal(run.step.attempts, 1); assert.equal((await readdir(h.directory)).length, 1);
      assert.equal((await h.factory.store.pool.query('SELECT * FROM factory.receipts WHERE run_id=$1 AND event_id=$2', [h.id, 'owner-approval'])).rowCount, 1);
    } finally { await h.close(); }
  });
  test(`AF-006 ${profile}: synthetic process restart reconciles recorded job without resubmission`, async () => {
    const h = await setup(profile);
    try {
      await h.approve(); await h.tick(); await h.tick();
      const before = await h.get(); assert.equal(before.phase, 'awaiting-job');
      const files = await readdir(h.directory);
      await h.restartInAnotherProcess();
      const after = await h.finish();
      assert.equal(after.job?.id, before.job?.id); assert.equal(after.step.attempts, 1);
      assert.deepEqual(await readdir(h.directory), files);
      assert.equal(after.outcome.verification, 'verified');
    } finally { await h.close(); }
  });
}

test('AF-006 synthetic submission before state commit is reconciled idempotently after restart', async () => {
  const h = await setup('ml-research');
  try {
    await h.approve(); await h.tick();
    const running = await h.get();
    const request = { context: evidenceContext(running), idempotencyKey: operationKey(running), command: ['synthetic-no-execution'],
      authorizedEnvironment: running.config.profile.environment.fingerprint,
      maxDurationSeconds: running.config.plan.budget.maxDurationSeconds, maxMemoryMb: running.config.plan.budget.maxMemoryMb };
    // Model a service accepting submission while the coordinator fails before recording the ID.
    const submitted = await h.factory.jobs.start(request);
    await assert.rejects(h.factory.jobs.start({ ...request, command: ['different-content'] }), /different content/);
    await h.restartInAnotherProcess();
    assert.equal((await h.get()).job?.id, submitted.jobId);
    await h.finish(); assert.equal((await readdir(h.directory)).length, 1);
  } finally { await h.close(); }
});

test('AF-006 synthetic cancellation reconciles submission whose state commit was lost', async () => {
  const h = await setup('software-general');
  try {
    await h.approve(); await h.tick(); const running = await h.get();
    const request = { context: evidenceContext(running), idempotencyKey: operationKey(running), command: ['synthetic-no-execution'],
      authorizedEnvironment: running.config.profile.environment.fingerprint,
      maxDurationSeconds: running.config.plan.budget.maxDurationSeconds, maxMemoryMb: running.config.plan.budget.maxMemoryMb };
    const submitted = await h.factory.jobs.start(request);
    await h.apply('cancel', { type: 'request-cancellation' });
    await h.apply('cancel-again', { type: 'request-cancellation' }); await h.finish();
    assert.equal((await h.factory.jobs.inspect(submitted.jobId, request.context)).status, 'cancelled');
    assert.equal((await h.get()).outcome.execution, 'cancelled');
  } finally { await h.close(); }
});

test('AF-006 synthetic unfavorable ML performance remains unmet without automatic repair or search', async () => {
  const h = await setup('ml-research', {}, true);
  try {
    await h.approve(); const run = await h.finish();
    assert.equal(SYNTHETIC_FINDING.label, 'synthetic-simulation-only'); assert.equal(SYNTHETIC_FINDING.improved, false);
    assert.equal(run.outcome.execution, 'completed'); assert.equal(run.outcome.verification, 'verified');
    assert.equal(run.outcome.objective, 'unmet'); assert.equal(run.step.attempts, 1); assert.equal(run.step.variants, 1);
    for (let i = 0; i < 3; i++) assert.equal(await h.tick(), false);
    assert.equal((await h.get()).version, run.version);
  } finally { await h.close(); }
});

test('AF-006 synthetic external-job timeout consumes bounded technical attempts, not experimental variants', async () => {
  const h = await setup('ml-research', { neverCompletes: true });
  try {
    await h.approve();
    for (let attempt = 1; attempt <= 3; attempt++) {
      await h.tick(); await h.tick();
      await h.tick(h.config.plan.budget.maxDurationSeconds * 1000 + 1);
    }
    const run = await h.get();
    assert.equal(run.outcome.execution, 'failed'); assert.equal(run.step.attempts, 3); assert.equal(run.step.variants, 1);
    assert.equal(await h.tick(), false);
  } finally { await h.close(); }
});

for (const missing of ['missingArtifacts', 'missingVerification'] as const) {
  test(`AF-006 synthetic ${missing} cannot claim verified success`, async () => {
    const h = await setup('ml-research', { [missing]: true });
    try {
      await h.approve();
      await assert.rejects(h.finish(), missing === 'missingArtifacts' ? /Missing required artifacts/ : /no passing evidence/);
      const run = await h.get();
      assert.equal(run.outcome.verification, 'unverified'); assert.equal(run.outcome.objective, 'not-assessed');
      assert.equal(run.outcome.humanDecision, 'pending');
    } finally { await h.close(); }
  });
}

test('AF-006 synthetic journal rejects another project context and invalid paths', async () => {
  const h = await setup('ml-research');
  try {
    await h.approve(); await h.tick(); await h.tick(); const run = await h.get(); assert.ok(run.job);
    await assert.rejects(h.factory.jobs.inspect(run.job.id, { ...evidenceContext(run), projectId: 'other-project' }), /authorized context/);
    await assert.rejects(h.factory.jobs.inspect('../other-project', evidenceContext(run)), /Invalid synthetic job/);
  } finally { await h.close(); }
});


test('AF-006 synthetic research variants are explicit, bounded, and retained in audit history', async () => {
  const h = await setup('ml-research');
  try {
    const config = structuredClone(h.config);
    config.plan.revision = '2'; config.plan.research!.protocolRevision = 'synthetic-two-variant-protocol';
    config.plan.research!.stoppingRule = 'Synthetic limit test: at most two explicitly requested variants, each with at most three technical attempts.';
    await h.apply('two-variant-protocol', { type: 'revise', config });
    await h.apply('approve-two-variant-protocol', { type: 'approve', planRevision: '2', policyRevision: config.plan.policyRevision });
    await h.finish();
    await h.apply('authorized-second-variant', { type: 'next-variant' });
    const run = await h.finish();
    assert.equal(run.step.variants, 2); assert.equal(run.step.attempts, 1);
    assert.equal((await readdir(h.directory)).length, 2);
    const completed = await h.factory.store.pool.query("SELECT * FROM factory.events WHERE run_id=$1 AND command->>'type'='job-completed'", [h.id]);
    assert.equal(completed.rowCount, 2);
    await assert.rejects(h.apply('excess-variant', { type: 'next-variant' }), /variant limit exhausted/);
    assert.equal(await h.tick(), false);
  } finally { await h.close(); }
});


test('review regression: completion before deadline survives late process restart and repeated reconciliation', async () => {
  const h = await setup('ml-research');
  try {
    await h.approve(); await h.tick(); await h.tick();
    const before = await h.get(); assert.ok(before.job);
    await h.restartInAnotherProcess(301000);
    const after = await h.finish();
    assert.equal(after.outcome.execution, 'completed'); assert.equal(after.step.attempts, 1);
    const context = evidenceContext(after);
    const path = join(h.directory, `${before.job.id}.json`);
    const contents = readFileSync(path, 'utf8');
    for (let i = 0; i < 3; i++) assert.equal((await h.factory.jobs.inspect(before.job.id, context)).status, 'completed');
    assert.equal(readFileSync(path, 'utf8'), contents);
    assert.equal((await readdir(h.directory)).length, 1);
  } finally { await h.close(); }
});

test('review regression: genuine timeout remains failed after process restart and repeated reconciliation', async () => {
  const h = await setup('ml-research', { neverCompletes: true });
  try {
    await h.approve(); await h.tick(); await h.tick(); const before = await h.get(); assert.ok(before.job);
    await h.restartInAnotherProcess(301000);
    assert.equal((await h.get()).phase, 'ready');
    for (let i = 0; i < 3; i++) assert.equal((await h.factory.jobs.inspect(before.job.id, evidenceContext(before))).status, 'failed');
    assert.equal((await readdir(h.directory)).length, 1);
  } finally { await h.close(); }
});
