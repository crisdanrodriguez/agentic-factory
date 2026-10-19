import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateConfiguration, type ProjectConfiguration } from '../src/core/configuration.js';
import { BOOTSTRAP_CONTRACT_CATALOG, BOOTSTRAP_POLICY, assertRequiredVerification } from '../src/core/policy.js';
import type { EvidenceContext, Outcome, VerificationResult } from '../src/core/contracts.js';

function fixture(profile = 'software-general'): ProjectConfiguration {
  return validate(JSON.parse(readFileSync(`fixtures/${profile}.json`, 'utf8')) as unknown);
}
function validate(input: unknown): ProjectConfiguration {
  return validateConfiguration(input, BOOTSTRAP_POLICY, BOOTSTRAP_CONTRACT_CATALOG);
}
function evidence(config: ProjectConfiguration): { context: EvidenceContext; results: VerificationResult[] } {
  const research = config.plan.research;
  const context: EvidenceContext = {
    ownerId: config.workItem.ownerId, projectId: config.workItem.projectId, workItemId: config.workItem.id,
    runId: 'synthetic-run-1', planRevision: config.plan.revision, policyRevision: config.plan.policyRevision,
    sourceSnapshot: config.plan.sourceSnapshot, environmentFingerprint: config.profile.environment.fingerprint,
    ...(research ? { protocolRevision: research.protocolRevision, datasetVersion: research.datasetVersion, splitVersion: research.splitVersion, parametersDigest: research.parametersDigest } : {}),
  };
  return { context, results: config.profile.checks.map((check) => ({ checkId: check.id, status: 'passed', context: { ...context }, evidenceReferences: ['synthetic-evidence-1'] })) };
}

for (const profile of ['software-general', 'ml-research']) {
  test(`${profile} validates with local input and no external integration or deployment`, () => {
    const config = fixture(profile);
    assert.equal(config.workItem.origin.kind, 'local');
    assert.equal(config.profile.environment.language, 'python');
    assert.deepEqual(config.plan.deliveryActions, []);
    const { context, results } = evidence(config);
    assert.doesNotThrow(() => assertRequiredVerification(config, context, results));
  });
}

