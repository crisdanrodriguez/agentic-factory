import { validateConfiguration, type ProjectConfiguration } from '../../core/configuration.js';
import { BOOTSTRAP_CONTRACT_CATALOG, BOOTSTRAP_POLICY } from '../../core/policy.js';
import type { WorkItem } from '../../core/contracts.js';
import type { PlanRefiner } from '../../ports/plan-refiner.js';

export interface CodexPlanRequest { workItem: WorkItem; sourceRevision: string; model: string; maxOutputBytes: number }
export interface CodexPlanTransport { refine(request: CodexPlanRequest, signal: AbortSignal): Promise<unknown> }

/**
 * The transport is injected only after an operator has explicitly authorized a
 * bounded local Codex session. No network client or credential is created here.
 */
export class AuthorizedCodexPlanRefiner implements PlanRefiner {
  private calls = 0;
  constructor(private readonly transport: CodexPlanTransport, private readonly config: { authorized: boolean; model: string; maxCalls: number; maxOutputBytes: number }) {}
  async refine(input: { workItem: WorkItem; sourceRevision: string }, signal: AbortSignal = new AbortController().signal): Promise<ProjectConfiguration> {
    if (!this.config.authorized) throw new Error('Codex plan refinement is not locally authorized.');
    if (this.calls >= this.config.maxCalls) throw new Error('Codex plan refinement budget exhausted.');
    if (input.sourceRevision !== input.workItem.revision) throw new Error('Codex refinement revision mismatch.');
    this.calls++;
    const proposal = await this.transport.refine({ ...input, model: this.config.model, maxOutputBytes: this.config.maxOutputBytes }, signal);
    return validateConfiguration(proposal, BOOTSTRAP_POLICY, BOOTSTRAP_CONTRACT_CATALOG);
  }
}
