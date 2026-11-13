import type { IntakeRecord } from './intake.js';
import type { ProjectConfiguration } from './configuration.js';
import type { WorkItem } from './contracts.js';
import type { GitHubIssuePolling, GitHubIssueWriter } from '../ports/github-api.js';
import type { GitHubTrust } from '../ports/github.js';
import type { RevisionBoundPlanService } from './plan-approval.js';
import type { Scope } from './workflow.js';
import type { WorkflowStore } from '../ports/workflow-store.js';
import type { WorkItemStore } from '../ports/work-item-store.js';

export type MvpCheckpoint = {
  reference: string; workItem: WorkItem; plan: ProjectConfiguration; runId: string; runVersion: number;
  approval: 'pending' | 'approved' | 'rejected';
};
export interface GitHubMvpCheckpointStore { load(reference: string): Promise<MvpCheckpoint | undefined>; save(checkpoint: MvpCheckpoint): Promise<void>; }
export type GitHubOwnerFeedback = { installationId: number; repositoryId: number; repositoryFullName: string; issueNumber: number; senderId: number; action: 'approve' | 'reject' | 'revise'; planRevision: string; policyRevision: string; comment?: string };

/** Derives checkpoints from durable workflow runs; save is intentionally a no-op because workflow events are durable. */
export class WorkflowBackedMvpCheckpointStore implements GitHubMvpCheckpointStore {
  constructor(private readonly scope: Scope, private readonly workflows: WorkflowStore) {}
  async load(reference: string): Promise<MvpCheckpoint | undefined> {
    if (!this.workflows.findByOrigin) throw new Error('Workflow store cannot recover GitHub checkpoints.');
    const run = await this.workflows.findByOrigin(this.scope, 'github', reference); if (!run) return undefined;
    return { reference, workItem: run.config.workItem, plan: run.config, runId: run.id, runVersion: run.version, approval: run.approval.status === 'approved' ? 'approved' : run.approval.status === 'rejected' ? 'rejected' : 'pending' };
  }
  async save(checkpoint: MvpCheckpoint): Promise<void> { void checkpoint; }
}

function feedbackAllowed(feedback: GitHubOwnerFeedback, trust: GitHubTrust, reference: string): void {
  if (feedback.installationId !== trust.installationId || feedback.repositoryId !== trust.repositoryId || feedback.repositoryFullName !== trust.repositoryFullName || feedback.senderId !== trust.authorizedSenderId || feedback.issueNumber <= 0 || !reference.endsWith(`#${feedback.issueNumber}`)) throw new Error('GitHub owner feedback is not authorized.');
}

/** Restart-safe MVP-01 coordinator. It creates only plans and approvals; never starts execution. */
export class GitHubMvpCoordinator {
  constructor(private readonly scope: Scope, private readonly trust: GitHubTrust, private readonly poller: GitHubIssuePolling, private readonly items: WorkItemStore, private readonly plans: RevisionBoundPlanService, private readonly workflows: WorkflowStore, private readonly checkpoints: GitHubMvpCheckpointStore, private readonly comments?: GitHubIssueWriter, private readonly synchronizationAuthorized = false) {}

  /** Durable intake is deliberately independent from refinement and Codex. */
  async intake(signal: AbortSignal): Promise<readonly IntakeRecord[]> {
    if (!this.synchronizationAuthorized) throw new Error('GitHub intake is not locally authorized.');
    const result = await this.poller.pollOnce(signal);
    await this.poller.commitCursor?.();
    return result.accepted;
  }

  async synchronize(signal: AbortSignal): Promise<readonly MvpCheckpoint[]> {
    if (!this.synchronizationAuthorized) throw new Error('GitHub synchronization is not locally authorized.');
    const result = await this.poller.pollOnce(signal); const checkpoints: MvpCheckpoint[] = [];
    for (const intake of result.accepted) checkpoints.push(await this.ensurePlan(intake, signal));
    // A cursor is an acknowledgement of the complete required checkpoint. If
    // refinement, workflow persistence, or this process is interrupted above,
    // the cursor remains unchanged and the next pass reconciles the issue.
    await this.poller.commitCursor?.();
    return checkpoints;
  }