for (const field of ['requirePlanApproval', 'requireEvidence'] as const) {
  test(`rejects disabling mandatory ${field}`, () => {
    const config = fixture(); config.policy[field] = false;
    assert.throws(() => validate(config), /cannot disable/);
  });
}
test('rejects removing a mandatory verification even when project lists agree', () => {
  const config = fixture('ml-research');
  config.policy.requiredChecks = ['software-tests'];
  config.profile.checks = config.profile.checks.filter((check) => check.id === 'software-tests');
  assert.throws(() => validate(config), /cannot be removed/);
});
test('rejects making a mandatory verification optional', () => {
  const config = fixture(); config.profile.checks[0]!.required = false;
  assert.throws(() => validate(config), /required profile verification/);
});
test('accepts stricter project limits and additional required checks', () => {
  const config = fixture(); config.plan.budget.maxTechnicalAttempts = 1;
  config.policy.requiredChecks.push('extra-check');
  config.profile.checks.push({ id: 'extra-check', layer: 'software', required: true, command: ['python', 'extra_check.py'] });
  assert.doesNotThrow(() => validate(config));
  const { context, results } = evidence(config);
  assert.throws(() => assertRequiredVerification(config, context, results.slice(0, 1)), /extra-check/);
});
for (const key of Object.keys(BOOTSTRAP_POLICY.limits) as (keyof typeof BOOTSTRAP_POLICY.limits)[]) {
  test(`rejects raising the global ${key} limit`, () => {
    const config = fixture(); config.plan.budget[key] = BOOTSTRAP_POLICY.limits[key] + 1;
    assert.throws(() => validate(config), /exceeds the global/);
  });
}
test('rejects missing capabilities with an actionable error', () => {
  assert.throws(() => validateConfiguration(fixture('ml-research'), BOOTSTRAP_POLICY, { capabilities: ['agent.edit', 'artifact.private', 'verify.command'] }), /Missing capability: job.cpu/);
});
test('rejects removing a profile capability requirement', () => {
  const config = fixture('ml-research'); config.profile.requiredCapabilities = ['artifact.private'];
  assert.throws(() => validate(config), /Missing required profile capability/);
});
test('requested deployment requires an explicit compatible capability', () => {
  const config = fixture(); config.plan.deliveryActions = ['deploy'];
  assert.throws(() => validate(config), /Deployment requires/);
  config.profile.requiredCapabilities.push('delivery.deploy');
  assert.throws(() => validate(config), /Missing capability: delivery.deploy/);
});
test('rejects missing required research protocol and deliverables', () => {
  const config = fixture('ml-research'); delete config.plan.research;
  assert.throws(() => validate(config), /requires a versioned protocol/);
  const other = fixture('ml-research'); other.profile.deliverables = ['source', 'report'];
  assert.throws(() => validate(other), /experiment-artifacts/);
});
test('rejects unknown keys, empty identity, and invalid policy revision', () => {
  assert.throws(() => validate({ ...fixture(), globalPolicy: {} }), /Invalid configuration/);
  const config = fixture(); config.workItem.ownerId = '';
  assert.throws(() => validate(config), /Invalid configuration/);
  const other = fixture(); other.plan.policyRevision = 'old-policy';
  assert.throws(() => validate(other), /policy revision/);
});
test('rejects duplicate profile check identifiers', () => {
  const config = fixture(); config.profile.checks.push(config.profile.checks[0]!);
  assert.throws(() => validate(config), /Duplicate check/);
});
test('cannot claim verification success with a missing required result', () => {
  const config = fixture(); const { context } = evidence(config);
  assert.throws(() => assertRequiredVerification(config, context, []), /no passing evidence/);
});
for (const status of ['failed', 'missing', 'skipped', 'cancelled'] as const) {
  test(`cannot claim verification success after a ${status} required check`, () => {
    const config = fixture(); const { context, results } = evidence(config);
    results[0]!.status = status;
    assert.throws(() => assertRequiredVerification(config, context, results), /no passing evidence/);
  });
}
test('rejects passed status with no evidence references', () => {
  const config = fixture(); const { context, results } = evidence(config); results[0]!.evidenceReferences = [];
  assert.throws(() => assertRequiredVerification(config, context, results), /no passing evidence/);
});
test('rejects fabricated results and duplicate check outcomes', () => {
  const config = fixture(); const { context, results } = evidence(config);
  assert.throws(() => assertRequiredVerification(config, context, [{ checkId: 'software-tests', status: 'passed' }]), /Invalid verification/);
  assert.throws(() => assertRequiredVerification(config, context, [...results, ...results]), /Duplicate verification/);
});
for (const key of ['ownerId', 'projectId', 'workItemId', 'runId', 'planRevision', 'policyRevision', 'sourceSnapshot', 'environmentFingerprint', 'protocolRevision', 'datasetVersion', 'splitVersion', 'parametersDigest'] as const) {
  test(`rejects evidence with stale or mismatched ${key}`, () => {
    const config = fixture('ml-research'); const { context, results } = evidence(config);
    results[0]!.context[key] = 'different-revision-or-identity';
    assert.throws(() => assertRequiredVerification(config, context, results), /Stale or mismatched/);
  });
}
test('rejects an old context even if every result matches that old context', () => {
  const config = fixture(); const { context, results } = evidence(config);
  config.plan.revision = '2';
  assert.throws(() => assertRequiredVerification(config, context, results), /current configuration/);
});
test('evidence validation rechecks mandatory policy rather than trusting callers', () => {
  const config = fixture(); const { context, results } = evidence(config); config.policy.requireEvidence = false;
  assert.throws(() => assertRequiredVerification(config, context, results), /cannot disable/);
});
test('verification does not alter an unmet objective or pending human decision', () => {
  const config = fixture('ml-research'); const { context, results } = evidence(config);
  const outcome: Outcome = { execution: 'completed', verification: 'verified', objective: 'unmet', humanDecision: 'pending' };
  assertRequiredVerification(config, context, results);
  assert.equal(outcome.objective, 'unmet');
  assert.equal(outcome.humanDecision, 'pending');
  assert.equal(config.plan.objectiveKind, 'investigation');
});
