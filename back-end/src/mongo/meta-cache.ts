import type {MongoContext} from './connection.js';
import {MetaAdsReader} from '../integrations/meta-ads.js';
import {metaAccounts,sumMeta,type MetaRow,type MetaSnapshot} from '../../../shared/meta.js';
import type {Period} from '../../../shared/period.js';
import {periodDays,nextDay,mergeAttendancePeriods} from './attendance-period.js';

export const metaDailyVersion=1;
export type DailyKind='account'|'ads'|'instagram';
export type MetaDay={day:string;accountId:string;version:number;account?:MetaRow[];ads?:MetaRow[];instagram?:MetaRow[];checked:Partial<Record<DailyKind,string>>};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function missingMetaDays(period:Period,days:MetaDay[],kind:DailyKind,now=Date.now(),end=today()){
 const byDay=new Map(days.map(d=>[d.day,d]));
 return mergeAttendancePeriods(periodDays(period).filter(day=>{
  const d=byDay.get(day),at=d?.checked[kind],age=at?now-Date.parse(at):Infinity;
  // Recent attribution can change; historical days are rechecked weekly.
  return d?.version!==metaDailyVersion||!Array.isArray(d[kind])||age<0||age>=(day>=nextDay(end,-28)?600000:7*86400000);
 }).map(day=>({start:day,end:day})));
}
function grouped(rows:MetaRow[],kind:'ads'|'campaigns'|'adsets'){
 const groups=new Map<string,MetaRow[]>();
 for(const row of rows){const id=kind==='campaigns'?row.campaignId:kind==='adsets'?row.adsetId:row.id;if(!id)continue;const list=groups.get(id)??[];list.push(row);groups.set(id,list);}
 return [...groups].map(([id,list])=>{const last=list.at(-1)!;return {...last,...sumMeta(list),id,name:kind==='campaigns'?last.campaignName:kind==='adsets'?last.adsetName:last.name,date:undefined,reach:null};});
}
export function cachedMetaSnapshot(info:any,period:Period,days:MetaDay[],details:any[]=[]):MetaSnapshot|null{
 const requested=periodDays(period),byDay=new Map(days.filter(d=>d.version===metaDailyVersion).map(d=>[d.day,d]));
 if(!info||requested.some(day=>!Array.isArray(byDay.get(day)?.account)))return null;
 const selected=requested.map(day=>byDay.get(day)!),daily=selected.flatMap(d=>d.account!),ads=grouped(selected.flatMap(d=>d.ads??[]),'ads');
 const complete=selected.every(d=>Array.isArray(d.ads)&&Array.isArray(d.instagram));
 const result:MetaSnapshot={accountId:info.account_id,accountName:info.name,currency:info.currency,timezone:info.timezone_name,accountStatus:info.account_status,
  period,syncedAt:selected.flatMap(d=>Object.values(d.checked)).sort()[0],total:{...sumMeta(daily),reach:null},daily,
  campaigns:grouped(selected.flatMap(d=>d.ads??[]),'campaigns'),adsets:grouped(selected.flatMap(d=>d.ads??[]),'adsets'),ads,
  instagram:grouped(selected.flatMap(d=>d.instagram??[]),'ads'),derived:true,detailsPending:!complete,warnings:[]};
 if(!complete)result.warnings.push('Resumo disponível. Detalhes dos anúncios em atualização.');
 const byId=new Map(details.map(d=>[d.id,d]));
 for(const row of [...result.ads,...result.instagram]){const d=byId.get(row.id);if(d){row.status=d.status;row.creative=d.creative;}}
 for(const row of result.campaigns){const d=details.find(d=>d.campaign?.id===row.id);if(d){row.status=d.campaign.status;row.objective=d.campaign.objective;}}
 for(const row of result.adsets){const d=details.find(d=>d.adset?.id===row.id);if(d)row.status=d.adset.status;}
 return result;
}
const schemaReady=new WeakMap<MongoContext,Promise<void>>();
export class MetaCache {
 private dayReads=new Map<string,Promise<MetaDay[]>>();
 constructor(private ctx:MongoContext,private reader:MetaAdsReader,private guard:()=>Promise<void>){}
 async setup(){
  let pending=schemaReady.get(this.ctx);
  if(!pending){pending=this.createIndexes();schemaReady.set(this.ctx,pending);pending.catch(()=>schemaReady.delete(this.ctx));}
  await pending;
 }
 private async createIndexes(){
  for(const name of ['meta_daily','meta_accounts','meta_creatives','meta_snapshots'])await this.ctx.collection(name).createIndex({expiresAt:1},{expireAfterSeconds:0});
  await this.ctx.collection('meta_daily').createIndex({accountId:1,day:1},{unique:true});
  await this.ctx.collection('meta_creatives').createIndex({accountId:1});
  await this.ctx.collection('meta_snapshots').createIndex({periodKey:1});
 }
 async info(accountId:string){
  const c=this.ctx.collection('meta_accounts'),saved=await c.findOne({_id:accountId});
  if(saved&&Date.now()-+saved.updatedAt<3600000)return saved.info;
  const info=await this.reader.get('act_'+accountId,{fields:'account_id,name,currency,timezone_name,account_status'});
  if(info.account_id!==accountId)throw new Error('Conta Meta divergente.');
  await this.guard();await c.updateOne({_id:accountId},{$set:{info,updatedAt:new Date(),expiresAt:new Date(Date.now()+30*86400000)}},{upsert:true});return info;
 }
 async days(accountId:string,period:Period):Promise<MetaDay[]>{
  const key=accountId+':'+period.start+':'+period.end;
  let pending=this.dayReads.get(key);
  if(!pending){pending=this.ctx.collection('meta_daily').find({accountId,day:{$gte:period.start,$lte:period.end},expiresAt:{$gt:new Date()}}).toArray() as Promise<MetaDay[]>;this.dayReads.set(key,pending);pending.catch(()=>this.dayReads.delete(key));}
  return pending;
 }
 async ensure(accountId:string,period:Period,kind:DailyKind){
  const saved=await this.days(accountId,period),missing=missingMetaDays(period,saved,kind);
  for(const range of missing)for(let start=range.start;start<=range.end;start=nextDay(start,93)){
   const end=nextDay(start,92)<range.end?nextDay(start,92):range.end;
   const emptyAccount=kind!=='account'&&periodDays({start,end}).every(day=>{const d=saved.find(d=>d.day===day);return d?.version===metaDailyVersion&&Array.isArray(d.account)&&d.account.length===0;});
   const rows=emptyAccount?[]:await this.reader.daily(accountId,{start,end},kind),byDay=new Map<string,MetaRow[]>();
   for(const row of rows){if(!row.date||row.date<start||row.date>end)throw new Error('Data divergente no relatório Meta.');const list=byDay.get(row.date)??[];list.push(row);byDay.set(row.date,list);}
   const at=new Date(),operations=periodDays({start,end}).map(day=>{
    const data=byDay.get(day)??[];if(Buffer.byteLength(JSON.stringify(data))>500000)throw new Error('Detalhamento diário Meta excedeu o limite.');
    return {updateOne:{filter:{_id:accountId+':'+day},update:{$set:{accountId,day,version:metaDailyVersion,[kind]:data,['checked.'+kind]:at.toISOString(),updatedAt:at,expiresAt:new Date(+at+30*86400000)}},upsert:true}};
   });
   await this.guard();await this.ctx.collection('meta_daily').bulkWrite(operations,{ordered:false});
   // Reuse this run's data only after the durable write succeeded. Invalidate
   // other overlapping read windows rather than keeping stale in-memory days.
   const key=accountId+':'+period.start+':'+period.end;
   for(const k of this.dayReads.keys())if(k.startsWith(accountId+':')&&k!==key)this.dayReads.delete(k);
   for(const op of operations){const update=op.updateOne.update.$set;let d=saved.find(d=>d.day===update.day);
    if(!d){d={accountId,day:update.day,version:metaDailyVersion,checked:{}};saved.push(d);}
    d.version=metaDailyVersion;d[kind]=update[kind] as MetaRow[];d.checked[kind]=at.toISOString();
   }
  }
 }
 async details(accountId:string,ids:string[]){
  const c=this.ctx.collection('meta_creatives'),existing=await c.find({accountId,expiresAt:{$gt:new Date()}}).toArray(),map=new Map(existing.map(d=>[d.id,d]));
  const missing=ids.filter(id=>!map.has(id)||Date.now()-+map.get(id)!.updatedAt>=3600000);
  if(missing.length){const values=await this.reader.details(accountId,missing),at=new Date();await this.guard();
   if(values.length)await c.bulkWrite(values.map(data=>({updateOne:{filter:{_id:accountId+':'+data.id},update:{$set:{accountId,id:data.id,data,updatedAt:at,expiresAt:new Date(+at+30*86400000)}},upsert:true}})),{ordered:false});
   for(const data of values)map.set(data.id,{data} as any);
  }
  return [...map.values()].map(d=>d.data);
 }
 async trim(accountId:string){
  // One day per account, shared by all date selections. Never duplicate media files.
  const c=this.ctx.collection('meta_daily'),sizes=await c.aggregate([{$match:{accountId}},{$sort:{updatedAt:-1}},{$project:{_id:1,bytes:{$bsonSize:'$$ROOT'}}}]).toArray();
  let bytes=0,count=0;const old=sizes.filter(d=>{bytes+=d.bytes;count++;return bytes>8*1024*1024||count>400;});
  if(old.length)await c.deleteMany({_id:{$in:old.map(d=>d._id)}});
 }
}

