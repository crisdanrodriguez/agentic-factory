import { z } from 'zod';
import { appId, teamId, userId, channelId, slackId, envelopeSchema, parseMessage, MAX_ENVELOPE_BYTES } from '../core/slack.js';
import type { SlackApi, SlackConnect, SlackSocket } from '../ports/slack-api.js';

export const observerIdentity = z.strictObject({ teamId, appId, botId:slackId('B'), botUserId:userId, humanId:userId, channelId });
export type ObserverIdentity = z.infer<typeof observerIdentity>;
export const SYNTHETIC_OBSERVATION = 'AF031 synthetic protocol observation';
const object = (v:unknown):Record<string,unknown> => typeof v==='object'&&v!==null&&!Array.isArray(v)?v as Record<string,unknown>:{};
const shape = (o:Record<string,unknown>, keys:readonly string[]) => Object.fromEntries(keys.map(k=>[k,{present:Object.hasOwn(o,k),type:!Object.hasOwn(o,k)?'absent':o[k]===null?'null':Array.isArray(o[k])?'array':typeof o[k]}]));
const boolean = (v:unknown) => typeof v==='boolean'?v:'invalid';
// Only fixed field names, types and comparisons leave this function. Never return input values.
export function projectEvent(value:unknown, trusted:ObserverIdentity){
 const e=object(value),p=object(e.payload),m=object(p.event);
 const auth=Array.isArray(p.authorizations)?p.authorizations:[];
 const a=object(auth[0]);
 const installationMatches=auth.length===1&&a.team_id===trusted.teamId&&a.user_id===trusted.botUserId&&a.is_bot===true&&a.is_enterprise_install===false;
 return {
  envelope:shape(e,['type','envelope_id','accepts_response_payload','payload']),
  payload:shape(p,['type','team_id','api_app_id','event_id','event_time','is_ext_shared_channel','authorizations']),
  workspaceMatches:p.team_id===trusted.teamId,appMatches:p.api_app_id===trusted.appId,
  sharing:{present:Object.hasOwn(p,'is_ext_shared_channel'),value:boolean(p.is_ext_shared_channel)},
  authorization:{count:Array.isArray(p.authorizations)?auth.length:null,fields:shape(a,['team_id','user_id','is_bot','is_enterprise_install']),isBot:boolean(a.is_bot),isEnterpriseInstall:boolean(a.is_enterprise_install),installationMatches},
  message:{type:m.type==='message'?'message':'unsupported',fields:shape(m,['channel_type','channel','user','text','ts']),humanMatches:m.user===trusted.humanId,channelMatches:m.channel===trusted.channelId,privateDm:m.channel_type==='im',supported:parseMessage(m)!==null},
  schemaCompatible:envelopeSchema.safeParse(value).success&&installationMatches&&p.team_id===trusted.teamId&&p.api_app_id===trusted.appId&&m.user===trusted.humanId&&m.channel===trusted.channelId&&parseMessage(m)!==null
 };
}
export type Projection = ReturnType<typeof projectEvent>;
export class ObservationError extends Error { constructor(){super('Observation stopped without a confirmed result. Sensitive details withheld.');} }
// Deliberate diagnostic consumption only: no persistence, replies, pairing or business operations.
export async function observeSlack(api:Pick<SlackApi,'identity'|'open'>,connect:SlackConnect,trusted:ObserverIdentity,
 options:{windowMs:number;maxEvents:number},emit:(projection:Projection)=>void,signal?:AbortSignal):Promise<'compatible'|'incompatible'> {
 let socket:SlackSocket|undefined;const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 const stop=()=>abort.abort();signal?.addEventListener('abort',stop,{once:true});
 try{
  observerIdentity.parse(trusted);
  if(!Number.isInteger(options.windowMs)||options.windowMs<1||options.windowMs>60000||!Number.isInteger(options.maxEvents)||options.maxEvents<1||options.maxEvents>3)throw new ObservationError();
  if(signal?.aborted)throw new ObservationError();
  const interrupted=new Promise<never>((_,reject)=>{abort.signal.addEventListener('abort',()=>reject(new ObservationError()),{once:true});timer=setTimeout(stop,options.windowMs);});
  const work=async()=>{
   const identity=await api.identity(abort.signal);
   if(abort.signal.aborted)throw new ObservationError();
   if(identity.teamId!==trusted.teamId||identity.botId!==trusted.botId||identity.userId!==trusted.botUserId)throw new ObservationError();
   const url=await api.open(abort.signal);
   if(abort.signal.aborted)throw new ObservationError();
   socket=await connect(url,abort.signal);
   if(abort.signal.aborted){socket.close();throw new ObservationError();}
   const hello=object(await socket.next(abort.signal));
   if(hello.type!=='hello'||object(hello.connection_info).app_id!==trusted.appId)throw new ObservationError();
   for(let n=0;n<options.maxEvents;n++){
    if(abort.signal.aborted)throw new ObservationError();
    const value:unknown=await socket.next(abort.signal);
    if(Buffer.byteLength(JSON.stringify(value)??'')>MAX_ENVELOPE_BYTES)throw new ObservationError();
    const e=object(value),p=object(e.payload),m=object(p.event);
    // Missing security metadata may be observed, but only this explicitly expected synthetic DM is consumed.
    const id=z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/).parse(e.envelope_id);
    if(e.type!=='events_api'||typeof e.accepts_response_payload!=='boolean'||p.type!=='event_callback'||p.team_id!==trusted.teamId||p.api_app_id!==trusted.appId||m.user!==trusted.humanId||m.channel!==trusted.channelId||!parseMessage(m)||m.text!==SYNTHETIC_OBSERVATION)throw new ObservationError();
    const projection=projectEvent(value,trusted);
    if(abort.signal.aborted)throw new ObservationError();
    await socket.ack(id);
    if(abort.signal.aborted)throw new ObservationError();
    emit(projection); // Acknowledged diagnostic event, never accepted intake.
    if(!projection.schemaCompatible)return 'incompatible' as const;
   }
   return 'compatible' as const;
  };
  return await Promise.race([work(),interrupted]);
 }catch{throw new ObservationError();}
 finally{if(timer)clearTimeout(timer);signal?.removeEventListener('abort',stop);abort.abort();try{socket?.close();}catch{throw new ObservationError();}}
}
