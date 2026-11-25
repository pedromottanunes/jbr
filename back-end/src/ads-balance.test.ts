import {describe,it,expect} from 'vitest';
import {parseBudgetPayload,selectBudget,budgetForecast,budgetAlert,defaultBudgetLimits} from './account-budget';
const now='2026-11-24T15:00:00Z';
export const customer={id:'1234567890',currencyCode:'BRL',timeZone:'America/Sao_Paulo'};
export const budget={id:'987',status:'APPROVED',approvedStartDateTime:'2026-01-01 00:00:00',approvedEndTimeType:'FOREVER',adjustedSpendingLimitMicros:'5000000000',amountServedMicros:'3700000000'};
const payload=(rows:Record<string,unknown>[]= [budget],account=customer)=>parseBudgetPayload([{results:[{customer:account}]}],[{results:rows.map(accountBudget=>({customer:account,accountBudget}))}],customer.id);
describe('orçamento de conta Google Ads',()=>{
 it('calcula limite ajustado menos veiculado com BigInt e limita o restante a zero',()=>{
  expect(selectBudget(payload(),now).remaining).toBe('1300.000000');
  expect(selectBudget(payload([{...budget,amountServedMicros:'6000000000'}]),now).remaining).toBe('0.000000');
  expect(selectBudget(payload([{...budget,adjustedSpendingLimitMicros:'9007199254740993123',amountServedMicros:'9007199254740993000'}]),now).remaining).toBe('0.000123');
 });
 it('distingue infinito, ausente e nenhum orçamento; zero explícito continua válido',()=>{
  expect(selectBudget(payload([{...budget,adjustedSpendingLimitMicros:undefined,adjustedSpendingLimitType:'INFINITE'}]),now).status).toBe('unlimited');
  for(const field of ['adjustedSpendingLimitMicros','amountServedMicros'])expect(selectBudget(payload([{...budget,[field]:undefined}]),now).status).toBe('unavailable');
  expect(selectBudget(payload([{...budget,amountServedMicros:'0'}]),now).remaining).toBe('5000.000000');
  expect(selectBudget(payload([]),now).status).toBe('unavailable');
 });
 it('usa hora da conta e início alternativo, exclui orçamento passado/futuro e rejeita ambiguidade',()=>{
  const ending={...budget,approvedEndTimeType:undefined,approvedEndDateTime:'2026-11-24 12:00:00'};
  expect(selectBudget(payload([ending]),now).status).toBe('unavailable');
  expect(selectBudget(payload([{...budget,approvedStartDateTime:'2026-11-24 12:00:01'}]),now).status).toBe('unavailable');
  expect(selectBudget(payload([{...budget,approvedStartDateTime:undefined,proposedStartDateTime:'2026-11-24 12:00:00'}]),now).status).toBe('available');
  expect(selectBudget(payload([budget,{...budget,id:'988'}]),now).status).toBe('unavailable');
  expect(selectBudget(payload([{...budget,approvedEndTimeType:undefined}]),now).status).toBe('unavailable');
  expect(selectBudget(payload([{...budget,approvedStartDateTime:'2026-02-30 00:00:00'}]),now).status).toBe('unavailable');
  const tokyo={...customer,timeZone:'Asia/Tokyo',currencyCode:'JPY'};
  expect(selectBudget(payload([{...budget,approvedStartDateTime:'2026-11-25 00:00:00'}],tokyo),now).status).toBe('available');
 });
 it('recusa conta diferente, moeda/fuso inválidos, blocos inválidos e inteiros imprecisos',()=>{
  expect(()=>payload([budget],{...customer,id:'9999999999'})).toThrow('account_mismatch');
  expect(()=>payload([budget],{...customer,timeZone:'invalid/zone'})).toThrow();
  expect(()=>payload([budget],{...customer,currencyCode:''})).toThrow();
  expect(()=>parseBudgetPayload([{results:[{customer}]}],{},customer.id)).toThrow();
  expect(()=>payload([{...budget,adjustedSpendingLimitMicros:9007199254740992}])).toThrow();
  expect(()=>payload([budget,budget])).toThrow();
 });
 it('prevê duração somente com sete dias completos, conta/moeda iguais e custos recentes',()=>{
  const ads={connected:true,account:{id:customer.id},currency:'BRL',timezone:customer.timeZone,syncedAt:now,period:{start:'2026-11-17',end:'2026-11-23'},daily:Array.from({length:7},(_,i)=>({date:'2026-11-'+(17+i),campaignId:'1',spend:100}))};
  expect(budgetForecast(ads,payload(),'1300000000',now).days).toBe(13);
  expect(selectBudget(payload(),now).remaining).toBe('1300.000000');
  for(const changes of [{account:{id:'9999999999'}},{currency:'USD'},{period:{start:'2026-11-18',end:'2026-11-23'}},{syncedAt:'2026-11-24T13:59:00Z'},{daily:[]}])expect(budgetForecast({...ads,...changes},payload(),'1300000000',now).days).toBeNull();
  expect(budgetForecast({...ads,daily:[...ads.daily,ads.daily[0]]},payload(),'1300000000',now).days).toBeNull();
 });
 it('alerta por orçamento ou duração, sem emitir alerta em leitura indisponível/desatualizada',()=>{
  expect(budgetAlert('0',null,defaultBudgetLimits,true)).toBe('exhausted');
  expect(budgetAlert('100000000',null,defaultBudgetLimits,true)).toBe('urgent');
  expect(budgetAlert('500000000',null,defaultBudgetLimits,true)).toBe('attention');
  expect(budgetAlert('10000000000',2,defaultBudgetLimits,true)).toBe('urgent');
  expect(budgetAlert('10000000000',5,defaultBudgetLimits,true)).toBe('attention');
  expect(budgetAlert('0',null,defaultBudgetLimits,false)).toBeNull();
 });
});
