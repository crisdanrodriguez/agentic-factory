import type { ProjectConfiguration } from '../core/configuration.js';
import type { WorkItem } from '../core/contracts.js';

export interface PlanRefiner {
  refine(input: { workItem: WorkItem; sourceRevision: string }, signal?: AbortSignal): Promise<ProjectConfiguration>;
}
