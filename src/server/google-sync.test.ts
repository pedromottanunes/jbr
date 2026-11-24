import {expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import Fastify from 'fastify';
const mocks=vi.hoisted(()=>({spawn:vi.fn()}));
vi.mock('node:child_process',()=>({spawn:mocks.spawn}));
import {registerGoogleSync} from './google-sync';
it('coalesces concurrent requests, uses literal dates and avoids repeated provider jobs for cached periods',async()=>{
 const child=new EventEmitter();mocks.spawn.mockReturnValue(child);let ads:any={connected:true,period:{start:'2026-11-01',end:'2026-11-20'}};
 const app=Fastify();registerGoogleSync(app,async()=>ads);
 const request=()=>app.inject({method:'POST',url:'/api/v1/ads/sync',payload:{start:'2026-08-01',end:'2026-11-20'}});
 try{
  const responses=await Promise.all([request(),request(),request()]);expect(responses.every(r=>r.json().status==='running')).toBe(true);expect(mocks.spawn).toHaveBeenCalledTimes(1);
  expect(mocks.spawn.mock.calls[0][1].slice(-4)).toEqual(['-Start','2026-08-01','-End','2026-11-20']);
  ads={connected:true,period:{start:'2026-08-01',end:'2026-11-20'}};child.emit('exit',0);expect((await request()).json().status).toBe('complete');expect(mocks.spawn).toHaveBeenCalledTimes(1);
  expect((await app.inject({method:'POST',url:'/api/v1/ads/sync',payload:{start:'2026-02-30',end:'2026-11-20'}})).statusCode).toBe(400);
 }finally{await app.close();mocks.spawn.mockReset();}
});
