import { request } from 'node:http';
import { z } from 'zod';

export class DockerApi {
  constructor(private readonly socketPath: string) {
    if (!socketPath.startsWith('/') || socketPath.includes('\0')) throw new Error('A local Docker Unix socket is required.');
  }
  async call(method: string, path: string, body?: unknown, limit = 2 * 1024 * 1024): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const req = request({ socketPath: this.socketPath, path: `/v1.51${path}`, method,
        headers: data === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
        const parts: Buffer[] = []; let bytes = 0;
        res.on('data', (part: Buffer) => {
          bytes += part.length;
          if (bytes > limit) { req.destroy(new Error('Docker response exceeds limit.')); return; }
          parts.push(part);
        });
        res.on('error', reject);
        res.on('end', () => {
          if ((res.statusCode ?? 500) >= 300) { reject(new DockerError(res.statusCode ?? 500)); return; }
          resolve(Buffer.concat(parts));
        });
      });
      req.setTimeout(10_000, () => req.destroy(new Error('Docker operation timed out.')));
      req.on('error', reject);
      req.end(data);
    });
  }
  async json(method: string, path: string, body?: unknown): Promise<unknown> {
    return JSON.parse((await this.call(method, path, body)).toString('utf8')) as unknown;
  }
}
export class DockerError extends Error {
  constructor(readonly status: number) { super(`Docker operation failed (${status}).`); }
}
const version = z.object({ Components: z.array(z.object({ Name: z.string(), Version: z.string() })) });
const info = z.object({ OSType: z.literal('linux'), Architecture: z.enum(['aarch64', 'x86_64']), CgroupVersion: z.literal('2'),
  DefaultRuntime: z.literal('runc'), SecurityOptions: z.array(z.string()) });
export async function runtimePreflight(api: DockerApi): Promise<'arm64' | 'amd64'> {
  const details = info.parse(await api.json('GET', '/info'));
  const components = version.parse(await api.json('GET', '/version')).Components;
  // Preserve the historical ARM64 offline baseline; native AMD64 requires the reviewed fixed release.
  const engine = components.find((c) => c.Name === 'Engine')?.Version;
  const runc = components.find((c) => c.Name === 'runc')?.Version;
  const containerd = components.find((c) => c.Name === 'containerd')?.Version;
  const supportedEngine = engine === '29.9.2' || (details.Architecture === 'aarch64' && engine === '29.9.1');
  if (!supportedEngine || runc !== '1.5.2' || containerd !== '2.4.2')
    throw new Error('Unsupported Docker security baseline; review runtime versions before execution.');
  if (!details.SecurityOptions.some((s) => s.startsWith('name=seccomp')) || !details.SecurityOptions.includes('name=cgroupns'))
    throw new Error('Required seccomp and cgroup namespace controls are unavailable.');
  return details.Architecture === 'aarch64' ? 'arm64' : 'amd64';
}
