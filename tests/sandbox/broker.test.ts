import { test } from 'node:test';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DockerApi, runtimePreflight } from '../../src/adapters/sandbox/docker-api.js';
import { DockerRuntime } from '../../src/adapters/sandbox/docker-runtime.js';
import { SandboxBroker, recordSchema } from '../../src/adapters/sandbox/broker.js';
import { grantSchema } from '../../src/adapters/sandbox/policy.js';
import { serveBroker, callBroker } from '../../src/adapters/sandbox/transport.js';

const image = 'python@sha256:98ce6fb13b3803744fbca11434f00818f1e300e4e48a4f204e07b2c928b6218e';
const socket = process.env['AF_DOCKER_SOCKET'];
if (!socket) throw new Error('AF_DOCKER_SOCKET is required; sandbox tests must not be skipped.');
const api = new DockerApi(socket);
function testInstance(): string {
  const instance = randomBytes(32).toString('hex');
  const root = process.env['AF_SANDBOX_TEST_ROOT'];
  if (root) appendFileSync(join(root, 'instances'), `${instance}\n`, { mode: 0o600 });
  return instance;
}
const context = { ownerId: 'synthetic', projectId: 'project', workItemId: 'work', runId: 'run', planRevision: 'plan', policyRevision: 'policy', sourceSnapshot: 'source', environmentFingerprint: 'python' };
const base = grantSchema.parse({ id: 'grant', organizationId: 'organization', context, environment: 'python',
  command: ['python', '-c', "import pathlib; assert pathlib.Path('/proc/self/attr/current').read_text().strip()=='docker-default (enforce)'; open('/workspace/result','w').write('synthetic output')"],
  limits: { cpu: 0.25, memoryMb: 96, pids: 24, workspaceBytes: 4194304, outputBytes: 1024, durationSeconds: 10, network: 'none' }, files: [], outputs: ['result'] });
const start = (command = base.command, contextValue = context) => ({ operation: 'start', grantId: 'grant', request: { context: contextValue,
  idempotencyKey: 'operation', command, authorizedEnvironment: 'python', maxMemoryMb: 96, maxDurationSeconds: 10 } });

test('sandbox real runtime enforces AppArmor in the project process and completes bounded output through authenticated Unix socket', async () => {
  await runtimePreflight(api);
  const directory = await mkdtemp(join(tmpdir(), 'af007-integration-'));
  const runtime = new DockerRuntime(api, testInstance());
  const journal = join(directory, 'journal');
  const broker = new SandboxBroker(journal, runtime, [base], image);
  await broker.initialize();
  const token = randomBytes(32).toString('hex');
  const server = await serveBroker(directory, token, broker);
  try {
    await assert.rejects(callBroker(join(directory, 'control.sock'), 'a'.repeat(64), start()));
    await assert.rejects(broker.handle(start(base.command, { ...context, projectId: 'other' })));
    await assert.rejects(broker.handle(start(base.command, { ...context, policyRevision: 'unapproved' })));
    await assert.rejects(broker.handle(start(base.command, { ...context, sourceSnapshot: 'changed' })));
    await assert.rejects(broker.handle({ ...start(), request: { ...start().request, maxMemoryMb: 512 } }));
    const record = recordSchema.parse(await callBroker(join(directory, 'control.sock'), token, start()));
    assert.equal(record.status, 'running');
    assert.equal((recordSchema.parse(await callBroker(join(directory, 'control.sock'), token, start()))).id, record.id);
    await assert.rejects(broker.handle(start(['sh', '-c', 'false'])));
    let result = record;
    for (let i = 0; i < 30 && result.phase !== 'terminal'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      result = recordSchema.parse(await callBroker(join(directory, 'control.sock'), token, { operation: 'inspect', grantId: base.id, jobId: record.id, context }));
    }
    assert.equal(result.status, 'completed');
    assert.equal(result.phase, 'terminal');
    assert.equal(Buffer.from(result.outputs[0]?.base64 ?? '', 'base64').toString(), 'synthetic output');
    assert.equal(await runtime.container(record.container), undefined);
    const restart = new SandboxBroker(journal, runtime, [base], image);
    await restart.initialize();
    assert.equal((await restart.handle(start())).id, record.id);
    assert.equal((await readdir(journal)).length, 1);
  } finally {
    await server.close();
    for (const name of await runtime.ownedNames()) await runtime.remove(name);
    await rm(directory, { recursive: true, force: true });
  }
});

