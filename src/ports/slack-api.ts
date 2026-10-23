export class SlackApiError extends Error {
 constructor(readonly kind:'transient'|'permanent',readonly retryAfter=5){super('Slack transport unavailable.');}
}
export interface SlackApi {
 identity(signal:AbortSignal):Promise<{teamId:string;botId:string;userId:string}>;
 open(signal:AbortSignal):Promise<string>;
 send(channel:string,text:string,signal:AbortSignal):Promise<void>;
}
export interface SlackSocket {
 next(signal:AbortSignal):Promise<unknown>;
 ack(envelopeId:string):Promise<void>;
 close():void;
}
export type SlackConnect=(url:string,signal:AbortSignal)=>Promise<SlackSocket>;
