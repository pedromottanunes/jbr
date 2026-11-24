import {describe,expect,it} from 'vitest';
import {attendance,ctaByTime,type Conversation} from './attendance';
import {groupLeads} from './funnel';
const c=(id:string,entry:string|null,events:Conversation['events'],limited=true):Conversation=>({id,entry,events,limited});
const incoming=(at:string)=>({at,incoming:1,source:'Contact'});
const outgoing=(at:string,source:string)=>({at,incoming:0,source});
describe('indicadores de atendimento',()=>{
 it('conta respostas humanas no período, não confunde bots e sinaliza cobertura incompleta',()=>{
  const start='2026-11-20T13:00:00Z';
  const data=attendance([
   c('a',start,[incoming(start),outgoing('2026-11-20T13:01:00Z','Bot'),outgoing('2026-11-20T13:05:00Z','Member')]),
   c('b',start,[incoming(start),outgoing('2026-11-20T13:30:00Z','Member')]),
   c('c',start,[incoming(start),outgoing('2026-11-20T13:02:00Z','Bot')]),
   c('d',start,[]),c('e',start,[incoming('2026-11-20T14:00:00Z')]),c('f',null,[]),
   c('g',start,[incoming(start),outgoing('2026-11-21T13:00:00Z','Member')]),
  ],'2026-11-20','2026-11-20');
  expect(data.total).toBe(6);expect(data.observed).toBe(4);expect(data.answered).toBe(2);expect(data.withoutObservedReply).toBe(2);expect(data.unknown).toBe(2);expect(data.noMessages).toBe(1);expect(data.excluded).toBe(1);expect(data.medianMinutes).toBe(17.5);expect(data.bands.map(x=>x.count)).toEqual([1,1,0,0]);
 });
 it('respeita a data no fuso de São Paulo e valida o período',()=>{
  const record=c('a','2026-11-21T01:00:00Z',[incoming('2026-11-21T01:00:00Z')]);
  expect(attendance([record],'2026-11-20','2026-11-20').total).toBe(1);
  expect(()=>attendance([],'2026-02-30','2026-03-01')).toThrow();
 });
 it('separa entradas nos limites do expediente e reconhece o fim de semana como subconjunto',()=>{
  const make=(id:string,entry:string,respond=false)=>c(id,entry,[incoming(entry),...(respond?[outgoing(new Date(Date.parse(entry)+600000).toISOString(),'Member')]:[])]);
  const result=attendance([
   make('antes','2026-11-20T10:59:00Z',true),
   make('inicio','2026-11-20T11:00:00Z'),
   make('fim','2026-11-20T20:59:00Z'),
   make('depois','2026-11-20T21:00:00Z'),
   make('sabado','2026-11-21T13:00:00Z',true),
   make('domingo','2026-11-22T20:00:00Z'),
  ],'2026-11-20','2026-11-22');
  expect(result.total).toBe(6);expect(result.outsideHours).toEqual({total:4,observed:4,answered:2,medianMinutes:10});
  expect(result.weekend).toEqual({total:2,observed:2,answered:1,medianMinutes:10});
 });
 it('conta CTA apenas na primeira mensagem conhecida e agrupa telefones como o funil',()=>{
  const cta='Olá, queria mais informações sobre os serviços ANTT, por favor.';
  const rows=[['a','2026-11-20T11:00:00Z','5541999990000'],['b','2026-11-20T12:00:00Z','5541999990000'],['c','2026-11-20T21:00:00Z','5541999990001'],['d','2026-11-21T13:00:00Z','5541999990002'],['e','2026-11-20T11:00:00Z','5541999990003'],['f','2026-11-20T11:00:00Z','5541999990004']] as const;
  const contacts=rows.map(([id,at,phone])=>({id:'o:'+id,label:id,phone,first_inbound_at:at,source:'Não identificada'}));
  const other='Olá! Gostaria de orientação sobre o RNTRC. Como posso começar?';
  const messages:Parameters<typeof groupLeads>[1]=rows.filter(([id])=>id!=='f').map(([id,at])=>({contactId:'o:'+id,chatId:'o:'+id,id,at,incoming:1,content:id==='e'?'Olá':id==='c'?'OLA! Queria mais informacoes sobre os servicos ANTT por favor':id==='d'?other:cta,source:'Contact'}));
  messages.push({contactId:'o:e',chatId:'o:e',id:'later',at:'2026-11-20T12:00:00Z',incoming:1,content:cta,source:'Contact'});
  const result=ctaByTime(groupLeads(contacts,messages),'2026-11-20','2026-11-22');
  expect(result).toMatchObject({inside:1,outside:2,weekend:1,unknownFirstMessage:1,total:3});
  expect(result.messages.find(m=>m.text===cta)?.count).toBe(2);
  expect(result.messages.find(m=>m.text===other)?.count).toBe(1);
  expect(ctaByTime(groupLeads(contacts,messages),'2026-11-21','2026-11-22').messages.find(m=>m.text===other)?.count).toBe(1);
  expect(result.messages.reduce((sum,m)=>sum+m.count,0)).toBe(result.total);
  expect(result.messages.some(m=>m.count===0)).toBe(true);
 });
});
