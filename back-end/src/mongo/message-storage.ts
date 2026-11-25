import {createHash} from 'node:crypto';
import {Int32,Long,Double,Decimal128,ObjectId} from 'mongodb';
import {extractCtaKey} from '../cta.js';
import type {MongoContext} from './connection.js';

export const messageStorageId='message_storage';
export async function messageStorage(ctx:MongoContext,session?:import('mongodb').ClientSession){
 const row=await ctx.collection('settings').findOne({_id:messageStorageId},{session});
 return {storeContent:row?.storeContent===true,revision:Number(row?.revision??0),purgeStatus:row?.purgeStatus??'pending',purgedAt:row?.purgedAt??null};
}
const scalar=(v:any)=>v===null||['string','number','boolean'].includes(typeof v)||v instanceof Date||[Int32,Long,Double,Decimal128,ObjectId].some(Type=>v instanceof Type);
const pick=(value:any,keys:string[])=>Object.fromEntries(keys.filter(k=>scalar(value?.[k])).map(k=>[k,value[k]]));
export const providerText=(raw:any)=>['headerContent','content','footer'].filter(k=>typeof raw?.[k]==='string'&&raw[k]).map(k=>raw[k]).join('\n');
const reference=(m:any)=>pick(m,['id','eventAtUTC']);
const tags=(items:any)=>Array.isArray(items)?items.map(t=>pick(t,['id','name'])):[];
function chatFacts(raw:any){
 return {...pick(raw,['id','_t','createdAtUTC','eventAtUTC','open','closedAtUTC']),
  contact:{...pick(raw.contact,['id','name','phoneNumber','contactType']),tags:tags(raw.contact?.tags)},tags:tags(raw.tags),
  firstContactMessage:reference(raw.firstContactMessage),lastMessage:reference(raw.lastMessage),
  organizationMemberHistory:(raw.organizationMemberHistory??[]).map((h:any)=>({...pick(h,['memberId','enteredAt']),firstMemberReplyMessage:reference(h.firstMemberReplyMessage)})),
  timeline:(raw.timeline??[]).map((t:any)=>pick(t,['type','memberId','startUTC','endUTC','endReason'])),
 };
}
export function messageFacts(row:any){
 return {...pick(row,['_id','generation','id','messageId','chat_id','contactId','at','incoming','private','source','attendanceSource','kind','author']),
  ctaKey:extractCtaKey(row),contentStored:false};
}
// Allowlisted envelopes prevent text, captions, attachments, quoted messages,
// internal notes and nested first/last-message previews from reaching storage.
export function sourceFacts(table:string,row:any,storeContent=false){
 if(storeContent)return row;
 const raw=row.raw??(row.raw_json?JSON.parse(row.raw_json):{});
 let safe:any;
 if(['messages','export_messages'].includes(table))safe={
  ...pick(raw,['source','messageType','messageState','isPrivate']),
  scheduledMessage:!!raw.scheduledMessage,bulkSendSession:!!raw.bulkSendSession,
  sentByOrganizationMember:pick(raw.sentByOrganizationMember,['id','name']),
  ctaKey:extractCtaKey({content:providerText(raw),...(raw.ctaKey!==undefined?{ctaKey:raw.ctaKey}:{})}),
 };
 else if(['chats','service_chats','export_chat_candidates'].includes(table))safe=chatFacts(raw);
 else if(table==='service_events')safe={...pick(raw,['previousMemberId','newMemberId']),author:pick(raw.author,['agentId'])};
 else if(table==='service_ratings')safe=pick(raw,['id','rating','score','eventAtUTC','createdAtUTC','organizationMemberId','chatId']);
 else if(table==='channels')safe=pick(raw,['id','_t','name','phoneNumber']);
 else {
  // Checkpoint and roster tables contain no message payloads.
  const {raw:ignored,raw_json:ignoredJson,...rest}=row;return rest;
 }
 const clean={...pick(row,['_id','organization_id','id','chat_id','channel_id','run_id','event_at_utc','at','kind','observed_at','service_candidate','created_at_utc','updated_at_utc']),raw:safe,contentStored:false};
 return {...clean,hash:createHash('sha256').update(JSON.stringify(clean)).digest('hex')};
}
