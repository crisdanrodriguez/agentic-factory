import { z } from 'zod';

export const identifier = z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const description = z.string().trim().min(1).max(4000);
export const capability = z.enum(['agent.edit', 'job.cpu', 'artifact.private', 'verify.command', 'delivery.deploy']);
export type Capability = z.infer<typeof capability>;

export const workItemSchema = z.strictObject({
  id: identifier,
  ownerId: identifier,
  projectId: identifier,
  revision: identifier,
  objective: description,
  context: description,
  origin: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('local'), reference: description.optional() }),
    z.strictObject({ kind: z.literal('idea') }),
    z.strictObject({ kind: z.literal('external-ticket'), provider: identifier, reference: description }),
  ]),
});
export type WorkItem = z.infer<typeof workItemSchema>;

export const profileSchema = z.strictObject({
  id: z.enum(['software-general', 'ml-research']),
  environment: z.strictObject({ language: identifier, version: identifier, fingerprint: identifier }),
  requiredCapabilities: z.array(capability).min(1),
  deliverables: z.array(z.enum(['source', 'report', 'experiment-artifacts'])).min(1),
  checks: z.array(z.strictObject({
    id: identifier,
    layer: z.enum(['software', 'methodology', 'findings']),
    required: z.boolean(),
    command: z.array(description).min(1),
  })).min(1),
});
export type ProjectProfile = z.infer<typeof profileSchema>;

export const planSchema = z.strictObject({
  id: identifier,
  revision: identifier,
  policyRevision: identifier,
  workItemId: identifier,
  sourceSnapshot: identifier,
  scope: description,
  exclusions: z.array(description).min(1),
  dependencies: z.array(identifier),
  objectiveKind: z.enum(['investigation', 'performance', 'delivery']),
  criteria: z.array(description).min(1),
  budget: z.strictObject({
    maxTechnicalAttempts: z.number().int().positive(),
    maxVariants: z.number().int().positive(),
    maxDurationSeconds: z.number().int().positive(),
    maxMemoryMb: z.number().int().positive(),
    maxArtifactBytes: z.number().int().positive(),
  }),
  deliveryActions: z.array(z.literal('deploy')),
  research: z.strictObject({
    protocolRevision: identifier,
    datasetVersion: identifier,
    splitVersion: identifier,
    parametersDigest: identifier,
    baseline: description,
    primaryMetric: identifier,
    seeds: z.array(z.number().int().nonnegative()).min(1),
    stoppingRule: description,
  }).optional(),
});
export type ProjectPlan = z.infer<typeof planSchema>;

export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type VerificationStatus = 'verified' | 'rejected' | 'unverified';
export type ObjectiveAssessment = 'met' | 'unmet' | 'inconclusive' | 'not-assessed';
export type HumanDecision = 'pending' | 'accepted' | 'rejected' | 'changes-requested';
export interface Outcome {
  execution: ExecutionStatus;
  verification: VerificationStatus;
  objective: ObjectiveAssessment;
  humanDecision: HumanDecision;
}

export const evidenceContextSchema = z.strictObject({
  ownerId: identifier,
  projectId: identifier,
  workItemId: identifier,
  runId: identifier,
  planRevision: identifier,
  policyRevision: identifier,
  sourceSnapshot: identifier,
  environmentFingerprint: identifier,
  protocolRevision: identifier.optional(),
  datasetVersion: identifier.optional(),
  splitVersion: identifier.optional(),
  parametersDigest: identifier.optional(),
});
export type EvidenceContext = z.infer<typeof evidenceContextSchema>;
export const verificationResultSchema = z.strictObject({
  checkId: identifier,
  status: z.enum(['passed', 'failed', 'skipped', 'cancelled', 'missing']),
  context: evidenceContextSchema,
  evidenceReferences: z.array(identifier),
});
export type VerificationResult = z.infer<typeof verificationResultSchema>;

export interface ArtifactReference {
  context: EvidenceContext;
  id: string;
  kind: 'source' | 'report' | 'experiment-artifacts';
  bytes: number;
  sha256: string;
}

export interface Usage {
  cpuSeconds: number | null;
  costUsd: number | null;
}
