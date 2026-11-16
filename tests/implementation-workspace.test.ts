import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmod, lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ImplementationWorkspaceLifecycle, LocalPinnedGitSource, type ImplementationWorkspaceBinding,
  type PinnedSource } from '../src/adapters/sandbox/implementation-workspace.js';

const content = Buffer.from('synthetic source only\n');
const context = { ownerId: 'synthetic-owner', projectId: 'synthetic-project', workItemId: 'synthetic-work', runId: 'synthetic-run',
  planRevision: 'r1', policyRevision: 'bootstrap-policy-3', sourceSnapshot: 'synthetic-snapshot', environmentFingerprint: 'synthetic-environment' };
const limits = { cpu: 0.25, memoryMb: 96, pids: 24, workspaceBytes: 4 * 1024 * 1024,
  outputBytes: 1024, durationSeconds: 10, network: 'none' as const };
const reference = { installationId: 7, repositoryId: 9, fullName: 'synthetic-owner/synthetic-repo' };
const trustedScope = { organizationId: 'synthetic-org', projectId: context.projectId, repository: reference };
function binding(commit: string): ImplementationWorkspaceBinding {
  return { organizationId: 'synthetic-org', projectId: context.projectId, repository: reference, sourceCommit: commit,
    workItemRevision: 'r1', context, limits, capability: 'agent.edit' };
}
function git(directory: string, args: string[], input?: string): string {
  return execFileSync('git', ['--git-dir', directory, ...args], { input, encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'Synthetic', GIT_AUTHOR_EMAIL: 'synthetic@example.invalid',
      GIT_COMMITTER_NAME: 'Synthetic', GIT_COMMITTER_EMAIL: 'synthetic@example.invalid' } }).trim();
}
async function repository(directory: string, mode = '100644'): Promise<{ path: string; commit: string }> {
  const pathToRepo = join(directory, 'source.git');
  execFileSync('git', ['init', '--bare', '--quiet', pathToRepo]);
  git(pathToRepo, ['remote', 'add', 'origin', 'https://github.com/synthetic-owner/synthetic-repo.git']);
  const blob = git(pathToRepo, ['hash-object', '-w', '--stdin'], mode === '120000' ? '/etc/passwd' : content.toString());
  const nested = git(pathToRepo, ['mktree'], `${mode} blob ${blob}\texample.txt\n`);
  const tree = git(pathToRepo, ['mktree'], `040000 tree ${nested}\tsrc\n`);
  const commit = git(pathToRepo, ['commit-tree', tree, '-m', 'Synthetic source']);
  return { path: pathToRepo, commit };
}
async function temporary(fn: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'af-workspace-'));
  try { await fn(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('workspace lifecycle binds a private Run to pinned Git blobs and recovers without execution', async () => temporary(async (directory) => {
  const source = await repository(directory); const scope = binding(source.commit);
  await writeFile(join(source.path, 'hooks', 'post-checkout'), '#!/bin/sh\nexit 99\n', { mode: 0o700 });
  const root = join(directory, 'workspaces'); const lifecycle = new ImplementationWorkspaceLifecycle(root, new LocalPinnedGitSource(source.path), trustedScope);
  const first = await lifecycle.prepare(scope);
  assert.equal(first.files, 1); assert.equal(first.bytes, content.length);
  assert.deepEqual(await lifecycle.sandboxFiles(scope), [{ path: 'src/example.txt', content: content.toString() }]);
  assert.deepEqual(await lifecycle.prepare(scope), first);
  assert.deepEqual(await lifecycle.inspect(scope), first);
  assert.deepEqual(await new ImplementationWorkspaceLifecycle(root, new LocalPinnedGitSource(source.path), trustedScope).recover(), [first]);
  assert.equal((await lstat(join(root, `run-${first.id}`))).mode & 0o777, 0o700);
  for (const changed of [
    { ...scope, organizationId: 'other-org' }, { ...scope, projectId: 'other-project', context: { ...context, projectId: 'other-project' } },
    { ...scope, context: { ...context, runId: 'other-run' } }, { ...scope, repository: { ...reference, repositoryId: 10 } },
    { ...scope, workItemRevision: 'r2' }, { ...scope, context: { ...context, planRevision: 'r2' } },
  ]) await assert.rejects(lifecycle.inspect(changed));
  await assert.rejects(lifecycle.cleanup({ ...scope, organizationId: 'other-org' }), /trusted project/);
  await assert.rejects(lifecycle.prepare({ ...scope, limits: { ...limits, network: 'bridge' } }));
  await assert.rejects(lifecycle.prepare({ ...scope, limits: { ...limits, memoryMb: 0 } }));
  assert.deepEqual(await lifecycle.inspect(scope), first);
  await lifecycle.cancel(scope); await lifecycle.cleanup(scope);
  assert.deepEqual(await lifecycle.recover(), []);
}));

test('workspace rejects unsafe source entries, symlinks, mutation, and unreviewed files', async () => temporary(async (directory) => {
  const source = await repository(directory); const scope = binding(source.commit);
  const root = join(directory, 'workspaces'); const lifecycle = new ImplementationWorkspaceLifecycle(root, new LocalPinnedGitSource(source.path), trustedScope);
  const first = await lifecycle.prepare(scope); const work = join(root, `run-${first.id}`);
  await writeFile(join(work, 'src/example.txt'), 'modified');
  await assert.rejects(lifecycle.validate(scope), /changed/);
  await rm(join(work, 'src/example.txt'));
  await symlink('/etc/passwd', join(work, 'src/example.txt'));
  await assert.rejects(lifecycle.validate(scope));
  await rm(join(work, 'src/example.txt'));
  await writeFile(join(work, 'src/example.txt'), content);
  await chmod(join(work, 'src/example.txt'), 0o600);
  await writeFile(join(work, 'extra'), 'unreviewed');
  await assert.rejects(lifecycle.validate(scope), /Unexpected/);
  await rm(join(work, 'extra'));
  await chmod(join(work, 'src/example.txt'), 0o644);
  await assert.rejects(lifecycle.validate(scope), /changed/);
  await lifecycle.cleanup(scope);
  const symlinkRepo = await repository(join(await mkdtemp(join(directory, 'alternate-'))), '120000');
  await assert.rejects(new ImplementationWorkspaceLifecycle(root, new LocalPinnedGitSource(symlinkRepo.path), trustedScope).prepare(binding(symlinkRepo.commit)), /unsafe entry/);
  const fake: PinnedSource = { read: async () => [{ path: '../escape', content }] };
  await assert.rejects(new ImplementationWorkspaceLifecycle(root, fake, trustedScope).prepare(scope), /unsafe/);
  const oversized: PinnedSource = { read: async () => [{ path: 'large.txt', content: Buffer.alloc(64 * 1024 + 1) }] };
  await assert.rejects(new ImplementationWorkspaceLifecycle(root, oversized, trustedScope).prepare(scope), /budget/);
  assert.deepEqual(await readdir(root), []);
}));

test('workspace rejects coordinated staged-file and manifest-digest tampering', async () => temporary(async (directory) => {
  const source = await repository(directory); const scope = binding(source.commit);
  const root = join(directory, 'workspaces');
  const lifecycle = new ImplementationWorkspaceLifecycle(root, new LocalPinnedGitSource(source.path), trustedScope);
  const first = await lifecycle.prepare(scope);
  const work = join(root, `run-${first.id}`);
  const changed = Buffer.from('forged source only\n');
  await writeFile(join(work, 'src/example.txt'), changed);
  const manifestPath = join(work, 'manifest.json');
  const original = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(original) as { entries: { path: string; sha256: string; bytes: number }[] };
  manifest.entries[0]!.bytes = changed.length;
  manifest.entries[0]!.sha256 = createHash('sha256').update(changed).digest('hex');
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(lifecycle.validate(scope), /pinned source/);
  await assert.rejects(lifecycle.sandboxFiles(scope), /pinned source/);
  await assert.rejects(new ImplementationWorkspaceLifecycle(root, new LocalPinnedGitSource(source.path), trustedScope).recover(), /pinned source/);
  await writeFile(join(work, 'src/example.txt'), content);
  await writeFile(manifestPath, original);
  assert.deepEqual(await lifecycle.recover(), [first]);
  assert.deepEqual(await lifecycle.sandboxFiles(scope), [{ path: 'src/example.txt', content: content.toString() }]);
}));

test('workspace rejects forged, duplicate, removed, and added manifest entries', async () => temporary(async (directory) => {
  const source = await repository(directory); const scope = binding(source.commit);
  const root = join(directory, 'workspaces');
  const lifecycle = new ImplementationWorkspaceLifecycle(root, new LocalPinnedGitSource(source.path), trustedScope);
  const first = await lifecycle.prepare(scope);
  const manifestPath = join(root, `run-${first.id}`, 'manifest.json');
  const original = await readFile(manifestPath, 'utf8');
  type Entry = { path: string; sha256: string; bytes: number };
  const base = (JSON.parse(original) as { entries: Entry[] }).entries[0]!;
  for (const entries of [
    [{ ...base, sha256: 'f'.repeat(64) }],
    [{ ...base, bytes: content.length + 1 }],
    [],
    [base, base],
    [base, { path: 'added.txt', bytes: 0, sha256: 'e'.repeat(64) }],
    [{ ...base, path: 'renamed.txt' }],
  ]) {
    const forged = JSON.parse(original) as { entries: Entry[] };
    forged.entries = entries;
    await writeFile(manifestPath, JSON.stringify(forged));
    await assert.rejects(lifecycle.validate(scope), /pinned source/);
    await assert.rejects(lifecycle.sandboxFiles(scope), /pinned source/);
    await assert.rejects(lifecycle.recover(), /pinned source/);
  }
  const interrupted = JSON.parse(original) as { entries: Entry[]; phase: string };
  interrupted.phase = 'preparing'; interrupted.entries = [];
  await writeFile(manifestPath, JSON.stringify(interrupted));
  await assert.rejects(lifecycle.recover(), /pinned source/);
  await writeFile(manifestPath, original);
  assert.deepEqual(await lifecycle.recover(), [first]);
}));

test('workspace rejects source identity mismatch and cleans interrupted preparation on recovery', async () => temporary(async (directory) => {
  const source = await repository(directory); const scope = binding(source.commit);
  const root = join(directory, 'workspaces'); const lifecycle = new ImplementationWorkspaceLifecycle(root, new LocalPinnedGitSource(source.path), trustedScope);
  await assert.rejects(lifecycle.prepare({ ...scope, sourceCommit: 'a'.repeat(40) }), /identity|fatal/);
  git(source.path, ['remote', 'set-url', 'origin', 'https://github.com/another/repo.git']);
  await assert.rejects(lifecycle.prepare(scope), /identity/);
  git(source.path, ['remote', 'set-url', 'origin', 'https://github.com/synthetic-owner/synthetic-repo.git']);
  const first = await lifecycle.prepare(scope);
  const manifestPath = join(root, `run-${first.id}`, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { phase: string };
  manifest.phase = 'preparing'; await writeFile(manifestPath, JSON.stringify(manifest));
  assert.deepEqual(await new ImplementationWorkspaceLifecycle(root, new LocalPinnedGitSource(source.path), trustedScope).recover(), []);
  assert.deepEqual(await readdir(root), []);
}));
