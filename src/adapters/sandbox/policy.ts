import { z } from 'zod';
import { evidenceContextSchema, identifier } from '../../core/contracts.js';

export const relativePath = z.string().min(1).max(240).refine((value) =>
  value.split('/').every((part) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part) && part !== '.' && part !== '..'), 'Unsafe workspace path');
export const limitsSchema = z.strictObject({
  cpu: z.number().min(0.1).max(2), memoryMb: z.number().int().min(64).max(512),
  pids: z.number().int().min(8).max(64), workspaceBytes: z.number().int().min(4096).max(16 * 1024 * 1024),
  outputBytes: z.number().int().min(1).max(1024 * 1024), durationSeconds: z.number().int().min(1).max(300),
  network: z.literal('none'),
});
export const startSchema = z.strictObject({
  context: evidenceContextSchema, idempotencyKey: identifier,
  command: z.array(z.string().min(1).max(4096).refine((s) => !s.includes('\0'))).min(1).max(32),
  authorizedEnvironment: identifier, maxDurationSeconds: z.number().int().positive(), maxMemoryMb: z.number().int().positive(),
});
export const grantSchema = z.strictObject({
  id: identifier, organizationId: identifier, context: evidenceContextSchema,
  environment: identifier, command: startSchema.shape.command,
  limits: limitsSchema,
  // Contents are installed by the trusted coordinator, never read from a request-supplied host path.
  files: z.array(z.strictObject({ path: relativePath, content: z.string().max(64 * 1024) })).max(64),
  outputs: z.array(relativePath).max(16),
}).superRefine((grant, ctx) => {
  for (const paths of [grant.files.map((f) => f.path), grant.outputs]) {
    if (new Set(paths).size !== paths.length) ctx.addIssue({ code: 'custom', message: 'Duplicate workspace path' });
  }
  if (grant.context.environmentFingerprint !== grant.environment) ctx.addIssue({ code: 'custom', message: 'Environment binding mismatch' });
  if (grant.files.reduce((n, f) => n + Buffer.byteLength(f.content), 0) > grant.limits.workspaceBytes / 2)
    ctx.addIssue({ code: 'custom', message: 'Input exceeds workspace budget' });
});
export type Grant = z.infer<typeof grantSchema>;
export const operationSchema = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('start'), grantId: identifier, request: startSchema }),
  z.strictObject({ operation: z.enum(['inspect', 'cancel']), grantId: identifier, jobId: z.string().regex(/^[a-f0-9]{64}$/), context: evidenceContextSchema }),
]);
export const envelopeSchema = z.strictObject({
  nonce: z.string().regex(/^[a-f0-9]{64}$/), timestamp: z.number().int().nonnegative(),
  payload: z.string().max(64 * 1024), mac: z.string().regex(/^[a-f0-9]{64}$/),
});
