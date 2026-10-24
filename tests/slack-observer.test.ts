import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve,dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { observeSlack,projectEvent,SYNTHETIC_OBSERVATION,type Projection } from '../src/runtime/slack-observer.js';
import type { SlackSocket } from '../src/ports/slack-api.js';
const trusted={teamId:'TTEST',appId:'ATEST',botId:'BTEST',botUserId:'UBOT',humanId:'UHUMAN',channelId:'DTEST'};
const event=()=>({type:'events_api',envelope_id:'private-envelope',accepts_response_payload:false,payload:{type:'event_callback',team_id:'TTEST',api_app_id:'ATEST',event_id:'EvPRIVATE',event_time:1,is_ext_shared_channel:false as unknown,authorizations:[{team_id:'TTEST',user_id:'UBOT',is_bot:true,is_enterprise_install:false}],event:{type:'message',channel_type:'im',channel:'DTEST',user:'UHUMAN',text:SYNTHETIC_OBSERVATION,ts:'123.123456'}}});
function fixture(values:unknown[]){
 let closed=0,opens=0,connections=0,sends=0;const acks:string[]=[];const projections:Projection[]=[];
 const socket:SlackSocket={next:async()=>{if(!values.length)return new Promise(()=>{});return values.shift();},ack:async id=>{assert.equal(projections.length,acks.length);acks.push(id);},close:()=>{closed++;}};
 const api={identity:async()=>({teamId:'TTEST',botId:'BTEST',userId:'UBOT'}),open:async()=>{opens++;return 'private-socket-url';},send:async()=>{sends++;throw Error('Forbidden reply');}};
 return {api,socket,acks,projections,connect:async()=>{connections++;return socket;},emit:(p:Projection)=>projections.push(p),stats:()=>({closed,opens,connections,sends})};
}
const hello={type:'hello',connection_info:{app_id:'ATEST'}};
for(const [name,value]of [['false',false],['true',true],['malformed','secret-value'],['null',null],['missing',undefined]] as const){
 test(`observer sharing metadata ${name} remains diagnostic only`,async()=>{
  const e=event();e.payload.is_ext_shared_channel=value;if(name==='missing')Reflect.deleteProperty(e.payload,'is_ext_shared_channel');
  const f=fixture([hello,e]);const result=await observeSlack(f.api,f.connect,trusted,{windowMs:60000,maxEvents:1},f.emit);
  assert.equal(result,name==='false'?'compatible':'incompatible');assert.equal(f.acks.length,1);assert.equal(f.stats().closed,1);assert.equal(f.stats().sends,0);
  assert.equal(f.projections[0]!.sharing.present,name!=='missing');assert.ok(!JSON.stringify(f.projections).includes('secret-value'));
 });
}
test('observer documented user authorization and missing sharing are observed, never authorized',async()=>{
 const e=event();e.payload.authorizations[0]!.is_bot=false;e.payload.authorizations[0]!.user_id='UHUMAN';Reflect.deleteProperty(e.payload,'is_ext_shared_channel');
 const f=fixture([hello,e]);assert.equal(await observeSlack(f.api,f.connect,trusted,{windowMs:60000,maxEvents:1},f.emit),'incompatible');assert.equal(f.projections[0]!.authorization.isBot,false);assert.equal(f.projections[0]!.authorization.installationMatches,false);
});
test('observer projects fixed metadata without raw content, identifiers or unexpected keys',()=>{
 const e=event();e.payload.event.text='private credential xoxb-secret';Object.assign(e.payload,{privateSecret:'credential',unexpected:{url:'wss://private'}});
 const output=JSON.stringify(projectEvent(e,trusted));
 for(const forbidden of ['private credential','xoxb','privateSecret','credential','wss://','private-envelope','EvPRIVATE',SYNTHETIC_OBSERVATION,...Object.values(trusted)])assert.ok(!output.includes(forbidden));
});
test('observer rejects token, hello and envelope identity mismatches without acknowledgment',async()=>{
 for(const kind of ['token','hello','team','app','human','channel','content']){
  const e=event();const h=structuredClone(hello);if(kind==='hello')h.connection_info.app_id='AOTHER';
  if(kind==='team')e.payload.team_id='TOTHER';if(kind==='app')e.payload.api_app_id='AOTHER';if(kind==='human')e.payload.event.user='UOTHER';if(kind==='channel')e.payload.event.channel='DOTHER';if(kind==='content')e.payload.event.text='new private request';
  const f=fixture([h,e]);if(kind==='token')f.api.identity=async()=>({teamId:'TOTHER',botId:'BTEST',userId:'UBOT'});
  await assert.rejects(observeSlack(f.api,f.connect,trusted,{windowMs:60000,maxEvents:1},f.emit),/Sensitive details withheld/);assert.equal(f.acks.length,0);assert.equal(f.projections.length,0);assert.equal(f.stats().sends,0);assert.equal(f.stats().connections,kind==='token'?0:1);
 }
});
test('observer event cap, timeout, cancellation and uncertain ack close without retries',async()=>{
 const f=fixture([hello,event(),event()]);await observeSlack(f.api,f.connect,trusted,{windowMs:60000,maxEvents:1},f.emit);assert.equal(f.acks.length,1);assert.equal(f.stats().connections,1);
 const timed=fixture([hello]);await assert.rejects(observeSlack(timed.api,timed.connect,trusted,{windowMs:10,maxEvents:1},timed.emit));assert.equal(timed.stats().closed,1);
 const failed=fixture([hello,event()]);failed.socket.ack=async()=>{throw Error('private credential');};await assert.rejects(observeSlack(failed.api,failed.connect,trusted,{windowMs:60000,maxEvents:1},failed.emit),e=>e instanceof Error&&!e.message.includes('credential'));assert.equal(failed.projections.length,0);assert.equal(failed.stats().closed,1);
 const controller=new AbortController();controller.abort();const canceled=fixture([]);await assert.rejects(observeSlack(canceled.api,canceled.connect,trusted,{windowMs:60000,maxEvents:1},canceled.emit,controller.signal));assert.equal(canceled.stats().opens,0);
 for(const options of [{windowMs:60001,maxEvents:1},{windowMs:60000,maxEvents:4}])await assert.rejects(observeSlack(f.api,f.connect,trusted,options,f.emit));
});
test('observer entry point import graph cannot reach persistence, pairing or execution',async()=>{
 const seen=new Set<string>();
 async function walk(path:string):Promise<void>{if(seen.has(path))return;seen.add(path);const source=await readFile(path,'utf8');
  assert.doesNotMatch(source,/SlackStore|PostgresWorkItemStore|from ['"]pg['"]/);
  if(path.endsWith('slack-observer.ts')||path.endsWith('slack-observe.ts'))assert.doesNotMatch(source,/\.send\(/);
  for(const match of source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)){const spec=match[1]!;if(spec.startsWith('.')){const next=resolve(dirname(path),spec.replace(/\.js$/,'.ts'));assert.doesNotMatch(next,/adapters\/postgres|slack-config|runtime\/slack\.ts|sandbox|outbox/);await walk(next);}else assert.ok(spec.startsWith('node:')||['zod','ws'].includes(spec));}
 }
 await walk(resolve('src/cli/slack-observe.ts'));
 const run=promisify(execFile);const result=await run(process.execPath,['.test-build/src/cli/slack-observe.js','--help'],{env:{}});assert.match(result.stdout,/Observation only/);
 await assert.rejects(run(process.execPath,['.test-build/src/cli/slack-observe.js'],{env:{}}));
});

test('observer late identity result after timeout cannot open a connection',async()=>{
 const f=fixture([]);let release:((value:{teamId:string;botId:string;userId:string})=>void)|undefined;
 f.api.identity=()=>new Promise(resolve=>{release=resolve;});
 await assert.rejects(observeSlack(f.api,f.connect,trusted,{windowMs:10,maxEvents:1},f.emit));
 release!({teamId:'TTEST',botId:'BTEST',userId:'UBOT'});await new Promise(resolve=>setImmediate(resolve));assert.equal(f.stats().opens,0);assert.equal(f.stats().connections,0);
});
test('observer transport errors and oversized events remain redacted and unacknowledged',async()=>{
 const f=fixture([hello,{...event(),secret:'x'.repeat(65536)}]);await assert.rejects(observeSlack(f.api,f.connect,trusted,{windowMs:60000,maxEvents:1},f.emit));assert.equal(f.acks.length,0);assert.equal(f.stats().closed,1);
 const failed=fixture([]);failed.api.open=async()=>{throw Error('private-token-and-url');};await assert.rejects(observeSlack(failed.api,failed.connect,trusted,{windowMs:60000,maxEvents:1},failed.emit),e=>e instanceof Error&&!e.message.includes('private-token'));assert.equal(failed.stats().connections,0);
});


test('observer total deadline includes open, connect, hello and acknowledgment',async()=>{
 for(const stage of ['open','connect','hello','ack']){
  const f=fixture([hello,event()]);let connect=f.connect;
  if(stage==='open')f.api.open=()=>new Promise(()=>{});
  if(stage==='connect')connect=()=>new Promise(()=>{});
  if(stage==='hello')f.socket.next=()=>new Promise(()=>{});
  if(stage==='ack')f.socket.ack=()=>new Promise(()=>{});
  await assert.rejects(observeSlack(f.api,connect,trusted,{windowMs:10,maxEvents:1},f.emit));
  assert.equal(f.projections.length,0);assert.equal(f.stats().closed,stage==='hello'||stage==='ack'?1:0);
 }
});


test('observer readiness is fixed, once, and precedes synthetic event reads',async()=>{
 const f=fixture([hello,event(),event()]);const order:string[]=[];const next=f.socket.next;
 f.socket.next=async signal=>{order.push(order.length?'event-read':'hello-read');return next(signal);};
 await observeSlack(f.api,f.connect,trusted,{windowMs:60000,maxEvents:2},f.emit,undefined,()=>order.push('AF031_OBSERVER_READY'));
 assert.deepEqual(order,['hello-read','AF031_OBSERVER_READY','event-read','event-read']);assert.equal(f.stats().sends,0);
 assert.ok(!JSON.stringify(f.projections).includes(SYNTHETIC_OBSERVATION));
});
test('observer never signals readiness after failed startup or insufficient remaining time',async()=>{
 for(const stage of ['identity','hello','transport','short-window','cancel']){
  const f=fixture([stage==='hello'?{type:'hello',connection_info:{app_id:'AOTHER'}}:hello,event()]);const controller=new AbortController();let ready=0;
  if(stage==='identity')f.api.identity=async()=>({teamId:'TOTHER',botId:'BTEST',userId:'UBOT'});
  if(stage==='transport')f.api.open=async()=>{throw Error('private credential');};
  if(stage==='cancel')controller.abort();
  await assert.rejects(observeSlack(f.api,f.connect,trusted,{windowMs:stage==='short-window'?9999:60000,maxEvents:1},f.emit,controller.signal,()=>ready++));
  assert.equal(ready,0);assert.equal(f.acks.length,0);
 }
});
test('observer late hello cannot signal readiness after timeout or cancellation',async()=>{
 for(const reason of ['timeout','cancel']){
  const f=fixture([]);let release:((v:unknown)=>void)|undefined;let waiting:()=>void=()=>{};const entered=new Promise<void>(r=>{waiting=r;});
  f.socket.next=()=>new Promise(r=>{release=r;waiting();});const controller=new AbortController();let ready=0;
  const observing=observeSlack(f.api,f.connect,trusted,{windowMs:reason==='timeout'?10:60000,maxEvents:1},f.emit,controller.signal,()=>ready++);
  const rejected=assert.rejects(observing);await entered;if(reason==='cancel')controller.abort();await rejected;
  release!(hello);await new Promise(r=>setImmediate(r));assert.equal(ready,0);assert.equal(f.stats().closed,1);
 }
});
test('observer cancellation during acknowledgment never reports observation success',async()=>{
 const f=fixture([hello,event()]);const controller=new AbortController();let ready=0;
 f.socket.ack=async()=>{controller.abort();};
 await assert.rejects(observeSlack(f.api,f.connect,trusted,{windowMs:60000,maxEvents:1},f.emit,controller.signal,()=>ready++));
 assert.equal(ready,1);assert.equal(f.projections.length,0);assert.equal(f.stats().closed,1);
});