for (const [description, code] of [
  ['symbolic output', "import os; os.symlink('/etc/passwd','/workspace/result')"],
  ['hard-linked output', "import os; open('/workspace/other','w').write('synthetic'); os.link('/workspace/other','/workspace/result')"],
  ['special output', "import os; os.mkfifo('/workspace/result')"],
  ['oversized output', "open('/workspace/result','w').write('x'*1025)"],
  ['nonzero exit', 'raise SystemExit(3)'],
  ['missing output', 'pass'],
] as const) {
  test(`sandbox rejects ${description} and cleans resources`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'af007-negative-'));
    const runtime = new DockerRuntime(api, testInstance());
    const grant = { ...base, command: ['python', '-c', code] };
    const broker = new SandboxBroker(directory, runtime, [grant], image);
    await broker.initialize();
    try {
      let record = await broker.handle(start(grant.command));
      for (let i = 0; i < 30 && record.phase !== 'terminal'; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        record = await broker.handle({ operation: 'inspect', grantId: grant.id, jobId: record.id, context });
      }
      assert.equal(record.status, 'failed'); assert.equal(record.phase, 'terminal');
      assert.equal(record.outputs.length, 0);
      assert.deepEqual(await runtime.ownedNames(), []);
    } finally {
      for (const name of await runtime.ownedNames()) await runtime.remove(name);
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test('sandbox restart reconciles running job and cancellation rejects late completion', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'af007-cancel-'));
  const runtime = new DockerRuntime(api, testInstance());
  const grant = { ...base, command: ['python', '-c', 'import time; time.sleep(60)'] };
  const broker = new SandboxBroker(directory, runtime, [grant], image);
  await broker.initialize();
  try {
    const record = await broker.handle(start(grant.command));
    assert.equal(record.status, 'running');
    await assert.rejects(broker.handle({ ...start(grant.command), request: { ...start(grant.command).request, idempotencyKey: 'second-active-job' } }));
    const restart = new SandboxBroker(directory, runtime, [grant], image);
    await restart.initialize();
    const cancelled = await restart.handle({ operation: 'cancel', grantId: grant.id, jobId: record.id, context });
    assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.phase, 'terminal');
    assert.equal((await restart.handle(start(grant.command))).status, 'cancelled');
    assert.deepEqual(await runtime.ownedNames(), []);
  } finally {
    for (const name of await runtime.ownedNames()) await runtime.remove(name);
    await rm(directory, { recursive: true, force: true });
  }
});

test('sandbox identical project execution and operation IDs remain organization scoped', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'af007-scope-'));
  const runtime = new DockerRuntime(api, testInstance());
  const other = { ...base, id: 'other', organizationId: 'other-organization' };
  const broker = new SandboxBroker(directory, runtime, [base, other], image);
  await broker.initialize();
  try {
    const first = await broker.handle(start());
    await assert.rejects(broker.handle({ operation: 'inspect', grantId: other.id, jobId: first.id, context }));
    await assert.rejects(broker.handle({ operation: 'cancel', grantId: other.id, jobId: first.id, context }));
    await broker.handle({ operation: 'cancel', grantId: base.id, jobId: first.id, context });
    const second = await broker.handle({ ...start(), grantId: other.id });
    assert.notEqual(first.id, second.id);
    await broker.handle({ operation: 'cancel', grantId: other.id, jobId: second.id, context });
  } finally {
    for (const name of await runtime.ownedNames()) await runtime.remove(name);
    await rm(directory, { recursive: true, force: true });
  }
});

test('sandbox timeout fails and cleanup failure remains explicit until reconciliation succeeds', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'af007-timeout-'));
  class InterruptedRemoval extends DockerRuntime {
    unavailable = true;
    override async remove(name: string): Promise<void> {
      if (this.unavailable) throw new Error('Synthetic daemon removal failure');
      await super.remove(name);
    }
  }
  const runtime = new InterruptedRemoval(api, testInstance());
  const grant = { ...base, command: ['python', '-c', 'import time; time.sleep(60)'] };
  const broker = new SandboxBroker(directory, runtime, [grant], image);
  await broker.initialize();
  try {
    const request = start(grant.command); request.request.maxDurationSeconds = 1;
    const record = await broker.handle(request);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const failed = await broker.handle({ operation: 'inspect', grantId: grant.id, jobId: record.id, context });
    assert.equal(failed.status, 'failed'); assert.equal(failed.phase, 'cleanup-pending');
    await assert.rejects(broker.handle({ ...request, request: { ...request.request, idempotencyKey: 'another' } }));
    runtime.unavailable = false;
    const restart = new SandboxBroker(directory, runtime, [grant], image);
    await restart.initialize();
    const recovered = await restart.handle({ operation: 'inspect', grantId: grant.id, jobId: record.id, context });
    assert.equal(recovered.status, 'failed'); assert.equal(recovered.phase, 'terminal');
    assert.deepEqual(await runtime.ownedNames(), []);
  } finally {
    runtime.unavailable = false;
    for (const name of await runtime.ownedNames()) await runtime.remove(name);
    await rm(directory, { recursive: true, force: true });
  }
});

