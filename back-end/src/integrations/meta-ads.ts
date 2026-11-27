import {ReadGate} from './read-transport.js';
import {metaAccounts,type MetaMetrics,type MetaRow} from '../../../shared/meta.js';
import type {Period} from '../../../shared/period.js';

const number=(v:unknown)=>Number.isFinite(Number(v))&&Number(v)>=0?Number(v):0;
const text=(v:unknown,max=500)=>typeof v==='string'?v.slice(0,max):'';
function actions(list:any):Record<string,number>{return Object.fromEntries((Array.isArray(list)?list:[]).filter(r=>typeof r.action_type==='string').map(r=>[text(r.action_type,180),Number.isFinite(Number(r.value))?Number(r.value):0]));}
export function metaMetrics(r:any):MetaMetrics{return {spend:number(r.spend),impressions:number(r.impressions),clicks:number(r.clicks),linkClicks:number(r.inline_link_clicks),reach:r.reach==null?null:number(r.reach),actions:actions(r.actions),values:actions(r.action_values)};}
export function safeMetaUrl(value:unknown,image=false){
 try{const u=new URL(String(value));if(u.protocol!=='https:'||u.username||u.password||u.searchParams.has('access_token'))return null;
 const allowed=image?['fbcdn.net','cdninstagram.com','facebook.com']:['instagram.com','facebook.com'];
 return allowed.some(h=>u.hostname===h||u.hostname.endsWith('.'+h))?u.toString():null;
 }catch{return null;}
}
export function normalizeMetaRow(r:any,accountId:string):MetaRow{return {...metaMetrics(r),id:text(r.ad_id??r.adset_id??r.campaign_id??r.account_id,40),accountId,name:text(r.ad_name??r.adset_name??r.campaign_name??r.account_name),campaignId:text(r.campaign_id,40),campaignName:text(r.campaign_name),adsetId:text(r.adset_id,40),adsetName:text(r.adset_name),...(r.publisher_platform?{platform:text(r.publisher_platform,30)}:{}),...(r.date_start?{date:text(r.date_start,10)}:{})};}
export class MetaAdsReader {
 requests=0;
 constructor(private token:string,private gate:ReadGate=new ReadGate(800)){}
 async get(path:string,params:Record<string,string>={}){
  if(!/^act_\d+(\/(insights|ads|campaigns|adsets))?$/.test(path)||!metaAccounts.some(a=>path.split('/')[0]==='act_'+a.id))throw new Error('Conta Meta não autorizada.');
  if(++this.requests>180)throw new Error('Limite de chamadas Meta atingido.');
  const u=new URL('https://graph.facebook.com/v27.0/'+path);for(const[k,v]of Object.entries(params))u.searchParams.set(k,v);
  return await this.gate.send(u,{method:'GET',headers:{Authorization:'Bearer '+this.token}},this.token) as any;
 }
 async pages(path:string,params:Record<string,string>,limit=2500){
  const rows:any[]=[],cursors=new Set<string>();let after='';
  for(let page=0;page<30;page++){
   const body=await this.get(path,{...params,limit:'500',...(after?{after}:{})});
   if(!Array.isArray(body.data))throw new Error('Relatório Meta inválido.');rows.push(...body.data);
   if(rows.length>limit)throw new Error('Relatório grande demais. Reduza o período.');
   if(!body.paging?.next)return rows;
   // Never follow provider URLs: they may contain a credential or unexpected origin.
   after=body.paging?.cursors?.after;if(typeof after!=='string'||after.length>4000||cursors.has(after))throw new Error('Paginação Meta inválida.');cursors.add(after);
  }throw new Error('Paginação Meta excedeu o limite.');
 }
 async daily(accountId:string,period:Period,kind:'account'|'ads'|'instagram'){
  const level=kind==='account'?'account':'ad';
  const rows=await this.pages('act_'+accountId+'/insights',{
   time_range:JSON.stringify({since:period.start,until:period.end}),time_increment:'1',action_report_time:'impression',use_unified_attribution_setting:'true',level,
   fields:'account_id,account_name,date_start,'+(level==='account'?'':'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,')+'spend,impressions,clicks,inline_link_clicks,actions,action_values',
   ...(kind==='instagram'?{breakdowns:'publisher_platform',filtering:JSON.stringify([{field:'publisher_platform',operator:'IN',value:['instagram']}])}:{}),
  },15000);
  return rows.filter(r=>kind!=='instagram'||r.publisher_platform==='instagram').map(r=>normalizeMetaRow(r,accountId));
 }
 async reach(accountId:string,period:Period,kind:'account'|'campaigns'|'adsets'|'ads'|'instagram'){
  const level=kind==='account'?'account':kind==='campaigns'?'campaign':kind==='adsets'?'adset':'ad';
  return this.pages('act_'+accountId+'/insights',{time_range:JSON.stringify({since:period.start,until:period.end}),action_report_time:'impression',use_unified_attribution_setting:'true',level,
   fields:(level==='account'?'account_id':level==='campaign'?'campaign_id':level==='adset'?'adset_id':'ad_id')+',reach',
   ...(kind==='instagram'?{breakdowns:'publisher_platform',filtering:JSON.stringify([{field:'publisher_platform',operator:'IN',value:['instagram']}])}:{}),
  });
 }
 async details(accountId:string,ids:string[]){
  const details:any[]=[];
  for(let i=0;i<ids.length;i+=50)details.push(...await this.pages('act_'+accountId+'/ads',{fields:'id,name,effective_status,campaign{id,name,objective,effective_status},adset{id,name,effective_status},creative{id,title,body,thumbnail_url,image_url,instagram_permalink_url,effective_instagram_media_id,object_type,object_story_spec}',filtering:JSON.stringify([{field:'id',operator:'IN',value:ids.slice(i,i+50)}])}));
  return details.map(d=>{const c=d.creative??{},story=c.object_story_spec??{};return {id:text(d.id,40),status:text(d.effective_status,50),campaign:{id:text(d.campaign?.id,40),status:text(d.campaign?.effective_status,50),objective:text(d.campaign?.objective,80)},adset:{id:text(d.adset?.id,40),status:text(d.adset?.effective_status,50)},creative:{title:text(c.title??story.link_data?.name),body:text(c.body??story.video_data?.message??story.link_data?.message,1800),image:safeMetaUrl(c.image_url??c.thumbnail_url,true),permalink:safeMetaUrl(c.instagram_permalink_url),format:story.link_data?.child_attachments?'CAROUSEL':text(c.object_type,40),instagramId:text(c.effective_instagram_media_id,40)}};});
 }
}
