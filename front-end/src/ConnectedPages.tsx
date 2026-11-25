import {useDebouncedValue} from './useDebouncedValue';
import { useState, type ReactNode } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import {GoogleAdsMark,HeadingIcon} from './Presentation';
import {Attendance} from './Attendance';
import {AttendanceSyncBadge} from './AttendanceSync';
import { Navigate, useSearchParams } from 'react-router-dom';
import { getJson, formatNumber, formatMoney } from './api';

type Totals={contacts:number;conversations:number;messages:number;conversationsWithMessages:number;googleIndicated:number};
type Sync={status:string;checkedAt?:string;from?:string;until?:string;completedChats?:number;candidateChats?:number;requests?:number};
export type Status={mode:string;publishedAt?:string;sync?:Sync;totals?:Totals;googleAds?:{connected:boolean}};
type RealAds={connected:boolean;period?:{start:string;end:string};syncedAt?:string;campaigns:{id:string;name:string;clicks:number;impressions:number;spend:number;conversions:number}[];metrics:{clicks:number;impressions:number;spend:number;conversions:number}|null};
type Contact={id:string;label:string;phone:string|null;firstInboundAt:string|null;source:string};
type Page<T>={items:T[];total:number;nextCursor:number|null};
const date=(value?:string|null)=>value?new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}):'—';
const stateLabel=(s?:Sync)=>s?.status==='complete'?'Atualizado':s?.status==='running'?'Coletando':s?.status==='partial'?'Coleta parcial':s?.status==='error'?'Coleta interrompida':'Histórico importado';
function Title({title,status,children,headerNotice}:{title:string;status:Status;children?:ReactNode;headerNotice?:ReactNode}) { return <header className="page-header compact-header"><h1>{title}</h1>{children&&<div className="header-tools">{children}</div>}<div className="header-right">{headerNotice}<span className="period">{date(status.publishedAt)}</span><span className="demo-badge">{stateLabel(status.sync)}</span></div></header>; }
function State({pending,error}:{pending:boolean;error:Error|null}) { return pending?<div className="state">Carregando…</div>:error?<div className="state error" role="alert">{error.message}</div>:null; }
function Kpi({label,value}:{label:string;value:number}) {return <article className="kpi"><span>{label}</span><strong>{formatNumber(value)}</strong></article>;}
function SearchBox({value,onChange}:{value:string;onChange:(v:string)=>void}) {return <label className="search"><Search size={18}/><input aria-label="Buscar por nome ou telefone" placeholder="Nome ou telefone" value={value} onChange={e=>onChange(e.target.value)}/></label>;}
function More({hasNext,pending,onClick}:{hasNext:boolean;pending:boolean;onClick:()=>void}) {return hasNext?<button className="load-more" disabled={pending} onClick={onClick}>{pending?'Carregando…':'Carregar mais'}</button>:null;}

export function ConnectedAds({status}:{status:Status}) {
 const q=useQuery({queryKey:['real-ads'],queryFn:({signal})=>getJson<RealAds>('/ads',signal),refetchInterval:60_000});
 const d=q.data;const m=d?.metrics;
 return <><Title title="Tráfego pago" status={status}/><State pending={q.isPending} error={q.error}/>{d&&!d.connected&&<section className="panel"><div className="state">Aguardando sincronização Google Ads.</div></section>}{d?.connected&&m&&<>
 <div className="toolbar"><span>Período: {d.period?.start.split('-').reverse().join('/')} a {d.period?.end.split('-').reverse().join('/')}</span><span>Atualizado em {date(d.syncedAt)}</span></div>
 <section className="kpis"><article className="kpi"><span>Investimento</span><strong>{formatMoney(m.spend)}</strong></article><Kpi label="Impressões" value={m.impressions}/><Kpi label="Cliques" value={m.clicks}/><Kpi label="Conversões" value={m.conversions}/></section>
 <section className="panel table-panel"><h2>Campanhas</h2><div className="table-scroll"><table><thead><tr><th>Campanha</th><th>Impressões</th><th>Cliques</th><th>Investimento</th><th>Conversões</th></tr></thead><tbody>{d.campaigns.map(c=><tr key={c.id}><td>{c.name}</td><td>{formatNumber(c.impressions)}</td><td>{formatNumber(c.clicks)}</td><td>{formatMoney(c.spend)}</td><td>{formatNumber(c.conversions)}</td></tr>)}</tbody></table></div>{d.campaigns.length===0&&<div className="state">Nenhuma campanha no período.</div>}</section><div className="footline">Conversões do Google Ads por data da interação. Fuso de referência da coleta: São Paulo.</div></>}</>;
}

