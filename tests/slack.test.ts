import assert from 'node:assert/strict';
import test from 'node:test';
import { command,parseMessage,envelopeSchema } from '../src/core/slack.js';
import { decodeSlack,socketUrl,HttpsSlackApi } from '../src/adapters/slack/https-api.js';
import { SlackApiError } from '../src/ports/slack-api.js';
const m={type:'message',channel_type:'im',channel:'DTEST',user:'UHUMAN',text:'help',ts:'123.123456'};
test('AF-031 DM commands preserve Slack source and reject authorization fields',()=>{
 const c=command('new {"objective":"Synthetic ML experiment","context":"Record only"}');assert.equal(c.kind,'new');if(c.kind==='new')assert.equal(c.source.kind,'slack');
 for(const text of ['new {}','new {"objective":"x","context":"y","owner":"forged"}','status ../secret','/help','list after ../x'])assert.equal(command(text).kind,'invalid');
 for(const text of ['help','cancel','list','status synthetic-id','list after synthetic-id'])assert.notEqual(command(text).kind,'invalid');
});
test('AF-031 only original bounded human private messages are supported',()=>{
 assert.ok(parseMessage(m));
 for(const extra of [{subtype:'message_changed'},{bot_id:'BTEST'},{files:[]},{thread_ts:'123.123456'},{edited:{}},{attachments:[]},{channel_type:'channel'},{channel:'CTEST'},{user:'BTEST'},{text:'x'.repeat(4001)},{text:'\ud800'}])assert.equal(parseMessage({...m,...extra}),null);
 assert.equal(envelopeSchema.safeParse({type:'interactive',payload:{}}).success,false);
});
test('AF-031 Web API errors are bounded, redacted and classify rate limits',()=>{
 assert.throws(()=>decodeSlack(Buffer.from('secret'),429,'17'),e=>e instanceof SlackApiError&&e.retryAfter===17);
 assert.throws(()=>decodeSlack(Buffer.from('{}'),429,'99999'),e=>e instanceof SlackApiError&&e.kind==='permanent');
 for(const status of [301,401,500])assert.throws(()=>decodeSlack(Buffer.from('private-token'),status,undefined),/Slack transport unavailable/);
 assert.throws(()=>decodeSlack(Buffer.alloc(524289),200,undefined));
 assert.throws(()=>decodeSlack(Buffer.from('{"ok":false,"error":"invalid_auth"}'),200,undefined),e=>e instanceof SlackApiError&&e.kind==='permanent');
 assert.throws(()=>decodeSlack(Buffer.from('{"ok":false,"error":"internal_error"}'),200,undefined),e=>e instanceof SlackApiError&&e.kind==='transient');
 assert.throws(()=>new HttpsSlackApi('private','secret'),/Slack transport unavailable/);
});
test('AF-031 rotated socket URLs are accepted only on reviewed TLS endpoints',()=>{
 for(const host of ['wss.slack.com','wss-primary.slack.com','wss-backup.slack.com','wss-123.slack.com'])assert.ok(socketUrl(`wss://${host}/link/?ticket=synthetic`));
 for(const url of ['ws://wss-primary.slack.com/link/','wss://evil.example/link/','wss://wss-primary.slack.com.evil.example/link/','wss://user:secret@wss-primary.slack.com/link/','wss://wss-primary.slack.com:80/link/','wss://wss-primary.slack.com/other','wss://wss.slack.com.evil.example/link/','wss://wss.evil.slack.com/link/','wss://wss-slack.com/link/','wss://wss-custom.slack.com/link/','wss://wss.slack.com/link/#fragment','wss://wss.slack.com:444/link/','wss://user@wss.slack.com/link/','ws://wss.slack.com/link/'])assert.throws(()=>socketUrl(url),/Slack transport unavailable/);
});

test('AF-031 Slack CLI stays optional and errors never expose configuration or token values',async()=>{
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const run=promisify(execFile);
 const help=await run(process.execPath,['.test-build/src/cli/slack.js','--help'],{env:{}});assert.match(help.stdout,/Intake only/);
 await assert.rejects(run(process.execPath,['.test-build/src/cli/slack.js','start'],{env:{FACTORY_SLACK_CONFIG:'/nonexistent/private-synthetic-file',FACTORY_SLACK_BOT_TOKEN:'synthetic-secret-do-not-echo'}}),e=>{assert.ok(e instanceof Error);assert.ok(!String(e).includes('synthetic-secret-do-not-echo'));assert.ok(!String(e).includes('/nonexistent/private-synthetic-file'));return true;});
});

// Shape adapted from Slack's message.im reference; IDs and content are synthetic.
// No deprecated verification token is needed on the authenticated Socket Mode connection.
test('AF-031 documented user-authorization example does not authorize the bot installation',()=>{
 const payload={type:'event_callback',team_id:'TTEST',api_app_id:'ATEST',event:m,
  authorizations:[{team_id:'TTEST',user_id:'UHUMAN',is_bot:false,is_enterprise_install:false}],
  event_id:'EvEXAMPLE',event_time:1355517523};
 const wrap=(p:unknown)=>({type:'events_api',envelope_id:'synthetic-example',accepts_response_payload:false,payload:p});
 assert.equal(envelopeSchema.safeParse(wrap(payload)).success,false);
 assert.equal(envelopeSchema.safeParse(wrap({...payload,is_ext_shared_channel:false})).success,false);
 const bot={...payload,authorizations:[{team_id:'TTEST',user_id:'UBOT',is_bot:true,is_enterprise_install:false}]};
 assert.equal(envelopeSchema.safeParse(wrap(bot)).success,false);
 for(const sharing of [null,true,'false'])assert.equal(envelopeSchema.safeParse(wrap({...bot,is_ext_shared_channel:sharing})).success,false);
 assert.equal(envelopeSchema.safeParse(wrap({...bot,is_ext_shared_channel:false})).success,true);
 for(const authorizations of [[],[...bot.authorizations,...bot.authorizations],[{...bot.authorizations[0],is_enterprise_install:true}]])
  assert.equal(envelopeSchema.safeParse(wrap({...bot,is_ext_shared_channel:false,authorizations})).success,false);
});
