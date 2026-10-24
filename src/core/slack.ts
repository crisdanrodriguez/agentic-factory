import { z } from 'zod';
import { parseRequest, validIdentifier, type IntakeSource } from './intake.js';
export const slackId = (prefix: string) => z.string().regex(new RegExp(`^[${prefix}][A-Z0-9]{2,63}$`));
export const teamId = slackId('T');
export const userId = slackId('UW');
export const channelId = slackId('D');
export const appId = slackId('A');
export const eventId = z.string().regex(/^Ev[A-Z0-9]{2,63}$/);
export const MAX_ENVELOPE_BYTES = 65536;
const opaque = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
// Authorization describes the installation, not the human message sender.
// Missing sharing metadata is unknown, not evidence of a non-shared DM.
export const envelopeSchema = z.object({ type:z.literal('events_api'),envelope_id:opaque,accepts_response_payload:z.boolean(),
  payload:z.object({type:z.literal('event_callback'),team_id:teamId,api_app_id:appId,event_id:eventId,
    event_time:z.number().int().nonnegative(),is_ext_shared_channel:z.literal(false),
    authorizations:z.array(z.object({team_id:teamId,user_id:userId,is_bot:z.literal(true),is_enterprise_install:z.literal(false)})).length(1),
    event:z.unknown()}) });
const messageSchema = z.object({type:z.literal('message'),channel_type:z.literal('im'),channel:channelId,user:userId,
  text:z.string().min(1).max(4000),ts:z.string().regex(/^[0-9]{1,16}\.[0-9]{6}$/)}).passthrough();
export function parseMessage(value: unknown): z.infer<typeof messageSchema> | null {
 const parsed=messageSchema.safeParse(value);if(!parsed.success)return null;
 const m=parsed.data;
 if(['subtype','bot_id','bot_profile','edited','thread_ts','files','attachments','hidden','reply_to','message','previous_message'].some(k=>Object.hasOwn(m,k)) || Buffer.byteLength(m.text)>16000 || Buffer.from(m.text).toString('utf8')!==m.text)return null;
 return m;
}
export type SlackCommand = {kind:'help'|'cancel'|'invalid'} | {kind:'claim';code:string} | {kind:'new';source:IntakeSource} | {kind:'status';id:string} | {kind:'list';after:string};
export function command(text:string):SlackCommand {
 if(text==='help')return {kind:'help'};
 if(text==='cancel'||text.startsWith('cancel '))return {kind:'cancel'};
 if(/^pair [a-f0-9]{64}$/.test(text))return {kind:'claim',code:text.slice(5)};
 try {
  if(text.startsWith('new ')){const source:IntakeSource={kind:'slack',bytes:Buffer.from(text.slice(4))};parseRequest(source);return {kind:'new',source};}
  if(text.startsWith('status '))return {kind:'status',id:validIdentifier(text.slice(7))};
  if(text==='list')return {kind:'list',after:''};
  if(text.startsWith('list after '))return {kind:'list',after:validIdentifier(text.slice(11))};
 }catch{ /* Invalid input is terminal, never echoed. */ }
 return {kind:'invalid'};
}
export const HELP='Commands: help, new {"objective":"...","context":"..."}, status ID, list [after ID]. Requests are recorded only; execution is not authorized. Do not send secrets. cancel is unavailable.';
export function recorded(id:string,revision:string):string{return `Request ${id} ${revision} recorded. Execution has not been authorized.`;}
