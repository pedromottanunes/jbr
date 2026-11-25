import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import {normalize,ctaRecordFor} from './cta.js';
import type { Evidence, FunnelLead, FunnelResult, Origin, Stage, ObservedTag } from '../shared/funnel.js';
import {defaultPeriod} from '../shared/period.js';

export {normalize} from './cta.js';
type Contact={id:string;label:string;phone:string|null;first_inbound_at:string|null;source:string;tags?:ObservedTag[]};
type Message={contactId:string;chatId:string;id:string;at:string;incoming:number;content?:string;ctaKey?:string|null;source:string|null};
type RecordLead={id:string;label:string;phone:string|null;enteredAt:string|null;googleTag:boolean;messages:Message[];tags:ObservedTag[]};
type AdsCache={connected?:boolean;period?:{start:string;end:string};syncedAt?:string;timezone?:string;currency?:string;daily?:{date:string;clicks:number;impressions:number;spend:number}[];conversionDaily?:{date:string;action:string;value:number}[];actions?:{resourceName:string;name:string;status:string;type?:string;category?:string}[]};
export type Filters={start?:string;end?:string;action?:string;origin?:Origin|'all';stage?:Stage;q?:string;cursor?:number;limit?:number};
const validStamp=(s:string|null):s is string=>!!s&&Number.isFinite(Date.parse(s));
const stamp=(s:string)=>new Date(s).toISOString();
const validDay=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const invalid=()=>Object.assign(new Error('Filtro inválido.'),{statusCode:400});

// Merge repeated provider contacts only when the full phone number is identical.
export function groupLeads(contacts:Contact[],messages:Message[]):RecordLead[] {
 const groups=new Map<string,RecordLead>(),byId=new Map<string,RecordLead>();
 for(const c of [...contacts].sort((a,b)=>a.id.localeCompare(b.id))) {
  const digits=c.phone?.replace(/\D/g,'')??'';
  const key=/^\d{10,15}$/.test(digits)?`${c.id.split(':')[0]}:phone:${digits}`:c.id;
  let lead=groups.get(key);
  if(!lead){lead={id:c.id,label:c.label,phone:c.phone,enteredAt:null,googleTag:false,messages:[],tags:[]};groups.set(key,lead);}
  for(const tag of c.tags??[]){let existing=lead.tags.find(t=>t.name===tag.name);if(!existing){existing={name:tag.name,scopes:[]};lead.tags.push(existing);}for(const scope of tag.scopes)if(!existing.scopes.includes(scope))existing.scopes.push(scope);}
  if(validStamp(c.first_inbound_at)&&(!lead.enteredAt||stamp(c.first_inbound_at)<lead.enteredAt)) lead.enteredAt=stamp(c.first_inbound_at);
  lead.googleTag ||= c.source==='Google indicado';byId.set(c.id,lead);
 }
 for(const m of messages){const lead=byId.get(m.contactId);if(!lead||!validStamp(m.at))continue;const event={...m,at:stamp(m.at)};lead.messages.push(event);if(m.incoming&&(!lead.enteredAt||event.at<lead.enteredAt))lead.enteredAt=event.at;}
 for(const lead of groups.values())lead.messages.sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
 return [...groups.values()];
}

