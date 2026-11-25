import type {DatabaseSync} from 'node:sqlite';
import type {FastifyInstance} from 'fastify';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {businessMinutes,localDay,timeGroup,type AttendanceConfig} from '../shared/business-hours.js';
import {validPeriod,type Period} from '../shared/period.js';

export type Agent={id:string;name:string;human:boolean;active:boolean};
export type ServiceMessage={id:string;at:string;source:string;memberId:string|null;private:boolean;valid:boolean};
export type ServiceSegment={memberId:string;start:string;end:string;ongoing:boolean;firstReplyId?:string;queueMinutes?:number};
export type ServiceEvent={id:string;at:string;kind:string;memberId?:string;previous?:string;next?:string};
export type ServiceChat={id:string;label:string;contactId:string;open:boolean;observedAt:string;entry:string|null;segments:ServiceSegment[];messages:ServiceMessage[];events:ServiceEvent[];coverage:{start:string;end:string}[]};
type Sample={wall:number;business:number};
const stamp=(s:string)=>Date.parse(s);
const finite=(s:unknown):s is string=>typeof s==='string'&&Number.isFinite(stamp(s));
const summary=(samples:Sample[])=>{
 const calc=(values:number[])=>{const n=values.length;if(!n)return {median:null,average:null,p90:null};const sorted=[...values].sort((a,b)=>a-b);return {median:n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2,average:values.reduce((a,b)=>a+b,0)/n,p90:sorted[Math.ceil(n*.9)-1]};};
 return {count:samples.length,wall:calc(samples.map(s=>s.wall)),business:calc(samples.map(s=>s.business))};
};
export function performance(chats:ServiceChat[],agents:Agent[],start:string,end:string,config:AttendanceConfig){
 if(!validPeriod({start,end}))throw Object.assign(new Error('Período inválido.'),{statusCode:400});
 const inPeriod=(at:string)=>finite(at)&&localDay(at)>=start&&localDay(at)<=end;
 const cutoff=Date.parse(end+'T23:59:59.999-03:00');
 const humans=new Map(agents.filter(a=>a.human).map(a=>[a.id,a]));
 const rows=new Map([...humans].map(([id,a])=>[id,{...a,assigned:0,responded:new Set<string>(),leads:new Set<string>(),messages:0,first:[] as Sample[],following:[] as Sample[],queue:[] as number[],withinSla:0,firstUnknown:0,noReply:0,transfersIn:0,transfersOut:0,closed:0,reopened:0,pending:[] as {chatId:string;label:string;minutes:number;businessMinutes:number;at:string;observedAt:string}[],details:[] as {chatId:string;label:string;at:string;kind:string;wall:number|null;business:number|null;bucket:string}[]} ]));
 let unknownAuthors=0,partialChats=0,eligibleChats=0;
 for(const chat of chats){
  const until=Math.min(cutoff,stamp(chat.observedAt));if(!Number.isFinite(until))continue;
  const messages=[...new Map(chat.messages.filter(m=>finite(m.at)&&stamp(m.at)<=until&&!m.private&&m.valid).map(m=>[m.id,m])).values()].sort((a,b)=>stamp(a.at)-stamp(b.at)||a.id.localeCompare(b.id));
  const intervals=[...chat.coverage].filter(c=>finite(c.start)&&finite(c.end)).sort((a,b)=>stamp(a.start)-stamp(b.start));
  const covered=(from:string,to:string)=>{let reached=stamp(from);for(const c of intervals){if(stamp(c.start)>reached+1)break;if(stamp(c.end)>=reached)reached=stamp(c.end);if(reached>=stamp(to))return true;}return false;};
  const sample=(from:string,to:string):Sample|null=>{const wall=(stamp(to)-stamp(from))/60000,business=businessMinutes(from,to,config);return wall>=0&&business!==null?{wall,business}:null;};
  const segments=chat.segments.filter(s=>finite(s.start)&&finite(s.end)&&stamp(s.start)<=until).sort((a,b)=>stamp(a.start)-stamp(b.start));
  const atSegment=(at:string)=>{const ts=stamp(at);const matches=segments.filter(s=>stamp(s.start)<=ts&&(ts<stamp(s.end)||(s.ongoing&&ts<=stamp(s.end))));return matches.length===1?matches[0]:undefined;};
  const human=(m:ServiceMessage)=>m.source==='Member'&&!!m.memberId&&humans.has(m.memberId);
  const detail=(id:string,at:string,kind:string,s:Sample|null)=>rows.get(id)?.details.push({chatId:chat.id,label:chat.label,at,kind,wall:s?.wall??null,business:s?.business??null,bucket:timeGroup(at,config).bucket});
  let pending:ServiceMessage|undefined,hasContact=false;
  const firstReplyIds=new Set<string>();
  for(const seg of segments){
   const reply=messages.find(m=>human(m)&&m.memberId===seg.memberId&&stamp(m.at)>=stamp(seg.start)&&stamp(m.at)<Math.min(stamp(seg.end)+1,until+1));
   if(reply)firstReplyIds.add(reply.id);
   const row=rows.get(seg.memberId);if(!row||!inPeriod(seg.start))continue;
   row.assigned++;if(seg.queueMinutes!==undefined)row.queue.push(seg.queueMinutes);
   const incoming=messages.find(m=>m.source==='Contact'&&stamp(m.at)>=stamp(seg.start)&&stamp(m.at)<=Math.min(stamp(seg.end),until)&&(!reply||stamp(m.at)<=stamp(reply.at)));
   const lastHuman=messages.filter(m=>human(m)&&stamp(m.at)<stamp(seg.start)).at(-1);
   const lastClose=Math.max(-Infinity,...chat.events.filter(e=>e.kind==='ChatClosedMetadataModel'&&stamp(e.at)<stamp(seg.start)).map(e=>stamp(e.at)));
   const boundary=Math.max(lastHuman?stamp(lastHuman.at):-Infinity,lastClose);
   const earlier=messages.some(m=>m.source==='Contact'&&stamp(m.at)>boundary&&stamp(m.at)<stamp(seg.start));
   const from=earlier?seg.start:incoming?.at;
   if(reply&&from&&(covered(from,reply.at)||seg.firstReplyId===reply.id)){
    const value=sample(from,reply.at);if(value){row.first.push(value);if(value.business<=config.slaMinutes)row.withinSla++;detail(seg.memberId,seg.start,'Primeira resposta',value);}
   }else if(!reply&&from&&covered(from,new Date(Math.min(until,stamp(seg.end))).toISOString())){row.noReply++;detail(seg.memberId,seg.start,'Sem resposta no trecho observado',null);}
   else{row.firstUnknown++;detail(seg.memberId,seg.start,'Início sem cobertura suficiente',null);}
  }
  for(const m of messages){
   if(m.source==='Contact'){pending??=m;hasContact=true;continue;}
   if(m.source==='Member'&&!human(m)){if(inPeriod(m.at)&&!agents.some(a=>a.id===m.memberId))unknownAuthors++;continue;}
   if(!human(m))continue;
   const row=rows.get(m.memberId!)!;
   if(inPeriod(m.at)){row.messages++;if(hasContact){row.responded.add(chat.id);row.leads.add(chat.contactId);}}
   if(pending&&inPeriod(m.at)&&!firstReplyIds.has(m.id)){
    const seg=atSegment(m.at);
    if(seg?.memberId===m.memberId){const from=stamp(pending.at)<stamp(seg.start)?seg.start:pending.at;if(covered(from,m.at)){const value=sample(from,m.at);if(value){row.following.push(value);detail(m.memberId!,m.at,'Resposta durante a conversa',value);}}}
   }
   pending=undefined;
  }
  // A pending list is a snapshot at the last collection, separate from historical period counts.
  if(chat.open&&pending&&cutoff>=stamp(chat.observedAt)){
   const seg=atSegment(chat.observedAt),row=seg&&rows.get(seg.memberId);
   const last=messages.filter(m=>m.source==='Contact'||human(m)).at(-1);if(row&&last?.source==='Contact'&&covered(pending.at,chat.observedAt)){
    const from=stamp(pending.at)<stamp(seg!.start)?seg!.start:pending.at,value=sample(from,chat.observedAt);
    if(value)row.pending.push({chatId:chat.id,label:chat.label,minutes:value.wall,businessMinutes:value.business,at:pending.at,observedAt:chat.observedAt});
   }
  }
  for(const e of [...new Map(chat.events.map(e=>[e.id,e])).values()]){
   if(!inPeriod(e.at)||stamp(e.at)>until)continue;
   if(e.kind==='MemberTransferMetadataModel'){
    if(e.previous&&e.next&&e.previous!==e.next){const prev=rows.get(e.previous),next=rows.get(e.next);if(prev)prev.transfersOut++;if(next)next.transfersIn++;}
   }else {const row=e.memberId&&rows.get(e.memberId);if(row){if(e.kind==='ChatClosedMetadataModel')row.closed++;if(e.kind==='ChatReopenedMetadataModel')row.reopened++;}}
  }
  if(messages.some(m=>inPeriod(m.at))||segments.some(s=>inPeriod(s.start))){eligibleChats++;if(!chat.entry||!covered(chat.entry,new Date(until).toISOString()))partialChats++;}
 }
 const items=[...rows.values()].map(r=>({...r,responded:r.responded.size,leads:r.leads.size,first:summary(r.first),following:summary(r.following),queue:summary(r.queue.map(wall=>({wall,business:wall}))).wall,firstSlaRate:r.first.length?r.withinSla/r.first.length:null,pending:r.pending.sort((a,b)=>b.minutes-a.minutes),details:r.details.sort((a,b)=>b.at.localeCompare(a.at)).slice(0,150)})).filter(r=>r.active||r.messages||r.assigned||r.closed||r.reopened).sort((a,b)=>b.responded-a.responded||a.name.localeCompare(b.name,'pt-BR'));
 return {period:{start,end},config,items,coverage:{eligibleChats,partialChats,unknownAuthors},basis:'Atividades no período; primeira resposta: atribuições iniciadas no período. Pendências: fotografia da última coleta.'};
}