/** Reuse daily summaries already collected by the previous version, without API calls. */
export async function seedLegacyMeta(ctx:MongoContext){
 const migrations=ctx.collection('meta_cache_migrations');if(await migrations.findOne({_id:'daily_v1'}))return;
 const snapshots=await ctx.collection('meta_snapshots').find({expiresAt:{$gt:new Date()}}).sort({updatedAt:-1}).toArray();
 const days=new Map<string,any>(),infos=new Map<string,any>(),expiresAt=new Date(Date.now()+30*86400000);
 for(const doc of snapshots){const s=doc.data as MetaSnapshot;if(!metaAccounts.some(a=>a.id===s.accountId))continue;
  if(!infos.has(s.accountId))infos.set(s.accountId,{info:{account_id:s.accountId,name:s.accountName,currency:s.currency,timezone_name:s.timezone,account_status:s.accountStatus},updatedAt:new Date(s.syncedAt),expiresAt});
  const grouped=new Map(s.daily.map(r=>[r.date,r]));
  for(const day of periodDays(s.period)){const id=s.accountId+':'+day;if(days.has(id))continue;
   days.set(id,{accountId:s.accountId,day,version:metaDailyVersion,account:grouped.has(day)?[grouped.get(day)]:[],checked:{account:s.syncedAt},updatedAt:new Date(s.syncedAt),expiresAt});
  }
 }
 if(days.size)await ctx.collection('meta_daily').bulkWrite([...days].map(([id,data])=>({updateOne:{filter:{_id:id},update:{$setOnInsert:data},upsert:true}})),{ordered:false});
 if(infos.size)await ctx.collection('meta_accounts').bulkWrite([...infos].map(([id,data])=>({updateOne:{filter:{_id:id},update:{$setOnInsert:data},upsert:true}})),{ordered:false});
 await migrations.updateOne({_id:'daily_v1'},{$set:{completedAt:new Date(),days:days.size}},{upsert:true});
}

export async function readCachedMeta(ctx:MongoContext,period:Period,accountIds:string[]){
 const [infos,days,creatives]=await Promise.all([
  ctx.collection('meta_accounts').find({_id:{$in:accountIds},expiresAt:{$gt:new Date()}}).toArray(),
  ctx.collection('meta_daily').find({accountId:{$in:accountIds},day:{$gte:period.start,$lte:period.end},expiresAt:{$gt:new Date()}}).maxTimeMS(10000).toArray(),
  ctx.collection('meta_creatives').find({accountId:{$in:accountIds},expiresAt:{$gt:new Date()}}).toArray(),
 ]);
 return accountIds.map(id=>cachedMetaSnapshot(infos.find(d=>d._id===id)?.info,period,days.filter(d=>d.accountId===id) as any,creatives.filter(d=>d.accountId===id).map(d=>d.data))).filter((d):d is MetaSnapshot=>!!d);
}
