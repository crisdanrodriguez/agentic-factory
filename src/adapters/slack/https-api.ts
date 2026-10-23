import { request } from 'node:https';
import { z } from 'zod';
import { teamId,userId,slackId,channelId } from '../../core/slack.js';
import { SlackApiError,type SlackApi } from '../../ports/slack-api.js';
export function socketUrl(value:string):string {
 try {const u=new URL(value);if(u.protocol!=='wss:'||u.username||u.password||u.hash||(u.port&&u.port!=='443')||!/^wss-(primary|backup|[0-9]+)\.slack\.com$/.test(u.hostname)||u.pathname!=='/link/'||value.length>4096)throw Error();return value;}
 catch{throw new SlackApiError('permanent');}
}
export function decodeSlack(bytes:Buffer,status:number,retry:string|undefined):unknown {
 if(bytes.length>524288)throw new SlackApiError('permanent');
 if(status===429){if(!retry||!/^\d{1,5}$/.test(retry)||Number(retry)>3600)throw new SlackApiError('permanent');throw new SlackApiError('transient',Math.max(1,Number(retry)));}
 if(status>=500)throw new SlackApiError('transient');
 if(status!==200)throw new SlackApiError('permanent');
 try {
  const r=z.object({ok:z.boolean(),error:z.string().optional()}).passthrough().parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  if(!r.ok)throw new SlackApiError(['internal_error','fatal_error','service_unavailable','request_timeout','ratelimited'].includes(r.error??'')?'transient':'permanent');return r;
 }catch(e){throw e instanceof SlackApiError?e:new SlackApiError('permanent');}
}
export class HttpsSlackApi implements SlackApi {
 constructor(private readonly appToken:string,private readonly botToken:string){if(!/^xapp-[A-Za-z0-9-]{10,512}$/.test(appToken)||!/^xoxb-[A-Za-z0-9-]{10,512}$/.test(botToken))throw new SlackApiError('permanent');}
 private async call(method:'auth.test'|'apps.connections.open'|'chat.postMessage',body:object,signal:AbortSignal):Promise<unknown>{
  return new Promise((resolve,reject)=>{
   const payload=JSON.stringify(body);
   const req=request({hostname:'slack.com',port:443,path:`/api/${method}`,method:'POST',rejectUnauthorized:true,agent:false,signal,
    headers:{authorization:`Bearer ${method==='apps.connections.open'?this.appToken:this.botToken}`,'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(payload)}},res=>{
    const parts:Buffer[]=[];let size=0;
    res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>524288){reject(new SlackApiError('permanent'));req.destroy();}else parts.push(chunk);});
    res.on('error',()=>reject(new SlackApiError('transient')));
    res.on('end',()=>{try{resolve(decodeSlack(Buffer.concat(parts),res.statusCode??0,typeof res.headers['retry-after']==='string'?res.headers['retry-after']:undefined));}catch(e){reject(e);}});
   });
   const timer=setTimeout(()=>{req.destroy();reject(new SlackApiError('transient'));},15000);
   req.on('close',()=>clearTimeout(timer));req.on('error',()=>reject(new SlackApiError('transient')));req.end(payload);
  });
 }
 async identity(signal:AbortSignal){try{const r=z.object({team_id:teamId,user_id:userId,bot_id:slackId('B')}).parse(await this.call('auth.test',{},signal));return {teamId:r.team_id,userId:r.user_id,botId:r.bot_id};}catch(e){throw e instanceof SlackApiError?e:new SlackApiError('permanent');}}
 async open(signal:AbortSignal){try{return socketUrl(z.object({url:z.string()}).parse(await this.call('apps.connections.open',{},signal)).url);}catch(e){throw e instanceof SlackApiError?e:new SlackApiError('permanent');}}
 async send(channel:string,text:string,signal:AbortSignal){
  if(!channelId.safeParse(channel).success||Buffer.byteLength(text)>2048)throw new SlackApiError('permanent');
  try{z.object({channel:z.literal(channel),ts:z.string().regex(/^\d+\.\d{6}$/)}).parse(await this.call('chat.postMessage',{channel,text,mrkdwn:false,parse:'none',unfurl_links:false,unfurl_media:false},signal));}
  catch(e){throw e instanceof SlackApiError?e:new SlackApiError('permanent');}
 }
}
