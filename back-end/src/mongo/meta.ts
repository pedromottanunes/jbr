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

export function metaDashboard(period:Period,snapshots:MetaSnapshot[],account='',campaign=''):MetaDashboard{
 const wanted=metaAccounts.filter(a=>!account||a.id===account),selected=snapshots.filter(s=>wanted.some(a=>a.id===s.accountId)&&metaPeriodKey(s.period)===metaPeriodKey(period));
 const rows=(key:'campaigns'|'adsets'|'ads'|'instagram')=>selected.flatMap(s=>s[key]).filter(r=>!campaign||(key==='campaigns'?r.id:r.campaignId)===campaign);
 const currencies=[...new Set(selected.map(s=>s.currency))];const available=selected.length===wanted.length;
 const totalRows=campaign?rows('campaigns'):selected.map(s=>s.total);
 return {period,accounts:metaAccounts.map(a=>{const s=snapshots.find(s=>s.accountId===a.id);return {...a,available:!!s,syncedAt:s?.syncedAt??null,currency:s?.currency??null,status:s?.accountStatus??null,warning:s?.warnings.join(' ')||null};}),available,stale:selected.some(s=>Date.now()-Date.parse(s.syncedAt)>3600000),total:available&&currencies.length===1?sumMeta(totalRows):null,campaigns:rows('campaigns'),adsets:rows('adsets'),ads:rows('ads'),instagram:rows('instagram'),daily:campaign?[]:selected.flatMap(s=>s.daily),currencies,warnings:[...new Set(selected.flatMap(s=>s.warnings)),...(!available?['Coleta parcial: totais aguardam todas as contas selecionadas.']:[]),...(currencies.length>1?['Selecione uma conta para visualizar valores na mesma moeda.']:[])],syncedAt:selected.length?selected.map(s=>s.syncedAt).sort()[0]:null};
}
export async function collectMeta(ctx:MongoContext,period:Period,guard:()=>Promise<void>,signal?:AbortSignal){
 if(!validPeriod(period))throw new Error('Período Meta inválido.');
 const token=await readSecret(ctx,'meta-ads-token');
 const fetcher:typeof fetch=async(input,init)=>{
  const r=await fetch(input,init);
  // Meta can report throttling as HTTP 400. Preserve the shared provider cooldown.
  let throttled=false;const usage=r.headers.get('x-app-usage');try{const u=JSON.parse(usage??'{}');throttled=Math.max(Number(u.call_count??0),Number(u.total_cputime??0),Number(u.total_time??0))>=90;}catch{}
  if(!r.ok){const b:any=await r.clone().json().catch(()=>null);if([4,17,32,613,80004].includes(b?.error?.code)){await ctx.collection('provider_limits').updateOne({_id:'meta'},{$max:{nextAt:new Date(Date.now()+300000)}},{upsert:true});await r.body?.cancel();throw new ProviderReadError(429,'Meta em espera.',300000);}}
  if(throttled)await ctx.collection('provider_limits').updateOne({_id:'meta'},{$max:{nextAt:new Date(Date.now()+60000)}},{upsert:true});return r;
 };
 const reader=new MetaAdsReader(token,new PersistentReadGate(ctx,'meta',850,guard,fetcher,signal));
 const c=ctx.collection('meta_snapshots');await c.createIndex({expiresAt:1},{expireAfterSeconds:0});
 for(const account of metaAccounts){
  await guard();const key=metaPeriodKey(period)+':'+account.id;
  const existing=await c.findOne({_id:key});
  // Retries reuse accounts completed in the current 10-minute window.
  if(existing&&Date.now()-Date.parse(existing.data.syncedAt)<600000)continue;
  const data=await reader.collect(account.id,period);await guard();
  if(Buffer.byteLength(JSON.stringify(data))>1_500_000)throw new Error('Relatório Meta grande demais. Reduza o período.');
  await c.updateOne({_id:key},{$set:{periodKey:metaPeriodKey(period),data,updatedAt:new Date(),expiresAt:new Date(Date.now()+30*86400000)}},{upsert:true});
 }
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
  return metaDashboard(req.query,docs.map(d=>d.data),req.query.account,req.query.campaign);
 });
 app.get('/api/v1/meta/sync',()=>jobStatus(ctx,'meta'));
 app.post<{Body:Period&{refresh?:boolean}}>('/api/v1/meta/sync',{schema:{body:{type:'object',required:['start','end'],additionalProperties:false,properties:{...properties,refresh:{type:'boolean'}}}}},async(req,reply)=>{
  if(!periodOk(req.body))return reply.code(400).send({message:'Selecione até 366 dias, sem datas futuras.'});
  if(process.env.INTEGRATIONS_ENABLED!=='true')return reply.code(409).send({message:'Integrações desabilitadas.'});
  const docs=await ctx.collection('meta_snapshots').find({periodKey:metaPeriodKey(req.body)},{projection:{updatedAt:1}}).toArray();
  const fresh=docs.length===metaAccounts.length&&docs.every(d=>Date.now()-Number(d.updatedAt)<(req.body.refresh?600000:3600000));
  if(fresh)return {status:'complete',completedAt:new Date().toISOString()};
  if(!await ctx.collection('integration_credentials').findOne({_id:'meta-ads-token'},{projection:{_id:1}}))return reply.code(409).send({message:'Credencial Meta não configurada no backend.'});
  return reply.code(202).send(await enqueue(ctx,'meta',{periods:[{start:req.body.start,end:req.body.end}]}));
 });
}
