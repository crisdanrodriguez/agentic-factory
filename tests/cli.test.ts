import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MAX_CONFIG_BYTES } from '../src/adapters/json-config.js';

const cli = new URL('../src/cli/index.js', import.meta.url);
function run(...args: string[]) {
  return spawnSync(process.execPath, [cli.pathname, ...args], { encoding: 'utf8', timeout: 5000, env: { PATH: process.env.PATH ?? '' } });
}
test('CLI help exits successfully without configuration or credentials', () => {
  const result = run('--help'); assert.equal(result.status, 0); assert.match(result.stdout, /Usage:/);
});
for (const profile of ['software-general', 'ml-research']) {
  test(`CLI validates ${profile} without provider credentials`, () => {
    const result = run('validate', `fixtures/${profile}.json`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`Valid configuration: ${profile}`));
    assert.match(result.stdout, /no work executed or providers verified/);
  });
}
test('CLI rejects unknown commands, extra arguments, and missing files', () => {
  assert.equal(run('start').status, 2);
  assert.equal(run('validate').status, 2);
  assert.equal(run('--help', 'extra').status, 2);
  const result = run('validate', 'fixtures/does-not-exist.json');
  assert.equal(result.status, 1); assert.match(result.stderr, /Cannot open configuration/);
});
test('CLI rejects malformed or oversized input without disclosing content', () => {
  const directory = mkdtempSync(join(tmpdir(), 'af-cli-test-'));
  try {
    const path = join(directory, 'input.json');
    for (const content of ['{"private-token":"synthetic-secret"', JSON.stringify({ 'synthetic-secret': true }), 'x'.repeat(MAX_CONFIG_BYTES + 1)]) {
      writeFileSync(path, content);
      const result = run('validate', path);
      assert.equal(result.status, 1); assert.doesNotMatch(result.stderr, /synthetic-secret/);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('CLI rejects disabled policy and never executes configured commands', () => {
  const directory = mkdtempSync(join(tmpdir(), 'af-cli-policy-'));
  try {
    const config = JSON.parse(readFileSync('fixtures/software-general.json', 'utf8')) as { profile: { checks: { command: string[] }[] }; policy: { requireEvidence: boolean } };
    config.profile.checks[0]!.command = ['this-program-must-never-be-executed'];
    const path = join(directory, 'input.json'); writeFileSync(path, JSON.stringify(config));
    assert.equal(run('validate', path).status, 0);
    config.policy.requireEvidence = false; writeFileSync(path, JSON.stringify(config));
    const result = run('validate', path);
    assert.equal(result.status, 1); assert.match(result.stderr, /cannot disable/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
