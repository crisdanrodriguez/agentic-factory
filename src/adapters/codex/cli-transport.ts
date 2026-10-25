import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CodexPlanRequest, CodexPlanTransport } from './plan-refiner.js';

export interface CodexCliConfig {
  executable: string;
  workspace: string;
  model: string;
  timeoutMs: number;
  maxOutputBytes: number;
  authorized: boolean;
  codexHome?: string;
}

/**
 * A deliberately narrow local Codex transport. It sends the request on stdin,
 * uses read-only ephemeral execution, and returns only the final JSON message.
 * Authentication is read by the reviewed Codex CLI from its private local
 * configuration; this adapter never accepts a token or forwards the host env.
 */
export class CodexCliPlanTransport implements CodexPlanTransport {
  constructor(private readonly config: CodexCliConfig) {}
  async refine(request: CodexPlanRequest, signal: AbortSignal): Promise<unknown> {
    if (!this.config.authorized) throw new Error('Codex CLI use is not locally authorized.');
    if (!this.config.executable || !this.config.workspace || !Number.isSafeInteger(this.config.timeoutMs) || this.config.timeoutMs < 1000 || this.config.timeoutMs > 300_000 || !Number.isSafeInteger(this.config.maxOutputBytes) || this.config.maxOutputBytes < 1 || this.config.maxOutputBytes > 1_000_000) throw new Error('Codex CLI bounds are invalid.');
    const directory = await mkdtemp(join(tmpdir(), 'agentic-factory-codex-'), { encoding: 'utf8' });
    const outputPath = join(directory, 'last-message.json');
    const prompt = JSON.stringify({ task: 'Return one ProjectConfiguration JSON object for this WorkItem. Do not execute commands, call external services, or include markdown.', workItem: request.workItem, sourceRevision: request.sourceRevision, model: request.model });
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG, LC_ALL: process.env.LC_ALL, ...(this.config.codexHome ? { CODEX_HOME: this.config.codexHome } : {}) };
    const child = spawn(this.config.executable, ['exec', '--ephemeral', '--sandbox', 'read-only', '--output-last-message', outputPath, '--model', this.config.model], { cwd: this.config.workspace, env, stdio: ['pipe', 'ignore', 'ignore'], detached: true });
    let childExited = false;
    const stop = (): void => { if (!childExited && child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} setTimeout(() => { if (!childExited && child.pid) { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} } }, 500).unref(); } };
    const abort = (): void => stop(); signal.addEventListener('abort', abort, { once: true });
    try {
      child.stdin.end(prompt);
      const exit = await new Promise<number>((resolve, reject) => { const timer = setTimeout(() => { stop(); reject(new Error('Codex CLI refinement timed out.')); }, this.config.timeoutMs); child.once('error', reject); child.once('exit', (code, sig) => { childExited = true; clearTimeout(timer); if (sig) reject(new Error('Codex CLI refinement was interrupted.')); else resolve(code ?? 1); }); });
      if (exit !== 0) throw new Error('Codex CLI refinement failed.');
      const output = await readFile(outputPath); if (output.length > this.config.maxOutputBytes) throw new Error('Codex CLI output exceeds the allowed bound.');
      try { return JSON.parse(output.toString('utf8')) as unknown; } catch { throw new Error('Codex CLI returned invalid JSON.'); }
    } finally {
      signal.removeEventListener('abort', abort); try { child.stdin.destroy(); } catch {} await rm(directory, { recursive: true, force: false }).catch(() => { throw new Error('Codex CLI temporary cleanup could not be verified.'); });
    }
  }
}
