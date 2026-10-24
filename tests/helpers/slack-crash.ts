// Synthetic-only child: terminated by deterministic recovery tests after commit.
import { SlackStore } from '../../src/adapters/postgres/slack-store.js';
const store=new SlackStore('postgres://af_slack_bot:synthetic-local-runtime-only@127.0.0.1:55432/agentic_factory_local','synthetic-slack','af_slack_bot','bot');
await store.start();
await store.capture({type:'events_api',envelope_id:'synthetic-crash',accepts_response_payload:false,payload:{type:'event_callback',team_id:'TTEST',api_app_id:'ATEST',event_id:'EvCRASH',event_time:1792600000,is_ext_shared_channel:false,authorizations:[{team_id:'TTEST',user_id:'UBOT',is_bot:true,is_enterprise_install:false}],event:{type:'message',channel_type:'im',channel:'DTEST',user:'UHUMAN',text:'new {"objective":"Synthetic crash","context":"Recovery only"}',ts:'1792600000.000001'}}});
if(process.argv[2]==='processed')await store.processOne();
process.stdout.write('SYNTHETIC_COMMIT_COMPLETE\n');
setInterval(()=>{},1000);
