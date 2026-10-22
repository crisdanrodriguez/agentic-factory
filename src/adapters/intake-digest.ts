import { createHash } from 'node:crypto';
import type { IntakeOperation, IntakeSource } from '../core/intake.js';
export function sourceDigest(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
export function operationDigest(operation: IntakeOperation, source: IntakeSource): string {
  return sourceDigest(Buffer.from(JSON.stringify({ operation, kind: source.kind, bytes: source.bytes.toString('base64') })));
}
