import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Database} from 'lucide-react';
import {getJson,sendJson} from './api';

type Policy={storeContent:boolean;revision:number;purgeStatus:string;purgedAt:string|null};
export function MessageStorageSettings(){
 const client=useQueryClient();
 const query=useQuery({queryKey:['message-storage'],queryFn:({signal})=>getJson<Policy>('/settings/message-storage',signal),refetchInterval:q=>['running','pending'].includes(q.state.data?.purgeStatus??'')?3000:false});
 const save=useMutation({mutationFn:(storeContent:boolean)=>sendJson<Policy>('/settings/message-storage','PUT',{storeContent,revision:query.data!.revision}),onSuccess:async policy=>{
  client.removeQueries({queryKey:['real-messages']});client.setQueryData(['message-storage'],policy);await client.invalidateQueries();
 }});
 const policy=query.data,cleaning=policy&&!policy.storeContent&&policy.purgeStatus!=='complete';
 return <section className="panel settings"><h2><Database size={19} aria-hidden="true"/> Conteúdo das conversas</h2>
  <label style={{display:'flex',alignItems:'center',gap:12,cursor:'pointer',margin:'18px 0 10px'}}>
   <input type="checkbox" role="switch" checked={policy?.storeContent??false} disabled={!policy||save.isPending||!!cleaning} onChange={e=>save.mutate(e.target.checked)} style={{width:20,height:20,accentColor:'var(--green, #006c4c)'}}/>
   <strong>Armazenar conteúdo das mensagens</strong><span className="read-only">{policy?.storeContent?'Habilitado':'Desabilitado'}</span>
  </label>
  <p className="small-note">Os indicadores, CTAs e tempos de atendimento são preservados. Ao habilitar, o CRM também guarda o conteúdo coletado nas próximas sincronizações. Desabilitar remove os textos e anexos já armazenados.</p>
  <p className="small-note" role="status">{query.isPending?'Carregando configuração…':save.isPending?'Salvando…':cleaning?'Removendo conteúdo armazenado. Os indicadores continuam disponíveis.':policy&&!policy.storeContent?'Somente informações de atendimento são armazenadas.':'O conteúdo removido anteriormente não é recuperado ao habilitar.'}</p>
  {(query.error||save.error)&&<p className="error" role="alert">{(query.error??save.error)?.message}</p>}
 </section>;
}
