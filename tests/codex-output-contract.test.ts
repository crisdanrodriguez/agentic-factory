import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexCliPlanTransport, codexRefinementOutputSchema, normalizeCodexConfigurationOutput } from '../src/adapters/codex/cli-transport.js';
import { BOOTSTRAP_CONTRACT_CATALOG, BOOTSTRAP_POLICY } from '../src/core/policy.js';
import { validateConfiguration, type ProjectConfiguration } from '../src/core/configuration.js';

test('Codex refinement output schema derives from the trusted configuration contract', () => {
  const schema = codexRefinementOutputSchema();
  const fixture = JSON.parse(readFileSync('fixtures/software-general.json', 'utf8')) as ProjectConfiguration;
  assert.ok(validateConfiguration(fixture, BOOTSTRAP_POLICY, BOOTSTRAP_CONTRACT_CATALOG));
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ['schemaVersion', 'fixture', 'workItem', 'profile', 'plan', 'policy']);
  assert.equal((schema.properties as Record<string, Record<string, unknown>>).plan?.additionalProperties, false);
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const record = node as Record<string, unknown>;
    for (const keyword of ['oneOf', 'allOf', 'not', 'if', 'then', 'else', 'dependentRequired', 'dependentSchemas']) {
      assert.equal(keyword in record, false, `${keyword} is outside the reviewed Structured Outputs subset`);
    }
    if (record.type === 'object' && record.properties && typeof record.properties === 'object') {
      assert.deepEqual(record.required, Object.keys(record.properties));
      assert.equal(record.additionalProperties, false);
    }
    Object.values(record).forEach(visit);
  };
  visit(schema);
  const modelOutput = structuredClone(fixture) as unknown as { plan: Record<string, unknown>; workItem: { origin: Record<string, unknown> }; profile: Record<string, unknown> };
  modelOutput.plan.research = null;
  modelOutput.workItem.origin = { kind: 'local', reference: null };
  assert.deepEqual(validateConfiguration(normalizeCodexConfigurationOutput(modelOutput), BOOTSTRAP_POLICY, BOOTSTRAP_CONTRACT_CATALOG), fixture);
  const invalidResearch = structuredClone(modelOutput);
  invalidResearch.profile = { ...fixture.profile, id: 'ml-research' };
  assert.throws(() => validateConfiguration(normalizeCodexConfigurationOutput(invalidResearch), BOOTSTRAP_POLICY, BOOTSTRAP_CONTRACT_CATALOG));
  const invalidOrigin = structuredClone(modelOutput);
  invalidOrigin.workItem.origin = { kind: 'external-ticket', provider: 'github', reference: null };
  assert.throws(() => validateConfiguration(normalizeCodexConfigurationOutput(invalidOrigin), BOOTSTRAP_POLICY, BOOTSTRAP_CONTRACT_CATALOG), /Invalid configuration structure/);
});

test('Codex refinement delivers trusted policy, schema, and prompt on stdin to a disposable CLI fixture', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'af-codex-contract-'));
  const executable = join(directory, 'codex-fixture');
  const capture = join(directory, 'capture.json');
  const fixture = JSON.parse(readFileSync('fixtures/software-general.json', 'utf8')) as ProjectConfiguration;
  const script = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '--version') { process.stdout.write('codex-cli 0.169.0\\n'); process.exit(0); }
if (args.at(-2) === 'features' && args.at(-1) === 'list') {
  for (let i=0; i<args.length-2; i++) if (args[i] === '--disable') process.stdout.write(args[++i] + ' stable false\\n');
  process.exit(0);
}
if (args[0] !== 'exec') process.exit(2);
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', x => prompt += x);
process.stdin.on('end', () => {
  const schemaPath = args[args.indexOf('--output-schema')+1];
  const outputPath = args[args.indexOf('--output-last-message')+1];
  fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({prompt: JSON.parse(prompt), schema: JSON.parse(fs.readFileSync(schemaPath,'utf8')), args, codexHome: process.env.CODEX_HOME}));
  fs.writeFileSync(outputPath, '{}');
});
`;
  writeFileSync(executable, script, { mode: 0o700 });
  chmodSync(executable, 0o700);
  try {
    const transport = new CodexCliPlanTransport({ executable, workspace: directory, model: 'gpt-6-sol', timeoutMs: 3000, maxOutputBytes: 1000, authorized: true, codexHome: join(directory, 'dedicated-home') });
    const result = await transport.refine({ workItem: fixture.workItem, sourceRevision: fixture.workItem.revision, sourceSnapshot: 'durable-digest', model: 'gpt-6-sol', maxOutputBytes: 1000 }, new AbortController().signal);
    assert.deepEqual(result, {});
    const recorded = JSON.parse(readFileSync(capture, 'utf8')) as { prompt: Record<string, unknown>; schema: Record<string, unknown>; args: string[]; codexHome: string };
    assert.equal(recorded.codexHome, join(directory, 'dedicated-home'));
    assert.deepEqual(recorded.prompt.workItem, fixture.workItem);
    assert.equal(recorded.prompt.sourceSnapshot, 'durable-digest');
    assert.deepEqual(recorded.prompt.trustedPolicy, BOOTSTRAP_POLICY);
    assert.deepEqual(recorded.prompt.trustedCapabilityCatalog, BOOTSTRAP_CONTRACT_CATALOG);
    assert.deepEqual(recorded.schema, codexRefinementOutputSchema());
    assert.ok(recorded.args.includes('--output-schema'));
    assert.ok(recorded.args.includes('--sandbox'));
    assert.ok(recorded.args.includes('read-only'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
