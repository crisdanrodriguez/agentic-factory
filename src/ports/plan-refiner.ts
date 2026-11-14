import type { ProjectConfiguration } from '../core/configuration.js';
import type { WorkItem } from '../core/contracts.js';

export interface PlanRefiner {
  refine(input: { workItem: WorkItem; sourceRevision: string; sourceSnapshot?: string }, signal?: AbortSignal): Promise<ProjectConfiguration>;
}
