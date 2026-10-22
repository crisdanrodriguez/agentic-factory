import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { JobExecutor } from '../ports/job-executor.js';
import type { EvidenceContext, ExecutionStatus, Usage } from '../core/contracts.js';
import type { Grant } from './sandbox/policy.js';
import { callBroker } from './sandbox/transport.js';

// This callback must resolve authority from trusted installation/database state on every operation.
export type AuthorizeSandbox = (context: EvidenceContext) => Promise<{ organizationId: string; projectId: string }>;
export class SandboxJobExecutor implements JobExecutor {
  constructor(private readonly socket: string, private readonly token: string, private readonly grant: Grant, private readonly authorize: AuthorizeSandbox) {}
  private async check(context: EvidenceContext): Promise<void> {
    const scope = await this.authorize(context);
    if (scope.organizationId !== this.grant.organizationId || scope.projectId !== this.grant.context.projectId || !isDeepStrictEqual(context, this.grant.context))
      throw new Error('Sandbox execution is outside the authorized scope.');
  }
  async start(request: Parameters<JobExecutor['start']>[0]): Promise<{ jobId: string }> {
    await this.check(request.context);
    const record = z.object({ id: z.string() }).parse(await callBroker(this.socket, this.token, { operation: 'start', grantId: this.grant.id, request }));
    return { jobId: record.id };
  }
  async inspect(jobId: string, context: EvidenceContext): Promise<{ status: ExecutionStatus; usage: Usage }> {
    await this.check(context);
    const record = z.object({ status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']), phase: z.string() }).parse(
      await callBroker(this.socket, this.token, { operation: 'inspect', grantId: this.grant.id, jobId, context }));
    if (record.phase === 'cleanup-pending') throw new Error('Sandbox cleanup is pending; execution cannot be reported as complete.');
    return { status: record.status, usage: { cpuSeconds: null, costUsd: null } };
  }
  async cancel(jobId: string, context: EvidenceContext): Promise<void> {
    await this.check(context);
    const record = z.object({ phase: z.string() }).parse(await callBroker(this.socket, this.token, { operation: 'cancel', grantId: this.grant.id, jobId, context }));
    if (record.phase === 'cleanup-pending') throw new Error('Sandbox cleanup is pending; cancellation is not confirmed.');
  }
}
