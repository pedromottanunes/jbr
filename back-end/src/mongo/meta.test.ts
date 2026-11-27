import {describe,it,expect,vi} from 'vitest';
import Fastify from 'fastify';
import {metaDashboard,mergeMetaPeriods,registerMeta} from './meta.js';
import {enqueue,completeJob} from './jobs.js';
import {metaAccounts,emptyMeta,sumMeta,type MetaSnapshot} from '../../../shared/meta.js';
import {MetaAdsReader,safeMetaUrl,metaMetrics} from '../integrations/meta-ads.js';
import {ReadGate} from '../integrations/read-transport.js';
const period={start:'2026-11-01',end:'2026-11-26'};
const snapshot=(accountId:string):MetaSnapshot=>({accountId,accountName:'Fixture',currency:'BRL',timezone:'America/Sao_Paulo',accountStatus:1,period,syncedAt:new Date().toISOString(),total:{...emptyMeta(),spend:100,clicks:20,impressions:1000,reach:500,actions:{lead:4,'offsite_conversion.fb_pixel_lead':4},values:{}},campaigns:[],adsets:[],ads:[],instagram:[],daily:[],warnings:[]});
describe('Meta reporting semantics',()=>{
 it('does not add overlapping actions or unique reach',()=>{const r=snapshot(metaAccounts[0].id).total;const combined=sumMeta([r,r]);expect(combined.actions.lead).toBe(8);expect(combined.actions['offsite_conversion.fb_pixel_lead']).toBe(8);expect(combined.reach).toBeNull();expect(combined.spend).toBe(200);expect(sumMeta([r]).reach).toBe(500);});
 it('never presents a partial collection as a consolidated total',()=>{const d=metaDashboard(period,[snapshot(metaAccounts[0].id)]);expect(d.available).toBe(false);expect(d.total).toBeNull();expect(d.accounts.filter(a=>a.available)).toHaveLength(1);expect(metaDashboard(period,[snapshot(metaAccounts[0].id)],metaAccounts[0].id).total?.spend).toBe(100);});
 it('isolates periods and accounts and does not combine currencies',()=>{const ss=metaAccounts.map(a=>snapshot(a.id));expect(metaDashboard({...period,end:'2026-11-25'},ss).total).toBeNull();ss[1].currency='USD';expect(metaDashboard(period,ss).total).toBeNull();expect(metaDashboard(period,ss,metaAccounts[0].id).total?.reach).toBe(500);});
 it('retains exact requested periods instead of merging reach windows',()=>{expect(mergeMetaPeriods([period],[period,{...period,start:'2026-11-02'}])).toHaveLength(2);expect(()=>mergeMetaPeriods([{start:'bad',end:'bad'}])).toThrow();});
 it('normalizes missing optional metrics without guessing reach and preserves net adjustments',()=>{expect(metaMetrics({spend:'12.30',clicks:'4',actions:[{action_type:'lead',value:'2'},{action_type:'post_interaction_net',value:'-3'}]})).toMatchObject({spend:12.3,clicks:4,reach:null,actions:{lead:2,post_interaction_net:-3}});});
});
describe('Meta guarded transport',()=>{
 it('uses Authorization and cursor pagination, never a provider next URL',async()=>{
  const urls:string[]=[];const f=vi.fn(async(input:any,init:any)=>{urls.push(String(input));expect(init.headers.Authorization).toBe('Bearer fixture-secret');return new Response(JSON.stringify(urls.length===1?{data:[{id:'1'}],paging:{next:'https://evil.test/?access_token=DO_NOT_USE',cursors:{after:'cursor-one'}}}:{data:[{id:'2'}]}));});
  const r=new MetaAdsReader('fixture-secret',new ReadGate(0,f));expect(await r.pages('act_'+metaAccounts[0].id+'/ads',{})).toHaveLength(2);expect(urls[1]).toContain('after=cursor-one');expect(urls.every(u=>u.startsWith('https://graph.facebook.com/v27.0/')&&!u.includes('secret')&&!u.includes('DO_NOT_USE'))).toBe(true);
 });
 it('rejects another account before sending a request and fails on truncated pagination',async()=>{
  const f=vi.fn(async()=>new Response(JSON.stringify({data:[{}],paging:{next:'next',cursors:{after:'same'}}})));const r=new MetaAdsReader('fixture',new ReadGate(0,f));await expect(r.get('act_999/ads')).rejects.toThrow('autorizada');expect(f).not.toHaveBeenCalled();await expect(r.pages('act_'+metaAccounts[0].id+'/ads',{})).rejects.toThrow('Paginação');
 });
 it('does not expose provider errors with credentials',async()=>{const r=new MetaAdsReader('fixture-secret',new ReadGate(0,async()=>new Response('fixture-secret',{status:401})));await expect(r.get('act_'+metaAccounts[0].id)).rejects.toThrow('HTTP 401');});
 it('only permits HTTPS Meta media and post links without access tokens',()=>{expect(safeMetaUrl('javascript:alert(1)')).toBeNull();expect(safeMetaUrl('https://instagram.com.evil.test/a')).toBeNull();expect(safeMetaUrl('https://instagram.com/p/x?access_token=secret')).toBeNull();expect(safeMetaUrl('https://www.instagram.com/p/x')).toBeTruthy();expect(safeMetaUrl('https://scontent.xx.fbcdn.net/a.jpg',true)).toBeTruthy();});
});
describe('Meta routes and queue',()=>{
 it('serves a saved period and skips the queue when that period is fresh',async()=>{
  const docs=metaAccounts.map(a=>({data:snapshot(a.id),updatedAt:new Date()})),collection=vi.fn((name:string)=>{expect(name).toBe('meta_snapshots');return {find:()=>({maxTimeMS(){return this;},toArray:async()=>docs})};});
  const app=Fastify();registerMeta(app,{collection} as any);vi.stubEnv('INTEGRATIONS_ENABLED','true');
  try{const read=await app.inject('/api/v1/meta/detail?start='+period.start+'&end='+period.end);expect(read.json()).toMatchObject({available:true,total:{spend:300}});
   const sync=await app.inject({method:'POST',url:'/api/v1/meta/sync',payload:period});expect(sync.statusCode).toBe(200);expect(sync.json().status).toBe('complete');expect(collection).toHaveBeenCalledTimes(2);
  }finally{vi.unstubAllEnvs();await app.close();}
 });
 it('validates filters without touching the provider or database',async()=>{const ctx={collection:vi.fn()};const app=Fastify();registerMeta(app,ctx as any);try{expect((await app.inject('/api/v1/meta/detail?start=2026-11-01&end=2026-11-02&account=999')).statusCode).toBe(400);expect((await app.inject('/api/v1/meta/detail?start=2026-02-30&end=2026-03-01')).statusCode).toBe(400);expect(ctx.collection).not.toHaveBeenCalled();}finally{await app.close();}});
 it('coalesces duplicate tabs and preserves a different period arriving during execution',async()=>{
  let row:any=null;const collection={findOne:async()=>row,updateOne:async(_:any,change:any)=>{row??={};for(const[k,v]of Object.entries(change.$set??{})){if(k==='payload.periods')row.payload.periods=v;else row[k]=v;}for(const[k,v]of Object.entries(change.$inc??{}))row[k]=(row[k]??0)+Number(v);for(const k of Object.keys(change.$unset??{}))delete row[k];}};
  const ctx={collection:()=>collection,transaction:async(fn:any)=>fn({})} as any;
  await enqueue(ctx,'meta',{periods:[period]});await enqueue(ctx,'meta',{periods:[period]});expect(row.payload.periods).toEqual([period]);row.status='running';row.owner='test';row.leaseUntil=new Date(Date.now()+60000);
  const next={...period,start:'2026-11-02'};await enqueue(ctx,'meta',{periods:[next]});expect(row.payload.periods).toEqual([period,next]);await completeJob(ctx,'meta','test');expect(row.status).toBe('queued');expect(row.payload.periods).toEqual([next]);expect(+row.availableAt).toBeLessThanOrEqual(Date.now());
  row.status='complete';row.availableAt=new Date(Date.now()+30000);await enqueue(ctx,'meta',{periods:[period]});expect(+row.availableAt).toBeLessThanOrEqual(Date.now());
 });
});
