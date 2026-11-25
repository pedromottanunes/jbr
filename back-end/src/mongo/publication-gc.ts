import type {ClientSession} from 'mongodb';
import type {MongoContext} from './connection.js';
import {cleanAbandonedRepacks} from './storage-repack.js';

type Provider='google'|'umbler';
const names=['contacts','conversations','messages','service_conversations','members','ads_rows'];
// Reads time out long before this interval. Retention starts at the pointer
// switch, never at creation of a possibly months-old active version.
export const readerGraceMs=5*60_000;
const key=(name:string,generation:string)=>name+':'+generation;
export async function stageGeneration(ctx:MongoContext,provider:Provider,name:string,generation:string){
 await ctx.collection('publication_staging').updateOne({_id:key(name,generation)},{$setOnInsert:{provider,name,generation,createdAt:new Date()}},{upsert:true});
}
export async function retireGeneration(ctx:MongoContext,provider:Provider,name:string,generation:string,at:Date,session?:ClientSession){
 await ctx.collection('publication_staging').updateOne({_id:key(name,generation)},{$setOnInsert:{provider,name,generation,createdAt:at},$set:{retiredAt:at,deleteAfter:new Date(+at+readerGraceMs)}},{upsert:true,session});
}
export async function fence(ctx:MongoContext,provider:Provider,owner:string,session:ClientSession){
 const r=await ctx.collection('integration_leases').updateOne({_id:provider,owner,expiresAt:{$gt:new Date()}},{$set:{expiresAt:new Date(Date.now()+120_000)}},{session});
 if(!r.matchedCount)throw new Error('Posse da manutenção expirada.');
}
export async function cleanPublications(ctx:MongoContext,provider:Provider,owner:string,signal?:AbortSignal,now=new Date()){
 const revision=await ctx.collection('data_revisions').findOne({_id:provider});
 const candidates=await ctx.collection('publication_staging').find({provider,$or:[{deleteAfter:{$lte:now}},{deleteAfter:{$exists:false},createdAt:{$lt:new Date(+now-86400000)}}]}).sort({createdAt:1}).limit(20).toArray();
 let deleted=0;
 for(const row of candidates){
  signal?.throwIfAborted();
  if(!names.includes(row.name)||(provider==='google')!==(row.name==='ads_rows'))throw new Error('Coleção de publicação inválida.');
  const generation=row.generation??row._id;
  const active=provider==='google'?revision?.generation:revision?.generations?.[row.name]??revision?.generation;
  const previous=provider==='google'?revision?.previous:revision?.previousGenerations?.[row.name]??revision?.previous;
  if(generation===active||(!row.deleteAfter&&generation===previous))continue;
  // Bounded, fenced transactions only touch the exact retired generation.
  for(;;){
   signal?.throwIfAborted();
   const batch=await ctx.collection(row.name).find({generation},{projection:{_id:1}}).limit(1000).toArray();
   if(!batch.length)break;
   await ctx.transaction(async session=>{await fence(ctx,provider,owner,session);await ctx.collection(row.name).deleteMany({generation,_id:{$in:batch.map(d=>d._id)}},{session});});
   deleted+=batch.length;
  }
  await ctx.transaction(async session=>{
   await fence(ctx,provider,owner,session);
   const field=provider==='google'?'previous':'previousGenerations.'+row.name;
   await ctx.collection('data_revisions').updateOne({_id:provider,[field]:generation},{$unset:{[field]:''}},{session});
   await ctx.collection('publication_staging').deleteOne({_id:row._id},{session});
  });
 }
 return deleted;
}
// Runs even when no provider job is queued. The worker throttles maintenance.
export async function maintainPublications(ctx:MongoContext,signal?:AbortSignal){
 await cleanAbandonedRepacks(ctx);
 let deleted=0;
 for(const provider of ['umbler','google'] as const){
  signal?.throwIfAborted();const owner=await ctx.lease(provider);if(!owner)continue;
  try{deleted+=await cleanPublications(ctx,provider,owner,signal);}finally{await ctx.release(provider,owner);}
 }
 return deleted;
}
