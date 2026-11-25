import 'dotenv/config';
import {mkdir,writeFile} from 'node:fs/promises';
import {createWriteStream,createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {createGzip} from 'node:zlib';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {resolve,join} from 'node:path';
import {BSON} from 'mongodb';
import {connectMongo} from '../src/server/mongo/connection.js';
import {messageFacts,sourceFacts} from '../src/server/mongo/message-storage.js';

async function main(){
 const ctx=await connectMongo(),owner=await ctx.lease('worker',120000);if(!owner){await ctx.close();throw new Error('Worker em execução. Aguarde o lote terminar.');}
 const resources=['worker'];let lost=false;
 const renew=async()=>{for(const resource of resources)if(!await ctx.renew(resource,owner))lost=true;};
 const timer=setInterval(()=>{void renew().catch(()=>{lost=true;});},20000);
 try{
  for(const resource of ['umbler','google']){if(!await ctx.lease(resource,120000,owner))throw new Error('Coleta em execução.');resources.push(resource);}
  const state=async()=>JSON.stringify(await Promise.all(['data_revisions','settings','google_budget_snapshots','google_budget_limits','integration_credentials','integration_state','sync_jobs'].map(name=>ctx.collection(name).find({}).sort({_id:1}).toArray())));
  const before=await state();
  const folder=resolve('local-data/backups/atlas-'+new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(folder,{recursive:true});
  const manifest:{collection:string;count:number;sha256:string}[]=[];
  for(const {name} of await ctx.db.listCollections({},{nameOnly:true}).toArray()){
   if(name.startsWith('test_')||['oauth_cache','integration_leases'].includes(name))continue;
   if(!/^[a-z][a-z0-9_]*$/.test(name))throw new Error('Nome de coleção inesperado.');
   let count=0;const cursor=ctx.db.collection(name).find({}).batchSize(500);
   async function* documents(){for await(const doc of cursor){if(lost)throw new Error('Posse do backup expirada.');count++;const safe=name==='messages'?messageFacts(doc):name.startsWith('umbler_')?sourceFacts(name.slice(7),doc):doc;yield BSON.EJSON.stringify(safe,{relaxed:false})+'\n';}}
   const file=join(folder,name+'.jsonl.gz');await pipeline(Readable.from(documents()),createGzip(),createWriteStream(file,{flags:'wx',mode:0o600}));
   const hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);manifest.push({collection:name,count,sha256:hash.digest('hex')});
  }
  await renew();if(lost||await state()!==before)throw new Error('Dados alterados durante exportação.');
  await writeFile(join(folder,'manifest.json'),JSON.stringify({version:1,createdAt:new Date(),messageContent:false,collections:manifest,credentials:'Criptografadas; a chave externa não está neste backup.'},null,2),{mode:0o600});
  console.log('Backup Atlas criado em local-data/backups. Coleções:',manifest.length);
 }finally{clearInterval(timer);for(const resource of resources)await ctx.release(resource,owner);await ctx.close();}
}
main().catch(()=>{console.error('Backup não concluído. Preserve a cópia anterior e tente novamente após finalizar a coleta.');process.exitCode=1;});
