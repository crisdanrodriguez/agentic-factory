import { randomUUID } from 'node:crypto';
import type { RevisionBoundPlanService } from '../core/plan-approval.js';
import type { RefinementClaim } from '../ports/refinement-intent.js';
import type { RefinementIntentStore } from '../ports/refinement-intent.js';
import type { Scope } from '../core/workflow.js';
import type { WorkItemStore } from '../ports/work-item-store.js';
import type { WorkflowStore } from '../ports/workflow-store.js';

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

  async once(signal: AbortSignal): Promise<boolean> {
    const claim = await this.intents.claimDue(this.scope, this.workerId, 300);
    if (!claim) return false;
    if (signal.aborted || claim.cancellationRequested) { await this.intents.cancel(this.scope, claim.workItemId, claim.sourceRevision); return true; }
    try {
      const current = await this.items.get(this.scope, claim.workItemId);
      if (current.workItem.revision !== claim.sourceRevision) {
        await this.intents.supersedeOlder(this.scope, claim.workItemId, current.workItem.revision);
        return true;
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
        return true;
      }
      const plan = await this.plans.refine(this.scope, current.workItem, claim.sourceRevision, signal);
      if (signal.aborted) { await this.intents.cancel(this.scope, claim.workItemId, claim.sourceRevision); return true; }
      // PostgreSQL composition persists the workflow and intent completion together;
      // injected fakes may use the two operations separately for deterministic tests.
      if ('completeRefinement' in this.intents && typeof (this.intents as { completeRefinement?: unknown }).completeRefinement === 'function') {
        await (this.intents as { completeRefinement(claim: RefinementClaim, runId: string, config: unknown, workflows: unknown): Promise<void> }).completeRefinement(claim, runId, plan, this.workflows);
      } else {
        if (!existing) await this.plans.createPending(this.scope, runId, plan);
      }
      return true;
    } catch (error) {
      const code = error instanceof Error && /authorized|revision|scope|invalid/i.test(error.message) ? 'REFINEMENT_PERMANENT' : 'REFINEMENT_RETRYABLE';
      if (code === 'REFINEMENT_PERMANENT') await this.intents.fail(claim, code);
      else await this.intents.retry(claim, code, Math.min(300, 2 ** claim.attemptCount));
      return true;
    }
  }
}
