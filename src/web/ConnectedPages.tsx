import { useDeferredValue, useEffect, useState, type ReactNode } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import {GoogleAdsMark,HeadingIcon} from './Presentation';
import {Attendance} from './Attendance';
import { useSearchParams } from 'react-router-dom';
import { getJson, formatNumber, formatMoney } from './api';

type Totals={contacts:number;conversations:number;messages:number;conversationsWithMessages:number;googleIndicated:number};
type Sync={status:string;checkedAt?:string;from?:string;until?:string;completedChats?:number;candidateChats?:number;requests?:number};
export type Status={mode:string;publishedAt?:string;sync?:Sync;totals?:Totals;googleAds?:{connected:boolean}};
type RealAds={connected:boolean;period?:{start:string;end:string};syncedAt?:string;campaigns:{id:string;name:string;clicks:number;impressions:number;spend:number;conversions:number}[];metrics:{clicks:number;impressions:number;spend:number;conversions:number}|null};
type Contact={id:string;label:string;phone:string|null;firstInboundAt:string|null;source:string};
type Chat={id:string;contactId:string;label:string;at:string;phone:string|null;messageCount:number;isOpen:number};
type Message={id:string;at:string;author:string;incoming:number;content:string;kind:string;private:number};
type Detail={chat:{label:string;phone:string|null;source:string;limited:number;message_count:number};focusMessage?:Message|null;messages:Message[];nextCursor:string|null};
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
 const [search,setSearch]=useState('');const q=useDeferredValue(search);
 const query=useInfiniteQuery({queryKey:['real-contacts',q,status.publishedAt],initialPageParam:0,queryFn:({pageParam,signal})=>getJson<Page<Contact>>(`/contacts?q=${encodeURIComponent(q)}&cursor=${pageParam}`,signal),getNextPageParam:last=>last.nextCursor??undefined});
 const contacts=query.data?.pages.flatMap(p=>p.items)??[];
 return <><Title title="Leads" status={status}><SearchBox value={search} onChange={setSearch}/><span>{formatNumber(query.data?.pages[0].total??0)} contatos</span></Title><State pending={query.isPending} error={query.error}/>{query.data&&<section className="panel table-panel"><div className="table-scroll"><table><thead><tr><th>Contato</th><th>Telefone</th><th>Primeira entrada conhecida</th><th>Origem indicada</th></tr></thead><tbody>{contacts.map(c=><tr key={c.id}><td><span className="contact-name">{c.label}</span></td><td>{c.phone??'—'}</td><td>{date(c.firstInboundAt)}</td><td><span className="source-pill">{c.source}</span></td></tr>)}</tbody></table></div>{contacts.length===0&&<div className="state">Nenhum contato encontrado.</div>}<More hasNext={query.hasNextPage} pending={query.isFetchingNextPage} onClick={()=>void query.fetchNextPage()}/></section>}</>;
}

