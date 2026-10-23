import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from 'pg';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { TelegramStore } from '../../src/adapters/postgres/telegram-store.js';
import { TelegramRunner } from '../../src/runtime/telegram.js';
import { TelegramApiError, type TelegramApi } from '../../src/ports/telegram-api.js';
import { PostgresWorkItemStore } from '../../src/adapters/postgres/work-item-store.js';
const url = (role: string) => `postgres://${role}:synthetic-local-runtime-only@127.0.0.1:55432/agentic_factory_local`;
const migrationUrl = process.env.FACTORY_MIGRATION_URL ?? 'postgres://af_migrator:synthetic-local-migration-only@127.0.0.1:55432/agentic_factory_local';
const inst = 'synthetic-telegram';
const user = 900002;
const botId = 900001;
const message = (id: number, text = '/help', actor = user, chat = user) => ({ update_id: id, message: { message_id: id+1, date: 1792600000, from: { id: actor, is_bot: false }, chat: { id: chat, type: 'private' }, text } });
const request = '/new {"objective":"Synthetic request","context":"Record only, no execution."}';
class FakeApi implements TelegramApi {
  botId = botId; webhook = false; batches: unknown[][] = []; sent: string[] = []; offsets: number[] = []; failures = 0; ambiguous = false;
  async identity(): Promise<number> { return this.botId; }
  async hasWebhook(): Promise<boolean> { return this.webhook; }
  async updates(offset: number): Promise<unknown[]> {
    this.offsets.push(offset);
    if (this.failures-- > 0) throw new TelegramApiError('transient');
    return this.batches.shift() ?? [];
  }
  async send(_chat: number, body: string): Promise<void> {
    this.sent.push(body);
    if (this.ambiguous) throw new TelegramApiError('transient');
  }
}
async function fixture(project = 'synthetic-software-project') {
  const db = new Client({ connectionString: migrationUrl }); await db.connect();
  // Only this synthetic installation and its dedicated actor's records are reset.
  try {
  await db.query('BEGIN');
  await db.query(`DELETE FROM factory.telegram_outbox WHERE installation_id=$1;
  `, [inst]);
  await db.query('DELETE FROM factory.telegram_updates WHERE installation_id=$1',[inst]);
  await db.query('DELETE FROM factory.telegram_pairings WHERE installation_id=$1',[inst]);
  await db.query('INSERT INTO factory.telegram_pairings (installation_id) VALUES ($1)',[inst]);
  await db.query('DELETE FROM factory.telegram_polling WHERE installation_id=$1',[inst]);
  await db.query('INSERT INTO factory.telegram_polling (installation_id) VALUES ($1)',[inst]);
  const ids = (await db.query<{ id: string }>("SELECT id FROM factory.intake_revisions WHERE actor='af_telegram_bot'")).rows.map(r => r.id);
  await db.query('DELETE FROM factory.intake_receipts WHERE id=ANY($1::text[])',[ids]);
  await db.query('DELETE FROM factory.intake_revisions WHERE id=ANY($1::text[])',[ids]);
  await db.query('DELETE FROM factory.intake_heads WHERE id=ANY($1::text[])',[ids]);
  await db.query("DELETE FROM factory.memberships WHERE database_role IN ('af_telegram_bot','af_telegram_admin')");
  await db.query("INSERT INTO factory.memberships VALUES ('af_telegram_bot','synthetic-org-a',$1,'synthetic-owner',true,false),('af_telegram_admin','synthetic-org-a',$1,'synthetic-owner',true,false)",[project]);
  await db.query('UPDATE factory.telegram_installations SET project_id=$2 WHERE id=$1',[inst,project]);
  await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); await db.end(); throw error; }
  const bot = new TelegramStore(url('af_telegram_bot'),inst,'af_telegram_bot','bot');
  const admin = new TelegramStore(url('af_telegram_admin'),inst,'af_telegram_admin','admin'); await admin.start();
  return { db, bot, admin, async close() { await bot.close(); await admin.close(); await db.end(); } };
}
async function pair(f: Awaited<ReturnType<typeof fixture>>, id = 1) {
  const project = (await f.db.query<{project_id:string}>('SELECT project_id FROM factory.telegram_installations WHERE id=$1',[inst])).rows[0]!.project_id;
  const code = await f.admin.issue(user, project);
  await f.bot.capture([message(id, `/start ${code}`)]); await f.bot.processOne();
  const pending = await f.admin.inspectPairing(); assert.equal(pending.state,'pending');
  await f.admin.confirm(user,user,pending.generation);
}
async function count(f: Awaited<ReturnType<typeof fixture>>) { return (await f.db.query("SELECT count(*)::int AS n FROM factory.intake_revisions WHERE actor='af_telegram_bot'")).rows[0].n as number; }
async function refill(f: Awaited<ReturnType<typeof fixture>>) { await f.db.query("UPDATE factory.telegram_polling SET tokens=3,command_times='{}',token_time=clock_timestamp() WHERE installation_id=$1",[inst]); }

