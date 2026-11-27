import {GoogleAdsReader,reportFields,type GoogleReport} from '../integrations/google-ads.js';
import {validPeriod,type Period} from '../../../shared/period.js';
import {googleCollectionPlan,outsideGoogleRefresh} from './google-periods.js';
export async function collectGoogle(reader:GoogleAdsReader,customerId:string,period?:Period,previous?:any,manual=false){
 const rows=(response:unknown):any[]=>{if(!Array.isArray(response)||response.some(b=>!b||typeof b!=='object'||(b.results!==undefined&&!Array.isArray(b.results)))) throw new Error('Resposta inválida.');return response.flatMap(b=>b.results??[]);};
 const account=rows(await reader.account(customerId))[0]?.customer;
 if(String(account?.id)!==customerId.replace(/\D/g,'')||!account?.timeZone||!account?.currencyCode) throw new Error('Identidade, fuso ou moeda da conta inválidos.');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:account.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const endDate=new Date(today+'T12:00:00Z');endDate.setUTCDate(endDate.getUTCDate()-1);
 const startDate=new Date(endDate);startDate.setUTCDate(startDate.getUTCDate()-29);

 let end=period?.end??endDate.toISOString().slice(0,10),start=period?.start??startDate.toISOString().slice(0,10);
 if(!validPeriod({start,end})||end>today)throw new Error('Período inválido.');
 const reusable=previous?.account?.id===account.id&&previous?.timezone===account.timeZone&&previous?.currency===account.currencyCode?previous:undefined;
 const plan=googleCollectionPlan({start,end},reusable,today,manual),{chunks}=plan;
 ({start,end}=plan.coverage);
 const retain=(items:any[],getDate:(r:any)=>string)=>plan.full?[]:(items??[]).filter(r=>outsideGoogleRefresh(getDate(r),chunks));
 const response:any[]=[];
 for(const p of chunks)response.push(...await reader.campaigns(customerId,p.start,p.end) as any[]);
 const actions=rows(await reader.conversionActions(customerId)).map(r=>r.conversionAction);
 const conversionRows:any[]=[];
 for(const p of chunks)conversionRows.push(...rows(await reader.dailyConversions(customerId,p.start,p.end)));
 const conversionDaily=[...retain(reusable?.conversionDaily,r=>r.date),...conversionRows.map(r=>({date:r.segments.date,action:r.segments.conversionAction,name:r.segments.conversionActionName,value:Number(r.metrics?.allConversionsByConversionDate??0)}))];
 if(conversionDaily.some(r=>!Number.isFinite(r.value))) throw new Error('Conversões inválidas.');
 const daily:{date:string;campaignId:string;clicks:number;impressions:number;spend:number;conversions:number}[]=retain(reusable?.daily,r=>r.date);
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
   const c=campaigns.get(id)??{id,name,clicks:0,impressions:0,spend:0,conversions:0};c.name=name;campaigns.set(id,c);
  }
 }
 for(const row of daily){const id=row.campaignId;const c=campaigns.get(id)??{id,name:reusable?.campaigns?.find((c:any)=>c.id===id)?.name??id,clicks:0,impressions:0,spend:0,conversions:0};c.clicks+=row.clicks;c.impressions+=row.impressions;c.spend+=row.spend;c.conversions+=row.conversions;campaigns.set(id,c);}
 const items=[...campaigns.values()].sort((a,b)=>b.spend-a.spend);
 const totals=items.reduce((a,c)=>({clicks:a.clicks+c.clicks,impressions:a.impressions+c.impressions,spend:a.spend+c.spend,conversions:a.conversions+c.conversions}),{clicks:0,impressions:0,spend:0,conversions:0});
 const reports:Record<string,{available:boolean;rows:unknown[]}>= {};
 for(const kind of Object.keys(reportFields) as GoogleReport[]){
  try{let result:any[]=[];for(const p of chunks)result.push(...rows(await reader.report(customerId,kind,p.start,p.end)));
   if(kind==='campaigns'){
    const metadata=[...(plan.full?[]:reusable?.reports?.campaigns?.rows??[]),...result];
    result=[...new Map(metadata.map(r=>[r.campaign.id,(!plan.full||chunks.length>1)?{...r,metrics:{}}:r])).values()];
   }else result=[...retain(reusable?.reports?.[kind]?.rows,r=>r.segments.date),...result];
   reports[kind]={available:true,rows:result};console.log(`Relatório ${kind}: ${result.length} linhas.`);}
  // Do not replace a previously good report with empty data after a timeout,
  // throttling, auth failure or unknown schema. Publication is all-or-nothing.
  catch(error) {throw error;}
 }
 const data={connected:true,period:{start,end},syncedAt:new Date().toISOString(),fullSyncedAt:plan.full?new Date().toISOString():reusable.fullSyncedAt,conversionReconciledAt:plan.full||plan.reconcile90?new Date().toISOString():reusable.conversionReconciledAt,refreshedPeriods:chunks,timezone:account.timeZone,currency:account.currencyCode,account,actions,conversionDaily,daily,campaigns:items,metrics:totals,reports};
 return data;
}
