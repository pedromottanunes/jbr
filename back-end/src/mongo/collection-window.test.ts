import {describe,it,expect} from 'vitest';
import {collectionWindow} from './collection-window';
const p={complete:1,until_utc:'2026-11-20T00:00:00Z',from_utc:'2026-11-01T00:00:00Z'};
describe('incremental collection windows',()=>{
 it('skips unchanged history within stored coverage',()=>{expect(collectionWindow(p,p.until_utc,p.from_utc,'2026-11-21T00:00:00Z')).toBeNull();});
 it('reads only the new slice for a changed conversation',()=>{expect(collectionWindow(p,'2026-11-21T00:00:00Z',p.from_utc,'2026-11-22T00:00:00Z')?.lower).toBe(p.until_utc);});
 it('extends older coverage without restarting at the newest message',()=>{
  const w=collectionWindow(p,p.until_utc,'2026-10-01T00:00:00Z','2026-11-22T00:00:00Z');
  expect(w).toMatchObject({cursor:p.from_utc,upper:p.from_utc,lower:'2026-10-01T00:00:00Z',latest:p.until_utc});
 });
 it('resumes an interrupted historical extension and preserves the newer watermark',()=>{
  const w=collectionWindow({...p,complete:0,cursor:'2026-10-15T00:00:00Z',page_upper_utc:p.from_utc,from_utc:'2026-10-01T00:00:00Z'},p.until_utc,'2026-09-01T00:00:00Z','2026-11-22T00:00:00Z');
  expect(w).toMatchObject({cursor:'2026-10-15T00:00:00Z',upper:p.from_utc,lower:'2026-10-01T00:00:00Z',latest:p.until_utc});
 });
 it('does not repeatedly request history restricted by the provider or before chat entry',()=>{
  expect(collectionWindow({...p,limited:1},p.until_utc,'2026-10-01T00:00:00Z',p.until_utc)).toBeNull();
  expect(collectionWindow(p,p.until_utc,'2026-10-01T00:00:00Z',p.until_utc,'2026-11-02T00:00:00Z')).toBeNull();
 });
});
