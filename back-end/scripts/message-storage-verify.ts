import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {connectMongo} from '../src/mongo/connection.js';
import {ensureSchema} from '../src/mongo/schema.js';
import {messageStorage} from '../src/mongo/message-storage.js';
import {setMessageStorage,resumeContentPurge} from '../src/mongo/message-retention.js';
import {sourceRow,saveSourceBatch,type SourceBatch} from '../src/mongo/source-batch.js';
import {loadSourceRows,normalizeSource,publishUmbler,MongoReads} from '../src/mongo/datasets.js';
import {buildApp} from '../src/app.js';
import {ctaTexts} from '../src/cta.js';

async function main(){
 const prefix='test_'+randomBytes(8).toString('hex')+'_',ctx=await connectMongo(prefix);
 const secret='PRIVATE-FIXTURE-CONTENT',at='2026-11-21T11:00:00.000Z';let app:ReturnType<typeof buildApp>|undefined;
 try{
  await ensureSchema(ctx);assert.equal((await messageStorage(ctx)).storeContent,false);
  await resumeContentPurge(ctx);
  const opted=await setMessageStorage(ctx,true,0);assert.equal(opted.storeContent,true);
  await assert.rejects(setMessageStorage(ctx,false,0));
  const owner=await ctx.lease('umbler');assert.ok(owner);
  await assert.rejects(setMessageStorage(ctx,false,opted.revision));
  const batch:SourceBatch={};
  sourceRow(batch,'chats',['organization_id','id'],{organization_id:'org',id:'chat',raw:{contact:{id:'lead',name:'Fixture',contactType:'DirectMessage'},firstContactMessage:{eventAtUTC:at,content:ctaTexts()[0]},lastMessage:{eventAtUTC:at,content:secret}},observed_at:at});
  sourceRow(batch,'messages',['organization_id','chat_id','id'],{organization_id:'org',chat_id:'chat',id:'message',event_at_utc:at,raw:{source:'Contact',messageType:'Text',content:ctaTexts()[0],quotedMessage:{content:secret},attachments:[{url:secret}]}});
  await saveSourceBatch(ctx,owner!,batch);
  await ctx.collection('integration_state').insertOne({_id:'publishedAt',value:at});
  await publishUmbler(ctx,normalizeSource(await loadSourceRows(ctx)),owner!);
  const reads=new MongoReads(ctx),before=await reads.analytics();assert.ok(before.funnel[0].messages[0].content);
  app=buildApp({mode:'mongo',mongo:ctx});
  const metadataOnly=await app.inject({method:'GET',url:'/api/v1/conversations/org%3Achat?message=message',headers:{host:'127.0.0.1'}});
  assert.equal(metadataOnly.statusCode,200);assert.equal(metadataOnly.json().chat.contact_id,'org:lead');
  assert.deepEqual(metadataOnly.json().messages,[]);assert.equal(metadataOnly.json().focusMessage,null);
  assert.ok(!metadataOnly.body.includes(secret));assert.ok(!metadataOnly.body.includes(ctaTexts()[0]));
  await ctx.collection('messages').insertOne({_id:'older-copy',generation:'older',id:'old',chat_id:'org:chat',at,content:secret});
  await ctx.release('umbler',owner!);
  const disabled=await setMessageStorage(ctx,false,opted.revision);assert.equal(disabled.purgeStatus,'running');
  const hidden=await app.inject({method:'GET',url:'/api/v1/conversations/org%3Achat',headers:{host:'127.0.0.1'}});
  assert.equal(hidden.statusCode,200);assert.deepEqual(hidden.json().messages,[]);assert.equal(hidden.json().contentStorageEnabled,false);
  const hiddenMetrics=await reads.analytics();assert.equal(hiddenMetrics.funnel[0].messages[0].content,undefined);assert.ok(hiddenMetrics.funnel[0].messages[0].ctaKey);
  const aborted=new AbortController();aborted.abort();await assert.rejects(resumeContentPurge(ctx,aborted.signal));
  await resumeContentPurge(ctx);assert.equal((await messageStorage(ctx)).purgeStatus,'complete');
  for(const name of ['messages','umbler_messages','umbler_chats']){
   const serialized=JSON.stringify(await ctx.collection(name).find({}).toArray());assert.ok(!serialized.includes(secret));assert.ok(!serialized.includes(ctaTexts()[0]));
  }
  const resumedOwner=await ctx.lease('umbler');assert.ok(resumedOwner);await saveSourceBatch(ctx,resumedOwner!,batch);await publishUmbler(ctx,normalizeSource(await loadSourceRows(ctx)),resumedOwner!);await ctx.release('umbler',resumedOwner!);
  assert.equal(await ctx.collection('umbler_messages').countDocuments({}),1);
  assert.equal((await ctx.collection('umbler_messages').findOne({}))?.raw.content,undefined);
  const after=await new MongoReads(ctx).analytics();assert.equal(after.funnel[0].messages[0].ctaKey,before.funnel[0].messages[0].ctaKey);
  await setMessageStorage(ctx,true,disabled.revision);
  const empty=await app.inject({method:'GET',url:'/api/v1/conversations/org%3Achat',headers:{host:'127.0.0.1'}});assert.deepEqual(empty.json().messages,[]);
  console.log('Atlas: padrão desabilitado, opt-in, revisão, concorrência, limpeza retomável, versões antigas, CTA preservado e coleta sem texto aprovados.');
 }finally{
  if(app)await app.close();
  if(!/^test_[a-f0-9]{16}_$/.test(prefix))throw new Error('Prefixo inválido');
  for(const c of await ctx.db.listCollections({},{nameOnly:true}).toArray())if(c.name.startsWith(prefix))await ctx.db.collection(c.name).drop();
  await ctx.close();
 }
}
main().catch(error=>{console.error(error instanceof assert.AssertionError?error.message:'Verificação de retenção interrompida.');process.exitCode=1;});
