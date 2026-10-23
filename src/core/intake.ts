import { z } from 'zod';
import { identifier, workItemSchema, type WorkItem } from './contracts.js';

export const MAX_REQUEST_BYTES = 65536;
export class IntakeError extends Error {}
export function fail(message: string): never { throw new IntakeError(message); }
const requestSchema = z.strictObject({ objective: workItemSchema.shape.objective, context: workItemSchema.shape.context });
export type IntakeSource = { kind: 'file' | 'cli' | 'telegram'; bytes: Buffer };
export type IntakeRecord = { workItem: WorkItem; version: number; actor: string; sourceKind: 'file' | 'cli' | 'telegram'; digest: string };
export type IntakeOperation = { kind: 'create'; key: string } | { kind: 'revise'; key: string; id: string; expectedRevision: string };
export function parseRequest(source: IntakeSource): z.infer<typeof requestSchema> {
  if (!['file', 'cli', 'telegram'].includes(source.kind) || source.bytes.length === 0 || source.bytes.length > MAX_REQUEST_BYTES) fail('Request exceeds the allowed bounds.');
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(source.bytes);
    return requestSchema.parse(JSON.parse(text) as unknown);
  } catch { return fail('Request must contain only valid objective and context fields in UTF-8 JSON.'); }
}
export function cliSource(objective: string, context: string): IntakeSource {
  if (objective.length > 4000 || context.length > 4000) fail('Request exceeds the allowed bounds.');
  const source: IntakeSource = { kind: 'cli', bytes: Buffer.from(JSON.stringify({ objective, context }), 'utf8') };
  parseRequest(source); return source;
}
export function validIdentifier(value: string): string {
  if (!identifier.safeParse(value).success || value.trim() !== value) fail('Invalid intake identifier.');
  return value;
}
export function revisionVersion(revision: string): number {
  if (!/^r[1-9][0-9]*$/.test(revision)) fail('Invalid intake revision.');
  const version = Number(revision.slice(1));
  if (!Number.isSafeInteger(version) || version >= 2147483647) fail('Invalid intake revision.');
  return version;
}

export type WorkItemMetadata = { id: string; revision: string };
