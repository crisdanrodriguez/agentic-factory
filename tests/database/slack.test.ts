import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from 'pg';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { SlackStore } from '../../src/adapters/postgres/slack-store.js';
import { SlackRunner } from '../../src/runtime/slack.js';
import { SlackApiError,type SlackApi,type SlackSocket } from '../../src/ports/slack-api.js';
const inst='synthetic-slack';
const url=(role:string)=>`postgres://${role}:synthetic-local-runtime-only@127.0.0.1:55432/agentic_factory_local`;
const event=(id='EvTEST',text='help',user='UHUMAN',channel='DTEST')=>({type:'events_api',envelope_id:`envelope-${id}`,accepts_response_payload:false,payload:{type:'event_callback',team_id:'TTEST',api_app_id:'ATEST',event_id:id,event_time:1792600000,is_ext_shared_channel:false,authorizations:[{team_id:'TTEST',user_id:'UBOT',is_bot:true,is_enterprise_install:false}],event:{type:'message',channel_type:'im',user,channel,text,ts:'1792600000.000001'}}});
const request='new {"objective":"Synthetic software","context":"No execution"}';
class FakeApi implements SlackApi {
 sends:string[]=[];failure:SlackApiError|undefined;
 async identity(){return {teamId:'TTEST',botId:'BTEST',userId:'UBOT'};}
 async open(){return 'wss://wss-primary.slack.com/link/?ticket=synthetic';}
 async send(_channel:string,text:string){this.sends.push(text);if(this.failure)throw this.failure;}
}
class FakeSocket implements SlackSocket {
 acks:string[]=[];closed=false;
 constructor(readonly values:unknown[]){}
 async next(){if(!this.values.length)throw new SlackApiError('transient');return this.values.shift();}
 async ack(id:string){this.acks.push(id);}
 close(){this.closed=true;}
}
const hello={type:'hello',connection_info:{app_id:'ATEST'}};
const disconnect={type:'disconnect',reason:'refresh_requested'};
async function fixture(project='synthetic-software-project'){
 const db=new Client({connectionString:process.env.FACTORY_MIGRATION_URL??'postgres://af_migrator:synthetic-local-migration-only@127.0.0.1:55432/agentic_factory_local'});await db.connect();
 await db.query('BEGIN');
 try{
 for(const t of ['slack_outbox','slack_updates','slack_pairings'])await db.query(`DELETE FROM factory.${t} WHERE installation_id=$1`,[inst]);
 const ids=(await db.query<{id:string}>("SELECT id FROM factory.intake_revisions WHERE actor='af_slack_bot'")).rows.map(r=>r.id);
 for(const t of ['intake_receipts','intake_revisions','intake_heads'])await db.query(`DELETE FROM factory.${t} WHERE id=ANY($1::text[])`,[ids]);
 await db.query("DELETE FROM factory.memberships WHERE database_role IN ('af_slack_bot','af_slack_admin')");
 await db.query("INSERT INTO factory.memberships VALUES ('af_slack_bot','synthetic-org-a',$1,'synthetic-owner',true,false),('af_slack_admin','synthetic-org-a',$1,'synthetic-owner',true,false)",[project]);
 await db.query('UPDATE factory.slack_installations SET project_id=$2 WHERE id=$1',[inst,project]);
 await db.query('INSERT INTO factory.slack_pairings (installation_id) VALUES ($1)',[inst]);await db.query('COMMIT');
 }catch(e){await db.query('ROLLBACK');await db.end();throw e;}
 const bot=new SlackStore(url('af_slack_bot'),inst,'af_slack_bot','bot');const admin=new SlackStore(url('af_slack_admin'),inst,'af_slack_admin','admin');await admin.start();
 return {db,bot,admin,project,async close(){await bot.close();await admin.close();await db.end();}};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function pair(f:Fixture){const code=await f.admin.issue('UHUMAN',f.project);await f.bot.capture(event('EvPAIR',`pair ${code}`));await f.bot.processOne();const p=await f.admin.inspectPairing();assert.equal(p.state,'pending');await f.admin.confirm('UHUMAN','DTEST',p.generation);}
async function count(f:Fixture){return (await f.db.query("SELECT count(*)::int AS n FROM factory.intake_revisions WHERE actor='af_slack_bot'")).rows[0].n as number;}
async function due(f:Fixture){await f.db.query("UPDATE factory.slack_updates SET next_attempt_at=clock_timestamp() WHERE installation_id=$1;",[inst]);await f.bot.client.query("UPDATE factory.slack_pairings SET tokens=3,command_times='{}',next_send_at=clock_timestamp() WHERE installation_id=$1",[inst]);await f.db.query('UPDATE factory.slack_outbox SET next_attempt_at=clock_timestamp() WHERE installation_id=$1',[inst]);}

test('AF-031 SQL roles, forced RLS and project isolation preserve intake authority',async()=>{
 const f=await fixture();try{await f.bot.start();
 const rows=(await f.db.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace='factory'::regnamespace AND relkind='r' AND relname LIKE 'slack_%'")).rows;assert.equal(rows.length,4);assert.ok(rows.every(r=>r.relrowsecurity&&r.relforcerowsecurity));
 for(const sql of ["UPDATE factory.slack_pairings SET state='active',chat_id='DTEST'","UPDATE factory.slack_pairings SET state='issued'","UPDATE factory.slack_installations SET expected_user='UOTHER'","INSERT INTO factory.memberships VALUES ('af_slack_bot','synthetic-org-b','synthetic-software-project','synthetic-owner',true,true)","SELECT * FROM factory.runs","SELECT * FROM factory_queue.job","SET ROLE af_slack_admin"])await assert.rejects(f.bot.client.query(sql));
 await assert.rejects(f.admin.client.query('SELECT * FROM factory.intake_heads'));
 assert.equal((await f.bot.client.query("SELECT * FROM factory.intake_heads WHERE organization_id='synthetic-org-b'")).rowCount,0);
 const other=new Client({connectionString:url('af_other')});await other.connect();try{for(const table of ['slack_installations','slack_pairings','slack_updates','slack_outbox']){assert.equal((await other.query(`SELECT * FROM factory.${table}`)).rowCount,0);await assert.rejects(other.query(`DELETE FROM factory.${table}`));}}finally{await other.end();}
 }finally{await f.close();}
});
test('AF-031 short-lived pairing requires pending claim and exact local confirmation',async()=>{
 const f=await fixture();try{await f.bot.start();await assert.rejects(f.bot.issue('UHUMAN',f.project));await assert.rejects(f.admin.issue('UOTHER',f.project));
 const code=await f.admin.issue('UHUMAN',f.project);assert.match(code,/^[a-f0-9]{64}$/);
 await f.bot.capture(event('EvPAIR',`pair ${code}`));assert.ok(!(await f.db.query('SELECT payload::text FROM factory.slack_updates')).rows[0].payload.includes(code));
 await f.bot.processOne();assert.equal((await f.admin.inspectPairing()).state,'pending');await f.bot.capture(event('EvBEFORE',request));assert.equal(await f.bot.processOne(),false);
 const p=await f.admin.inspectPairing();await assert.rejects(f.admin.confirm('UHUMAN','DOTHER',p.generation));await f.admin.confirm('UHUMAN','DTEST',p.generation);await assert.rejects(f.admin.confirm('UHUMAN','DTEST',p.generation));assert.equal(await count(f),0);
 }finally{await f.close();}
});
test('AF-031 expired pairing and untrusted identity are denied',async()=>{
 const f=await fixture();try{await f.bot.start();const code=await f.admin.issue('UHUMAN',f.project);await f.admin.client.query("UPDATE factory.slack_pairings SET expires_at=clock_timestamp()-interval '1 second'");await f.bot.capture(event('EvPAIR',`pair ${code}`));await f.bot.processOne();assert.equal((await f.admin.inspectPairing()).state,'issued');await assert.rejects(f.admin.confirm('UHUMAN','DTEST',1));
 for(const e of [event('EvOTHER',request,'UOTHER'),event('EvBOT',request,'UBOT')])await f.bot.capture(e);assert.equal(await count(f),0);
 }finally{await f.close();}
});
for(const project of ['synthetic-software-project','synthetic-ml-project'])test(`AF-031 canonical ${project} intake and metadata commands have no execution effects`,async()=>{
 const f=await fixture(project);try{await f.bot.start();await pair(f);
 const before=(await f.db.query('SELECT count(*)::int AS n FROM factory.runs')).rows[0].n;
 const jobs=(await f.db.query('SELECT count(*)::int AS n FROM factory_queue.job')).rows[0].n;
 await f.bot.capture(event('EvNEW',request));await f.bot.processOne();const row=(await f.db.query("SELECT id,source_kind,original FROM factory.intake_revisions WHERE actor='af_slack_bot'")).rows[0];assert.equal(row.source_kind,'slack');assert.equal(row.original.toString(),request.slice(4));
 for(const [id,text]of [['EvHELP','help'],['EvSTATUS',`status ${row.id}`],['EvLIST','list'],['EvCANCEL','cancel']]){await due(f);await f.bot.capture(event(id,text));await f.bot.processOne();}
 const bodies=(await f.db.query('SELECT body FROM factory.slack_outbox')).rows.map(r=>r.body).join('\n');assert.ok(bodies.includes(row.id));assert.ok(bodies.includes('cancel is unavailable'));assert.ok(!bodies.includes('Synthetic software'));assert.equal(await count(f),1);
 assert.equal((await f.db.query('SELECT count(*)::int AS n FROM factory.runs')).rows[0].n,before);assert.equal((await f.db.query('SELECT count(*)::int AS n FROM factory_queue.job')).rows[0].n,jobs);
 }finally{await f.close();}
});
test('AF-031 cross-workspace, app and authorization envelope attacks fail closed',async()=>{
 const f=await fixture();try{await f.bot.start();await pair(f);
 for(const mutate of [(e:ReturnType<typeof event>)=>{e.payload.team_id='TOTHER';},(e:ReturnType<typeof event>)=>{e.payload.api_app_id='AOTHER';},(e:ReturnType<typeof event>)=>{e.payload.authorizations[0]!.user_id='UOTHER';},(e:ReturnType<typeof event>)=>{e.payload.is_ext_shared_channel=true;}]){const e=event();mutate(e);await assert.rejects(f.bot.capture(e));}
 assert.equal(await count(f),0);
 }finally{await f.close();}
});
test('AF-031 duplicate stable event IDs deduplicate across envelope IDs; conflicts stop',async()=>{
 const f=await fixture();try{await f.bot.start();await pair(f);await f.bot.capture(event('EvNEW',request));await f.bot.processOne();const duplicate=event('EvNEW',request);duplicate.envelope_id='different-delivery';await f.bot.capture(duplicate);assert.equal(await f.bot.processOne(),false);assert.equal(await count(f),1);await assert.rejects(f.bot.capture(event('EvNEW','help')),/Conflicting/);
 }finally{await f.close();}
});
test('AF-031 acknowledgment follows committed capture and precedes WorkItem processing',async()=>{
 const f=await fixture();try{const api=new FakeApi();const runner=new SlackRunner(f.bot,api,async()=>{throw Error();});await runner.start();await pair(f);
 const socket=new FakeSocket([hello,event('EvNEW',request),disconnect]);socket.ack=async(id)=>{assert.equal((await f.db.query("SELECT count(*)::int AS n FROM factory.slack_updates WHERE update_id='EvNEW'")).rows[0].n,1);assert.equal(await count(f),0);socket.acks.push(id);};await runner.receive(socket);assert.equal(socket.acks.length,1);await runner.recover();assert.equal(await count(f),1);
 }finally{await f.close();}
});
test('AF-031 failed capture never acknowledges; retention does not discard evidence',async()=>{
 const f=await fixture();try{const runner=new SlackRunner(f.bot,new FakeApi(),async()=>{throw Error();});await runner.start();await pair(f);
 await f.db.query("INSERT INTO factory.slack_updates(installation_id,update_id,digest,generation,payload,state) SELECT $1,'EvFILL'||n,repeat('a',64),1,'{}','done' FROM generate_series(1,999) n",[inst]);
 const socket=new FakeSocket([hello,event('EvNEW',request),disconnect]);await assert.rejects(runner.receive(socket));assert.equal(socket.acks.length,0);assert.equal((await f.db.query('SELECT count(*)::int AS n FROM factory.slack_updates')).rows[0].n,1000);assert.equal(await count(f),0);
 }finally{await f.close();}
});
test('AF-031 pending capture survives restart and lost acknowledgment without duplicates',async()=>{
 const f=await fixture();let restart:SlackStore|undefined;try{await f.bot.start();await pair(f);await f.bot.capture(event('EvNEW',request));await f.bot.close();restart=new SlackStore(url('af_slack_bot'),inst,'af_slack_bot','bot');await restart.start();await restart.capture(event('EvNEW',request));await restart.processOne();await restart.capture(event('EvNEW',request));assert.equal(await restart.processOne(),false);assert.equal(await count(f),1);assert.equal((await f.db.query("SELECT count(*)::int AS n FROM factory.intake_receipts WHERE actor='af_slack_bot'")).rows[0].n,1);
 }finally{await restart?.close();await f.close();}
});
test('AF-031 operational retries are durable, delayed and atomic through exhaustion',async()=>{
 const f=await fixture();try{await f.bot.start();await pair(f);await f.bot.capture(event('EvNEW',request));await f.db.query("INSERT INTO factory.slack_outbox VALUES ($1,'EvNEW',1,'DTEST','Synthetic collision','sent',0,clock_timestamp())",[inst]);
 for(let n=0;n<3;n++){await due(f);await f.bot.processOne();assert.equal(await f.bot.processOne(),false);assert.equal(await count(f),0);assert.equal((await f.db.query("SELECT count(*)::int AS n FROM factory.intake_receipts WHERE actor='af_slack_bot'")).rows[0].n,0);}
 assert.equal((await f.db.query("SELECT state FROM factory.slack_updates WHERE update_id='EvNEW'")).rows[0].state,'exhausted');
 }finally{await f.close();}
});
test('AF-031 revocation and membership loss fence processing and pending replies',async()=>{
 const f=await fixture();try{await f.bot.start();await pair(f);await f.bot.capture(event('EvNEW',request));await f.bot.processOne();await f.bot.capture(event('EvLATE',request));await f.admin.revoke();await f.bot.processOne();assert.equal(await count(f),1);assert.equal(await f.bot.prepareReply(),null);
 await f.db.query("UPDATE factory.memberships SET can_write=false WHERE database_role='af_slack_bot'");await assert.rejects(f.bot.capture(event('EvDENIED',request)));assert.equal(await count(f),1);
 }finally{await f.close();}
});
test('AF-031 burst and per-minute bounds consume no additional work or replies',async()=>{
 const f=await fixture();try{await f.bot.start();await pair(f);for(let n=0;n<6;n++){await f.bot.capture(event('EvRATE'+n,request));await f.bot.processOne();}assert.equal(await count(f),3);assert.equal((await f.db.query('SELECT count(*)::int AS n FROM factory.slack_outbox')).rows[0].n,3);
 }finally{await f.close();}
});
test('AF-031 uncertain replies persist attempts and rate-limit deadlines without duplicate intake',async()=>{
 const f=await fixture();try{const api=new FakeApi();api.failure=new SlackApiError('transient',17);const runner=new SlackRunner(f.bot,api,async()=>{throw Error();});await runner.start();await pair(f);await f.bot.capture(event('EvNEW',request));await runner.recover();assert.equal(await f.bot.prepareReply(),null);
 for(let n=0;n<2;n++){await due(f);await runner.recover();}assert.equal(await count(f),1);assert.equal(api.sends.length,3);assert.equal((await f.db.query('SELECT state FROM factory.slack_outbox')).rows[0].state,'exhausted');
 }finally{await f.close();}
});
test('AF-031 exclusive session lock and database session loss stop ownership',async()=>{
 const f=await fixture();const second=new SlackStore(url('af_slack_bot'),inst,'af_slack_bot','bot');try{await f.bot.start();await assert.rejects(second.start(),/Another/);await f.bot.close();assert.throws(()=>f.bot.assertOwned());}finally{await second.close();await f.close();}
});
test('AF-031 hello app identity and disabled Socket Mode are terminal',async()=>{
 const f=await fixture();try{const runner=new SlackRunner(f.bot,new FakeApi(),async()=>{throw Error();});await runner.start();await assert.rejects(runner.receive(new FakeSocket([{type:'hello',connection_info:{app_id:'AOTHER'}}])));await assert.rejects(runner.receive(new FakeSocket([hello,{type:'disconnect',reason:'link_disabled'}])));}finally{await f.close();}
});
test('AF-031 refresh reconnect obtains a new URL and revalidates installation identity',async()=>{
 const f=await fixture();try{const api=new FakeApi();let opens=0;api.open=async()=>`wss://wss-primary.slack.com/link/?ticket=synthetic${++opens}`;const urls:string[]=[];
 const runner=new SlackRunner(f.bot,api,async(url)=>{urls.push(url);if(urls.length===2)return new FakeSocket([hello,{type:'disconnect',reason:'link_disabled'}]);return new FakeSocket([hello,disconnect]);},async(ms,signal)=>{if(ms===1000)await new Promise<void>(resolve=>{const t=setTimeout(resolve,5);signal.addEventListener('abort',()=>{clearTimeout(t);resolve();},{once:true});});});
 await runner.start();await assert.rejects(runner.run());assert.equal(urls.length,2);assert.notEqual(urls[0],urls[1]);
 }finally{await f.close();}
});

for(const stage of ['captured','processed'])test(`AF-031 killed process after ${stage} commit recovers exactly one canonical request`,async()=>{
 const f=await fixture();let restarted:SlackStore|undefined;
 try{
  await f.bot.start();await pair(f);await f.bot.close();
  const child=spawn(process.execPath,['.test-build/tests/helpers/slack-crash.js',stage],{stdio:['ignore','pipe','pipe']});
  try{
   const [output]=await once(child.stdout,'data',{signal:AbortSignal.timeout(10000)});assert.match(String(output),/SYNTHETIC_COMMIT_COMPLETE/);
  }finally{child.kill('SIGKILL');await once(child,'exit');}
  restarted=new SlackStore(url('af_slack_bot'),inst,'af_slack_bot','bot');await restarted.start();await restarted.processOne();await restarted.processOne();
  assert.equal(await count(f),1);assert.equal((await f.db.query("SELECT count(*)::int AS n FROM factory.intake_receipts WHERE actor='af_slack_bot'")).rows[0].n,1);
 }finally{await restarted?.close();await f.close();}
});
test('AF-031 transient failure remains delayed across restart then succeeds exactly once',async()=>{
 const f=await fixture();let restarted:SlackStore|undefined;
 try{
  await f.bot.start();await pair(f);await f.bot.capture(event('EvNEW',request));
  await f.db.query("INSERT INTO factory.slack_outbox VALUES ($1,'EvNEW',1,'DTEST','Synthetic collision','sent',0,clock_timestamp())",[inst]);
  await f.bot.processOne();assert.equal(await count(f),0);await f.bot.close();
  restarted=new SlackStore(url('af_slack_bot'),inst,'af_slack_bot','bot');await restarted.start();assert.equal(await restarted.processOne(),false);
  const row=(await f.db.query("SELECT attempts,extract(epoch FROM next_attempt_at-clock_timestamp())::float AS wait FROM factory.slack_updates WHERE update_id='EvNEW'")).rows[0];assert.equal(row.attempts,1);assert.ok(row.wait>50);
  await f.db.query("DELETE FROM factory.slack_outbox WHERE update_id='EvNEW'");await f.db.query("UPDATE factory.slack_updates SET next_attempt_at=clock_timestamp() WHERE update_id='EvNEW'");
  await restarted.processOne();assert.equal(await restarted.processOne(),false);assert.equal(await count(f),1);
 }finally{await restarted?.close();await f.close();}
});
test('AF-031 session termination loses ownership and aborts capture',async()=>{
 const f=await fixture();try{await f.bot.start();const pid=(await f.bot.client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;await f.db.query('SELECT pg_terminate_backend($1)',[pid]);for(let n=0;n<100&&!f.bot.abort.signal.aborted;n++)await sleep(5);assert.ok(f.bot.abort.signal.aborted);await assert.rejects(f.bot.capture(event()));}finally{await f.close();}
});
test('AF-031 acknowledgments lost after commit replay safely on a fresh socket',async()=>{
 const f=await fixture();try{const runner=new SlackRunner(f.bot,new FakeApi(),async()=>{throw Error();});await runner.start();await pair(f);
 const broken=new FakeSocket([hello,event('EvNEW',request)]);broken.ack=async()=>{throw new SlackApiError('transient');};await assert.rejects(runner.receive(broken));
 const next=event('EvNEW',request);next.envelope_id='redelivered';const socket=new FakeSocket([hello,next,disconnect]);await runner.receive(socket);await runner.recover();assert.deepEqual(socket.acks,['redelivered']);assert.equal(await count(f),1);
 }finally{await f.close();}
});
test('AF-031 permanent reply failure exhausts without changing canonical intake',async()=>{
 const f=await fixture();try{const api=new FakeApi();api.failure=new SlackApiError('permanent');const runner=new SlackRunner(f.bot,api,async()=>{throw Error();});await runner.start();await pair(f);await f.bot.capture(event('EvNEW',request));await runner.recover();assert.equal(await count(f),1);assert.equal((await f.db.query('SELECT state FROM factory.slack_outbox')).rows[0].state,'exhausted');assert.equal(await f.bot.prepareReply(),null);}finally{await f.close();}
});
test('AF-031 database outage during capture yields no acknowledgment',async()=>{
 const f=await fixture();try{const runner=new SlackRunner(f.bot,new FakeApi(),async()=>{throw Error();});await runner.start();await f.bot.close();const socket=new FakeSocket([hello,event()]);await assert.rejects(runner.receive(socket));assert.equal(socket.acks.length,0);}finally{await f.close();}
});
test('AF-031 inbound abuse and oversized envelopes cannot grow per-event storage',async()=>{
 const f=await fixture();try{await f.bot.start();for(let n=0;n<30;n++)await f.bot.capture(event('EvDENIED'+n,request,'UOTHER'));assert.equal((await f.db.query('SELECT count(*)::int AS n FROM factory.slack_updates')).rows[0].n,0);assert.equal((await f.db.query('SELECT count(*)::int AS n FROM factory.slack_outbox')).rows[0].n,0);await assert.rejects(f.bot.capture(event('EvBIG','x'.repeat(70000))));}finally{await f.close();}
});

test('AF-031 concurrent revocation waits for the authoritative intake transaction',async()=>{
 const {createHash}=await import('node:crypto');const f=await fixture();
 try{
  await f.bot.start();await pair(f);await f.bot.capture(event('EvNEW',request));
  const digest=createHash('sha256').update(JSON.stringify(['TTEST','ATEST','EvNEW'])).digest('hex');
  const lock=JSON.stringify(['synthetic-org-a',f.project,'af_slack_bot','create',`slack:${digest}`]);
  await f.db.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[lock]);
  const pid=(await f.bot.client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const adminPid=(await f.admin.client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const blocked=async(pid:number)=>{for(let n=0;n<100;n++){if((await f.db.query("SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock'",[pid])).rowCount)return;await sleep(5);}assert.fail('Expected synthetic transaction contention');};
  const processing=f.bot.processOne();let revoking:Promise<void>|undefined;
  try{await blocked(pid);revoking=f.admin.revoke();await blocked(adminPid);}
  finally{await f.db.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[lock]);await processing;await revoking;}
  assert.equal(await count(f),1);assert.equal((await f.admin.inspectPairing()).state,'revoked');assert.equal(await f.bot.prepareReply(),null);
 }finally{await f.close();}
});


test('AF-031 unverified Socket Mode app cannot trigger background recovery',async()=>{
 const f=await fixture();let store:SlackStore|undefined;
 try{
  await f.bot.start();await pair(f);await f.bot.capture(event('EvNEW',request));await f.bot.close();
  store=new SlackStore(url('af_slack_bot'),inst,'af_slack_bot','bot');
  const api=new FakeApi();const runner=new SlackRunner(store,api,async()=>new FakeSocket([{type:'hello',connection_info:{app_id:'AOTHER'}}]));
  await runner.start();await assert.rejects(runner.run());assert.equal(await count(f),0);assert.equal(api.sends.length,0);
 }finally{await store?.close();await f.close();}
});


test('AF-031 supported documented message fields stay on one socket and retain commit-before-ack',async()=>{
 const f=await fixture();try{
  const runner=new SlackRunner(f.bot,new FakeApi(),async()=>{throw Error('Unexpected reconnect');});await runner.start();await pair(f);
  const first=event('EvCOMPAT',request);
  const enriched={...first,payload:{...first.payload,event:{...first.payload.event,event_ts:first.payload.event.ts,client_msg_id:'synthetic-client-id'},event_context:'synthetic-context'}};
  const duplicate={...enriched,envelope_id:'synthetic-redelivery'};
  const socket=new FakeSocket([hello,enriched,duplicate,event('EvHELP','help'),disconnect]);
  socket.ack=async(id)=>{assert.ok((await f.db.query("SELECT 1 FROM factory.slack_updates WHERE update_id='EvCOMPAT'")).rowCount);assert.equal(await count(f),0);socket.acks.push(id);};
  await runner.receive(socket);assert.equal(socket.acks.length,3);await runner.recover();assert.equal(await count(f),1);
 }finally{await f.close();}
});
test('AF-031 ambiguous provider envelopes stop without acknowledgment or reconnect loops',async()=>{
 const f=await fixture();try{
  const raw=event('EvAMBIGUOUS',request);
  // Missing sharing metadata remains unknown even for a correctly identified bot.
  const {is_ext_shared_channel: omitted,...payload}=raw.payload;assert.equal(omitted,false);
  const socket=new FakeSocket([hello,{...raw,payload}]);let connects=0;
  const runner=new SlackRunner(f.bot,new FakeApi(),async()=>{connects++;return socket;});
  await runner.start();await pair(f);await assert.rejects(runner.run());
  assert.equal(connects,1);assert.equal(socket.closed,true);assert.equal(socket.acks.length,0);
  assert.equal(await count(f),0);assert.equal((await f.db.query("SELECT count(*)::int AS n FROM factory.slack_updates WHERE update_id='EvAMBIGUOUS'")).rows[0].n,0);
 }finally{await f.close();}
});
