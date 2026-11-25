import {createContext,useContext,useEffect,useRef,type ReactNode} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {RefreshCw,Clock3,CircleAlert,Check} from 'lucide-react';
import {usePeriod} from './usePeriod';
import {getJson,sendJson} from './api';
import './attendance-sync.css';

type Sync={status:string;publishedAt?:string;completedAt?:string;nextAttemptAt?:string;message?:string;missingDays?:number};
const Context=createContext<{state?:Sync;error?:string}|null>(null);
export function AttendanceSyncProvider({mode,enabled,children}:{mode:string;enabled:boolean;children:ReactNode}){
 const [period]=usePeriod(),client=useQueryClient(),lastPublication=useRef<string|undefined>(undefined);
 const active=mode==='mongo'&&enabled&&!!period;
 // Automatic POSTs only ask the coordinator to fill missing/stale coverage.
 // Deduplication and cooldowns are persisted on the server across tabs/restarts.
 const ensure=useQuery({queryKey:['attendance-period-ensure',period?.start,period?.end],enabled:active,retry:false,staleTime:60_000,refetchInterval:60_000,
  queryFn:()=>sendJson<Sync>('/attendance/ensure','POST',period)});
 const poll=useQuery({queryKey:['attendance-sync'],enabled:mode==='mongo',queryFn:({signal})=>getJson<Sync>('/attendance/sync',signal),retry:false,
  refetchInterval:q=>q.state.data?.status==='running'?5000:60_000});
 useEffect(()=>{if(ensure.data?.status==='running')void client.invalidateQueries({queryKey:['attendance-sync']});},[ensure.dataUpdatedAt,client]);
 const version=poll.data?.publishedAt??(poll.data?.status==='complete'?poll.data.completedAt:undefined);
 useEffect(()=>{
  if(!version||lastPublication.current===version)return;lastPublication.current=version;
  // Date/version keyed screens reload from the new status; only the agent
  // report needs explicit invalidation because its key is period-only.
  void client.invalidateQueries({queryKey:['status']});void client.invalidateQueries({queryKey:['agent-performance']});
  if(active)void client.invalidateQueries({queryKey:['attendance-period-ensure']});
 },[version,client,active]);
 const state=ensure.data?.status==='current'||ensure.data?.status==='disabled'?ensure.data:poll.data?.status==='running'||poll.data?.status==='error'?poll.data:ensure.data;
 return <Context.Provider value={active?{state,error:ensure.error?.message??poll.error?.message}:null}>{children}</Context.Provider>;
}
export function AttendanceSyncBadge(){
 const sync=useContext(Context);if(!sync)return null;
 const {state,error}=sync,running=state?.status==='running',failed=!!error||state?.status==='error',disabled=state?.status==='disabled';
 const label=failed?'Atualização interrompida':disabled?'Atualização desativada':running?'Analisando período':state?.status==='current'?'Período verificado':'Verificando período';
 const Icon=failed?CircleAlert:running?RefreshCw:state?.status==='current'?Check:Clock3;
 const detail=error??state?.message??(running?'Os dados já analisados continuam disponíveis. A coleta segue em segundo plano.':disabled?'Integrações desativadas. Exibindo a última análise disponível.':'Conferência da cobertura e atualização das conversas. O conteúdo das mensagens não é exibido.');
 return <span className={'attendance-sync-badge '+(failed?'sync-error':running?'sync-running':'')} title={detail} role="status"><Icon size={13} className={running?'spinning':''}/>{label}</span>;
}
