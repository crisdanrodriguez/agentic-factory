import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateConfiguration } from '../src/core/configuration.js';
import { BOOTSTRAP_CONTRACT_CATALOG, BOOTSTRAP_POLICY } from '../src/core/policy.js';
import { createRun, transition, evidenceContext, type Run } from '../src/core/workflow.js';

function research() {
  const config = validateConfiguration(JSON.parse(readFileSync('fixtures/ml-research.json', 'utf8')) as unknown, BOOTSTRAP_POLICY, BOOTSTRAP_CONTRACT_CATALOG);
  config.plan.research!.stoppingRule = 'Synthetic limit test: at most two explicitly requested variants, each with at most three technical attempts.';
  return transition(createRun('synthetic-limits', config), { type: 'approve', planRevision: '1', policyRevision: BOOTSTRAP_POLICY.revision });
}
function finish(run: Run): Run {
  run = transition(run, { type: 'job-completed', jobId: run.job!.id, artifactReferences: ['source:synthetic-source', 'report:synthetic-report', 'experiment-artifacts:synthetic-results'] });
  return transition(run, { type: 'verify', results: run.config.profile.checks.map((check) => ({ checkId: check.id, status: 'passed', context: evidenceContext(run), evidenceReferences: ['synthetic-evidence'] })) });
}

test('AF-005 technical retries preserve variant identity and have an independent bound', () => {
  let run = research();
  for (let attempt = 1; attempt <= 3; attempt++) {
    run = transition(run, { type: 'start' });
    run = transition(run, { type: 'job-started', jobId: `synthetic-job-${attempt}`, operationKey: `synthetic-key-${attempt}` });
    assert.equal(run.step.variants, 1);
    run = transition(run, { type: 'technical-failure', generation: run.step.generation });
    assert.equal(run.step.attempts, attempt);
  }
  assert.equal(run.phase, 'terminal'); assert.equal(run.outcome.execution, 'failed');
  assert.throws(() => transition(run, { type: 'next-variant' }), /Terminal/);
});

test('AF-005 explicit experimental iterations stop at their approved limit without metric-triggered repairs', () => {
  let run = research();
  assert.throws(() => transition(run, { type: 'next-variant' }), /approved research plan/);
  for (let variant = 1; variant <= 2; variant++) {
    run = transition(run, { type: 'start' });
    run = transition(run, { type: 'job-started', jobId: `synthetic-variant-${variant}`, operationKey: `synthetic-key-${variant}` });
    run = finish(run);
    run = transition(run, { type: 'assess', assessment: 'unmet' });
    assert.equal(run.step.attempts, 1); assert.equal(run.step.variants, variant);
    assert.equal(run.phase, 'review');
    assert.throws(() => transition(run, { type: 'technical-failure', generation: run.step.generation }), /Stale/);
    if (variant === 1) run = transition(run, { type: 'next-variant' });
  }
  assert.throws(() => transition(run, { type: 'next-variant' }), /variant limit exhausted/);
  run = transition(run, { type: 'accept' });
  assert.deepEqual(run.outcome, { execution: 'completed', verification: 'verified', objective: 'unmet', humanDecision: 'accepted' });
});
