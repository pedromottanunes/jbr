import {describe,it,expect} from 'vitest';
import {timeGroup,businessMinutes} from './business-hours';
const config={saturdayFrom:'2026-11-01',slaMinutes:15};
describe('expediente com sábado e vigência',()=>{
 it('usa fronteiras sem sobrepor categorias',()=>{
  expect(timeGroup('2026-11-21T07:59:59-03:00',config).bucket).toBe('saturdayOutside');
  expect(timeGroup('2026-11-21T08:00:00-03:00',config).bucket).toBe('saturdayInside');
  expect(timeGroup('2026-11-21T12:59:59-03:00',config).outside).toBe(false);
  expect(timeGroup('2026-11-21T13:00:00-03:00',config).bucket).toBe('saturdayOutside');
  expect(timeGroup('2026-11-22T10:00:00-03:00',config).bucket).toBe('sunday');
  expect(timeGroup('2026-11-20T18:00:00-03:00',config).bucket).toBe('weekdayOutside');
  expect(timeGroup('2026-10-31T10:00:00-03:00',config).bucket).toBe('saturdayOutside');
 });
 it('conta minutos úteis atravessando sexta, sábado e domingo',()=>{
  expect(businessMinutes('2026-11-20T17:55:00-03:00','2026-11-21T08:10:00-03:00',config)).toBe(15);
  expect(businessMinutes('2026-11-21T12:50:00-03:00','2026-11-23T08:10:00-03:00',config)).toBe(20);
  expect(businessMinutes('2026-11-22T01:00:00-03:00','2026-11-22T22:00:00-03:00',config)).toBe(0);
  expect(businessMinutes('invalid','2026-11-22T22:00:00-03:00',config)).toBeNull();
 });
});
