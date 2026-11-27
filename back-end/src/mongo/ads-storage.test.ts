import {describe,it,expect} from 'vitest';
import {BSON} from 'mongodb';
import {packAdsRows,unpackAdsRows} from './ads-storage.js';
describe('Google report storage',()=>{
 it('preserves all rows and order with bounded write count',()=>{
  const rows=Array.from({length:12613},(_,i)=>({segments:{date:'2026-11-27'},metrics:{clicks:i},name:'Campanha '+i}));
  const docs=packAdsRows('generation','daily',rows);
  expect(docs).toHaveLength(64);expect(unpackAdsRows(docs).daily).toEqual(rows);
  expect(new Set(docs.map(d=>d.id)).size).toBe(docs.length);
  expect(docs.every(d=>BSON.calculateObjectSize(d)<1024*1024)).toBe(true);
 });
 it('bounds bytes for large Unicode rows and rejects oversized rows',()=>{
  const rows=Array.from({length:20},()=>({text:'\u00e3'.repeat(5000)}));
  const docs=packAdsRows('gen','report:ads',rows,25000);
  expect(docs.length).toBeGreaterThan(1);expect(docs.every(d=>BSON.calculateObjectSize(d)<25000)).toBe(true);
  expect(unpackAdsRows(docs)['report:ads']).toEqual(rows);
  expect(()=>packAdsRows('gen','daily',[{text:'x'.repeat(30000)}],25000)).toThrow();
 });
 it('reads existing single-row generations and empty reports',()=>{
  expect(unpackAdsRows([{kind:'daily',row:{clicks:3}},{kind:'daily',rows:[{clicks:4}]}])).toEqual({daily:[{clicks:3},{clicks:4}]});
  expect(packAdsRows('gen','daily',[])).toEqual([]);
 });
});
