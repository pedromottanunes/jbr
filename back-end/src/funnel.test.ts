import { expect,it,vi } from 'vitest';
import { groupLeads,summarize } from './funnel';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from './app';

const cta='Olá, queria mais informações sobre os serviços ANTT, por favor.';
const contact=(id:string,at:string|null,phone:string|null=null)=>({id,label:'Lead '+id,phone,first_inbound_at:at,source:'Não identificada'});
const message=(id:string,at:string,incoming=1,content=cta,source=incoming?'Contact':'Member',chatId=id)=>({contactId:id,chatId,id:at+source,at,incoming,content,source});
const ads={connected:true,period:{start:'2026-11-01',end:'2026-11-20'},timezone:'America/Sao_Paulo',daily:[{date:'2026-11-20',spend:40,clicks:10,impressions:100}],actions:[{resourceName:'action/1',name:'Contato',status:'ENABLED'}],conversionDaily:[{date:'2026-11-20',action:'action/1',value:2.5}]};
const filters={start:'2026-11-20',end:'2026-11-20'};

it('includes returning leads with a first-message CTA, without counting automated replies or duplicate chats twice',()=>{
 const first={...message('a','2026-11-20T10:00:00Z',1,cta,'Contact','chat1'),firstInChat:true};
 const second={...message('a','2026-11-20T12:00:00Z',1,cta,'Contact','chat2'),firstInChat:true};
 const automated={...message('a','2026-11-20T10:01:00Z',0,'','Member','chat1'),humanSource:null};
 const leads=groupLeads([{...contact('a','2026-11-01T10:00:00Z'),tags:[{name:'VENDA OK',scopes:['contato'] as ('contato'|'conversa')[]}]}],[first,second,automated]);
 const report=summarize(leads,ads,filters,null);
 expect(report.metrics.siteChannelLeads).toBe(1);expect(report.metrics.siteAttended).toBe(0);expect(report.metrics.siteWonObserved).toBe(1);
 expect(report.metrics.leads).toBe(0);
});

it('preserves observed tags and their scope when duplicate contacts are grouped',()=>{
 const at='2026-11-20T10:00:00Z';
 const contacts=[{...contact('o:a',at,'5541999990000'),tags:[{name:'VENDA OK',scopes:['contato'] as ('contato'|'conversa')[]}]},{...contact('o:b',at,'5541999990000'),tags:[{name:'VENDA OK',scopes:['conversa'] as ('contato'|'conversa')[]},{name:'ANTT',scopes:['contato'] as ('contato'|'conversa')[]}]}];
 const result=summarize(groupLeads(contacts,[]),ads,filters,null);
 expect(result.items).toHaveLength(1);expect(result.items[0].tags).toEqual([{name:'ANTT',scopes:['contato']},{name:'VENDA OK',scopes:['contato','conversa']}]);
 expect(result.metrics.won).toBeNull();
});

it('counts unique Meta contacts across multiple ads, respects the period and gives CTA openings precedence',()=>{
 const at='2026-11-20T10:00:00Z';
 const contacts=['a','b','google','later','outside'].map(id=>({...contact('o:'+id,at,id==='a'?'5541999990000':null),tags:[{name:'VENDA OK',scopes:['contato'] as ('contato'|'conversa')[]}]}));
 contacts.push({...contact('o:duplicate',at,'5541999990000'),tags:[]});
 const first=(id:string,ad:string,chat=id,text='Bom dia',when=at)=>({...message('o:'+id,when,1,text,'Contact',chat),firstInChat:true,adAttributionVersion:1,adSourceId:ad});
 const messages=[first('a','100'),first('a','200','return'),first('duplicate','100'),first('b','200'),first('google','100','google',cta),{...first('later','100'),firstInChat:false},first('outside','100','outside','Olá','2026-11-21T03:00:00Z')];
 const report=summarize(groupLeads(contacts,messages),ads,filters,null);
 expect(report.metrics.metaAdEvidence).toBe(2);
 expect(report.metaAdCohorts).toEqual([{adIds:['100','200'],leads:1,wonObserved:1},{adIds:['200'],leads:1,wonObserved:1}]);
 expect(report.metrics.siteChannelLeads).toBe(1);expect(report.metrics.siteWonObserved).toBe(1);
 expect(JSON.stringify(report.metaAdCohorts)).not.toContain('5541999990000');
});

