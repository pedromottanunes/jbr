import {it,expect} from 'vitest';
import Fastify from 'fastify';
import {LocalSettings,registerAttendanceSettings} from './local-settings';
import {registerAdsBalance} from './ads-balance';
it('preserva critérios de atendimento e remove a entrada manual de saldo',async()=>{
 const store=new LocalSettings(':memory:'),app=Fastify();
 registerAttendanceSettings(app,store);registerAdsBalance(app,store,async()=>({connected:false}),{autoSync:false});
 try{
  const body={saturdayFrom:'2026-11-01',slaMinutes:10,revision:0};
  expect((await app.inject({method:'PUT',url:'/api/v1/attendance/config',payload:body})).statusCode).toBe(200);
  expect((await app.inject({method:'PUT',url:'/api/v1/attendance/config',payload:body})).statusCode).toBe(409);
  expect((await app.inject('/api/v1/attendance/config')).json().config.saturdayFrom).toBe('2026-11-01');
  expect((await app.inject({method:'POST',url:'/api/v1/ads/balance/entries',payload:{kind:'baseline',amountCents:100}})).statusCode).toBe(404);
 }finally{await app.close();store.close();}
});
