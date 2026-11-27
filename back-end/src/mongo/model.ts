import {serviceDataFromRows} from '../agent-performance.js';
import {groupLeads} from '../funnel.js';
import type {Conversation} from '../attendance.js';
import {extractCtaKey} from '../cta.js';
import {messageFacts} from './message-storage.js';

export type Rows=Record<string,any[]>;
export function buildViews(rows:Rows,storeContent=false){
 const meta=Object.fromEntries((rows.crm_meta??[]).filter(r=>!String(r.key).startsWith('import:')).map(r=>[r.key,JSON.parse(r.value)]));
 const contacts=(rows.crm_contacts??[]).map(r=>({...r,firstInboundAt:r.first_inbound_at,tags:[] as {name:string;scopes:string[]}[]}));
 const byContact=new Map(contacts.map(c=>[c.id,c]));
 const rawChats=new Map<string,any>();
 for(const row of rows.chats??[]){
  const raw=row.raw??JSON.parse(row.raw_json??'{}');rawChats.set(row.organization_id+':'+row.id,raw);
  const contact=byContact.get(row.organization_id+':'+raw.contact?.id);if(!contact)continue;
  for(const [scope,tags] of [['contato',raw.contact?.tags],['conversa',raw.tags]]){
   if(!Array.isArray(tags))continue;
   for(const t of tags){if(typeof t?.name!=='string'||!t.name.trim())continue;const name=t.name.trim();let tag=contact.tags.find((x:any)=>x.name===name);if(!tag){tag={name,scopes:[]};contact.tags.push(tag);}if(!tag.scopes.includes(scope))tag.scopes.push(scope);}
  }
 }
 const conversations=(rows.crm_chats??[]).map(r=>({...r,phone:byContact.get(r.contact_id)?.phone??null,source:byContact.get(r.contact_id)?.source??'Não identificada',entry:rawChats.get(r.id)?.firstContactMessage?.eventAtUTC??null}));
 const byChat=new Map(conversations.map(c=>[c.id,c]));
 const rawMessages=new Map((rows.messages??[]).map(r=>[r.organization_id+':'+r.chat_id+':'+r.id,r.raw??JSON.parse(r.raw_json??'{}')]));
 const hasRoster=!!rows.crm_members,humans=new Set((rows.crm_members??[]).filter(r=>r.kind==='OrganizationHumanAgentReferenceModel').map(r=>r.organization_id+':'+r.id));
 const messages=(rows.crm_messages??[]).map(r=>{
  const raw=rawMessages.get(r.chat_id+':'+r.id)??{},source=raw.source??null;
  const automated=raw.scheduledMessage||raw.bulkSendSession||['Failed','Error','Processing','Retrying','Submitted','Deleted','Redacted'].includes(raw.messageState)||['Reaction','CallAttempt'].includes(raw.messageType);
  const memberId=r.chat_id.split(':')[0]+':'+raw.sentByOrganizationMember?.id;
  const item={...r,id:r.chat_id+':'+r.id,messageId:r.id,contactId:byChat.get(r.chat_id)?.contact_id??null,ctaKey:extractCtaKey({...r,...(raw.ctaKey!==undefined?{ctaKey:raw.ctaKey}:{})}),...(raw.adAttributionVersion?{adAttributionVersion:raw.adAttributionVersion,adSourceId:raw.adSourceId??null}:{}),source,attendanceSource:source==='Member'&&(automated||(hasRoster&&!humans.has(memberId)))?null:source};
  return storeContent&&r.contentStored!==false?{...item,contentStored:true}:messageFacts(item);
 });
 for(const c of contacts){c.tags.sort((a:any,b:any)=>a.name.localeCompare(b.name,'pt-BR'));c.search=normalize(c.label+' '+(c.phone??''));}
 for(const c of conversations)c.search=(c.label+' '+(c.phone??'')).toLowerCase();
 const service=serviceDataFromRows(rows);
 const dates=messages.map(m=>m.at).sort();
 return {contacts,conversations,messages,service_conversations:service.chats,members:service.agents,meta,serviceMeta:service.meta,ratings:service.ratings,
  totals:{contacts:contacts.length,conversations:conversations.length,messages:messages.length,conversationsWithMessages:conversations.filter(c=>c.message_count>0).length,googleIndicated:contacts.filter(c=>c.source==='Google indicado').length},range:{first:dates[0]??null,last:dates.at(-1)??null}};
}
export function normalize(value:string){return value.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR');}
export function analytics(contacts:any[],chats:any[],messages:any[],storeContent=false){
 const visible=messages.filter(m=>!m.private);
 const entries=new Map(chats.map(c=>[c.id,c.entry]));
 const leadMessages=visible.map(m=>({contactId:m.contactId,chatId:m.chat_id,id:m.messageId,at:m.at,incoming:m.incoming,firstInChat:!!m.incoming&&!!entries.get(m.chat_id)&&Date.parse(m.at)===Date.parse(entries.get(m.chat_id)),...(storeContent&&m.content!==undefined?{content:m.content}:{}),ctaKey:extractCtaKey(m),adSourceId:m.adSourceId??null,adAttributionVersion:m.adAttributionVersion??0,source:m.source,humanSource:m.attendanceSource}));
 const conversations:Conversation[]=chats.map(c=>({id:c.id,entry:c.entry,limited:!!c.limited,events:[]}));
 const byChat=new Map(conversations.map(c=>[c.id,c]));
 for(const m of visible)byChat.get(m.chat_id)?.events.push({at:m.at,incoming:m.incoming,source:m.attendanceSource});
 return {funnel:groupLeads(contacts,leadMessages),attendance:{conversations,leads:groupLeads(contacts,leadMessages.map((m,i)=>({...m,source:visible[i].attendanceSource})))}};
}
