import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { parseTelegramCommand, parseTelegramMessage } from '../src/core/telegram.js';
import { decodeTelegramResponse, HttpsTelegramApi } from '../src/adapters/telegram/https-api.js';
import { TelegramApiError } from '../src/ports/telegram-api.js';
const message = { message_id: 1, date: 1792600000, from: { id: 900002, is_bot: false }, chat: { id: 900002, type: 'private' }, text: '/help' };
test('AF-029 accepts only bounded original private human messages', () => {
  assert.ok(parseTelegramMessage({ update_id: 1, message }));
  for (const changed of [
    { chat: { id: -1, type: 'group' } }, { chat: { id: 1, type: 'channel' } }, { from: { id: 1, is_bot: true } },
    { forward_origin: {} }, { forward_from: {} }, { sender_chat: {} }, { via_bot: {} }, { text: 'x'.repeat(4001) }, { text: '\ud800' }, { forward_sender_name: 'Synthetic' },
  ]) assert.equal(parseTelegramMessage({ update_id: 1, message: { ...message, ...changed } }), null);
  for (const key of ['edited_message','callback_query','channel_post']) assert.equal(parseTelegramMessage({ update_id: 1, [key]: message }), null);
  for (const id of [-1, 1.5, Number.MAX_SAFE_INTEGER, '1']) assert.equal(parseTelegramMessage({ update_id: id, message }), null);
});
test('AF-029 strict JSON preserves exact decoded request bytes and rejects privilege fields', () => {
  const text = ' { "objective": "Synthetic ML", "context": "  Preserve whitespace  " }\n';
  const result = parseTelegramCommand(`/new ${text}`);
  assert.equal(result.kind, 'new');
  if (result.kind === 'new') { assert.equal(result.source.kind, 'telegram'); assert.equal(result.source.bytes.toString(), text); }
  for (const extra of ['organizationId','ownerId','projectId','role','approval','execution','compute','publication'])
    assert.equal(parseTelegramCommand(`/new ${JSON.stringify({ objective: 'Synthetic', context: 'Test', [extra]: 'forged' })}`).kind, 'invalid');
  for (const text of ['/new {', '/new []', '/new null', '/new {"objective":""}', '/status ../secret', '/list after ../secret', '/shell ls']) assert.equal(parseTelegramCommand(text).kind, 'invalid');
  assert.equal(parseTelegramCommand('/cancel').kind, 'cancel');
});
test('AF-029 transport envelopes are bounded, strict UTF-8, and redact secrets and API descriptions', () => {
  assert.deepEqual(decodeTelegramResponse(Buffer.from('{"ok":true,"result":[1]}'), 200), [1]);
  for (const [bytes, status] of [[Buffer.from('{"ok":false,"description":"PRIVATE_TOKEN"}'), 401], [Buffer.from([255]), 200], [Buffer.alloc(524289), 200], [Buffer.from('PRIVATE_TOKEN'), 502]] as const) {
    assert.throws(() => decodeTelegramResponse(bytes, status), (error: unknown) => error instanceof TelegramApiError && !String(error).includes('PRIVATE_TOKEN'));
  }
  assert.throws(() => decodeTelegramResponse(Buffer.from('{"ok":false,"parameters":{"retry_after":30}}'), 429), (error: unknown) => error instanceof TelegramApiError && error.kind === 'transient' && error.retryAfter === 30);
  assert.throws(() => decodeTelegramResponse(Buffer.from('{"ok":true}'), 302), TelegramApiError);
  assert.throws(() => new HttpsTelegramApi('PRIVATE_TOKEN'), (error: unknown) => !String(error).includes('PRIVATE_TOKEN'));
});
test('AF-029 optional transport has a fixed TLS endpoint and no execution or webhook mutation dependencies', () => {
  const transport = readFileSync('src/adapters/telegram/https-api.ts','utf8');
  assert.match(transport, /hostname: 'api.telegram.org'/); assert.match(transport, /rejectUnauthorized: true/);
  assert.doesNotMatch(transport, /deleteWebhook|setWebhook|rejectUnauthorized: false/);
  for (const path of ['src/runtime/telegram.ts','src/adapters/postgres/telegram-store.ts','src/cli/telegram.ts'])
    assert.doesNotMatch(readFileSync(path,'utf8'), /from ['"].*(?:queue|workflow-store|sandbox|agent-runtime)/);
});

test('AF-029 optional CLI help needs no token, network, database, or sandbox; errors are redacted',async()=>{
  const exec=promisify(execFile);
  const help=await exec(process.execPath,['.test-build/src/cli/telegram.js','--help'],{env:{PATH:process.env.PATH}});
  assert.match(help.stdout,/Optional Telegram adapter/);
  await assert.rejects(exec(process.execPath,['.test-build/src/cli/telegram.js','start'],{env:{PATH:process.env.PATH,FACTORY_TELEGRAM_CONFIG:'/private/SECRET_PATH/no-config.json',SECRET_TOKEN:'SECRET_TOKEN'}}),
    (error: unknown) => {
      assert.ok(error instanceof Error); assert.doesNotMatch(error.message,/SECRET_PATH|SECRET_TOKEN/);
      return 'code' in error && error.code === 1;
    });
});
