import type {MongoContext} from './connection.js';
import {readSecret} from './secrets.js';
import {PersistentReadGate} from './provider-gate.js';
import {UmblerReader} from '../integrations/umbler.js';
import {digest,loadSourceRows,normalizeSource,publishUmbler} from './datasets.js';
import {saveSourceBatch,sourceRow,sourceMeta,type SourceBatch} from './source-batch.js';
import {checkSignal} from './cancellation.js';
import {ProviderReadError} from '../integrations/read-transport.js';
import {collectionWindow} from './collection-window.js';
import type {Period} from '../../../shared/period.js';
import {periodBounds,periodCollectionWindow} from './attendance-period.js';
import {markAttendanceCoverage} from './attendance-coverage.js';

const stamp=(value:string)=>{const d=new Date(value);if(!Number.isFinite(+d))throw new Error('Data de evento inválida.');return d.toISOString();};
const id=(v:unknown)=>{if(typeof v!=='string'||!/^[-\w]+$/.test(v))throw new Error('Identidade Umbler inválida.');return v;};
class Exhausted extends Error{}
export async function collectUmbler(ctx:MongoContext,owner:string,days=90,maxRequests=150,transport:{fetcher?:typeof fetch;intervalMs?:number;signal?:AbortSignal;period?:Period;cycle?:string}={}){
 const guard=async()=>{checkSignal(transport.signal);if(!await ctx.renew('umbler',owner))throw new Error('Posse da coleta expirada.');};
 const token=await readSecret(ctx,'umbler-token'),reader=new UmblerReader(token,new PersistentReadGate(ctx,'umbler',transport.intervalMs??3000,guard,transport.fetcher,transport.signal));
 let attempts=0;const get=async(path:string,params:Record<string,string|number>={})=>{if(attempts>=maxRequests)throw new Exhausted();attempts++;return await reader.read(path,params) as any;};
 const org=id((await ctx.collection('integration_state').findOne({_id:'organizationId'}))?.value);
 const now=new Date().toISOString(),period=transport.period,bounds=period?periodBounds(period,new Date(now)):undefined;
 const since=bounds?.since??new Date(Date.now()-days*86400000).toISOString(),until=bounds?.until??now;
 const scope=period?period.start+':'+period.end:undefined;
 const save=(batch:SourceBatch)=>saveSourceBatch(ctx,owner,batch,transport.signal);
 const meta=async(key:string,value:any)=>{const batch:SourceBatch={};sourceMeta(batch,key,value);await save(batch);};
 const progress=async(status:string)=>{await meta('attendanceSync',{status,checkedAt:new Date().toISOString(),requests:attempts,from:since,completedChats:await ctx.collection('umbler_service_progress').countDocuments({complete:1}),candidateChats:await ctx.collection('umbler_chats').countDocuments({service_candidate:true})});await meta('attendancePublishedAt',new Date().toISOString());};
 let status='complete';
 try{
  const rosterChecked=(await ctx.collection('integration_state').findOne({_id:'attendanceRosterCheckedAt'}))?.value;
  if(!rosterChecked||Date.parse(now)-Date.parse(rosterChecked)>=86400000){
   const me=await get('/v1/members/me/');if(!Array.isArray(me.organizations)||!me.organizations.some((o:any)=>o.id===org))throw new Error('Credencial não autorizada para organização JBR.');
   const roster=await get('/v1/organizations/'+org+'/');if(!Array.isArray(roster.organizationMembers))throw new Error('Cadastro de atendentes inválido.');
   const members:SourceBatch={};for(const m of roster.organizationMembers)sourceRow(members,'crm_members',['organization_id','id'],{organization_id:org,id:id(m.id),name:m.displayName||'Atendente sem nome',kind:m._t??'',active:+!!m.active,observed_at:now});sourceMeta(members,'attendanceRosterCheckedAt',now);await save(members);
  }
  let state=(await ctx.collection('integration_state').findOne({_id:'attendanceDiscovery'}))?.value;
  if(period){if(!state||state.scope!==scope||state.cycle!==transport.cycle)state={skip:0,until:now,since,analysisUntil:until,complete:false,scope,cycle:transport.cycle,signature:null,phase:'activity'};}
  else if(!state||state.complete||state.days!==days)state={skip:0,until:now,since,complete:false,days,signature:null,phase:'recent'};
  // A continuation retains the same discovery boundary and analytical upper bound.
  const analysisUntil=state.analysisUntil??until;
  for(let pages=0;!state.complete&&pages<20&&attempts<maxRequests-(period?1:2);pages++){
   const params:any={organizationId:org,ChatState:state.phase==='open'?'Open':'All',ContactTypes:'DirectMessage',Include:'MemberTimelines',IncludePinneds:'false',Compact:'false',ChatOrderBy:period?'LastMessage':'CreatedAtUTC',Order:'Desc',Skip:state.skip,Take:50,Behavior:'GetSliceOnly'};
   if(period){params.RelativeStartFromEventUTC=state.until;params.RelativeTakeDirection='TakeBefore';}
   else{params.DateEndCreatedAtUTC=state.until;if(state.phase!=='open')params.DateStartCreatedAtUTC=state.since;}
   const response=await get('/v1/chats/',params),items=response.items;if(!Array.isArray(items))throw new Error('Página de conversas inválida.');
   const signature=items.map((i:any)=>id(i.id)).sort().join(',');if(items.length&&signature===state.signature)throw new Error('Página de conversas repetida.');
   const batch:SourceBatch={};for(const item of items){
    if(!String(item.channel?._t??'').includes('Whatsapp'))continue;
    const first=item.firstContactMessage?.eventAtUTC,last=item.lastMessage?.eventAtUTC??item.eventAtUTC;
    if(period&&((first&&stamp(first)>=analysisUntil)||(last&&stamp(last)<since)))continue;
    sourceRow(batch,'chats',['organization_id','id'],{organization_id:org,id:item.id,channel_id:item.channel.id,raw:item,observed_at:now,service_candidate:true});
   }
   const lastItem=items.at(-1),oldest=lastItem?.lastMessage?.eventAtUTC??lastItem?.eventAtUTC;
   state=period?{...state,skip:state.skip+items.length,signature,complete:items.length<50||!!oldest&&stamp(oldest)<since}:!items.length&&state.phase!=='open'?{...state,skip:0,signature:null,phase:'open'}:{...state,skip:state.skip+items.length,signature,complete:items.length===0};
   sourceMeta(batch,'attendanceDiscovery',state);await save(batch);
  }
  const progressRows=await ctx.collection('umbler_service_progress').find({organization_id:org}).toArray(),byChat=new Map(progressRows.map(r=>[r.chat_id,r]));
  const coverageStarts=new Map((await ctx.collection('umbler_service_coverage').aggregate([{$match:{organization_id:org}},{$group:{_id:'$chat_id',start:{$min:'$start_utc'}}}],{maxTimeMS:15000}).toArray()).map(r=>[r._id,r.start]));
  const candidates=(await ctx.collection('umbler_chats').find({organization_id:org,service_candidate:true},{projection:{_id:0,id:1,'raw.firstContactMessage':1,'raw.lastMessage.eventAtUTC':1,'raw.eventAtUTC':1,'raw.createdAtUTC':1}}).maxTimeMS(15000).toArray()).filter(c=>!period||(!(c.raw.firstContactMessage?.eventAtUTC)||stamp(c.raw.firstContactMessage.eventAtUTC)<analysisUntil)&&stamp(c.raw.lastMessage?.eventAtUTC??c.raw.eventAtUTC??now)>=since);
  const coverageRows=period?await ctx.collection('umbler_service_coverage').find({organization_id:org}).maxTimeMS(15000).toArray():[];
  const coverageByChat=new Map<string,any[]>();for(const c of coverageRows){const list=coverageByChat.get(c.chat_id)??[];list.push(c);coverageByChat.set(c.chat_id,list);}
  const windowFor=(c:any,p:any)=>period?periodCollectionWindow(p,coverageByChat.get(c.id)??[],since,analysisUntil,stamp(c.raw.lastMessage?.eventAtUTC??c.raw.eventAtUTC??now),c.raw.firstContactMessage?.eventAtUTC?stamp(c.raw.firstContactMessage.eventAtUTC):undefined):collectionWindow(p,c.raw.lastMessage?.eventAtUTC??c.raw.eventAtUTC??now,since,now,c.raw.firstContactMessage?.eventAtUTC,coverageStarts.get(c.id));
  const priority=(c:any)=>{const p=byChat.get(c.id);return p?.complete===0?0:!p?1:2;};
  candidates.sort((a,b)=>priority(a)-priority(b)||String(byChat.get(a.id)?.until_utc??'').localeCompare(String(byChat.get(b.id)?.until_utc??''))||String(b.raw.createdAtUTC??'').localeCompare(String(a.raw.createdAtUTC??''))||a.id.localeCompare(b.id));
  // A message reference has only ID/time. Read that one message when necessary
  // for CTA, without marking the intervening history as covered. This subtask
  // shares the request budget and leaves most calls for attendance events.
  const references=candidates.filter(c=>c.raw.firstContactMessage?.id);
  const known=new Set((await ctx.collection('umbler_messages').find({organization_id:org,id:{$in:references.map(c=>c.raw.firstContactMessage.id)}},{projection:{chat_id:1,id:1}}).maxTimeMS(15000).toArray()).map(m=>m.chat_id+':'+m.id));
  const checks=new Map((await ctx.collection('umbler_first_message_checks').find({organization_id:org}).maxTimeMS(15000).toArray()).map(r=>[r.chat_id,r]));
  let firstRequests=0;
  const needsFirst=(c:any)=>{const ref=c.raw.firstContactMessage,check=checks.get(c.id);return !!ref?.id&&(!period||stamp(ref.eventAtUTC)>=since&&stamp(ref.eventAtUTC)<analysisUntil)&&!known.has(c.id+':'+ref.id)&&!(check?.message_id===ref.id&&check.retry_at>now);};
  const readFirst=async(c:any)=>{
   if(!c.raw.firstContactMessage?.id||firstRequests>=Math.min(20,Math.floor(maxRequests/5))||attempts>=maxRequests-2)return;
   const ref=c.raw.firstContactMessage;
   if(!needsFirst(c))return;
   const batch:SourceBatch={};let status='available';firstRequests++;
   try{
    const message=await get('/v1/messages/'+id(ref.id)+'/',{organizationId:org});
    if(message.id!==ref.id||message.source!=='Contact'||message.isPrivate||(message.chat?.id&&message.chat.id!==c.id)||!['MessageModel','SentMessageModel'].includes(message._t)||stamp(message.eventAtUTC)!==stamp(ref.eventAtUTC))throw new Error('Primeira mensagem divergente.');
    sourceRow(batch,'messages',['organization_id','chat_id','id'],{organization_id:org,chat_id:c.id,id:message.id,event_at_utc:stamp(message.eventAtUTC),raw:message});
   }catch(error){if(!(error instanceof ProviderReadError)||![404,410].includes(error.status))throw error;status='unavailable';}
   const checked={organization_id:org,chat_id:c.id,message_id:ref.id,status,checked_at:now,retry_at:status==='unavailable'?new Date(Date.parse(now)+7*86400000).toISOString():null};
   sourceRow(batch,'first_message_checks',['organization_id','chat_id'],checked);
   await save(batch);
   checks.set(c.id,checked);if(status==='available')known.add(c.id+':'+ref.id);
  };
  for(const c of candidates){
   const p=byChat.get(c.id);
   const window=windowFor(c,p);
   if(!window){await readFirst(c);continue;}
   let cursor=window.cursor;const {upper,lower}=window;
   for(let page=0;page<30;page++){
    const response=await get('/v1/chats/'+id(c.id)+'/relative-messages/',{organizationId:org,FromEventUTC:cursor,Take:250,Direction:'TakeBefore',IncludeMetadata:'true'});
    const entries=response.messages;if(!Array.isArray(entries))throw new Error('Página de eventos inválida.');
    const dates=entries.map((e:any)=>{id(e.id);return stamp(e.eventAtUTC);}),oldest=dates.length?dates.sort()[0]:cursor;
    if(entries.length&&oldest>=cursor)throw new Error('Cursor sem avanço.');
    const limited=!!response.hasMessagesBeforeAllowedOrganizationPlan,complete=entries.length<250||oldest<lower,next=entries.length?new Date(Date.parse(oldest)+1).toISOString():cursor;
    if(entries.length&&next>=cursor&&!complete)throw new Error('Página sem desempate temporal.');
    // Validate the complete page before recording any cursor.
    if(entries.some((m:any)=>!String(m._t??'').endsWith('MetadataModel')&&!['MessageModel','SentMessageModel'].includes(m._t)))throw new Error('Tipo de evento desconhecido.');
    const batch:SourceBatch={};for(const item of entries){const kind=item._t,at=stamp(item.eventAtUTC);if(period&&(at<lower||at>=upper))continue;sourceRow(batch,kind.endsWith('MetadataModel')?'service_events':'messages',['organization_id','chat_id','id'],{organization_id:org,chat_id:c.id,id:item.id,...(kind.endsWith('MetadataModel')?{at,kind}:{event_at_utc:at}),raw:item});}
    const covered=complete&&!limited?lower:entries.length?oldest:window.earliest;
    const checkpoint={organization_id:org,chat_id:c.id,cursor:next,until_utc:window.latest,page_upper_utc:upper,from_utc:lower,covered_from_utc:window.earliest&&(!covered||window.earliest<covered)?window.earliest:covered,complete:+complete,limited:+(limited||!!p?.unavailable_before_utc),unavailable_before_utc:limited&&complete?(entries.length?oldest:upper):p?.unavailable_before_utc};
    sourceRow(batch,'service_progress',['organization_id','chat_id'],checkpoint);
    if(entries.length||(complete&&!limited)){const edge=!complete?next:oldest;const start=complete&&!limited?lower:edge<lower?lower:edge;batch.umbler_service_coverage=[{updateOne:{filter:{_id:digest([org,c.id,start])},update:{$set:{organization_id:org,chat_id:c.id,start_utc:start},$max:{end_utc:cursor}},upsert:true}}];const rows=coverageByChat.get(c.id)??[];rows.push({start_utc:start,end_utc:cursor});coverageByChat.set(c.id,rows);}
    await save(batch);
    byChat.set(c.id,checkpoint);
    for(const item of entries)if(['MessageModel','SentMessageModel'].includes(item._t)&&(!period||stamp(item.eventAtUTC)>=lower&&stamp(item.eventAtUTC)<upper))known.add(c.id+':'+item.id);
    cursor=next;if(complete)break;
   }
   // Do not read the same first message again if a needed history page had it.
   await readFirst(c);
  }
  const covered=candidates.every(c=>!windowFor(c,byChat.get(c.id))&&(!period||!needsFirst(c)));
  if(state.complete&&covered){
  const ratings=await get('/v1/contact-ratings/',{organizationId:org,startUTC:since,endUTC:analysisUntil,Take:50,Skip:0,Behavior:'GetSliceOnly'});
  if(!Array.isArray(ratings.items))throw new Error('Avaliações inválidas.');
  const ratingBatch:SourceBatch={};for(const r of ratings.items)sourceRow(ratingBatch,'service_ratings',['organization_id','id'],{organization_id:org,id:id(r.id),raw:r});await save(ratingBatch);
  await meta('attendanceRatings',{checkedAt:now,partial:ratings.items.length>=50});
  }
  status=state.complete&&covered?'complete':'partial';
 }catch(e){status=e instanceof Exhausted?'partial':'error';if(!(e instanceof Exhausted))throw e;}
 // On provider failure or shutdown retain the last published snapshot. Committed
 // pages and cursors remain available to the next run without a full rebuild.
 await guard();await progress(status);await meta('publishedAt',new Date().toISOString());
 const rows=normalizeSource(await loadSourceRows(ctx));await publishUmbler(ctx,rows,owner,transport.signal);
 if(period&&status==='complete')await markAttendanceCoverage(ctx,owner,period,now);
 return {status,requests:attempts};
}
