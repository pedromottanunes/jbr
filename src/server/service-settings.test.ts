import {describe,it,expect} from 'vitest';
import Fastify from 'fastify';
import {LocalSettings,registerAttendanceSettings} from './local-settings';
import {registerAdsBalance} from './ads-balance';
describe('configuração local e registros financeiros',()=>{
 it('persiste critérios, recusa sobrescrita concorrente e não duplica uma recarga',async()=>{
  const store=new LocalSettings(':memory:'),app=Fastify();
  const now=new Date().toISOString(),today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  registerAttendanceSettings(app,store);registerAdsBalance(app,store,async()=>({connected:true,account:{id:'test'},currency:'BRL',timezone:'America/Sao_Paulo',syncedAt:now,period:{start:'2026-01-01',end:today},daily:[]}));
  try{
   const body={saturdayFrom:'2026-11-01',slaMinutes:10,revision:0};
   expect((await app.inject({method:'PUT',url:'/api/v1/attendance/config',payload:body})).statusCode).toBe(200);
   expect((await app.inject({method:'PUT',url:'/api/v1/attendance/config',payload:body})).statusCode).toBe(409);
   expect((await app.inject('/api/v1/attendance/config')).json().config.saturdayFrom).toBe('2026-11-01');
   const baseline={id:'00000000-0000-0000-0000-000000000001',kind:'baseline',amountCents:10000,note:''};
   expect((await app.inject({method:'POST',url:'/api/v1/ads/balance/entries',payload:baseline})).statusCode).toBe(200);
   const credit={...baseline,id:'00000000-0000-0000-0000-000000000002',kind:'credit',amountCents:5000};
   for(let i=0;i<2;i++)expect((await app.inject({method:'POST',url:'/api/v1/ads/balance/entries',payload:credit})).statusCode).toBe(200);
   expect(Number(store.db.prepare('SELECT count(*) AS n FROM balance_entries').get()?.n)).toBe(2);
   expect((await app.inject('/api/v1/ads/balance')).json().balance).toBe(150);
   expect((await app.inject({method:'POST',url:'/api/v1/ads/balance/entries',payload:{...credit,amountCents:6000}})).statusCode).toBe(409);
  }finally{await app.close();store.close();}
 });
});
