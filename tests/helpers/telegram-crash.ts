// Only synthetic local database credentials; this helper is never a production entry point.
import { TelegramStore } from '../../src/adapters/postgres/telegram-store.js';
const store=new TelegramStore('postgres://af_telegram_bot:synthetic-local-runtime-only@127.0.0.1:55432/agentic_factory_local','synthetic-telegram','af_telegram_bot','bot');
await store.start();
await store.capture([{update_id:100,message:{message_id:101,date:1792600000,from:{id:900002,is_bot:false},chat:{id:900002,type:'private'},text:'/new {"objective":"Synthetic crash","context":"Recovery only"}'}}]);
if(process.argv[2]==='processed')await store.processOne();
process.stdout.write('SYNTHETIC_COMMIT_COMPLETE\n');
setInterval(()=>{},1000);
