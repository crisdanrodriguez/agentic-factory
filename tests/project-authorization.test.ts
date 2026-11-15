import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chmod, link, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { ProjectConfiguration } from '../src/core/configuration.js';
import { validateConfiguration } from '../src/core/configuration.js';
import { assertPlanSafety } from '../src/core/plan-safety.js';
import { BOOTSTRAP_CONTRACT_CATALOG, BOOTSTRAP_POLICY } from '../src/core/policy.js';
import { parseOwnerProjectAuthorization } from '../src/core/project-authorization.js';
import { loadOwnerProjectAuthorization } from '../src/adapters/owner-project-authorization.js';
import { resolveTrustedVerificationCheck } from '../src/core/verification-registry.js';
import { createRun, transition } from '../src/core/workflow.js';

const scope = { organizationId: 'synthetic-org-a', projectId: 'synthetic-software-project' };
const repository = { installationId: 7, repositoryId: 9, fullName: 'owner/demo' };
function projectFixture() {
  const config = JSON.parse(readFileSync('fixtures/software-general.json', 'utf8')) as ProjectConfiguration;
  config.workItem.id = 'reviewed-work-item'; config.workItem.revision = 'r1';
  config.workItem.origin = { kind: 'external-ticket', provider: 'github', reference: 'owner/demo#1' };
  config.plan.workItemId = config.workItem.id; config.plan.sourceSnapshot = 'a'.repeat(64);
  config.profile.environment = { language: 'typescript', version: '5.9', fingerprint: `sha256:${'b'.repeat(64)}` };
  config.profile.checks = [{ id: 'repo-tests', layer: 'software', required: true, command: ['npm', 'test'] }];
  config.policy.requiredChecks = ['repo-tests'];
  const raw = { schemaVersion: 1, policyRevision: BOOTSTRAP_POLICY.revision, scope, repository,
    workItemId: config.workItem.id, sourceSnapshot: config.plan.sourceSnapshot, profileId: 'software-general',
    environment: config.profile.environment, capabilities: config.profile.requiredCapabilities,
    deliverables: config.profile.deliverables,
    checks: [{ id: 'repo-tests', layer: 'software', argv: ['npm', 'test'], workingDirectory: 'packages/app',
      environmentVariables: { CI: 'true' } }], limits: config.plan.budget };
  return { config, raw };
}

test('owner authorization defaults execution off and resolves exact project checks', () => {
  const { config, raw } = projectFixture();
  const authorization = parseOwnerProjectAuthorization(raw, scope, repository);
  assert.equal(authorization.allowExecution, false);
  assert.deepEqual(resolveTrustedVerificationCheck(config, 'repo-tests', authorization), {
    argv: ['npm', 'test'], environment: config.profile.environment,
    workingDirectory: 'packages/app', environmentVariables: { CI: 'true' },
  });
  validateConfiguration(config, BOOTSTRAP_POLICY, BOOTSTRAP_CONTRACT_CATALOG, authorization);
  let run = createRun('reviewed-run', config, authorization);
  assert.throws(() => transition(run, { type: 'approve', planRevision: config.plan.revision,
    policyRevision: BOOTSTRAP_POLICY.revision }), /trusted command registry|Mandatory verification/);
  run = transition(run, { type: 'approve', planRevision: config.plan.revision,
    policyRevision: BOOTSTRAP_POLICY.revision }, authorization);
  assert.equal(run.approval.status, 'approved');
  assert.throws(() => transition(run, { type: 'start' }, authorization), /not owner-authorized/);
  const changed = { ...authorization, checks: [{ ...authorization.checks[0]!, workingDirectory: 'another-directory' }] };
  assert.throws(() => transition(run, { type: 'start' }, { ...changed, allowExecution: true }), /changed after plan approval/);
});

