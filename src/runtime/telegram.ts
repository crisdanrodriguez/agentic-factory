import { setTimeout } from 'node:timers/promises';
import type { TelegramStore } from '../adapters/postgres/telegram-store.js';
import { TelegramApiError, type TelegramApi } from '../ports/telegram-api.js';
import { fail } from '../core/intake.js';

// The database session owns the poller lock. No transaction spans a network request.
export class TelegramRunner {
  private ready = false;
  constructor(private readonly store: TelegramStore, private readonly api: TelegramApi, private readonly expectedBot: number,
    private readonly delay: (milliseconds: number, signal: AbortSignal) => Promise<unknown> = (ms, signal) => setTimeout(ms, undefined, { signal })) {}
  async start(): Promise<void> {
    const installation = await this.store.start();
    if (String(this.expectedBot) !== installation.bot_id || await this.api.identity(this.store.abort.signal) !== this.expectedBot) fail('Configured Telegram bot identity does not match.');
    if (await this.api.hasWebhook(this.store.abort.signal)) fail('Telegram webhook conflict; operator review is required.');
    this.store.assertOwned(); this.ready = true;
  }
  async recover(): Promise<void> {
    if (!this.ready) fail('Telegram runner is not ready.');
    // Bounded work per tick; receipts and attempts survive interruption.
    for (let n = 0; n < 60 && await this.store.processOne(); n++) { /* Drain captured operations before polling. */ }
    for (let n = 0; n < 20; n++) {
      const reply = await this.store.prepareReply();
      if (!reply) break;
      this.store.assertOwned();
      try { await this.api.send(Number(reply.chat_id), reply.body, this.store.abort.signal); }
      catch (error) {
        this.store.assertOwned();
        await this.store.finishReply(reply.update_id, error instanceof TelegramApiError ? error : new TelegramApiError('transient'));
        continue;
      }
      this.store.assertOwned(); await this.store.finishReply(reply.update_id);
    }
  }
  async tick(): Promise<void> {
    await this.recover();
    for (let attempt = 0; attempt < 3; attempt++) {
      this.store.assertOwned();
      const offset = await this.store.offset();
      let updates: unknown[];
      try { updates = await this.api.updates(offset, this.store.abort.signal); }
      catch (error) {
        this.store.assertOwned();
        if (!(error instanceof TelegramApiError) || error.kind === 'permanent' || attempt === 2) throw new TelegramApiError('permanent');
        await this.delay(Math.max(1000 * 2 ** attempt, Math.min(3600, error.retryAfter) * 1000), this.store.abort.signal);
        continue;
      }
      this.store.assertOwned(); await this.store.capture(updates); await this.recover(); return;
    }
  }
  async close(): Promise<void> { this.ready = false; await this.store.close(); }
}
