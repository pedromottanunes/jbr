import {useEffect,useSyncExternalStore} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {validPeriod,type Period} from '../shared/period';
const key='jbr-report-period-v1';
let selected:Period|null=null;
try{const saved=JSON.parse(localStorage.getItem(key)??'null');if(validPeriod(saved))selected=saved;}catch{/* Storage can be unavailable. */}
const listeners=new Set<()=>void>();
export function setPeriod(p:Period){if(!validPeriod(p))return;if(selected?.start===p.start&&selected.end===p.end)return;selected=p;try{localStorage.setItem(key,JSON.stringify(p));}catch{}listeners.forEach(fn=>fn());}
if(typeof window!=='undefined')window.addEventListener('storage',e=>{if(e.key!==key)return;try{const p=JSON.parse(e.newValue??'null');if(validPeriod(p)){selected=p;listeners.forEach(fn=>fn());}}catch{}});
export function usePeriod(fallback?:Period){
 const period=useSyncExternalStore(fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},()=>selected,()=>null);
 useEffect(()=>{if(!selected&&fallback&&validPeriod(fallback))setPeriod(fallback);},[fallback?.start,fallback?.end]);
 return [period,setPeriod] as const;
}
type Sync={status:'idle'|'running'|'complete'|'error';period?:Period;message?:string};
export function useGoogleCoverage(period:Period|undefined,available:boolean|undefined){
 const client=useQueryClient();const missing=validPeriod(period)&&available===false;
 const query=useQuery({queryKey:['google-period-sync',period?.start,period?.end],enabled:missing,staleTime:0,retry:false,
  queryFn:async({signal}):Promise<Sync>=>{const response=await fetch('/api/v1/ads/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(period),signal});const result=await response.json();if(!response.ok)throw new Error(result.message??'Não foi possível carregar o período.');return result;},
  refetchInterval:q=>q.state.data?.status==='running'?4000:false});
 useEffect(()=>{if(missing&&query.data?.status==='complete'){void client.invalidateQueries({queryKey:['real-funnel']});void client.invalidateQueries({queryKey:['ads-detail']});void client.invalidateQueries({queryKey:['ads-crm']});}},[missing,query.dataUpdatedAt,client]);
 return missing?(query.error?.message??(query.data?.status==='error'?query.data.message:'Sincronizando Google Ads para o período selecionado…')):null;
}

export const readSelectedPeriod=()=>selected;
export function validatePeriodForm(form:HTMLFormElement,period:unknown){
 const end=form.querySelector<HTMLInputElement>('input[aria-label="Data final"]');
 if(!end)return false;
 end.setCustomValidity(validPeriod(period)?'':'Selecione um período válido de até 366 dias.');
 return form.reportValidity();
}
