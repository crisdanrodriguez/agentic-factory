import WebSocket from 'ws';
import { MAX_ENVELOPE_BYTES } from '../../core/slack.js';
import { SlackApiError,type SlackSocket } from '../../ports/slack-api.js';
import { socketUrl } from './https-api.js';
// Bounded raw-message reassembly and buffering; compression/redirects are disabled.
export function connectSlack(url:string,signal:AbortSignal):Promise<SlackSocket>{
 socketUrl(url);
 return new Promise((resolve,reject)=>{
  const ws=new WebSocket(url,{maxPayload:MAX_ENVELOPE_BYTES,perMessageDeflate:false,followRedirects:false,handshakeTimeout:10000,rejectUnauthorized:true});
  let alive=true;const heartbeat=setInterval(()=>{if(!alive){stop();return;}alive=false;if(ws.readyState===WebSocket.OPEN)ws.ping();},20000);
  ws.on('pong',()=>{alive=true;});
  const queue:unknown[]=[];let waiting:{resolve:(value:unknown)=>void;reject:(e:Error)=>void}|undefined;let dead=false;let opened=false;
  const stop=()=>{if(dead)return;dead=true;clearInterval(heartbeat);ws.terminate();waiting?.reject(new SlackApiError('transient'));waiting=undefined;queue.length=0;signal.removeEventListener('abort',stop);if(!opened)reject(new SlackApiError('transient'));};
  signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();
  ws.on('error',stop);ws.on('close',stop);
  ws.on('message',(data,binary)=>{
   if(dead)return;
   try{
    if(binary||queue.length>=20)throw Error();
    const bytes=Array.isArray(data)?Buffer.concat(data):Buffer.from(data instanceof ArrayBuffer?new Uint8Array(data):data);
    if(bytes.length>MAX_ENVELOPE_BYTES)throw Error();
    const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(waiting){const consumer=waiting;waiting=undefined;consumer.resolve(value);}else queue.push(value);
   }catch{stop();}
  });
  ws.once('open',()=>{if(dead)return;opened=true;resolve({
   next:async(s)=>{if(dead||s.aborted)throw new SlackApiError('transient');if(queue.length)return queue.shift();if(waiting)throw new SlackApiError('permanent');return new Promise((resolve,reject)=>{waiting={resolve,reject};});},
   ack:async(id)=>{if(dead||ws.bufferedAmount>4096)throw new SlackApiError('transient');await new Promise<void>((resolve,reject)=>ws.send(JSON.stringify({envelope_id:id}),e=>e?reject(new SlackApiError('transient')):resolve()));},
   close:stop
  });});
 });
}
