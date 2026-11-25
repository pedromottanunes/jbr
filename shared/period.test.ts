import {expect,it} from 'vitest';
import {periodChunks,validPeriod,defaultPeriod} from './period';
it('splits inclusive windows without overlap, gaps or oversized calls',()=>{
 const chunks=periodChunks({start:'2026-08-01',end:'2026-11-20'});
 expect(chunks).toHaveLength(4);expect(chunks[0].start).toBe('2026-08-01');expect(chunks.at(-1)?.end).toBe('2026-11-20');
 let days=0;chunks.forEach((p,i)=>{const length=(Date.parse(p.end)-Date.parse(p.start))/86400000+1;expect(length).toBeLessThanOrEqual(31);days+=length;if(i)expect(Date.parse(p.start)-Date.parse(chunks[i-1].end)).toBe(86400000);});expect(days).toBe(112);
 expect(validPeriod({start:'2026-02-30',end:'2026-03-01'})).toBe(false);expect(validPeriod({start:'2025-01-01',end:'2026-12-31'})).toBe(false);
 expect(defaultPeriod({start:'2026-08-01',end:'2026-11-20'})).toEqual({start:'2026-10-22',end:'2026-11-20'});
});