export function summarize(leads:RecordLead[],ads:AdsCache,filters:Filters,publishedAt:string|null):FunnelResult {
 const timezone=ads.timezone??'America/Sao_Paulo';
 const format=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'});
 const day=(at:string)=>format.format(new Date(at));
 const today=day(new Date().toISOString());const thirtyAgo=new Date(today+'T12:00:00Z');thirtyAgo.setUTCDate(thirtyAgo.getUTCDate()-29);
 const initial=ads.period?defaultPeriod(ads.period):undefined;
 const start=filters.start??initial?.start??thirtyAgo.toISOString().slice(0,10),end=filters.end??initial?.end??today;
 if(!validDay(start)||!validDay(end)||start>end||Date.parse(end)-Date.parse(start)>366*86400000)throw invalid();
 const inPeriod=(date:string)=>date>=start&&date<=end;
 const items:FunnelLead[]=[];
 let returning=0,unknownEntry=0;
 for(const lead of leads){
  if(!lead.enteredAt){unknownEntry++;continue;}
  const enteredDay=day(lead.enteredAt);
  if(!inPeriod(enteredDay)){if(enteredDay<start&&lead.messages.some(m=>m.incoming&&inPeriod(day(m.at))))returning++;continue;}
  const incoming=lead.messages.find(m=>m.incoming&&day(m.at)<=end);
  const firstMessageKnown=!!incoming&&Math.abs(Date.parse(incoming.at)-Date.parse(lead.enteredAt))<1000;
  const match=incoming?ctaRecordFor(incoming)?.sources:undefined;
  const origin:Origin=firstMessageKnown&&match?'site':lead.googleTag?'google':'unknown';
  // A response must follow an inbound message in the same chat; bots and External are excluded.
  const chatInbounds=new Map<string,string>();let reply:Message|undefined;
  for(const m of lead.messages){if(day(m.at)>end)continue;if(m.incoming){if(!chatInbounds.has(m.chatId))chatInbounds.set(m.chatId,m.at);}else if(m.source==='Member'&&chatInbounds.has(m.chatId)&&m.at>=chatInbounds.get(m.chatId)!){reply=m;break;}}
  const evidence:Evidence[]=[{at:lead.enteredAt,kind:'entry',text:'Primeira entrada conhecida'}];
  if(incoming)evidence.push({at:incoming.at,kind:'message',text:match?'CTA do site reconhecido':'Mensagem recebida',contentStored:false,chatId:incoming.chatId,messageId:incoming.id,...(match?{sources:match}:{})});
  if(reply)evidence.push({at:reply.at,kind:'reply',text:'Resposta humana registrada',contentStored:false,chatId:reply.chatId,messageId:reply.id});
  items.push({id:lead.id,label:lead.label,phone:lead.phone,enteredAt:lead.enteredAt,origin,googleTag:lead.googleTag,attended:!!reply,firstMessageKnown,evidence,tags:lead.tags.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'))});
 }
 const actions=(ads.actions??[]).map(a=>({id:a.resourceName,name:a.name,status:a.status}));
 const candidates=(ads.actions??[]).filter(a=>a.status==='ENABLED'&&a.type==='WEBPAGE'&&a.category==='OUTBOUND_CLICK');
 const action=filters.action??(candidates.length===1?candidates[0].resourceName:'');if(action&&!actions.some(a=>a.id===action))throw invalid();
 const available=!!ads.connected&&!!ads.period&&!!ads.daily&&start>=ads.period.start&&end<=ads.period.end;
 const daily=available?ads.daily!.filter(d=>inPeriod(d.date)):[];
 const adsTotals=daily.reduce((s,d)=>({spend:s.spend+d.spend,clicks:s.clicks+d.clicks,impressions:s.impressions+d.impressions}),{spend:0,clicks:0,impressions:0});
 const conversions=available&&action&&ads.conversionDaily?ads.conversionDaily.filter(d=>d.action===action&&inPeriod(d.date)).reduce((n,d)=>n+d.value,0):null;
 const origins=([{id:'site',label:'Site · CTA reconhecido'},{id:'google',label:'Google · etiqueta'},{id:'unknown',label:'A identificar'}] as const).map(o=>({...o,count:items.filter(l=>l.origin===o.id).length}));
 const attended=items.filter(l=>l.attended).length;
 const q=normalize(filters.q??'');
 const phoneQuery=/^[+\d\s().-]+$/.test(filters.q??'')?(filters.q??'').replace(/\D/g,''):'';
 const filtered=items.filter(l=>(!filters.origin||filters.origin==='all'||l.origin===filters.origin)&&(!filters.stage||filters.stage==='all'||(filters.stage==='attended'?l.attended:!l.attended))&&(!q||normalize(l.label+' '+(l.phone??'')).includes(q)||!!(l.phone&&phoneQuery&&l.phone.replace(/\D/g,'').includes(phoneQuery)))).sort((a,b)=>b.enteredAt.localeCompare(a.enteredAt)||a.id.localeCompare(b.id));
 const cursor=filters.cursor??0,limit=filters.limit??20;
 return {period:{start,end},availableAdsPeriod:ads.period??null,timezone,publishedAt,adsSyncedAt:ads.syncedAt??null,
  metrics:{leads:items.length,attended,unanswered:items.length-attended,site:origins[0].count,returning,unknownEntry,missingMessages:items.filter(l=>!l.firstMessageKnown).length,qualified:null,proposals:null,won:null},
  ads:{available,spend:available?adsTotals.spend:null,clicks:available?adsTotals.clicks:null,impressions:available?adsTotals.impressions:null,conversions,action,currency:ads.currency??'BRL',actions},origins,items:filtered.slice(cursor,cursor+limit),total:filtered.length,nextCursor:cursor+limit<filtered.length?cursor+limit:null};
}

export function registerFunnel(app:FastifyInstance,db:DatabaseSync|(()=>Promise<{leads:ReturnType<typeof groupLeads>;publishedAt:string|null}>),readAds:()=>Promise<AdsCache>){
 let cache:RecordLead[]|undefined,version:string|null=null,publishedAt:string|null=null;
 let mongoLeads:RecordLead[]|undefined,mongoAds:AdsCache|undefined,mongoPublished:string|null=null;
 const reports=new Map<string,FunnelResult>();
 const schema={type:'object',additionalProperties:false,properties:{start:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},end:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},action:{type:'string',maxLength:200},origin:{type:'string',enum:['all','site','google','unknown']},stage:{type:'string',enum:['all','attended','unanswered']},q:{type:'string',maxLength:100},cursor:{type:'integer',minimum:0,maximum:1000000},limit:{type:'integer',minimum:1,maximum:50}}};
 app.get<{Querystring:Filters}>('/api/v1/funnel',{schema:{querystring:schema}},async request=>{
  if(typeof db==='function'){
   const [d,ads]=await Promise.all([db(),readAds()]);
   if(mongoLeads!==d.leads||mongoPublished!==d.publishedAt||mongoAds?.daily!==ads.daily||mongoAds?.conversionDaily!==ads.conversionDaily||mongoAds?.actions!==ads.actions||mongoAds?.syncedAt!==ads.syncedAt){reports.clear();mongoLeads=d.leads;mongoAds=ads;mongoPublished=d.publishedAt;}
   const key=JSON.stringify(request.query);let result=reports.get(key);
   if(!result){result=summarize(d.leads,ads,request.query,d.publishedAt);reports.set(key,result);if(reports.size>12)reports.delete(reports.keys().next().value!);}
   return result;
  }
  const current=String(db.prepare("SELECT value FROM crm_meta WHERE key='publishedAt'").get()?.value??'');
  if(!cache||current!==version){
   db.exec('BEGIN');
   try{
    const contacts=db.prepare('SELECT * FROM crm_contacts').all() as unknown as Contact[];
    const contactMap=new Map(contacts.map(c=>[c.id,c]));
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='chats'").get()){
     for(const row of db.prepare('SELECT organization_id,raw_json FROM chats').iterate()){
      const chat=JSON.parse(String(row.raw_json));const id=chat.contact?.id;
      const contact=contactMap.get(String(row.organization_id)+':'+id);if(!contact)continue;
      for(const [scope,tags] of [['contato',chat.contact?.tags],['conversa',chat.tags]] as const){
       if(!Array.isArray(tags))continue;
       for(const tag of tags){if(typeof tag?.name!=='string'||!tag.name.trim())continue;const name=tag.name.trim();contact.tags??=[];let existing=contact.tags.find(t=>t.name===name);if(!existing){existing={name,scopes:[]};contact.tags.push(existing);}if(!existing.scopes.includes(scope))existing.scopes.push(scope);}
      }
     }
    }
    const messages=db.prepare(`SELECT c.contact_id AS contactId,m.chat_id AS chatId,m.id,m.at,m.incoming,m.content,json_extract(r.raw_json,'$.source') AS source,json_extract(r.raw_json,'$.ctaKey') AS ctaKey
     FROM crm_messages m JOIN crm_chats c ON c.id=m.chat_id
     LEFT JOIN messages r ON r.organization_id=substr(m.chat_id,1,instr(m.chat_id,':')-1) AND r.chat_id=substr(m.chat_id,instr(m.chat_id,':')+1) AND r.id=m.id
     WHERE m.private=0`).all() as Message[];
    for(const m of messages){if(m.ctaKey===null)delete m.ctaKey;if(m.content==='')delete m.content;}
    const published=db.prepare("SELECT value FROM crm_meta WHERE key='publishedAt'").get();
    publishedAt=published?JSON.parse(String(published.value)):null;
    cache=groupLeads(contacts,messages);db.exec('COMMIT');version=current;
   }catch(e){db.exec('ROLLBACK');throw e;}
  }
  return summarize(cache,await readAds(),request.query,publishedAt);
 });
}