export function loadServiceData(db:DatabaseSync){
 const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>String(r.name)));
 const rows:Record<string,any[]>={};
 for(const name of ['crm_meta','crm_members','chats','service_chats','messages','service_events','service_coverage','service_ratings'])rows[name]=tables.has(name)?db.prepare('SELECT * FROM '+name).all():[];
 return serviceDataFromRows(rows);
}
export function serviceDataFromRows(rows:Record<string,any[]>){
 const exists=(name:string)=>!!rows[name];const meta=Object.fromEntries((rows.crm_meta??[]).map(r=>[String(r.key),JSON.parse(String(r.value))]));
 const agents:Agent[]=exists('crm_members')?(rows.crm_members??[]).map(r=>({id:r.organization_id+':'+r.id,name:String(r.name),human:r.kind==='OrganizationHumanAgentReferenceModel',active:!!r.active})):[];
 const raw=new Map<string,{raw:any;observedAt:string}>();
 for(const r of (rows.chats??[]))raw.set(r.organization_id+':'+r.id,{raw:(r.raw??JSON.parse(String(r.raw_json??'{}'))),observedAt:r.observed_at??meta.publishedAt});
 if(exists('service_chats'))for(const r of (rows.service_chats??[]))raw.set(r.organization_id+':'+r.id,{raw:(r.raw??JSON.parse(String(r.raw_json??'{}'))),observedAt:String(r.observed_at)});
 const chats=new Map<string,ServiceChat>();
 for(const [id,{raw:r,observedAt}] of raw){
  if(r.contact?.contactType!=='DirectMessage'||!finite(observedAt))continue;
  const org=id.split(':')[0],qualify=(m:string)=>org+':'+m,history=r.organizationMemberHistory??[];
  const timeline=(r.timeline??[]) as any[];
  const segments:ServiceSegment[]=[];
  if(timeline.length){for(let i=0;i<timeline.length;i++){const s=timeline[i];if(s.type!=='Human'||!s.memberId||!finite(s.startUTC))continue;const h=history.find((h:any)=>h.memberId===s.memberId&&Math.abs(stamp(h.enteredAt)-stamp(s.startUTC))<1000);const q=timeline[i-1];segments.push({memberId:qualify(s.memberId),start:s.startUTC,end:s.endReason==='Ongoing'?observedAt:s.endUTC,ongoing:s.endReason==='Ongoing',firstReplyId:h?.firstMemberReplyMessage?.id,...(q?.type==='Queue'&&finite(q.startUTC)&&finite(q.endUTC)?{queueMinutes:(stamp(q.endUTC)-stamp(q.startUTC))/60000}:{})});}}
  else{const sorted=[...history].filter((h:any)=>finite(h.enteredAt)).sort((a:any,b:any)=>stamp(a.enteredAt)-stamp(b.enteredAt));for(let i=0;i<sorted.length;i++){const h=sorted[i];if(!h.memberId)continue;segments.push({memberId:qualify(h.memberId),start:h.enteredAt,end:sorted[i+1]?.enteredAt??r.closedAtUTC??observedAt,ongoing:!sorted[i+1]&&!!r.open,firstReplyId:h.firstMemberReplyMessage?.id});}}
  chats.set(id,{id,label:r.contact?.name||'Contato sem nome',contactId:qualify(r.contact?.phoneNumber||r.contact?.id||id),open:!!r.open,observedAt,entry:r.firstContactMessage?.eventAtUTC??null,segments,messages:[],events:[],coverage:[]});
 }
 for(const r of (rows.messages??[])){
  const chat=chats.get(r.organization_id+':'+r.chat_id);if(!chat)continue;const m=(r.raw??JSON.parse(String(r.raw_json??'{}')));
  chat.messages.push({id:String(r.id),at:String(r.event_at_utc),source:m.source??'',memberId:m.sentByOrganizationMember?.id?r.organization_id+':'+m.sentByOrganizationMember.id:null,private:!!m.isPrivate,valid:!['Failed','Error','Processing','Retrying','Submitted','Deleted','Redacted'].includes(m.messageState)&&!['Reaction','CallAttempt'].includes(m.messageType)&&!m.scheduledMessage&&!m.bulkSendSession});
 }
 if(exists('service_events'))for(const r of (rows.service_events??[])){const m=(r.raw??JSON.parse(String(r.raw_json??'{}'))),org=String(r.organization_id);chats.get(org+':'+r.chat_id)?.events.push({id:String(r.id),at:String(r.at),kind:String(r.kind),memberId:m.author?.agentId?org+':'+m.author.agentId:undefined,previous:m.previousMemberId?org+':'+m.previousMemberId:undefined,next:m.newMemberId?org+':'+m.newMemberId:undefined});}
 if(exists('service_coverage'))for(const r of (rows.service_coverage??[]))chats.get(r.organization_id+':'+r.chat_id)?.coverage.push({start:String(r.start_utc),end:String(r.end_utc)});
 const ratings=exists('service_ratings')?(rows.service_ratings??[]).length:0;
 return {chats:[...chats.values()],agents,meta,ratings:Number(ratings)};
}
export function registerAgentPerformance(app:FastifyInstance,db:DatabaseSync|(()=>Promise<ReturnType<typeof loadServiceData>&{version:string}>),getConfig:()=>AttendanceConfig|Promise<AttendanceConfig>,sync?:{status:()=>Promise<any>;request:(period?:Period)=>Promise<any>}){
 let cached:ReturnType<typeof loadServiceData>|undefined,version='';let job:{status:string;startedAt?:string}={status:'idle'};
 const reports=new Map<string,ReturnType<typeof performance>>();
 const read=async()=>{if(typeof db==='function'){const d=await db();version=d.version;return d;}const key=JSON.stringify(db.prepare("SELECT key,value FROM crm_meta WHERE key IN ('publishedAt','attendancePublishedAt') ORDER BY key").all());if(!cached||version!==key){db.exec('BEGIN');try{cached=loadServiceData(db);db.exec('COMMIT');version=key;}catch(e){db.exec('ROLLBACK');throw e;}}return cached;};
 app.get<{Querystring:{start:string;end:string}}>('/api/v1/attendance/agents',{schema:{querystring:{type:'object',required:['start','end'],additionalProperties:false,properties:{start:{type:'string',maxLength:10},end:{type:'string',maxLength:10}}}}},async req=>{const d=await read(),config=await getConfig(),key=JSON.stringify([version,req.query.start,req.query.end,config]);let result=reports.get(key);if(!result){result=performance(d.chats,d.agents,req.query.start,req.query.end,config);reports.set(key,result);if(reports.size>12)reports.delete(reports.keys().next().value!);}return {...result,syncedAt:d.meta.attendancePublishedAt??d.meta.publishedAt,sync:d.meta.attendanceSync??{status:'not-collected'},ratings:{count:d.ratings,collected:!!d.meta.attendanceRatings,partial:d.meta.attendanceRatings?.partial??true}};});
 app.get('/api/v1/attendance/sync',async()=>sync?sync.status():job);
 app.post<{Body:Partial<Period>}>('/api/v1/attendance/sync',{schema:{body:{type:'object',additionalProperties:false,properties:{start:{type:'string',maxLength:10},end:{type:'string',maxLength:10}}}}},async(req,reply)=>{
  if((req.body?.start||req.body?.end)&&!validPeriod(req.body))return reply.code(400).send({message:'Período inválido.'});
  if(sync)return reply.code(202).send(await sync.request(validPeriod(req.body)?req.body:undefined));
  if(job.status==='running')return reply.code(202).send(job);
  job={status:'running',startedAt:new Date().toISOString()};
  const child=spawn('powershell.exe',['-NoProfile','-File',resolve('scripts/enrich-umbler.ps1'),'-Days','90','-MaxRequests','150'],{cwd:process.cwd(),windowsHide:true,stdio:'ignore'});
  child.once('error',()=>{job={...job,status:'error'};});child.once('exit',code=>{job={...job,status:code===0?'complete':'error'};});return reply.code(202).send(job);
 });
}
export type AgentPerformance=ReturnType<typeof performance>;
