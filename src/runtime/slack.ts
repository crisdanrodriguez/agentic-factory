import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import type { SlackStore,Installation } from '../adapters/postgres/slack-store.js';
import { appId } from '../core/slack.js';
import { SlackApiError,type SlackApi,type SlackConnect,type SlackSocket } from '../ports/slack-api.js';
export class SlackRunner {
 private installation?:Installation;
 private socketReady=false;
 constructor(private readonly store:SlackStore,private readonly api:SlackApi,private readonly connect:SlackConnect,
  private readonly delay:(ms:number,signal:AbortSignal)=>Promise<unknown>=(ms,signal)=>sleep(ms,undefined,{signal})){}
 async start(){this.installation=await this.store.start();await this.verifyIdentity();}
 private async verifyIdentity(){const i=this.installation;if(!i)throw new SlackApiError('permanent');const r=await this.api.identity(this.store.abort.signal);if(r.teamId!==i.team_id||r.botId!==i.bot_id||r.userId!==i.bot_user_id)throw new SlackApiError('permanent');}
 async receive(socket:SlackSocket):Promise<void>{
  this.store.assertOwned();
  const hello=z.object({type:z.literal('hello'),connection_info:z.object({app_id:appId})}).parse(await socket.next(this.store.abort.signal));
  if(hello.connection_info.app_id!==this.installation?.app_id)throw new SlackApiError('permanent');
  this.socketReady=true;
  while(!this.store.abort.signal.aborted){
   this.store.assertOwned();const value=await socket.next(this.store.abort.signal);
   const control=z.object({type:z.literal('disconnect'),reason:z.enum(['warning','refresh_requested','link_disabled'])}).safeParse(value);
   if(control.success){if(control.data.reason==='link_disabled')throw new SlackApiError('permanent');return;}
   let overdue=false;const deadline=setTimeout(()=>{overdue=true;socket.close();},2500);
   try{const id=await this.store.capture(value);this.store.assertOwned();if(overdue)throw new SlackApiError('transient');await socket.ack(id);}finally{clearTimeout(deadline);}
  }
 }
 async recover(){
  for(let n=0;n<20&&await this.store.processOne();n++){/* Only eligible durable operations. */}
  const reply=await this.store.prepareReply();if(!reply)return;
  this.store.assertOwned();
  try{await this.api.send(reply.chat_id,reply.body,this.store.abort.signal);}
  catch(e){await this.store.finishReply(reply.update_id,e instanceof SlackApiError?e:new SlackApiError('transient'));return;}
  await this.store.finishReply(reply.update_id);
 }
 async run(){
  const signal=this.store.abort.signal;
  const worker=(async()=>{try{while(!signal.aborted){if(this.socketReady)await this.recover();await this.delay(1000,signal);}}catch{if(!signal.aborted)this.store.abort.abort();}})();
  try{
   let failures=0;
   while(!signal.aborted){let socket:SlackSocket|undefined;
    try{this.socketReady=false;await this.verifyIdentity();socket=await this.connect(await this.api.open(signal),signal);await this.receive(socket);failures=0;await this.delay(1000,signal);}
    catch(e){this.store.assertOwned();if(!(e instanceof SlackApiError)||e.kind==='permanent'||++failures>=3)throw e;await this.delay(Math.max(1000*2**failures,e.retryAfter*1000),signal);}
    finally{this.socketReady=false;socket?.close();}
   }
  }finally{this.store.abort.abort();await worker;}
 }
 async close(){this.store.abort.abort();await this.store.close();}
}