export function ConnectedConversations({status}:{status:Status}) {
 const [urlParams]=useSearchParams();
 const [view,setView]=useState<'dashboard'|'conversations'>(()=>urlParams.has('chat')?'conversations':'dashboard');
 const [periodTarget,setPeriodTarget]=useState<HTMLDivElement|null>(null),[noticeTarget,setNoticeTarget]=useState<HTMLDivElement|null>(null);
 const [search,setSearch]=useState('');const q=useDeferredValue(search);const [selected,setSelected]=useState<string|null>(null);
 useEffect(()=>{if(urlParams.has('chat')){setView('conversations');setSelected(null);}},[urlParams]);
 const list=useInfiniteQuery({queryKey:['real-chats',q,status.publishedAt],enabled:view==='conversations',initialPageParam:0,queryFn:({pageParam,signal})=>getJson<Page<Chat>>(`/conversations?q=${encodeURIComponent(q)}&cursor=${pageParam}`,signal),getNextPageParam:last=>last.nextCursor??undefined});
 const chats=list.data?.pages.flatMap(p=>p.items)??[];
 const id=selected??urlParams.get('chat')??chats[0]?.id;
 const focused=id===urlParams.get('chat')?urlParams.get('message'):null;
 const detail=useInfiniteQuery({queryKey:['real-messages',id,focused,status.publishedAt],enabled:!!id&&view==='conversations',initialPageParam:'',queryFn:({pageParam,signal})=>getJson<Detail>(`/conversations/${encodeURIComponent(id!)}?${new URLSearchParams({...pageParam?{before:pageParam}:{},...focused?{message:focused}:{}})}`,signal),getNextPageParam:last=>last.nextCursor??undefined});
 const d=detail.data?.pages[0];const messages=detail.data?.pages.slice().reverse().flatMap(p=>p.messages)??[];
 return <><Title title="Conversas" status={status} headerNotice={<div ref={setNoticeTarget} className="attendance-notice-slot"/>}>{view==='dashboard'?<div ref={setPeriodTarget} className="attendance-period-slot"/>:<SearchBox value={search} onChange={setSearch}/>}<span className="read-only">Somente leitura</span></Title><div className="conversation-tabs" role="tablist" aria-label="Área de conversas"><button role="tab" aria-selected={view==='dashboard'} onClick={()=>setView('dashboard')}>Indicadores</button><button role="tab" aria-selected={view==='conversations'} onClick={()=>setView('conversations')}>Conversas</button></div>{view==='dashboard'?<Attendance status={status} periodTarget={periodTarget} noticeTarget={noticeTarget}/>:<><State pending={list.isPending} error={list.error}/>{list.data&&<div className="conversation-layout real-conversations"><aside className="conversation-list"><div className="list-top">Conversas <span>{formatNumber(list.data.pages[0].total)}</span></div>{chats.map(c=><button type="button" className={`conversation-item ${c.id===id?'active':''}`} key={c.id} onClick={()=>setSelected(c.id)}><span className="avatar">{c.label.slice(0,1).toUpperCase()}</span><span><b>{c.label}</b><small>{date(c.at)}</small><small>{c.messageCount?`${formatNumber(c.messageCount)} mensagens`:'Mensagens pendentes'}</small></span></button>)}<More hasNext={list.hasNextPage} pending={list.isFetchingNextPage} onClick={()=>void list.fetchNextPage()}/></aside>
 <section className="chat">{id?<><State pending={detail.isPending} error={detail.error}/>{d&&<><div className="chat-header"><div><strong>{d.chat.label}</strong><small>{d.chat.phone??'Telefone não informado'}</small></div></div>{d.focusMessage&&<div className="focused-message"><b>Mensagem vinculada ao funil</b><p>{d.focusMessage.content}</p><time>{date(d.focusMessage.at)}</time></div>}<div className="chat-body" key={id}><More hasNext={detail.hasNextPage} pending={detail.isFetchingNextPage} onClick={()=>void detail.fetchNextPage()}/>{messages.map(m=><div key={m.id} className={`bubble ${m.incoming?'':'agent'}`}><span className="bubble-author">{m.author}{m.private?' · Nota interna':''}</span><p>{m.content}</p><time>{date(m.at)}</time></div>)}{messages.length===0&&<div className="state">As mensagens desta conversa ainda não foram coletadas.</div>}</div><div className="chat-bottom">{d.chat.limited?'Histórico parcial':'Histórico disponível coletado'}</div></>}</>:<div className="state">Nenhuma conversa encontrada.</div>}</section>
 <aside className="contact-side"><h2>Contato</h2>{d&&<dl><dt>Telefone</dt><dd>{d.chat.phone??'—'}</dd><dt>Origem indicada</dt><dd>{d.chat.source}</dd><dt>Mensagens salvas</dt><dd>{formatNumber(d.chat.message_count)}</dd><dt>Campanha</dt><dd>Não identificada</dd></dl>}</aside></div>}</>}</>;
}

export function ConnectedReports({status}:{status:Status}) {return <><Title title="Relatórios" status={status}/><section className="panel settings"><h2><HeadingIcon label="Cobertura da coleta"/>Cobertura da coleta</h2><dl><dt>Contatos registrados</dt><dd>{formatNumber(status.totals?.contacts??0)}</dd><dt>Mensagens disponíveis</dt><dd>{formatNumber(status.totals?.messages??0)}</dd><dt>Janela de atualização</dt><dd>{date(status.sync?.from)} a {date(status.sync?.until)}</dd><dt>Conversas coletadas na janela</dt><dd>{status.sync?.completedChats??'—'} / {status.sync?.candidateChats??'—'}</dd><dt>Última execução</dt><dd>{stateLabel(status.sync)}</dd></dl><p className="small-note">Qualificação, propostas e vendas dependem da classificação dos contatos. Esses resultados ainda não estão consolidados.</p></section></>;}

export function ConnectedSettings({status}:{status:Status}) {return <><Title title="Configurações" status={status}/><section className="panel settings"><h2><HeadingIcon label="Integrações"/>Integrações</h2><dl><dt>Ambiente</dt><dd>Local · dados reais</dd><dt>Umbler Talk</dt><dd>Somente leitura</dd><dt>Última coleta</dt><dd>{date(status.sync?.checkedAt)}</dd><dt>Status</dt><dd>{stateLabel(status.sync)}</dd><dt className="google-brand"><GoogleAdsMark/>Google Ads</dt><dd>{status.googleAds?.connected?'Dados sincronizados':'Aguardando sincronização'}</dd><dt>Sincronização automática</dt><dd>Desativada</dd></dl></section></>;}
