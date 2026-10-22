import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, chmod, symlink, link, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RequestAuthenticator, signMessage } from '../src/adapters/sandbox/authentication.js';
import { relativePath, operationSchema } from '../src/adapters/sandbox/policy.js';
import { privateDirectory, readPrivate, writePrivate } from '../src/adapters/sandbox/private-files.js';

const token = 'a'.repeat(64);
const context = { ownerId: 'owner', projectId: 'project', workItemId: 'work', runId: 'run', planRevision: 'plan', policyRevision: 'policy', sourceSnapshot: 'source', environmentFingerprint: 'python' };
const request = { operation: 'inspect', grantId: 'grant', jobId: 'b'.repeat(64), context };
async function temporary(operation: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'af007-unit-'));
  try { await operation(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('sandbox authentication rejects invalid credentials and expired requests', async () => temporary(async (directory) => {
  const auth = new RequestAuthenticator(token, directory);
  await assert.rejects(auth.accept(signMessage('c'.repeat(64), request)));
  await assert.rejects(auth.accept(signMessage(token, request, 1)));
  await assert.rejects(auth.accept('{}'));
}));
test('sandbox replay protection survives authenticator restart and rejects clock rollback', async () => temporary(async (directory) => {
  const message = signMessage(token, request, 100_000);
  assert.deepEqual(await new RequestAuthenticator(token, directory).accept(message, 100_000), request);
  await assert.rejects(new RequestAuthenticator(token, directory).accept(message, 100_001));
  await assert.rejects(new RequestAuthenticator(token, directory).accept(signMessage(token, request, 99_999), 99_999));
}));
test('sandbox protocol rejects arbitrary Docker options and unknown fields', () => {
  for (const field of ['image', 'mounts', 'dockerFlags', 'hostCommand', 'organizationId']) {
    assert.equal(operationSchema.safeParse({ ...request, [field]: 'untrusted' }).success, false);
  }
});
test('sandbox paths reject traversal absolute paths blank references and ambiguous components', () => {
  for (const path of ['', '/etc/passwd', '../outside', 'a/../outside', 'a//b', './a', 'a\\b', 'a\0b', 'a/'])
    assert.equal(relativePath.safeParse(path).success, false, path);
  assert.equal(relativePath.safeParse('results/synthetic.json').success, true);
});
test('sandbox private files reject symbolic and hard links and permissive modes', async () => temporary(async (directory) => {
  await privateDirectory(directory);
  const file = join(directory, 'record');
  await writePrivate(file, 'synthetic');
  assert.equal(await readPrivate(file), 'synthetic');
  await symlink(file, join(directory, 'symbolic'));
  await assert.rejects(readPrivate(join(directory, 'symbolic')));
  await link(file, join(directory, 'hard'));
  await assert.rejects(readPrivate(file));
  const other = join(directory, 'other');
  await writeFile(other, 'synthetic', { mode: 0o644 });
  await assert.rejects(readPrivate(other));
  await chmod(directory, 0o755);
  await assert.rejects(privateDirectory(directory));
}));
test('sandbox private file reads enforce byte limits', async () => temporary(async (directory) => {
  const file = join(directory, 'record');
  await writePrivate(file, 'synthetic');
  await assert.rejects(readPrivate(file, 2));
}));

test('sandbox preflight fails closed for missing isolation controls and unsupported runtime', async () => {
  const { DockerApi, runtimePreflight } = await import('../src/adapters/sandbox/docker-api.js');
  class MissingControls extends DockerApi {
    override async json(): Promise<unknown> { return { OSType: 'linux', Architecture: 'aarch64', CgroupVersion: '1', DefaultRuntime: 'runc', SecurityOptions: [] }; }
  }
  await assert.rejects(runtimePreflight(new MissingControls('/synthetic-unavailable.sock')));
  class OldRuntime extends DockerApi {
    override async json(_method: string, path: string): Promise<unknown> {
      return path === '/info' ? { OSType: 'linux', Architecture: 'x86_64', CgroupVersion: '2', DefaultRuntime: 'runc', SecurityOptions: ['name=apparmor,profile=default', 'name=seccomp', 'name=cgroupns'] } :
        { Components: [{ Name: 'Engine', Version: '28.4.0' }, { Name: 'runc', Version: '1.2.5' }] };
    }
  }
  await assert.rejects(runtimePreflight(new OldRuntime('/synthetic-unavailable.sock')));
});

test('sandbox native AMD64 preflight accepts only the exact reviewed component combination', async () => {
  const { DockerApi, runtimePreflight } = await import('../src/adapters/sandbox/docker-api.js');
  class Fixture extends DockerApi {
    constructor(private readonly engine: string, private readonly containerd: string, private readonly runc: string) { super('/synthetic.sock'); }
    override async json(_method: string, path: string): Promise<unknown> {
      return path === '/info' ? { OSType: 'linux', Architecture: 'x86_64', CgroupVersion: '2', DefaultRuntime: 'runc', SecurityOptions: ['name=apparmor,profile=default', 'name=seccomp', 'name=cgroupns'] } :
        { Components: [{ Name: 'docker-init', Version: '0.19.0' }, { Name: 'Engine', Version: this.engine }, { Name: 'containerd', Version: this.containerd }, { Name: 'runc', Version: this.runc }] };
    }
  }
  assert.equal(await runtimePreflight(new Fixture('29.9.2', '2.4.2', '1.5.2')), 'amd64');
  assert.equal(await runtimePreflight(new Fixture('29.9.2', 'v2.4.2', '1.5.2')), 'amd64');
  for (const invalid of ['v2.4.1', 'v2.4.3', 'v2.4.20', 'v2.4.2-rc.1', '2.4.2+dirty', 'v2.4.2+build', 'vv2.4.2', 'V2.4.2', ' v2.4.2', 'v2.4.2 ', 'v2.4.2\n'])
    await assert.rejects(runtimePreflight(new Fixture('29.9.2', invalid, '1.5.2')));
  for (const values of [['29.9.1', '2.4.2', '1.5.2'], ['29.9.3', '2.4.2', '1.5.2'], ['29.9.2', '', '1.5.2'], ['29.9.2', '2.4.1', '1.5.2'], ['29.9.2', '2.4.2', '1.5.1']] as const)
    await assert.rejects(runtimePreflight(new Fixture(values[0], values[1], values[2])));
});

test('sandbox runtime rejects missing duplicate conflicting and unreviewed AppArmor metadata', async () => {
  const { DockerApi, runtimePreflight } = await import('../src/adapters/sandbox/docker-api.js');
  class Fixture extends DockerApi {
    constructor(private readonly entries: string[]) { super('/synthetic.sock'); }
    override async json(_method: string, path: string): Promise<unknown> {
      return path === '/info' ? { OSType: 'linux', Architecture: 'x86_64', CgroupVersion: '2', DefaultRuntime: 'runc',
        SecurityOptions: [...this.entries, 'name=seccomp,profile=builtin', 'name=cgroupns'] } :
        { Components: [{ Name: 'Engine', Version: '29.9.2' }, { Name: 'containerd', Version: 'v2.4.2' }, { Name: 'runc', Version: '1.5.2' }] };
    }
  }
  const approved = 'name=apparmor,profile=default';
  assert.equal(await runtimePreflight(new Fixture([approved])), 'amd64');
  for (const entries of [[], ['name=apparmor'], [approved, approved], [approved, 'name=apparmor,profile=unconfined'],
    ['name=apparmor,profile=unconfined'], ['name=apparmor,profile=custom'], [approved + ',mode=complain'], [approved + ' '], [approved, ' name=apparmor,profile=unconfined']])
    await assert.rejects(runtimePreflight(new Fixture(entries)), /AppArmor/);
});

test('sandbox refuses exec creation for missing unconfined or unexpected inspected profiles', async () => {
  const { DockerApi } = await import('../src/adapters/sandbox/docker-api.js');
  const { DockerRuntime } = await import('../src/adapters/sandbox/docker-runtime.js');
  class Fixture extends DockerApi {
    constructor(private readonly profile: string | undefined) { super('/synthetic.sock'); }
    override async json(method: string): Promise<unknown> {
      assert.equal(method, 'GET', 'No execution may be created');
      return { Id: 'synthetic', AppArmorProfile: this.profile, Config: { Labels: {} },
        State: { Running: true, Paused: false, OOMKilled: false } };
    }
  }
  for (const profile of [undefined, '', 'unconfined', 'custom', 'docker-default (complain)', 'docker-default '])
    await assert.rejects(new DockerRuntime(new Fixture(profile), 'synthetic').createExecution('synthetic', ['false']), /AppArmor/);
});

test('sandbox execution wrapper rejects ineffective confinement before invoking project code', async () => {
  const { spawnSync } = await import('node:child_process');
  const { confinedExecution } = await import('../src/adapters/sandbox/docker-runtime.js');
  for (const profile of ['unconfined', 'docker-default (complain)', 'custom (enforce)', '', 'docker-default (enforce)']) {
    // Synthetic kernel evidence only; hosted integration must verify the real process attribute.
    const program = "import pathlib,os; pathlib.Path.read_text=lambda self: " + JSON.stringify(profile) +
      "; os.execvp=lambda *args: print('PROJECT_INVOKED'); exec(" + JSON.stringify(confinedExecution) + ")";
    const result = spawnSync('python3', ['-c', program, 'synthetic-command'], { encoding: 'utf8' });
    assert.equal(result.status, profile === 'docker-default (enforce)' ? 0 : 1, result.stderr);
    assert.equal(result.stdout.includes('PROJECT_INVOKED'), profile === 'docker-default (enforce)');
  }
});

test('sandbox wraps project execution in isolated Python without interpolating the command', async () => {
  const { DockerApi } = await import('../src/adapters/sandbox/docker-api.js');
  const { DockerRuntime, confinedExecution } = await import('../src/adapters/sandbox/docker-runtime.js');
  const command = ['sh', '-c', 'printf synthetic'];
  class Fixture extends DockerApi {
    override async json(method: string, _path: string, body?: unknown): Promise<unknown> {
      if (method === 'GET') return { Id: 'synthetic', AppArmorProfile: 'docker-default', Config: { Labels: {} },
        State: { Running: true, Paused: false, OOMKilled: false } };
      assert.deepEqual(body, { User: '65534:65534', WorkingDir: '/workspace',
        Env: ['PATH=/usr/local/bin:/usr/bin:/bin', 'PYTHONDONTWRITEBYTECODE=1'],
        Cmd: ['python', '-I', '-c', confinedExecution, ...command], AttachStdout: false,
        AttachStderr: false, AttachStdin: false, Tty: false, Privileged: false });
      return { Id: 'a'.repeat(64) };
    }
  }
  assert.equal(await new DockerRuntime(new Fixture('/synthetic.sock'), 'synthetic').createExecution('synthetic', command), 'a'.repeat(64));
});


test('sandbox preflight rejects every unverified platform before further runtime access', async () => {
  const { DockerApi, runtimePreflight } = await import('../src/adapters/sandbox/docker-api.js');
  for (const [os, architecture, engine] of [
    ['linux', 'aarch64', '29.9.1'], ['linux', 'aarch64', '29.9.2'],
    ['linux', 'arm64', '29.9.2'], ['linux', 'amd64', '29.9.2'],
    ['linux', 'ppc64le', '29.9.2'], ['darwin', 'x86_64', '29.9.2'],
    ['windows', 'x86_64', '29.9.2'],
  ]) {
    const calls: string[] = [];
    class Fixture extends DockerApi {
      override async json(method: string, path: string): Promise<unknown> {
        assert.equal(method, 'GET');
        calls.push(path);
        return path === '/info' ? { OSType: os, Architecture: architecture, CgroupVersion: '2', DefaultRuntime: 'runc',
          SecurityOptions: ['name=apparmor,profile=default', 'name=seccomp,profile=builtin', 'name=cgroupns'] } :
          { Components: [{ Name: 'Engine', Version: engine }, { Name: 'containerd', Version: 'v2.4.2' }, { Name: 'runc', Version: '1.5.2' }] };
      }
    }
    await assert.rejects(runtimePreflight(new Fixture('/synthetic.sock')));
    assert.deepEqual(calls, ['/info'], 'Unsupported platform must stop before image or execution access');
  }
});