test('AF-029 SQL roles cannot activate, grant identities, escape project scope, or execute work', async () => {
  const f = await fixture();
  try {
    await f.bot.start();
    for (const sql of ["UPDATE factory.telegram_pairings SET state='active',chat_id=900002", "UPDATE factory.telegram_pairings SET generation=2", "UPDATE factory.telegram_pairings SET state='revoked'", "UPDATE factory.telegram_pairings SET state='issued'", "UPDATE factory.telegram_installations SET expected_user=123", "INSERT INTO factory.memberships VALUES ('af_telegram_bot','synthetic-org-b','synthetic-software-project','synthetic-owner',true,true)", "SELECT * FROM factory.runs", "SELECT * FROM factory_queue.job", "SET ROLE af_telegram_admin"])
      await assert.rejects(f.bot.client.query(sql));
    await assert.rejects(f.admin.client.query('SELECT * FROM factory.intake_heads'));
    assert.equal((await f.bot.client.query("SELECT * FROM factory.intake_heads WHERE organization_id='synthetic-org-b'")).rowCount,0);
    const other = new Client({ connectionString: url('af_other') }); await other.connect();
    try {
      for (const table of ['telegram_installations','telegram_pairings','telegram_polling','telegram_updates','telegram_outbox']) assert.equal((await other.query(`SELECT * FROM factory.${table}`)).rowCount,0);
      for (const state of ['issued','pending','active','revoked']) await assert.rejects(other.query('UPDATE factory.telegram_pairings SET state=$1',[state]));
      await assert.rejects(other.query("INSERT INTO factory.telegram_pairings (installation_id) VALUES ('unauthorized')"));
    } finally { await other.end(); }
    const rls = await f.db.query("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace='factory'::regnamespace AND relname LIKE 'telegram_%' AND relkind='r'");
    assert.equal(rls.rowCount,5); assert.ok(rls.rows.every(r => r.relrowsecurity && r.relforcerowsecurity));
  } finally { await f.close(); }
});
test('AF-029 pairing requires expected identity, pending claim, local confirmation and single-use generation', async () => {
  const f = await fixture();
  try {
    await f.bot.start(); await assert.rejects(f.admin.issue(user+1,'synthetic-software-project'));
    const code = await f.admin.issue(user,'synthetic-software-project'); assert.match(code,/^[a-f0-9]{64}$/);
    const issued = await f.admin.inspectPairing(); assert.ok(issued.expires_at!.getTime()-Date.now()<=300000);
    assert.ok(!JSON.stringify(issued).includes(code)); assert.deepEqual(Object.keys(issued).sort(),['chat_id','expires_at','generation','state']);
    await assert.rejects(f.admin.confirm(user,user,issued.generation));
    await f.bot.capture([message(1,`/start ${code}`,user+1),message(2,request)]); assert.equal(await f.bot.processOne(),false);
    await f.bot.capture([message(3,`/start ${code}`)]); await f.bot.processOne();
    await assert.rejects(f.admin.confirm(user,user+1,issued.generation));
    await f.bot.capture([message(4,request)]); assert.equal(await f.bot.processOne(),false);
    await f.admin.confirm(user,user,issued.generation); await assert.rejects(f.admin.confirm(user,user,issued.generation));
    await f.admin.revoke(); await f.bot.capture([message(5,`/start ${code}`),message(6,request)]); assert.equal(await count(f),0);
    await pair(f,7); assert.ok((await f.admin.inspectPairing()).generation>issued.generation);
  } finally { await f.close(); }
});
test('AF-029 expired and incorrect challenges cannot activate pairing', async () => {
  const f = await fixture();
  try {
    await f.bot.start(); const code = await f.admin.issue(user,'synthetic-software-project');
    await f.bot.capture([message(1,`/start ${'a'.repeat(64)}`)]); await f.bot.processOne(); assert.equal((await f.admin.inspectPairing()).state,'issued');
    await f.admin.client.query("UPDATE factory.telegram_pairings SET expires_at=clock_timestamp()-interval '1 second' WHERE installation_id=$1",[inst]);
    await f.bot.capture([message(2,`/start ${code}`)]); await f.bot.processOne();
    assert.equal((await f.admin.inspectPairing()).state,'issued'); await assert.rejects(f.admin.confirm(user,user,1));
  } finally { await f.close(); }
});
for (const project of ['synthetic-software-project','synthetic-ml-project']) test(`AF-029 canonical ${project} intake, exact provenance, duplicate recovery, and no execution effects`, async () => {
  const f = await fixture(project);
  try {
    const before = (await f.db.query('SELECT (SELECT count(*) FROM factory.runs) AS runs,(SELECT count(*) FROM factory_queue.job) AS jobs')).rows;
    await f.bot.start(); await pair(f);
    const text = ' { "objective": "Synthetic test", "context": " Retain exactly " }\n';
    const update = message(2,`/new ${text}`); await f.bot.capture([update]);
    assert.equal(await count(f),0); await f.bot.processOne();
    await f.bot.capture([update]); assert.equal(await f.bot.processOne(),false); assert.equal(await count(f),1);
    const row = (await f.db.query("SELECT * FROM factory.intake_revisions WHERE actor='af_telegram_bot'")).rows[0];
    assert.equal(row.original.toString(),text); assert.equal(row.source_kind,'telegram'); assert.equal(row.project_id,project); assert.equal(row.actor,'af_telegram_bot');
    assert.equal((await f.db.query('SELECT payload FROM factory.telegram_updates WHERE update_id=2')).rows[0].payload.text,undefined);
    assert.deepEqual((await f.db.query('SELECT (SELECT count(*) FROM factory.runs) AS runs,(SELECT count(*) FROM factory_queue.job) AS jobs')).rows,before);
    await assert.rejects(f.bot.capture([message(2,request)]),/Conflicting/);
    const reply = await f.bot.prepareReply(); assert.ok(reply); assert.match(reply.body,/Execution has not been authorized/); assert.ok(!reply.body.includes('Retain exactly'));
  } finally { await f.close(); }
});
test('AF-029 revocation fences captured operations and pending replies; lost membership fails closed', async () => {
  const f = await fixture();
  try {
    await f.bot.start(); await pair(f); await f.bot.capture([message(2,request)]); await f.bot.processOne();
    await f.bot.capture([message(3,request)]); await f.admin.revoke(); await f.bot.processOne(); assert.equal(await count(f),1); assert.equal(await f.bot.prepareReply(),null);
    await pair(f,4); await f.bot.capture([message(5,request)]);
    await f.db.query("UPDATE factory.memberships SET can_write=false WHERE database_role='af_telegram_bot'");
    for (let n=0;n<3;n++) await f.bot.processOne(); assert.equal(await count(f),1);
    await assert.rejects(f.bot.capture([message(6,request)]),/membership/);
    assert.equal((await f.db.query('SELECT state FROM factory.telegram_updates WHERE update_id=5')).rows[0].state,'exhausted');
  } finally { await f.close(); }
});
test('AF-029 revocation serializes with an in-flight intake transaction', async () => {
  const f = await fixture();
  try {
    await f.bot.start(); await pair(f);
    const key=JSON.stringify(['synthetic-org-a','synthetic-software-project','af_telegram_bot','create','telegram:900001:2']);
    await f.db.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[key]);
    await f.bot.capture([message(2,request)]);
    const pid=(await f.bot.client.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    const adminPid=(await f.admin.client.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    const processing=f.bot.processOne();let revoking:Promise<void>|undefined;
    const waitBlocked=async(pid:number)=>{
      for(let n=0;n<100;n++){
        if((await f.db.query('SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type=\'Lock\'',[pid])).rowCount)return;
        await delay(5);
      }
      assert.fail('Expected synthetic transaction lock contention');
    };
    try {
      await waitBlocked(pid);revoking=f.admin.revoke();await waitBlocked(adminPid);
    } finally {
      await f.db.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);
      await processing;await revoking;
    }
    assert.equal(await count(f),1);assert.equal((await f.admin.inspectPairing()).state,'revoked');
    await f.bot.capture([message(3,request)]);assert.equal(await f.bot.processOne(),false);
  } finally { await f.close(); }
});
test('AF-029 receipt and WorkItem writes roll back together on outbox failure; retries exhaust', async () => {
  const f = await fixture();
  try {
    await f.bot.start(); await pair(f); await f.bot.capture([message(2,request)]);
    // A valid but conflicting synthetic outbox row causes the final insert to fail after intake.
    await f.db.query("INSERT INTO factory.telegram_outbox (installation_id,update_id,generation,chat_id,body) VALUES ($1,2,1,900002,'Synthetic collision')",[inst]);
    for(let n=0;n<3;n++) { await f.bot.processOne(); assert.equal(await count(f),0); }
    const row = (await f.db.query('SELECT attempts,state FROM factory.telegram_updates WHERE update_id=2')).rows[0]; assert.deepEqual(row,{attempts:3,state:'exhausted'});
    assert.equal((await f.db.query("SELECT count(*)::int AS n FROM factory.intake_receipts WHERE actor='af_telegram_bot'")).rows[0].n,0);
  } finally { await f.close(); }
});
test('AF-029 one poller, durable capture/restart, cursor discontinuity, and conflict rollback', async () => {
  const f = await fixture(); let restarted: TelegramStore | undefined;
  try {
    await f.bot.start(); await pair(f); const second = new TelegramStore(url('af_telegram_bot'),inst,'af_telegram_bot','bot');
    try { await assert.rejects(second.start(),/Another/); } finally { await second.close(); }
    await f.bot.capture([message(100,request)]); assert.equal(await f.bot.offset(),101); await f.bot.close();
    restarted = new TelegramStore(url('af_telegram_bot'),inst,'af_telegram_bot','bot'); await restarted.start(); await restarted.processOne(); assert.equal(await count(f),1);
    await restarted.capture([message(100,request)]); assert.equal(await restarted.processOne(),false);
    await f.db.query("UPDATE factory.telegram_polling SET last_received_at=clock_timestamp()-interval '8 days' WHERE installation_id=$1",[inst]);
    assert.equal(await restarted.offset(),0); await restarted.capture([message(20,request)]); assert.equal(await restarted.offset(),21); await restarted.processOne(); assert.equal(await count(f),2);
    await assert.rejects(restarted.capture([message(22,request),message(20,'/help')]),/Conflicting/);
    assert.equal(await restarted.offset(),21); assert.equal((await f.db.query('SELECT * FROM factory.telegram_updates WHERE update_id=22')).rowCount,0);
  } finally { await restarted?.close(); await f.close(); }
});
test('AF-029 fake transport rejects wrong bot and webhook without polling or mutation', async () => {
  for (const mode of ['bot','webhook']) {
    const f = await fixture(); const api = new FakeApi(); if(mode==='bot') api.botId++; else api.webhook=true;
    const runner = new TelegramRunner(f.bot,api,botId);
    try { await assert.rejects(runner.start()); assert.deepEqual(api.offsets,[]); assert.deepEqual(api.sent,[]); }
    finally { await f.close(); }
  }
});
test('AF-029 fake polling retries are bounded and errors never disclose transport secrets', async () => {
  const f = await fixture(); const api = new FakeApi(); api.failures=4; const delays:number[]=[];
  const runner = new TelegramRunner(f.bot,api,botId,async ms => {delays.push(ms);});
  try {
    await runner.start(); await assert.rejects(runner.tick(),TelegramApiError); assert.equal(api.offsets.length,3); assert.deepEqual(delays,[1000,2000]); assert.equal(await f.bot.offset(),0);
  } finally { await f.close(); }
});
test('AF-029 ambiguous outbox delivery may duplicate replies, never WorkItems, and exhausts retries', async () => {
  const f = await fixture(); const api = new FakeApi(); api.ambiguous=true; const runner=new TelegramRunner(f.bot,api,botId);
  try {
    await runner.start(); await pair(f); api.batches.push([message(2,request)]); await runner.tick(); assert.equal(await count(f),1);
    for(let n=0;n<3;n++) {
      await f.db.query("UPDATE factory.telegram_outbox SET next_attempt_at=clock_timestamp() WHERE installation_id=$1",[inst]); await runner.recover();
    }
    assert.equal(api.sent.length,3); assert.equal(await count(f),1); assert.equal(new Set(api.sent).size,1);
    assert.equal((await f.db.query('SELECT state FROM factory.telegram_outbox WHERE update_id=2')).rows[0].state,'exhausted');
  } finally { await f.close(); }
});
test('AF-029 rate limit bounds burst and rolling minute; unauthorized traffic creates no rows or replies', async () => {
  const f=await fixture();
  try {
    await f.bot.start(); await pair(f);
    await f.bot.capture(Array.from({length:20},(_,i)=>message(i+2,request,user+1))); assert.equal((await f.db.query('SELECT count(*)::int AS n FROM factory.telegram_updates')).rows[0].n,1);
    await f.bot.capture(Array.from({length:4},(_,i)=>message(i+30,request))); for(let n=0;n<4;n++)await f.bot.processOne(); assert.equal(await count(f),3);
    await f.db.query("UPDATE factory.telegram_polling SET tokens=3,command_times=array_fill(extract(epoch FROM clock_timestamp())::float8,ARRAY[10]) WHERE installation_id=$1",[inst]);
    await f.bot.capture([message(40,request)]); await f.bot.processOne(); assert.equal(await count(f),3);
  } finally {await f.close();}
});
test('AF-029 metadata-only status and stable bounded list never disclose request bodies',async()=>{
  const f=await fixture();
  try {
    await f.bot.start(); await pair(f);
    for(let n=0;n<12;n++){await refill(f);await f.bot.capture([message(2+n,request)]);await f.bot.processOne();}
    const store=new PostgresWorkItemStore(url('af_telegram_bot'));const scope={organizationId:'synthetic-org-a',projectId:'synthetic-software-project'};
    try {
      const first=await store.list(scope);assert.equal(first.length,10);assert.deepEqual(Object.keys(first[0]!).sort(),['id','revision']);
      const second=await store.list(scope,first[9]!.id);assert.ok(second.length>=2 && second.length<=10);assert.ok(second.every(x=>x.id>first[9]!.id));
      const expected=(await f.db.query('SELECT id,version FROM factory.intake_heads WHERE organization_id=$1 AND project_id=$2 ORDER BY id LIMIT 20',[scope.organizationId,scope.projectId])).rows.map(r=>({id:r.id,revision:`r${r.version}`}));
      assert.deepEqual([...first,...second],expected);
      assert.deepEqual(await store.list({...scope,organizationId:'synthetic-org-b'}),[]);
      await refill(f);await f.bot.capture([message(20,'/list'),message(21,`/status ${first[0]!.id}`),message(22,'/cancel')]);for(let n=0;n<3;n++)await f.bot.processOne();
      const bodies=(await f.db.query('SELECT body FROM factory.telegram_outbox WHERE update_id>=20')).rows.map(r=>r.body as string);
      assert.equal(bodies.length,3);assert.ok(bodies.every(x=>!x.includes('Synthetic request')&&!x.includes('Record only')));assert.ok(bodies.some(x=>x.includes('/cancel is unavailable')));
    } finally {await store.close();}
  } finally {await f.close();}
});
test('AF-029 storage bounds fail closed atomically rather than silently dropping receipts',async()=>{
  const f=await fixture();
  try {
    await f.bot.start();await pair(f);
    await f.db.query("INSERT INTO factory.telegram_updates (installation_id,update_id,digest,generation,payload,state) SELECT $1,n,repeat('a',64),1,'{}','done' FROM generate_series(2,1000) n",[inst]);
    await assert.rejects(f.bot.capture([message(1001,request)]),/retention/);assert.equal(await f.bot.offset(),2);
  } finally {await f.close();}
});
test('AF-029 session loss aborts polling before capture or reply delivery',async()=>{
  const f=await fixture();const api=new FakeApi();const runner=new TelegramRunner(f.bot,api,botId);
  try {
    await runner.start();await pair(f);
    const pid=(await f.bot.client.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    const ended=new Promise<void>(resolve=>f.bot.client.once('end',resolve));
    await f.db.query('SELECT pg_terminate_backend($1)',[pid]);await ended;
    assert.equal(f.bot.abort.signal.aborted,true);await assert.rejects(runner.tick());assert.deepEqual(api.offsets,[]);assert.deepEqual(api.sent,[]);assert.equal(await count(f),0);
  } finally {await f.close();}
});
test('AF-029 captured forbidden updates and malformed batches cannot produce work or replies',async()=>{
  const f=await fixture();
  try {
    await f.bot.start();await pair(f);
    const original=message(2,request);
    await f.bot.capture([
      {...original,message:{...original.message,forward_origin:{type:'user'}}},
      {update_id:3,edited_message:original.message}, {update_id:4,callback_query:{}},
      message(5,request,user,user+1),{...message(6,request),message:{...original.message,from:{id:user,is_bot:true}}},
      {...message(7,request),message:{...original.message,chat:{id:-1,type:'group'}}},
    ]);
    assert.equal(await f.bot.processOne(),false);assert.equal(await count(f),0);assert.equal(await f.bot.prepareReply(),null);assert.equal(await f.bot.offset(),8);
    await assert.rejects(f.bot.capture([message(8,request),{update_id:'invalid'}]));assert.equal(await f.bot.offset(),8);assert.equal(await f.bot.processOne(),false);
    await f.bot.capture([message(9,'/new {"objective":"Synthetic","context":"Test","ownerId":"forged"}')]);await f.bot.processOne();assert.equal(await count(f),0);
    assert.match((await f.bot.prepareReply())!.body,/invalid command/);
  } finally {await f.close();}
});
test('AF-029 loss of membership suppresses an already committed outbox reply',async()=>{
  const f=await fixture();
  try {
    await f.bot.start();await pair(f);await f.bot.capture([message(2,request)]);await f.bot.processOne();
    await f.db.query("DELETE FROM factory.memberships WHERE database_role='af_telegram_bot'");
    assert.equal(await f.bot.prepareReply(),null);assert.equal((await f.db.query('SELECT state FROM factory.telegram_outbox WHERE update_id=2')).rows[0].state,'revoked');
  } finally {await f.close();}
});
test('AF-029 standalone and caller-owned intake transactions retain SQL actor and rollback boundaries',async()=>{
  const f=await fixture();const store=new PostgresWorkItemStore(url('af_telegram_bot'));
  try {
    await f.bot.start();await pair(f);
    await f.bot.client.query('BEGIN');await store.ingestInTransaction(f.bot.client,{organizationId:'synthetic-org-a',projectId:'synthetic-software-project'},{kind:'create',key:'synthetic-rollback'},{kind:'telegram',bytes:Buffer.from('{"objective":"Synthetic","context":"Rollback"}')});await f.bot.client.query('ROLLBACK');assert.equal(await count(f),0);
    await assert.rejects(store.ingest({organizationId:'synthetic-org-b',projectId:'synthetic-software-project'},{kind:'create',key:'synthetic-cross-project'},{kind:'telegram',bytes:Buffer.from('{"objective":"Synthetic","context":"Denied"}')}));
    await assert.rejects(f.bot.client.query("INSERT INTO factory.intake_heads VALUES ('synthetic-org-b','synthetic-software-project','forged','synthetic-owner',1)"));
    await assert.rejects(f.bot.client.query("INSERT INTO factory.telegram_updates VALUES ('unconfigured',1,repeat('a',64),1,'{}','pending',0)"));
  } finally {await store.close();await f.close();}
});

for(const phase of ['captured','processed'])test(`AF-029 killed process recovers ${phase} update without duplicate intake`,async()=>{
  const f=await fixture();let restarted:TelegramStore|undefined;
  try {
    await f.bot.start();await pair(f);await f.bot.close();
    const worker=spawn(process.execPath,['.test-build/tests/helpers/telegram-crash.js',phase],{stdio:['ignore','pipe','pipe']});
    try {
      await new Promise<void>((resolve,reject)=>{
        let text='';const timer=setTimeout(()=>reject(new Error('Synthetic crash helper timed out')),5000);
        worker.stdout.on('data',(chunk:Buffer)=>{text+=chunk.toString();if(text.includes('SYNTHETIC_COMMIT_COMPLETE')){clearTimeout(timer);resolve();}});
        worker.once('exit',()=>{clearTimeout(timer);reject(new Error('Synthetic helper exited before commit'));});
      });
    } finally {worker.kill('SIGKILL');await once(worker,'exit');}
    restarted=new TelegramStore(url('af_telegram_bot'),inst,'af_telegram_bot','bot');await restarted.start();
    await restarted.processOne();assert.equal(await count(f),1);assert.equal(await restarted.processOne(),false);
    assert.equal((await f.db.query('SELECT state FROM factory.telegram_outbox WHERE update_id=100')).rows[0].state,'pending');
    assert.ok(await restarted.prepareReply());
  } finally {await restarted?.close();await f.close();}
});

test('AF-029 long polling holds no database transaction and session loss rejects returned updates',async()=>{
  const f=await fixture();const api=new FakeApi();const runner=new TelegramRunner(f.bot,api,botId);
  try {
    await runner.start();await pair(f);
    const pid=(await f.bot.client.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    api.updates=async()=>{
      assert.equal((await f.db.query('SELECT state FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0].state,'idle');
      const ended=new Promise<void>(resolve=>f.bot.client.once('end',resolve));
      await f.db.query('SELECT pg_terminate_backend($1)',[pid]);await ended;return [message(2,request)];
    };
    await assert.rejects(runner.tick());assert.equal(await count(f),0);assert.deepEqual(api.sent,[]);
    assert.equal((await f.db.query('SELECT next_offset FROM factory.telegram_polling WHERE installation_id=$1',[inst])).rows[0].next_offset,'2');
  } finally {await f.close();}
});
test('AF-029 reused update ID with a different Telegram message identity fails closed',async()=>{
  const f=await fixture();
  try {
    await f.bot.start();await pair(f);const update=message(2,request);await f.bot.capture([update]);await f.bot.processOne();
    await assert.rejects(f.bot.capture([{...update,message:{...update.message,message_id:999}}]),/Conflicting/);assert.equal(await count(f),1);
  } finally {await f.close();}
});

test('AF-029 enrollment-shaped messages never persist plaintext challenges in an active binding',async()=>{
  const f=await fixture();
  try {
    await f.bot.start();await pair(f);const code='b'.repeat(64);await f.bot.capture([message(2,`/start ${code}`)]);
    const payload=(await f.db.query('SELECT payload FROM factory.telegram_updates WHERE update_id=2')).rows[0].payload;
    assert.equal(payload.text,'/start');assert.match(payload.challengeHash,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(payload).includes(code));
    await f.bot.processOne();assert.equal((await f.admin.inspectPairing()).state,'active');assert.equal(await count(f),0);
  } finally {await f.close();}
});
test('AF-029 revocation during an in-flight reply prevents subsequent pending delivery',async()=>{
  const f=await fixture();const api=new FakeApi();const runner=new TelegramRunner(f.bot,api,botId);
  try {
    await runner.start();await pair(f);await f.bot.capture([message(2,request),message(3,request)]);
    await f.bot.processOne();await f.bot.processOne();
    api.send=async(_chat,body)=>{await f.admin.revoke();api.sent.push(body);};
    await runner.recover();assert.equal(api.sent.length,1);assert.equal(await count(f),2);
    assert.deepEqual((await f.db.query('SELECT state FROM factory.telegram_outbox ORDER BY update_id')).rows.map(r=>r.state),['sent','revoked']);
  } finally {await f.close();}
});
