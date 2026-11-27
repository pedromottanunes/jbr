import {expect,it,vi} from 'vitest';
import {enqueue,type JobKind} from './jobs.js';

it.each(['google','meta','umbler','budget'] as JobKind[])('blocks automatic retries after a definitive %s error but allows manual recovery',async kind=>{
 const period={start:'2026-11-01',end:'2026-11-03'};
 const row:any={_id:kind,kind,status:'error',revision:1,automaticRetryBlocked:true,availableAt:new Date(Date.now()+90000)};
 const initialDelay=+row.availableAt;
 const updateOne=vi.fn(async(_:any,change:any)=>{
  Object.assign(row,change.$set);for(const key of Object.keys(change.$unset??{}))delete row[key];
  for(const [key,value] of Object.entries(change.$inc??{}))row[key]=(row[key]??0)+Number(value);
 });
 const ctx:any={transaction:async(fn:any)=>fn('session'),collection:(name:string)=>name==='sync_jobs'?{findOne:async()=>row,updateOne}:{findOne:async()=>null}};
 const payload=kind==='google'?period:kind==='meta'?{periods:[period]}:kind==='umbler'?{periods:[period],automatic:true}:{};
 for(let i=0;i<3;i++)expect((await enqueue(ctx,kind,payload)).status).toBe('error');
 expect(updateOne).not.toHaveBeenCalled();expect(row.revision).toBe(1);
 const manual={...payload,refresh:true,...(kind==='umbler'?{automatic:false}:{})};
 expect((await enqueue(ctx,kind,manual)).status).toBe('running');
 expect(row.automaticRetryBlocked).toBeUndefined();expect(row.revision).toBe(2);
 expect(+row.availableAt).toBeGreaterThanOrEqual(initialDelay);
});
