import type { EvidenceContext, ExecutionStatus, Usage } from '../core/contracts.js';

export interface JobExecutor {
  start(request: { context: EvidenceContext; idempotencyKey: string; command: readonly string[]; authorizedEnvironment: string; maxDurationSeconds: number; maxMemoryMb: number }): Promise<{ jobId: string }>;
  inspect(jobId: string, context: EvidenceContext): Promise<{ status: ExecutionStatus; usage: Usage }>;
  cancel(jobId: string, context: EvidenceContext): Promise<void>;
}
