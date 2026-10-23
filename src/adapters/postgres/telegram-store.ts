import { randomBytes, createHash } from 'node:crypto';
import { Client } from 'pg';
import { z } from 'zod';
import { fail, validIdentifier } from '../../core/intake.js';
import { HELP, parseTelegramCommand, parseTelegramMessage, recorded, telegramId, updateId } from '../../core/telegram.js';
import { PostgresWorkItemStore } from './work-item-store.js';
import type { TelegramApiError } from '../../ports/telegram-api.js';

export type Installation = { id: string; bot_id: string; bot_role: string; admin_role: string; expected_user: string; organization_id: string; project_id: string; owner_id: string };
type Pairing = { generation: number; state: string; chat_id: string | null; expires_at: Date | null };
type StoredPayload = { userId: number; chatId: number; text: string; challengeHash?: string };
type PendingUpdate = { update_id: string; generation: number; payload: StoredPayload; attempts: number };
export type PendingReply = { update_id: string; generation: number; chat_id: string; body: string };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export class TelegramStore {
  readonly client: Client;
  private readonly intake: PostgresWorkItemStore;
  private installation?: Installation;
  private owned = false;
  private failed = false;
  private busy = false;
  private closing?: Promise<void>;
  readonly abort = new AbortController();
  constructor(url: string, private readonly id: string, private readonly principal: string, private readonly mode: 'bot' | 'admin') {
    validIdentifier(id); validIdentifier(principal);
    this.client = new Client({ connectionString: url, connectionTimeoutMillis: 5000, statement_timeout: 10000, idle_in_transaction_session_timeout: 10000 });
    this.intake = new PostgresWorkItemStore(url);
    this.client.on('end', () => { this.owned = false; this.abort.abort(); });
    this.client.on('error', () => { this.failed = true; this.owned = false; this.abort.abort(); });
  }
  async start(): Promise<Installation> {
    await this.client.connect();
    const role = (await this.client.query<{ actor: string; rolsuper: boolean; rolbypassrls: boolean; rolcreatedb: boolean; rolcreaterole: boolean }>(
      'SELECT session_user AS actor,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=session_user')).rows[0];
    if (!role || role.actor !== this.principal || role.rolsuper || role.rolbypassrls || role.rolcreatedb || role.rolcreaterole) fail('Telegram requires its configured non-privileged database identity.');
    const row = (await this.client.query<Installation>('SELECT * FROM factory.telegram_installations WHERE id=$1', [this.id])).rows[0];
    if (!row || row[this.mode === 'bot' ? 'bot_role' : 'admin_role'] !== this.principal) fail('Telegram installation is unavailable.');
    this.installation = row;
    await this.membership();
    if (this.mode === 'bot') {
      const lock = await this.client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [`telegram-poller:${row.bot_id}`]);
      if (!lock.rows[0]?.locked) fail('Another Telegram poller owns this bot.');
      this.owned = true;
    }
    return row;
  }
  private config(): Installation { return this.installation ?? fail('Telegram store is not initialized.'); }
  assertOwned(): void { if (!this.owned || this.failed || this.abort.signal.aborted) fail('Telegram poller ownership is unavailable.'); }
  private async membership(): Promise<void> {
    const i = this.config();
    const rows = (await this.client.query<{ organization_id: string; project_id: string; owner_id: string; can_write: boolean }>(
      'SELECT organization_id,project_id,owner_id,can_write FROM factory.memberships WHERE database_role=session_user')).rows;
    if (rows.length !== 1 || rows[0]!.organization_id !== i.organization_id || rows[0]!.project_id !== i.project_id || rows[0]!.owner_id !== i.owner_id || !rows[0]!.can_write) fail('Telegram project membership is unavailable.');
  }
  private async transaction<T>(body: () => Promise<T>): Promise<T> {
    if (this.mode === 'bot') this.assertOwned();
    if (this.failed || this.busy) fail('Telegram database session is unavailable or busy.');
    this.busy = true;
    try {
      await this.client.query('BEGIN');
      try { const result = await body(); await this.client.query('COMMIT'); return result; }
      catch (error) { await this.client.query('ROLLBACK'); throw error; }
    } finally { this.busy = false; }
  }
  private async pairing(): Promise<Pairing> {
    const row = (await this.client.query<Pairing>('SELECT * FROM factory.telegram_pairings WHERE installation_id=$1 FOR UPDATE', [this.id])).rows[0];
    if (!row) fail('Telegram pairing is unavailable.');
    return { generation: row.generation, state: row.state, chat_id: row.chat_id, expires_at: row.expires_at };
  }
  async issue(expectedUser: number, projectId: string): Promise<string> {
    const i = this.config();
    if (this.mode !== 'admin' || String(telegramId.parse(expectedUser)) !== i.expected_user || projectId !== i.project_id) fail('Pairing administration denied.');
    const code = randomBytes(32).toString('hex');
    await this.transaction(async () => {
      await this.membership(); await this.pairing();
      await this.client.query(`UPDATE factory.telegram_pairings SET generation=generation+1,state='issued',challenge_hash=$2,
        expires_at=clock_timestamp()+interval '5 minutes',chat_id=NULL,claimed_at=NULL WHERE installation_id=$1`, [this.id, hash(code)]);
    });
    return code;
  }
  async inspectPairing(): Promise<Pairing> {
    if (this.mode !== 'admin') fail('Pairing administration denied.');
    return this.transaction(async () => { await this.membership(); return this.pairing(); });
  }
  async confirm(userId: number, chatId: number, generation: number): Promise<void> {
    if (this.mode !== 'admin' || String(telegramId.parse(userId)) !== this.config().expected_user) fail('Pairing administration denied.');
    telegramId.parse(chatId);
    await this.transaction(async () => {
      await this.membership(); await this.pairing();
      const result = await this.client.query(`UPDATE factory.telegram_pairings SET state='active',challenge_hash=NULL
        WHERE installation_id=$1 AND state='pending' AND expires_at>clock_timestamp() AND chat_id=$2 AND generation=$3`, [this.id, chatId, generation]);
      if (result.rowCount !== 1) fail('Pairing confirmation is stale or unavailable.');
    });
  }
  async revoke(): Promise<void> {
    if (this.mode !== 'admin') fail('Pairing administration denied.');
    await this.transaction(async () => {
      await this.membership(); await this.pairing();
      await this.client.query("UPDATE factory.telegram_pairings SET state='revoked',generation=generation+1,challenge_hash=NULL,expires_at=NULL WHERE installation_id=$1", [this.id]);
    });
  }
  async offset(): Promise<number> {
    this.assertOwned();
    // A week without updates permits Telegram to choose a nonsequential ID. Probe from zero;
    // retained receipts still deduplicate old IDs and reject ambiguous conflicting reuse.
    const row = (await this.client.query<{ offset: string }>(`SELECT CASE WHEN last_received_at IS NULL OR
      last_received_at<=clock_timestamp()-interval '7 days' THEN 0 ELSE next_offset END AS offset
      FROM factory.telegram_polling WHERE installation_id=$1`, [this.id])).rows[0];
    return updateId.parse(Number(row?.offset));
  }
  async capture(updates: unknown[]): Promise<void> {
    if (updates.length > 20) fail('Telegram batch exceeds its bound.');
    await this.transaction(async () => {
      const pairing = await this.pairing();
      await this.membership();
      const i = this.config();
      const polling = (await this.client.query<{ probe: boolean }>(`SELECT last_received_at IS NULL OR last_received_at<=clock_timestamp()-interval '7 days' AS probe
        FROM factory.telegram_polling WHERE installation_id=$1 FOR UPDATE`, [this.id])).rows[0]!;
      let next = 0; let rejected = 0;
      for (const value of updates) {
        const id = z.object({ update_id: updateId }).parse(value).update_id;
        next = Math.max(next, id + 1);
        const message = parseTelegramMessage(value);
        const digest = hash(JSON.stringify(message ?? { updateId: id, unsupported: true }));
        const prior = (await this.client.query<{ digest: string }>('SELECT digest FROM factory.telegram_updates WHERE installation_id=$1 AND update_id=$2', [this.id,id])).rows[0];
        if (prior) { if (prior.digest !== digest) fail('Conflicting Telegram update identity; operator review required.'); continue; }
        if (!message || String(message.userId) !== i.expected_user) { rejected++; continue; }
        const command = parseTelegramCommand(message.text);
        const claim = command.kind === 'claim' && pairing.state === 'issued';
        if (!claim && (pairing.state !== 'active' || pairing.chat_id !== String(message.chatId))) { rejected++; continue; }
        // Enrollment secrets are hashed before durable storage; ordinary request text is private.
        const payload: StoredPayload = command.kind === 'claim' ?
          { userId: message.userId, chatId: message.chatId, text: '/start', challengeHash: hash(command.code) } :
          { userId: message.userId, chatId: message.chatId, text: message.text };
        await this.client.query('INSERT INTO factory.telegram_updates (installation_id,update_id,digest,generation,payload) VALUES ($1,$2,$3,$4,$5)', [this.id,id,digest,pairing.generation,payload]);
      }
      if (updates.length) await this.client.query(`UPDATE factory.telegram_polling SET next_offset=CASE WHEN $3 THEN $2 ELSE greatest(next_offset,$2) END,
        last_received_at=clock_timestamp(),rejected_count=least(rejected_count+$4,9007199254740991) WHERE installation_id=$1`, [this.id,next,polling.probe,rejected]);
    });
  }
  private async rateLimit(): Promise<boolean> {
    const row = (await this.client.query<{ command_times: number[]; tokens: number; now: number; elapsed: number }>(`SELECT command_times,tokens,
      extract(epoch FROM clock_timestamp())::double precision AS now,
      greatest(0,extract(epoch FROM clock_timestamp()-token_time))::double precision AS elapsed
      FROM factory.telegram_polling WHERE installation_id=$1 FOR UPDATE`, [this.id])).rows[0]!;
    const times = row.command_times.filter((time) => time > row.now - 60);
    const tokens = Math.min(3, row.tokens + row.elapsed / 6);
    if (times.length >= 10 || tokens < 1) return false;
    times.push(row.now);
    await this.client.query('UPDATE factory.telegram_polling SET command_times=$2,tokens=$3,token_time=clock_timestamp() WHERE installation_id=$1', [this.id,times,tokens-1]);
    return true;
  }
  async processOne(): Promise<boolean> {
    return this.transaction(async () => {
      const pair = await this.pairing();
      const row = (await this.client.query<PendingUpdate>("SELECT update_id,generation,payload,attempts FROM factory.telegram_updates WHERE installation_id=$1 AND state='pending' AND next_attempt_at<=clock_timestamp() ORDER BY update_id LIMIT 1 FOR UPDATE", [this.id])).rows[0];
      if (!row) return false;
      await this.client.query('UPDATE factory.telegram_updates SET attempts=attempts+1 WHERE installation_id=$1 AND update_id=$2', [this.id,row.update_id]);
      await this.client.query('SAVEPOINT telegram_operation');
      try {
        await this.membership();
        const i = this.config(); const p = row.payload;
        let body: string | undefined;
        if (row.generation === pair.generation && String(p.userId) === i.expected_user) {
          if (p.challengeHash && pair.state === 'issued') {
            await this.client.query(`UPDATE factory.telegram_pairings SET state='pending',chat_id=$2,claimed_at=clock_timestamp()
              WHERE installation_id=$1 AND challenge_hash=$3 AND expires_at>clock_timestamp() AND state='issued'`, [this.id,p.chatId,p.challengeHash]);
          } else if (pair.state === 'active' && pair.chat_id === String(p.chatId) && await this.rateLimit()) {
            const command = parseTelegramCommand(p.text);
            const scope = { organizationId: i.organization_id, projectId: i.project_id };
            if (command.kind === 'new') {
              const record = await this.intake.ingestInTransaction(this.client, scope, { kind: 'create', key: `telegram:${i.bot_id}:${row.update_id}` }, command.source);
              body = recorded(record.workItem.id, record.workItem.revision);
            } else if (command.kind === 'status') {
              try { const record = await this.intake.getInTransaction(this.client, scope, command.id); body = recorded(record.workItem.id, record.workItem.revision); }
              catch { body = 'Request is unavailable.'; }
            } else if (command.kind === 'list') {
              const items = await this.intake.listInTransaction(this.client, scope, command.after);
              body = items.length ? items.map((item) => `${item.id} ${item.revision}`).join('\n') : 'No recorded requests on this page.';
              if (items.length === 10) body += `\nNext: /list after ${items[9]!.id}`;
            } else body = command.kind === 'help' ? HELP : command.kind === 'cancel' ? '/cancel is unavailable. Intake does not authorize execution.' : 'Unsupported or invalid command. Use /help.';
          }
        }
        if (body) await this.client.query('INSERT INTO factory.telegram_outbox (installation_id,update_id,generation,chat_id,body) VALUES ($1,$2,$3,$4,$5)', [this.id,row.update_id,row.generation,row.payload.chatId,body]);
        await this.client.query("UPDATE factory.telegram_updates SET state='done',payload='{}',failure_kind=NULL WHERE installation_id=$1 AND update_id=$2", [this.id,row.update_id]);
      } catch {
        await this.client.query('ROLLBACK TO SAVEPOINT telegram_operation');
        // Do not retain error text: it may contain private request or database details.
        await this.client.query(`UPDATE factory.telegram_updates SET
          state=CASE WHEN attempts>=3 THEN 'exhausted' ELSE 'pending' END,
          payload=CASE WHEN attempts>=3 THEN '{}'::jsonb ELSE payload END,
          failure_kind='processing',
          next_attempt_at=clock_timestamp()+($3::int * interval '1 second')
          WHERE installation_id=$1 AND update_id=$2`, [this.id,row.update_id,row.attempts === 0 ? 60 : 300]);
      }
      return true;
    });
  }
  async prepareReply(): Promise<PendingReply | null> {
    return this.transaction(async () => {
      const pair = await this.pairing();
      const row = (await this.client.query<PendingReply>(`SELECT update_id,generation,chat_id,body FROM factory.telegram_outbox
        WHERE installation_id=$1 AND state='pending' AND next_attempt_at<=clock_timestamp() ORDER BY update_id LIMIT 1 FOR UPDATE`, [this.id])).rows[0];
      if (!row) return null;
      let authorized = pair.state === 'active' && pair.generation === row.generation && pair.chat_id === row.chat_id;
      try { await this.membership(); } catch { authorized = false; }
      if (!authorized) {
        await this.client.query("UPDATE factory.telegram_outbox SET state='revoked' WHERE installation_id=$1 AND update_id=$2", [this.id,row.update_id]); return null;
      }
      const changed = await this.client.query(`UPDATE factory.telegram_outbox SET attempts=attempts+1,next_attempt_at=clock_timestamp()+interval '60 seconds'
        WHERE installation_id=$1 AND update_id=$2 AND attempts<3 RETURNING attempts`, [this.id,row.update_id]);
      if (!changed.rowCount) { await this.client.query("UPDATE factory.telegram_outbox SET state='exhausted' WHERE installation_id=$1 AND update_id=$2", [this.id,row.update_id]); return null; }
      return row;
    });
  }
  async finishReply(id: string, error?: TelegramApiError): Promise<void> {
    await this.transaction(async () => {
      await this.client.query(`UPDATE factory.telegram_outbox SET state=CASE WHEN $3 THEN 'sent' WHEN attempts>=3 OR $4 THEN 'exhausted' ELSE 'pending' END,
        next_attempt_at=clock_timestamp()+($5::int * interval '1 second') WHERE installation_id=$1 AND update_id=$2`,
        [this.id,id,!error,error?.kind === 'permanent',Math.max(1,Math.min(3600,error?.retryAfter ?? 5))]);
    });
  }
  close(): Promise<void> {
    this.owned = false; this.abort.abort();
    this.closing ??= (async () => { try { await this.client.end(); } finally { await this.intake.close(); } })();
    return this.closing;
  }
}
