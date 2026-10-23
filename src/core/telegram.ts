import { z } from 'zod';
import { parseRequest, validIdentifier, type IntakeSource } from './intake.js';

export const telegramId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const updateId = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1);
export type TelegramMessage = { updateId: number; messageId: number; date: number; userId: number; chatId: number; text: string };
export type TelegramCommand = { kind: 'help' | 'cancel' | 'invalid' } | { kind: 'new'; source: IntakeSource } | { kind: 'status'; id: string } | { kind: 'list'; after: string } | { kind: 'claim'; code: string };
export const HELP = 'Commands: /help, /new {"objective":"...","context":"..."}, /status ID, /list [after ID]. Requests are recorded only; execution is not authorized. Do not send secrets. /cancel is unavailable.';
const messageSchema = z.object({ update_id: updateId, message: z.object({
  message_id: telegramId, date: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  from: z.object({ id: telegramId, is_bot: z.literal(false) }).passthrough(),
  chat: z.object({ id: telegramId, type: z.literal('private') }).passthrough(),
  text: z.string().min(1).max(4000),
}).passthrough() }).strict();
export function parseTelegramMessage(value: unknown): TelegramMessage | null {
  const parsed = messageSchema.safeParse(value);
  if (!parsed.success) return null;
  const message = parsed.data.message;
  const forbidden = ['forward_origin','forward_from','forward_date','forward_from_chat','forward_from_message_id','forward_sender_name','forward_signature','is_automatic_forward','edit_date','receiver_user','ephemeral_message_id','sender_chat','via_bot','business_connection_id','document','photo','audio','video','voice','animation','sticker','contact','location','reply_to_message'];
  if (Buffer.from(message.text, 'utf8').toString('utf8') !== message.text) return null;
  if (forbidden.some((key) => Object.hasOwn(message, key)) || new TextEncoder().encode(message.text).length > 16000) return null;
  return { updateId: parsed.data.update_id, messageId: message.message_id, date: message.date, userId: message.from.id, chatId: message.chat.id, text: message.text };
}
export function parseTelegramCommand(text: string): TelegramCommand {
  if (text === '/help') return { kind: 'help' };
  if (text === '/cancel' || text.startsWith('/cancel ')) return { kind: 'cancel' };
  if (/^\/start [a-f0-9]{64}$/.test(text)) return { kind: 'claim', code: text.slice(7) };
  try {
    if (text.startsWith('/new ')) {
      const source: IntakeSource = { kind: 'telegram', bytes: Buffer.from(text.slice(5), 'utf8') };
      parseRequest(source); return { kind: 'new', source };
    }
    if (text.startsWith('/status ')) return { kind: 'status', id: validIdentifier(text.slice(8)) };
    if (text === '/list') return { kind: 'list', after: '' };
    if (text.startsWith('/list after ')) return { kind: 'list', after: validIdentifier(text.slice(12)) };
  } catch { /* Invalid request content is never included in a reply. */ }
  return { kind: 'invalid' };
}
export function recorded(id: string, revision: string): string { return `Request ${id} ${revision} recorded. Execution has not been authorized.`; }
