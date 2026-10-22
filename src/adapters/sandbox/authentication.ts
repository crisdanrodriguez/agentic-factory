import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { envelopeSchema, operationSchema } from './policy.js';
import { readPrivate, writePrivate } from './private-files.js';
import { z } from 'zod';

export function authenticateMessage(token: string, nonce: string, timestamp: number, payload: string): string {
  return createHmac('sha256', token).update(JSON.stringify([nonce, timestamp, payload])).digest('hex');
}
export function signMessage(token: string, payload: unknown, timestamp = Date.now()): string {
  const nonce = randomBytes(32).toString('hex');
  const body = JSON.stringify(payload);
  return JSON.stringify({ nonce, timestamp, payload: body, mac: authenticateMessage(token, nonce, timestamp, body) });
}
const replaySchema = z.strictObject({ lastTime: z.number(), entries: z.record(z.string(), z.number()) });
export class RequestAuthenticator {
  constructor(private readonly token: string, private readonly directory: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('A random 256-bit broker credential is required.');
  }
  // Call only in the broker's serialized request loop, before any side effects.
  async accept(raw: string, now = Date.now()): Promise<z.infer<typeof operationSchema>> {
    const message = envelopeSchema.parse(JSON.parse(raw));
    const expected = authenticateMessage(this.token, message.nonce, message.timestamp, message.payload);
    if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(message.mac, 'hex')) || Math.abs(now - message.timestamp) > 30_000)
      throw new Error('Unauthorized or expired broker request.');
    const operation = operationSchema.parse(JSON.parse(message.payload));
    const path = join(this.directory, 'replay.json');
    let state: z.infer<typeof replaySchema> = { lastTime: now, entries: {} };
    try { state = replaySchema.parse(JSON.parse(await readPrivate(path))); }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
    if (now < state.lastTime || Object.hasOwn(state.entries, message.nonce)) throw new Error('Replay or clock rollback rejected.');
    state.entries = Object.fromEntries(Object.entries(state.entries).filter(([, expiry]) => expiry >= now));
    if (Object.keys(state.entries).length >= 1000) throw new Error('Broker request rate exceeded.');
    state.lastTime = now;
    state.entries[message.nonce] = message.timestamp + 30_000;
    await writePrivate(path, JSON.stringify(state));
    return operation;
  }
}
