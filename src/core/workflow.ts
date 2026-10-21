import type { ProjectConfiguration } from './configuration.js';
import { validateConfiguration } from './configuration.js';
import type { EvidenceContext, Outcome, VerificationResult } from './contracts.js';
import { assertRequiredVerification, BOOTSTRAP_CONTRACT_CATALOG, BOOTSTRAP_POLICY } from './policy.js';

export interface Scope { organizationId: string; projectId: string }
export interface Run {
  id: string;
  version: number;
  config: ProjectConfiguration;
  phase: 'awaiting-approval' | 'ready' | 'running' | 'awaiting-job' | 'verifying' | 'review' | 'terminal';
  outcome: Outcome;
  approval: { status: 'pending' | 'approved' | 'rejected' | 'invalidated'; planRevision: string; policyRevision: string };
  step: { attempts: number; variants: number; generation: number };
  job: { id: string; operationKey: string } | null;
  evidence: VerificationResult[];
  artifactReferences: string[];
  cancellationRequested: boolean;
  simulation: true;
}
export type Command =
  | { type: 'approve' | 'reject'; planRevision: string; policyRevision: string }
  | { type: 'start' | 'next-variant' }
  | { type: 'job-started'; jobId: string; operationKey: string }
  | { type: 'job-completed'; jobId: string; artifactReferences: string[] }
  | { type: 'technical-failure'; generation: number }
  | { type: 'verify'; results: VerificationResult[] }
  | { type: 'assess'; assessment: 'met' | 'unmet' | 'inconclusive' }
  | { type: 'accept' | 'request-cancellation' | 'confirm-cancellation' }
  | { type: 'revise'; config: ProjectConfiguration };

