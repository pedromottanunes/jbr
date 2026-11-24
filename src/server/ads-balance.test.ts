import {describe,it,expect} from 'vitest';
import {balanceEstimate,type BalanceEntry} from './ads-balance';
const now='2026-11-24T15:00:00Z';
const ads={connected:true,account:{id:'1'},currency:'BRL',timezone:'America/Sao_Paulo',syncedAt:now,period:{start:'2026-11-01',end:'2026-11-24'},daily:[...Array.from({length:7},(_,i)=>({date:`2026-11-${17+i}`,campaignId:'a',spend:100})),{date:'2026-11-24',campaignId:'a',spend:30}]};
const base:BalanceEntry={id:'base',kind:'baseline',amountCents:50000,at:'2026-11-24T12:00:00Z',accountId:'1',currency:'BRL',snapshotCostMicros:20000000,note:''};
describe('saldo estimado',()=>{
 it('desconta apenas a diferença desde a confirmação e inclui recargas posteriores',()=>{
  const e=balanceEstimate(ads,[base,{...base,id:'credit',kind:'credit',amountCents:10000,at:'2026-11-24T13:00:00Z'}],undefined,now);
  expect(e.balance).toBe(590);expect(e.averageDaily).toBe(100);expect(e.daysLeft).toBe(5.9);expect(e.status).toBe('ok');
 });
 it('não fornece saldo sem referência, de outra conta ou com cobertura ausente',()=>{
  expect(balanceEstimate(ads,[],undefined,now).status).toBe('unconfigured');
  expect(balanceEstimate(ads,[{...base,accountId:'2'}],undefined,now).balance).toBeNull();
  expect(balanceEstimate({...ads,period:{start:'2026-11-01',end:'2026-11-23'}},[base],undefined,now).status).toBe('unavailable');
 });
 it('sinaliza gastos antigos e limites sem confundir ausência com saldo suficiente',()=>{
  expect(balanceEstimate({...ads,syncedAt:'2026-11-24T10:00:00Z'},[base],undefined,now).status).toBe('stale');
  expect(balanceEstimate(ads,[{...base,amountCents:5000}],undefined,now).status).toBe('critical');
  expect(balanceEstimate(ads,[{...base,amountCents:25000}],undefined,now).status).toBe('warning');
 });
 it('nova confirmação substitui o cálculo anterior e rejeita custo duplicado',()=>{
  expect(balanceEstimate(ads,[base,{...base,id:'new',amountCents:100000,at:'2026-11-24T14:00:00Z',snapshotCostMicros:30000000}],undefined,now).balance).toBe(1000);
  expect(()=>balanceEstimate({...ads,daily:[...ads.daily,ads.daily[0]]},[base],undefined,now)).toThrow();
 });
});
