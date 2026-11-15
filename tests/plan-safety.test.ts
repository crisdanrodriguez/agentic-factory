import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateConfiguration, type ProjectConfiguration } from '../src/core/configuration.js';
import { assertPlanSafety } from '../src/core/plan-safety.js';
import { BOOTSTRAP_CONTRACT_CATALOG, BOOTSTRAP_POLICY } from '../src/core/policy.js';
import { resolveTrustedVerificationCheck } from '../src/core/verification-registry.js';
import { createRun, transition } from '../src/core/workflow.js';

function fixture(): ProjectConfiguration {
  return JSON.parse(readFileSync('fixtures/software-general.json', 'utf8')) as ProjectConfiguration;
}

test('trusted software delivery checks resolve to reviewed argv and remain approvable', () => {
  const config = validateConfiguration(fixture(), BOOTSTRAP_POLICY, BOOTSTRAP_CONTRACT_CATALOG);
  const spec = resolveTrustedVerificationCheck(config, 'software-tests');
  const argv = [...spec.argv];
  assert.deepEqual(argv, ['python', '-m', 'unittest']);
  assert.deepEqual(spec.environment, { language: 'python', version: '3.12', fingerprint: 'synthetic-python-environment-1' });
  argv[0] = 'changed';
  assert.deepEqual(resolveTrustedVerificationCheck(config, 'software-tests').argv, ['python', '-m', 'unittest']);
  let run = createRun('trusted-run', config);
  run = transition(run, { type: 'approve', planRevision: config.plan.revision, policyRevision: BOOTSTRAP_POLICY.revision });
  assert.equal(transition(run, { type: 'start' }).phase, 'running');
});

test('stored model-authored command cannot gain approval or start authority', () => {
  const config = fixture();
  const pending = createRun('stored-run', config);
  pending.config.profile.checks[0]!.command = ['model-authored-untrusted-command'];
  assert.throws(() => transition(pending, { type: 'approve', planRevision: config.plan.revision, policyRevision: BOOTSTRAP_POLICY.revision }), /trusted command registry/);
  const previouslyApproved = structuredClone(pending);
  previouslyApproved.phase = 'ready'; previouslyApproved.approval.status = 'approved';
  assert.throws(() => transition(previouslyApproved, { type: 'start' }), /trusted command registry/);
  assert.throws(() => transition(previouslyApproved, { type: 'job-started', jobId: 'job', operationKey: 'key' }), /trusted command registry/);
  assert.equal(previouslyApproved.step.attempts, 0);
});

test('old policy and permissions outside trusted rules fail on stored Runs', () => {
  const old = createRun('old-run', fixture());
  old.config.plan.policyRevision = 'bootstrap-policy-1';
  assert.throws(() => transition(old, { type: 'approve', planRevision: old.config.plan.revision, policyRevision: 'bootstrap-policy-1' }), /policy revision/);
  const rejected = transition(old, { type: 'reject', planRevision: old.config.plan.revision, policyRevision: 'bootstrap-policy-1' });
  assert.equal(rejected.approval.status, 'rejected');
  assert.equal(rejected.phase, 'terminal');
  old.phase = 'ready'; old.approval.status = 'approved';
  assert.throws(() => transition(old, { type: 'start' }), /policy revision/);
  for (const change of [
    (config: ProjectConfiguration) => { config.profile.requiredCapabilities.push('job.cpu'); },
    (config: ProjectConfiguration) => { config.profile.checks[0]!.id = 'unknown-check'; },
    (config: ProjectConfiguration) => { config.plan.dependencies.push('unapproved-dependency'); },
    (config: ProjectConfiguration) => { config.profile.environment.fingerprint = 'unreviewed-environment'; },
  ]) {
    const config = fixture(); change(config);
    assert.throws(() => validateConfiguration(config, BOOTSTRAP_POLICY, BOOTSTRAP_CONTRACT_CATALOG));
  }
});

test('exact WorkItem content and durable source digest are required', () => {
  const config = fixture();
  assert.doesNotThrow(() => assertPlanSafety(config, { workItem: config.workItem, digest: config.plan.sourceSnapshot }));
  assert.throws(() => assertPlanSafety(config, { workItem: { ...config.workItem, context: 'Changed source.' }, digest: config.plan.sourceSnapshot }), /stale/);
  assert.throws(() => assertPlanSafety(config, { workItem: config.workItem, digest: 'different-digest' }), /stale/);
});
