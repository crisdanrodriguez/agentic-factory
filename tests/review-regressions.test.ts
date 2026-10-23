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
  assertMandatoryWorkflow(workflow);
  const commands = [...workflow.matchAll(/^\s+- run: (.+)$/gm)].map((match) => match[1]);
  const required = ['npm ci --ignore-scripts --no-audit --no-fund', 'npm run deps:patch', 'npm run deps:check', 'npm run test:deps', 'npm run lint', 'npm run typecheck', 'npm test', 'npm run build', 'npm run db:migrate', 'npm run db:setup-local', 'npm run db:setup-telegram', 'npm run db:setup-queue', 'npm run test:compatibility', 'npm run test:state', 'npm run test:queue', 'npm run test:intake', 'npm run test:telegram', 'npm run test:simulations'];
  let previous = -1;
  for (const command of required) { const index = commands.indexOf(command); assert.ok(index > previous, `Missing or out-of-order mandatory CI command: ${command}`); previous = index; }
});

function assertMandatoryWorkflow(workflow: string): void {
  const cleanup = '      - name: Clean sandbox test resources\n        if: always()\n        run: python3 scripts/cleanup-sandbox-ci.py';
  assert.equal(workflow.split(cleanup).length, 2, 'Exactly one unconditional cleanup step is required');
  assert.doesNotMatch(workflow.replace(cleanup, ''), /continue-on-error:|\bif:|\|\|\s*true/);
  const sandbox = workflow.split('  sandbox:')[1] ?? '';
  for (const command of ['npm ci --ignore-scripts --no-audit --no-fund', 'npm run deps:patch', 'npm run deps:check',
    'sudo --preserve-env=GITHUB_ACTIONS,RUNNER_ENVIRONMENT,GITHUB_WORKSPACE bash scripts/provision-sandbox-ci.sh',
    'npm run build', 'npm run test:sandbox-tools', 'npm run sandbox:image', 'npm run test:sandbox']) {
    assert.ok(sandbox.includes(`      - run: ${command}\n`), `Missing mandatory sandbox command: ${command}`);
  }
}
test('review regression: only unconditional sandbox cleanup may use a workflow condition', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
  assertMandatoryWorkflow(workflow);
  for (const changed of [workflow.replace('if: always()', 'if: success()'),
    workflow.replace('- run: npm run test:sandbox', '- if: false\n        run: npm run test:sandbox'),
    workflow.replace('- run: npm run sandbox:image', '- continue-on-error: true\n        run: npm run sandbox:image'),
    workflow.replace('npm run test:sandbox\n', 'npm run test:sandbox || true\n')]) {
    assert.throws(() => assertMandatoryWorkflow(changed));
  }
});
