import {collectMeta} from './meta.js';
import {randomUUID} from 'node:crypto';
import type {MongoContext} from './connection.js';
import {completeJob,enqueue,type JobKind} from './jobs.js';
import {MongoReads,publishAds} from './datasets.js';
import {MongoBudgetStore} from './settings.js';
import {mongoGoogleTokens} from './secrets.js';
import {GoogleAdsReader} from '../integrations/google-ads.js';
import {BudgetCoordinator} from '../budget-service.js';
import {collectGoogle} from './google-collect.js';
import {collectUmbler} from './umbler-collect.js';
import {PersistentReadGate} from './provider-gate.js';
import {ProviderReadError} from '../integrations/read-transport.js';
import {checkSignal,pause,WorkerStopping} from './cancellation.js';
import {resumeContentPurge} from './message-retention.js';
import {attendanceAnalysisVersion,periodDays,umblerPeriods} from './attendance-period.js';

export async function runWorkerOnce(ctx:MongoContext,signal?:AbortSignal,lane:'all'|'main'|'meta'='all'){
 checkSignal(signal);
 if(lane!=='meta'&&await resumeContentPurge(ctx,signal))return true;
 const scope=lane==='meta'?{kind:'meta'}:lane==='main'?{kind:{$ne:'meta'}}:{};
 const workerLease=lane==='meta'?'worker:meta':'worker';
 // Idle workers only read the queue; do not continuously create and remove leases.
 if(!await ctx.collection('sync_jobs').findOne({...scope,$or:[{status:'queued',availableAt:{$lte:new Date()}},{status:'running',leaseUntil:{$lte:new Date()}}]},{projection:{_id:1}}))return false;
 const owner=randomUUID(),held=await ctx.lease(workerLease,120000,owner);if(!held)return false;
 let resource:string|undefined,job:any,timer:ReturnType<typeof setInterval>|undefined;
 try{
  // Expired executions are recoverable. A former owner cannot complete the newer job.
  await ctx.collection('sync_jobs').updateMany({status:'running',attempts:{$gte:3},leaseUntil:{$lte:new Date()}},{$set:{status:'error',completedAt:new Date(),availableAt:new Date(Date.now()+300000),message:'Coleta interrompida após três tentativas. Dados publicados preservados.'},$unset:{owner:'',leaseUntil:''}});
  await ctx.collection('sync_jobs').updateMany({status:'running',attempts:{$lt:3},leaseUntil:{$lte:new Date()}},{$set:{status:'queued',availableAt:new Date(),message:'Retomando coleta interrompida.'},$unset:{owner:'',leaseUntil:''}});
  job=await ctx.collection('sync_jobs').findOneAndUpdate({...scope,status:'queued',availableAt:{$lte:new Date()}},{$set:{status:'running',owner,startedAt:new Date(),leaseUntil:new Date(Date.now()+120000)},$inc:{attempts:1}},{sort:{requestedAt:1},returnDocument:'after'});
  if(!job)return false;resource=job.kind==='umbler'?'umbler':job.kind==='meta'?'meta':'google';
  if(!await ctx.lease(resource,120000,owner)){await ctx.collection('sync_jobs').updateOne({_id:job._id,owner},{$set:{status:'queued',availableAt:new Date(Date.now()+5000)},$inc:{attempts:-1},$unset:{owner:'',leaseUntil:''}});return false;}
  let lost=false,renewing=false;const keep=async()=>{if(renewing)return;renewing=true;try{if(!await ctx.renew(workerLease,owner)||!await ctx.renew(resource!,owner)){lost=true;return;}const result=await ctx.collection('sync_jobs').updateOne({_id:job._id,owner,status:'running',leaseUntil:{$gt:new Date()}},{$set:{leaseUntil:new Date(Date.now()+120000)}});if(!result.matchedCount)lost=true;}finally{renewing=false;}};
  timer=setInterval(()=>{void keep().catch(()=>{lost=true;});},20000);
  const guard=async()=>{checkSignal(signal);if(lost||!await ctx.renew(resource!,owner))throw new Error('Lease lost');};
  let result:{status:string}|undefined;
  if(job.kind==='umbler'){
   const period=umblerPeriods(job.payload,job.requestedAt)[0];
   if(!period)throw new Error('Coleta sem período.');
   const days=periodDays(period),saved=await ctx.collection('attendance_coverage').countDocuments({_id:{$in:days},version:attendanceAnalysisVersion,checkedAt:{$gte:job.requestedAt}});
   // Recover a crash after publication/coverage commit without rereading Umbler.
   result=saved===days.length?{status:'complete'}:await collectUmbler(ctx,owner,Number(job.payload?.days??90),Number(job.payload?.maxRequests??150),{signal,period,cycle:job.requestedAt.toISOString()});
  }
  else if(job.kind==='meta'){await collectMeta(ctx,job.payload.periods[0],guard,signal);}
  else{
   const reader=new GoogleAdsReader({tokenProvider:mongoGoogleTokens(ctx),version:process.env.GOOGLE_ADS_API_VERSION||'v26',loginCustomerId:process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,developerToken:process.env.GOOGLE_ADS_DEVELOPER_TOKEN},new PersistentReadGate(ctx,'google',1000,guard,fetch,signal),ms=>pause(ms,signal));
   if(job.kind==='google'){const started=Date.now();const data=await collectGoogle(reader,process.env.GOOGLE_ADS_CUSTOMER_ID??'',job.payload?.start?job.payload:undefined,await new MongoReads(ctx).ads(),!!job.payload?.refresh);const collected=Date.now();await guard();await publishAds(ctx,data,owner,signal);console.log(JSON.stringify({provider:'google',collectMs:collected-started,publishMs:Date.now()-collected}));}
   else{
    const coordinator=new BudgetCoordinator(new MongoBudgetStore(ctx),{environment:process.env.CRM_ENVIRONMENT??'local',clientId:'jbr',customerId:(process.env.GOOGLE_ADS_CUSTOMER_ID??'').replace(/\D/g,'')},reader);
    const result=await coordinator.request(job.payload?.force??false);
    if(result.status==='cooldown'){
     await ctx.collection('sync_jobs').updateOne({_id:job._id,owner},{$set:{status:'queued',availableAt:new Date(Math.max(Date.now()+5000,Date.parse(result.nextAttemptAt))),message:'Aguardando o intervalo da consulta de orçamento.'},$inc:{attempts:-1},$unset:{owner:'',leaseUntil:''}});return true;
    }
    await coordinator.idle();
   }
  }
  await guard();await completeJob(ctx,job._id,owner,result);return true;
 }catch(error){
  const stopping=signal?.aborted||error instanceof WorkerStopping;
  const retry=stopping||(error instanceof ProviderReadError&&(error.status===429||error.status>=500)&&job?.attempts<3);
  const delay=Math.max(60000,15000*2**Math.min(job?.attempts??1,3),error instanceof ProviderReadError?error.retryAfterMs:0);
  if(job)await ctx.collection('sync_jobs').updateOne({_id:job._id,owner},{$set:{status:retry?'queued':'error',completedAt:new Date(),availableAt:new Date(Date.now()+(stopping?5000:delay)),message:stopping?'Coleta pausada para reinício do servidor.':retry?'Aguardando o provedor para tentar novamente.':'A coleta foi interrompida. Os dados publicados e o progresso foram preservados.'},...(stopping?{$inc:{attempts:-1}}:{}),$unset:{owner:'',leaseUntil:''}});return true;
 }finally{if(timer)clearInterval(timer);if(resource)await ctx.release(resource,owner);await ctx.release(workerLease,owner);}
}
export async function schedule(ctx:MongoContext){
 for(const [kind,interval,payload] of [['budget',900000,{}],['umbler',900000,{days:90,maxRequests:150}],['google',3600000,{}]] as [JobKind,number,any][]){
  const r=await ctx.collection('sync_jobs').findOne({_id:kind});if(!r||(!['queued','running'].includes(r.status)&&Date.now()-(+(r.completedAt??r.requestedAt??0))>=interval))await enqueue(ctx,kind,payload);
 }
}
