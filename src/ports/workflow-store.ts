import type { ProjectConfiguration } from '../core/configuration.js';
import type { Command, Run, Scope } from '../core/workflow.js';
export interface WorkflowStore {
  create(scope: Scope, id: string, config: ProjectConfiguration): Promise<Run>;
  get(scope: Scope, id: string): Promise<Run>;
  apply(scope: Scope, id: string, expectedVersion: number, eventId: string, command: Command): Promise<Run>;
  findByOrigin?(scope: Scope, provider: string, reference: string): Promise<Run | undefined>;
  findById?(scope: Scope, id: string): Promise<Run | undefined>;
}
