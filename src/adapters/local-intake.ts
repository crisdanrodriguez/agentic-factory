import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { z } from 'zod';
import { identifier } from '../core/contracts.js';
import { fail, MAX_REQUEST_BYTES, parseRequest, type IntakeSource } from '../core/intake.js';

// Only the installation operator may write the inbox or any non-root ancestor.
export async function privateDirectory(directory: string): Promise<void> {
  if (!isAbsolute(directory) || resolve(directory) !== directory || !process.getuid) fail('Intake directory is not authorized.');
  let current = directory;
  while (true) {
    const stat = await lstat(current);
    const root = current === parse(current).root;
    if (!stat.isDirectory() || stat.isSymbolicLink() || (!root && stat.uid !== 0 && stat.uid !== process.getuid()) ||
        ((stat.mode & 0o022) !== 0 && !(stat.uid === 0 && (stat.mode & 0o1000) !== 0))) fail('Intake directory is not authorized.');
    if (current === directory && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0)) fail('Intake directory must be private to its operator.');
    if (root) break;
    current = dirname(current);
  }
}
export async function readPrivateFile(directory: string, filename: string): Promise<Buffer> {
  try {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(filename) || filename.includes('..')) fail('Invalid intake filename.');
    await privateDirectory(directory);
    const path = join(directory, filename);
    const before = await lstat(path, { bigint: true });
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const opened = await file.stat({ bigint: true });
      if (!opened.isFile() || opened.nlink !== 1n || opened.uid !== BigInt(process.getuid!()) || (opened.mode & 0o077n) !== 0n ||
          before.dev !== opened.dev || before.ino !== opened.ino || opened.size > BigInt(MAX_REQUEST_BYTES)) fail('Intake file is not authorized or exceeds the allowed bounds.');
      const buffer = Buffer.alloc(MAX_REQUEST_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      const after = await file.stat({ bigint: true });
      const pathAfter = await lstat(path, { bigint: true });
      if (length > MAX_REQUEST_BYTES || BigInt(length) !== opened.size || after.size !== opened.size || after.mtimeNs !== opened.mtimeNs ||
          after.ctimeNs !== opened.ctimeNs || pathAfter.ino !== opened.ino || pathAfter.dev !== opened.dev || pathAfter.isSymbolicLink()) fail('Intake file changed during reading.');
      return buffer.subarray(0, length);
    } finally { await file.close(); }
  } catch { return fail('Cannot read an authorized, stable, bounded intake file.'); }
}
export async function fileSource(directory: string, filename: string): Promise<IntakeSource> {
  const source: IntakeSource = { kind: 'file', bytes: await readPrivateFile(directory, filename) };
  parseRequest(source); return source;
}
const installationSchema = z.strictObject({
  revision: identifier,
  databaseUrlEnvironment: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/),
  projects: z.record(identifier, z.strictObject({ organizationId: identifier, projectId: identifier, inbox: z.string().min(1).max(4096) })),
});
export async function readInstallation(path: string): Promise<z.infer<typeof installationSchema>> {
  try {
    if (!isAbsolute(path) || resolve(path) !== path) fail('Invalid installation configuration.');
    const bytes = await readPrivateFile(dirname(path), path.slice(dirname(path).length + 1));
    return installationSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown);
  } catch { return fail('Trusted intake configuration is unavailable or invalid.'); }
}
