import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { grantSchema, operationSchema, type Grant } from './policy.js';
import { privateDirectory, readPrivate, writePrivate } from './private-files.js';
import { DockerRuntime } from './docker-runtime.js';

export const recordSchema = z.strictObject({
  id: z.string().regex(/^[a-f0-9]{64}$/), digest: z.string(), grant: grantSchema,
  container: z.string().regex(/^af-[a-f0-9]{64}$/), deadline: z.number(),
  phase: z.enum(['intent', 'preparing', 'launching', 'executing', 'cleanup-pending', 'terminal']),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']),
  executionId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  outputs: z.array(z.strictObject({ path: z.string(), base64: z.string(), sha256: z.string() })),
});
export type JobRecord = z.infer<typeof recordSchema>;
function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export class SandboxBroker {
  private readonly records = new Map<string, JobRecord>();
  private readonly grants: Map<string, Grant>;
  constructor(private readonly directory: string, private readonly runtime: DockerRuntime, grants: Grant[], private readonly image: string) {
    this.grants = new Map(grants.map((g) => [g.id, grantSchema.parse(g)]));
    if (this.grants.size !== grants.length) throw new Error('Duplicate trusted grant.');
  }
  private async save(record: JobRecord): Promise<void> {
    await writePrivate(join(this.directory, `${record.id}.json`), JSON.stringify(record));
    this.records.set(record.id, record);
  }
  async initialize(): Promise<void> {
    await privateDirectory(this.directory);
    for (const name of await readdir(this.directory)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) throw new Error('Unexpected broker journal entry requires operator review.');
      const record = recordSchema.parse(JSON.parse(await readPrivate(join(this.directory, name), 4 * 1024 * 1024)));
      if (name !== `${record.id}.json`) throw new Error('Journal identity mismatch.');
      this.records.set(record.id, record);
    }
    // Unknown labeled resources must not be adopted or deleted without a matching intent.
    for (const name of await this.runtime.ownedNames()) {
      const record = [...this.records.values()].find((r) => r.container === name);
      if (!record) throw new Error('Orphan sandbox resource requires operator review.');
      if (record.phase === 'terminal') { record.phase = 'cleanup-pending'; await this.save(record); }
    }
    await this.reconcile();
  }
  private async owned(record: JobRecord): Promise<Awaited<ReturnType<DockerRuntime['container']>>> {
    const container = await this.runtime.container(record.container);
    if (container && (container.Config.Labels?.['af.instance'] !== this.runtime.instance || container.Config.Labels?.['af.digest'] !== record.digest || container.Config.Labels?.['af.job'] !== record.container))
      throw new Error('Container ownership does not match execution intent.');
    return container;
  }
  private async finish(record: JobRecord, status: JobRecord['status']): Promise<void> {
    record.phase = 'cleanup-pending'; record.status = status;
    await this.save(record);
    try {
      await this.owned(record);
      await this.runtime.remove(record.container);
      record.phase = 'terminal'; await this.save(record);
    } catch { /* Durable cleanup-pending is retried by reconciliation; no success claim. */ }
  }
  async reconcile(): Promise<void> {
    for (const record of this.records.values()) {
      if (record.phase === 'terminal') continue;
      if (!isDeepStrictEqual(this.grants.get(record.grant.id), record.grant)) { await this.finish(record, 'cancelled'); continue; }
      if (record.phase === 'cleanup-pending') { await this.finish(record, record.status); continue; }
      // Intent/preparation interrupted before execution acknowledgement cannot be safely relaunched.
      if (record.phase !== 'executing' || !record.executionId) { await this.finish(record, 'failed'); continue; }
      try {
        const container = await this.owned(record);
        if (!container?.State.Running || container.State.OOMKilled) { await this.finish(record, 'failed'); continue; }
        // Real completion time is unavailable after interruption. Fail conservatively beyond deadline.
        if (Date.now() >= record.deadline) { await this.finish(record, 'failed'); continue; }
        const execution = await this.runtime.execution(record.executionId);
        if (execution.Running) continue;
        if (execution.ExitCode !== 0) { await this.finish(record, 'failed'); continue; }
        const outputs = await this.runtime.collect(record.container, record.grant);
        record.outputs = outputs.map((o) => ({ ...o, sha256: createHash('sha256').update(Buffer.from(o.base64, 'base64')).digest('hex') }));
        await this.finish(record, 'completed');
      } catch { await this.finish(record, 'failed'); }
    }
  }
  async handle(input: unknown): Promise<JobRecord> {
    const operation = operationSchema.parse(input);
    const grant = this.grants.get(operation.grantId);
    const context = operation.operation === 'start' ? operation.request.context : operation.context;
    if (!grant || !isDeepStrictEqual(grant.context, context)) throw new Error('Execution scope is not authorized.');
    if (operation.operation !== 'start') {
      const record = this.records.get(operation.jobId);
      if (!record || !isDeepStrictEqual(record.grant, grant)) throw new Error('Execution scope is not authorized.');
      if (operation.operation === 'cancel' && record.phase !== 'terminal') await this.finish(record, 'cancelled');
      else await this.reconcile();
      return structuredClone(record);
    }
    const request = operation.request;
    if (request.authorizedEnvironment !== grant.environment || !isDeepStrictEqual(request.command, grant.command) || request.maxDurationSeconds > grant.limits.durationSeconds || request.maxMemoryMb > grant.limits.memoryMb)
      throw new Error('Request exceeds the trusted execution grant.');
    const id = digest([grant.organizationId, grant.context.projectId, grant.context.runId, request.idempotencyKey]);
    const hash = digest([grant, request]);
    const existing = this.records.get(id);
    if (existing) {
      if (existing.digest !== hash) throw new Error('Conflicting repeated execution request.');
      await this.reconcile(); return structuredClone(existing);
    }
    await this.reconcile();
    if ([...this.records.values()].some((r) => r.phase !== 'terminal')) throw new Error('One active sandbox is permitted; cleanup must complete before another start.');
    if (this.records.size >= 100) throw new Error('Broker journal capacity reached; operator retention review required.');
    const boundGrant: Grant = { ...grant, limits: { ...grant.limits, memoryMb: request.maxMemoryMb, durationSeconds: request.maxDurationSeconds } };
    const record: JobRecord = { id, digest: hash, grant, container: `af-${id}`, deadline: Date.now() + request.maxDurationSeconds * 1000,
      phase: 'intent', status: 'pending', outputs: [] };
    await this.save(record);
    try {
      await this.runtime.create(record.container, boundGrant, this.image, hash);
      record.phase = 'preparing'; await this.save(record);
      await this.runtime.startContainer(record.container);
      await this.runtime.prepare(record.container, boundGrant);
      const executionId = await this.runtime.createExecution(record.container, request.command);
      record.executionId = executionId; record.phase = 'launching'; record.status = 'running';
      await this.save(record);
      if (Date.now() >= record.deadline) throw new Error('Deadline elapsed during preparation.');
      await this.runtime.startExecution(executionId);
      record.phase = 'executing'; await this.save(record);
    } catch { await this.finish(record, 'failed'); }
    return structuredClone(record);
  }
}
