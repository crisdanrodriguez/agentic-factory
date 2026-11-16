import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DockerApi, runtimePreflight } from '../../src/adapters/sandbox/docker-api.js';
import { DockerRuntime } from '../../src/adapters/sandbox/docker-runtime.js';
import { ImplementationWorkspaceLifecycle, type PinnedSource } from '../../src/adapters/sandbox/implementation-workspace.js';
import { grantSchema } from '../../src/adapters/sandbox/policy.js';

const socket = process.env['AF_DOCKER_SOCKET'];
if (!socket) throw new Error('AF_DOCKER_SOCKET is required; sandbox tests must not be skipped.');
const image = 'python@sha256:98ce6fb13b3803744fbca11434f00818f1e300e4e48a4f204e07b2c928b6218e';
const context = { ownerId: 'synthetic-owner', projectId: 'synthetic-project', workItemId: 'synthetic-work',
  runId: 'synthetic-run', planRevision: 'r1', policyRevision: 'bootstrap-policy-3',
  sourceSnapshot: 'synthetic-snapshot', environmentFingerprint: 'python' };
const limits = { cpu: 0.25, memoryMb: 96, pids: 24, workspaceBytes: 4 * 1024 * 1024,
  outputBytes: 1024, durationSeconds: 10, network: 'none' as const };
const binding = { organizationId: 'synthetic-org', projectId: context.projectId,
  repository: { installationId: 7, repositoryId: 9, fullName: 'synthetic-owner/synthetic-repo' },
  sourceCommit: 'a'.repeat(40), workItemRevision: 'r1', context, limits, capability: 'agent.edit' as const };

test('prepared source enters only a bounded, networkless sandbox tmpfs and is removed after inspection', async () => {
  const api = new DockerApi(socket); await runtimePreflight(api);
  const directory = await mkdtemp(join(tmpdir(), 'af-workspace-sandbox-'));
  const source: PinnedSource = { read: async () => [{ path: 'src/example.txt', content: Buffer.from('synthetic source only\n') }] };
  const workspace = new ImplementationWorkspaceLifecycle(join(directory, 'workspaces'), source, binding);
  const runtime = new DockerRuntime(api, randomBytes(32).toString('hex'));
  let name: string | undefined;
  try {
    const prepared = await workspace.prepare(binding);
    const grant = grantSchema.parse({ id: 'synthetic-workspace-grant', organizationId: binding.organizationId,
      context, environment: 'python', command: ['/bin/false'], limits,
      files: await workspace.sandboxFiles(binding), outputs: ['src/example.txt'] });
    name = `af-${prepared.id}`;
    await runtime.create(name, grant, image, prepared.id);
    await runtime.startContainer(name);
    await runtime.prepare(name, grant); // Verifies live cgroup, network, read-only root, tmpfs, UID and confinement.
    const result = await runtime.collect(name, grant);
    assert.equal(Buffer.from(result[0]!.base64, 'base64').toString(), 'synthetic source only\n');
    assert.equal((await runtime.container(name))?.Config.Labels?.['af.digest'], prepared.id);
    await runtime.remove(name); name = undefined;
    await workspace.cleanup(binding);
    assert.deepEqual(await workspace.recover(), []);
  } finally {
    if (name) await runtime.remove(name);
    await rm(directory, { recursive: true, force: true });
  }
});
