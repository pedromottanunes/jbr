import {defaultPeriod} from '../../shared/period.js';
import type {AdMetrics,AdRow,AdsDetail} from '../../shared/contracts.js';
export type {AdMetrics,AdRow,AdsDetail} from '../../shared/contracts.js';
const empty=():AdMetrics=>({impressions:0,clicks:0,spend:0,conversions:0});
const add=(a:AdMetrics,b:AdMetrics)=>{a.impressions+=b.impressions;a.clicks+=b.clicks;a.spend+=b.spend;a.conversions+=b.conversions;return a;};
const metrics=(r:any):AdMetrics=>({impressions:Number(r.metrics?.impressions??0),clicks:Number(r.metrics?.clicks??0),spend:Number(r.metrics?.costMicros??0)/1e6,conversions:Number(r.metrics?.conversions??0)});
const valid=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
export function adsDetail(cache:any,filters:{start?:string;end?:string;campaign?:string}):AdsDetail{
 const initial=cache.period?defaultPeriod(cache.period):undefined;
 const start=filters.start??initial?.start??'',end=filters.end??initial?.end??'',campaign=filters.campaign??'';
 if(start&&end&&(!valid(start)||!valid(end)||start>end))throw Object.assign(new Error('Período inválido'),{statusCode:400});
 const available=!!cache.connected&&!!cache.daily&&start>=cache.period.start&&end<=cache.period.end;
 const within=(date:string)=>date>=start&&date<=end;
 const selected=(id:string)=>!campaign||String(id)===campaign;
 const dailyMap=new Map<string,AdMetrics>();const campaignMap=new Map<string,AdMetrics>();
 if(available)for(const r of cache.daily){if(!within(r.date)||!selected(r.campaignId))continue;add(dailyMap.get(r.date)??(dailyMap.set(r.date,empty()),dailyMap.get(r.date)!),r);add(campaignMap.get(r.campaignId)??(campaignMap.set(r.campaignId,empty()),campaignMap.get(r.campaignId)!),r);}
 const daily:{label:string;date:string;metrics:AdMetrics}[]=[];
 if(available)for(let t=Date.parse(start);t<=Date.parse(end);t+=86400000){const date=new Date(t).toISOString().slice(0,10);daily.push({label:date.slice(8)+'/'+date.slice(5,7),date,metrics:dailyMap.get(date)??empty()});}
 const total=daily.reduce((a,d)=>add(a,d.metrics),empty());
 const weekdays=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(label=>({label,metrics:empty()}));
 for(const d of daily)add(weekdays[new Date(d.date+'T12:00:00Z').getUTCDay()].metrics,d.metrics);
 const report=(kind:string)=>available&&cache.reports?.[kind]?.available?cache.reports[kind].rows.filter((r:any)=>selected(r.campaign?.id)&&(!r.segments?.date||within(r.segments.date))):null;
 const grouped=(kind:string):AdRow[]|null=>{
  const rows=report(kind);if(!rows)return null;const map=new Map<string,AdRow>();
  for(const r of rows){const ad=r.adGroupAd?.ad,k=r.adGroupCriterion;
   const id=[r.campaign.id,r.adGroup?.id,kind==='keywords'?k.criterionId:kind==='terms'?r.searchTermView.searchTerm:kind==='ads'?ad.id:''].join(':');
   let item=map.get(id);if(!item){item={id,name:kind==='keywords'?k.keyword.text:kind==='terms'?r.searchTermView.searchTerm:kind==='ads'?`Anúncio ${ad.id}`:r.adGroup.name,campaignId:r.campaign.id,campaign:r.campaign.name,group:r.adGroup?.name??'',status:k?.status??r.searchTermView?.status??r.adGroupAd?.status??r.adGroup?.status??'',type:k?.keyword?.matchType??ad?.type??r.adGroup?.type??'',...empty(),...(ad?{texts:[...(ad.responsiveSearchAd?.headlines??[]).map((x:any)=>x.text),...(ad.responsiveSearchAd?.descriptions??[]).map((x:any)=>x.text)]}:{})};map.set(id,item);}add(item,metrics(r));
  }return [...map.values()].sort((a,b)=>b.spend-a.spend);
 };
 const campaignRows:AdRow[]=(cache.campaigns??[]).filter((c:any)=>selected(c.id)).map((c:any)=>{
  const r=cache.reports?.campaigns?.rows.find((r:any)=>String(r.campaign.id)===c.id);const full=start===cache.period.start&&end===cache.period.end;
  return {id:c.id,name:c.name,campaign:c.name,campaignId:c.id,group:'',status:r?.campaign.status??'',type:r?.campaign.advertisingChannelType??'',strategy:r?.campaign.biddingStrategyType,budget:r?.campaignBudget?.amountMicros===undefined?undefined:Number(r.campaignBudget.amountMicros)/1e6,share:full&&r?.metrics?.searchImpressionShare!==undefined?Number(r.metrics.searchImpressionShare):null,optimization:r?.campaign.optimizationScore===undefined?null:Number(r.campaign.optimizationScore),...(campaignMap.get(c.id)??empty())};
 });
 const hours=Array.from({length:24},(_,i)=>({label:String(i).padStart(2,'0')+':00',metrics:empty()}));const hr=report('hours');if(hr)for(const r of hr)add(hours[Number(r.segments.hour)].metrics,metrics(r));
 return {available,period:{start,end},coverage:cache.period??null,timezone:cache.timezone??'America/Sao_Paulo',currency:cache.currency??'BRL',syncedAt:cache.syncedAt??null,campaignOptions:(cache.campaigns??[]).map((c:any)=>({id:c.id,name:c.name})),total:available?total:null,daily,weekdays,hours:hr?hours:null,campaigns:available?campaignRows:[],keywords:grouped('keywords'),groups:grouped('groups'),terms:grouped('terms'),ads:grouped('ads')};
}
