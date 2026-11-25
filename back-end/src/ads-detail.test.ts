import {expect,it} from 'vitest';
import {adsDetail} from './ads-detail';
import {reportQuery} from './integrations/google-ads';
const metric={impressions:100,clicks:10,spend:20,conversions:2.5};
const cache={connected:true,period:{start:'2026-11-01',end:'2026-11-03'},campaigns:[{id:'1',name:'A'},{id:'2',name:'B'}],daily:[{date:'2026-11-01',campaignId:'1',...metric},{date:'2026-11-03',campaignId:'1',...metric},{date:'2026-11-03',campaignId:'2',...metric}],reports:{campaigns:{available:true,rows:[{campaign:{id:'1',optimizationScore:.8},metrics:{searchImpressionShare:.3}}]},keywords:{available:true,rows:[{campaign:{id:'1',name:'A'},adGroup:{id:'1',name:'Grupo'},adGroupCriterion:{criterionId:'1',keyword:{text:'antt',matchType:'EXACT'},status:'ENABLED'},segments:{date:'2026-11-01'},metrics:{impressions:100,clicks:10,costMicros:20000000,conversions:2.5}}]}}};
it('filters dates and campaigns consistently and fills only covered missing days',()=>{
 const d=adsDetail(cache,{campaign:'1'});expect(d.total?.clicks).toBe(20);expect(d.total?.conversions).toBe(5);expect(d.daily).toHaveLength(3);expect(d.daily[1].metrics.clicks).toBe(0);expect(d.campaigns).toHaveLength(1);expect(d.keywords?.[0].spend).toBe(20);expect(d.weekdays.reduce((n,r)=>n+r.metrics.clicks,0)).toBe(20);
 const sub=adsDetail(cache,{start:'2026-11-03',end:'2026-11-03'});expect(sub.total?.clicks).toBe(20);expect(sub.keywords).toEqual([]);expect(sub.campaigns[0].share).toBeNull();expect(d.campaigns[0].share).toBe(.3);
});
it('keeps missing reports and uncovered periods distinct from zero',()=>{
 const d=adsDetail(cache,{});expect(d.terms).toBeNull();expect(d.hours).toBeNull();
 const out=adsDetail(cache,{start:'2026-10-31'});expect(out.available).toBe(false);expect(out.total).toBeNull();expect(out.daily).toEqual([]);
 expect(adsDetail({},{}).available).toBe(false);
 expect(()=>adsDetail(cache,{start:'2026-02-30'})).toThrow();
 expect(()=>adsDetail(cache,{start:'2026-11-03',end:'2026-11-01'})).toThrow();
});
it('uses fixed read reports and validates their dates before sending',()=>{
 expect(reportQuery('keywords','2026-11-01','2026-11-03')).toContain('FROM keyword_view');
 expect(reportQuery('hours','2026-11-01','2026-11-03')).toContain('segments.hour');
 expect(()=>reportQuery('terms',"2026-11-01' OR 1=1",'2026-11-03')).toThrow();
 expect(()=>reportQuery('ads','2026-01-01','2026-11-03')).toThrow();
});