it('uses the same human-response rule in the channel and general funnels',()=>{
 const at='2026-11-20T10:00:00Z';
 const report=summarize(groupLeads([contact('a',at)],[message('a',at),{...message('a','2026-11-20T11:00:00Z',0),humanSource:null}]),ads,filters,null);
 expect(report.metrics.siteChannelLeads).toBe(1);expect(report.metrics.siteAttended).toBe(0);expect(report.metrics.attended).toBe(0);
});

it('deduplicates phone variants, preserves earliest entry, and does not merge organizations',()=>{
 const groups=groupLeads([contact('o:a','2026-11-20T10:00:00Z','+55 (41) 99999-0000'),contact('o:b','2026-11-19T10:00:00Z','5541999990000'),contact('p:c','2026-11-20T10:00:00Z','5541999990000')],[]);
 expect(groups).toHaveLength(2);expect(groups[0].enteredAt).toBe('2026-11-19T10:00:00.000Z');
});

it('uses local-date cohort boundaries, excludes returning contacts and keeps unknown stages null',()=>{
 const leads=groupLeads([contact('a','2026-11-20T02:59:59Z'),contact('b','2026-11-20T03:00:00Z'),contact('c','2026-11-21T02:59:59Z'),contact('d','2026-11-21T03:00:00Z'),contact('unknown',null)], [message('a','2026-11-20T15:00:00Z')]);
 const result=summarize(leads,ads,filters,null);
 expect(result.items.map(l=>l.id)).toEqual(['c','b']);expect(result.metrics.returning).toBe(1);expect(result.metrics.unknownEntry).toBe(1);
 expect(result.metrics.won).toBeNull();expect(result.metrics.qualified).toBeNull();expect(result.metrics.proposals).toBeNull();
});

it('recognizes only the original CTA and excludes bots, external messages, prior responses and future replies',()=>{
 const at='2026-11-20T10:00:00Z';
 const leads=groupLeads(['site','later','partial','bot','external','before','future','human'].map(id=>contact(id,at)),[
  message('site',at,1,'OLA! Queria mais informações sobre os serviços ANTT, por favor!'),
  message('later',at,1,'Bom dia'),message('later','2026-11-20T11:00:00Z'),
  message('partial','2026-11-20T11:00:00Z'),
  ...['bot','external','before','future','human'].map(id=>message(id,at)),
  message('bot','2026-11-20T11:00:00Z',0,'Olá','Bot'),message('external','2026-11-20T11:00:00Z',0,'Olá','External'),
  message('before','2026-11-20T09:00:00Z',0,'Olá'),message('future','2026-11-21T03:00:00Z',0,'Olá'),
  message('human','2026-11-20T11:00:00Z',0,'Como posso ajudar?')]);
 const result=summarize(leads,ads,filters,null);
 expect(result.items.find(l=>l.id==='site')?.origin).toBe('site');
 expect(result.items.find(l=>l.id==='later')?.origin).toBe('unknown');
 expect(result.items.find(l=>l.id==='partial')?.origin).toBe('unknown');
 expect(result.metrics.attended).toBe(1);expect(result.items.find(l=>l.attended)?.id).toBe('human');
});

it('preserves fractional conversions, requires explicit action, and never presents out-of-cache ads as zero',()=>{
 expect(summarize([],ads,filters,null).ads.conversions).toBeNull();
 expect(summarize([],ads,{...filters,action:'action/1'},null).ads.conversions).toBe(2.5);
 const configured={...ads,actions:ads.actions.map(a=>({...a,type:'WEBPAGE',category:'OUTBOUND_CLICK'}))};
 expect(summarize([],configured,filters,null).ads.action).toBe('action/1');
 expect(summarize([],configured,{...filters,action:''},null).ads.conversions).toBeNull();
 const unavailable=summarize([],ads,{start:'2026-10-31',end:'2026-11-20'},null).ads;
 expect(unavailable.clicks).toBeNull();expect(unavailable.spend).toBeNull();
 expect(()=>summarize([],ads,{start:'2026-02-30',end:'2026-03-01'},null)).toThrow();
 expect(()=>summarize([],ads,{...filters,action:'invalid'},null)).toThrow();
});

