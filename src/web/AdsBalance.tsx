import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Wallet,TriangleAlert,RefreshCw,Clock3} from 'lucide-react';
import {getJson,sendJson} from './api';
import {Modal,displayDate} from './AgentPerformance';
import type {BudgetReport} from '../server/budget-service';
import type {BudgetLimits} from '../server/account-budget';
import './ads-balance.css';

const stateLabels={available:'Disponível',unlimited:'Ilimitado',unavailable:'Indisponível',pending:'Consultando…',error:'Falha na consulta'};
const alertLabels={normal:'Dentro dos limites',attention:'Atenção',urgent:'Urgente',exhausted:'Orçamento esgotado'};
function currencyValue(value:string|null|undefined,currency:string|null|undefined){
 if(value==null||!currency)return '—';
 // Intl receives an exact decimal string at runtime; do not coerce micros to Number.
 return new Intl.NumberFormat('pt-BR',{style:'currency',currency}).format(value as unknown as number);
}
function localTime(value:string|null|undefined){if(!value)return 'Sem término';const [d,t]=value.split(' ');return d.split('-').reverse().join('/')+' '+t.slice(0,5);}
export function AdsBalance({alertsOnly=false}:{alertsOnly?:boolean}){
 const qc=useQueryClient(),[open,setOpen]=useState(false);
 const query=useQuery({queryKey:['ads-balance'],queryFn:({signal})=>getJson<BudgetReport>('/ads/balance',signal),refetchInterval:q=>q.state.data?.status==='pending'?5000:60_000,staleTime:30_000});
 const refresh=useMutation({mutationFn:()=>sendJson<{status:string;nextAttemptAt?:string}>('/ads/balance/sync','POST',{force:true}),onSuccess:()=>{void qc.invalidateQueries({queryKey:['ads-balance']});}});
 const limits=useMutation({mutationFn:(body:BudgetLimits)=>sendJson('/ads/balance/limits','PUT',body),onSuccess:()=>{void qc.invalidateQueries({queryKey:['ads-balance']});}});
 const data=query.data,money=(value:string|null|undefined)=>currencyValue(value,data?.currency),busy=data?.status==='pending'||refresh.isPending;
 const cooldown=data?.nextAttemptAt?Date.parse(data.nextAttemptAt)>Date.now():false;
 const state=data?.status??'pending',alert=data?.alert,label=query.error?'Falha ao consultar':data?.stale&&(state==='available'||state==='unlimited')?'Leitura desatualizada':alert?alertLabels[alert]:stateLabels[state];
 const tone=data?.stale?'stale':alert==='urgent'||alert==='exhausted'?'critical':alert==='attention'?'warning':state==='available'?'ok':state==='error'?'error':'neutral';
 const value=state==='available'?money(data?.remaining):stateLabels[state];
 if(alertsOnly&&!open&&!query.error&&!(['error','unavailable'].includes(state)||data?.stale||(alert&&alert!=='normal')))return null;
 return <><section className={'balance-strip balance-'+tone} aria-label="Orçamento de conta restante do Google Ads"><Wallet size={21}/><div><span>Orçamento de conta restante</span><strong className={state==='available'?'':'budget-status-value'}>{query.error?'Indisponível':value}</strong></div><span className="balance-status">{alert&&alert!=='normal'&&<TriangleAlert size={14}/>} {label}</span>{data?.forecast.days!=null&&<span className="balance-days">≈ {new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(data.forecast.days)} dias estimados</span>}<span className="budget-updated"><Clock3 size={12}/>{data?.lastSuccessAt?displayDate(data.lastSuccessAt):'Sem leitura concluída'}</span><button className="quiet-button" onClick={()=>setOpen(true)}>Ver orçamento</button></section>
 {open&&<Modal title="Orçamento da conta · Google Ads" onClose={()=>setOpen(false)}>
 <div className="budget-modal-heading"><span className={'balance-status balance-'+tone}>{label}</span><button className="budget-refresh" disabled={busy||cooldown} onClick={()=>refresh.mutate()}><RefreshCw size={14} className={busy?'spinning':''}/>{busy?'Consultando…':'Atualizar orçamento'}</button></div>
 <p className="balance-explanation">Orçamento aprovado para uma vigência da conta. Não é o orçamento diário das campanhas nem, necessariamente, o saldo financeiro pré-pago.</p>
 {query.error&&<p role="alert">Não foi possível carregar a leitura armazenada.</p>}
 {data&&<>
 <div className="agent-detail-kpis budget-amounts"><article><span>Limite ajustado</span><strong>{state==='unlimited'?'Ilimitado':money(data.limit)}</strong></article><article><span>Anúncios veiculados</span><strong>{money(data.served)}</strong></article><article><span>Orçamento restante</span><strong>{state==='unlimited'?'Ilimitado':money(data.remaining)}</strong></article></div>
 <div className="budget-message" role={state==='error'?'alert':undefined}>{data.reason}{data.stale&&(state==='available'||state==='unlimited')&&<p>A leitura tem mais de uma hora. Alertas e previsão ficam suspensos até a atualização.</p>}</div>
 <dl className="budget-facts"><div><dt>Conta Google Ads</dt><dd>{data.customerId||'—'}</dd></div><div><dt>Orçamento</dt><dd>{data.budgetId||'—'}</dd></div><div><dt>Vigência · {data.timezone||'fuso indisponível'}</dt><dd>{data.start?localTime(data.start):'—'} → {data.budgetId?localTime(data.end):'—'}</dd></div><div><dt>Última leitura bem-sucedida</dt><dd>{displayDate(data.lastSuccessAt)}</dd></div><div><dt>Última tentativa</dt><dd>{displayDate(data.lastAttemptAt)}</dd></div></dl>
 {data.previousReading&&<div className="budget-previous"><b>Leitura anterior · {displayDate(data.previousReading.asOf)}</b><span>{data.previousReading.status==='unlimited'?'Ilimitado':currencyValue(data.previousReading.remaining,data.previousReading.currency)}</span><small>Referência histórica; não representa uma confirmação do orçamento atual.</small></div>}
 <div className="budget-forecast"><div><span>Média diária · 7 dias completos</span><b>{money(data.forecast.averageDaily)}</b></div><div><span>Duração estimada</span><b>{data.forecast.days===null?'Indisponível':new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(data.forecast.days)+' dias'}</b></div><small>{data.forecast.reason}</small></div>
 {refresh.error&&<p role="alert">{refresh.error.message}</p>}{refresh.data?.status==='cooldown'&&<p className="service-meta">Aguarde até {displayDate(refresh.data.nextAttemptAt)} para consultar novamente.</p>}
 <details className="service-method"><summary>Limites dos alertas</summary><form className="balance-form" key={JSON.stringify(data.limits)} onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);limits.mutate({urgentCents:Math.round(Number(f.get('urgent'))*100),attentionCents:Math.round(Number(f.get('attention'))*100),urgentDays:Number(f.get('urgentDays')),attentionDays:Number(f.get('attentionDays'))});}}>
 <label>Urgente até ({data.currency??'moeda da conta'})<input name="urgent" type="number" min="0" max="1000000" step="0.01" defaultValue={data.limits.urgentCents/100} required/></label><label>Atenção até ({data.currency??'moeda da conta'})<input name="attention" type="number" min="0" max="1000000" step="0.01" defaultValue={data.limits.attentionCents/100} required/></label><label>Urgente até (dias)<input name="urgentDays" type="number" min="0" max="365" step="0.5" defaultValue={data.limits.urgentDays} required/></label><label>Atenção até (dias)<input name="attentionDays" type="number" min="0" max="365" step="0.5" defaultValue={data.limits.attentionDays} required/></label><button disabled={limits.isPending||!data.customerId}>Salvar limites</button></form>{limits.error&&<p role="alert">{limits.error.message}</p>}{limits.isSuccess&&<p role="status">Limites salvos.</p>}<p>Restante zero significa orçamento esgotado. Os alertas usam valor ou duração estimada e não comprovam necessidade de recarga.</p></details>
 <details className="service-method"><summary>Como a leitura funciona</summary><p>O Google fornece o limite ajustado e o valor veiculado. A diferença é calculada em micros, com mínimo zero. Os gastos das campanhas não são descontados novamente. O recurso depende de faturamento mensal e da disponibilidade de dados na conta.</p><p>Atualização em segundo plano a cada 15 minutos, com intervalo mínimo de 30 segundos para solicitações manuais. Abrir esta tela consulta apenas a leitura armazenada.</p></details>
 </>}
 </Modal>}
 </>;
}
