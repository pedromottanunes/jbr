import type {DatabaseSync} from 'node:sqlite';
import type {FastifyInstance} from 'fastify';
import {groupLeads} from './funnel.js';
import {ctaTexts,ctaRecordFor} from './cta.js';
import {timeGroup,timeLabels,defaultAttendanceConfig,type AttendanceConfig,type TimeBucket} from '../shared/business-hours.js';

type Event={at:string;incoming:number;source:string|null};
export type Conversation={id:string;entry:string|null;limited:boolean;events:Event[]};
const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'});
const day=(date:string)=>formatter.format(new Date(date));
const valid=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const median=(a:number[])=>{if(!a.length)return null;const b=[...a].sort((x,y)=>x-y),i=Math.floor(b.length/2);return b.length%2?b[i]:(b[i-1]+b[i])/2;};

export function ctaByTime(leads:ReturnType<typeof groupLeads>,start:string,end:string,config:AttendanceConfig=defaultAttendanceConfig){
 const result={inside:0,outside:0,weekend:0,unknownFirstMessage:0,total:0};
 const buckets=Object.fromEntries(Object.keys(timeLabels).map(k=>[k,0])) as Record<TimeBucket,number>;
 const counts=new Map(ctaTexts().map(text=>[text,0]));
 for(const lead of leads){
  if(!lead.enteredAt)continue;const date=day(lead.enteredAt);if(date<start||date>end)continue;
  const incoming=lead.messages.find(m=>m.incoming&&day(m.at)<=end);
  if(!incoming||Math.abs(Date.parse(incoming.at)-Date.parse(lead.enteredAt))>=1000){result.unknownFirstMessage++;continue;}
  const cta=ctaRecordFor(incoming);if(!cta)continue;
  counts.set(cta.text,(counts.get(cta.text)??0)+1);
  result.total++;const group=timeGroup(lead.enteredAt,config);buckets[group.bucket]++;if(group.outside)result.outside++;else result.inside++;if(group.weekend)result.weekend++;
 }
 return {...result,buckets,messages:[...counts].map(([text,count])=>({text,count})).sort((a,b)=>b.count-a.count||a.text.localeCompare(b.text,'pt-BR'))};
}

export function attendance(conversations:Conversation[],start:string,end:string,config:AttendanceConfig=defaultAttendanceConfig){
 if(!valid(start)||!valid(end)||start>end||Date.parse(end)-Date.parse(start)>366*86400000)throw Object.assign(new Error('Período inválido.'),{statusCode:400});
 let total=0,observed=0,answered=0,unknown=0,partial=0,noMessages=0,excluded=0;const times:number[]=[];
 const bands=[{label:'Até 5 min',count:0},{label:'5 a 30 min',count:0},{label:'30 min a 1 h',count:0},{label:'Mais de 1 h',count:0}];
 const outside={total:0,answered:0,observed:0,times:[] as number[]},weekend={total:0,answered:0,observed:0,times:[] as number[]};
 const buckets=Object.fromEntries(Object.keys(timeLabels).map(k=>[k,{total:0,answered:0,observed:0,times:[] as number[]}])) as Record<TimeBucket,typeof outside>;
 const byDay=new Map<string,{date:string;entries:number;answered:number}>();
 for(const c of conversations){
  if(!c.entry||!Number.isFinite(Date.parse(c.entry))){excluded++;continue;}
  const date=day(c.entry);if(date<start||date>end)continue;
  const classification=timeGroup(c.entry,config);
  const groups=[buckets[classification.bucket],...(classification.outside?[outside]:[]),...(classification.weekend?[weekend]:[])];
  for(const group of groups)group.total++;
  total++;if(c.limited)partial++;
  const bucket=byDay.get(date)??{date,entries:0,answered:0};bucket.entries++;byDay.set(date,bucket);
  const events=c.events.filter(e=>Number.isFinite(Date.parse(e.at))&&day(e.at)<=end).sort((a,b)=>a.at.localeCompare(b.at));
  const first=events.find(e=>e.incoming===1);
  if(!first){noMessages++;unknown++;continue;}
  // firstContactMessage is independently supplied by the provider; require it to match the cached incoming event.
  if(Math.abs(Date.parse(first.at)-Date.parse(c.entry))>=1000){unknown++;continue;}
  observed++;
  for(const group of groups)group.observed++;
  const reply=events.find(e=>!e.incoming&&e.source==='Member'&&Date.parse(e.at)>=Date.parse(first.at));
  if(reply){const minutes=(Date.parse(reply.at)-Date.parse(first.at))/60000;times.push(minutes);answered++;bucket.answered++;bands[minutes<=5?0:minutes<=30?1:minutes<=60?2:3].count++;for(const group of groups){group.answered++;group.times.push(minutes);}}
 }
 const summarizeGroup=(g:typeof outside)=>({total:g.total,observed:g.observed,answered:g.answered,medianMinutes:median(g.times)});
 return {period:{start,end},config,buckets:Object.fromEntries(Object.entries(buckets).map(([k,g])=>[k,summarizeGroup(g)])) as Record<TimeBucket,ReturnType<typeof summarizeGroup>>,total,observed,answered,withoutObservedReply:observed-answered,unknown,partial,noMessages,excluded,medianMinutes:median(times),averageMinutes:times.length?times.reduce((a,b)=>a+b,0)/times.length:null,outsideHours:summarizeGroup(outside),weekend:summarizeGroup(weekend),bands,days:[...byDay.values()].sort((a,b)=>a.date.localeCompare(b.date))};
}

