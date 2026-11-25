import {it,expect,vi} from 'vitest';
import {ReadGate} from './read-transport';
import {GoogleAdsReader} from './google-ads';
const auth=()=>({get:vi.fn(async(force?:boolean)=>force?'new-access':'cached-access')});
it('renova após 401 e repete só uma vez, sem alterar a consulta de orçamento',async()=>{
 const provider=auth(),headers:string[]=[],bodies:string[]=[];
 const fetcher=vi.fn(async(_url,init)=>{headers.push(init.headers.Authorization);bodies.push(init.body);return new Response('[]',{status:headers.length===1?401:200});});
 const reader=new GoogleAdsReader({tokenProvider:provider,version:'v26',developerToken:'dev',loginCustomerId:'123-456-7890'},new ReadGate(0,fetcher));
 await reader.accountBudgets('098-765-4321');expect(headers).toEqual(['Bearer cached-access','Bearer new-access']);expect(bodies[0]).toBe(bodies[1]);expect(bodies[0]).toContain('adjusted_spending_limit_micros');expect(bodies[0]).not.toContain('campaign');
 const fail=vi.fn(async()=>new Response('{}',{status:401}));const auth2=auth();
 await expect(new GoogleAdsReader({tokenProvider:auth2,version:'v26'},new ReadGate(0,fail)).accountBudgets('1234567890')).rejects.toMatchObject({status:401});expect(fail).toHaveBeenCalledTimes(2);
});
it('403 não repete; 429 respeita Retry-After; erros temporários têm retry limitado',async()=>{
 for(const code of [403,429,503]){
  const fetcher=vi.fn(async()=>new Response('{}',{status:code,headers:{'Retry-After':'2'}})),wait=vi.fn(async(_ms:number)=>{});
  const reader=new GoogleAdsReader({accessToken:'test',version:'v26'},new ReadGate(0,fetcher),wait);
  await expect(reader.accountBudgets('1234567890')).rejects.toMatchObject({status:code});expect(fetcher).toHaveBeenCalledTimes(code===403?1:3);
  if(code!==403)expect(wait.mock.calls[0][0]).toBeGreaterThanOrEqual(2000);
 }
 const fetcher=vi.fn(async()=>{throw new DOMException('timeout','TimeoutError');}),wait=vi.fn(async()=>{});
 await expect(new GoogleAdsReader({accessToken:'test',version:'v26'},new ReadGate(0,fetcher),wait).accountBudgets('1234567890')).rejects.toThrow('timeout');expect(fetcher).toHaveBeenCalledTimes(3);
});
it('um Retry-After longo devolve o controle sem fazer uma consulta antecipada',async()=>{
 const fetcher=vi.fn(async()=>new Response('{}',{status:429,headers:{'Retry-After':'120'}})),wait=vi.fn(async()=>{});
 await expect(new GoogleAdsReader({accessToken:'test',version:'v26'},new ReadGate(0,fetcher),wait).accountBudgets('1234567890')).rejects.toMatchObject({retryAfterMs:120000});expect(fetcher).toHaveBeenCalledOnce();expect(wait).not.toHaveBeenCalled();
});
