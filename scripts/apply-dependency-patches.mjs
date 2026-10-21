import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export const patchPath = resolve(root, 'patches/pg-boss/12.38.0.types.d.ts');
export const hashes = Object.freeze({
  original: 'f6426a1ab36e6ec884a4da31c2131fbf20cc9a7b9df46af54b5cf447e1719b61',
  patched: 'eab0b0ad3a702f7f55de832f90c2f4942c834e9f30c34c4c449b6a4e26380fb4',
  payload: '8a570d6de6db72c550eb2a15020b6d9eb6cbe7a018c0f0231ce41f09dc8f4316',
  metadata: '07aafff68462bdd1d2b6e5b9456a65044198d49369df90011404489ad0ffbb4d',
});
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

// Only the two missing declarations are appended. No lifecycle hook invokes this file.
export async function patchDependency({ directory = resolve(root, 'node_modules/pg-boss'), check = false, payloadPath = patchPath } = {}) {
  const metadata = await readFile(resolve(directory, 'package.json'), 'utf8');
  const pkg = JSON.parse(metadata);
  if (pkg.name !== 'pg-boss' || pkg.version !== '12.38.0') {
    throw new Error('Dependency patch requires exactly pg-boss 12.38.0. Review upstream before changing this patch.');
  }
  if (sha256(metadata) !== hashes.metadata) throw new Error('pg-boss package.json checksum mismatch; refusing unexpected package contents.');
  const payload = await readFile(payloadPath, 'utf8');
  if (sha256(payload) !== hashes.payload) throw new Error('Declaration patch payload checksum mismatch.');
  const target = resolve(directory, 'dist/types.d.ts');
  const original = await readFile(target, 'utf8');
  const digest = sha256(original);
  if (digest === hashes.patched) return 'pg-boss 12.38.0 declaration patch verified (already applied).';
  if (digest !== hashes.original) throw new Error('pg-boss dist/types.d.ts checksum mismatch; refusing unexpected package contents.');
  if (check) throw new Error('pg-boss declaration patch is missing. Run npm run deps:patch after npm ci --ignore-scripts.');
  const patched = original + '\n' + payload;
  if (sha256(patched) !== hashes.patched) throw new Error('Patched declaration checksum mismatch.');
  await writeFile(target, patched);
  return 'pg-boss 12.38.0 declaration patch applied and checksum verified.';
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.slice(2).some((arg) => arg !== '--check')) throw new Error('Usage: node scripts/apply-dependency-patches.mjs [--check]');
    console.log(await patchDependency({ check: process.argv.includes('--check') }));
  } catch (error) {
    console.error(`Dependency patch failed: ${error.message}`);
    process.exitCode = 1;
  }
}
