import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createRun, transition } from '../src/core/workflow.js';
import { validateConfiguration } from '../src/core/configuration.js';
import { BOOTSTRAP_POLICY, BOOTSTRAP_CONTRACT_CATALOG } from '../src/core/policy.js';

function awaitingJob() {
  const config = validateConfiguration(JSON.parse(readFileSync('fixtures/ml-research.json', 'utf8')) as unknown, BOOTSTRAP_POLICY, BOOTSTRAP_CONTRACT_CATALOG);
  let run = createRun('synthetic-artifact-regression', config);
  run = transition(run, { type: 'approve', planRevision: '1', policyRevision: config.plan.policyRevision });
  run = transition(run, { type: 'start' });
  return transition(run, { type: 'job-started', jobId: 'synthetic-job', operationKey: 'synthetic-operation' });
}
for (const [name, references] of [
  ['blank', ['', '', '']],
  ['whitespace', ['source: x', 'report:y', 'experiment-artifacts:z']],
  ['malformed', ['source:../x', 'report:y', 'experiment-artifacts:z']],
  ['unknown kind', ['unknown:x', 'report:y', 'experiment-artifacts:z']],
  ['duplicate', ['source:x', 'report:y', 'experiment-artifacts:z', 'source:x']],
  ['missing kind despite sufficient count', ['source:x', 'source:y', 'report:z']],
] as const) {
  test(`review regression: artifact references reject ${name}`, () => {
    const run = awaitingJob();
    assert.throws(() => transition(run, { type: 'job-completed', jobId: 'synthetic-job', artifactReferences: [...references] }), /artifact/i);
    assert.equal(run.phase, 'awaiting-job');
  });
}
test('review regression: valid artifact references cover all kinds without claiming physical verification', () => {
  const run = transition(awaitingJob(), { type: 'job-completed', jobId: 'synthetic-job', artifactReferences: ['source:synthetic-a', 'report:synthetic-b', 'experiment-artifacts:synthetic-c'] });
  assert.equal(run.phase, 'verifying'); assert.equal(run.outcome.verification, 'unverified');
});
test('review regression: CI provisions PostgreSQL and runs every mandatory check without skip or failure suppression', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.match(workflow, /services:\s+postgres:/);
  assert.match(workflow, /image: postgres:18\.6@sha256:/);
  assert.match(workflow, /55432:5432/);
  assert.match(workflow, /--health-cmd/);
  assert.doesNotMatch(workflow, /continue-on-error:|\bif:|\|\|\s*true/);
  const commands = [...workflow.matchAll(/^\s+- run: (.+)$/gm)].map((match) => match[1]);
  const required = ['npm ci --ignore-scripts --no-audit --no-fund', 'npm run deps:patch', 'npm run deps:check', 'npm run test:deps', 'npm run lint', 'npm run typecheck', 'npm test', 'npm run build', 'npm run db:migrate', 'npm run db:setup-local', 'npm run db:setup-queue', 'npm run test:compatibility', 'npm run test:state', 'npm run test:queue', 'npm run test:simulations'];
  let previous = -1;
  for (const command of required) { const index = commands.indexOf(command); assert.ok(index > previous, `Missing or out-of-order mandatory CI command: ${command}`); previous = index; }
});
