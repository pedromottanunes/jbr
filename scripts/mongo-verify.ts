import 'dotenv/config';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {connectMongo} from '../src/server/mongo/connection.js';
import {ensureSchema} from '../src/server/mongo/schema.js';
import {MongoSettings,MongoBudgetStore} from '../src/server/mongo/settings.js';
import {buildApp} from '../src/server/app.js';
import {enqueue,completeJob,jobStatus} from '../src/server/mongo/jobs.js';
import {publishAds,publishUmbler,loadSourceRows,normalizeSource,viewGeneration,MongoReads} from '../src/server/mongo/datasets.js';
import {defaultAttendanceConfig} from '../src/shared/business-hours.js';
import {collectUmbler} from '../src/server/mongo/umbler-collect.js';
import {storeSecret} from '../src/server/mongo/secrets.js';
import {PersistentReadGate} from '../src/server/mongo/provider-gate.js';
import {sourceRow,sourceMeta,saveSourceBatch,type SourceBatch} from '../src/server/mongo/source-batch.js';
import {runWorkerOnce} from '../src/server/mongo/worker.js';
import {WorkerStopping} from '../src/server/mongo/cancellation.js';
import {resumeContentPurge} from '../src/server/mongo/message-retention.js';

async function main(){
 process.env.NODE_ENV='test';
 const prefix='test_'+randomBytes(8).toString('hex')+'_',ctx=await connectMongo(prefix);
 try{
  await ensureSchema(ctx);
  const contenders=await Promise.all(Array.from({length:8},()=>ctx.lease('same-resource')));assert.equal(contenders.filter(Boolean).length,1);
  const first=contenders.find(Boolean)!;await ctx.collection('integration_leases').updateOne({_id:'same-resource'},{$set:{expiresAt:new Date(0)}});
  const next=await ctx.lease('same-resource');assert.ok(next);assert.equal(await ctx.renew('same-resource',first),false);await ctx.release('same-resource',first);assert.equal(await ctx.renew('same-resource',next!),true);
  const settings=new MongoSettings(ctx);
  const writes=await Promise.allSettled([settings.setAttendance(defaultAttendanceConfig,0),settings.setAttendance({...defaultAttendanceConfig,slaMinutes:30},0)]);assert.equal(writes.filter(w=>w.status==='fulfilled').length,1);assert.equal((await settings.attendance()).revision,1);
  await ctx.collection('rollback_probe').insertOne({_id:'probe',value:0});
  await assert.rejects(ctx.transaction(async session=>{await ctx.collection('rollback_probe').updateOne({_id:'probe'},{$set:{value:1}},{session});throw new Error('intentional');}));assert.equal((await ctx.collection('rollback_probe').findOne({_id:'probe'}))?.value,0);
  await Promise.all(Array.from({length:8},()=>enqueue(ctx,'google',{start:'2026-11-01',end:'2026-11-20'})));assert.equal(await ctx.collection('sync_jobs').countDocuments({}),1);assert.equal((await ctx.collection('sync_jobs').findOne({_id:'google'}))?.revision,1);
  await ctx.collection('sync_jobs').updateOne({_id:'google'},{$set:{status:'running',owner:'job-owner',leaseUntil:new Date(Date.now()+60000)}});
  await enqueue(ctx,'google',{start:'2026-10-01',end:'2026-11-21'});
  await assert.rejects(completeJob(ctx,'google','obsolete'));
  await completeJob(ctx,'google','job-owner');
  assert.equal((await jobStatus(ctx,'google')).status,'running');
  assert.deepEqual((await jobStatus(ctx,'google')).period,{start:'2026-10-01',end:'2026-11-21'});
  await ctx.collection('sync_jobs').updateOne({_id:'google'},{$set:{status:'complete'}});
  await enqueue(ctx,'google',{start:'2026-10-01',end:'2026-11-22'});
  assert.equal((await jobStatus(ctx,'google')).status,'running','Cooldown must retain the request instead of reporting false completion');
  const store=new MongoBudgetStore(ctx),scope={environment:'test',clientId:'jbr',customerId:'1234567890'},now=Date.now();const claims=await Promise.all(Array.from({length:8},()=>store.claim(scope,true,now)));assert.equal(claims.filter(c=>c.claimed).length,1);const claim=claims.find(c=>c.claimed)!;
  if(!claim.claimed)throw new Error('claim');assert.equal(await store.finish(scope,'obsolete',{errorCode:'temporary'},now+1),false);assert.equal(await store.finish(scope,claim.owner,{errorCode:'rate_limit',retryAfterMs:60000},now+1),true);assert.equal((await store.claim(scope,true,now+40000)).claimed,false);
  const ads={connected:true,account:{id:'1234567890'},period:{start:'2026-11-01',end:'2026-11-02'},daily:[{date:'2026-11-01',spend:1}],conversionDaily:[],campaigns:[],actions:[],reports:{terms:{available:true,rows:[{metrics:{costMicros:'9007199254740993'}}]}}};
  await publishAds(ctx,ads);await publishAds(ctx,ads);assert.equal(await ctx.collection('ads_rows').countDocuments({}),2);assert.deepEqual(await new MongoReads(ctx).ads(),ads);
  await storeSecret(ctx,'umbler-token','anonymous-fixture');
  await ctx.collection('integration_state').insertOne({_id:'organizationId',value:'org'});
  const start=new Date(Date.now()-3600000).toISOString();
  const chat={id:'chat',contact:{id:'contact',name:'Fixture',contactType:'DirectMessage'},firstContactMessage:{eventAtUTC:start},lastMessage:{eventAtUTC:start},open:true};
  await ctx.collection('umbler_chats').insertOne({_id:'fixture',organization_id:'org',id:'chat',raw:chat,observed_at:start,service_candidate:true});
  const owner=await ctx.lease('umbler');assert.ok(owner);let calls=0;
  const fetcher:typeof fetch=async(input,init)=>{
   assert.equal(init?.method,'GET');calls++;const url=new URL(String(input));let body:any;
   if(url.pathname.endsWith('/members/me/'))body={organizations:[{id:'org'}]};
   else if(url.pathname.endsWith('/organizations/org/'))body={organizationMembers:[{id:'human',displayName:'Fixture',active:true,_t:'OrganizationHumanAgentReferenceModel'}]};
   else if(url.pathname.endsWith('/relative-messages/'))body={messages:[{id:'msg',_t:'MessageModel',eventAtUTC:start,source:'Contact',content:'Fixture',messageType:'Text'}]};
   else body={items:[]};
   return new Response(JSON.stringify(body),{status:200});
  };
  const firstBatch=await collectUmbler(ctx,owner!,90,3,{fetcher,intervalMs:0});assert.equal(firstBatch.status,'partial');assert.equal(calls,3);
  const checkpoint=await ctx.collection('umbler_service_progress').findOne({chat_id:'chat'});assert.equal(checkpoint?.complete,1);
  await collectUmbler(ctx,owner!,90,8,{fetcher,intervalMs:0});
  const revision=await ctx.collection('data_revisions').findOne({_id:'umbler'});assert.equal(await ctx.collection('messages').countDocuments({generation:viewGeneration(revision,'messages')}),1);assert.equal(await ctx.collection('umbler_messages').countDocuments({}),1);
  const reads=new MongoReads(ctx);const analytics=await reads.analytics();assert.equal(analytics.funnel.length,1);assert.equal((await reads.service()).agents.length,1);
  const normalized=normalizeSource(await loadSourceRows(ctx));normalized.crm_meta.push({key:'reviewFixture',value:'true'});
  await publishUmbler(ctx,normalized,owner!);
  const metadataOnly=await ctx.collection('data_revisions').findOne({_id:'umbler'});
  assert.deepEqual(metadataOnly?.generations,revision?.generations,'Metadata must not rewrite contacts/messages');
  const beforeFailure=metadataOnly?.generation;
  await assert.rejects(collectUmbler(ctx,owner!,90,8,{intervalMs:0,fetcher:async()=>new Response('{}',{status:503})}));
  assert.equal((await ctx.collection('data_revisions').findOne({_id:'umbler'}))?.generation,beforeFailure,'Failed collection must preserve the published snapshot');
  const rollback:SourceBatch={};sourceMeta(rollback,'rollbackCursor','must-not-commit');
  sourceRow(rollback,'chats',['organization_id','id'],{organization_id:'org',id:'chat',raw:{}}); // Unique source key conflicts with fixture _id.
  await assert.rejects(saveSourceBatch(ctx,owner!,rollback));
  assert.equal(await ctx.collection('integration_state').findOne({_id:'rollbackCursor'}),null);
  await assert.rejects(saveSourceBatch(ctx,'expired-owner',{'integration_state':[{updateOne:{filter:{_id:'illegal'},update:{$set:{value:1}},upsert:true}}]}));
  assert.equal(await ctx.collection('integration_state').findOne({_id:'illegal'}),null);
  const cancel=new AbortController();cancel.abort();await assert.rejects(runWorkerOnce(ctx,cancel.signal));
  // Simulate a server shutdown during a provider read, then resume the same job.
  await ctx.release('umbler',owner!);await ctx.collection('sync_jobs').deleteMany({});
  await resumeContentPurge(ctx);
  await enqueue(ctx,'umbler',{days:90,maxRequests:3});
  const realFetch=globalThis.fetch,shutdown=new AbortController();
  try{
   globalThis.fetch=async()=>{shutdown.abort(new WorkerStopping());throw shutdown.signal.reason;};
   await runWorkerOnce(ctx,shutdown.signal);
   const paused=await ctx.collection('sync_jobs').findOne({_id:'umbler'});assert.equal(paused?.status,'queued');assert.equal(paused?.attempts,0);
   assert.equal(await ctx.collection('integration_leases').countDocuments({_id:{$in:['worker','umbler']}}),0);
   assert.equal((await ctx.collection('data_revisions').findOne({_id:'umbler'}))?.generation,beforeFailure);
   await ctx.collection('sync_jobs').updateOne({_id:'umbler'},{$set:{availableAt:new Date(0)}});
   globalThis.fetch=fetcher;await runWorkerOnce(ctx);assert.equal((await jobStatus(ctx,'umbler')).status,'complete');
   assert.equal(await ctx.collection('umbler_messages').countDocuments({}),1);
  }finally{globalThis.fetch=realFetch;}
  const oldEnvironment=process.env.CRM_ENVIRONMENT,oldCustomer=process.env.GOOGLE_ADS_CUSTOMER_ID;
  try{
   process.env.CRM_ENVIRONMENT='test';process.env.GOOGLE_ADS_CUSTOMER_ID=scope.customerId;
   await ctx.collection('google_budget_snapshots').updateMany({},{$set:{lastAttemptAt:new Date().toISOString(),retryAt:new Date(Date.now()+60000).toISOString()}});
   await enqueue(ctx,'budget',{force:true});globalThis.fetch=async()=>{throw new Error('A cooldown must not call a provider');};
   await runWorkerOnce(ctx);
   assert.equal((await ctx.collection('sync_jobs').findOne({_id:'budget'}))?.status,'queued');
   assert.equal((await ctx.collection('sync_jobs').findOne({_id:'budget'}))?.attempts,0);
  }finally{
   globalThis.fetch=realFetch;
   if(oldEnvironment===undefined)delete process.env.CRM_ENVIRONMENT;else process.env.CRM_ENVIRONMENT=oldEnvironment;
   if(oldCustomer===undefined)delete process.env.GOOGLE_ADS_CUSTOMER_ID;else process.env.GOOGLE_ADS_CUSTOMER_ID=oldCustomer;
  }
  let retries=0;const rateGate=new PersistentReadGate(ctx,'test_rate',0,async()=>{},async()=>{retries++;return new Response('{}',{status:429,headers:{'retry-after':'120'}});});
  await assert.rejects(rateGate.send(new URL('https://example.test/'),{method:'GET'},'fixture'));await assert.rejects(rateGate.send(new URL('https://example.test/'),{method:'GET'},'fixture'));assert.equal(retries,1);
  console.log('Coletor: GET exclusivo, orçamento de chamadas, checkpoint, retomada, deduplicação e Retry-After aprovados.');
  console.log('Atlas: concorrência, leases, revisão, rollback, fila e publicação idempotente aprovados.');
 }finally{
  if(!/^test_[a-f0-9]{16}_$/.test(prefix))throw new Error('Prefixo de teste inválido.');
  for(const c of await ctx.db.listCollections({},{nameOnly:true}).toArray()){if(c.name.startsWith(prefix))await ctx.db.collection(c.name).drop();}
  await ctx.close();
 }
 const baselineIndex=process.argv.indexOf('--baseline');if(baselineIndex<0)return;
 if(!process.argv[baselineIndex+1])throw new Error('Informe o caminho do baseline protegido.');
 const real=await connectMongo(),app=buildApp({mode:'mongo',mongo:real});
 try{
  const baseline=JSON.parse(await readFile(process.argv[baselineIndex+1],'utf8'));let count=0;
  for(const [url,expected] of Object.entries(baseline) as [string,any][]){
   const response=await app.inject({method:'GET',url,headers:{host:'127.0.0.1'}});if(response.statusCode!==200)throw new Error('HTTP '+response.statusCode+' em '+url.split('?')[0]);
   const actual=response.json();if(url==='/api/v1/status'&&expected.mode==='local'){delete actual.storage;actual.mode='local';}if(url==='/api/v1/overview'&&expected.mode==='local')actual.mode='local';
   if(url==='/api/v1/leads/tags'){actual.sort((a:any,b:any)=>a.name.localeCompare(b.name,'pt-BR'));expected.sort((a:any,b:any)=>a.name.localeCompare(b.name,'pt-BR'));}
   // Summation order may differ between stores. Counts and integer money remain exact.
   const equivalent=(a:any,b:any):boolean=>{
    if(a===b)return true;
    if(typeof a==='number'&&typeof b==='number'&&Number.isFinite(a)&&Number.isFinite(b)&&(!Number.isInteger(a)||!Number.isInteger(b)))return Math.abs(a-b)<=1e-9;
    if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
    const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&equivalent(a[k],b[k]));
   };
   if(!equivalent(actual,expected)){console.error('Divergência na rota:',url.split('?')[0]);process.exitCode=1;}else count++;
  }
  console.log('Respostas equivalentes à base local (tolerância numérica de 1e-9):',count,'/',Object.keys(baseline).length);
 }finally{await app.close();await real.close();}
}
main().catch(error=>{console.error(error instanceof assert.AssertionError?'Falha em uma verificação de integridade.':'Verificação Atlas interrompida.');process.exitCode=1;});
