import {it,expect,vi,afterEach} from 'vitest';
const mocks=vi.hoisted(()=>({google:vi.fn(),meta:vi.fn(),complete:vi.fn(),publish:vi.fn()}));
vi.mock('./google-collect.js',()=>({collectGoogle:mocks.google}));
vi.mock('./meta.js',()=>({collectMeta:mocks.meta}));
vi.mock('./message-retention.js',()=>({resumeContentPurge:async()=>false}));
vi.mock('./datasets.js',()=>({MongoReads:class{async ads(){return {}}},publishAds:mocks.publish}));
vi.mock('./secrets.js',()=>({mongoGoogleTokens:()=>({})}));
vi.mock('./jobs.js',()=>({completeJob:mocks.complete,enqueue:vi.fn()}));
import {runWorkerOnce} from './worker.js';
import {ProviderReadError} from '../integrations/read-transport.js';
import {BudgetError} from '../account-budget.js';
afterEach(()=>vi.clearAllMocks());
it.each([new DOMException('timed out','TimeoutError'),new TypeError('fetch failed'),new ProviderReadError(429,'rate limit',90000),new BudgetError('rate_limit',120000)])('requeues temporary failures and claims the oldest available task',async error=>{
 mocks.google.mockRejectedValueOnce(error);
 const updates:any[]=[],ctx:any={lease:async()=> 'owner',renew:async()=>true,release:async()=>{},collection:()=>({
  findOne:async()=>({_id:'google'}),updateMany:async()=>({}),
  updateOne:async(_:any,change:any)=>{updates.push(change);return {matchedCount:1};},
  findOneAndUpdate:async(_:any,__:any,options:any)=>{expect(options.sort).toEqual({availableAt:1,requestedAt:1});return {_id:'google',kind:'google',attempts:1,payload:{}};},
 })};
 await runWorkerOnce(ctx,undefined,'main');
 expect(updates.some(u=>u.$set?.status==='queued')).toBe(true);expect(mocks.complete).not.toHaveBeenCalled();
 const saved=updates.find(u=>u.$set?.status==='queued').$set;
 expect(saved.automaticRetryBlocked).toBe(false);
 if(error instanceof BudgetError)expect(+saved.availableAt).toBeGreaterThanOrEqual(Date.now()+119000);
});
it.each([new ProviderReadError(401,'invalid token'),new ProviderReadError(403,'permission'),new BudgetError('reconnect')])('preserves a definitive failure for the interface instead of retrying it',async error=>{
 mocks.google.mockRejectedValueOnce(error);
 const updateOne=vi.fn(async()=>({matchedCount:1}));
 const ctx:any={lease:async()=> 'owner',renew:async()=>true,release:async()=>{},collection:()=>({
  findOne:async()=>({_id:'google'}),updateMany:async()=>({}),updateOne,
  findOneAndUpdate:async()=>({_id:'google',kind:'google',attempts:1,payload:{}}),
 })};
 await runWorkerOnce(ctx,undefined,'main');
 expect(updateOne).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({$set:expect.objectContaining({status:'error',automaticRetryBlocked:true})}));
 expect(mocks.complete).not.toHaveBeenCalled();
});
it('runs Meta while Google is collecting, with one lease per provider and lane',async()=>{
 let release!:()=>void,started!:()=>void;const ready=new Promise<void>(r=>started=r);
 mocks.google.mockImplementation(async()=>{started();await new Promise<void>(r=>release=r);return {};});
 const held=new Map<string,string>(),claims:string[]=[];
 const ctx:any={lease:async(resource:string,_:number,owner:string)=>{if(held.has(resource))return null;held.set(resource,owner);claims.push(resource);return owner;},renew:async(resource:string,owner:string)=>held.get(resource)===owner,release:async(resource:string,owner:string)=>{if(held.get(resource)===owner)held.delete(resource);},
  collection:()=>({findOne:async()=>({_id:'job'}),updateMany:async()=>({}),updateOne:async()=>({matchedCount:1}),findOneAndUpdate:async(filter:any)=>{const kind=filter.kind==='meta'?'meta':'google';return {_id:kind,kind,attempts:1,payload:kind==='meta'?{periods:[{start:'2026-11-01',end:'2026-11-02'}]}:{start:'2026-11-01',end:'2026-11-02'}};}})};
 const google=runWorkerOnce(ctx,undefined,'main');await ready;
 try{
  expect(await runWorkerOnce(ctx,undefined,'main')).toBe(false);
  expect(await runWorkerOnce(ctx,undefined,'meta')).toBe(true);
  expect(mocks.meta).toHaveBeenCalledTimes(1);expect(mocks.google).toHaveBeenCalledTimes(1);
  expect(held.has('google')).toBe(true);expect(held.has('meta')).toBe(false);
  expect(claims).toEqual(['worker','google','worker:meta','meta']);
 }finally{release();await google;}
 expect(held.size).toBe(0);expect(mocks.complete).toHaveBeenCalledTimes(2);
});
