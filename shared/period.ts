export type Period={start:string;end:string};
export function defaultPeriod(coverage:Period):Period {
 const start=new Date(Date.parse(coverage.end)-29*86400000).toISOString().slice(0,10);
 return {start:start<coverage.start?coverage.start:start,end:coverage.end};
}
export function validPeriod(p:unknown):p is Period {
 if(!p||typeof p!=='object')return false;
 const {start,end}=p as Period;
 const day=(s:unknown):s is string=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
 return day(start)&&day(end)&&start<=end&&Date.parse(end)-Date.parse(start)<=365*86400000;
}
export function periodChunks(p:Period):Period[]{
 if(!validPeriod(p))throw new Error('Período inválido.');
 const result:Period[]=[];for(let t=Date.parse(p.start);t<=Date.parse(p.end);t+=31*86400000)result.push({start:new Date(t).toISOString().slice(0,10),end:new Date(Math.min(t+30*86400000,Date.parse(p.end))).toISOString().slice(0,10)});return result;
}
