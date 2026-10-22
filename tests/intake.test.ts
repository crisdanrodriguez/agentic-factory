import { sourceDigest } from '../src/adapters/intake-digest.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { chmod, link, mkdir, mkdtemp, open, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliSource, parseRequest, revisionVersion } from '../src/core/intake.js';
import { fileSource, readInstallation } from '../src/adapters/local-intake.js';
import { runIntake } from '../src/runtime/intake.js';

async function fixture() {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'af023-')); await chmod(root, 0o700);
  const bytes = Buffer.from(' { "objective": "Synthetic software utility", "context": "  No execution requested.  " }\n');
  await writeFile(join(root, 'request.json'), bytes, { mode: 0o600 });
  return { root, bytes, close: () => rm(root, { recursive: true, force: true }) };
}
test('AF-023 preserves original bytes while reusing normalized request fields for both profiles', async () => {
  const f = await fixture();
  try {
    const source = await fileSource(f.root, 'request.json');
    assert.deepEqual(source.bytes, f.bytes); assert.equal(sourceDigest(source.bytes), sourceDigest(f.bytes));
    assert.equal(parseRequest(source).context, 'No execution requested.');
    const cli = cliSource('Synthetic ML research', ' Investigate an unfavorable synthetic outcome. ');
    assert.equal(cli.bytes.toString(), '{"objective":"Synthetic ML research","context":" Investigate an unfavorable synthetic outcome. "}');
    assert.equal(parseRequest(cli).objective, 'Synthetic ML research');
  } finally { await f.close(); }
});
test('AF-023 rejects malformed JSON, UTF-8, oversized requests and unexpected privilege fields', () => {
  for (const bytes of [Buffer.from('{'), Buffer.from([0xff]), Buffer.alloc(65537), Buffer.from('null'), Buffer.from('[]'), Buffer.from('{"objective":"x"}')]) {
    assert.throws(() => parseRequest({ kind: 'file', bytes }));
  }
  for (const field of ['ownerId', 'organizationId', 'projectId', 'authorization', 'execution', 'publication', 'compute', 'origin', 'path', 'profile']) {
    assert.throws(() => parseRequest({ kind: 'file', bytes: Buffer.from(JSON.stringify({ objective: 'x', context: 'y', [field]: 'forged' })) }));
  }
  assert.throws(() => cliSource('x'.repeat(4001), 'y')); assert.throws(() => cliSource(' ', 'y'));
});
test('AF-023 revision identifiers map exactly to positive sequential integers', () => {
  assert.equal(revisionVersion('r1'), 1); assert.equal(revisionVersion('r19'), 19);
  for (const value of ['1', 'r0', 'r01', 'r-1', 'r1.0', 'r1x', 'r2147483647', 'r9007199254740993']) assert.throws(() => revisionVersion(value));
});
test('AF-023 rejects traversal, absolute paths, separators and arbitrary directories', async () => {
  const f = await fixture();
  try {
    for (const name of ['../request.json', '/request.json', 'a/b', 'a\\b', '.', '..', 'a..b', 'https://example.invalid/x', 'a\0b']) await assert.rejects(fileSource(f.root, name));
    await assert.rejects(fileSource('relative', 'request.json'));
    await chmod(f.root, 0o755); await assert.rejects(fileSource(f.root, 'request.json'));
  } finally { await f.close(); }
});
test('AF-023 rejects symbolic links, hard links, directories, permissions and oversized files', async () => {
  const f = await fixture();
  try {
    await symlink('request.json', join(f.root, 'symbol.json'));
    await assert.rejects(fileSource(f.root, 'symbol.json'));
    await link(join(f.root, 'request.json'), join(f.root, 'hard.json'));
    await assert.rejects(fileSource(f.root, 'hard.json')); await rm(join(f.root, 'hard.json'));
    await chmod(join(f.root, 'request.json'), 0o644); await assert.rejects(fileSource(f.root, 'request.json'));
    await chmod(join(f.root, 'request.json'), 0o600);
    await writeFile(join(f.root, 'request.json'), Buffer.alloc(65537)); await assert.rejects(fileSource(f.root, 'request.json'));
    await assert.rejects(fileSource(f.root, 'missing.json'));
    await assert.rejects(fileSource(f.root, 'request.json'), (error: Error) => !error.message.includes(f.root));
  } finally { await f.close(); }
});
for (const mutation of ['replace', 'modify'] as const) {
  test(`AF-023 detects file ${mutation} during descriptor reading`, async (t) => {
    const f = await fixture();
    const probe = await open(join(f.root, 'request.json'), 'r');
    const prototype = Object.getPrototypeOf(probe) as { read: typeof probe.read };
    const original = prototype.read;
    let changed = false;
    t.mock.method(prototype, 'read', async function(this: typeof probe, ...args: Parameters<typeof probe.read>) {
      const result = await original.apply(this, args);
      if (!changed) {
        changed = true;
        if (mutation === 'replace') {
          await writeFile(join(f.root, 'replacement.json'), f.bytes, { mode: 0o600 });
          await rename(join(f.root, 'replacement.json'), join(f.root, 'request.json'));
        } else await writeFile(join(f.root, 'request.json'), Buffer.from('changed'));
      }
      return result;
    });
    try { await assert.rejects(fileSource(f.root, 'request.json')); assert.equal(changed, true); }
    finally { t.mock.restoreAll(); await probe.close(); await f.close(); }
  });
}
test('AF-023 installation configuration requires private files and rejects embedded credentials', async () => {
  const f = await fixture();
  try {
    const path = join(f.root, 'installation.json');
    const config = { revision: '1', databaseUrlEnvironment: 'AF_TEST_URL', projects: { demo: { organizationId: 'org', projectId: 'project', inbox: f.root } } };
    await writeFile(path, JSON.stringify(config), { mode: 0o600 }); assert.deepEqual(await readInstallation(path), config);
    await writeFile(path, JSON.stringify({ ...config, databaseUrl: 'secret' })); await assert.rejects(readInstallation(path), /configuration/);
    await chmod(path, 0o644); await assert.rejects(readInstallation(path));
  } finally { await f.close(); }
});
test('AF-023 CLI rejects unknown, duplicate and forged authorization options without exposing values', async () => {
  for (const args of [['create', '--owner', 'secret'], ['create', '--project', 'a', '--project', 'b'], ['delete'], ['show', '--file', 'secret']]) {
    await assert.rejects(runIntake(args), (error: Error) => !error.message.includes('secret'));
  }
});
test('AF-023 rejects special files and symlinked or permissive inbox ancestors without blocking', { timeout: 2000 }, async () => {
  const f = await fixture();
  try {
    execFileSync('mkfifo', [join(f.root, 'pipe.json')]);
    await assert.rejects(fileSource(f.root, 'pipe.json'));
    await mkdir(join(f.root, 'directory.json'), { mode: 0o700 });
    await assert.rejects(fileSource(f.root, 'directory.json'));
    await symlink(f.root, join(f.root, 'linked'));
    await assert.rejects(fileSource(join(f.root, 'linked'), 'request.json'));
    await mkdir(join(f.root, 'inbox'), { mode: 0o700 });
    await writeFile(join(f.root, 'inbox', 'request.json'), f.bytes, { mode: 0o600 });
    await chmod(f.root, 0o777);
    await assert.rejects(fileSource(join(f.root, 'inbox'), 'request.json'));
  } finally { await f.close(); }
});
test('AF-023 file reader rejects malformed UTF-8 and JSON without echoing content', async () => {
  const f = await fixture();
  try {
    for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.from('{"secret":"private-sensitive-text"}')]) {
      await writeFile(join(f.root, 'request.json'), bytes);
      await assert.rejects(fileSource(f.root, 'request.json'), (error: Error) => !error.message.includes('private-sensitive-text'));
    }
  } finally { await f.close(); }
});
