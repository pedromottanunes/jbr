import {validPeriod,type Period} from '../../../shared/period.js';
import {localDay} from '../../../shared/business-hours.js';
import {ctaCatalogVersion} from '../cta.js';

export const attendanceAnalysisVersion=2;
export const recentRefreshMs=15*60_000;
export const historicalRefreshMs=24*60*60_000;
const DAY=86400000;
export const nextDay=(day:string,n=1)=>new Date(Date.parse(day+'T12:00:00Z')+n*DAY).toISOString().slice(0,10);
export function periodDays(period:Period){const days:string[]=[];for(let day=period.start;day<=period.end;day=nextDay(day))days.push(day);return days;}
// Binary search the civil-day boundary; also handles historical Sao Paulo DST.
export function dayStart(day:string){let low=Date.parse(day)-12*3600000,high=Date.parse(day)+12*3600000;while(high-low>1){const mid=Math.floor((low+high)/2);if(localDay(mid)<day)low=mid;else high=mid;}return new Date(high).toISOString();}
export function periodBounds(period:Period,now=new Date()){
 if(!validPeriod(period)||period.end>localDay(+now))throw Object.assign(new Error('Selecione até 366 dias, sem datas futuras.'),{statusCode:400});
 return {since:dayStart(period.start),until:new Date(Math.min(+now,Date.parse(dayStart(nextDay(period.end))))).toISOString()};
}
export function recentPeriod(days=90,now=new Date()):Period{const end=localDay(+now);return {start:nextDay(end,1-days),end};}
export function mergeAttendancePeriods(periods:Period[]):Period[]{
 if(!periods.every(validPeriod))throw Object.assign(new Error('Período inválido.'),{statusCode:400});
 const merged:Period[]=[];
 for(const p of [...periods].sort((a,b)=>a.start.localeCompare(b.start))){const last=merged.at(-1);if(last&&p.start<=nextDay(last.end))last.end=p.end>last.end?p.end:last.end;else merged.push({...p});}
 const result:Period[]=[];
 for(const p of merged)for(let start=p.start;start<=p.end;start=nextDay(start,366))result.push({start,end:nextDay(start,365)<p.end?nextDay(start,365):p.end});
 if(result.length>12)throw Object.assign(new Error('A fila de períodos está cheia. Aguarde a coleta atual.'),{statusCode:409});
 return result;
}
export function subtractPeriods(requested:Period[],covered:Period[]){
 let rest=requested.map(p=>({...p}));
 for(const c of covered)rest=rest.flatMap(p=>p.end<c.start||p.start>c.end?[p]:[...(p.start<c.start?[{start:p.start,end:nextDay(c.start,-1)}]:[]),...(p.end>c.end?[{start:nextDay(c.end),end:p.end}]:[])]);
 return mergeAttendancePeriods(rest);
}
export function umblerPeriods(payload:any,now=new Date()):Period[]{
 // The first interval is in progress. Sorting/merging it with pending work
 // would change its cursor scope and discard unfinished ranges on completion.
 if(payload?.periods){if(!Array.isArray(payload.periods)||payload.periods.length>24||!payload.periods.every(validPeriod))throw new Error('Fila de períodos inválida.');return payload.periods.map((p:Period)=>({...p}));}
 return mergeAttendancePeriods(payload?.start?[payload]:[recentPeriod(Number(payload?.days??90),now)]);
}
export function missingAttendancePeriods(period:Period,rows:any[],now=new Date()){
 const byDay=new Map(rows.map(r=>[r._id,r])),recent=nextDay(localDay(+now),-7);
 const missing=periodDays(period).filter(day=>{const row=byDay.get(day),age=+now-+(row?.checkedAt??0);return row?.version!==attendanceAnalysisVersion||row?.ctaCatalogVersion!==ctaCatalogVersion||!row?.checkedAt||age<0||age>=(day>=recent?recentRefreshMs:historicalRefreshMs);});
 return mergeAttendancePeriods(missing.map(day=>({start:day,end:day})));
}

type Coverage={start_utc:string;end_utc:string};
// Plan only an uncovered interval. A gap between two selected periods is never
// mistaken for coverage or downloaded merely to join their watermarks.
export function periodCollectionWindow(p:any,coverage:Coverage[],since:string,until:string,last:string,entry?:string){
 const lower=entry&&entry>since?entry:since,upper=new Date(Math.min(Date.parse(until),Date.parse(last)+1)).toISOString();
 if(lower>=upper)return null;
 const intervals=coverage.map(c=>({start:c.start_utc,end:c.end_utc}));
 if(p?.unavailable_before_utc)intervals.push({start:lower,end:p.unavailable_before_utc});
 intervals.sort((a,b)=>a.start.localeCompare(b.start));
 let cursor=lower;const gaps:{lower:string;upper:string}[]=[];
 for(const c of intervals){if(c.end<=cursor||c.start>=upper)continue;if(c.start>cursor)gaps.push({lower:cursor,upper:c.start<upper?c.start:upper});if(c.end>cursor)cursor=c.end;}
 if(cursor<upper)gaps.push({lower:cursor,upper});
 const gap=gaps.at(-1);if(!gap)return null;
 return {...gap,cursor:gap.upper,latest:p?.until_utc>upper?p.until_utc:upper,earliest:p?.covered_from_utc};
}
