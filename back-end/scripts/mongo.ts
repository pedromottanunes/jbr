import 'dotenv/config';
import {connectMongo} from '../src/mongo/connection.js';
import {ensureSchema,checkSchema} from '../src/mongo/schema.js';
import {enqueue,jobStatus,type JobKind} from '../src/mongo/jobs.js';
import {runWorkerOnce} from '../src/mongo/worker.js';
import {runWorkerLoop} from '../src/mongo/worker-loop.js';
import {readFile,appendFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {windowsProtect} from '../src/integrations/google-oauth.js';
import {storeSecret} from '../src/mongo/secrets.js';
import {pause,WorkerStopping} from '../src/mongo/cancellation.js';
import {maintainPublications} from '../src/mongo/publication-gc.js';
import {resumeContentPurge} from '../src/mongo/message-retention.js';

let stopping=false;
const shutdown=new AbortController();
for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>{
 stopping=true;shutdown.abort(new WorkerStopping());
 setTimeout(()=>process.exit(1),25000).unref();
});
const wait=(ms=5000)=>pause(ms,shutdown.signal).catch(error=>{if(!stopping)throw error;});
async function main(){
 const command=process.argv[2]??'check';
 if(command==='worker'&&process.env.APP_MODE!=='mongo'){console.log('Worker Atlas aguardando ativação de APP_MODE=mongo.');while(!stopping)await wait();return;}
 const ctx=await connectMongo();
 try{
  if(command==='setup'){await ensureSchema(ctx);console.log('Coleções e índices Atlas preparados.');return;}
  if(command==='check'){await ctx.db.command({ping:1});console.log('Conexão autenticada com Atlas confirmada.');return;}
  await checkSchema(ctx);
  if(command==='compact'){console.log(JSON.stringify({removedObsoleteDocuments:await maintainPublications(ctx,shutdown.signal)}));return;}
  if(command==='purge-content'){await resumeContentPurge(ctx,shutdown.signal);console.log('Política de conteúdo aplicada. Indicadores preservados.');return;}
  if(command==='credentials'){
   if(!process.env.CREDENTIALS_ENCRYPTION_KEY){const key=randomBytes(32).toString('base64');await appendFile('.env','\nCREDENTIALS_ENCRYPTION_KEY='+key+'\n');process.env.CREDENTIALS_ENCRYPTION_KEY=key;}
   const google=process.env.GOOGLE_ADS_REFRESH_TOKEN||await windowsProtect(await readFile(resolve('local-data/google-refresh-token.dpapi'),'utf8'),false);
   const umbler=process.env.UMBLER_TALK_TOKEN||await windowsProtect(await readFile(join(process.env.LOCALAPPDATA??'','UmblerTalkReader','api_token.dpapi'),'utf8'),false);
   await storeSecret(ctx,'google-refresh',google);await storeSecret(ctx,'umbler-token',umbler);console.log('Tokens protegidos no Atlas. Chave de criptografia mantida somente no .env privado.');return;
  }
  if(command==='worker'){
   console.log('Worker Atlas ativo.');
   await runWorkerLoop(ctx,shutdown.signal);return;
  }
  if(['google','umbler','budget'].includes(command)){
   if(process.env.APP_MODE!=='mongo'||process.env.INTEGRATIONS_ENABLED!=='true')throw new Error('As integrações Atlas precisam estar ativadas.');
   const arg=(key:string)=>{const n=process.argv.indexOf(key);return n<0?undefined:process.argv[n+1];};
   const payload=command==='umbler'?{days:Number(arg('--days')??90),maxRequests:Number(arg('--max-requests')??150)}:command==='budget'?{force:true}:arg('--start')?{start:arg('--start'),end:arg('--end')}:{};
   if(command==='umbler'&&(!Number.isInteger((payload as any).days)||(payload as any).days<1||(payload as any).days>366||!Number.isInteger((payload as any).maxRequests)||(payload as any).maxRequests<1||(payload as any).maxRequests>150))throw new Error('Parâmetros de coleta inválidos.');
   await enqueue(ctx,command as JobKind,{...payload,refresh:true});
   do{await runWorkerOnce(ctx,shutdown.signal);const status=await jobStatus(ctx,command as JobKind);if(status.status!=='running'){console.log(JSON.stringify(status));if(status.status==='error')process.exitCode=1;return;}await wait();}while(!stopping);
   return;
  }
  throw new Error('Comando MongoDB desconhecido.');
 }finally{await ctx.close();}
}
main().catch(()=>{console.error('Operação Atlas não concluída. Verifique configuração, conexão e permissões; nenhuma credencial foi registrada no log.');process.exitCode=1;});
