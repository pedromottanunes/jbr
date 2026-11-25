import {createHash,randomBytes} from 'node:crypto';
import {BSON} from 'mongodb';
import type {MongoContext} from './connection.js';

const views=['contacts','conversations','messages','service_conversations','members','ads_rows'];
export const repackable=[...views,'umbler_messages','umbler_chats','umbler_service_events'];
// Offline maintenance only. Data is copied, indexed and verified before an
// atomic collection rename; the original remains intact on any earlier error.
export async function repackCollection(ctx:MongoContext,name:string,guard:()=>Promise<void>){
 if(!repackable.includes(name))throw new Error('Coleção não permitida.');
 const temp='repack_'+name+'_'+randomBytes(8).toString('hex'),source=ctx.collection(name),target=ctx.collection(temp);
 const sort=views.includes(name)?{generation:1,id:1}:{_id:1};
 const fingerprint=async(collection:typeof source)=>{
  const hash=createHash('sha256');let count=0;
  for await(const row of collection.find({}).sort(sort as any).batchSize(500)){const {_id,...facts}=row;hash.update(BSON.EJSON.stringify(facts,{relaxed:false})+'\n');count++;}
  return {hash:hash.digest('hex'),count};
 };
 let swapped=false;
 try{
  await guard();
  await ctx.collection('storage_repacking').insertOne({_id:temp,name,createdAt:new Date()});
  for(const index of await source.listIndexes().toArray())if(index.name!=='_id_'){
   const {v,ns,key,...options}=index;await target.createIndex(key,options);
  }
  let batch:any[]=[],position=0,active:string|undefined;
  const flush=async()=>{if(!batch.length)return;await guard();await target.insertMany(batch);batch=[];};
  for await(const row of source.find({}).sort(sort as any).batchSize(500)){
   if(views.includes(name)){if(active!==row.generation){active=row.generation;position=0;}row._id=row.generation+':'+(position++).toString(36);}
   batch.push(row);if(batch.length===500)await flush();
  }
  await flush();await guard();
  const before=await fingerprint(source),after=await fingerprint(target);
  if(before.count!==after.count||before.hash!==after.hash)throw new Error('Cópia divergente. Original preservado.');
  await guard();await target.rename(ctx.prefix+name,{dropTarget:true});swapped=true;
  return {name,count:before.count,verified:true};
 }finally{
  if(!swapped)await target.drop().catch(error=>{if(error.code!==26)throw error;});
  await ctx.collection('storage_repacking').deleteOne({_id:temp});
 }
}
// A killed maintenance process may leave only its temporary copy. Its worker
// lease must expire before another process can remove that copy. Never target
// the source name or infer arbitrary collection names from user input.
export async function cleanAbandonedRepacks(ctx:MongoContext){
 if(!await ctx.collection('storage_repacking').findOne({},{projection:{_id:1}}))return;
 const owner=await ctx.lease('worker');if(!owner)return;
 try{
  for(const row of await ctx.collection('storage_repacking').find({}).limit(20).toArray()){
   if(!repackable.includes(row.name)||!new RegExp('^repack_'+row.name+'_[a-f0-9]{16}$').test(row._id))throw new Error('Temporário de manutenção inválido.');
   if(!await ctx.renew('worker',owner))throw new Error('Posse da manutenção expirada.');
   await ctx.collection(row._id).drop().catch(error=>{if(error.code!==26)throw error;});
   await ctx.collection('storage_repacking').deleteOne({_id:row._id});
  }
 }finally{await ctx.release('worker',owner);}
}
