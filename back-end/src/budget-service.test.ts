import {it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Fastify from 'fastify';
import {LocalSettings} from './local-settings';
import {BudgetStore,budgetLeaseMs} from './budget-store';
import {BudgetCoordinator,budgetReport,registerAdsBalance} from './budget-service';
import {ProviderReadError} from './integrations/read-transport';
const scope={environment:'test',clientId:'jbr',customerId:'1234567890'};
const customer={id:scope.customerId,currencyCode:'BRL',timeZone:'America/Sao_Paulo'};
const budget={id:'1',status:'APPROVED',approvedStartDateTime:'2026-01-01 00:00:00',approvedEndTimeType:'FOREVER',adjustedSpendingLimitMicros:'5000000000',amountServedMicros:'3700000000'};
const response=()=>[{results:[{customer,accountBudget:budget}]}];
const fakeReader=()=>({account:vi.fn().mockResolvedValue([{results:[{customer}]}]),accountBudgets:vi.fn().mockResolvedValue(response())});
it('coordena duas conexões de banco, limita frequência e preserva a leitura após erro',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jbr-budget-')),s1=new LocalSettings(join(dir,'settings.db')),s2=new LocalSettings(join(dir,'settings.db'));
 let now=Date.parse('2026-11-24T15:00:00Z');const reader=fakeReader(),a=new BudgetCoordinator(new BudgetStore(s1.db),scope,reader,()=>now),b=new BudgetCoordinator(new BudgetStore(s2.db),scope,reader,()=>now);
 let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});reader.accountBudgets.mockImplementationOnce(async()=>{await held;return response();});
 try{
  expect((await a.request(true)).status).toBe('pending');expect((await b.request(true)).status).toBe('pending');
  expect((await budgetReport(b.store,scope,{},new Date(now).toISOString())).status).toBe('pending');
  release();await a.idle();expect(reader.accountBudgets).toHaveBeenCalledOnce();
  expect((await budgetReport(b.store,scope,{},new Date(now).toISOString())).remaining).toBe('1300.000000');
  expect((await b.request(true)).status).toBe('cooldown');now+=30000;expect((await b.request(false)).status).toBe('cooldown');
  reader.accountBudgets.mockRejectedValueOnce(new ProviderReadError(403,'secret provider body'));
  await b.request(true);await b.idle();const failed=await budgetReport(a.store,scope,{},new Date(now).toISOString());
  expect(failed.status).toBe('error');expect(failed.remaining).toBeNull();expect(failed.previousReading?.remaining).toBe('1300.000000');expect(failed.alert).toBeNull();expect(JSON.stringify(failed)).not.toContain('secret provider');
  expect(failed.lastSuccessAt).toBe('2026-11-24T15:00:00.000Z');
  now+=30000;reader.accountBudgets.mockResolvedValueOnce({bad:true});await a.request(true);await a.idle();expect((await a.store.record(scope))?.payload?.budgets).toHaveLength(1);
  expect((await budgetReport(a.store,{...scope,clientId:'other'},{},new Date(now).toISOString())).remaining).toBeNull();
  expect((await budgetReport(a.store,{...scope,environment:'production'},{},new Date(now).toISOString())).lastSuccessAt).toBeNull();
 }finally{release();await a.idle();await b.idle();s1.close();s2.close();rmSync(dir,{recursive:true,force:true});}
});
it('retira alertas após uma hora e reavalia vigência sem consultar o provedor na tela',async()=>{
 const settings=new LocalSettings(':memory:'),store=new BudgetStore(settings.db);let now=Date.parse('2026-11-24T15:00:00Z');
 const r=fakeReader();r.accountBudgets.mockResolvedValue([{results:[{customer,accountBudget:{...budget,amountServedMicros:'5000000000',approvedEndTimeType:undefined,approvedEndDateTime:'2026-11-24 14:00:00'}}]}]);
 const c=new BudgetCoordinator(store,scope,r,()=>now);try{
  await c.request(false);await c.idle();expect((await budgetReport(store,scope,{},new Date(now).toISOString())).alert).toBe('exhausted');
  now+=3600001;const stale=await budgetReport(store,scope,{},new Date(now).toISOString());expect(stale.stale).toBe(true);expect(stale.alert).toBeNull();
  now+=3600000;expect((await budgetReport(store,scope,{},new Date(now).toISOString())).status).toBe('unavailable');expect(r.accountBudgets).toHaveBeenCalledOnce();
 }finally{settings.close();}
});
it('libera lease expirado, impede publicação de dono antigo e respeita Retry-After',()=>{
 const settings=new LocalSettings(':memory:'),store=new BudgetStore(settings.db);const now=Date.parse('2026-11-24T15:00:00Z');
 try{
  const first=store.claim(scope,true,now);expect(first.claimed).toBe(true);
  const next=store.claim(scope,true,now+budgetLeaseMs+1);expect(next.claimed).toBe(true);
  if(!first.claimed||!next.claimed)throw new Error('claim');
  expect(store.finish(scope,first.owner,{errorCode:'temporary'},now+budgetLeaseMs+2)).toBe(false);
  store.finish(scope,next.owner,{errorCode:'rate_limit',retryAfterMs:60000},now+budgetLeaseMs+3);
  expect(store.claim(scope,true,now+budgetLeaseMs+30004).claimed).toBe(false);
  expect(store.claim(scope,true,now+budgetLeaseMs+60004).claimed).toBe(true);
 }finally{settings.close();}
});
it('rotas consultam só snapshot, iniciam trabalho com 202 e isolam a conta no backend',async()=>{
 const settings=new LocalSettings(':memory:'),app=Fastify(),reader=fakeReader();let now=Date.parse('2026-11-24T15:00:00Z');
 const {coordinator}=registerAdsBalance(app,settings,async()=>({}),{scope,reader,autoSync:false,clock:()=>now});
 try{
  for(let i=0;i<3;i++)expect((await app.inject('/api/v1/ads/balance')).json().status).toBe('unavailable');
  expect(reader.account).not.toHaveBeenCalled();
  const start=await app.inject({method:'POST',url:'/api/v1/ads/balance/sync',payload:{force:true}});expect(start.statusCode).toBe(202);await coordinator!.idle();
  expect((await app.inject('/api/v1/ads/balance')).json().customerId).toBe(scope.customerId);
  const foreign=await app.inject('/api/v1/ads/balance?customerId=9999999999');expect(foreign.statusCode).toBe(400);
  const foreignBody=await app.inject({method:'POST',url:'/api/v1/ads/balance/sync',payload:{force:true,customerId:'9999999999'}});expect(foreignBody.statusCode).toBe(400);
  expect((await app.inject({method:'PUT',url:'/api/v1/ads/balance/limits',payload:{urgentCents:50000,attentionCents:10000,urgentDays:2,attentionDays:5}})).statusCode).toBe(400);
  expect(reader.accountBudgets).toHaveBeenCalledOnce();
 }finally{await app.close();settings.close();}
});