test('owner authorization rejects repository, scope, environment, check, and permission mismatches', () => {
  const { config, raw } = projectFixture();
  const authorization = parseOwnerProjectAuthorization(raw, scope, repository);
  assert.throws(() => parseOwnerProjectAuthorization(raw, scope, { ...repository, repositoryId: 10 }), /trusted repository scope/);
  assert.throws(() => parseOwnerProjectAuthorization(raw, { ...scope, projectId: 'another-project' }, repository), /trusted repository scope/);
  assert.throws(() => parseOwnerProjectAuthorization({ ...raw, policyRevision: 'bootstrap-policy-2' }, scope, repository), /invalid/);
  assert.throws(() => parseOwnerProjectAuthorization({ ...raw, token: 'not-a-real-token' }, scope, repository), /invalid/);
  assert.throws(() => parseOwnerProjectAuthorization({ ...raw, capabilities: [...raw.capabilities, 'delivery.deploy'] }, scope, repository), /invalid/);
  for (const change of [
    (value: ProjectConfiguration) => { value.profile.checks[0]!.command = ['npm', 'run', 'unreviewed']; },
    (value: ProjectConfiguration) => { value.profile.checks[0]!.id = 'unknown-check'; value.policy.requiredChecks = ['unknown-check']; },
    (value: ProjectConfiguration) => { value.profile.environment.fingerprint = 'unreviewed-environment'; },
    (value: ProjectConfiguration) => { value.profile.requiredCapabilities.push('delivery.deploy'); },
    (value: ProjectConfiguration) => { value.plan.budget.maxMemoryMb = authorization.limits.maxMemoryMb + 1; },
    (value: ProjectConfiguration) => { value.workItem.origin = { kind: 'external-ticket', provider: 'github', reference: 'other/demo#1' }; },
  ]) {
    const altered = structuredClone(config); change(altered);
    assert.throws(() => validateConfiguration(altered, BOOTSTRAP_POLICY, BOOTSTRAP_CONTRACT_CATALOG, authorization));
  }
  assert.throws(() => assertPlanSafety(config, { workItem: config.workItem, digest: 'c'.repeat(64) }, authorization), /stale/);
  assert.throws(() => parseOwnerProjectAuthorization({ ...raw, checks: [{ ...raw.checks[0], argv: ['bash', '-c', 'echo unsafe'] }] }, scope, repository), /invalid/);
  assert.throws(() => parseOwnerProjectAuthorization({ ...raw, checks: [{ ...raw.checks[0], workingDirectory: '../other-project' }] }, scope, repository), /invalid/);
  assert.throws(() => parseOwnerProjectAuthorization({ ...raw, checks: [{ ...raw.checks[0], environmentVariables: { NODE_OPTIONS: '--require unsafe' } }] }, scope, repository), /invalid/);
});

test('owner authorization rejects executable inline-code flags and joined values', () => {
  const { raw } = projectFixture();
  for (const argv of [
    ['node', '-e', 'console.log(1)'],
    ['node', '-econsole.log(1)'],
    ['node', '-econsole.log("hello world")'],
    ['node', '--eval', 'console.log(1)'],
    ['node', '--eval=console.log(1)'],
    ['node', '-p', 'process.version'],
    ['node', '-pprocess.version'],
    ['node', '--print=process.version'],
    ['python3', '-c', 'print(1)'],
    ['python3', '-cprint(1)'],
    ['python3', '--command=print(1)'],
    ['ruby', '-eputs(1)'],
    ['perl', '-we', 'print(1)'],
    ['perl', '-weprint(1)'],
    ['npm', 'exec', '--', 'node', '--eval=console.log(1)'],
  ]) {
    assert.throws(() => parseOwnerProjectAuthorization({ ...raw,
      checks: [{ ...raw.checks[0], argv }],
    }, scope, repository), /invalid/, argv.join(' '));
  }
  assert.deepEqual(parseOwnerProjectAuthorization(raw, scope, repository).checks[0]!.argv, ['npm', 'test']);
});

test('owner authorization loader accepts only private, owner-controlled regular files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'af-owner-authorization-'));
  const path = join(directory, 'project.json'); const linked = join(directory, 'linked.json');
  const hardlink = join(directory, 'hardlinked.json');
  const { raw } = projectFixture();
  try {
    await assert.rejects(loadOwnerProjectAuthorization(path, scope, repository), /invalid or unavailable/);
    await writeFile(path, JSON.stringify(raw), { mode: 0o600 });
    assert.equal((await loadOwnerProjectAuthorization(path, scope, repository)).allowExecution, false);
    await chmod(path, 0o644);
    await assert.rejects(loadOwnerProjectAuthorization(path, scope, repository), /invalid or unavailable/);
    await chmod(path, 0o600);
    await symlink(path, linked);
    await assert.rejects(loadOwnerProjectAuthorization(linked, scope, repository));
    await link(path, hardlink);
    await assert.rejects(loadOwnerProjectAuthorization(path, scope, repository), /invalid or unavailable/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
