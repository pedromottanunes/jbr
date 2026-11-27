import type {FastifyInstance} from 'fastify';
import type {MongoContext} from './connection.js';
import {readSecret} from './secrets.js';
import {PersistentReadGate} from './provider-gate.js';
import {ProviderReadError} from '../integrations/read-transport.js';
import {MetaAdsReader} from '../integrations/meta-ads.js';
import {metaAccounts,sumMeta,metaPeriodKey,type MetaSnapshot,type MetaDashboard} from '../../../shared/meta.js';
export {metaPeriodKey,mergeMetaPeriods} from '../../../shared/meta.js';
import {validPeriod,type Period} from '../../../shared/period.js';
import {enqueue,jobStatus} from './jobs.js';
import {MetaCache,cachedMetaSnapshot,readCachedMeta,seedLegacyMeta} from './meta-cache.js';

export function metaNearLimit(headers:Headers){
 const fields:Record<string,string[]>={
  'x-app-usage':['call_count','total_cputime','total_time'],
  'x-fb-ads-insights-throttle':['app_id_util_pct','acc_id_util_pct'],
  'x-ad-account-usage':['acc_id_util_pct'],
 };
 return Object.entries(fields).some(([header,keys])=>{
  try{const data=JSON.parse(headers.get(header)??'{}');return keys.some(k=>Number(data?.[k]??0)>=90);}catch{return false;}
 });
}

