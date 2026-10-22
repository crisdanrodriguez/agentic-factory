import { z } from 'zod';
import { dirname, join, resolve } from 'node:path';
import { open, unlink, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DockerApi, runtimePreflight } from '../adapters/sandbox/docker-api.js';
import { DockerRuntime } from '../adapters/sandbox/docker-runtime.js';
import { SandboxBroker } from '../adapters/sandbox/broker.js';
import { grantSchema } from '../adapters/sandbox/policy.js';
import { privateDirectory, readPrivate } from '../adapters/sandbox/private-files.js';
import { serveBroker } from '../adapters/sandbox/transport.js';

const configurationSchema = z.strictObject({
  instance: z.string().regex(/^[a-f0-9]{64}$/), token: z.string().regex(/^[a-f0-9]{64}$/),
  stateDirectory: z.string().startsWith('/'), dockerSocket: z.string().startsWith('/'),
  images: z.strictObject({ arm64: z.string().regex(/^python@sha256:[a-f0-9]{64}$/), amd64: z.string().regex(/^python@sha256:[a-f0-9]{64}$/) }),
  grants: z.array(grantSchema).min(1).max(100),
});
export async function startBroker(configurationFile: string): Promise<{ close(): Promise<void> }> {
  const config = configurationSchema.parse(JSON.parse(await readPrivate(configurationFile)));
  await privateDirectory(config.stateDirectory);
  const lockPath = join(config.stateDirectory, 'broker.lock');
  const lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  await lock.writeFile(String(process.pid)); await lock.sync(); await lock.close();
  // Stale lock/socket removal is deliberately an explicit operator recovery step.
  try {
    const api = new DockerApi(config.dockerSocket);
    const architecture = await runtimePreflight(api);
    const image = config.images[architecture];
    const metadata = z.object({ Architecture: z.literal(architecture), Os: z.literal('linux') }).parse(await api.json('GET', `/images/${encodeURIComponent(image)}/json`));
    if (metadata.Architecture !== architecture) throw new Error('Environment architecture mismatch.');
    const broker = new SandboxBroker(join(config.stateDirectory, 'jobs'), new DockerRuntime(api, config.instance), config.grants, image);
    await broker.initialize();
    const server = await serveBroker(config.stateDirectory, config.token, broker);
    return { async close() { await server.close(); await unlink(lockPath); } };
  } catch (error) { await unlink(lockPath); throw error; }
}
export async function recoverBrokerLock(configurationFile: string): Promise<void> {
  const config = configurationSchema.parse(JSON.parse(await readPrivate(configurationFile)));
  await privateDirectory(config.stateDirectory);
  const lockPath = join(config.stateDirectory, 'broker.lock');
  const pid = Number(await readPrivate(lockPath, 32));
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid lock; manual operator investigation required.');
  try { process.kill(pid, 0); throw new Error('Broker PID is still present; do not remove its lock.'); }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error; }
  const socketPath = join(config.stateDirectory, 'control.sock');
  try {
    const stat = await lstat(socketPath);
    if (!stat.isSocket() || stat.uid !== process.getuid?.()) throw new Error('Unexpected socket path; manual investigation required.');
    await unlink(socketPath);
  } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  await unlink(lockPath);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [action, configurationFile, ...extra] = process.argv.slice(2);
  if (!configurationFile || extra.length || !['start', 'recover-lock'].includes(action ?? '')) {
    process.stderr.write('Usage: sandbox-broker <start|recover-lock> /absolute/private/config.json\n'); process.exitCode = 1;
  } else {
    try {
      if (!configurationFile.startsWith('/')) throw new Error('An absolute private configuration path is required.');
      await privateDirectory(dirname(configurationFile));
      if (action === 'recover-lock') await recoverBrokerLock(configurationFile);
      else {
        const server = await startBroker(configurationFile);
        let closing = false;
        const close = (): void => { if (closing) return; closing = true; void server.close().then(() => { process.exitCode = 0; }).catch(() => { process.exitCode = 1; }); };
        process.on('SIGTERM', close); process.on('SIGINT', close);
        process.stdout.write('Restricted sandbox broker ready.\n');
      }
    } catch { process.stderr.write('Sandbox broker unavailable. Check private configuration, lock, runtime, and cleanup state.\n'); process.exitCode = 1; }
  }
}
