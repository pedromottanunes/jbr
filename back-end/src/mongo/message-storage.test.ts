import {describe,it,expect} from 'vitest';
import {sourceFacts,messageFacts} from './message-storage';
import {normalizeSource} from './datasets';
import {buildViews,analytics} from './model';
import {ctaTexts,extractCtaKey,ctaRecordFor,ctaCatalogVersion,needsCtaRefresh} from '../cta';
import {summarize} from '../funnel';
import {attendance,ctaByTime} from '../attendance';
import {performance} from '../agent-performance';
import {defaultAttendanceConfig} from '../../../shared/business-hours';

const secret='CONTEUDO PRIVADO A SER DESCARTADO';
const start='2026-11-21T11:00:00.000Z',reply='2026-11-21T11:05:00.000Z',until='2026-11-21T17:00:00.000Z';
function fixture(){return {
 chats:[{organization_id:'org',id:'chat',raw:{contact:{id:'lead',contactType:'DirectMessage',name:'Contato'},firstContactMessage:{id:'m1',eventAtUTC:start,content:ctaTexts()[0]},lastMessage:{eventAtUTC:reply,content:secret},organizationMemberHistory:[{memberId:'human',enteredAt:start,firstMemberReplyMessage:{id:'m2',content:secret}}],open:true}}],
 messages:[{organization_id:'org',chat_id:'chat',id:'m1',event_at_utc:start,raw:{source:'Contact',messageType:'Text',content:ctaTexts()[0]}},{organization_id:'org',chat_id:'chat',id:'m2',event_at_utc:reply,raw:{source:'Member',messageType:'Text',content:secret,sentByOrganizationMember:{id:'human'},quotedMessage:{content:secret},attachments:[{url:secret}]}},{organization_id:'org',chat_id:'chat',id:'note',event_at_utc:until,raw:{source:'Member',content:secret,isPrivate:true}}],
 crm_members:[{organization_id:'org',id:'human',name:'Consultor',kind:'OrganizationHumanAgentReferenceModel',active:1}],
 service_coverage:[{organization_id:'org',chat_id:'chat',start_utc:start,end_utc:until}],
 crm_meta:[{key:'publishedAt',value:JSON.stringify(until)}],service_events:[],service_ratings:[],
};}
const metrics=(views:ReturnType<typeof buildViews>)=>{
 const a=analytics(views.contacts,views.conversations,views.messages),period={start:'2026-11-21',end:'2026-11-21'};
 return {funnel:summarize(a.funnel,{},period,until),attendance:attendance(a.attendance.conversations,period.start,period.end),cta:ctaByTime(a.attendance.leads,period.start,period.end),agents:performance(views.service_conversations,views.members,period.start,period.end,defaultAttendanceConfig)};
};
describe('message retention',()=>{
 it('reclassifies unknown first messages after catalog changes without rereading positive matches',()=>{
  expect(needsCtaRefresh({ctaKey:null})).toBe(true);
  expect(needsCtaRefresh({ctaKey:null,ctaCatalogVersion:'old'})).toBe(true);
  expect(needsCtaRefresh({ctaKey:null,ctaCatalogVersion})).toBe(false);
  expect(needsCtaRefresh({ctaKey:extractCtaKey({content:ctaTexts()[0]}),ctaCatalogVersion:'old'})).toBe(false);
  const clean=sourceFacts('messages',{raw:{content:secret}});
  expect(clean.raw.ctaCatalogVersion).toBe(ctaCatalogVersion);expect(needsCtaRefresh(clean.raw)).toBe(false);
  const legacy=sourceFacts('messages',{raw:{ctaKey:null}});
  expect(needsCtaRefresh(legacy.raw)).toBe(true);
 });
 it('keeps every catalog CTA identifiable without retaining the incoming text',()=>{
  for(const content of ctaTexts()){
   const key=extractCtaKey({content:content.toUpperCase()});expect(key).toMatch(/^[a-f0-9]{64}$/);expect(ctaRecordFor({ctaKey:key})?.text).toBe(content);
  }
  expect(extractCtaKey({content:secret})).toBeNull();expect(ctaRecordFor({content:ctaTexts()[0],ctaKey:null})).toBeUndefined();
 });
 it('preserves funnel, CTA, response times and agent performance after stripping content',()=>{
  const original=fixture(),before=buildViews(normalizeSource(original),true);
  const clean=Object.fromEntries(Object.entries(original).map(([name,rows])=>[name,rows.map(r=>sourceFacts(name,r))]));
  const after=buildViews(normalizeSource(clean));
  expect(JSON.stringify(clean)).not.toContain(secret);expect(JSON.stringify(clean)).not.toContain(ctaTexts()[0]);
  expect(metrics(after)).toEqual(metrics(before));
  expect(metrics(after).cta.total).toBe(1);expect(metrics(after).attendance.medianMinutes).toBe(5);
  expect(metrics(after).agents.items[0].messages).toBe(1);
  expect(after.messages.every(m=>!Object.hasOwn(m,'content'))).toBe(true);
 });
 it('is opt-in, does not recreate deleted texts and is idempotent',()=>{
  const rows=fixture();expect(JSON.stringify(buildViews(normalizeSource(rows)))).not.toContain(secret);
  expect(JSON.stringify(buildViews(normalizeSource(rows),true))).toContain(secret);
  const clean=Object.fromEntries(Object.entries(rows).map(([name,items])=>[name,items.map(r=>sourceFacts(name,r))]));
  expect(JSON.stringify(buildViews(normalizeSource(clean),true))).not.toContain(secret);
  const event=messageFacts({id:'m',content:ctaTexts()[0],quotedMessage:secret});expect(messageFacts(event)).toEqual(event);
  const raw=sourceFacts('messages',rows.messages[0]);expect(sourceFacts('messages',raw)).toEqual(raw);
 });
 it('removes nested captions, internal notes, rating comments and channel previews',()=>{
  for(const name of ['messages','export_messages','chats','service_chats','export_chat_candidates','service_events','service_ratings','channels']){
   const clean=sourceFacts(name,{id:'fixture',raw:{content:secret,headerContent:secret,footer:secret,comment:secret,rating:{comment:secret},attachments:[{content:secret}],firstContactMessage:{content:secret},lastMessage:{content:secret},organizationMemberHistory:[{firstMemberReplyMessage:{content:secret}}],timeline:[{note:secret}]}});
   expect(JSON.stringify(clean)).not.toContain(secret);
  }
 });
});
