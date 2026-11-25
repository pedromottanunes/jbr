import type {MongoContext} from './connection.js';
import {consolidateStorage} from './storage-migration.js';

export const schemaVersion=2;
export const sourceKeys:Record<string,string[]>={
 channels:['organization_id','id'],chats:['organization_id','id'],messages:['organization_id','chat_id','id'],chat_sync:['organization_id','chat_id'],discovery:['organization_id'],
 crm_members:['organization_id','id'],service_events:['organization_id','chat_id','id'],service_coverage:['organization_id','chat_id','start_utc'],service_progress:['organization_id','chat_id'],service_ratings:['organization_id','id'],first_message_checks:['organization_id','chat_id'],
};
export const viewNames=['contacts','conversations','messages','service_conversations','members'] as const;
export async function ensureSchema(ctx:MongoContext){
 const owner=await ctx.lease('schema',120000);if(!owner)throw new Error('Migração do banco já em andamento.');
 try{
  for(const name of [...viewNames,'ads_rows'])await ctx.collection(name).createIndex({generation:1,id:1},{unique:true,name:'generation_identity'});
  await ctx.collection('contacts').createIndex({generation:1,firstInboundAt:-1,id:1});
  await ctx.collection('contacts').createIndex({generation:1,'tags.name':1});
  await ctx.collection('conversations').createIndex({generation:1,at:-1,id:1});
  await ctx.collection('conversations').createIndex({generation:1,contact_id:1});
  await ctx.collection('messages').createIndex({generation:1,chat_id:1,at:-1,messageId:-1});
  await ctx.collection('ads_rows').createIndex({generation:1,kind:1,position:1});
  for(const [name,keys] of Object.entries(sourceKeys))await ctx.collection('umbler_'+name).createIndex(Object.fromEntries(keys.map(k=>[k,1])) as any,{unique:true,name:'source_identity'});
  await ctx.collection('sync_jobs').createIndex({status:1,availableAt:1});
  await ctx.collection('publication_staging').createIndex({provider:1,createdAt:1});
  await ctx.collection('publication_staging').createIndex({provider:1,deleteAfter:1});
  await ctx.collection('umbler_chats').createIndex({organization_id:1,service_candidate:1});
  await ctx.collection('integration_leases').createIndex({expiresAt:1},{expireAfterSeconds:0});
  await ctx.collection('oauth_cache').createIndex({expiresAt:1},{expireAfterSeconds:0});
  await consolidateStorage(ctx);
  await ctx.collection('schema_migrations').updateOne({_id:'schema_v2'},{$setOnInsert:{version:schemaVersion,appliedAt:new Date()}},{upsert:true});
 }finally{await ctx.release('schema',owner);}
}
export async function checkSchema(ctx:MongoContext){if(!await ctx.collection('schema_migrations').findOne({_id:'schema_v2',version:schemaVersion}))throw new Error('Prepare o banco com npm run mongo:setup.');}
