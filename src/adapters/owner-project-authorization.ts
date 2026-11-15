import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { parseOwnerProjectAuthorization, type OwnerProjectAuthorization,
  type TrustedProjectScope, type TrustedRepository } from '../core/project-authorization.js';

/** Reload for every decision so revocation also applies to previously approved Runs. */
export async function loadOwnerProjectAuthorization(path: string, scope: TrustedProjectScope,
  repository: TrustedRepository): Promise<OwnerProjectAuthorization> {
  if (!isAbsolute(path)) throw new Error('Owner project authorization requires an absolute private path.');
  const workspace = resolve(process.cwd());
  if (resolve(path).startsWith(`${workspace}${sep}`) || resolve(path) === workspace) {
    throw new Error('Owner project authorization must be outside the source workspace.');
  }
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600 ||
        info.uid !== process.getuid?.() || info.size > 65536) {
      throw new Error('Owner project authorization file must be a private owner-controlled regular file.');
    }
    const input = JSON.parse(await handle.readFile('utf8')) as unknown;
    return parseOwnerProjectAuthorization(input, scope, repository);
  } catch {
    throw new Error('Owner project authorization is invalid or unavailable.');
  } finally { await handle?.close(); }
}
