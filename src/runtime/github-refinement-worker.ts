import { randomUUID } from 'node:crypto';
import type { RevisionBoundPlanService } from '../core/plan-approval.js';
import type { RefinementClaim } from '../ports/refinement-intent.js';
import type { RefinementIntentStore } from '../ports/refinement-intent.js';
import type { Scope } from '../core/workflow.js';
import type { WorkItemStore } from '../ports/work-item-store.js';
import type { WorkflowStore } from '../ports/workflow-store.js';
import { diagnosticFailure, RefinementDiagnosticError, type RefinementDiagnosticCode } from '../core/refinement-diagnostics.js';

export type RefinementOutcome =
  | { status: 'no-due-intent' }
  | { status: 'succeeded'; runId: string }
  | { status: 'failed-retryable' | 'failed-permanent'; diagnosticCode: RefinementDiagnosticCode }
  | { status: 'interrupted'; reason: 'cancelled' | 'superseded' }
  | { status: 'unresolved'; diagnosticCode: RefinementDiagnosticCode };

export function refinementOutcomeExitCode(outcome: RefinementOutcome): number {
  if (outcome.status === 'succeeded') return 0;
  if (outcome.status === 'no-due-intent') return 3;
  return outcome.status === 'interrupted' || outcome.status === 'unresolved' ? 2 : 1;
}

/** A bounded, restart-safe refinement worker. It never publishes to GitHub or starts execution. */
export class GitHubRefinementWorker {
  constructor(
    private readonly scope: Scope,
    private readonly intents: RefinementIntentStore,
    private readonly items: WorkItemStore,
    private readonly plans: RevisionBoundPlanService,
    private readonly workflows: WorkflowStore,
    private readonly workerId = `refiner-${randomUUID()}`,
  ) {}

  async once(signal: AbortSignal): Promise<RefinementOutcome> {
    let claim: RefinementClaim | undefined;
    try { claim = await this.intents.claimDue(this.scope, this.workerId, 300); }
    catch { throw new RefinementDiagnosticError('REFINEMENT_PERSISTENCE_FAILED', true); }
    if (!claim) return { status: 'no-due-intent' };
    if (signal.aborted || claim.cancellationRequested) { await this.intents.cancel(this.scope, claim.workItemId, claim.sourceRevision); return { status: 'interrupted', reason: 'cancelled' }; }
    let phase: 'read' | 'refine' | 'persist' = 'read';
    try {
      const current = await this.items.get(this.scope, claim.workItemId);
      if (current.workItem.revision !== claim.sourceRevision) {
        await this.intents.supersedeOlder(this.scope, claim.workItemId, current.workItem.revision);
        return { status: 'interrupted', reason: 'superseded' };
      }
      const runId = `${claim.workItemId}-${claim.sourceRevision}`;
      const existingCandidate = this.workflows.findById
        ? await this.workflows.findById(this.scope, runId)
        : await this.workflows.findByOrigin?.(this.scope, claim.originProvider, claim.originReference);
      const existing = existingCandidate?.id === runId && existingCandidate.config.workItem.revision === claim.sourceRevision ? existingCandidate : undefined;
      // A prior transaction may have committed the workflow and lost the
      // caller's confirmation before completing the intent. Reconcile that
      // durable workflow instead of attempting a duplicate insert.
      if (existing) {
        if (this.intents.completeExisting) await this.intents.completeExisting(claim, existing.id);
        else throw new Error('Existing refinement result requires reconciliation support.');
        return { status: 'succeeded', runId: existing.id };
      }
      phase = 'refine';
      const plan = await this.plans.refine(this.scope, current.workItem, claim.sourceRevision, signal, current.digest);
      if (signal.aborted) { await this.intents.cancel(this.scope, claim.workItemId, claim.sourceRevision); return { status: 'interrupted', reason: 'cancelled' }; }
      phase = 'persist';
      // PostgreSQL composition persists the workflow and intent completion together;
      // injected fakes may use the two operations separately for deterministic tests.
      if ('completeRefinement' in this.intents && typeof (this.intents as { completeRefinement?: unknown }).completeRefinement === 'function') {
        await (this.intents as { completeRefinement(claim: RefinementClaim, runId: string, config: unknown, workflows: unknown): Promise<void> }).completeRefinement(claim, runId, plan, this.workflows);
      } else {
        if (!existing) await this.plans.createPending(this.scope, runId, plan);
        return { status: 'unresolved', diagnosticCode: 'REFINEMENT_PERSISTENCE_FAILED' };
      }
      return { status: 'succeeded', runId };
    } catch (error) {
      if (signal.aborted) { await this.intents.cancel(this.scope, claim.workItemId, claim.sourceRevision); return { status: 'interrupted', reason: 'cancelled' }; }
      const failure = phase !== 'refine' && !(error instanceof RefinementDiagnosticError)
        ? new RefinementDiagnosticError('REFINEMENT_PERSISTENCE_FAILED', true) : diagnosticFailure(error);
      const status = failure.retryable
        ? await this.intents.retry(claim, failure.code, Math.min(300, 2 ** claim.attemptCount))
        : await this.intents.fail(claim, failure.code);
      if (status === 'cancelled') return { status: 'interrupted', reason: 'cancelled' };
      if (status === 'failed' || !failure.retryable || claim.attemptCount >= claim.maxAttempts)
        return { status: 'failed-permanent', diagnosticCode: failure.code };
      return { status: 'failed-retryable', diagnosticCode: failure.code };
    }
  }
}
