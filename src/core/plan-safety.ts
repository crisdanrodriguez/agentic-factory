import { validateConfiguration, type ProjectConfiguration } from './configuration.js';
import { workItemSchema, type WorkItem } from './contracts.js';
import { BOOTSTRAP_CONTRACT_CATALOG, BOOTSTRAP_POLICY } from './policy.js';

/** Revalidate stored plans under current trusted policy, including optional durable source evidence. */
export function assertPlanSafety(config: ProjectConfiguration, source?: { workItem: WorkItem; digest: string }): void {
  validateConfiguration(config, BOOTSTRAP_POLICY, BOOTSTRAP_CONTRACT_CATALOG);
  if (source && (JSON.stringify(workItemSchema.parse(config.workItem)) !== JSON.stringify(workItemSchema.parse(source.workItem)) ||
      config.plan.sourceSnapshot !== source.digest)) {
    throw new Error('Plan is stale for the current durable WorkItem or source snapshot.');
  }
}
