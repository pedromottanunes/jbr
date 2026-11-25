export type AttendanceConfig = {saturdayFrom:string; slaMinutes:number};
export const defaultAttendanceConfig:AttendanceConfig={saturdayFrom:'2026-11-24',slaMinutes:15};
export const timeLabels={weekdayInside:'Semana · 8h–18h',weekdayOutside:'Semana · fora',saturdayInside:'Sábado · 8h–13h',saturdayOutside:'Sábado · fora',sunday:'Domingo'} as const;
export type TimeBucket=keyof typeof timeLabels;
const dateFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'});
const clockFormatter=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export const localDay=(at:string|number)=>dateFormatter.format(new Date(at));
export function timeGroup(at:string|number,config:AttendanceConfig=defaultAttendanceConfig){
 const date=localDay(at),weekday=new Date(date+'T12:00:00Z').getUTCDay();
 const [hour,minute]=clockFormatter.format(new Date(at)).split(':').map(Number),minutes=hour*60+minute;
 const saturday=weekday===6,weekend=saturday||weekday===0;
 const inside=weekday>0&&weekday<6?minutes>=480&&minutes<1080:saturday&&date>=config.saturdayFrom&&minutes>=480&&minutes<780;
 const bucket:TimeBucket=weekday===0?'sunday':saturday?(inside?'saturdayInside':'saturdayOutside'):(inside?'weekdayInside':'weekdayOutside');
 return {date,weekend,outside:!inside,bucket};
}
// Local dates are anchored at noon UTC to avoid crossing a civil-day boundary.
export function businessMinutes(start:string|number,end:string|number,config:AttendanceConfig=defaultAttendanceConfig){
 const from=new Date(start).getTime(),until=new Date(end).getTime();
 if(!Number.isFinite(from)||!Number.isFinite(until)||until<from)return null;
 if(until-from>370*86400000)return null;
 let total=0;
 for(let d=localDay(from);d<=localDay(until);d=new Date(Date.parse(d+'T12:00:00Z')+86400000).toISOString().slice(0,10)){
  const weekday=new Date(d+'T12:00:00Z').getUTCDay();
  const close=weekday>0&&weekday<6?18:weekday===6&&d>=config.saturdayFrom?13:0;if(!close)continue;
  // Resolve the actual Sao Paulo offset for this date, including historical DST.
  const probe=Date.parse(d+'T12:00:00Z'),[h,m]=clockFormatter.format(probe).split(':').map(Number);
  const offset=(h*60+m-720)*60000;
  const open=Date.parse(d+'T08:00:00Z')-offset,finish=Date.parse(d+'T'+close+':00:00Z')-offset;
  total+=Math.max(0,Math.min(until,finish)-Math.max(from,open));
 }
 return total/60000;
}
