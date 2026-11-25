import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {connectMongo} from '../src/mongo/connection.js';
import {ensureSchema} from '../src/mongo/schema.js';
import {resumeContentPurge} from '../src/mongo/message-retention.js';
import {storeSecret} from '../src/mongo/secrets.js';
import {ensureAttendanceCoverage} from '../src/mongo/attendance-coverage.js';
import {completeJob,enqueue} from '../src/mongo/jobs.js';
import {collectUmbler} from '../src/mongo/umbler-collect.js';
import {ctaTexts} from '../src/cta.js';
import {buildApp} from '../src/app.js';
import {runWorkerOnce} from '../src/mongo/worker.js';

process.env.NODE_ENV='test';
const prefix='test_'+randomBytes(8).toString('hex')+'_',ctx=await connectMongo(prefix);
const period={start:'2026-10-01',end:'2026-10-03'},secret='PRIVATE-MESSAGE-NOT-TO-STORE';
const originalEnabled=process.env.INTEGRATIONS_ENABLED;let app:ReturnType<typeof buildApp>|undefined;
try{
 await ensureSchema(ctx);await resumeContentPurge(ctx);
 process.env.INTEGRATIONS_ENABLED='false';
 assert.equal((await ensureAttendanceCoverage(ctx,period)).status,'disabled');
 assert.equal(await ctx.collection('sync_jobs').countDocuments({}),0);
 process.env.INTEGRATIONS_ENABLED='true';
 await Promise.all(Array.from({length:8},()=>ensureAttendanceCoverage(ctx,period)));
 let job=await ctx.collection('sync_jobs').findOne({_id:'umbler'});
 assert.equal(job?.revision,1);assert.equal(await ctx.collection('sync_jobs').countDocuments({}),1);
 const owner=await ctx.lease('umbler');assert.ok(owner);
 const running=()=>ctx.collection('sync_jobs').updateOne({_id:'umbler'},{$set:{status:'running',owner,leaseUntil:new Date(Date.now()+120000)}});
 await running();
 const extension={start:'2026-09-28',end:'2026-10-05'};
 await Promise.all([ensureAttendanceCoverage(ctx,extension),ensureAttendanceCoverage(ctx,extension)]);
 job=await ctx.collection('sync_jobs').findOne({_id:'umbler'});
 assert.deepEqual(job?.pendingPayload.periods,[{start:'2026-09-28',end:'2026-09-30'},{start:'2026-10-04',end:'2026-10-05'}]);
 await assert.rejects(completeJob(ctx,'umbler','expired',{status:'complete'}));
 await completeJob(ctx,'umbler',owner!,{status:'partial'});
 job=await ctx.collection('sync_jobs').findOne({_id:'umbler'});assert.equal(job?.status,'queued');assert.deepEqual(job?.payload.periods[0],period);assert.equal(job?.payload.periods.length,3);
 await running();await completeJob(ctx,'umbler',owner!,{status:'complete'});
 job=await ctx.collection('sync_jobs').findOne({_id:'umbler'});assert.equal(job?.payload.periods.length,2);
 await ctx.collection('sync_jobs').deleteMany({});
 await storeSecret(ctx,'umbler-token','fixture');await ctx.collection('integration_state').insertOne({_id:'organizationId',value:'org'});
 const first='2026-10-01T11:00:00.000Z',reply='2026-10-02T12:00:00.000Z';
 const chat=(id:string,entry:string)=>({id,createdAtUTC:entry,firstContactMessage:{id:id+'-first',eventAtUTC:entry},lastMessage:{eventAtUTC:reply},contact:{id:id+'-lead',name:'Fixture',contactType:'DirectMessage'},channel:{id:'channel',_t:'WhatsappChannelModel'},organizationMemberHistory:[{memberId:'human',enteredAt:entry}],open:false});
 const a=chat('a',first),b=chat('b','2026-09-15T10:00:00.000Z'),future=chat('future','2026-10-04T10:00:00.000Z');
 future.lastMessage.eventAtUTC=future.firstContactMessage.eventAtUTC;
 const message=(id:string,at:string,incoming:boolean)=>({id,eventAtUTC:at,_t:'MessageModel',source:incoming?'Contact':'Member',messageType:'Text',content:incoming?ctaTexts()[0]:secret,sentByOrganizationMember:incoming?undefined:{id:'human'}});
 const events:Record<string,any[]>={a:[message('a-first',first,true),message('a-reply',reply,false)],b:[message('b-first',b.firstContactMessage.eventAtUTC,true),message('b-reply',reply,false)]};
 let discovery=0,firstReads=0;const history:string[]=[];
 const provider:typeof fetch=async(input,init)=>{
  assert.equal(init?.method,'GET');const url=new URL(String(input));let body:any;
  if(url.pathname.endsWith('/members/me/'))body={organizations:[{id:'org'}]};
  else if(url.pathname.endsWith('/organizations/org/'))body={organizationMembers:[{id:'human',displayName:'Fixture agent',_t:'OrganizationHumanAgentReferenceModel',active:true}]};
  else if(url.pathname.endsWith('/chats/')){discovery++;assert.equal(url.searchParams.get('ChatOrderBy'),'LastMessage');assert.equal(url.searchParams.get('ChatState'),'All');body={items:[future,a,b]};}
  else if(url.pathname.endsWith('/relative-messages/')){const id=url.pathname.split('/').at(-3)!;history.push(id);assert.ok(id!=='future');const cursor=url.searchParams.get('FromEventUTC')!;assert.ok(cursor<='2026-10-04T03:00:00.000Z');body={messages:events[id].filter(m=>m.eventAtUTC<cursor).sort((a,b)=>b.eventAtUTC.localeCompare(a.eventAtUTC)).slice(0,250)};}
  else if(url.pathname.includes('/messages/')){firstReads++;throw new Error('First CTA must be reused from the necessary history page');}
  else body={items:[]};
  return new Response(JSON.stringify(body),{status:200});
 };
 let result=await collectUmbler(ctx,owner!,90,4,{period,cycle:'resume',fetcher:provider,intervalMs:0});
 assert.equal(result.status,'partial');assert.equal(await ctx.collection('attendance_coverage').countDocuments({}),0);assert.deepEqual(history,['a']);
 result=await collectUmbler(ctx,owner!,90,20,{period,cycle:'resume',fetcher:provider,intervalMs:0});
 assert.equal(result.status,'complete');assert.equal(discovery,1);assert.deepEqual(history,['a','b']);assert.equal(firstReads,0);
 assert.equal(await ctx.collection('attendance_coverage').countDocuments({}),3);
 assert.equal(await ctx.collection('umbler_messages').countDocuments({}),3);
 assert.equal(await ctx.collection('umbler_chats').countDocuments({id:'future'}),0);
 for(const name of ['umbler_messages','umbler_chats','messages']){const data=JSON.stringify(await ctx.collection(name).find({}).toArray());assert.ok(!data.includes(secret));assert.ok(!data.includes(ctaTexts()[0]));}
 assert.equal((await ensureAttendanceCoverage(ctx,period)).status,'current');assert.equal(await ctx.collection('sync_jobs').countDocuments({}),0);
 await collectUmbler(ctx,owner!,90,20,{period,cycle:'unchanged',fetcher:provider,intervalMs:0});assert.deepEqual(history,['a','b']);
 // A new reply in an already analyzed conversation reads only its uncovered interval.
 a.lastMessage.eventAtUTC='2026-10-03T10:00:00.000Z';events.a.push(message('a-new',a.lastMessage.eventAtUTC,false));
 await collectUmbler(ctx,owner!,90,20,{period,cycle:'changed',fetcher:provider,intervalMs:0});assert.deepEqual(history,['a','b','a']);assert.equal(await ctx.collection('umbler_messages').countDocuments({id:'a-new'}),1);
 await collectUmbler(ctx,owner!,90,20,{period,cycle:'unchanged-again',fetcher:provider,intervalMs:0});assert.deepEqual(history,['a','b','a']);
 // A failed refresh cannot claim that a previously missing day was analyzed.
 const failedPeriod={start:'2026-10-01',end:'2026-10-05'};
 await assert.rejects(collectUmbler(ctx,owner!,90,20,{period:failedPeriod,cycle:'failed',intervalMs:0,fetcher:async()=>new Response('{}',{status:429,headers:{'Retry-After':'1'}})}));
 assert.equal(await ctx.collection('attendance_coverage').countDocuments({}),3);
 await ctx.release('umbler',owner!);
 await enqueue(ctx,'umbler',{periods:[period],maxRequests:150});
 await ctx.collection('sync_jobs').updateOne({_id:'umbler'},{$set:{requestedAt:new Date(0),availableAt:new Date(0)}});
 const originalFetch=globalThis.fetch;
 try{globalThis.fetch=async()=>{throw new Error('Published coverage must recover without another API call');};await runWorkerOnce(ctx);assert.equal((await ctx.collection('sync_jobs').findOne({_id:'umbler'}))?.status,'complete');}
 finally{globalThis.fetch=originalFetch;}
 app=buildApp({mode:'mongo',mongo:ctx});
 const headers={host:'127.0.0.1'};
 const fresh=await app.inject({method:'POST',url:'/api/v1/attendance/ensure',headers,payload:period});assert.equal(fresh.statusCode,200);assert.equal(fresh.json().status,'current');
 const missing=await app.inject({method:'POST',url:'/api/v1/attendance/ensure',headers,payload:{start:'2026-10-01',end:'2026-10-05'}});assert.equal(missing.statusCode,202);
 assert.deepEqual((await ctx.collection('sync_jobs').findOne({_id:'umbler'}))?.payload.periods,[{start:'2026-10-04',end:'2026-10-05'}]);
 const invalid=await app.inject({method:'POST',url:'/api/v1/attendance/ensure',headers,payload:{start:'2099-01-01',end:'2099-01-01'}});assert.equal(invalid.statusCode,400);
 const revision=(await ctx.collection('sync_jobs').findOne({_id:'umbler'}))?.revision;
 await enqueue(ctx,'umbler',{periods:[period],automatic:true});assert.equal((await ctx.collection('sync_jobs').findOne({_id:'umbler'}))?.revision,revision);
 console.log('Aprovados: períodos, fuso, coalescência entre abas, extensão durante coleta, retomada sem releitura, cobertura após publicação, primeira mensagem reaproveitada, atualização incremental, descarte de conteúdo e falha sem falsa cobertura.');
}finally{
 if(app)await app.close();
 if(originalEnabled===undefined)delete process.env.INTEGRATIONS_ENABLED;else process.env.INTEGRATIONS_ENABLED=originalEnabled;
 if(!/^test_[a-f0-9]{16}_$/.test(prefix))throw new Error('Prefixo inválido');
 for(const c of await ctx.db.listCollections({},{nameOnly:true}).toArray())if(c.name.startsWith(prefix))await ctx.db.collection(c.name).drop();
 await ctx.close();
}
