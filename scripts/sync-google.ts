import 'dotenv/config';
import { OAuth2Client } from 'google-auth-library';
import { mkdir, rename, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { GoogleAdsReader, reportFields, type GoogleReport } from '../src/server/integrations/google-ads.js';
import { periodChunks,validPeriod } from '../src/shared/period.js';

async function main() {
 if(process.env.APP_MODE==='mongo')throw new Error('Coletor legado desativado: execute npm run sync:google.');
 const {GOOGLE_ADS_CLIENT_ID:clientId,GOOGLE_ADS_CLIENT_SECRET:clientSecret,GOOGLE_ADS_CUSTOMER_ID:customerId,GOOGLE_ADS_LOGIN_CUSTOMER_ID:manager,JBR_GOOGLE_REFRESH_TOKEN:refreshToken}=process.env;
 if(!clientId||!clientSecret||!customerId||!manager||!refreshToken) throw new Error('Configuração Google incompleta.');
 const auth=new OAuth2Client({clientId,clientSecret}); auth.setCredentials({refresh_token:refreshToken});
 const access=await auth.getAccessToken(); if(!access.token) throw new Error('Não foi possível renovar a autorização Google.');
 const reader=new GoogleAdsReader({accessToken:access.token,version:process.env.GOOGLE_ADS_API_VERSION||'v26',loginCustomerId:manager});
 const rows=(response:unknown):any[]=>{if(!Array.isArray(response)||response.some(b=>!b||typeof b!=='object'||(b.results!==undefined&&!Array.isArray(b.results)))) throw new Error('Resposta inválida.');return response.flatMap(b=>b.results??[]);};
 const account=rows(await reader.account(customerId))[0]?.customer;
 if(!account?.timeZone||!account?.currencyCode) throw new Error('Fuso ou moeda da conta ausente.');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:account.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const endDate=new Date(today+'T12:00:00Z');endDate.setUTCDate(endDate.getUTCDate()-1);
 const startDate=new Date(endDate);startDate.setUTCDate(startDate.getUTCDate()-29);
 const arg=(name:string)=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
 let end=arg('--end')??endDate.toISOString().slice(0,10),start=arg('--start')??startDate.toISOString().slice(0,10);
 if(!validPeriod({start,end})||end>today)throw new Error('Período inválido.');
 try{const previous=JSON.parse(await readFile(resolve('local-data/google-ads.json'),'utf8'));if(previous.period?.start<start)start=previous.period.start;if(previous.period?.end>end)end=previous.period.end;}catch{/* First synchronization. */}
 const chunks=periodChunks({start,end});
 const response:any[]=[];
 for(const p of chunks)response.push(...await reader.campaigns(customerId,p.start,p.end) as any[]);
 const actions=rows(await reader.conversionActions(customerId)).map(r=>r.conversionAction);
 const conversionRows:any[]=[];
 for(const p of chunks)conversionRows.push(...rows(await reader.dailyConversions(customerId,p.start,p.end)));
 const conversionDaily=conversionRows.map(r=>({date:r.segments.date,action:r.segments.conversionAction,name:r.segments.conversionActionName,value:Number(r.metrics?.allConversionsByConversionDate??0)}));
 if(conversionDaily.some(r=>!Number.isFinite(r.value))) throw new Error('Conversões inválidas.');
 const daily:{date:string;campaignId:string;clicks:number;impressions:number;spend:number;conversions:number}[]=[];
 if(!Array.isArray(response)) throw new Error('Resposta Google fora do formato esperado.');
 const campaigns=new Map<string,{id:string;name:string;clicks:number;impressions:number;spend:number;conversions:number}>();
 for(const batch of response){
  if(!batch || typeof batch!=='object' || (batch.results!==undefined&&!Array.isArray(batch.results))) throw new Error('Resposta Google incompleta.');
  for(const row of batch.results??[]){
   const id=String(row.campaign?.id??'');const name=row.campaign?.name;const m=row.metrics;
   if(!/^\d+$/.test(id)||typeof name!=='string'||!m) throw new Error('Campanha inválida na resposta.');
   const numbers=[m.clicks??0,m.impressions??0,m.costMicros??0,m.conversions??0].map(Number);
   if(numbers.some(n=>!Number.isFinite(n)||n<0)) throw new Error('Métricas inválidas na resposta.');
   daily.push({date:row.segments.date,campaignId:id,clicks:numbers[0],impressions:numbers[1],spend:numbers[2]/1_000_000,conversions:numbers[3]});
   const c=campaigns.get(id)??{id,name,clicks:0,impressions:0,spend:0,conversions:0};
   c.name=name;c.clicks+=numbers[0];c.impressions+=numbers[1];c.spend+=numbers[2]/1_000_000;c.conversions+=numbers[3];campaigns.set(id,c);
  }
 }
 const items=[...campaigns.values()].sort((a,b)=>b.spend-a.spend);
 const totals=items.reduce((a,c)=>({clicks:a.clicks+c.clicks,impressions:a.impressions+c.impressions,spend:a.spend+c.spend,conversions:a.conversions+c.conversions}),{clicks:0,impressions:0,spend:0,conversions:0});
 const reports:Record<string,{available:boolean;rows:unknown[]}>= {};
 for(const kind of Object.keys(reportFields) as GoogleReport[]){
  try{let result:any[]=[];for(const p of chunks)result.push(...rows(await reader.report(customerId,kind,p.start,p.end)));
   if(kind==='campaigns'&&chunks.length>1){result=[...new Map(result.map(r=>[r.campaign.id,{...r,metrics:{}}])).values()];}
   reports[kind]={available:true,rows:result};console.log(`Relatório ${kind}: ${result.length} linhas.`);}
  catch {reports[kind]={available:false,rows:[]};console.log(`Relatório ${kind} indisponível nesta coleta.`);}
 }
 const data={connected:true,period:{start,end},syncedAt:new Date().toISOString(),timezone:account.timeZone,currency:account.currencyCode,account,actions,conversionDaily,daily,campaigns:items,metrics:totals,reports};
 const folder=resolve('local-data');await mkdir(folder,{recursive:true});const target=resolve(folder,'google-ads.json'),temp=target+'.tmp';
 await writeFile(temp,JSON.stringify(data),{mode:0o600});await rename(temp,target);
 console.log(`Google Ads atualizado: ${items.length} campanhas, ${start} a ${end}.`);
}
main().catch(error=>{console.error(error?.status ? `Google Ads retornou HTTP ${error.status}. Os dados anteriores foram preservados.` : 'Não foi possível sincronizar Google Ads. Confira autorização, nível de acesso e conexão. Os dados anteriores foram preservados.');process.exitCode=1;});
