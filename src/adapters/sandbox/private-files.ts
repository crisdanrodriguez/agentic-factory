import { constants } from 'node:fs';
import { mkdir, lstat, open, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

export async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())
    throw new Error('Broker directory must be owned by the broker user with mode 0700.');
}
export async function readPrivate(path: string, maxBytes = 2 * 1024 * 1024): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.() || stat.size > maxBytes)
      throw new Error('Unsafe private broker file.');
    const data = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await file.read(data, 0, data.length, 0);
    if (bytesRead > maxBytes) throw new Error('Broker file exceeds limit.');
    return data.subarray(0, bytesRead).toString('utf8');
  } finally { await file.close(); }
}
export async function writePrivate(path: string, text: string): Promise<void> {
  const temporary = `${path}.${randomBytes(12).toString('hex')}.tmp`;
  const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
  await rename(temporary, path);
  const parent = await open(dirname(path), constants.O_RDONLY);
  try { await parent.sync(); } finally { await parent.close(); }
}