export function evidenceContext(run: Run): EvidenceContext {
  const { config } = run;
  const research = config.plan.research;
  return {
    ownerId: config.workItem.ownerId, projectId: config.workItem.projectId, workItemId: config.workItem.id,
    runId: run.id, planRevision: config.plan.revision, policyRevision: config.plan.policyRevision,
    sourceSnapshot: config.plan.sourceSnapshot, environmentFingerprint: config.profile.environment.fingerprint,
    ...(research ? { protocolRevision: research.protocolRevision, datasetVersion: research.datasetVersion, splitVersion: research.splitVersion, parametersDigest: research.parametersDigest } : {}),
  };
}
export function createRun(id: string, input: ProjectConfiguration): Run {
  const config = validateConfiguration(input, BOOTSTRAP_POLICY, BOOTSTRAP_CONTRACT_CATALOG);
  return { id, version: 0, config, phase: 'awaiting-approval',
    outcome: { execution: 'pending', verification: 'unverified', objective: 'not-assessed', humanDecision: 'pending' },
    approval: { status: 'pending', planRevision: config.plan.revision, policyRevision: config.plan.policyRevision },
    step: { attempts: 0, variants: 0, generation: 0 }, job: null, evidence: [], artifactReferences: [], cancellationRequested: false, simulation: true };
}
export function transition(current: Run, command: Command): Run {
  const run = structuredClone(current);
  const require = (condition: boolean, message = 'Invalid workflow transition.'): void => { if (!condition) throw new Error(message); };
  if (command.type === 'revise') {
    require(!['running', 'awaiting-job'].includes(run.phase) && !run.cancellationRequested, 'Cancel active work before revising it.');
    const config = validateConfiguration(command.config, BOOTSTRAP_POLICY, BOOTSTRAP_CONTRACT_CATALOG);
    require(config.plan.revision !== run.config.plan.revision, 'A changed plan requires a new revision.');
    require(config.workItem.id === run.config.workItem.id && config.workItem.ownerId === run.config.workItem.ownerId && config.workItem.projectId === run.config.workItem.projectId, 'Revision cannot change task ownership.');
    const replacement = createRun(run.id, config);
    replacement.version = run.version + 1;
    replacement.approval.status = 'invalidated';
    replacement.step.generation = run.step.generation + 1;
    return replacement;
  }
  require(run.phase !== 'terminal', 'Terminal runs cannot advance.');
  if (run.cancellationRequested) require(command.type === 'confirm-cancellation' || command.type === 'request-cancellation', 'Cancellation blocks new work and late results.');
  switch (command.type) {
    case 'approve': case 'reject':
      require(run.phase === 'awaiting-approval');
      require(command.planRevision === run.config.plan.revision && command.policyRevision === run.config.plan.policyRevision, 'Approval revision mismatch.');
      run.approval.status = command.type === 'approve' ? 'approved' : 'rejected';
      run.phase = command.type === 'approve' ? 'ready' : 'terminal';
      if (command.type === 'reject') { run.outcome.execution = 'cancelled'; run.outcome.humanDecision = 'rejected'; }
      break;
    case 'start':
      require(run.phase === 'ready' && run.approval.status === 'approved');
      require(run.step.attempts < run.config.plan.budget.maxTechnicalAttempts, 'Technical attempt limit exhausted.');
      run.step.attempts++; run.step.generation++; run.outcome.execution = 'running'; run.phase = 'running';
      break;
    case 'job-started':
      require(run.phase === 'running' && run.job === null);
      require(command.jobId.length > 0 && command.operationKey.length > 0, 'Job identity is required.');
      if (run.config.profile.id === 'ml-research' && run.step.variants === 0) run.step.variants = 1;
      run.job = { id: command.jobId, operationKey: command.operationKey }; run.phase = 'awaiting-job';
      break;
    case 'job-completed': {
      require(run.phase === 'awaiting-job' && run.job?.id === command.jobId);
      const kinds = new Set<string>();
      const references = new Set<string>();
      for (const reference of command.artifactReferences) {
        const match = /^(source|report|experiment-artifacts):([a-zA-Z0-9][a-zA-Z0-9._-]{0,127})$/.exec(reference);
        require(match !== null, 'Malformed artifact reference. Expected kind:identifier.');
        require(!references.has(reference), 'Duplicate artifact reference.');
        references.add(reference); kinds.add(match![1]!);
      }
      require(run.config.profile.deliverables.every((kind) => kinds.has(kind)), 'Missing required artifacts.');
      // References describe required outputs; their validity does not prove file existence.
      run.artifactReferences = command.artifactReferences; run.phase = 'verifying'; run.outcome.execution = 'completed';
      break;
    }
    case 'technical-failure':
      require(['running', 'awaiting-job'].includes(run.phase) && command.generation === run.step.generation, 'Stale technical attempt.');
      run.job = null;
      run.phase = run.step.attempts < run.config.plan.budget.maxTechnicalAttempts ? 'ready' : 'terminal';
      if (run.phase === 'terminal') run.outcome.execution = 'failed';
      break;
    case 'next-variant':
      require(run.config.profile.id === 'ml-research' && run.phase === 'review' && run.approval.status === 'approved', 'A variant requires an approved research plan and verified preceding results.');
      require(run.step.variants < run.config.plan.budget.maxVariants, 'Experimental variant limit exhausted.');
      run.step.variants++; run.step.attempts = 0; run.step.generation++;
      run.job = null; run.evidence = []; run.artifactReferences = []; run.phase = 'ready';
      run.outcome = { execution: 'pending', verification: 'unverified', objective: 'not-assessed', humanDecision: 'pending' };
      break;
    case 'verify':
      require(run.phase === 'verifying');
      assertRequiredVerification(run.config, evidenceContext(run), command.results);
      run.evidence = command.results; run.outcome.verification = 'verified'; run.phase = 'review';
      break;
    case 'assess':
      require(run.phase === 'review' && run.outcome.verification === 'verified');
      run.outcome.objective = command.assessment;
      break;
    case 'accept':
      require(run.phase === 'review' && run.outcome.objective !== 'not-assessed');
      run.outcome.humanDecision = 'accepted'; run.phase = 'terminal';
      break;
    case 'request-cancellation':
      if (!run.cancellationRequested) run.step.generation++;
      run.cancellationRequested = true;
      break;
    case 'confirm-cancellation':
      require(run.cancellationRequested); run.outcome.execution = 'cancelled'; run.phase = 'terminal';
      break;
  }
  run.version++;
  return run;
}
