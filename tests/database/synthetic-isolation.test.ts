import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PostgresWorkflowStore } from '../../src/adapters/postgres/workflow-store.js';
import { SyntheticJobs } from '../../src/adapters/synthetic/execution.js';
import { evidenceContext } from '../../src/core/workflow.js';
import { validateConfiguration } from '../../src/core/configuration.js';
import { BOOTSTRAP_POLICY, BOOTSTRAP_CONTRACT_CATALOG } from '../../src/core/policy.js';

test('review regression: database-authorized organizations cannot retrieve overwrite cancel or reconcile each other’s synthetic jobs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'af-scope-regression-'));
  const a = new PostgresWorkflowStore('postgres://af_app:synthetic-local-runtime-only@127.0.0.1:55432/agentic_factory_local');
  const b = new PostgresWorkflowStore('postgres://af_other:synthetic-local-runtime-only@127.0.0.1:55432/agentic_factory_local');
  const scopeA = { organizationId: 'synthetic-org-a', projectId: 'synthetic-software-project' };
  const scopeB = { ...scopeA, organizationId: 'synthetic-org-b' };
  try {
    const config = validateConfiguration(JSON.parse(readFileSync('fixtures/software-general.json', 'utf8')) as unknown, BOOTSTRAP_POLICY, BOOTSTRAP_CONTRACT_CATALOG);
    const id = randomUUID(); const runA = await a.create(scopeA, id, config); const runB = await b.create(scopeB, id, config);
    const context = evidenceContext(runA); assert.deepEqual(context, evidenceContext(runB));
    const jobsA = new SyntheticJobs(directory, () => 0, (context) => a.authorizeJob(scopeA, context));
    const jobsB = new SyntheticJobs(directory, () => 2000, (context) => b.authorizeJob(scopeB, context));
    const request = { context, idempotencyKey: 'identical-operation', command: ['synthetic-no-execution'], authorizedEnvironment: context.environmentFingerprint, maxDurationSeconds: 300, maxMemoryMb: 128 };
    const jobA = await jobsA.start(request); const original = await readFile(join(directory, `${jobA.jobId}.json`), 'utf8');
    const jobB = await jobsB.start(request); assert.notEqual(jobA.jobId, jobB.jobId);
    for (const jobs of [jobsB, new SyntheticJobs(directory, () => 5000, (context) => b.authorizeJob(scopeB, context))]) {
      await assert.rejects(jobs.inspect(jobA.jobId, context), /organization\/project scope/);
      await assert.rejects(jobs.cancel(jobA.jobId, context), /organization\/project scope/);
      await jobs.start(request);
    }
    const forged = new SyntheticJobs(directory, () => 0, (context) => b.authorizeJob(scopeA, context));
    await assert.rejects(forged.start(request), /not authorized/);
    await assert.rejects(forged.inspect(jobA.jobId, context), /not authorized/);
    await assert.rejects(jobsA.inspect(jobA.jobId, { ...context, projectId: 'forged-project' }), /authorized context/);
    assert.equal(await readFile(join(directory, `${jobA.jobId}.json`), 'utf8'), original);
    assert.equal((await readdir(directory)).length, 2);
  } finally { await a.close(); await b.close(); await rm(directory, { recursive: true, force: true }); }
});
