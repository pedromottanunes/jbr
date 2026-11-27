import {createHash,randomUUID} from 'node:crypto';
import {BSON} from 'mongodb';
import type {MongoContext} from './connection.js';
import {buildViews,type Rows} from './model.js';
import {sourceKeys,viewNames} from './schema.js';
import {stageGeneration,retireGeneration} from './publication-gc.js';
import {messageStorage,sourceFacts} from './message-storage.js';
import {adsStorageFormat,packAdsRows,unpackAdsRows} from './ads-storage.js';

export const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const viewGeneration=(revision:any,name:string):string=>revision.generations?.[name]??revision.generation;
export async function bulk(ctx:MongoContext,name:string,documents:any[],guard?:()=>Promise<void>){
 const collection=ctx.collection(name);
 for(let i=0;i<documents.length;i+=500){
  const batch=documents.slice(i,i+500);
  await guard?.();
  if(batch.some(d=>BSON.calculateObjectSize(d)>15*1024*1024))throw new Error('Documento excede limite seguro de tamanho.');
  await collection.bulkWrite(batch.map(d=>({replaceOne:{filter:{_id:d._id},replacement:d,upsert:true}})),{ordered:false});
 }
}
export async function saveSourceRows(ctx:MongoContext,rows:Rows){
 const policy=await messageStorage(ctx);
 // Legacy local backups can still contain the old attendance chat copy.
 const chats=new Map((rows.chats??[]).map(r=>[r.organization_id+':'+r.id,{...r}]));
 for(const r of rows.service_chats??[]){const key=r.organization_id+':'+r.id;chats.set(key,{...(chats.get(key)??r),observed_at:r.observed_at,service_candidate:true});}
 rows={...rows,chats:[...chats.values()]};
 for(const [name,keys] of Object.entries(sourceKeys)){
  const documents=(rows[name]??[]).map(row=>{let data={...row};if(data.raw_json){data.raw=JSON.parse(data.raw_json);delete data.raw_json;}if(name==='export_runs')delete data.file_path;data=sourceFacts(name,data,policy.storeContent);return {...data,_id:digest(keys.map(k=>row[k])),hash:digest(data)};});
  const existing=new Map((await ctx.collection('umbler_'+name).find({},{projection:{hash:1}}).toArray()).map(d=>[d._id,d.hash]));
  await bulk(ctx,'umbler_'+name,documents.filter(d=>existing.get(d._id)!==d.hash));
 }
 for(const r of rows.crm_meta??[]){if(!String(r.key).startsWith('import:'))await ctx.collection('integration_state').updateOne({_id:r.key},{$set:{value:JSON.parse(r.value)}},{upsert:true});}
}
export async function loadSourceRows(ctx:MongoContext):Promise<Rows>{
 const rows:Rows={};
 // Export archives, channel catalogs and discovery checkpoints do not feed views.
 // Project before transferring/deserializing. Full provider envelopes stay in
 // raw storage; analytics does not need attachments or repeated channel data.
 const chatFields=['organization_id','id','observed_at','service_candidate','raw.contact.id','raw.contact.name','raw.contact.phoneNumber','raw.contact.contactType','raw.contact.tags','raw.tags','raw.firstContactMessage.eventAtUTC','raw.lastMessage.eventAtUTC','raw.createdAtUTC','raw.open','raw.closedAtUTC','raw.organizationMemberHistory.memberId','raw.organizationMemberHistory.enteredAt','raw.organizationMemberHistory.firstMemberReplyMessage.id','raw.timeline'];
 const fields:Record<string,string[]>={
  chats:chatFields,
  messages:['organization_id','chat_id','id','event_at_utc','contentStored','raw.ctaKey','raw.adSourceId','raw.adAttributionVersion','raw.source','raw.sentByOrganizationMember.id','raw.sentByOrganizationMember.name','raw.messageType','raw.messageState','raw.isPrivate','raw.scheduledMessage','raw.bulkSendSession','raw.headerContent','raw.content','raw.footer'],
  chat_sync:['organization_id','chat_id','backfill_complete','history_limited'],
  crm_members:['organization_id','id','name','kind','active'],
  service_events:['organization_id','chat_id','id','at','kind','raw.author.agentId','raw.previousMemberId','raw.newMemberId'],
  service_coverage:['organization_id','chat_id','start_utc','end_utc'],service_ratings:['id'],
 };
 for(const [name,keys] of Object.entries(fields))rows[name]=await ctx.collection('umbler_'+name).find({},{projection:{_id:0,...Object.fromEntries(keys.map(k=>[k,1]))}}).maxTimeMS(15000).toArray();
 rows.crm_meta=(await ctx.collection('integration_state').find({_id:{$ne:'attendanceDirty'}}).maxTimeMS(15000).toArray()).map(r=>({key:r._id,value:JSON.stringify(r.value)}));
 return rows;
}
// Checkpoints are durable immediately; expensive analytical views publish at
// most once per three minutes during backfill, and always on completion.
export async function publishPendingUmbler(ctx:MongoContext,owner:string,force=false,signal?:AbortSignal){
 const [dirty,previous]=await Promise.all([
  ctx.collection('integration_state').findOne({_id:'attendanceDirty'}),
  ctx.collection('data_revisions').findOne({_id:'umbler'}),
 ]);
 const changed=!previous||dirty?.value!==false;
 if(changed&&!force&&previous&&Date.now()-+previous.publishedAt<180000)return previous;
 if(changed)await publishUmbler(ctx,normalizeSource(await loadSourceRows(ctx)),owner,signal);
 await ctx.transaction(async session=>{
  signal?.throwIfAborted();
  const held=await ctx.collection('integration_leases').updateOne({_id:'umbler',owner,expiresAt:{$gt:new Date()}},{$set:{expiresAt:new Date(Date.now()+120000)}},{session});
  if(!held.matchedCount)throw new Error('Posse da coleta expirada.');
  if(changed)await ctx.collection('integration_state').updateOne({_id:'attendanceDirty'},{$set:{value:false}},{session,upsert:true});
  else {
   const rows=await ctx.collection('integration_state').find({_id:{$in:['attendanceSync','attendancePublishedAt','attendanceRatings','publishedAt']}},{session}).toArray();
   const update:Record<string,unknown>={publishedAt:new Date()};
   for(const r of rows){update['meta.'+r._id]=r.value;update['serviceMeta.'+r._id]=r.value;}
   await ctx.collection('data_revisions').updateOne({_id:'umbler'},{$set:update},{session});
  }
 });
 return ctx.collection('data_revisions').findOne({_id:'umbler'},{projection:{publishedAt:1}});
}
// Same normalization as the former Python publisher; provider IDs and conservative coverage are preserved.
export function normalizeSource(rows:Rows):Rows&{crm_contacts:any[];crm_chats:any[];crm_messages:any[]}{
 const contacts=new Map<string,any>(),messages:any[]=[],chats:any[]=[];
 const byChat=new Map<string,any[]>();for(const r of rows.messages??[]){const k=r.organization_id+':'+r.chat_id;const list=byChat.get(k)??[];list.push(r);byChat.set(k,list);}
 const members=new Map((rows.crm_members??[]).map(m=>[m.organization_id+':'+m.id,m.name]));
 const coverage=new Map((rows.chat_sync??[]).map(r=>[r.organization_id+':'+r.chat_id,r]));
 for(const row of rows.chats??[]){
  const chat=row.raw??JSON.parse(row.raw_json??'{}'),contact=chat.contact??{};if(contact.contactType!=='DirectMessage'||!contact.id)continue;
  const id=row.organization_id+':'+contact.id,chatId=row.organization_id+':'+row.id;
  let first=chat.firstContactMessage?.eventAtUTC??null,last=chat.lastMessage?.eventAtUTC??chat.createdAtUTC??null;
  const google=[...(chat.tags??[]),...(contact.tags??[])].some(t=>String(t.name??'').toLowerCase().includes('google'));
  const record=contacts.get(id)??{id,label:contact.name||contact.phoneNumber||'Contato sem nome',phone:contact.phoneNumber??null,first_inbound_at:first,source:google?'Google indicado':'Não identificada'};
  if(google)record.source='Google indicado';
  const chatMessages=(byChat.get(chatId)??[]).sort((a,b)=>a.event_at_utc.localeCompare(b.event_at_utc)||a.id.localeCompare(b.id));
  for(const r of chatMessages){const m=r.raw??JSON.parse(r.raw_json??'{}'),incoming=m.source==='Contact',member=m.sentByOrganizationMember??{},kind=m.messageType||'Mensagem';
   if(incoming&&(!first||r.event_at_utc<first))first=r.event_at_utc;if(!last||r.event_at_utc>last)last=r.event_at_utc;
   messages.push({chat_id:chatId,id:r.id,at:r.event_at_utc,author:incoming?'Contato':m.source==='Bot'?'Bot':members.get(row.organization_id+':'+member.id)||member.name||'Equipe',incoming:+incoming,...(r.contentStored===false?{contentStored:false}:{content:['headerContent','content','footer'].filter(k=>m[k]).map(k=>String(m[k])).join('\n')||'['+kind+']'}),...(m.ctaKey!==undefined?{ctaKey:m.ctaKey}:{}),kind,private:+!!m.isPrivate});
  }
  if(first&&(!record.first_inbound_at||first<record.first_inbound_at))record.first_inbound_at=first;contacts.set(id,record);
  const full=coverage.get(chatId);chats.push({id:chatId,contact_id:id,label:contact.name||contact.phoneNumber||'Contato sem nome',at:last,is_open:+!!chat.open,message_count:chatMessages.length,limited:+(!full||!full.backfill_complete||!!full.history_limited)});
 }
 return {...rows,crm_contacts:[...contacts.values()],crm_chats:chats,crm_messages:messages};
}
export async function publishUmbler(ctx:MongoContext,rows:Rows,owner:string,signal?:AbortSignal){
 const policy=await messageStorage(ctx),views=buildViews(rows,policy.storeContent),hashes:Record<string,string>={};
 for(const name of viewNames){views[name].sort((a:any,b:any)=>a.id.localeCompare(b.id));hashes[name]=digest(views[name]);}
 const generation=digest({hashes,meta:views.meta,serviceMeta:views.serviceMeta,ratings:views.ratings});
 const previous=await ctx.collection('data_revisions').findOne({_id:'umbler'});
 if(previous?.generation===generation)return {generation,totals:views.totals,unchanged:true};
 const guard=async()=>{signal?.throwIfAborted();if(!await ctx.renew('umbler',owner))throw new Error('Posse da sincronização expirada.');};
 const generations:Record<string,string>={},previousGenerations:Record<string,string|null>={};

 for(const name of viewNames){
  if(previous?.hashes?.[name]===hashes[name]){generations[name]=viewGeneration(previous,name);previousGenerations[name]=previous.previousGenerations?.[name]??null;continue;}
  const current=randomUUID(),items=views[name];generations[name]=current;previousGenerations[name]=previous?viewGeneration(previous,name):null;
  await guard();await stageGeneration(ctx,'umbler',name,current);
  await bulk(ctx,name,items.map((r:any,i:number)=>({...r,_id:current+':'+i.toString(36),generation:current})),guard);
  if(await ctx.collection(name).countDocuments({generation:current})!==items.length)throw new Error('Contagem de publicação divergente.');
 }
 await guard();
 await ctx.transaction(async session=>{
  const held=await ctx.collection('integration_leases').updateOne({_id:'umbler',owner,expiresAt:{$gt:new Date()}},{$set:{expiresAt:new Date(Date.now()+120000)}},{session});if(!held.matchedCount)throw new Error('Posse da sincronização expirada.');
  const switchedAt=new Date();
  for(const name of viewNames)if(previous&&generations[name]!==viewGeneration(previous,name))await retireGeneration(ctx,'umbler',name,viewGeneration(previous,name),switchedAt,session);
  await ctx.collection('data_revisions').replaceOne({_id:'umbler'},{_id:'umbler',generation,generations,previousGenerations,hashes,publishedAt:new Date(),meta:views.meta,serviceMeta:views.serviceMeta,ratings:views.ratings,totals:views.totals,range:views.range},{upsert:true,session});
 });
 return {generation,totals:views.totals,unchanged:false};
}
export async function publishAds(ctx:MongoContext,data:any,owner?:string,signal?:AbortSignal){
 if(!owner){const held=await ctx.lease('google');if(!held)throw new Error('Coleta Google em andamento.');try{return await publishAds(ctx,data,held,signal);}finally{await ctx.release('google',held);}}
 if(!data.connected||!data.account?.id||!data.period?.start||!data.period?.end)throw new Error('Relatório Google inválido.');
 const previous=await ctx.collection('data_revisions').findOne({_id:'google'});
 const {daily,conversionDaily,campaigns,actions,reports,...header}=data;
 const contentHash=digest({daily,conversionDaily,campaigns,actions,reports}),generation=previous?.storageFormat===adsStorageFormat&&previous?.contentHash===contentHash?previous.generation:randomUUID();
 const guard=async()=>{signal?.throwIfAborted();if(owner&&!await ctx.renew('google',owner))throw new Error('Posse da coleta Google expirada.');};
 const records:any[]=[];let logicalRows=0;const add=(kind:string,items:any[])=>{logicalRows+=items.length;records.push(...packAdsRows(generation,kind,items));};
 for(const [kind,items] of Object.entries({daily,conversionDaily,campaigns,actions}))add(kind,items as any[]);
 const availability:Record<string,boolean>={};for(const [kind,report] of Object.entries(reports??{}) as [string,any][]){availability[kind]=report.available;add('report:'+kind,report.rows??[]);}
 if(previous?.generation!==generation){await guard();await stageGeneration(ctx,'google','ads_rows',generation);await bulk(ctx,'ads_rows',records,guard);}
 if(await ctx.collection('ads_rows').countDocuments({generation})!==records.length)throw new Error('Relatório incompleto.');
 const document={_id:'google',generation,contentHash,storageFormat:adsStorageFormat,previous:previous?.generation===generation?previous.previous:previous?.generation??null,header,availability,rows:logicalRows,documents:records.length,publishedAt:new Date()};
 await guard();
 if(owner)await ctx.transaction(async session=>{
  const held=await ctx.collection('integration_leases').updateOne({_id:'google',owner,expiresAt:{$gt:new Date()}},{$set:{expiresAt:new Date(Date.now()+120000)}},{session});if(!held.matchedCount)throw new Error('Posse da coleta Google expirada.');
  if(previous&&previous.generation!==generation)await retireGeneration(ctx,'google','ads_rows',previous.generation,document.publishedAt,session);
  await ctx.collection('data_revisions').replaceOne({_id:'google'},document,{upsert:true,session});
 });else {
  if(previous&&previous.generation!==generation)await retireGeneration(ctx,'google','ads_rows',previous.generation,document.publishedAt);
  await ctx.collection('data_revisions').replaceOne({_id:'google'},document,{upsert:true});
 }
}
export class MongoReads {
 private adsCaches=new Map<string,{generation:string;data:Promise<any>}>();
 private analyticsCache?:{generation:string;data:Promise<any>};
 private serviceCache?:{generation:string;data:Promise<any>};
 private pointers=new Map<string,{until:number;data:Promise<any>}>();
 constructor(readonly ctx:MongoContext){}
 invalidate(provider?:'umbler'|'google'|'budget'){
  // Provider updates refresh only their pointer. Collection generations decide
  // whether heavy cached data changed; a status/budget update never evicts it.
  if(provider){this.pointers.delete(provider);return;}
  this.pointers.clear();this.analyticsCache=undefined;this.serviceCache=undefined;
 }
 private pointer(id:string){
  let cached=this.pointers.get(id);if(!cached||cached.until<=Date.now()){
   const data=this.ctx.collection('data_revisions').findOne({_id:id});cached={until:Date.now()+2000,data};this.pointers.set(id,cached);
   data.catch(()=>{if(this.pointers.get(id)?.data===data)this.pointers.delete(id);});
  }return cached.data;
 }
 async revision(){const r=await this.pointer('umbler');if(!r)throw Object.assign(new Error('Histórico ainda não publicado no Atlas.'),{statusCode:503});return r;}
 async adsHeader(){return (await this.pointer('google'))?.header??{connected:false,campaigns:[],metrics:null};}
 async ads(profile:'full'|'core'|'daily'='full'){
  const r=await this.pointer('google');if(!r)return {connected:false,campaigns:[],metrics:null};
  if(this.adsCaches.get(profile)?.generation!==r.generation){
   const kinds=profile==='daily'?['daily']:['daily','conversionDaily','campaigns','actions'];
   const data=this.ctx.collection('ads_rows').find({generation:r.generation,...(profile==='full'?{}:{kind:{$in:kinds}})},{projection:{_id:0,kind:1,row:1,rows:1,position:1}}).sort({kind:1,position:1}).maxTimeMS(15000).toArray().then(rows=>{
   const groups=unpackAdsRows(rows);
   return {daily:groups.daily??[],conversionDaily:groups.conversionDaily??[],campaigns:groups.campaigns??[],actions:groups.actions??[],...(profile==='full'?{reports:Object.fromEntries(Object.entries(r.availability).map(([k,available])=>[k,{available,rows:groups['report:'+k]??[]}]))}:{})};
  });this.adsCaches.set(profile,{generation:r.generation,data});data.catch(()=>{if(this.adsCaches.get(profile)?.data===data)this.adsCaches.delete(profile);});}
  return {...r.header,...await this.adsCaches.get(profile)!.data};
 }
 async analytics(){
  const r=await this.revision(),policy=await messageStorage(this.ctx),names=['contacts','conversations','messages'],generation=names.map(n=>viewGeneration(r,n)).join(':')+':'+r.privacyVersion+':'+policy.storeContent;
  if(this.analyticsCache?.generation!==generation){
   const projections=[{id:1,label:1,phone:1,first_inbound_at:1,source:1,tags:1},{id:1,entry:1,limited:1},{contactId:1,chat_id:1,messageId:1,at:1,incoming:1,content:1,ctaKey:1,adSourceId:1,adAttributionVersion:1,source:1,attendanceSource:1}];
   const data=Promise.all(names.map((name,i)=>this.ctx.collection(name).find({generation:viewGeneration(r,name),...(name==='messages'?{private:0}:{})},{projection:{_id:0,...projections[i]}}).maxTimeMS(15000).toArray())).then(async([contacts,chats,messages])=>{
    const {analytics}=await import('./model.js');return analytics(contacts,chats,messages,policy.storeContent);
   });this.analyticsCache={generation,data};data.catch(()=>{if(this.analyticsCache?.data===data)this.analyticsCache=undefined;});
  }return {...await this.analyticsCache!.data,meta:r.meta};
 }
 async service(){
  const r=await this.revision(),generation=['service_conversations','members'].map(n=>viewGeneration(r,n)).join(':');
  if(this.serviceCache?.generation!==generation){
   const data=Promise.all(['service_conversations','members'].map(name=>this.ctx.collection(name).find({generation:viewGeneration(r,name)},{projection:{_id:0,generation:0}}).maxTimeMS(15000).toArray())).then(([chats,agents])=>({chats,agents}));
   this.serviceCache={generation,data};data.catch(()=>{if(this.serviceCache?.data===data)this.serviceCache=undefined;});
  }return {...await this.serviceCache!.data,meta:r.serviceMeta,ratings:r.ratings,version:r.generation};
 }
}
