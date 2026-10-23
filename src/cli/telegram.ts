import { TelegramStore } from '../adapters/postgres/telegram-store.js';
import { HttpsTelegramApi } from '../adapters/telegram/https-api.js';
import { telegramConfig } from '../runtime/telegram-config.js';
import { TelegramRunner } from '../runtime/telegram.js';
import { fail } from '../core/intake.js';
import { telegramId } from '../core/telegram.js';

const args = process.argv.slice(2);
let store: TelegramStore | undefined;
let stopping = false;
try {
  if (args.length === 1 && args[0] === '--help') {
    console.log('Optional Telegram adapter: start | pair issue PROJECT USER | pair show | pair confirm USER CHAT GENERATION | pair revoke. Requires private FACTORY_TELEGRAM_CONFIG. Intake only; no execution or approval. See docs/TELEGRAM.md.');
  } else {
    const config = await telegramConfig();
    const url = process.env[config.databaseUrlEnvironment];
    if (!url) fail('Telegram database configuration is unavailable.');
    const bot = args.length === 1 && args[0] === 'start';
    store = new TelegramStore(url, config.installationId, config.principal, bot ? 'bot' : 'admin');
    if (bot) {
      const token = config.tokenEnvironment ? process.env[config.tokenEnvironment] : undefined;
      if (!token) fail('Telegram token configuration is unavailable.');
      const runner = new TelegramRunner(store, new HttpsTelegramApi(token), config.botId);
      const stop = () => { stopping = true; store?.abort.abort(); };
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
      await runner.start();
      while (!store.abort.signal.aborted) await runner.tick();
    } else {
      await store.start();
      const numeric = (value: string | undefined): number => {
        if (!value || !/^[1-9][0-9]*$/.test(value)) fail('Invalid numeric pairing identifier.');
        return telegramId.parse(Number(value));
      };
      if (args[0] !== 'pair') fail('Invalid Telegram operator command.');
      if (args[1] === 'issue' && args.length === 4) {
        const challenge = await store.issue(numeric(args[3]), args[2]!);
        // Deliberate local secret display; never written to logs or ordinary Telegram replies.
        console.log(`One-time pairing challenge (expires in five minutes): /start ${challenge}`);
      } else if (args[1] === 'show' && args.length === 2) console.log(JSON.stringify(await store.inspectPairing()));
      else if (args[1] === 'confirm' && args.length === 5) {
        await store.confirm(numeric(args[2]), numeric(args[3]), numeric(args[4])); console.log('Pairing activated for the configured identity and project.');
      } else if (args[1] === 'revoke' && args.length === 2) { await store.revoke(); console.log('Pairing revoked.'); }
      else fail('Invalid Telegram operator command.');
    }
  }
} catch {
  if (!stopping) {
    console.error('Telegram operation failed. Check trusted configuration, membership, pairing state, transport availability, and bounded retention. Sensitive details are withheld.');
    process.exitCode = 1;
  }
} finally {
  try { await store?.close(); } catch { console.error('Telegram database session cleanup failed.'); process.exitCode = 1; }
}
