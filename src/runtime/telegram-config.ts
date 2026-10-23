import { dirname, isAbsolute, resolve, basename } from 'node:path';
import { z } from 'zod';
import { identifier } from '../core/contracts.js';
import { telegramId } from '../core/telegram.js';
import { fail } from '../core/intake.js';
import { readPrivateFile } from '../adapters/local-intake.js';
const environmentName = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/);
const schema = z.strictObject({ installationId: identifier, botId: telegramId, principal: identifier,
  databaseUrlEnvironment: environmentName, tokenEnvironment: environmentName.optional() });
export async function telegramConfig(): Promise<z.infer<typeof schema>> {
  try {
    const path = process.env.FACTORY_TELEGRAM_CONFIG ?? '';
    if (!isAbsolute(path) || resolve(path) !== path) fail('Invalid configuration.');
    return schema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readPrivateFile(dirname(path), basename(path)))) as unknown);
  } catch { return fail('Trusted Telegram configuration is unavailable or invalid.'); }
}
