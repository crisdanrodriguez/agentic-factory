import type { Capability, EvidenceContext, Usage } from '../core/contracts.js';

export interface AgentRuntime {
  readonly capabilities: readonly Capability[];
  propose(request: { context: EvidenceContext; instruction: string; authorizedWorkspace: string }, signal: AbortSignal): Promise<{
    proposalReference: string;
    usage: Usage;
  }>;
}