test('sandbox separate broker process recovers after SIGKILL without duplicate execution', { timeout: 30_000 }, async () => {
  const { spawn } = await import('node:child_process');
  const { writePrivate } = await import('../../src/adapters/sandbox/private-files.js');
  const { recoverBrokerLock } = await import('../../src/runtime/sandbox-broker.js');
  const directory = await mkdtemp(join(tmpdir(), 'af007-process-'));
  const runtime = new DockerRuntime(api, testInstance());
  const token = randomBytes(32).toString('hex');
  const grant = { ...base, command: ['python', '-c', "import time; time.sleep(2); open('/workspace/result','w').write('synthetic restart')"] };
  const configuration = join(directory, 'config.json');
  await writePrivate(configuration, JSON.stringify({ instance: runtime.instance, token, stateDirectory: join(directory, 'state'), dockerSocket: socket,
    images: { arm64: image, amd64: image }, grants: [grant] }));
  const startProcess = async () => {
    const child = spawn(process.execPath, [new URL('../../src/runtime/sandbox-broker.js', import.meta.url).pathname, 'start', configuration],
      { env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Broker readiness timeout')); }, 5000);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Broker exited before ready: ${code}`)); });
      child.stdout.once('data', (data: Buffer) => { clearTimeout(timer); if (data.toString().includes('ready')) resolve(); else reject(new Error('Unexpected broker readiness')); });
    });
    return child;
  };
  let child: Awaited<ReturnType<typeof startProcess>> | undefined;
  try {
    child = await startProcess();
    const path = join(directory, 'state', 'control.sock');
    const first = recordSchema.parse(await callBroker(path, token, start(grant.command)));
    assert.equal(first.status, 'running');
    const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; child = undefined;
    await recoverBrokerLock(configuration);
    child = await startProcess();
    const duplicate = recordSchema.parse(await callBroker(path, token, start(grant.command)));
    assert.equal(duplicate.id, first.id);
    let result = duplicate;
    for (let i = 0; i < 40 && result.phase !== 'terminal'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      result = recordSchema.parse(await callBroker(path, token, { operation: 'inspect', grantId: grant.id, jobId: first.id, context }));
    }
    assert.equal(result.status, 'completed');
    assert.equal(Buffer.from(result.outputs[0]?.base64 ?? '', 'base64').toString(), 'synthetic restart');
    assert.deepEqual(await runtime.ownedNames(), []);
  } finally {
    if (child) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
    for (const name of await runtime.ownedNames()) await runtime.remove(name);
    await rm(directory, { recursive: true, force: true });
  }
});

test('sandbox stages a bounded general software workspace and collects shell output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'af007-software-'));
  const runtime = new DockerRuntime(api, testInstance());
  const grant = { ...base, command: ['/bin/sh', 'program.sh'], files: [{ path: 'program.sh', content: "printf 'synthetic software' > result\n" }] };
  const broker = new SandboxBroker(directory, runtime, [grant], image);
  await broker.initialize();
  try {
    let result = await broker.handle(start(grant.command));
    for (let i = 0; i < 30 && result.phase !== 'terminal'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      result = await broker.handle({ operation: 'inspect', grantId: grant.id, jobId: result.id, context });
    }
    assert.equal(result.status, 'completed');
    assert.equal(Buffer.from(result.outputs[0]?.base64 ?? '', 'base64').toString(), 'synthetic software');
  } finally {
    for (const name of await runtime.ownedNames()) await runtime.remove(name);
    await rm(directory, { recursive: true, force: true });
  }
});

test('sandbox interrupted launch cannot claim success or relaunch without evidence', async () => {
  const { readPrivate, writePrivate } = await import('../../src/adapters/sandbox/private-files.js');
  const directory = await mkdtemp(join(tmpdir(), 'af007-launch-'));
  const runtime = new DockerRuntime(api, testInstance());
  const grant = { ...base, command: ['python', '-c', 'import time; time.sleep(60)'] };
  const broker = new SandboxBroker(directory, runtime, [grant], image);
  await broker.initialize();
  try {
    const record = await broker.handle(start(grant.command));
    const path = join(directory, record.id + '.json');
    const intent = recordSchema.parse(JSON.parse(await readPrivate(path)));
    intent.phase = 'launching';
    await writePrivate(path, JSON.stringify(intent));
    const restart = new SandboxBroker(directory, runtime, [grant], image);
    await restart.initialize();
    const recovered = await restart.handle(start(grant.command));
    assert.equal(recovered.status, 'failed'); assert.equal(recovered.phase, 'terminal');
    assert.deepEqual(await runtime.ownedNames(), []);
  } finally {
    for (const name of await runtime.ownedNames()) await runtime.remove(name);
    await rm(directory, { recursive: true, force: true });
  }
});

test('sandbox refuses to adopt unknown labeled resources', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'af007-orphan-'));
  const runtime = new DockerRuntime(api, testInstance());
  const name = 'af-' + randomBytes(32).toString('hex');
  try {
    await runtime.create(name, base, image, 'synthetic-orphan');
    await assert.rejects(new SandboxBroker(directory, runtime, [base], image).initialize());
    assert.ok(await runtime.container(name));
  } finally {
    await runtime.remove(name);
    await rm(directory, { recursive: true, force: true });
  }
});
