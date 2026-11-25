import {describe,it,expect,vi} from 'vitest';
import {mergePeriods} from './jobs';
import {MongoReads,viewGeneration} from './datasets';
import type {MongoContext} from './connection';
import {collectGoogle} from './google-collect';
import type {GoogleAdsReader} from '../integrations/google-ads';
import {ReadGate,ProviderReadError} from '../integrations/read-transport';
import {WorkerStopping,pause} from './cancellation';

describe('coordination and resource limits',()=>{
 it('merges concurrent coverage without silently accepting an oversized history',()=>{
  expect(mergePeriods({start:'2026-11-01',end:'2026-11-10'},{start:'2026-10-01',end:'2026-11-20'})).toEqual({start:'2026-10-01',end:'2026-11-20'});
  expect(()=>mergePeriods({start:'2024-01-01',end:'2024-01-05'},{start:'2026-11-01',end:'2026-11-10'})).toThrow();
 });
 it('reads status without loading ads rows and shares simultaneous data loads',async()=>{
  const pointer=vi.fn(async()=>({generation:'generation',header:{connected:true,syncedAt:'first'},availability:{}}));
  const find=vi.fn((filter:any)=>{
   expect(filter.kind).toEqual({$in:['daily']});
   const cursor:any={sort:()=>cursor,maxTimeMS:()=>cursor,toArray:async()=>[{kind:'daily',row:{spend:10}}]};return cursor;
  });
  const ctx={collection:(name:string)=>name==='data_revisions'?{findOne:pointer}:{find}} as unknown as MongoContext;
  const reads=new MongoReads(ctx);
  await Promise.all([reads.adsHeader(),reads.adsHeader()]);expect(pointer).toHaveBeenCalledTimes(1);expect(find).not.toHaveBeenCalled();
  const reports=await Promise.all(Array.from({length:8},()=>reads.ads('daily')));expect(find).toHaveBeenCalledTimes(1);expect(reports[0].daily).toEqual([{spend:10}]);
  pointer.mockResolvedValue({generation:'generation',header:{connected:true,syncedAt:'second'},availability:{}});
  reads.invalidate();expect((await reads.ads('daily')).syncedAt).toBe('second');expect(find).toHaveBeenCalledTimes(1);
 });
 it('accepts existing snapshots and the new independent collection generations',()=>{
  expect(viewGeneration({generation:'legacy'},'messages')).toBe('legacy');
  expect(viewGeneration({generation:'revision',generations:{messages:'stable-data'}},'messages')).toBe('stable-data');
 });
 it('cancels an idle delay promptly during shutdown',async()=>{
  const controller=new AbortController();const waiting=pause(60000,controller.signal);controller.abort(new WorkerStopping());
  await expect(waiting).rejects.toBeInstanceOf(WorkerStopping);
 });
 it('cancels queued provider calls without sending another request',async()=>{
  const controller=new AbortController();
  const fetcher=vi.fn(async()=>{controller.abort(new WorkerStopping());throw controller.signal.reason;});
  const gate=new ReadGate(0,fetcher,controller.signal);
  const results=await Promise.allSettled([gate.send(new URL('https://example.test/'),{},'fixture'),gate.send(new URL('https://example.test/'),{},'fixture')]);
  expect(results.every(r=>r.status==='rejected')).toBe(true);expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('stops oversized streams before retaining the entire response',async()=>{
  let chunks=0,cancelled=false;
  const stream=new ReadableStream<Uint8Array>({pull(c){chunks++;c.enqueue(new Uint8Array(4_000_000));},cancel(){cancelled=true;}});
  const gate=new ReadGate(0,async()=>new Response(stream));
  await expect(gate.send(new URL('https://example.test/'),{},'fixture')).rejects.toThrow('limite');
  expect(cancelled).toBe(true);expect(chunks).toBeLessThanOrEqual(5);
 });
});

describe('Google publication integrity',()=>{
 function reader(){return {account:vi.fn(async()=>[{results:[{customer:{id:'1234567890',timeZone:'America/Sao_Paulo',currencyCode:'BRL'}}]}]),campaigns:vi.fn(async()=>[]),conversionActions:vi.fn(async()=>[]),dailyConversions:vi.fn(async()=>[]),report:vi.fn(async()=>[])};}
 const period={start:'2026-01-01',end:'2026-01-10'};
 it.each([429,503,401,403])('does not publish empty optional reports after HTTP %s',async status=>{
  const source=reader();source.report.mockRejectedValue(new ProviderReadError(status,'fixture'));
  await expect(collectGoogle(source as unknown as GoogleAdsReader,'1234567890',period)).rejects.toBeInstanceOf(ProviderReadError);
 });
 it('rejects a response from a different customer before querying campaigns',async()=>{
  const source=reader();await expect(collectGoogle(source as unknown as GoogleAdsReader,'0987654321',period)).rejects.toThrow('Identidade');expect(source.campaigns).not.toHaveBeenCalled();
 });
});
