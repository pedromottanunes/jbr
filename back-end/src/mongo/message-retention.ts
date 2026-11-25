import {randomUUID} from 'node:crypto';
import type {MongoContext} from './connection.js';
import {sourceKeys} from './schema.js';
import {messageFacts,messageStorage,messageStorageId,sourceFacts} from './message-storage.js';
import {checkSignal} from './cancellation.js';

// Caller holds the Umbler lease for the whole operation. Each batch fences that
// lease in its transaction, just like collection pages. Retrying is idempotent.
export async function purgeMessageContent(ctx:MongoContext,owner:string,signal?:AbortSignal){
 const guard=async()=>{checkSignal(signal);if(!await ctx.renew('umbler',owner))throw new Error('Posse da limpeza expirada.');};
 await guard();
 let changed=0;
 for(const name of ['messages',...Object.keys(sourceKeys).map(k=>'umbler_'+k)]){
  const collection=ctx.collection(name),cursor=collection.find({}).batchSize(250);
  let batch:any[]=[];
  const flush=async()=>{
   if(!batch.length)return;await guard();const ops=batch;batch=[];
   await ctx.transaction(async session=>{
    const held=await ctx.collection('integration_leases').updateOne({_id:'umbler',owner,expiresAt:{$gt:new Date()}},{$set:{expiresAt:new Date(Date.now()+120000)}},{session});
    if(!held.matchedCount)throw new Error('Posse da limpeza expirada.');
    if((await messageStorage(ctx,session)).storeContent)throw new Error('Armazenamento foi habilitado.');
    await collection.bulkWrite(ops,{ordered:false,session});
   });changed+=ops.length;
  };
  try{for await(const row of cursor){
   const replacement=name==='messages'?messageFacts(row):sourceFacts(name.slice(7),row);
   if(JSON.stringify(replacement)!==JSON.stringify(row))batch.push({replaceOne:{filter:{_id:row._id},replacement}});
   if(batch.length>=250)await flush();
  }await flush();}finally{await cursor.close();}
 }
 await guard();
 await ctx.transaction(async session=>{
  const held=await ctx.collection('integration_leases').updateOne({_id:'umbler',owner,expiresAt:{$gt:new Date()}},{$set:{expiresAt:new Date(Date.now()+120000)}},{session});
  if(!held.matchedCount)throw new Error('Posse da limpeza expirada.');
  await ctx.collection('settings').updateOne({_id:messageStorageId,storeContent:false},{$set:{purgeStatus:'complete',purgedAt:new Date()}},{session});
  await ctx.collection('data_revisions').updateOne({_id:'umbler'},{$set:{privacyVersion:randomUUID()}},{session});
 });
 return {changed};
}

export async function setMessageStorage(ctx:MongoContext,storeContent:boolean,revision:number){
 const owner=await ctx.lease('umbler',120000);if(!owner)throw Object.assign(new Error('Aguarde a sincronização para alterar o armazenamento.'),{statusCode:409});
 try{
  const current=await messageStorage(ctx);if(current.revision!==revision)throw Object.assign(new Error('Configuração alterada em outra aba.'),{statusCode:409});
  if(storeContent&&current.purgeStatus==='running')throw Object.assign(new Error('Conclua a remoção do conteúdo antes de habilitar o armazenamento.'),{statusCode:409});
  await ctx.transaction(async session=>{
   const held=await ctx.collection('integration_leases').updateOne({_id:'umbler',owner,expiresAt:{$gt:new Date()}},{$set:{expiresAt:new Date(Date.now()+120000)}},{session});
   if(!held.matchedCount)throw new Error('Posse da configuração expirada.');
   await ctx.collection('settings').updateOne({_id:messageStorageId},{$set:{storeContent,revision:revision+1,purgeStatus:storeContent?'not-required':'running',updatedAt:new Date()}},{upsert:true,session});
   await ctx.collection('data_revisions').updateOne({_id:'umbler'},{$set:{privacyVersion:randomUUID()}},{session});
  });
  // Cleanup is resumed by the existing worker under the same provider lease.
  // The setting takes effect immediately; the HTTP request never waits for a scan.
  return messageStorage(ctx);
 }finally{await ctx.release('umbler',owner);}
}

export async function resumeContentPurge(ctx:MongoContext,signal?:AbortSignal){
 checkSignal(signal);
 const policy=await messageStorage(ctx);
 if(policy.storeContent||policy.purgeStatus==='complete')return false;
 const owner=await ctx.lease('umbler',120000);if(!owner)return false;
 try{
  if((await messageStorage(ctx)).storeContent)return false;
  await ctx.collection('settings').updateOne({_id:messageStorageId},{$set:{storeContent:false,purgeStatus:'running'},$setOnInsert:{revision:0}},{upsert:true});
  await purgeMessageContent(ctx,owner,signal);return true;
 }finally{await ctx.release('umbler',owner);}
}
