import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {connectMongo} from '../src/server/mongo/connection.js';
import {ensureSchema} from '../src/server/mongo/schema.js';
import {consolidateStorage} from '../src/server/mongo/storage-migration.js';
import {stageGeneration,retireGeneration,cleanPublications,readerGraceMs} from '../src/server/mongo/publication-gc.js';
import {digest,loadSourceRows,normalizeSource,publishUmbler} from '../src/server/mongo/datasets.js';
import {collectUmbler} from '../src/server/mongo/umbler-collect.js';
import {storeSecret} from '../src/server/mongo/secrets.js';
import {ctaTexts} from '../src/server/cta.js';
import {buildApp} from '../src/server/app.js';
import {repackCollection,cleanAbandonedRepacks} from '../src/server/mongo/storage-repack.js';

process.env.NODE_ENV='test';
const prefix='test_'+randomBytes(8).toString('hex')+'_',ctx=await connectMongo(prefix);
const realFetch=globalThis.fetch;
try{
 const now=new Date(),at=new Date(+now-3600000).toISOString();
 const chat={id:'chat',contact:{id:'lead',name:'Fixture',contactType:'DirectMessage'},firstContactMessage:{id:'first',eventAtUTC:at},lastMessage:{eventAtUTC:at},open:true};
 const source={_id:digest(['org','chat']),organization_id:'org',id:'chat',raw:chat};
 await ctx.collection('umbler_chats').insertOne(source);
 await ctx.collection('umbler_service_chats').insertOne({...source,observed_at:at});
 await ctx.collection('umbler_export_messages').insertOne({_id:'archive',unused:true});
 await ensureSchema(ctx);await consolidateStorage(ctx);
 assert.equal((await ctx.collection('umbler_chats').findOne({id:'chat'}))?.observed_at,at);
 assert.equal((await ctx.collection('umbler_chats').findOne({id:'chat'}))?.service_candidate,true);
 assert.equal((await ctx.db.listCollections({},{nameOnly:true}).toArray()).filter(c=>[prefix+'umbler_service_chats',prefix+'umbler_export_messages'].includes(c.name)).length,0);
 const owner=await ctx.lease('umbler');assert.ok(owner);
 // Three fast publications must not delete readers' older versions early.
 await ctx.collection('data_revisions').insertOne({_id:'umbler',generation:'active',generations:{messages:'active'},previousGenerations:{messages:'old2'}});
 for(const generation of ['old1','old2','active','staging']){
  await stageGeneration(ctx,'umbler','messages',generation);
  await ctx.collection('messages').insertOne({_id:generation,id:'probe',generation});
 }
 for(const generation of ['old1','old2'])await retireGeneration(ctx,'umbler','messages',generation,now);
 assert.equal(await cleanPublications(ctx,'umbler',owner!,undefined,new Date(+now+readerGraceMs-1)),0);
 await assert.rejects(cleanPublications(ctx,'umbler','expired',undefined,new Date(+now+readerGraceMs+1)));
 assert.equal(await ctx.collection('messages').countDocuments({}),4);
 assert.equal(await cleanPublications(ctx,'umbler',owner!,undefined,new Date(+now+readerGraceMs+1)),2);
 assert.equal(await ctx.collection('messages').countDocuments({generation:{$in:['active','staging']}}),2);
 await ctx.collection('data_revisions').deleteMany({});await ctx.collection('messages').deleteMany({});
 await ctx.collection('publication_staging').deleteMany({});
 await storeSecret(ctx,'umbler-token','fixture');
 await ctx.collection('integration_state').insertOne({_id:'organizationId',value:'org'});
 await ctx.collection('umbler_service_progress').insertOne({_id:'progress',organization_id:'org',chat_id:'chat',complete:1,until_utc:now.toISOString()});
 let firstReads=0,historyReads=0;
 const provider:typeof fetch=async(input,init)=>{
  assert.equal(init?.method,'GET');const url=new URL(String(input));let body:any;
  if(url.pathname.endsWith('/members/me/'))body={organizations:[{id:'org'}]};
  else if(url.pathname.endsWith('/organizations/org/'))body={organizationMembers:[]};
  else if(url.pathname.endsWith('/messages/first/')){firstReads++;body={id:'first',_t:'MessageModel',source:'Contact',messageType:'Text',eventAtUTC:at,content:ctaTexts()[0]};}
  else if(url.pathname.endsWith('/relative-messages/')){historyReads++;throw new Error('Unchanged history must not be fetched');}
  else body={items:[]};
  return new Response(JSON.stringify(body),{status:200});
 };
 await collectUmbler(ctx,owner!,90,12,{fetcher:provider,intervalMs:0});
 await collectUmbler(ctx,owner!,90,12,{fetcher:provider,intervalMs:0});
 assert.equal(firstReads,1);assert.equal(historyReads,0);
 const stored=await ctx.collection('umbler_messages').findOne({id:'first'});
 assert.ok(stored?.raw.ctaKey);assert.equal(stored?.raw.content,undefined);
 assert.equal(await ctx.collection('umbler_service_coverage').countDocuments({}),0,'Fetching first message must not claim full history coverage');
 // An unavailable first message is retried only after the cooldown, not per filter/sync.
 await ctx.collection('umbler_messages').deleteMany({});await ctx.collection('umbler_first_message_checks').deleteMany({});let unavailable=0;
 const missing:typeof fetch=async(input,init)=>{if(new URL(String(input)).pathname.endsWith('/messages/first/')){unavailable++;return new Response('{}',{status:404});}return provider(input,init);};
 await collectUmbler(ctx,owner!,90,12,{fetcher:missing,intervalMs:0});
 await collectUmbler(ctx,owner!,90,12,{fetcher:missing,intervalMs:0});assert.equal(unavailable,1);
 // When a necessary history page contains the first message, no extra lookup.
 await ctx.collection('umbler_service_progress').deleteMany({});
 await ctx.collection('umbler_first_message_checks').deleteMany({});
 const history:typeof fetch=async(input,init)=>{
  const url=new URL(String(input));
  if(url.pathname.endsWith('/relative-messages/')){historyReads++;return new Response(JSON.stringify({messages:[{id:'first',_t:'MessageModel',source:'Contact',eventAtUTC:at,content:ctaTexts()[0]}]}),{status:200});}
  if(url.pathname.endsWith('/messages/first/'))throw new Error('Duplicate first-message fetch');
  return provider(input,init);
 };
 await collectUmbler(ctx,owner!,90,12,{fetcher:history,intervalMs:0});assert.equal(historyReads,1);assert.equal(firstReads,1);
 await ctx.release('umbler',owner!);
 // Switching periods must not contact Umbler/Google or enqueue background work.
 const jobs=await ctx.collection('sync_jobs').countDocuments({});let external=0;
 globalThis.fetch=async()=>{external++;throw new Error('No provider call permitted');};
 const app=buildApp({mode:'mongo',mongo:ctx});
 try{
  for(const period of ['start=2026-10-01&end=2026-10-31','start=2026-11-01&end=2026-11-25','start=2026-10-01&end=2026-10-31'])for(const route of ['attendance','attendance/agents','funnel']){
   const response=await app.inject({method:'GET',url:'/api/v1/'+route+'?'+period,headers:{host:'127.0.0.1'}});assert.equal(response.statusCode,200);
  }
 }finally{await app.close();}
 assert.equal(external,0);assert.equal(await ctx.collection('sync_jobs').countDocuments({}),jobs);
 await ctx.collection('messages').insertOne({_id:'old-hash',id:'fixture-event',generation:'fixture',at,ctaKey:'fixture-cta',private:0});
 const published=await ctx.collection('messages').find({},{projection:{_id:0}}).sort({generation:1,id:1}).toArray();
 await assert.rejects(repackCollection(ctx,'messages',async()=>{throw new Error('Interrupted');}));
 assert.deepEqual(await ctx.collection('messages').find({},{projection:{_id:0}}).sort({generation:1,id:1}).toArray(),published);
 await repackCollection(ctx,'messages',async()=>{});
 assert.deepEqual(await ctx.collection('messages').find({},{projection:{_id:0}}).sort({generation:1,id:1}).toArray(),published);
 const abandoned='repack_messages_0123456789abcdef';
 await ctx.collection(abandoned).insertOne({_id:'temporary'});
 await ctx.collection('storage_repacking').insertOne({_id:abandoned,name:'messages',createdAt:new Date()});
 const busy=await ctx.lease('worker');assert.ok(busy);await cleanAbandonedRepacks(ctx);
 assert.equal(await ctx.collection(abandoned).countDocuments({}),1);
 await ctx.release('worker',busy!);await cleanAbandonedRepacks(ctx);
 assert.equal((await ctx.db.listCollections({},{nameOnly:true}).toArray()).some(c=>c.name===prefix+abandoned),false);
 assert.deepEqual(await ctx.collection('messages').find({},{projection:{_id:0}}).sort({generation:1,id:1}).toArray(),published);
 console.log('Aprovados: migração idempotente, retenção com carência, proteção de versões ativas, CTA por mensagem única, retomada sem releitura, indisponibilidade sem repetição e períodos sem chamadas externas.');
}finally{
 globalThis.fetch=realFetch;
 if(!/^test_[a-f0-9]{16}_$/.test(prefix))throw new Error('Prefixo inválido');
 for(const c of await ctx.db.listCollections({},{nameOnly:true}).toArray())if(c.name.startsWith(prefix))await ctx.db.collection(c.name).drop();
 await ctx.close();
}
