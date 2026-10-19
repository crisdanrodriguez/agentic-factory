import { open } from 'node:fs/promises';

export const MAX_CONFIG_BYTES = 65536;

export async function readJsonConfiguration(path: string): Promise<unknown> {
  const file = await open(path, 'r').catch(() => { throw new Error('Cannot open configuration file.'); });
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error('Configuration must be a regular file.');
    if (stat.size > MAX_CONFIG_BYTES) throw new Error('Configuration exceeds the 65536-byte limit.');
    const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await file.read(buffer, total, buffer.length - total, null);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > MAX_CONFIG_BYTES) throw new Error('Configuration exceeds the 65536-byte limit.');
    try {
      return JSON.parse(buffer.subarray(0, total).toString('utf8')) as unknown;
    } catch {
      throw new Error('Configuration is not valid JSON.');
    }
  } finally {
    await file.close();
  }
}
