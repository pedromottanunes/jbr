import {describe,it,expect,vi,afterEach} from 'vitest';
import {googleCollectionPlan,googleFresh} from './google-periods.js';
import {collectGoogle} from './google-collect.js';
import {enqueue} from './jobs.js';
const now=Date.parse('2026-11-27T15:00:00Z');
const old={connected:true,period:{start:'2026-01-01',end:'2026-11-20'},daily:[],conversionDaily:[],reports:{},fullSyncedAt:new Date(now).toISOString()};
afterEach(()=>vi.useRealTimers());
describe('Google incremental collection',()=>{
 it('uses seven days for frequent refreshes but reconciles 90 days daily',()=>{
  const recent={...old,conversionReconciledAt:new Date(now-3600000).toISOString()};
  const request={start:'2026-11-21',end:'2026-11-27'};
  const short=googleCollectionPlan(request,recent,'2026-11-27',false,now);
  expect(short.chunks).toEqual([request]);expect(short.reconcile90).toBe(false);
  const daily=googleCollectionPlan(request,{...recent,conversionReconciledAt:new Date(now-86400000).toISOString()},'2026-11-27',false,now);
  expect(daily.chunks[0].start).toBe('2026-08-30');expect(daily.reconcile90).toBe(true);
  expect(googleCollectionPlan({start:'2026-02-01',end:'2026-02-03'},recent,'2026-11-27',true,now).chunks[0]).toEqual({start:'2026-02-01',end:'2026-02-03'});
 });
 it('reuses older dates, includes new dates and rechecks late conversions',()=>{
  const plan=googleCollectionPlan({start:'2026-11-21',end:'2026-11-27'},old,'2026-11-27',false,now);
  expect(plan.full).toBe(false);expect(plan.coverage).toEqual({start:'2026-01-01',end:'2026-11-27'});
  expect(plan.chunks[0].start).toBe('2026-08-30');expect(plan.chunks.at(-1)?.end).toBe('2026-11-27');
  expect(plan.chunks).toHaveLength(3);
 });
 it('reconciles the entire history weekly or when previous data is unavailable',()=>{
  for(const previous of [{...old,fullSyncedAt:'2026-11-19T00:00:00Z'},{...old,daily:undefined}])expect(googleCollectionPlan({start:'2026-11-21',end:'2026-11-27'},previous,'2026-11-27',false,now).full).toBe(true);
 });
 it('refreshes explicitly selected historical dates without duplicating overlapping days',()=>{
  const p=googleCollectionPlan({start:'2026-05-01',end:'2026-09-20'},old,'2026-11-27',true,now);
  expect(p.chunks[0].start).toBe('2026-05-01');
  for(let i=1;i<p.chunks.length;i++)expect(p.chunks[i].start>p.chunks[i-1].end).toBe(true);
 });
 it('replaces refreshed rows, removes obsolete results and retains historical totals',async()=>{
  vi.useFakeTimers();vi.setSystemTime(now);
  const previous={...old,account:{id:'1234567890'},timezone:'America/Sao_Paulo',currency:'BRL',campaigns:[{id:'1',name:'Old'}],
   daily:[{date:'2026-01-01',campaignId:'1',clicks:4,impressions:10,spend:5,conversions:1},{date:'2026-11-01',campaignId:'1',clicks:999,impressions:999,spend:999,conversions:999}],
   conversionDaily:[{date:'2026-01-01',value:1},{date:'2026-11-01',value:999}],reports:{terms:{available:true,rows:[{segments:{date:'2026-01-01'},metrics:{clicks:4}},{segments:{date:'2026-11-01'},metrics:{clicks:999}}]}}};
  const source={account:async()=>[{results:[{customer:{id:'1234567890',timeZone:previous.timezone,currencyCode:'BRL'}}]}],conversionActions:async()=>[],dailyConversions:async()=>[],
   campaigns:vi.fn(async(_:string,start:string)=>start==='2026-08-30'?[{results:[{segments:{date:'2026-11-02'},campaign:{id:'1',name:'New'},metrics:{clicks:2,impressions:3,costMicros:1000000,conversions:0.5}}]}]:[]),report:vi.fn(async()=>[])};
  const result=await collectGoogle(source as any,'1234567890',{start:'2026-11-21',end:'2026-11-27'},previous);
  expect(result.metrics).toEqual({clicks:6,impressions:13,spend:6,conversions:1.5});expect(result.daily).toHaveLength(2);
  expect(result.campaigns[0].name).toBe('New');expect(result.conversionDaily).toEqual([{date:'2026-01-01',value:1}]);
  expect(result.reports.terms.rows).toHaveLength(1);expect(source.campaigns).toHaveBeenCalledTimes(3);
 });
});
describe('Google freshness and deduplication',()=>{
 it('uses separate automatic/manual cooldowns without hiding missing coverage',()=>{
  const data={...old,syncedAt:new Date(now-15*60000).toISOString()};
  expect(googleFresh(data,old.period,false,now)).toBe(true);expect(googleFresh(data,old.period,true,now)).toBe(false);
  expect(googleFresh({...data,syncedAt:new Date(now-2*3600000).toISOString()},old.period,false,now)).toBe(false);
  expect(googleFresh(data,{start:'2026-01-01',end:'2026-11-27'},false,now)).toBe(false);
 });
 it('does not queue again after another tab has just completed publication',async()=>{
  const updateOne=vi.fn();const ctx={transaction:async(fn:any)=>fn({}),collection:(name:string)=>name==='data_revisions'?{findOne:async()=>({header:{...old,syncedAt:new Date().toISOString()}})}:{findOne:async()=>({status:'complete'}),updateOne}};
  await enqueue(ctx as any,'google',{...old.period,refresh:true});expect(updateOne).not.toHaveBeenCalled();
 });
});
