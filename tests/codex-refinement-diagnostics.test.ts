import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexCliPlanTransport } from '../src/adapters/codex/cli-transport.js';
import { AuthorizedCodexPlanRefiner } from '../src/adapters/codex/plan-refiner.js';
import { RefinementDiagnosticError } from '../src/core/refinement-diagnostics.js';
import type { ProjectConfiguration } from '../src/core/configuration.js';

const fixture = JSON.parse(readFileSync('fixtures/software-general.json', 'utf8')) as ProjectConfiguration;
const marker = 'SYNTHETIC_PRIVATE_CONTENT_DO_NOT_REPORT';

function disposableCli(mode: string, timeoutMs = 3000) {
  const directory = mkdtempSync(join(tmpdir(), 'af-codex-diagnostic-'));
  const executable = join(directory, 'codex-fixture');
  const script = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const mode = ${JSON.stringify(mode)};
if (args[0] === '--version') { console.log('codex-cli 0.169.0'); process.exit(0); }
if (args.at(-2) === 'features' && args.at(-1) === 'list') {
 for (let i=0; i<args.length-2; i++) if (args[i] === '--disable') console.log(args[++i] + ' stable false');
 if (mode === 'start-failed') fs.unlinkSync(process.argv[1]);
 process.exit(0);
}
if (args[0] !== 'exec') process.exit(2);
const output = args[args.indexOf('--output-last-message')+1];
process.stdin.resume();
process.stdin.on('end', () => {
 if (mode === 'timeout') { setTimeout(() => {}, 5000); return; }
 if (mode === 'exit') { console.error('error: provider failure ${marker}'); process.exit(9); }
 if (mode === 'auth') { console.error('error: not logged in ${marker}'); process.exit(9); }
 if (mode === 'model') { console.error('error: model unavailable ${marker}'); process.exit(9); }
 if (mode === 'schema') { console.error('error: invalid output schema ${marker}'); process.exit(9); }
 if (mode === 'large-stderr') { console.error('${marker}'.repeat(2000)); process.exit(9); }
 if (mode === 'missing') return;
 if (mode === 'unreadable') { fs.mkdirSync(output); return; }
 if (mode === 'interrupted') { process.kill(process.pid, 'SIGTERM'); return; }
 fs.writeFileSync(output, mode === 'oversize' ? 'x'.repeat(200001) : mode === 'malformed' ? '{bad ${marker}' : mode === 'invalid' ? '{"invalid":true}' : ${JSON.stringify(JSON.stringify(fixture))});
});
`;
  writeFileSync(executable, script, { mode: 0o700 });
  const transport = new CodexCliPlanTransport({ executable, workspace: directory, model: 'gpt-6-sol', timeoutMs, maxOutputBytes: 200_000, authorized: true, codexHome: join(directory, 'dedicated-home') });
  return { transport, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

const request = { workItem: fixture.workItem, sourceRevision: fixture.workItem.revision, sourceSnapshot: fixture.plan.sourceSnapshot, model: 'gpt-6-sol', maxOutputBytes: 200_000 };

for (const [mode, code, retryable] of [
  ['exit', 'REFINEMENT_CLI_EXIT_NONZERO', true],
  ['start-failed', 'REFINEMENT_CLI_START_FAILED', false],
  ['auth', 'REFINEMENT_CLI_AUTH_UNAVAILABLE', false],
  ['model', 'REFINEMENT_CLI_MODEL_UNAVAILABLE', false],
  ['schema', 'REFINEMENT_CLI_SCHEMA_REJECTED', false],
  ['large-stderr', 'REFINEMENT_CLI_STDERR_LIMIT', true],
  ['missing', 'REFINEMENT_CLI_OUTPUT_MISSING', true],
  ['unreadable', 'REFINEMENT_CLI_OUTPUT_UNREADABLE', true],
  ['oversize', 'REFINEMENT_CLI_OUTPUT_OVERSIZE', false],
  ['interrupted', 'REFINEMENT_CLI_INTERRUPTED', true],
  ['malformed', 'REFINEMENT_OUTPUT_MALFORMED_JSON', false],
] as const) {
  test(`Codex fixture ${mode} emits only bounded diagnostic ${code}`, async () => {
    const { transport, cleanup } = disposableCli(mode);
    try {
      await assert.rejects(transport.refine(request, new AbortController().signal), (error: unknown) => {
        assert.ok(error instanceof RefinementDiagnosticError);
        assert.equal(error.code, code);
        assert.equal(error.retryable, retryable);
        assert.equal(JSON.stringify(error).includes(marker), false);
        assert.equal(error.message.includes(marker), false);
        return true;
      });
    } finally { cleanup(); }
  });
}

test('Codex fixture timeout is bounded and sanitized', async () => {
  const { transport, cleanup } = disposableCli('timeout', 1000);
  try {
    await assert.rejects(transport.refine(request, new AbortController().signal), (error: unknown) =>
      error instanceof RefinementDiagnosticError && error.code === 'REFINEMENT_CLI_TIMEOUT' && error.retryable);
  } finally { cleanup(); }
});

test('invalid fixture configuration is rejected by the original strict validator', async () => {
  const { transport, cleanup } = disposableCli('invalid');
  const refiner = new AuthorizedCodexPlanRefiner(transport, { authorized: true, model: 'gpt-6-sol', maxCalls: 1, maxOutputBytes: 200_000 });
  try {
    await assert.rejects(refiner.refine(request), (error: unknown) =>
      error instanceof RefinementDiagnosticError && error.code === 'REFINEMENT_OUTPUT_SCHEMA_INVALID' && !error.retryable);
  } finally { cleanup(); }
});

test('trusted policy rejection is permanent and does not include the proposal', async () => {
  const proposal = structuredClone(fixture);
  proposal.policy.requireEvidence = false;
  const refiner = new AuthorizedCodexPlanRefiner({ async refine() { return proposal; } }, { authorized: true, model: 'gpt-6-sol', maxCalls: 1, maxOutputBytes: 200_000 });
  await assert.rejects(refiner.refine(request), (error: unknown) =>
    error instanceof RefinementDiagnosticError && error.code === 'REFINEMENT_OUTPUT_POLICY_REJECTED' && !error.retryable);
});