export function registerAttendance(app:FastifyInstance,db:DatabaseSync|(()=>Promise<{conversations:Conversation[];leads:ReturnType<typeof groupLeads>}>),getConfig:()=>AttendanceConfig|Promise<AttendanceConfig>=()=>defaultAttendanceConfig){
 let version:string|null=null,cache:Conversation[]|null=null,leads:ReturnType<typeof groupLeads>=[];
 const reports=new Map<string,ReturnType<typeof attendance>&{cta:ReturnType<typeof ctaByTime>}>();
 app.get<{Querystring:{start:string;end:string}}>('/api/v1/attendance',{schema:{querystring:{type:'object',required:['start','end'],additionalProperties:false,properties:{start:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},end:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'}}}}},async req=>{
  if(typeof db==='function'){
   const [d,config]=await Promise.all([db(),getConfig()]);if(cache!==d.conversations||leads!==d.leads){reports.clear();cache=d.conversations;leads=d.leads;}
   const key=JSON.stringify([req.query.start,req.query.end,config]);let result=reports.get(key);
   if(!result){result={...attendance(d.conversations,req.query.start,req.query.end,config),cta:ctaByTime(d.leads,req.query.start,req.query.end,config)};reports.set(key,result);if(reports.size>12)reports.delete(reports.keys().next().value!);}
   return result;
  }
  const current=String(db.prepare("SELECT value FROM crm_meta WHERE key='publishedAt'").get()?.value??'');
  if(!cache||version!==current){
   db.exec('BEGIN');try{
    const rows=db.prepare(`SELECT c.id,c.limited,json_extract(r.raw_json,'$.firstContactMessage.eventAtUTC') AS entry FROM crm_chats c LEFT JOIN chats r ON r.organization_id=substr(c.id,1,instr(c.id,':')-1) AND r.id=substr(c.id,instr(c.id,':')+1)`).all();
    const next=rows.map(r=>({id:String(r.id),entry:r.entry?String(r.entry):null,limited:!!r.limited,events:[] as Event[]}));const map=new Map(next.map(c=>[c.id,c]));
    const contacts=db.prepare('SELECT id,label,phone,first_inbound_at,source FROM crm_contacts').all() as unknown as Parameters<typeof groupLeads>[0];
    const leadMessages:Parameters<typeof groupLeads>[1]=[];
    const hasRoster=!!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='crm_members'").get();
    const humans=new Set(hasRoster?db.prepare("SELECT organization_id||':'||id AS id FROM crm_members WHERE kind='OrganizationHumanAgentReferenceModel'").all().map(r=>String(r.id)):[]);
    for(const e of db.prepare(`SELECT m.chat_id,m.id,m.at,m.incoming,m.content,c.contact_id,json_extract(r.raw_json,'$.source') AS source,r.raw_json FROM crm_messages m JOIN crm_chats c ON c.id=m.chat_id LEFT JOIN messages r ON r.organization_id=substr(m.chat_id,1,instr(m.chat_id,':')-1) AND r.chat_id=substr(m.chat_id,instr(m.chat_id,':')+1) AND r.id=m.id WHERE m.private=0 ORDER BY m.at,m.id`).iterate()){
     const raw=e.raw_json?JSON.parse(String(e.raw_json)):{};
     const memberId=String(e.chat_id).split(':')[0]+':'+raw.sentByOrganizationMember?.id;
     const automated=raw.scheduledMessage||raw.bulkSendSession||['Failed','Error','Processing','Retrying','Submitted','Deleted','Redacted'].includes(raw.messageState)||['Reaction','CallAttempt'].includes(raw.messageType);
     const source=e.source==='Member'&&(automated||(hasRoster&&!humans.has(memberId)))?null:e.source?String(e.source):null;map.get(String(e.chat_id))?.events.push({at:String(e.at),incoming:Number(e.incoming),source});
     leadMessages.push({contactId:String(e.contact_id),chatId:String(e.chat_id),id:String(e.id),at:String(e.at),incoming:Number(e.incoming),content:String(e.content),...(raw.ctaKey!==undefined?{ctaKey:raw.ctaKey}:{}),source});
    }
    const grouped=groupLeads(contacts,leadMessages);db.exec('COMMIT');cache=next;leads=grouped;version=current;
   }catch(e){db.exec('ROLLBACK');throw e;}
  }
  const config=await getConfig();return {...attendance(cache,req.query.start,req.query.end,config),cta:ctaByTime(leads,req.query.start,req.query.end,config)};
 });
}
