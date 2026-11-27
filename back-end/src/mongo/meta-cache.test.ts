import {describe,it,expect,vi} from 'vitest';
import {missingMetaDays,cachedMetaSnapshot,metaDailyVersion,type MetaDay,MetaCache} from './meta-cache.js';
import {emptyMeta,type MetaRow} from '../../../shared/meta.js';
const now=Date.parse('2026-11-27T19:00:00Z'),period={start:'2026-11-25',end:'2026-11-27'};
const row=(date:string,spend=10):MetaRow=>({...emptyMeta(),id:'ad1',accountId:'1',name:'Ad',campaignId:'c1',campaignName:'Campaign',adsetId:'s1',adsetName:'Set',date,spend,reach:20,actions:{lead:2},impressions:100,clicks:5});
const day=(date:string):MetaDay=>({day:date,accountId:'1',version:metaDailyVersion,account:[row(date)],ads:[row(date)],instagram:[row(date,4)],checked:{account:new Date(now).toISOString(),ads:new Date(now).toISOString(),instagram:new Date(now).toISOString()}});
const info={account_id:'1',name:'Fixture',currency:'BRL',timezone_name:'America/Sao_Paulo',account_status:1};
describe('Incremental Meta daily cache',()=>{
 it('reuses one Mongo read during collection and sees newly persisted coverage',async()=>{
  vi.useFakeTimers();vi.setSystemTime(now);
  try{
   const find=vi.fn(()=>({toArray:async()=>[]})),bulkWrite=vi.fn(async()=>({}));
   const reader={daily:vi.fn(async()=>[])},cache=new MetaCache({collection:()=>({find,bulkWrite})} as any,reader as any,async()=>{});
   await cache.ensure('1',period,'account');await cache.ensure('1',period,'ads');await cache.ensure('1',period,'instagram');
   await cache.ensure('1',period,'account');
   expect(find).toHaveBeenCalledTimes(1);expect(reader.daily).toHaveBeenCalledTimes(1);
   expect((await cache.days('1',period)).every(d=>Array.isArray(d.ads)&&Array.isArray(d.instagram))).toBe(true);
  }finally{vi.useRealTimers();}
 });
 it('reuses overlapping days and requests only absent dates, including gaps',()=>{
  expect(missingMetaDays(period,[day('2026-11-25'),day('2026-11-26')],'ads',now,'2026-11-27')).toEqual([{start:'2026-11-27',end:'2026-11-27'}]);
  expect(missingMetaDays(period,[day('2026-11-26')],'ads',now,'2026-11-27')).toEqual([{start:'2026-11-25',end:'2026-11-25'},{start:'2026-11-27',end:'2026-11-27'}]);
 });
 it('keeps explicit zero-activity coverage and does not confuse missing reports with zero',()=>{
  const d=day('2026-11-27');d.ads=[];
  expect(missingMetaDays({start:d.day,end:d.day},[d],'ads',now,'2026-11-27')).toEqual([]);
  delete d.instagram;expect(missingMetaDays({start:d.day,end:d.day},[d],'instagram',now,'2026-11-27')).toHaveLength(1);
 });
 it('refreshes recent attribution while retaining weekly historical cache',()=>{
  const old=day('2026-09-01'),recent=day('2026-11-27');old.checked.ads=recent.checked.ads=new Date(now-3600000).toISOString();
  expect(missingMetaDays({start:old.day,end:old.day},[old],'ads',now,'2026-11-27')).toEqual([]);
  expect(missingMetaDays({start:recent.day,end:recent.day},[recent],'ads',now,'2026-11-27')).toHaveLength(1);
  old.checked.ads=new Date(now-8*86400000).toISOString();expect(missingMetaDays({start:old.day,end:old.day},[old],'ads',now,'2026-11-27')).toHaveLength(1);
 });
 it('recomputes additive metrics from the selected days without adding reach',()=>{
  const days=[day('2026-11-25'),day('2026-11-26'),day('2026-11-27')];
  const s=cachedMetaSnapshot(info,{start:'2026-11-26',end:'2026-11-27'},days)!;
  expect(s.total).toMatchObject({spend:20,clicks:10,impressions:200,reach:null,actions:{lead:4}});
  expect(s.campaigns).toHaveLength(1);expect(s.campaigns[0]).toMatchObject({id:'c1',spend:20,reach:null});
  expect(s.adsets[0].id).toBe('s1');expect(s.instagram[0].spend).toBe(8);expect(s.derived).toBe(true);expect(s.detailsPending).toBe(false);
 });
 it('never labels a missing summary day as a complete period; permits early summary before ad details',()=>{
  expect(cachedMetaSnapshot(info,period,[day('2026-11-25')])).toBeNull();
  const days=['2026-11-25','2026-11-26','2026-11-27'].map(day);for(const d of days){delete d.ads;delete d.instagram;}
  const s=cachedMetaSnapshot(info,period,days)!;expect(s.total.spend).toBe(30);expect(s.detailsPending).toBe(true);expect(s.ads).toEqual([]);
 });
 it('does not call Meta again for a fully cached period',async()=>{
  vi.useFakeTimers();vi.setSystemTime(now);
  try{const docs=['2026-11-25','2026-11-26','2026-11-27'].map(day),reader={daily:vi.fn()},ctx={collection:()=>({find:()=>({toArray:async()=>docs})})};
   await new MetaCache(ctx as any,reader as any,async()=>{}).ensure('1',period,'ads');expect(reader.daily).not.toHaveBeenCalled();
  }finally{vi.useRealTimers();}
 });
 it('writes only the missing day, preserving earlier records and a zero result',async()=>{
  vi.useFakeTimers();vi.setSystemTime(now);
  try{const docs=['2026-11-25','2026-11-26'].map(day),reader={daily:vi.fn(async()=>[])},bulkWrite=vi.fn(),ctx={collection:()=>({find:()=>({toArray:async()=>docs}),bulkWrite})};
   await new MetaCache(ctx as any,reader as any,async()=>{}).ensure('1',period,'ads');
   expect(reader.daily).toHaveBeenCalledExactlyOnceWith('1',{start:'2026-11-27',end:'2026-11-27'},'ads');
   const operations=bulkWrite.mock.calls[0][0];expect(operations).toHaveLength(1);expect(operations[0].updateOne.update.$set.ads).toEqual([]);
  }finally{vi.useRealTimers();}
 });
 it('does not mark coverage when a provider page fails',async()=>{
  const bulkWrite=vi.fn(),ctx={collection:()=>({find:()=>({toArray:async()=>[]}),bulkWrite})},reader={daily:vi.fn(async()=>{throw new Error('page failed');})};
  await expect(new MetaCache(ctx as any,reader as any,async()=>{}).ensure('1',period,'ads')).rejects.toThrow('page failed');expect(bulkWrite).not.toHaveBeenCalled();
 });
});
