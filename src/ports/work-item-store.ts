import type { IntakeOperation, IntakeRecord, IntakeSource } from '../core/intake.js';
import type { Scope } from '../core/workflow.js';
export interface WorkItemStore {
  ingest(scope: Scope, operation: IntakeOperation, source: IntakeSource): Promise<IntakeRecord>;
  get(scope: Scope, id: string, revision?: string): Promise<IntakeRecord>;
  close(): Promise<void>;
}
