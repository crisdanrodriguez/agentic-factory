import { z } from 'zod';
import { capability, identifier, planSchema, profileSchema } from './contracts.js';
import { BOOTSTRAP_POLICY } from './policy.js';

const repositorySchema = z.strictObject({
  installationId: z.number().int().positive(),
  repositoryId: z.number().int().positive(),
  fullName: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
});
const scopeSchema = z.strictObject({ organizationId: identifier, projectId: identifier });
const safeArg = z.string().min(1).max(512).refine((value) =>
  !/[\r\n\0`$;&|<>]/.test(value), 'Shell syntax is not permitted in trusted argv');
function isInlineCodeFlag(value: string): boolean {
  if (/^--(?:eval|print|command|expression|exec)(?:=|$)/i.test(value)) return true;
  // Reject short flags containing common interpreter code modes, including joined values and flag clusters.
  return /^-(?!-)[A-Za-z0-9]*[cep]/i.test(value);
}
const workingDirectory = z.string().max(240).refine((value) => value === '.' ||
  (value.length > 0 && value.split('/').every((part) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part) && part !== '.' && part !== '..')),
'Working directory must be a safe relative path');
const checkSchema = z.strictObject({
  id: identifier,
  layer: z.literal('software'),
  argv: z.array(safeArg).min(1).max(32).refine((argv) =>
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(argv[0] ?? '') &&
    !['sh', 'bash', 'zsh', 'fish', 'cmd', 'powershell', 'pwsh'].includes((argv[0] ?? '').toLowerCase()) &&
    !argv.some(isInlineCodeFlag), 'Direct shell and inline code execution are not trusted checks'),
  workingDirectory,
  environmentVariables: z.strictObject({
    CI: z.literal('true').optional(), TZ: z.literal('UTC').optional(), LANG: z.enum(['C', 'C.UTF-8']).optional(),
  }),
});

/** Owner-authored file only. It is never part of a model response. */
export const ownerProjectAuthorizationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  policyRevision: identifier,
  scope: scopeSchema,
  repository: repositorySchema,
  workItemId: identifier,
  sourceSnapshot: z.string().regex(/^[a-f0-9]{64}$/),
  profileId: z.literal('software-general'),
  environment: profileSchema.shape.environment,
  capabilities: z.array(capability).min(1),
  deliverables: z.array(z.enum(['source', 'report', 'experiment-artifacts'])).min(1),
  checks: z.array(checkSchema).min(1).max(16),
  limits: planSchema.shape.budget,
  allowExecution: z.boolean().default(false),
}).superRefine((value, context) => {
  for (const [label, entries] of [
    ['capabilities', value.capabilities], ['deliverables', value.deliverables], ['checks', value.checks.map((check) => check.id)],
  ] as const) {
    if (new Set(entries).size !== entries.length) context.addIssue({ code: 'custom', message: `Duplicate ${label} are not allowed` });
  }
});
export type OwnerProjectAuthorization = z.infer<typeof ownerProjectAuthorizationSchema>;
export type TrustedRepository = z.infer<typeof repositorySchema>;
export type TrustedProjectScope = z.infer<typeof scopeSchema>;

/** Bind approval to every owner-controlled effect without storing secrets or command output. */
export function ownerAuthorizationSnapshot(value: OwnerProjectAuthorization): string {
  return JSON.stringify(ownerProjectAuthorizationSchema.parse(value));
}

export function parseOwnerProjectAuthorization(input: unknown, scope: TrustedProjectScope,
  repository: TrustedRepository): OwnerProjectAuthorization {
  const parsed = ownerProjectAuthorizationSchema.safeParse(input);
  const rules = BOOTSTRAP_POLICY.profiles['software-general'];
  if (!parsed.success || parsed.data.policyRevision !== BOOTSTRAP_POLICY.revision ||
      parsed.data.scope.organizationId !== scope.organizationId ||
      parsed.data.scope.projectId !== scope.projectId ||
      parsed.data.repository.installationId !== repository.installationId ||
      parsed.data.repository.repositoryId !== repository.repositoryId ||
      parsed.data.repository.fullName !== repository.fullName ||
      parsed.data.capabilities.length !== rules.requiredCapabilities.length ||
      parsed.data.capabilities.some((value) => !rules.requiredCapabilities.includes(value)) ||
      parsed.data.deliverables.length !== rules.deliverables.length ||
      parsed.data.deliverables.some((value) => !rules.deliverables.includes(value)) ||
      Object.entries(BOOTSTRAP_POLICY.limits).some(([key, limit]) =>
        parsed.data.limits[key as keyof typeof BOOTSTRAP_POLICY.limits] > limit)) {
    throw new Error('Owner project authorization is invalid or outside the trusted repository scope.');
  }
  return parsed.data;
}
