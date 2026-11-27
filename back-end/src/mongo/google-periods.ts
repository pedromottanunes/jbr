import {validPeriod,type Period,periodChunks} from '../../../shared/period.js';

const shift=(day:string,n:number)=>new Date(Date.parse(day)+n*86400000).toISOString().slice(0,10);
export function googleFresh(data:any,period:Period,manual=false,now=Date.now()){
 const age=now-Date.parse(data?.syncedAt??'');
 return !!data?.connected&&validPeriod(data.period)&&period.start>=data.period.start&&period.end<=data.period.end&&age>=0&&age<(manual?600000:3600000);
}
export function googleCollectionPlan(request:Period,previous:any,today:string,manual=false,now=Date.now()){
 const known=previous?.connected&&validPeriod(previous.period)?previous.period:undefined;
 const coverage={start:known&&known.start<request.start?known.start:request.start,end:known&&known.end>request.end?known.end:request.end};
 if(!validPeriod(coverage))throw new Error('A cobertura total deve caber em 366 dias.');
 // Late conversions can revise recent dates. Reconcile the whole retained history weekly.
 const full=!known||!Array.isArray(previous.daily)||!Array.isArray(previous.conversionDaily)||!previous.reports||now-Date.parse(previous.fullSyncedAt??'')>=7*86400000||!Number.isFinite(Date.parse(previous.fullSyncedAt??''));
 if(full)return {coverage,chunks:periodChunks(coverage),full:true};
 const intervals:Period[]=[];
 const reconcileAt=Date.parse(previous?.conversionReconciledAt??'');
 const reconcile90=!Number.isFinite(reconcileAt)||now-reconcileAt>=86400000;
 const recent=shift(today,reconcile90?-89:-6);
 if(coverage.end>=recent)intervals.push({start:coverage.start>recent?coverage.start:recent,end:coverage.end});
 if(coverage.start<known.start)intervals.push({start:coverage.start,end:shift(known.start,-1)});
 if(coverage.end>known.end)intervals.push({start:shift(known.end,1),end:coverage.end});
 if(manual)intervals.push(request);
 // Historical-only selection: refresh requested dates when stale, without refetching other months.
 if(!intervals.length)intervals.push(request);
 intervals.sort((a,b)=>a.start.localeCompare(b.start));const merged:Period[]=[];
 for(const p of intervals){const last=merged.at(-1);if(last&&p.start<=shift(last.end,1)){if(p.end>last.end)last.end=p.end;}else merged.push({...p});}
 return {coverage,chunks:merged.flatMap(periodChunks),full:false,reconcile90};
}
export function outsideGoogleRefresh(date:string,chunks:Period[]){return !chunks.some(p=>date>=p.start&&date<=p.end);}