  private async ensurePlan(intake: IntakeRecord, signal: AbortSignal): Promise<MvpCheckpoint> {
    const reference = intake.workItem.origin.kind === 'external-ticket' ? intake.workItem.origin.reference : '';
    if (!reference) throw new Error('GitHub intake did not preserve its origin reference.');
    const existing = await this.checkpoints.load(reference);
    if (existing && existing.workItem.revision === intake.workItem.revision) return existing;
    const config = await this.plans.refine(this.scope, intake.workItem, intake.workItem.revision, signal);
    const runId = `${intake.workItem.id}-${intake.workItem.revision}`;
    const run = await this.plans.createPending(this.scope, runId, config);
    const checkpoint: MvpCheckpoint = { reference, workItem: intake.workItem, plan: config, runId, runVersion: run.version, approval: 'pending' };
    await this.checkpoints.save(checkpoint); return checkpoint;
  }

  async publishPlan(reference: string, authorizedWrites: boolean, signal: AbortSignal): Promise<void> {
    if (!authorizedWrites || !this.comments) throw new Error('GitHub comment publication is not locally authorized.');
    const checkpoint = await this.checkpoints.load(reference); if (!checkpoint) throw new Error('No current MVP-01 plan exists.');
    const marker = reference.indexOf('#'); if (marker <= 0) throw new Error('GitHub origin reference is malformed.');
    const repositoryFullName = reference.slice(0, marker); const issueNumber = Number(reference.slice(marker + 1));
    await this.comments.createComment({ repositoryFullName, issueNumber, idempotencyKey: `plan:${reference}:${checkpoint.plan.plan.revision}`, body: `Agentic Factory proposed plan revision ${checkpoint.plan.plan.revision}. Owner approval must name this exact revision.` }, signal);
  }

  async applyFeedback(feedback: GitHubOwnerFeedback, signal?: AbortSignal): Promise<MvpCheckpoint> {
    const reference = `${this.trust.repositoryFullName}#${feedback.issueNumber}`; feedbackAllowed(feedback, this.trust, reference);
    const checkpoint = await this.checkpoints.load(reference); if (!checkpoint) throw new Error('No current MVP-01 plan exists for this issue.');
    const current = await this.items.get(this.scope, checkpoint.workItem.id);
    if (current.workItem.revision !== checkpoint.workItem.revision || feedback.planRevision !== checkpoint.plan.plan.revision || feedback.policyRevision !== checkpoint.plan.plan.policyRevision) throw new Error('GitHub feedback is stale for the current WorkItem or plan revision.');
    if (feedback.action === 'approve') {
      const run = await this.plans.approve(this.scope, checkpoint.runId, checkpoint.runVersion, feedback.planRevision, feedback.policyRevision, current.workItem);
      const updated = { ...checkpoint, runVersion: run.version, approval: 'approved' as const }; await this.checkpoints.save(updated); return updated;
    }
    if (feedback.action === 'reject') {
      const run = await this.workflows.apply(this.scope, checkpoint.runId, checkpoint.runVersion, `reject:${reference}:${feedback.planRevision}`, { type: 'reject', planRevision: feedback.planRevision, policyRevision: feedback.policyRevision });
      const updated = { ...checkpoint, runVersion: run.version, approval: 'rejected' as const }; await this.checkpoints.save(updated); return updated;
    }
    const replacement = await this.plans.refine(this.scope, current.workItem, current.workItem.revision, signal);
    const run = await this.plans.createPending(this.scope, `${current.workItem.id}-${current.workItem.revision}-revision`, replacement);
    const updated: MvpCheckpoint = { reference, workItem: current.workItem, plan: replacement, runId: run.id, runVersion: run.version, approval: 'pending' }; await this.checkpoints.save(updated); return updated;
  }
}
