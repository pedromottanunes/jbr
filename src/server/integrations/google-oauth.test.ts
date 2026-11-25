import {it,expect,vi} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LocalSettings} from '../local-settings';
import {BudgetStore} from '../budget-store';
import {LocalGoogleTokens} from './google-oauth';
it('reutiliza token, coordena renovações entre instâncias e grava apenas texto protegido',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jbr-oauth-')),path=join(dir,'refresh.dpapi');writeFileSync(path,'encrypted:refresh-test');
 const settings=new LocalSettings(join(dir,'settings.db')),store=new BudgetStore(settings.db),options={clientId:'test-id',clientSecret:'test-secret',refreshPath:path,environment:'test'};
 const protect=async(value:string,encrypt:boolean)=>encrypt?'encrypted:'+value:value.replace(/^encrypted:/,'');
 let calls=0;const fetcher=vi.fn(async()=>{calls++;await new Promise(r=>setTimeout(r,10));return new Response(JSON.stringify({access_token:'access-'+calls,expires_in:3600}));});
 const a=new LocalGoogleTokens(store,options,fetcher,protect),b=new LocalGoogleTokens(store,options,fetcher,protect);
 try{
  const values=await Promise.all([a.get(),a.get(),b.get()]);expect(values).toEqual(['access-1','access-1','access-1']);expect(fetcher).toHaveBeenCalledOnce();
  expect(await a.get()).toBe('access-1');
  expect(await Promise.all([a.get(true,'access-1'),b.get(true,'access-1')])).toEqual(['access-2','access-2']);expect(fetcher).toHaveBeenCalledTimes(2);
  const cached=store.db.prepare('SELECT encrypted FROM google_oauth_cache').get();expect(cached?.encrypted).toBe('encrypted:access-2');
 }finally{settings.close();rmSync(dir,{recursive:true,force:true});}
});
