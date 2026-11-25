import 'dotenv/config';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {BSON} from 'mongodb';
import {connectMongo} from '../src/server/mongo/connection.js';
import {ensureSchema,sourceKeys} from '../src/server/mongo/schema.js';
import {buildViews,type Rows} from '../src/server/mongo/model.js';
import {saveSourceRows,publishUmbler,publishAds,digest} from '../src/server/mongo/datasets.js';
import {defaultAttendanceConfig} from '../src/shared/business-hours.js';

async function main(){
 const index=process.argv.indexOf('--from');if(index<0||!process.argv[index+1])throw new Error('Informe --from com o diretório do backup consistente.');
 const folder=resolve(process.argv[index+1]),db=new DatabaseSync(resolve(folder,'umbler.sqlite3'),{readOnly:true});
 const rows:Rows={};try{for(const table of [...Object.keys(sourceKeys),'service_chats','crm_contacts','crm_chats','crm_messages','crm_meta'])if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))rows[table]=db.prepare('SELECT * FROM '+table).all();}finally{db.close();}
 const orgs=new Set((rows.chats??[]).map(r=>r.organization_id));if(orgs.size!==1)throw new Error('Histórico deve conter exatamente uma organização.');
 const views=buildViews(rows),ads=JSON.parse(await readFile(resolve(folder,'google-ads.json'),'utf8'));
 if(String(ads.account?.id)!==(process.env.GOOGLE_ADS_CUSTOMER_ID??'').replace(/\D/g,''))throw new Error('Conta Google divergente.');
 const sizes=Object.fromEntries(Object.entries(views).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,(v as any[]).reduce((n,d)=>n+BSON.calculateObjectSize(d),0)]));
 console.log(JSON.stringify({phase:'dry-run',totals:views.totals,rawTables:Object.fromEntries(Object.entries(rows).map(([k,v])=>[k,v.length])),viewBytes:sizes}));
 if(!process.argv.includes('--apply'))return;
 const ctx=await connectMongo();let owner:string|null=null;let timer:ReturnType<typeof setInterval>|undefined;
 try{
  await ensureSchema(ctx);owner=await ctx.lease('umbler',120000);if(!owner)throw new Error('Coletor ou importação em andamento.');
  const held=owner;timer=setInterval(()=>{void ctx.renew('umbler',held).catch(()=>{});},20000);
  const id=digest({totals:views.totals,meta:views.meta,ads:ads.syncedAt});
  if((await ctx.collection('migration_runs').findOne({_id:id}))?.status==='complete'){console.log('Este backup já foi importado. Nenhum dado foi regravado.');return;}
  const active=await ctx.collection('data_revisions').findOne({_id:'umbler'});
  if(active&&!await ctx.collection('migration_runs').findOne({_id:id,status:'running'}))throw new Error('Base Atlas já publicada; use uma migração incremental revisada.');
  await ctx.collection('migration_runs').updateOne({_id:id},{$set:{status:'running',updatedAt:new Date(),totals:views.totals}},{upsert:true});
  await saveSourceRows(ctx,rows);console.log('Fontes e checkpoints importados.');
  const result=await publishUmbler(ctx,rows,held);console.log(JSON.stringify({phase:'published',...result}));
  await publishAds(ctx,ads);
  const settings=new DatabaseSync(resolve(folder,'crm-settings.sqlite3'),{readOnly:true});
  try{
   const tables=new Set(settings.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
   const attendance=tables.has('settings')?settings.prepare("SELECT * FROM settings WHERE key='attendance'").get():null;
   await ctx.collection('settings').updateOne({_id:'attendance'},{$setOnInsert:{config:attendance?JSON.parse(String(attendance.value)):defaultAttendanceConfig,revision:Number(attendance?.revision??0)}},{upsert:true});
   if(tables.has('google_budget_snapshots'))for(const r of settings.prepare('SELECT * FROM google_budget_snapshots').all()){
    const parse=(v:any)=>v?JSON.parse(String(v)):null;
    await ctx.collection('google_budget_snapshots').updateOne({_id:String(r.scope)},{$setOnInsert:{state:r.state==='pending'?'error':r.state,lastAttemptAt:r.last_attempt_at,lastSuccessAt:r.last_success_at,payload:parse(r.payload),lastUsable:parse(r.last_usable),lastUsableAt:r.last_usable_at,errorCode:r.state==='pending'?'interrupted':r.error_code,retryAt:r.retry_at}},{upsert:true});
   }
   if(tables.has('google_budget_limits'))for(const r of settings.prepare('SELECT * FROM google_budget_limits').all())await ctx.collection('google_budget_limits').updateOne({_id:String(r.scope)},{$setOnInsert:{value:JSON.parse(String(r.value))}},{upsert:true});
  }finally{settings.close();}
  await ctx.collection('migration_runs').updateOne({_id:id},{$set:{status:'complete',completedAt:new Date(),generation:result.generation}});
  const stats=await ctx.db.command({dbStats:1});console.log(JSON.stringify({phase:'complete',dataBytes:stats.dataSize,indexBytes:stats.indexSize,collections:stats.collections}));
 }finally{if(timer)clearInterval(timer);if(owner)await ctx.release('umbler',owner);await ctx.close();}
}
main().catch(()=>{console.error('Importação interrompida. Dados locais preservados; verifique configuração e conectividade.');process.exitCode=1;});
