import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {MongoContext} from './connection.js';
import {fence,retireGeneration} from './publication-gc.js';

export const legacyExports=['export_runs','export_messages','export_chat_candidates','export_chat_progress','export_discovery'];
// One-time, resumable consolidation. All provider writers must be stopped before
// deploying schema v2; leases also protect against a concurrent current worker.
export async function consolidateStorage(ctx:MongoContext){
 if(await ctx.collection('schema_migrations').findOne({_id:'storage_v2'}))return;
 const owner=await ctx.lease('umbler');if(!owner)throw new Error('Aguarde o fim da coleta antes de migrar.');
 try{
  const pending:any[]=[];
  const flush=async()=>{
   if(!pending.length)return;
   await ctx.transaction(async session=>{
    await fence(ctx,'umbler',owner,session);
    const existing=await ctx.collection('umbler_chats').find({$or:pending.map(r=>({organization_id:r.organization_id,id:r.id}))},{session}).toArray();
    const byId=new Map(existing.map(r=>[r.organization_id+':'+r.id,r]));
    const operations=pending.map(row=>{
     const current=byId.get(row.organization_id+':'+row.id);
     if(current&&!isDeepStrictEqual(current.raw,row.raw))throw new Error('Conversa divergente: consolidação requer revisão.');
     const {observed_at,service_candidate,_id,...insert}=row;
     return {updateOne:{filter:{organization_id:row.organization_id,id:row.id},update:{$set:{observed_at,service_candidate:true},$setOnInsert:{...insert,_id:current?._id??createHash('sha256').update(JSON.stringify([row.organization_id,row.id])).digest('hex')}},upsert:true}};
    });
    await ctx.collection('umbler_chats').bulkWrite(operations,{session});
   });pending.length=0;
  };
  for await(const row of ctx.collection('umbler_service_chats').find({}).batchSize(250)){pending.push(row);if(pending.length===250)await flush();}
  await flush();
  // These archives were never read by the dashboards. Drop both data and their
  // indexes, instead of leaving empty export collections consuming quota.
  for(const name of ['service_chats',...legacyExports]){
   if(!await ctx.renew('umbler',owner))throw new Error('Posse da migração expirada.');
   await ctx.collection('umbler_'+name).drop().catch(error=>{if(error.code!==26)throw error;});
  }
 }finally{await ctx.release('umbler',owner);}
 for(const provider of ['umbler','google'] as const){
  const held=await ctx.lease(provider);if(!held)throw new Error('Coleta em andamento. Retome a migração.');
  try{
   await ctx.transaction(async session=>{
    await fence(ctx,provider,held,session);
    const r=await ctx.collection('data_revisions').findOne({_id:provider},{session});if(!r)return;
    const entries=provider==='google'?{ads_rows:r.previous}:r.previousGenerations??Object.fromEntries(['contacts','conversations','messages','service_conversations','members'].map(n=>[n,r.previous]));
    for(const [name,generation] of Object.entries(entries))if(typeof generation==='string'&&generation!==(provider==='google'?r.generation:r.generations?.[name]??r.generation)){
     // The old pointer ceased being active no later than its latest publication.
     const at=r.publishedAt instanceof Date?r.publishedAt:new Date();
     await retireGeneration(ctx,provider,name,generation,at,session);
    }
   });
  }finally{await ctx.release(provider,held);}
 }
 await ctx.collection('schema_migrations').updateOne({_id:'storage_v2'},{$setOnInsert:{appliedAt:new Date()}},{upsert:true});
}