export function ConnectedLeads({status}:{status:Status}) {
 const [search,setSearch]=useState('');const q=useDebouncedValue(search);
 const query=useInfiniteQuery({queryKey:['real-contacts',q,status.publishedAt],initialPageParam:0,queryFn:({pageParam,signal})=>getJson<Page<Contact>>(`/contacts?q=${encodeURIComponent(q)}&cursor=${pageParam}`,signal),getNextPageParam:last=>last.nextCursor??undefined});
 const contacts=query.data?.pages.flatMap(p=>p.items)??[];
 return <><Title title="Leads" status={status}><SearchBox value={search} onChange={setSearch}/><span>{formatNumber(query.data?.pages[0].total??0)} contatos</span></Title><State pending={query.isPending} error={query.error}/>{query.data&&<section className="panel table-panel"><div className="table-scroll"><table><thead><tr><th>Contato</th><th>Telefone</th><th>Primeira entrada conhecida</th><th>Origem indicada</th></tr></thead><tbody>{contacts.map(c=><tr key={c.id}><td><span className="contact-name">{c.label}</span></td><td>{c.phone??'—'}</td><td>{date(c.firstInboundAt)}</td><td><span className="source-pill">{c.source}</span></td></tr>)}</tbody></table></div>{contacts.length===0&&<div className="state">Nenhum contato encontrado.</div>}<More hasNext={query.hasNextPage} pending={query.isFetchingNextPage} onClick={()=>void query.fetchNextPage()}/></section>}</>;
}

export function ConnectedConversations({status}:{status:Status}) {
 const [urlParams]=useSearchParams();
 const [periodTarget,setPeriodTarget]=useState<HTMLDivElement|null>(null),[noticeTarget,setNoticeTarget]=useState<HTMLDivElement|null>(null);
 // Old bookmarked message links now open the lead's analytical record.
 const chatId=urlParams.get('chat');
 if(chatId)return <Navigate to={'/leads?'+new URLSearchParams({chat:chatId})} replace/>;
 return <><Title title="Conversas" status={status} headerNotice={<><AttendanceSyncBadge/><div ref={setNoticeTarget} className="attendance-notice-slot"/></>}><div ref={setPeriodTarget} className="attendance-period-slot"/><span className="read-only">Somente leitura</span></Title><Attendance status={status} periodTarget={periodTarget} noticeTarget={noticeTarget}/></>;
}

export function ConnectedReports({status}:{status:Status}) {return <><Title title="Relatórios" status={status}/><section className="panel settings"><h2><HeadingIcon label="Cobertura da coleta"/>Cobertura da coleta</h2><dl><dt>Contatos registrados</dt><dd>{formatNumber(status.totals?.contacts??0)}</dd><dt>Eventos analisados</dt><dd>{formatNumber(status.totals?.messages??0)}</dd><dt>Janela de atualização</dt><dd>{date(status.sync?.from)} a {date(status.sync?.until)}</dd><dt>Conversas coletadas na janela</dt><dd>{status.sync?.completedChats??'—'} / {status.sync?.candidateChats??'—'}</dd><dt>Última execução</dt><dd>{stateLabel(status.sync)}</dd></dl><p className="small-note">Qualificação, propostas e vendas dependem da classificação dos contatos. Esses resultados ainda não estão consolidados.</p></section></>;}

export function ConnectedSettings({status}:{status:Status}) {return <><Title title="Configurações" status={status}/><section className="panel settings"><h2><HeadingIcon label="Integrações"/>Integrações</h2><dl><dt>Ambiente</dt><dd>Local · dados reais</dd><dt>Banco de dados</dt><dd>{status.mode==='mongo'?'MongoDB Atlas':'SQLite local'}</dd><dt>Umbler Talk</dt><dd>Somente leitura</dd><dt>Última coleta</dt><dd>{date(status.sync?.checkedAt)}</dd><dt>Status</dt><dd>{stateLabel(status.sync)}</dd><dt className="google-brand"><GoogleAdsMark/>Google Ads</dt><dd>{status.googleAds?.connected?'Dados sincronizados':'Aguardando sincronização'}</dd><dt>Sincronização automática</dt><dd>Desativada</dd></dl></section></>;}
