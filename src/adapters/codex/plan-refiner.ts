import { validateConfiguration, type ProjectConfiguration } from '../../core/configuration.js';
import { BOOTSTRAP_CONTRACT_CATALOG, BOOTSTRAP_POLICY } from '../../core/policy.js';
import type { WorkItem } from '../../core/contracts.js';
import { configurationFailure, RefinementDiagnosticError } from '../../core/refinement-diagnostics.js';
import type { PlanRefiner } from '../../ports/plan-refiner.js';

export interface CodexPlanRequest { workItem: WorkItem; sourceRevision: string; sourceSnapshot?: string; model: string; maxOutputBytes: number }
export interface CodexPlanTransport { refine(request: CodexPlanRequest, signal: AbortSignal): Promise<unknown> }

/**
 * The transport is injected only after an operator has explicitly authorized a
 * bounded local Codex session. No network client or credential is created here.
 */
export class AuthorizedCodexPlanRefiner implements PlanRefiner {
  private calls = 0;
  constructor(private readonly transport: CodexPlanTransport, private readonly config: { authorized: boolean; model: string; maxCalls: number; maxOutputBytes: number }) {}
  async refine(input: { workItem: WorkItem; sourceRevision: string; sourceSnapshot?: string }, signal: AbortSignal = new AbortController().signal): Promise<ProjectConfiguration> {
    if (!this.config.authorized || this.calls >= this.config.maxCalls) throw new RefinementDiagnosticError('REFINEMENT_CLI_CONFIG_INVALID', false);
    if (input.sourceRevision !== input.workItem.revision) throw new RefinementDiagnosticError('REFINEMENT_WORK_ITEM_MISMATCH', false);
    this.calls++;
    const proposal = await this.transport.refine({ ...input, model: this.config.model, maxOutputBytes: this.config.maxOutputBytes }, signal);
    try { return validateConfiguration(proposal, BOOTSTRAP_POLICY, BOOTSTRAP_CONTRACT_CATALOG); }
    catch (error) { throw configurationFailure(error); }
  }
}
