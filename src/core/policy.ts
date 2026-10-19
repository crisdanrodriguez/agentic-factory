import type { ProjectConfiguration } from './configuration.js';
import { evidenceContextSchema, verificationResultSchema, type Capability, type EvidenceContext, type ProjectProfile } from './contracts.js';

export interface GlobalPolicy {
  readonly revision: string;
  readonly requirePlanApproval: true;
  readonly requireEvidence: true;
  readonly limits: Readonly<ProjectConfiguration['plan']['budget']>;
  readonly profiles: Readonly<Record<ProjectProfile['id'], {
    readonly requiredChecks: readonly string[];
    readonly requiredCapabilities: readonly Capability[];
    readonly deliverables: readonly string[];
  }>>;
}

export interface CapabilityCatalog {
  readonly capabilities: readonly Capability[];
}

export const BOOTSTRAP_POLICY: GlobalPolicy = Object.freeze({
  revision: 'bootstrap-policy-1',
  requirePlanApproval: true,
  requireEvidence: true,
  limits: Object.freeze({ maxTechnicalAttempts: 3, maxVariants: 2, maxDurationSeconds: 300, maxMemoryMb: 1024, maxArtifactBytes: 10485760 }),
  profiles: Object.freeze({
    'software-general': Object.freeze({
      requiredChecks: Object.freeze(['software-tests']),
      requiredCapabilities: Object.freeze(['agent.edit', 'artifact.private', 'verify.command'] as const),
      deliverables: Object.freeze(['source', 'report']),
    }),
    'ml-research': Object.freeze({
      requiredChecks: Object.freeze(['software-tests', 'methodology-review', 'findings-review']),
      requiredCapabilities: Object.freeze(['agent.edit', 'job.cpu', 'artifact.private', 'verify.command'] as const),
      deliverables: Object.freeze(['source', 'report', 'experiment-artifacts']),
    }),
  }),
});

// This catalog describes supported contracts, not installed or authorized providers.
export const BOOTSTRAP_CONTRACT_CATALOG: CapabilityCatalog = Object.freeze({
  capabilities: Object.freeze(['agent.edit', 'job.cpu', 'artifact.private', 'verify.command'] as const),
});

function requireUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label} are not allowed.`);
}

export function assertPolicy(config: ProjectConfiguration, policy: GlobalPolicy, catalog: CapabilityCatalog): void {
  const { plan, profile } = config;
  if (!config.policy.requirePlanApproval || !config.policy.requireEvidence) {
    throw new Error('Project policy cannot disable required plan approval or evidence.');
  }
  if (plan.policyRevision !== policy.revision) throw new Error('Plan policy revision does not match trusted policy.');
  if (plan.workItemId !== config.workItem.id) throw new Error('Plan must reference the configured WorkItem.');
  for (const key of Object.keys(policy.limits) as (keyof typeof policy.limits)[]) {
    if (plan.budget[key] > policy.limits[key]) throw new Error(`Project budget exceeds the global ${key} limit.`);
  }
  requireUnique(profile.checks.map((check) => check.id), 'check identifiers');
  requireUnique(config.policy.requiredChecks, 'required checks');
  requireUnique(profile.requiredCapabilities, 'capabilities');
  requireUnique(profile.deliverables, 'deliverables');
  requireUnique(plan.deliveryActions, 'delivery actions');
  const rules = policy.profiles[profile.id];
  for (const id of rules.requiredChecks) {
    if (!config.policy.requiredChecks.includes(id)) throw new Error(`Mandatory verification cannot be removed: ${id}.`);
  }
  for (const id of config.policy.requiredChecks) {
    if (!profile.checks.some((check) => check.id === id && check.required)) {
      throw new Error('Every required policy check must have a required profile verification.');
    }
  }
  for (const required of rules.deliverables) {
    if (!profile.deliverables.includes(required as ProjectProfile['deliverables'][number])) {
      throw new Error(`Missing required deliverable: ${required}.`);
    }
  }
  for (const required of rules.requiredCapabilities) {
    if (!profile.requiredCapabilities.includes(required)) throw new Error(`Missing required profile capability: ${required}.`);
  }
  if (plan.deliveryActions.includes('deploy') && !profile.requiredCapabilities.includes('delivery.deploy')) {
    throw new Error('Deployment requires the delivery.deploy capability.');
  }
  for (const required of profile.requiredCapabilities) {
    if (!catalog.capabilities.includes(required)) throw new Error(`Missing capability: ${required}. No compatible capability was supplied.`);
  }
  if (profile.id === 'ml-research' && !plan.research) throw new Error('ML research requires a versioned protocol, dataset, and split.');
  if (profile.id === 'ml-research') {
    for (const layer of ['software', 'methodology', 'findings']) {
      if (!profile.checks.some((check) => check.required && check.layer === layer)) throw new Error(`ML research requires ${layer} verification.`);
    }
  }
}

/** Checks declared evidence completeness only. It never accepts a run or proves a claim. */
export function assertRequiredVerification(
  config: ProjectConfiguration,
  context: EvidenceContext,
  input: unknown,
  policy: GlobalPolicy = BOOTSTRAP_POLICY,
  catalog: CapabilityCatalog = BOOTSTRAP_CONTRACT_CATALOG,
): void {
  assertPolicy(config, policy, catalog);
  const validContext = evidenceContextSchema.safeParse(context);
  if (!validContext.success) throw new Error('Invalid evidence context.');
  const expected = {
    ownerId: config.workItem.ownerId, projectId: config.workItem.projectId, workItemId: config.workItem.id,
    planRevision: config.plan.revision, policyRevision: config.plan.policyRevision,
    sourceSnapshot: config.plan.sourceSnapshot, environmentFingerprint: config.profile.environment.fingerprint,
    protocolRevision: config.plan.research?.protocolRevision, datasetVersion: config.plan.research?.datasetVersion,
    splitVersion: config.plan.research?.splitVersion, parametersDigest: config.plan.research?.parametersDigest,
  };
  for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
    if (context[key] !== expected[key]) throw new Error('Evidence context does not match the current configuration.');
  }
  const parsed = verificationResultSchema.array().safeParse(input);
  if (!parsed.success) throw new Error('Invalid verification results.');
  requireUnique(parsed.data.map((result) => result.checkId), 'verification results');
  for (const result of parsed.data) {
    if (!config.profile.checks.some((check) => check.id === result.checkId)) throw new Error('Unknown verification check.');
  }
  for (const check of config.profile.checks.filter((entry) => entry.required)) {
    const result = parsed.data.find((entry) => entry.checkId === check.id);
    if (!result || result.status !== 'passed' || result.evidenceReferences.length === 0) {
      throw new Error(`Required verification has no passing evidence: ${check.id}.`);
    }
    for (const key of Object.keys(evidenceContextSchema.shape) as (keyof EvidenceContext)[]) {
      if (result.context[key] !== context[key]) throw new Error(`Stale or mismatched evidence: ${check.id}.`);
    }
  }
}