it('filters and pages the cohort without changing its totals or double-counting origins',()=>{
 const at='2026-11-20T10:00:00Z';
 const contacts=[contact('a',at,'5541999990000'),{...contact('b',at),source:'Google indicado'},contact('c',at)];
 const leads=groupLeads(contacts,[message('a',at),message('a','2026-11-20T11:00:00Z',0,'Resposta')]);
 const result=summarize(leads,ads,{...filters,stage:'attended',origin:'site',q:'(41) 99999',limit:1},null);
 expect(result.total).toBe(1);expect(result.items[0].id).toBe('a');expect(result.metrics.leads).toBe(3);expect(result.origins.reduce((n,o)=>n+o.count,0)).toBe(3);
 expect(summarize(leads,ads,{...filters,limit:1,cursor:1},null).items[0].id).toBe('b');
 expect(summarize(leads,ads,{...filters,q:'Cliente 99999'},null).total).toBe(0);
});

it('serves a coherent analytical snapshot, invalidates after publication and omits message contents',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jbr-funnel-'));const path=join(dir,'cache.db');const db=new DatabaseSync(path);
 db.exec(`PRAGMA journal_mode=WAL;
 CREATE TABLE crm_meta(key TEXT PRIMARY KEY,value TEXT);
 CREATE TABLE crm_contacts(id TEXT,label TEXT,phone TEXT,first_inbound_at TEXT,source TEXT);
 CREATE TABLE crm_chats(id TEXT,contact_id TEXT,label TEXT,at TEXT,is_open INTEGER,message_count INTEGER,limited INTEGER);
 CREATE TABLE crm_messages(chat_id TEXT,id TEXT,at TEXT,author TEXT,incoming INTEGER,content TEXT,kind TEXT,private INTEGER);
 CREATE TABLE messages(organization_id TEXT,chat_id TEXT,id TEXT,event_at_utc TEXT,raw_json TEXT,PRIMARY KEY(organization_id,chat_id,id));
 INSERT INTO crm_meta VALUES('publishedAt','"2026-11-20T20:00:00Z"');
 INSERT INTO crm_contacts VALUES('o:p','Teste','5541999990000','2026-11-20T10:00:00Z','Não identificada');
 INSERT INTO crm_chats VALUES('o:c','o:p','Teste','2026-11-20T11:00:00Z',1,3,1);
 INSERT INTO crm_messages VALUES('o:c','first','2026-11-20T10:00:00Z','Contato',1,'Oi','Text',0);
 INSERT INTO crm_messages VALUES('o:c','private','2026-11-20T10:30:00Z','Equipe',0,'Nota','Text',1);
 INSERT INTO messages VALUES('o','c','private','2026-11-20T10:30:00Z','{"source":"Member"}');`);
 writeFileSync(join(dir,'google-ads.json'),JSON.stringify(ads));
 const fetcher=vi.spyOn(globalThis,'fetch');const app=buildApp({mode:'local',databasePath:path});
 try{
  const url='/api/v1/funnel?start=2026-11-20&end=2026-11-20';
  expect((await app.inject(url)).json().metrics.attended).toBe(0);
  expect((await app.inject(url)).json().items).toHaveLength(1);
  db.exec(`BEGIN;INSERT INTO crm_messages VALUES('o:c','reply','2026-11-20T11:00:00Z','Equipe',0,'Resposta','Text',0);INSERT INTO messages VALUES('o','c','reply','2026-11-20T11:00:00Z','{"source":"Member"}');UPDATE crm_meta SET value='"2026-11-20T21:00:00Z"' WHERE key='publishedAt';COMMIT;`);
  expect((await app.inject(url)).json().metrics.attended).toBe(1);
  const focused=(await app.inject('/api/v1/conversations/o:c?message=first')).json();expect(focused.focusMessage).toBeNull();expect(focused.messages).toEqual([]);expect(focused.chat.contact_id).toBe('o:p');
  const evidence=(await app.inject(url)).json().items[0].evidence;
  expect(evidence.map((e:{text:string})=>e.text)).toEqual(['Primeira entrada conhecida','Mensagem recebida','Resposta humana registrada']);
  expect((await app.inject('/api/v1/conversations/o:c?message=private')).json().focusMessage).toBeNull();
  expect((await app.inject('/api/v1/conversations/o:c?message=missing')).json().focusMessage).toBeNull();
  expect((await app.inject('/api/v1/funnel?start=2026-02-30')).statusCode).toBe(400);
  expect((await app.inject('/api/v1/funnel?stage=won')).statusCode).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
 }finally{fetcher.mockRestore();await app.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
