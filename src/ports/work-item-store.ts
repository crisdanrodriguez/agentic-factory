import type { IntakeOperation, IntakeRecord, IntakeSource } from '../core/intake.js';
import type { Scope } from '../core/workflow.js';
export interface WorkItemStore {
  ingest(scope: Scope, operation: IntakeOperation, source: IntakeSource): Promise<IntakeRecord>;
  ingestWithRefinementIntent?(scope: Scope, operation: IntakeOperation, source: IntakeSource, intent: { sourceRevision: string; originProvider: string; originReference: string }): Promise<IntakeRecord>;
  get(scope: Scope, id: string, revision?: string): Promise<IntakeRecord>;
  getByOrigin(scope: Scope, provider: string, reference: string): Promise<IntakeRecord | undefined>;
  close(): Promise<void>;
}
