import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Scope } from '../../core/workflow.js';
import type { AgentRuntime } from '../../ports/agent-runtime.js';
import type { JobExecutor } from '../../ports/job-executor.js';
import { evidenceContextSchema, type EvidenceContext } from '../../core/contracts.js';

/** Test fixture values, never measured model quality or provider usage. */
export const SYNTHETIC_FINDING = Object.freeze({ label: 'synthetic-simulation-only', baseline: 0.75, candidate: 0.65, improved: false });
export class SyntheticAgent implements AgentRuntime {
  readonly capabilities = ['agent.edit'] as const;
  async propose(request: Parameters<AgentRuntime['propose']>[0], signal: AbortSignal) {
    signal.throwIfAborted();
    return { proposalReference: `synthetic-proposal-${request.context.runId}`, usage: { cpuSeconds: null, costUsd: null } };
  }
}
const recordSchema = z.strictObject({
  label: z.literal('synthetic-simulation-only'), scope: z.strictObject({ organizationId: z.string().min(1), projectId: z.string().min(1) }), context: evidenceContextSchema,
  requestDigest: z.string(), status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  startedAt: z.number(), readyAt: z.number(), deadline: z.number(),
});
type JobRecord = z.infer<typeof recordSchema>;
type StartRequest = Parameters<JobExecutor['start']>[0];
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** A private test journal models an external idempotent service across coordinator restarts.
 * It executes no commands and is not the production ArtifactStore or JobExecutor.
 */
export class SyntheticJobs implements JobExecutor {
  constructor(private readonly directory: string, private readonly now: () => number, private readonly authorize: (context: EvidenceContext) => Promise<Scope>, private readonly neverCompletes = false) {}
  async id(context: EvidenceContext, operationKey: string): Promise<string> { const scope = await this.authorize(context); return `synthetic-${digest({ scope, context, operationKey })}`; }
  private path(id: string): string {
    if (!/^synthetic-[a-f0-9]{64}$/.test(id)) throw new Error('Invalid synthetic job identifier.');
    return join(this.directory, `${id}.json`);
  }
  private async read(id: string, context: EvidenceContext): Promise<JobRecord> {
    const scope = await this.authorize(context);
    const record = recordSchema.parse(JSON.parse(await readFile(this.path(id), 'utf8')));
    if (!isDeepStrictEqual(record.scope, scope)) throw new Error('Synthetic job is outside the authorized organization/project scope.');
    if (!isDeepStrictEqual(record.context, context)) throw new Error('Synthetic job is outside the authorized context.');
    return record;
  }
  private async save(id: string, record: JobRecord): Promise<void> {
    const path = this.path(id);
    await writeFile(`${path}.pending`, JSON.stringify(record), { mode: 0o600 });
    await rename(`${path}.pending`, path);
  }
  async start(request: StartRequest): Promise<{ jobId: string }> {
    const scope = await this.authorize(request.context);
    const jobId = await this.id(request.context, request.idempotencyKey);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const record: JobRecord = {
      label: 'synthetic-simulation-only', scope, context: request.context, requestDigest: digest(request), status: 'running',
      startedAt: this.now(), readyAt: this.now() + (this.neverCompletes ? request.maxDurationSeconds * 1000 + 1 : 1000),
      deadline: this.now() + request.maxDurationSeconds * 1000,
    };
    try { await writeFile(this.path(jobId), JSON.stringify(record), { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
      const existing = await this.read(jobId, request.context);
      if (existing.requestDigest !== record.requestDigest) throw new Error('Synthetic idempotency key was reused with different content.');
    }
    return { jobId };
  }
  async inspect(jobId: string, context: EvidenceContext) {
    const record = await this.read(jobId, context);
    if (record.status === 'running') {
      // Only this deterministic fake knows completion time in advance. Real executors
      // must reconcile reliable external completion evidence, never infer it from time.
      if (record.readyAt < record.deadline && this.now() >= record.readyAt) record.status = 'completed';
      else if (this.now() >= record.deadline) record.status = 'failed';
      await this.save(jobId, record);
    }
    return { status: record.status, usage: { cpuSeconds: null, costUsd: null } };
  }
  async cancel(jobId: string, context: EvidenceContext): Promise<void> {
    const record = await this.read(jobId, context);
    record.status = 'cancelled'; await this.save(jobId, record);
  }
  async cancelIfSubmitted(context: EvidenceContext, operationKey: string): Promise<void> {
    try { await this.cancel(await this.id(context, operationKey), context); }
    catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error; }
  }
}
