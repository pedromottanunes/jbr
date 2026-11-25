import {describe,it,expect} from 'vitest';
import {performance,type Agent,type ServiceChat,type ServiceMessage} from './agent-performance';
const config={saturdayFrom:'2026-11-01',slaMinutes:15};
const agents:Agent[]=[{id:'a',name:'Consultor A',human:true,active:true},{id:'b',name:'Consultor B',human:true,active:true},{id:'ai',name:'Automação',human:false,active:true}];
const at=(time:string)=>`2026-11-21T${time}:00-03:00`;
const m=(id:string,time:string,source='Contact',memberId:string|null=null):ServiceMessage=>({id,at:at(time),source,memberId,private:false,valid:true});
const chat=(patch:Partial<ServiceChat>={}):ServiceChat=>({id:'chat',label:'Teste',contactId:'lead',entry:at('08:00'),observedAt:at('13:00'),open:true,coverage:[{start:at('08:00'),end:at('13:00')}],segments:[{memberId:'a',start:at('08:30'),end:at('09:00'),ongoing:false,queueMinutes:30},{memberId:'b',start:at('09:00'),end:at('13:00'),ongoing:true}],events:[],messages:[],...patch});
describe('desempenho individual',()=>{
 it('não atribui a um atendente uma entrada ocorrida depois de sua transferência',()=>{
  const result=performance([chat({messages:[m('later','09:10')]})],agents,'2026-11-21','2026-11-21',config);
  const a=result.items.find(r=>r.id==='a')!;
  expect(a.noReply).toBe(0);expect(a.first.count).toBe(0);
  expect(result.items.find(r=>r.id==='b')?.noReply).toBe(1);
 });
 it('separa fila, atribuições, bots, transferências e sequências consecutivas',()=>{
  const c=chat({messages:[m('1','08:00'),m('2','08:01','Bot'),m('3','08:35','Member','a'),m('4','08:55'),m('5','08:56'),m('6','09:05','Member','b'),m('7','09:20'),m('8','09:22'),m('9','09:30','Member','b')],events:[{id:'e',at:at('09:00'),kind:'MemberTransferMetadataModel',previous:'a',next:'b'}]});
  const result=performance([c],agents,'2026-11-21','2026-11-21',config),[b,a]=result.items.sort((x,y)=>y.name.localeCompare(x.name));
  expect(result.items).toHaveLength(2);expect(a.first.wall.median).toBe(5);expect(a.queue.median).toBe(30);expect(a.transfersOut).toBe(1);expect(b.transfersIn).toBe(1);expect(b.first.business.median).toBe(5);expect(b.following.count).toBe(1);expect(b.following.wall.median).toBe(10);expect(b.firstSlaRate).toBe(1);
 });
 it('não inventa primeira resposta ou ausência sem cobertura e usa referência explícita',()=>{
  const c=chat({coverage:[],messages:[m('late','08:50','Member','a'),m('in','08:00')]});
  let a=performance([c],agents,'2026-11-21','2026-11-21',config).items.find(r=>r.id==='a')!;
  expect(a.first.count).toBe(0);expect(a.firstUnknown).toBe(1);expect(a.noReply).toBe(0);
  c.segments[0].firstReplyId='late';a=performance([c],agents,'2026-11-21','2026-11-21',config).items.find(r=>r.id==='a')!;expect(a.first.wall.median).toBe(20);
 });
 it('exclui notas, falhas e IA, deduplica mensagens e preserva pendência após bot',()=>{
  const c=chat({segments:[{memberId:'a',start:at('08:00'),end:at('13:00'),ongoing:true}],messages:[m('in','08:00'),{...m('private','08:02','Member','a'),private:true},{...m('failed','08:03','Member','a'),valid:false},m('ai','08:04','Member','ai'),m('bot','08:05','Bot')]});
  const result=performance([c],agents,'2026-11-21','2026-11-21',config),a=result.items.find(r=>r.id==='a')!;
  expect(a.messages).toBe(0);expect(a.first.count).toBe(0);expect(a.noReply).toBe(1);expect(a.pending).toHaveLength(1);
  c.messages.push(m('reply','08:10','Member','a'),m('reply','08:10','Member','a'));expect(performance([c],agents,'2026-11-21','2026-11-21',config).items.find(r=>r.id==='a')?.messages).toBe(1);
 });
 it('não usa respostas futuras nem mistura autoria de fechamento com responsável atual',()=>{
  const c=chat({messages:[m('in','08:00'),{...m('future','08:10','Member','a'),at:'2026-11-22T08:10:00-03:00'}],events:[{id:'close',at:at('12:00'),kind:'ChatClosedMetadataModel',memberId:'a'}]});
  const rows=performance([c],agents,'2026-11-21','2026-11-21',config).items;expect(rows.find(r=>r.id==='a')?.first.count).toBe(0);expect(rows.find(r=>r.id==='a')?.closed).toBe(1);expect(rows.find(r=>r.id==='b')?.closed).toBe(0);
 });
});
