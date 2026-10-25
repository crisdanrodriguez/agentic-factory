import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { GitHubCommentReceiptStore } from './rest.js';
import type { GitHubCursorStore } from '../../ports/github-api.js';

async function privateFile(path: string): Promise<void> {
  const info = await stat(path).catch(() => undefined); if (info && (!info.isFile() || (info.mode & 0o077) !== 0)) throw new Error('GitHub local state file must be a private regular file.');
}
async function readJson(path: string): Promise<unknown> { await privateFile(path); try { return JSON.parse(await readFile(path, 'utf8')); } catch { return undefined; } }
async function writeJson(path: string, value: unknown): Promise<void> { await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await chmod(dirname(path), 0o700); const temporary = `${path}.tmp-${process.pid}`; await writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await rename(temporary, path); await chmod(path, 0o600); }

export class FileCursorStore implements GitHubCursorStore {
  constructor(private readonly path: string) {}
  async load(): Promise<string | null> { const value = await readJson(this.path); return typeof value === 'object' && value !== null && typeof (value as { cursor?: unknown }).cursor === 'string' ? (value as { cursor: string }).cursor : null; }
  async save(cursor: string): Promise<void> { await writeJson(this.path, { cursor }); }
}

export class FileCommentReceiptStore implements GitHubCommentReceiptStore {
  constructor(private readonly path: string) {}
  async has(key: string): Promise<boolean> { const value = await readJson(this.path); return Array.isArray(value) && value.includes(key); }
  async record(key: string): Promise<void> { const value = await readJson(this.path); const keys = Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []; if (!keys.includes(key)) keys.push(key); if (keys.length > 1000) keys.splice(0, keys.length - 1000); await writeJson(this.path, keys); }
}
