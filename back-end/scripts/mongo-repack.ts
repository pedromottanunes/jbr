import 'dotenv/config';
import {connectMongo} from '../src/mongo/connection.js';
import {checkSchema} from '../src/mongo/schema.js';
import {repackable,repackCollection} from '../src/mongo/storage-repack.js';

async function main(){
 const ctx=await connectMongo(),held:string[]=[];let timer:ReturnType<typeof setInterval>|undefined;
 try{
  await checkSchema(ctx);
  if(!process.argv.includes('--apply')){const s=await ctx.db.command({dbStats:1});console.log(JSON.stringify({dataBytes:s.dataSize,indexBytes:s.indexSize,requiresOffline:true,collections:repackable}));return;}
  let online=false;try{online=(await fetch('http://127.0.0.1:'+(process.env.PORT??3000)+'/api/ready',{signal:AbortSignal.timeout(1000)})).ok;}catch{}
  if(online)throw new Error('Pare a API antes da manutenção.');
  const owner=await ctx.lease('worker');if(!owner)throw new Error('Worker ocupado.');held.push('worker');
  let lost=false;
  const guard=async()=>{if(lost)throw new Error('Posse da manutenção expirada.');for(const name of held)if(!await ctx.renew(name,owner)){lost=true;throw new Error('Posse da manutenção expirada.');}};
  try{
   for(const name of ['umbler','google','schema']){if(!await ctx.lease(name,120000,owner))throw new Error('Coleta ou migração em andamento.');held.push(name);}
   timer=setInterval(()=>{void guard().catch(()=>{lost=true;});},20000);
   for(const name of repackable){const s=await ctx.db.command({collStats:name});if(s.totalIndexSize>=512*1024)console.log(JSON.stringify(await repackCollection(ctx,name,guard)));}
   const s=await ctx.db.command({atlasSize:1});console.log(JSON.stringify({atlasMiB:s.atlasSize/1048576}));
  }finally{if(timer)clearInterval(timer);for(const name of held)await ctx.release(name,owner);}
 }finally{await ctx.close();}
}
main().catch(()=>{console.error('Manutenção interrompida. As coleções só são substituídas após validar a cópia integral. Verifique conexão, permissões e se a API está parada.');process.exitCode=1;});
