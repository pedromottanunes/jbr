import {expect,it,vi} from 'vitest';
it('keeps the applied period across consumers and module reloads, rejecting malformed saved dates',async()=>{
 const memory=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>memory.set(k,v)});
 try{
  vi.resetModules();const first=await import('./usePeriod');expect(first.readSelectedPeriod()).toBeNull();
  first.setPeriod({start:'2026-08-01',end:'2026-11-20'});
  const second=await import('./usePeriod');expect(second.readSelectedPeriod()).toEqual({start:'2026-08-01',end:'2026-11-20'});
  vi.resetModules();const reload=await import('./usePeriod');expect(reload.readSelectedPeriod()).toEqual(second.readSelectedPeriod());
  memory.set('jbr-report-period-v1','{"start":"bad","end":"bad"}');vi.resetModules();expect((await import('./usePeriod')).readSelectedPeriod()).toBeNull();
 }finally{vi.unstubAllGlobals();vi.resetModules();}
});
