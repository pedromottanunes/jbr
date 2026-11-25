import {useEffect,useSyncExternalStore} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {validPeriod,type Period} from '../shared/period';
import {getJson,sendJson} from './api';
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
type Sync={status:'idle'|'running'|'complete'|'error';period?:Period;message?:string;completedAt?:string;revision?:number};
export function useGoogleCoverage(period:Period|undefined,available:boolean|undefined){
 const client=useQueryClient();const missing=validPeriod(period)&&available===false;
 // A POST queues once per selected period; polling only reads job state.
 // The shared query promise also prevents React StrictMode from queuing twice.
 const request=useQuery({queryKey:['google-period-sync',period?.start,period?.end],enabled:missing,staleTime:Infinity,retry:false,refetchOnMount:false,
  queryFn:()=>sendJson<Sync>('/ads/sync','POST',period)});
 const poll=useQuery({queryKey:['google-sync-status',period?.start,period?.end,request.dataUpdatedAt],enabled:missing&&request.data?.status==='running',retry:false,
  queryFn:({signal})=>getJson<Sync>('/ads/sync',signal),refetchInterval:q=>q.state.data?.status==='complete'||q.state.data?.status==='error'?false:5000});
 const state=request.data?.status==='running'?poll.data:request.data;
 useEffect(()=>{if(missing&&state?.status==='complete'){void client.invalidateQueries({queryKey:['real-funnel']});void client.invalidateQueries({queryKey:['ads-detail']});void client.invalidateQueries({queryKey:['ads-crm']});}},[missing,state?.status,state?.completedAt,client]);
 return missing?{
  message:request.error?.message??poll.error?.message??(state?.status==='error'?state.message:'Sincronizando Google Ads para o período selecionado…'),
  failed:!!request.error||!!poll.error||state?.status==='error',
  retry:()=>{void request.refetch();},
 }:null;
}

export const readSelectedPeriod=()=>selected;
export function validatePeriodForm(form:HTMLFormElement,period:unknown){
 const end=form.querySelector<HTMLInputElement>('input[aria-label="Data final"]');
 if(!end)return false;
 end.setCustomValidity(validPeriod(period)?'':'Selecione um período válido de até 366 dias.');
 return form.reportValidity();
}
