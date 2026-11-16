import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { evidenceContextSchema, identifier } from '../../core/contracts.js';
import { limitsSchema, relativePath } from './policy.js';
import { privateDirectory, readPrivate, writePrivate } from './private-files.js';

const runGit = promisify(execFile);
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex');
export const implementationWorkspaceSchema = z.strictObject({
  organizationId: identifier,
  projectId: identifier,
  repository: z.strictObject({ installationId: z.number().int().positive(), repositoryId: z.number().int().positive(),
    fullName: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/) }),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  workItemRevision: identifier,
  context: evidenceContextSchema,
  limits: limitsSchema,
  capability: z.literal('agent.edit'),
}).superRefine((value, ctx) => {
  if (value.context.projectId !== value.projectId) ctx.addIssue({ code: 'custom', message: 'Workspace project mismatch' });
});
export type ImplementationWorkspaceBinding = z.infer<typeof implementationWorkspaceSchema>;
const entrySchema = z.strictObject({ path: relativePath, sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().nonnegative() });
const manifestSchema = z.strictObject({ binding: implementationWorkspaceSchema, entries: z.array(entrySchema).max(64), phase: z.enum(['preparing', 'prepared']) });
type Manifest = z.infer<typeof manifestSchema>;
export type WorkspaceInspection = { id: string; binding: ImplementationWorkspaceBinding; files: number; bytes: number };
export type SourceFile = { path: string; content: Buffer };
export interface PinnedSource { read(binding: ImplementationWorkspaceBinding): Promise<SourceFile[]>; }

/** Reads immutable blobs from an owner-selected local bare repository. No checkout, filters, hooks, or scripts run. */
export class LocalPinnedGitSource implements PinnedSource {
  constructor(private readonly bareRepository: string) {}
  private async git(...args: string[]): Promise<Buffer> {
    const { stdout } = await runGit('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.file.allow=never',
      '--git-dir', this.bareRepository, ...args], {
      encoding: 'buffer', timeout: 10_000, maxBuffer: 8 * 1024 * 1024,
      env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0', GIT_LFS_SKIP_SMUDGE: '1', GIT_TERMINAL_PROMPT: '0' },
    });
    return stdout;
  }
  async read(binding: ImplementationWorkspaceBinding): Promise<SourceFile[]> {
    if (!isAbsolute(this.bareRepository)) throw new Error('Trusted source repository must be absolute.');
    const source = await lstat(this.bareRepository);
    if (!source.isDirectory() || source.isSymbolicLink() || source.uid !== process.getuid?.() || (source.mode & 0o022) !== 0)
      throw new Error('Trusted source repository is unsafe.');
    const expected = `https://github.com/${binding.repository.fullName}.git`;
    if ((await this.git('config', '--get', 'remote.origin.url')).toString().trim() !== expected ||
        (await this.git('cat-file', '-t', binding.sourceCommit)).toString().trim() !== 'commit')
      throw new Error('Pinned source identity is not trusted.');
    const tree = await this.git('ls-tree', '-r', '-z', '--full-tree', binding.sourceCommit);
    const decoded = tree.toString('utf8');
    if (!Buffer.from(decoded, 'utf8').equals(tree)) throw new Error('Pinned source contains an invalid path encoding.');
    const rows = decoded.split('\0').filter(Boolean);
    if (rows.length > 64) throw new Error('Pinned source exceeds workspace file limit.');
    const files: SourceFile[] = [];
    for (const row of rows) {
      const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(row);
      if (!match || !relativePath.safeParse(match[3]).success) throw new Error('Pinned source contains an unsafe entry.');
      const content = await this.git('cat-file', 'blob', match[2]!);
      if (content.length > 64 * 1024 || !Buffer.from(content.toString('utf8')).equals(content))
        throw new Error('Pinned source contains an unsupported file.');
      files.push({ path: match[3]!, content });
    }
    return files;
  }
}