export function metaDashboard(period:Period,snapshots:MetaSnapshot[],account='',campaign=''):MetaDashboard{
 const wanted=metaAccounts.filter(a=>!account||a.id===account),selected=snapshots.filter(s=>wanted.some(a=>a.id===s.accountId)&&metaPeriodKey(s.period)===metaPeriodKey(period));
 const rows=(key:'campaigns'|'adsets'|'ads'|'instagram')=>selected.flatMap(s=>s[key]).filter(r=>!campaign||(key==='campaigns'?r.id:r.campaignId)===campaign);
 const currencies=[...new Set(selected.map(s=>s.currency))];const available=selected.length===wanted.length,needsSync=!available||selected.some(s=>s.derived||s.detailsPending);
 const totalRows=campaign?rows('campaigns'):selected.map(s=>s.total);
 return {period,accounts:metaAccounts.map(a=>{const s=snapshots.find(s=>s.accountId===a.id&&metaPeriodKey(s.period)===metaPeriodKey(period));return {...a,available:!!s,syncedAt:s?.syncedAt??null,currency:s?.currency??null,status:s?.accountStatus??null,warning:s?.warnings.join(' ')||null};}),available,needsSync,stale:selected.some(s=>Date.now()-Date.parse(s.syncedAt)>3600000),total:available&&currencies.length===1?sumMeta(totalRows):null,campaigns:rows('campaigns'),adsets:rows('adsets'),ads:rows('ads'),instagram:rows('instagram'),daily:campaign?[]:selected.flatMap(s=>s.daily),currencies,warnings:[...new Set(selected.flatMap(s=>s.warnings)),...(selected.some(s=>s.derived)?['Métricas diárias disponíveis. Alcance do período em atualização.']:[]),...(!available?['Coleta parcial: totais aguardam todas as contas selecionadas.']:[]),...(currencies.length>1?['Selecione uma conta para visualizar valores na mesma moeda.']:[])],syncedAt:selected.length?selected.map(s=>s.syncedAt).sort()[0]:null};
}
export async function collectMeta(ctx:MongoContext,period:Period,guard:()=>Promise<void>,signal?:AbortSignal){
 if(!validPeriod(period))throw new Error('Período Meta inválido.');
 const token=await readSecret(ctx,'meta-ads-token');
 const fetcher:typeof fetch=async(input,init)=>{
  const r=await fetch(input,init);
  // Meta can report throttling as HTTP 400. Preserve the shared provider cooldown.
  const throttled=metaNearLimit(r.headers);
  if(!r.ok){const b:any=await r.clone().json().catch(()=>null);if([4,17,32,613,80004].includes(b?.error?.code)){await ctx.collection('provider_limits').updateOne({_id:'meta'},{$max:{nextAt:new Date(Date.now()+300000)}},{upsert:true});await r.body?.cancel();throw new ProviderReadError(429,'Meta em espera.',300000);}}
  if(throttled)await ctx.collection('provider_limits').updateOne({_id:'meta'},{$max:{nextAt:new Date(Date.now()+60000)}},{upsert:true});return r;
 };
 const reader=new MetaAdsReader(token,new PersistentReadGate(ctx,'meta',850,guard,fetcher,signal));
 const c=ctx.collection('meta_snapshots');
 const cache=new MetaCache(ctx,reader,guard);await cache.setup();await seedLegacyMeta(ctx);
 const pending:{id:string;info:any;data:MetaSnapshot}[]=[];
 const publish=async(data:MetaSnapshot)=>{
  await guard();if(Buffer.byteLength(JSON.stringify(data))>1_500_000)throw new Error('Relatório Meta grande demais. Reduza o período.');
  await c.updateOne({_id:metaPeriodKey(period)+':'+data.accountId},{$set:{periodKey:metaPeriodKey(period),data,updatedAt:new Date(),expiresAt:new Date(Date.now()+30*86400000)}},{upsert:true});
  await ctx.collection('sync_jobs').updateOne({_id:'meta',status:'running','payload.periods.0.start':period.start,'payload.periods.0.end':period.end},{$set:{publishedAt:new Date()}});
 };
 // Publish the account summaries first. The UI does not wait for all creative/reach calls.
 for(const account of metaAccounts){
  await guard();const key=metaPeriodKey(period)+':'+account.id;
  const existing=await c.findOne({_id:key});
  // Retries reuse accounts completed in the current 10-minute window.
  if(existing&&!existing.data.derived&&!existing.data.detailsPending&&Date.now()-Date.parse(existing.data.syncedAt)<600000)continue;
  const info=await cache.info(account.id);await cache.ensure(account.id,period,'account');
  const data=cachedMetaSnapshot(info,period,await cache.days(account.id,period))!;
  pending.push({id:account.id,info,data});if(!existing)await publish(data);
 }
 for(const entry of pending){
  await cache.ensure(entry.id,period,'ads');
  const warnings:string[]=[];
  try{await cache.ensure(entry.id,period,'instagram');}catch(e){if(e instanceof ProviderReadError&&[400,403].includes(e.status))warnings.push('Detalhamento Instagram indisponível nesta coleta.');else throw e;}
  entry.data=cachedMetaSnapshot(entry.info,period,await cache.days(entry.id,period))!;
  let details:any[]=[];
  try{details=await cache.details(entry.id,entry.data.ads.map(r=>r.id));}catch(e){if(e instanceof ProviderReadError&&[400,403].includes(e.status))warnings.push('Alguns criativos ou estados dos anúncios não estão disponíveis.');else throw e;}
  entry.data=cachedMetaSnapshot(entry.info,period,await cache.days(entry.id,period),details)!;entry.data.warnings=warnings;entry.data.detailsPending=false;
  await publish(entry.data);
 }
 // Reach is deduplicated by Meta for the exact interval, never added across days.
 for(const entry of pending){
  const data=entry.data;
  for(const kind of ['account','campaigns','adsets','ads','instagram'] as const){
   if(kind!=='account'&&!data[kind].length)continue;
   if(!data.daily.length)continue;
   try{
    const reach=await reader.reach(entry.id,period,kind),field=kind==='account'?'account_id':kind==='campaigns'?'campaign_id':kind==='adsets'?'adset_id':'ad_id';
    const byId=new Map(reach.map(r=>[r[field],r.reach==null?null:Number(r.reach)]));
    if(kind==='account')data.total.reach=byId.get(entry.id)??null;else for(const row of data[kind])row.reach=byId.get(row.id)??null;
   }catch(e){if(e instanceof ProviderReadError&&[400,403].includes(e.status))data.warnings.push('Alcance indisponível para '+kind+' nesta coleta.');else throw e;}
  }
  data.derived=false;data.syncedAt=new Date().toISOString();await publish(data);await cache.trim(entry.id);
 }
 console.log(JSON.stringify({provider:'meta',period,requests:reader.requests,accounts:pending.length}));
 // Bounded cache: eight distinct periods, three small account snapshots per period.
 const periods=await c.aggregate([{$group:{_id:'$periodKey',at:{$max:'$updatedAt'}}},{$sort:{at:-1}},{$skip:8}]).toArray();
 if(periods.length)await c.deleteMany({periodKey:{$in:periods.map(p=>p._id)}});
}
export function registerMeta(app:FastifyInstance,ctx:MongoContext){
 const properties={start:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},end:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'}};
 const periodOk=(p:Period)=>validPeriod(p)&&p.end<=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 app.get<{Querystring:Period&{account?:string;campaign?:string}}>('/api/v1/meta/detail',{schema:{querystring:{type:'object',required:['start','end'],additionalProperties:false,properties:{...properties,account:{type:'string',enum:['',...metaAccounts.map(a=>a.id)]},campaign:{type:'string',pattern:'^[0-9]*$',maxLength:40}}}}},async(req,reply)=>{
  if(!periodOk(req.query))return reply.code(400).send({message:'Selecione até 366 dias, sem datas futuras.'});
  const docs=await ctx.collection('meta_snapshots').find({periodKey:metaPeriodKey(req.query),expiresAt:{$gt:new Date()}},{projection:{data:1}}).maxTimeMS(10000).toArray();
  const missing=metaAccounts.filter(a=>!docs.some(d=>d.data.accountId===a.id)).map(a=>a.id);
  const derived=missing.length?await readCachedMeta(ctx,req.query,missing):[];
  return metaDashboard(req.query,[...docs.map(d=>d.data),...derived],req.query.account,req.query.campaign);
 });
 app.get('/api/v1/meta/sync',()=>jobStatus(ctx,'meta'));
 app.post<{Body:Period&{refresh?:boolean}}>('/api/v1/meta/sync',{schema:{body:{type:'object',required:['start','end'],additionalProperties:false,properties:{...properties,refresh:{type:'boolean'}}}}},async(req,reply)=>{
  if(!periodOk(req.body))return reply.code(400).send({message:'Selecione até 366 dias, sem datas futuras.'});
  if(process.env.INTEGRATIONS_ENABLED!=='true')return reply.code(409).send({message:'Integrações desabilitadas.'});
  const docs=await ctx.collection('meta_snapshots').find({periodKey:metaPeriodKey(req.body),expiresAt:{$gt:new Date()}},{projection:{updatedAt:1,'data.derived':1,'data.detailsPending':1}}).toArray();
  const fresh=docs.length===metaAccounts.length&&docs.every(d=>!d.data?.derived&&!d.data?.detailsPending&&Date.now()-Number(d.updatedAt)<(req.body.refresh?600000:3600000));
  if(fresh)return {status:'complete',completedAt:new Date().toISOString()};
  if(!await ctx.collection('integration_credentials').findOne({_id:'meta-ads-token'},{projection:{_id:1}}))return reply.code(409).send({message:'Credencial Meta não configurada no backend.'});
  return reply.code(202).send(await enqueue(ctx,'meta',{periods:[{start:req.body.start,end:req.body.end}],refresh:!!req.body.refresh}));
 });
}
