import { randomBytes, createHash } from 'node:crypto';
import { Client } from 'pg';
import { fail, validIdentifier } from '../../core/intake.js';
import { HELP, command as parseSlackCommand, parseMessage, recorded, userId, channelId, envelopeSchema, MAX_ENVELOPE_BYTES } from '../../core/slack.js';
import { PostgresWorkItemStore } from './work-item-store.js';
import type { SlackApiError } from '../../ports/slack-api.js';

export type Installation = { id: string; team_id:string; app_id:string; bot_user_id:string; bot_id: string; bot_role: string; admin_role: string; expected_user: string; organization_id: string; project_id: string; owner_id: string };
type Pairing = { generation: number; state: string; chat_id: string | null; expires_at: Date | null };
type StoredPayload = { userId: string; chatId: string; text: string; challengeHash?: string };
type PendingUpdate = { update_id: string; generation: number; payload: StoredPayload; attempts: number };
export type PendingReply = { update_id: string; generation: number; chat_id: string; body: string };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export class SlackStore {
  readonly client: Client;
  private readonly intake: PostgresWorkItemStore;
  private installation?: Installation;
  private owned = false;
  private failed = false;
  private readonly busy = new Set<Client>();
  private readonly captureClient: Client;
  private closing?: Promise<void>;
  readonly abort = new AbortController();
  constructor(url: string, private readonly id: string, private readonly principal: string, private readonly mode: 'bot' | 'admin') {
    validIdentifier(id); validIdentifier(principal);
    this.client = new Client({ connectionString: url, connectionTimeoutMillis: 5000, statement_timeout: 10000, idle_in_transaction_session_timeout: 10000 });
    this.captureClient = new Client({connectionString:url,connectionTimeoutMillis:5000,statement_timeout:2000,lock_timeout:1000,idle_in_transaction_session_timeout:3000});
    this.captureClient.on('error',()=>{this.failed=true;this.abort.abort();});
    this.captureClient.on('end',()=>{if(this.mode==='bot')this.abort.abort();});
    this.intake = new PostgresWorkItemStore(url);
    this.client.on('end', () => { this.owned = false; this.abort.abort(); });
    this.client.on('error', () => { this.failed = true; this.owned = false; this.abort.abort(); });
  }
  async start(): Promise<Installation> {
    await this.client.connect();
    const role = (await this.client.query<{ actor: string; rolsuper: boolean; rolbypassrls: boolean; rolcreatedb: boolean; rolcreaterole: boolean }>(
      'SELECT session_user AS actor,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=session_user')).rows[0];
    if (!role || role.actor !== this.principal || role.rolsuper || role.rolbypassrls || role.rolcreatedb || role.rolcreaterole) fail('Slack requires its configured non-privileged database identity.');
    const row = (await this.client.query<Installation>('SELECT * FROM factory.slack_installations WHERE id=$1', [this.id])).rows[0];
    if (!row || row[this.mode === 'bot' ? 'bot_role' : 'admin_role'] !== this.principal) fail('Slack installation is unavailable.');
    this.installation = row;
    await this.membership();
    if (this.mode === 'bot') {
      await this.captureClient.connect();
      const lock = await this.client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [`slack-adapter:${row.team_id}:${row.app_id}`]);
      if (!lock.rows[0]?.locked) fail('Another Slack adapter owns this bot.');
      this.owned = true;
    }
    return row;
  }
  private config(): Installation { return this.installation ?? fail('Slack store is not initialized.'); }
  assertOwned(): void { if (!this.owned || this.failed || this.abort.signal.aborted) fail('Slack adapter ownership is unavailable.'); }
  private async membership(client=this.client): Promise<void> {
    const i = this.config();
    const rows = (await client.query<{ organization_id: string; project_id: string; owner_id: string; can_write: boolean }>(
      'SELECT organization_id,project_id,owner_id,can_write FROM factory.memberships WHERE database_role=session_user')).rows;
    if (rows.length !== 1 || rows[0]!.organization_id !== i.organization_id || rows[0]!.project_id !== i.project_id || rows[0]!.owner_id !== i.owner_id || !rows[0]!.can_write) fail('Slack project membership is unavailable.');
  }
  private async transaction<T>(body: () => Promise<T>, client=this.client): Promise<T> {
    if (this.mode === 'bot') this.assertOwned();
    if (this.failed || this.busy.has(client)) fail('Slack database session is unavailable or busy.');
    this.busy.add(client);
    try {
      await client.query('BEGIN');
      try { const result = await body(); if(this.mode==='bot')this.assertOwned(); await client.query('COMMIT'); return result; }
      catch (error) { await client.query('ROLLBACK'); throw error; }
    } finally { this.busy.delete(client); }
  }
  private async pairing(client=this.client): Promise<Pairing> {
    const row = (await client.query<Pairing>('SELECT * FROM factory.slack_pairings WHERE installation_id=$1 FOR UPDATE', [this.id])).rows[0];
    if (!row) fail('Slack pairing is unavailable.');
    return { generation: row.generation, state: row.state, chat_id: row.chat_id, expires_at: row.expires_at };
  }
  async issue(expectedUser: string, projectId: string): Promise<string> {
    const i = this.config();
    if (this.mode !== 'admin' || userId.parse(expectedUser) !== i.expected_user || projectId !== i.project_id) fail('Pairing administration denied.');
    const code = randomBytes(32).toString('hex');
    await this.transaction(async () => {
      await this.membership(); await this.pairing();
      await this.client.query(`UPDATE factory.slack_pairings SET generation=generation+1,state='issued',challenge_hash=$2,
        expires_at=clock_timestamp()+interval '5 minutes',chat_id=NULL,claimed_at=NULL WHERE installation_id=$1`, [this.id, hash(code)]);
    });
    return code;
  }
  async inspectPairing(): Promise<Pairing> {
    if (this.mode !== 'admin') fail('Pairing administration denied.');
    return this.transaction(async () => { await this.membership(); return this.pairing(); });
  }
  async confirm(actorId: string, chatId: string, generation: number): Promise<void> {
    if (this.mode !== 'admin' || userId.parse(actorId) !== this.config().expected_user) fail('Pairing administration denied.');
    channelId.parse(chatId);
    await this.transaction(async () => {
      await this.membership(); await this.pairing();
      const result = await this.client.query(`UPDATE factory.slack_pairings SET state='active',challenge_hash=NULL
        WHERE installation_id=$1 AND state='pending' AND expires_at>clock_timestamp() AND chat_id=$2 AND generation=$3`, [this.id, chatId, generation]);
      if (result.rowCount !== 1) fail('Pairing confirmation is stale or unavailable.');
    });
  }
  async revoke(): Promise<void> {
    if (this.mode !== 'admin') fail('Pairing administration denied.');
    await this.transaction(async () => {
      await this.membership(); await this.pairing();
      await this.client.query("UPDATE factory.slack_pairings SET state='revoked',generation=generation+1,challenge_hash=NULL,expires_at=NULL WHERE installation_id=$1", [this.id]);
    });
  }
  async capture(value: unknown): Promise<string> {
    if(Buffer.byteLength(JSON.stringify(value)??'')>MAX_ENVELOPE_BYTES)fail('Slack envelope exceeds its bound.');
    const envelope=envelopeSchema.parse(value);
    const i=this.config(); const p=envelope.payload;
    if(p.team_id!==i.team_id||p.api_app_id!==i.app_id||p.authorizations[0]!.team_id!==i.team_id||p.authorizations[0]!.user_id!==i.bot_user_id) fail('Slack installation identity mismatch.');
    const message=parseMessage(p.event);
    const client=this.captureClient;
    await this.transaction(async()=>{
      const pair=await this.pairing(client);await this.membership(client);
      const digest=hash(JSON.stringify(message ? {team:p.team_id,app:p.api_app_id,id:p.event_id,user:message.user,channel:message.channel,text:message.text,ts:message.ts} : {id:p.event_id,rejected:true}));
      const prior=(await client.query<{digest:string}>('SELECT digest FROM factory.slack_updates WHERE installation_id=$1 AND update_id=$2',[this.id,p.event_id])).rows[0];
      if(prior){if(prior.digest!==digest)fail('Conflicting Slack event identity; operator review required.');return;}
      const cmd=message?parseSlackCommand(message.text):null;
      const claim=cmd?.kind==='claim'&&pair.state==='issued';
      if(!message||message.user!==i.expected_user||(!claim&&(pair.state!=='active'||pair.chat_id!==message.channel))){
        await client.query('UPDATE factory.slack_pairings SET rejected_count=least(rejected_count+1,9007199254740991) WHERE installation_id=$1',[this.id]);return;
      }
      const payload:StoredPayload=cmd?.kind==='claim'?{userId:message.user,chatId:message.channel,text:'pair',challengeHash:hash(cmd.code)}:{userId:message.user,chatId:message.channel,text:message.text};
      await client.query('INSERT INTO factory.slack_updates (installation_id,update_id,digest,generation,payload) VALUES ($1,$2,$3,$4,$5)',[this.id,p.event_id,digest,pair.generation,payload]);
    },client);
    return envelope.envelope_id;
  }
  private async rateLimit(): Promise<boolean> {
    const row = (await this.client.query<{ command_times: number[]; tokens: number; now: number; elapsed: number }>(`SELECT command_times,tokens,
      extract(epoch FROM clock_timestamp())::double precision AS now,
      greatest(0,extract(epoch FROM clock_timestamp()-token_time))::double precision AS elapsed
      FROM factory.slack_pairings WHERE installation_id=$1 FOR UPDATE`, [this.id])).rows[0]!;
    const times = row.command_times.filter((time) => time > row.now - 60);
    const tokens = Math.min(3, row.tokens + row.elapsed / 6);
    if (times.length >= 10 || tokens < 1) return false;
    times.push(row.now);
    await this.client.query('UPDATE factory.slack_pairings SET command_times=$2,tokens=$3,token_time=clock_timestamp() WHERE installation_id=$1', [this.id,times,tokens-1]);
    return true;
  }
  async processOne(): Promise<boolean> {
    return this.transaction(async () => {
      const pair = await this.pairing();
      const row = (await this.client.query<PendingUpdate>("SELECT update_id,generation,payload,attempts FROM factory.slack_updates WHERE installation_id=$1 AND state='pending' AND next_attempt_at<=clock_timestamp() ORDER BY update_id LIMIT 1 FOR UPDATE", [this.id])).rows[0];
      if (!row) return false;
      await this.client.query('UPDATE factory.slack_updates SET attempts=attempts+1 WHERE installation_id=$1 AND update_id=$2', [this.id,row.update_id]);
      await this.client.query('SAVEPOINT slack_operation');
      try {
        await this.membership();
        const i = this.config(); const p = row.payload;
        let body: string | undefined;
        if (row.generation === pair.generation && String(p.userId) === i.expected_user) {
          if (p.challengeHash && pair.state === 'issued') {
            await this.client.query(`UPDATE factory.slack_pairings SET state='pending',chat_id=$2,claimed_at=clock_timestamp()
              WHERE installation_id=$1 AND challenge_hash=$3 AND expires_at>clock_timestamp() AND state='issued'`, [this.id,p.chatId,p.challengeHash]);
          } else if (pair.state === 'active' && pair.chat_id === String(p.chatId) && await this.rateLimit()) {
            const command = parseSlackCommand(p.text);
            const scope = { organizationId: i.organization_id, projectId: i.project_id };
            if (command.kind === 'new') {
              const record = await this.intake.ingestInTransaction(this.client, scope, { kind: 'create', key: `slack:${hash(JSON.stringify([i.team_id,i.app_id,row.update_id]))}` }, command.source);
              body = recorded(record.workItem.id, record.workItem.revision);
            } else if (command.kind === 'status') {
              try { const record = await this.intake.getInTransaction(this.client, scope, command.id); body = recorded(record.workItem.id, record.workItem.revision); }
              catch { body = 'Request is unavailable.'; }
            } else if (command.kind === 'list') {
              const items = await this.intake.listInTransaction(this.client, scope, command.after);
              body = items.length ? items.map((item) => `${item.id} ${item.revision}`).join('\n') : 'No recorded requests on this page.';
              if (items.length === 10) body += `\nNext: list after ${items[9]!.id}`;
            } else body = command.kind === 'help' ? HELP : command.kind === 'cancel' ? 'cancel is unavailable. Intake does not authorize execution.' : 'Unsupported or invalid command. Use help.';
          }
        }
        if (body) await this.client.query('INSERT INTO factory.slack_outbox (installation_id,update_id,generation,chat_id,body) VALUES ($1,$2,$3,$4,$5)', [this.id,row.update_id,row.generation,row.payload.chatId,body]);
        await this.client.query("UPDATE factory.slack_updates SET state='done',payload='{}',failure_kind=NULL WHERE installation_id=$1 AND update_id=$2", [this.id,row.update_id]);
      } catch {
        await this.client.query('ROLLBACK TO SAVEPOINT slack_operation');
        // Do not retain error text: it may contain private request or database details.
        await this.client.query(`UPDATE factory.slack_updates SET
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
      if(!(await this.client.query('SELECT 1 FROM factory.slack_pairings WHERE installation_id=$1 AND next_send_at<=clock_timestamp()',[this.id])).rowCount)return null;
      const row = (await this.client.query<PendingReply>(`SELECT update_id,generation,chat_id,body FROM factory.slack_outbox
        WHERE installation_id=$1 AND state='pending' AND next_attempt_at<=clock_timestamp() ORDER BY update_id LIMIT 1 FOR UPDATE`, [this.id])).rows[0];
      if (!row) return null;
      let authorized = pair.state === 'active' && pair.generation === row.generation && pair.chat_id === row.chat_id;
      try { await this.membership(); } catch { authorized = false; }
      if (!authorized) {
        await this.client.query("UPDATE factory.slack_outbox SET state='revoked' WHERE installation_id=$1 AND update_id=$2", [this.id,row.update_id]); return null;
      }
      const changed = await this.client.query(`UPDATE factory.slack_outbox SET attempts=attempts+1,next_attempt_at=clock_timestamp()+interval '60 seconds'
        WHERE installation_id=$1 AND update_id=$2 AND attempts<3 RETURNING attempts`, [this.id,row.update_id]);
      if (!changed.rowCount) { await this.client.query("UPDATE factory.slack_outbox SET state='exhausted' WHERE installation_id=$1 AND update_id=$2", [this.id,row.update_id]); return null; }
      await this.client.query("UPDATE factory.slack_pairings SET next_send_at=clock_timestamp()+interval '1 second' WHERE installation_id=$1",[this.id]);
      return row;
    });
  }
  async finishReply(id: string, error?: SlackApiError): Promise<void> {
    await this.transaction(async () => {
      await this.pairing();
      if(error)await this.client.query("UPDATE factory.slack_pairings SET next_send_at=greatest(next_send_at,clock_timestamp()+($2::int * interval '1 second')) WHERE installation_id=$1",[this.id,Math.max(5,error.retryAfter)]);
      await this.client.query(`UPDATE factory.slack_outbox SET state=CASE WHEN $3 THEN 'sent' WHEN attempts>=3 OR $4 THEN 'exhausted' ELSE 'pending' END,
        next_attempt_at=clock_timestamp()+($5::int * interval '1 second') WHERE installation_id=$1 AND update_id=$2`,
        [this.id,id,!error,error?.kind === 'permanent',Math.max(1,Math.min(3600,error?.retryAfter ?? 5))]);
    });
  }
  close(): Promise<void> {
    this.owned = false; this.abort.abort();
    this.closing ??= (async () => { try { await this.client.end(); } finally { await this.captureClient.end(); await this.intake.close(); } })();
    return this.closing;
  }
}