/** Private host-side staging only. The future agent receives a separate bounded sandbox tmpfs, never this path. */
export class ImplementationWorkspaceLifecycle {
  constructor(private readonly root: string, private readonly source: PinnedSource,
    private readonly trustedScope: Pick<ImplementationWorkspaceBinding, 'organizationId' | 'projectId' | 'repository'>) {}
  private authorize(binding: ImplementationWorkspaceBinding): void {
    if (binding.organizationId !== this.trustedScope.organizationId || binding.projectId !== this.trustedScope.projectId ||
        JSON.stringify(binding.repository) !== JSON.stringify(this.trustedScope.repository))
      throw new Error('Workspace is outside the trusted project and repository scope.');
  }
  private id(binding: ImplementationWorkspaceBinding): string { return sha256(JSON.stringify(binding)); }
  private path(id: string): string { return join(this.root, `run-${id}`); }
  private async rootReady(): Promise<void> {
    if (!isAbsolute(this.root)) throw new Error('Workspace root must be absolute.');
    await privateDirectory(this.root);
  }
  private async read(id: string): Promise<Manifest> {
    const directory = this.path(id);
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.() || (metadata.mode & 0o077) !== 0)
      throw new Error('Workspace directory is unsafe.');
    const manifest = manifestSchema.parse(JSON.parse(await readPrivate(join(directory, 'manifest.json'), 64 * 1024)));
    if (this.id(manifest.binding) !== id) throw new Error('Workspace identity mismatch.');
    return manifest;
  }
  private async trustedFiles(binding: ImplementationWorkspaceBinding): Promise<{ files: SourceFile[]; entries: Manifest['entries'] }> {
    const files = await this.source.read(binding);
    if (files.length > 64 || files.some((file) => file.content.length > 64 * 1024 ||
        !Buffer.from(file.content.toString('utf8')).equals(file.content)) ||
        files.reduce((sum, file) => sum + file.content.length, 0) > binding.limits.workspaceBytes / 2)
      throw new Error('Pinned source exceeds sandbox input budget.');
    const paths = files.map((file) => file.path);
    if (new Set(paths).size !== paths.length || paths.some((path) => !relativePath.safeParse(path).success || path === 'manifest.json'))
      throw new Error('Pinned source paths are unsafe.');
    const entries = files.map((file) => ({ path: file.path, sha256: sha256(file.content), bytes: file.content.length }));
    return { files, entries };
  }
  private assertPinnedEntries(manifest: Manifest, entries: Manifest['entries']): void {
    const ordered = (items: Manifest['entries']) => [...items].sort((a, b) => a.path.localeCompare(b.path));
    if (new Set(manifest.entries.map((entry) => entry.path)).size !== manifest.entries.length ||
        JSON.stringify(ordered(manifest.entries)) !== JSON.stringify(ordered(entries)))
      throw new Error('Workspace manifest differs from pinned source.');
  }
  async prepare(input: unknown): Promise<WorkspaceInspection> {
    const binding = implementationWorkspaceSchema.parse(input); this.authorize(binding);
    await this.rootReady();
    const id = this.id(binding); const directory = this.path(id);
    try { await lstat(directory); return this.validate(binding); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const { files, entries } = await this.trustedFiles(binding);
    await mkdir(directory, { mode: 0o700 });
    try {
      await writePrivate(join(directory, 'manifest.json'), JSON.stringify({ binding, entries, phase: 'preparing' } satisfies Manifest));
      for (const file of files) {
        const parts = file.path.split('/'); let parent = directory;
        for (const part of parts.slice(0, -1)) {
          parent = join(parent, part);
          try { await mkdir(parent, { mode: 0o700 }); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
          const directoryStat = await lstat(parent);
          if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || directoryStat.uid !== process.getuid?.() || (directoryStat.mode & 0o077) !== 0)
            throw new Error('Workspace path is unsafe.');
        }
        const handle = await open(join(directory, file.path), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
        try { await handle.writeFile(file.content); await handle.sync(); } finally { await handle.close(); }
      }
      await writePrivate(join(directory, 'manifest.json'), JSON.stringify({ binding, entries, phase: 'prepared' } satisfies Manifest));
      return this.validate(binding);
    } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  }
  async validate(input: unknown): Promise<WorkspaceInspection> {
    const binding = implementationWorkspaceSchema.parse(input); this.authorize(binding); await this.rootReady();
    const id = this.id(binding); const manifest = await this.read(id);
    if (manifest.phase !== 'prepared') throw new Error('Workspace preparation is incomplete.');
    if (JSON.stringify(manifest.binding) !== JSON.stringify(binding)) throw new Error('Workspace binding changed.');
    this.assertPinnedEntries(manifest, (await this.trustedFiles(binding)).entries);
    const expected = new Set(['manifest.json']);
    for (const entry of manifest.entries) {
      const parts = entry.path.split('/'); let current = this.path(id);
      for (let index = 0; index < parts.length - 1; index++) {
        current = join(current, parts[index]!); expected.add(parts.slice(0, index + 1).join('/'));
        const dir = await lstat(current);
        if (!dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== process.getuid?.() || (dir.mode & 0o077) !== 0)
          throw new Error('Workspace path changed.');
      }
      expected.add(entry.path);
      const file = await open(join(this.path(id), entry.path), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await file.stat();
        if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || info.size !== entry.bytes ||
            sha256(await file.readFile()) !== entry.sha256) throw new Error('Workspace source changed.');
      } finally { await file.close(); }
    }
    const visit = async (dir: string, prefix: string): Promise<void> => {
      for (const name of await readdir(dir)) {
        const key = prefix ? `${prefix}/${name}` : name;
        if (!expected.has(key)) throw new Error('Unexpected workspace change.');
        const info = await lstat(join(dir, name));
        if (info.isSymbolicLink()) throw new Error('Workspace symlink is unsafe.');
        if (info.isDirectory()) await visit(join(dir, name), key);
      }
    };
    await visit(this.path(id), '');
    return { id, binding, files: manifest.entries.length, bytes: manifest.entries.reduce((sum, entry) => sum + entry.bytes, 0) };
  }
  async inspect(input: unknown): Promise<WorkspaceInspection> { return this.validate(input); }
  async sandboxFiles(input: unknown): Promise<{ path: string; content: string }[]> {
    const binding = implementationWorkspaceSchema.parse(input); this.authorize(binding); await this.validate(binding);
    const manifest = await this.read(this.id(binding));
    const trusted = await this.trustedFiles(binding);
    this.assertPinnedEntries(manifest, trusted.entries);
    // Transfer immutable pinned blobs, never bytes read back from mutable staging files.
    return trusted.files.map((file) => ({ path: file.path, content: file.content.toString('utf8') }));
  }
  async cleanup(input: unknown): Promise<void> {
    const binding = implementationWorkspaceSchema.parse(input); this.authorize(binding); await this.rootReady();
    const id = this.id(binding);
    try { await this.read(id); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    await rm(this.path(id), { recursive: true, force: true });
  }
  async cancel(input: unknown): Promise<void> { await this.cleanup(input); }
  async recover(): Promise<WorkspaceInspection[]> {
    await this.rootReady();
    const results: WorkspaceInspection[] = [];
    for (const name of await readdir(this.root)) {
      if (!/^run-[a-f0-9]{64}$/.test(name)) throw new Error('Unknown workspace resource requires operator review.');
      const manifest = await this.read(name.slice(4));
      this.authorize(manifest.binding);
      this.assertPinnedEntries(manifest, (await this.trustedFiles(manifest.binding)).entries);
      if (manifest.phase === 'preparing') { await this.cleanup(manifest.binding); continue; }
      results.push(await this.validate(manifest.binding));
    }
    return results;
  }
}
