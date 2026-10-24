import { SlackStore } from '../adapters/postgres/slack-store.js';
import { HttpsSlackApi } from '../adapters/slack/https-api.js';
import { connectSlack } from '../adapters/slack/socket.js';
import { slackConfig } from '../runtime/slack-config.js';
import { SlackRunner } from '../runtime/slack.js';
import { fail } from '../core/intake.js';
import { channelId,userId } from '../core/slack.js';
const args=process.argv.slice(2);let store:SlackStore|undefined;let stopping=false;
try{
 if(args.length===1&&args[0]==='--help')console.log('Optional Slack adapter: start | pair issue PROJECT USER | pair show | pair confirm USER CHANNEL GENERATION | pair revoke. Requires private FACTORY_SLACK_CONFIG. Intake only; no execution or approval.');
 else{
  const config=await slackConfig();const url=process.env[config.databaseUrlEnvironment];if(!url)fail('Slack database configuration unavailable.');
  const bot=args.length===1&&args[0]==='start';store=new SlackStore(url,config.installationId,config.principal,bot?'bot':'admin');
  if(bot){
   const app=config.appTokenEnvironment?process.env[config.appTokenEnvironment]:undefined;
   const token=config.botTokenEnvironment?process.env[config.botTokenEnvironment]:undefined;
   if(!app||!token)fail('Slack token configuration unavailable.');
   const runner=new SlackRunner(store,new HttpsSlackApi(app,token),connectSlack);
   const stop=()=>{stopping=true;store?.abort.abort();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
   await runner.start();await runner.run();if(!stopping)fail('Slack adapter stopped unexpectedly.');
  }else{
   await store.start();if(args[0]!=='pair')fail('Invalid Slack operator command.');
   if(args[1]==='issue'&&args.length===4){const challenge=await store.issue(userId.parse(args[3]),args[2]!);console.log(`One-time private pairing challenge (five minutes): pair ${challenge}`);}
   else if(args[1]==='show'&&args.length===2)console.log(JSON.stringify(await store.inspectPairing()));
   else if(args[1]==='confirm'&&args.length===5){if(!/^[1-9][0-9]{0,8}$/.test(args[4]!))fail('Invalid generation.');await store.confirm(userId.parse(args[2]),channelId.parse(args[3]),Number(args[4]));console.log('Pairing activated for the configured project.');}
   else if(args[1]==='revoke'&&args.length===2){await store.revoke();console.log('Pairing revoked.');}
   else fail('Invalid Slack operator command.');
  }
 }
}catch{if(!stopping){console.error('Slack operation failed. Check trusted configuration, membership, pairing, transport, and retention. Sensitive details are withheld.');process.exitCode=1;}}
finally{try{await store?.close();}catch{console.error('Slack session cleanup failed.');process.exitCode=1;}}
