import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { readPrivateFile } from '../adapters/local-intake.js';
import { HttpsSlackApi } from '../adapters/slack/https-api.js';
import { connectSlack } from '../adapters/slack/socket.js';
import { observerIdentity, observeSlack } from '../runtime/slack-observer.js';
const environment=z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/);
const schema=z.strictObject({identity:observerIdentity,appTokenEnvironment:environment,botTokenEnvironment:environment,windowSeconds:z.number().int().min(1).max(60),maxEvents:z.number().int().min(1).max(3)});
const abort=new AbortController();const stop=()=>abort.abort();
try{
 const args=process.argv.slice(2);
 if(args.length===1&&args[0]==='--help')console.log('Observation only: slack:observe --synthetic-only. Requires private FACTORY_SLACK_OBSERVER_CONFIG, separate live authorization, and the exact synthetic marker. No intake, pairing or replies. Diagnostic acknowledgment consumes events.');
 else{
  if(args.length!==1||args[0]!=='--synthetic-only')throw Error();
  const path=process.env.FACTORY_SLACK_OBSERVER_CONFIG??'';
  if(!isAbsolute(path)||resolve(path)!==path)throw Error();
  const config=schema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readPrivateFile(dirname(path),basename(path)))));
  const app=process.env[config.appTokenEnvironment],bot=process.env[config.botTokenEnvironment];if(!app||!bot)throw Error();
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  const result=await observeSlack(new HttpsSlackApi(app,bot),connectSlack,config.identity,{windowMs:config.windowSeconds*1000,maxEvents:config.maxEvents},p=>console.log(JSON.stringify(p)),abort.signal);
  console.log(JSON.stringify({observation:result,intakeAuthorized:false}));if(result!=='compatible')process.exitCode=1;
 }
}catch{console.error('Observation incomplete. Sensitive details withheld. No intake authorized.');process.exitCode=1;}
finally{abort.abort();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
