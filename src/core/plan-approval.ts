import { validateConfiguration, type ProjectConfiguration } from './configuration.js';
import { BOOTSTRAP_CONTRACT_CATALOG, BOOTSTRAP_POLICY } from './policy.js';
import { createRun, type Run, type Scope } from './workflow.js';
import type { WorkflowStore } from '../ports/workflow-store.js';
import type { PlanRefiner } from '../ports/plan-refiner.js';
import type { WorkItem } from './contracts.js';

export class PlanApprovalError extends Error {}
export class RevisionBoundPlanService {
  constructor(private readonly workflows: WorkflowStore, private readonly refiner: PlanRefiner) {}

  async refine(scope: Scope, workItem: WorkItem, sourceRevision: string, signal?: AbortSignal): Promise<ProjectConfiguration> {
    if (workItem.projectId !== scope.projectId) throw new PlanApprovalError('WorkItem scope is not authorized.');
    const proposal = await this.refiner.refine({ workItem, sourceRevision }, signal);
    const config = validateConfiguration(proposal, BOOTSTRAP_POLICY, BOOTSTRAP_CONTRACT_CATALOG);
    if (config.workItem.id !== workItem.id || config.workItem.revision !== workItem.revision) throw new PlanApprovalError('Plan is not bound to the WorkItem revision.');
    return config;
  }

  async createPending(scope: Scope, runId: string, config: ProjectConfiguration): Promise<Run> {
    if (config.workItem.projectId !== scope.projectId) throw new PlanApprovalError('Plan scope is not authorized.');
    return this.workflows.create(scope, runId, config);
  }

  async approve(scope: Scope, runId: string, expectedVersion: number, planRevision: string, policyRevision: string, currentWorkItem?: WorkItem): Promise<Run> {
    const run = await this.workflows.get(scope, runId);
    if (currentWorkItem && (currentWorkItem.id !== run.config.workItem.id || currentWorkItem.revision !== run.config.workItem.revision)) throw new PlanApprovalError('Approval is stale for the current WorkItem revision.');
    if (run.config.plan.revision !== planRevision || run.config.plan.policyRevision !== policyRevision) throw new PlanApprovalError('Approval does not match the current plan revision.');
    return this.workflows.apply(scope, runId, expectedVersion, `approve:${runId}:${planRevision}:${policyRevision}`, { type: 'approve', planRevision, policyRevision });
  }
}

export function pendingRun(runId: string, config: ProjectConfiguration): Run { return createRun(runId, config); }
