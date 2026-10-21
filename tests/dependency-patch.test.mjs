import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { hashes, patchDependency, patchPath, sha256 } from '../scripts/apply-dependency-patches.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'af-declaration-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'dist'));
  await writeFile(join(directory, 'package.json'), await readFile('node_modules/pg-boss/package.json'));
  let contents = await readFile('node_modules/pg-boss/dist/types.d.ts', 'utf8');
  const payload = await readFile(patchPath, 'utf8');
  if (sha256(contents) === hashes.patched) contents = contents.slice(0, -(payload.length + 1));
  assert.equal(sha256(contents), hashes.original);
  await writeFile(join(directory, 'dist/types.d.ts'), contents);
  return directory;
}

test('dependency patch applies cleanly and repeated application preserves identical bytes', async (t) => {
  const directory = await fixture(t);
  await patchDependency({ directory });
  const first = await readFile(join(directory, 'dist/types.d.ts'));
  assert.equal(sha256(first), hashes.patched);
  await patchDependency({ directory });
  await patchDependency({ directory, check: true });
  assert.deepEqual(await readFile(join(directory, 'dist/types.d.ts')), first);
});

test('missing application fails check without modifying declarations', async (t) => {
  const directory = await fixture(t);
  await assert.rejects(patchDependency({ directory, check: true }), /patch is missing/);
  assert.equal(sha256(await readFile(join(directory, 'dist/types.d.ts'))), hashes.original);
});

for (const [name, file, transform, message] of [
  ['version', 'package.json', (text) => text.replace('12.38.0', '12.37.1'), /requires exactly/],
  ['metadata checksum', 'package.json', (text) => text + '\n', /package.json checksum mismatch/],
  ['declaration checksum', 'dist/types.d.ts', (text) => text + '\n', /types.d.ts checksum mismatch/],
]) {
  test(`rejects ${name} mismatch without writing`, async (t) => {
    const directory = await fixture(t);
    const target = join(directory, file);
    await writeFile(target, transform(await readFile(target, 'utf8')));
    const before = await readFile(join(directory, 'dist/types.d.ts'));
    await assert.rejects(patchDependency({ directory }), message);
    assert.deepEqual(await readFile(join(directory, 'dist/types.d.ts')), before);
  });
}

test('rejects missing or modified patch payload', async (t) => {
  const directory = await fixture(t);
  const payloadPath = join(directory, 'payload');
  await assert.rejects(patchDependency({ directory, payloadPath }), /ENOENT/);
  await writeFile(payloadPath, 'unexpected');
  await assert.rejects(patchDependency({ directory, payloadPath }), /payload checksum mismatch/);
});

test('minimal pg-boss import compiles with unchanged strict project options', () => {
  const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
  assert.equal(parsed.options.strict, true);
  assert.equal(parsed.options.skipLibCheck, false);
  const filename = resolve('minimal-pg-boss-import.mts');
  const source = "import { PgBoss } from 'pg-boss';\nexport const Queue = PgBoss;\n";
  const host = ts.createCompilerHost(parsed.options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) => path === filename
    ? ts.createSourceFile(path, source, languageVersion, true)
    : getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([filename], { ...parsed.options, noEmit: true }, host);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (name) => name, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n',
  }));
});
