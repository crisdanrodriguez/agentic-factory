export class TelegramApiError extends Error {
  constructor(readonly kind: 'transient' | 'permanent', readonly retryAfter = 0) { super('Telegram transport failed.'); }
}
export interface TelegramApi {
  identity(signal?: AbortSignal): Promise<number>;
  hasWebhook(signal?: AbortSignal): Promise<boolean>;
  updates(offset: number, signal?: AbortSignal): Promise<unknown[]>;
  send(chatId: number, text: string, signal?: AbortSignal): Promise<void>;
}
