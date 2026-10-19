import { z } from 'zod';
import { identifier, planSchema, profileSchema, workItemSchema } from './contracts.js';
import { assertPolicy, type GlobalPolicy, type CapabilityCatalog } from './policy.js';

export const configurationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  fixture: z.literal('synthetic-configuration-only'),
  workItem: workItemSchema,
  profile: profileSchema,
  plan: planSchema,
  policy: z.strictObject({
    requirePlanApproval: z.boolean(),
    requireEvidence: z.boolean(),
    requiredChecks: z.array(identifier).min(1),
  }),
});
export type ProjectConfiguration = z.infer<typeof configurationSchema>;

export function validateConfiguration(input: unknown, policy: GlobalPolicy, catalog: CapabilityCatalog): ProjectConfiguration {
  const parsed = configurationSchema.safeParse(input);
  if (!parsed.success) {
    // Zod messages and unknown keys may contain user input. Report only structural codes.
    const codes = [...new Set(parsed.error.issues.map((issue) => issue.code))].join(', ');
    throw new Error(`Invalid configuration structure (${codes}). See the documented profile fixtures.`);
  }
  assertPolicy(parsed.data, policy, catalog);
  return parsed.data;
}
