import type { Scope } from '../core/workflow.js';

export type RefinementIntentStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'superseded';
export type RefinementIntent = {
  scope: Scope; workItemId: string; sourceRevision: string; originProvider: string; originReference: string;
  status: RefinementIntentStatus; attemptCount: number; maxAttempts: number; nextAttemptAt: string;
  leaseToken?: string; leaseExpiresAt?: string; cancellationRequested: boolean; planRunId?: string;
};
export type RefinementClaim = RefinementIntent & { leaseToken: string };

export interface RefinementIntentStore {
  claimDue(scope: Scope, workerId: string, leaseSeconds: number): Promise<RefinementClaim | undefined>;
  retry(claim: RefinementClaim, errorCode: string, delaySeconds: number): Promise<void>;
  fail(claim: RefinementClaim, errorCode: string): Promise<void>;
  cancel(scope: Scope, workItemId: string, sourceRevision: string): Promise<void>;
  supersedeOlder(scope: Scope, workItemId: string, currentRevision: string): Promise<void>;
  completeExisting?(claim: RefinementClaim, planRunId: string): Promise<void>;
}
