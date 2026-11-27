import {expect,it,vi} from 'vitest';
import {MongoReads,publishPendingUmbler} from './datasets.js';

it('keeps the published snapshot and dirty marker during a recent partial batch',async()=>{
 const previous={publishedAt:new Date(),generation:'published'},transaction=vi.fn();
 const ctx:any={transaction,collection:(name:string)=>({findOne:async()=>name==='integration_state'?{value:true}:previous})};
 expect(await publishPendingUmbler(ctx,'owner')).toBe(previous);
 expect(transaction).not.toHaveBeenCalled();
});

it('updates status without reading or rewriting analytical collections when sources are unchanged',async()=>{
 const publishedAt=new Date(),update=vi.fn(async()=>({matchedCount:1})),status={_id:'attendanceSync',value:{status:'complete'}};
 const ctx:any={transaction:async(fn:any)=>fn('session'),collection:(name:string)=>{
  if(name==='integration_state')return {findOne:async()=>({value:false}),find:()=>({toArray:async()=>[status]})};
  if(name==='data_revisions')return {findOne:async()=>({publishedAt,generation:'unchanged'}),updateOne:update};
  if(name==='integration_leases')return {updateOne:async()=>({matchedCount:1})};
  throw new Error('Unexpected analytical collection access: '+name);
 }};
 await publishPendingUmbler(ctx,'owner',true);
 expect(update).toHaveBeenCalledExactlyOnceWith({_id:'umbler'},{$set:{publishedAt:expect.any(Date),'meta.attendanceSync':status.value,'serviceMeta.attendanceSync':status.value}},{session:'session'});
});

it('cannot publish metadata after losing the collection lease',async()=>{
 const update=vi.fn();
 const ctx:any={transaction:async(fn:any)=>fn('session'),collection:(name:string)=>({
  findOne:async()=>name==='integration_state'?{value:false}:{publishedAt:new Date()},
  updateOne:name==='integration_leases'?async()=>({matchedCount:0}):update,
 })};
 await expect(publishPendingUmbler(ctx,'expired',true)).rejects.toThrow('Posse da coleta expirada');
 expect(update).not.toHaveBeenCalled();
});

it('retains attendance data across budget updates and metadata-only publications',async()=>{
 let generation='a',meta={attendanceSync:{status:'partial'}};
 const find=vi.fn(()=>({maxTimeMS:()=>({toArray:async()=>[]})}));
 const ctx:any={collection:(name:string)=>name==='data_revisions'
  ?{findOne:async()=>({generation,generations:{service_conversations:generation,members:'members'},serviceMeta:meta})}
  :{find}};
 const read=new MongoReads(ctx);
 await read.service();expect(find).toHaveBeenCalledTimes(2);
 read.invalidate('google');read.invalidate('budget');
 await read.service();expect(find).toHaveBeenCalledTimes(2);
 meta={attendanceSync:{status:'complete'}};read.invalidate('umbler');
 expect((await read.service()).meta.attendanceSync.status).toBe('complete');
 expect(find).toHaveBeenCalledTimes(2);
 generation='b';read.invalidate('umbler');await read.service();
 expect(find).toHaveBeenCalledTimes(4);
});
