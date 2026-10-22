import { createServer, createConnection, type Server } from 'node:net';
import { chmod, unlink, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { RequestAuthenticator, signMessage, authenticateMessage } from './authentication.js';
import { envelopeSchema } from './policy.js';
import { privateDirectory } from './private-files.js';
import type { SandboxBroker } from './broker.js';
import { z } from 'zod';

const MAX_FRAME = 128 * 1024;
export async function serveBroker(directory: string, token: string, broker: SandboxBroker): Promise<{ close(): Promise<void> }> {
  await privateDirectory(directory);
  const path = join(directory, 'control.sock');
  // A pre-existing socket is never deleted automatically: it may belong to a live broker.
  try { await lstat(path); throw new Error('Broker socket exists; verify process ownership before recovery.'); }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  const authentication = new RequestAuthenticator(token, directory);
  let queue: Promise<void> = Promise.resolve(); let pending = 0;
  const serialize = (operation: () => Promise<void>): void => {
    if (pending >= 32) throw new Error('Broker is busy.');
    pending++;
    queue = queue.then(operation).catch(() => { /* Request errors are returned without private details. */ }).finally(() => { pending--; });
  };
  const server: Server = createServer((socket) => {
    socket.setTimeout(3000, () => socket.destroy());
    let bytes = 0; const parts: Buffer[] = []; let complete = false;
    socket.on('error', () => { /* Disconnected clients do not cancel durable execution. */ });
    socket.on('data', (part: Buffer) => {
      if (complete) { socket.destroy(); return; }
      bytes += part.length;
      if (bytes > MAX_FRAME) { socket.destroy(); return; }
      parts.push(part);
      if (!part.includes(10)) return;
      complete = true; socket.setTimeout(15_000);
      const text = Buffer.concat(parts).toString('utf8');
      if (!text.endsWith('\n') || text.indexOf('\n') !== text.length - 1) { socket.destroy(); return; }
      try {
        serialize(async () => {
          try {
            const envelope = envelopeSchema.parse(JSON.parse(text));
            const operation = await authentication.accept(text);
            const result = await broker.handle(operation);
            socket.end(signMessage(token, { requestNonce: envelope.nonce, ok: true, result }) + '\n');
          } catch { socket.end(JSON.stringify({ ok: false, error: 'Broker request rejected or unavailable.' }) + '\n'); }
        });
      } catch { socket.destroy(); }
    });
  });
  server.maxConnections = 32;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
  await chmod(path, 0o600);
  const timer = setInterval(() => {
    if (pending === 0) serialize(() => broker.reconcile());
  }, 250);
  return { async close() {
    clearInterval(timer);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await queue;
    try { await unlink(path); } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  } };
}
export async function callBroker(path: string, token: string, operation: unknown): Promise<unknown> {
  const request = signMessage(token, operation);
  const nonce = envelopeSchema.parse(JSON.parse(request)).nonce;
  return new Promise((resolve, reject) => {
    const socket = createConnection(path); let bytes = 0; const parts: Buffer[] = [];
    socket.setTimeout(15_000, () => socket.destroy(new Error('Broker request timed out.')));
    socket.on('error', reject);
    socket.on('connect', () => socket.write(request + '\n'));
    socket.on('data', (part: Buffer) => {
      bytes += part.length;
      if (bytes > 4 * 1024 * 1024) { socket.destroy(new Error('Broker response exceeds limit.')); return; }
      parts.push(part);
    });
    socket.on('end', () => {
      try {
        const message = envelopeSchema.extend({ payload: z.string().max(4 * 1024 * 1024) }).parse(JSON.parse(Buffer.concat(parts).toString('utf8')));
        const expected = authenticateMessage(token, message.nonce, message.timestamp, message.payload);
        if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(message.mac, 'hex')) || Math.abs(Date.now() - message.timestamp) > 30_000)
          throw new Error('Broker response authentication failed.');
        const response = z.object({ requestNonce: z.literal(nonce), ok: z.literal(true), result: z.unknown() }).parse(JSON.parse(message.payload));
        resolve(response.result);
      } catch { reject(new Error('Broker response rejected or unavailable.')); }
    });
  });
}
