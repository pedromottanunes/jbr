import {describe,it,expect} from 'vitest';
import {dayStart,periodBounds,periodCollectionWindow,mergeAttendancePeriods,subtractPeriods,missingAttendancePeriods,attendanceAnalysisVersion,umblerPeriods} from './attendance-period';
const now=new Date('2026-11-25T12:00:00Z');
const stamp=(day:string)=>day+'T03:00:00.000Z';
describe('attendance period planning',()=>{
 it('uses civil days in Sao Paulo and rejects invalid/future ranges',()=>{
  expect(dayStart('2026-11-21')).toBe(stamp('2026-11-21'));
  expect(dayStart('2018-01-10')).toBe('2018-01-10T02:00:00.000Z');
  expect(periodBounds({start:'2026-11-21',end:'2026-11-22'},now)).toEqual({since:stamp('2026-11-21'),until:stamp('2026-11-23')});
  expect(periodBounds({start:'2026-11-25',end:'2026-11-25'},now).until).toBe(now.toISOString());
  expect(()=>periodBounds({start:'2026-11-25',end:'2026-11-26'},now)).toThrow();
  expect(()=>periodBounds({start:'2026-02-30',end:'2026-03-01'},now)).toThrow();
 });
 it('coalesces overlap without scanning unrequested gaps or losing disjoint ranges',()=>{
  expect(mergeAttendancePeriods([{start:'2026-11-05',end:'2026-11-10'},{start:'2026-11-01',end:'2026-11-07'},{start:'2026-11-20',end:'2026-11-21'}])).toEqual([{start:'2026-11-01',end:'2026-11-10'},{start:'2026-11-20',end:'2026-11-21'}]);
  expect(subtractPeriods([{start:'2026-11-01',end:'2026-11-30'}],[{start:'2026-11-07',end:'2026-11-20'}])).toEqual([{start:'2026-11-01',end:'2026-11-06'},{start:'2026-11-21',end:'2026-11-30'}]);
  const pending=[{start:'2026-11-07',end:'2026-11-20'},{start:'2026-11-01',end:'2026-11-06'},{start:'2026-11-21',end:'2026-11-30'}];
  expect(umblerPeriods({periods:pending})).toEqual(pending);
 });
 it('refreshes recent discovery after 15 minutes and older discovery after a day',()=>{
  const row=(day:string,minutes:number)=>({_id:day,version:attendanceAnalysisVersion,checkedAt:new Date(+now-minutes*60000)});
  const p={start:'2026-11-17',end:'2026-11-19'};
  expect(missingAttendancePeriods(p,[row('2026-11-17',16),row('2026-11-18',16),row('2026-11-19',1)],now)).toEqual([{start:'2026-11-18',end:'2026-11-18'}]);
  expect(missingAttendancePeriods({start:'2026-10-01',end:'2026-10-01'},[row('2026-10-01',1440)],now)).toHaveLength(1);
 });
 it('resumes at the first missing boundary and reads a new reply only once',()=>{
  const from=stamp('2026-11-01'),end=stamp('2026-11-10'),last=stamp('2026-11-09');
  const covered=[{start_utc:from,end_utc:stamp('2026-11-05')}];
  expect(periodCollectionWindow({},covered,from,end,last)?.lower).toBe(stamp('2026-11-05'));
  covered.push({start_utc:stamp('2026-11-05'),end_utc:new Date(Date.parse(last)+1).toISOString()});
  expect(periodCollectionWindow({},covered,from,end,last)).toBeNull();
  expect(periodCollectionWindow({},covered,from,end,'2026-11-09T04:00:00.000Z')?.lower).toBe(new Date(Date.parse(last)+1).toISOString());
 });
 it('does not download gaps between separate requested periods and respects restricted history',()=>{
  const covered=[{start_utc:stamp('2026-11-20'),end_utc:stamp('2026-11-25')}];
  expect(periodCollectionWindow({},covered,stamp('2026-10-01'),stamp('2026-10-08'),stamp('2026-11-24'))).toMatchObject({lower:stamp('2026-10-01'),upper:stamp('2026-10-08')});
  expect(periodCollectionWindow({unavailable_before_utc:stamp('2026-11-20')},covered,stamp('2026-10-01'),stamp('2026-11-25'),stamp('2026-11-24'))).toBeNull();
 });
});
