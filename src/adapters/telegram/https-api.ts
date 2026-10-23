import { request } from 'node:https';
import { z } from 'zod';
import { telegramId } from '../../core/telegram.js';
import { TelegramApiError, type TelegramApi } from '../../ports/telegram-api.js';

const MAX_RESPONSE = 524288;
export function decodeTelegramResponse(bytes: Buffer, status: number): unknown {
  if (bytes.length > MAX_RESPONSE) throw new TelegramApiError('permanent');
  try {
    const envelope = z.object({ ok: z.boolean(), result: z.unknown().optional(), parameters: z.object({ retry_after: z.number().int().nonnegative().max(3600).optional() }).optional() })
      .parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown);
    if (status === 429) throw new TelegramApiError('transient', envelope.parameters?.retry_after ?? 60);
    if (status >= 500) throw new TelegramApiError('transient');
    if (status !== 200 || !envelope.ok) throw new TelegramApiError('permanent');
    return envelope.result;
  } catch (error) { throw error instanceof TelegramApiError ? error : new TelegramApiError('permanent'); }
}
export class HttpsTelegramApi implements TelegramApi {
  constructor(private readonly token: string) {
    if (!/^[0-9]+:[a-zA-Z0-9_-]{20,200}$/.test(token)) throw new TelegramApiError('permanent');
  }
  private async call(method: 'getMe' | 'getWebhookInfo' | 'getUpdates' | 'sendMessage', body: object, signal?: AbortSignal): Promise<unknown> {
    try {
      const payload = JSON.stringify(body);
      return await new Promise<unknown>((resolve, reject) => {
        // Endpoint, protocol, TLS verification and method names are never supplied by a message.
        const req = request({ hostname: 'api.telegram.org', port: 443, path: `/bot${this.token}/${method}`, method: 'POST',
          rejectUnauthorized: true, agent: false, ...(signal ? { signal } : {}),
          headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } }, (res) => {
          const chunks: Buffer[] = []; let length = 0;
          res.on('data', (chunk: Buffer) => {
            length += chunk.length;
            if (length > MAX_RESPONSE) { req.destroy(); reject(new TelegramApiError('permanent')); }
            else chunks.push(chunk);
          });
          res.on('error', () => reject(new TelegramApiError('transient')));
          res.on('end', () => { try { resolve(decodeTelegramResponse(Buffer.concat(chunks), res.statusCode ?? 0)); } catch (error) { reject(error); } });
        });
        const timer = setTimeout(() => { req.destroy(); reject(new TelegramApiError('transient')); }, 40000);
        req.on('close', () => clearTimeout(timer));
        req.on('error', () => reject(new TelegramApiError('transient')));
        req.end(payload);
      });
    } catch (error) { throw error instanceof TelegramApiError ? error : new TelegramApiError('transient'); }
  }
  async identity(signal?: AbortSignal): Promise<number> {
    try { return z.object({ id: telegramId, is_bot: z.literal(true) }).parse(await this.call('getMe', {}, signal)).id; }
    catch (error) { throw error instanceof TelegramApiError ? error : new TelegramApiError('permanent'); }
  }
  async hasWebhook(signal?: AbortSignal): Promise<boolean> {
    try { return z.object({ url: z.string() }).parse(await this.call('getWebhookInfo', {}, signal)).url !== ''; }
    catch (error) { throw error instanceof TelegramApiError ? error : new TelegramApiError('permanent'); }
  }
  async updates(offset: number, signal?: AbortSignal): Promise<unknown[]> {
    try { return z.array(z.unknown()).max(20).parse(await this.call('getUpdates', { offset, timeout: 25, limit: 20, allowed_updates: ['message'] }, signal)); }
    catch (error) { throw error instanceof TelegramApiError ? error : new TelegramApiError('permanent'); }
  }
  async send(chatId: number, text: string, signal?: AbortSignal): Promise<void> {
    if (!telegramId.safeParse(chatId).success || Buffer.byteLength(text) > 2048) throw new TelegramApiError('permanent');
    try {
      z.object({ message_id: telegramId, chat: z.object({ id: z.literal(chatId), type: z.literal('private') }) })
        .parse(await this.call('sendMessage', { chat_id: chatId, text, link_preview_options: { is_disabled: true }, protect_content: true }, signal));
    } catch (error) { throw error instanceof TelegramApiError ? error : new TelegramApiError('permanent'); }
  }
}
