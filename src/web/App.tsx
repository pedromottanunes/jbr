import { useState, useDeferredValue } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChartNoAxesCombined, CircleHelp, LayoutDashboard, ChartColumnIncreasing, Menu, MessagesSquare, Search, Settings2, ContactRound, X } from 'lucide-react';
import { type Ads, type ContactPage, type Conversation, type Overview, formatMoney, formatNumber, getJson } from './api';
import { type Status, ConnectedConversations, ConnectedReports, ConnectedSettings } from './ConnectedPages';
import { Leads } from './Leads';
import { PaidTraffic } from './PaidTraffic';
import { FunnelOverview as ConnectedOverview } from './FunnelOverview';

const nav = [
  { to: '/', label: 'Visão geral', icon: LayoutDashboard },
  { to: '/trafego', label: 'Tráfego pago', icon: ChartNoAxesCombined },
  { to: '/conversas', label: 'Conversas', icon: MessagesSquare },
  { to: '/leads', label: 'Leads', icon: ContactRound },
  { to: '/relatorios', label: 'Relatórios', icon: ChartColumnIncreasing },
  { to: '/configuracoes', label: 'Configurações', icon: Settings2 }
];

function QueryState({ isPending, error, children }: { isPending: boolean; error: Error | null; children: React.ReactNode }) {
  if (isPending) return <div className="state">Carregando dados…</div>;
  if (error) return <div className="state error" role="alert">{error.message}</div>;
  return <>{children}</>;
}

function Header({ title, period }: { title: string; period?: string }) {
  return <header className="page-header"><h1>{title}</h1><div className="header-right"><span className="period">{period ?? '01 a 23 out 2026'}</span><span className="demo-badge">Histórico</span></div></header>;
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <article className="kpi"><span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</article>;
}

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  return <div className="bar-row"><span>{label}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(2, value / max * 100)}%` }} /></div><b>{formatNumber(value)}</b></div>;
}

function OverviewPage() {
  const query = useQuery({ queryKey: ['overview'], queryFn: ({ signal }) => getJson<Overview>('/overview', signal) });
  const d = query.data;
  return <><Header title="Visão geral" period={d?.period} /><QueryState isPending={query.isPending} error={query.error}>
    {d && <><section className="kpis"><Kpi label="Investimento" value={formatMoney(d.metrics.spend)} /><Kpi label="Cliques" value={formatNumber(d.metrics.clicks)} /><Kpi label="Conversões de botão" value={formatNumber(d.metrics.buttonConversions)} /><Kpi label="Contatos" value={formatNumber(d.metrics.contacts)} /></section>
    <div className="two-column"><section className="panel"><div className="panel-heading"><h2>Google indicado</h2><Info text="Origem indicada pela etiqueta no histórico. Não há vínculo individual que comprove a campanha de cada contato." /></div><div className="bars"><Bar label="Contatos" value={d.metrics.googleIndicated} max={d.metrics.googleIndicated} /><Bar label="Interesse comercial" value={d.metrics.googleCommercial} max={d.metrics.googleIndicated} /><Bar label="Qualificados" value={d.metrics.googleQualified} max={d.metrics.googleIndicated} /><Bar label="Com proposta" value={d.metrics.googleProposals} max={d.metrics.googleIndicated} /></div></section>
    <section className="panel"><h2>Origem dos contatos</h2><div className="bars"><Bar label="Outros canais" value={d.metrics.otherChannels} max={d.metrics.contacts} /><Bar label="Sem origem" value={d.metrics.unknownSource} max={d.metrics.contacts} /><Bar label="Google indicado" value={d.metrics.googleIndicated} max={d.metrics.contacts} /><Bar label="Conflito" value={d.metrics.conflictingSource} max={d.metrics.contacts} /></div></section></div>
    <div className="footline">Dados de 01–23/10/2026 · Campanha por lead: não determinável · Receita: não disponível</div></>}
  </QueryState></>;
}

function Info({ text }: { text: string }) {
  return <span className="info" title={text} aria-label={text} tabIndex={0}><CircleHelp size={17} /></span>;
}

function AdsPage() {
  const query = useQuery({ queryKey: ['ads'], queryFn: ({ signal }) => getJson<Ads>('/ads', signal) });
  const d = query.data;
  return <><Header title="Tráfego pago" period={d?.period} /><QueryState isPending={query.isPending} error={query.error}>
    {d && <><section className="kpis"><Kpi label="Impressões" value="12.276" /><Kpi label="Cliques" value="1.467" /><Kpi label="CPC médio" value="R$ 2,81" /><Kpi label="Conversões de botão" value="437" /></section>
    <section className="panel table-panel"><div className="panel-heading"><h2>Campanhas</h2><Info text="Conversões por data da conversão. O evento mede acionamentos de botão, não pessoas ou vendas." /></div><div className="table-scroll"><table><thead><tr><th>Campanha</th><th>Cliques</th><th>Investimento</th><th>Conversões</th></tr></thead><tbody>{d.campaigns.map(c => <tr key={c.id}><td>{c.name}</td><td>{formatNumber(c.clicks)}</td><td>{formatMoney(c.spend)}</td><td>{new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(c.conversions)}</td></tr>)}</tbody></table></div></section>
    <section className="panel compact-panel"><div className="panel-heading"><h2>Termos de pesquisa</h2><Info text="O Google disponibilizou termos para 1.093 dos 1.467 cliques. A cobertura do relatório é parcial." /></div><div className="coverage"><strong>74,5%</strong><span>dos cliques com termo disponível</span><span>1.093 de 1.467 cliques</span></div></section></>}
  </QueryState></>;
}

function ConversationsPage() {
  const list = useQuery({ queryKey: ['conversations'], queryFn: ({ signal }) => getJson<{ items: { id: string | null; contactId: string; label: string; at: string }[] }>('/conversations', signal) });
  const sample = useQuery({ queryKey: ['conversation', 'historical-sample'], queryFn: ({ signal }) => getJson<Conversation>('/conversations/historical-sample', signal) });
  return <><Header title="Conversas" /><QueryState isPending={list.isPending || sample.isPending} error={list.error ?? sample.error}>
    {list.data && sample.data && <div className="conversation-layout"><aside className="conversation-list"><div className="list-top">Conversas <span className="sample-tag">Amostra</span></div>{list.data.items.slice(0, 12).map((c, i) => <div className={`conversation-item ${c.contactId === sample.data.contactId ? 'active' : ''}`} key={c.contactId}><div className="avatar">{i + 1}</div><span><b>{c.label}</b><small>{new Date(c.at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</small></span></div>)}</aside>
    <section className="chat"><div className="chat-header"><div><strong>{sample.data.contactLabel}</strong><small>{sample.data.date}</small></div><span className="read-only">Somente leitura</span></div><div className="chat-body"><div className="chat-date">06 de outubro de 2026</div>{sample.data.messages.map((m, i) => <div key={i} className={`bubble ${m.author !== 'Contato' ? 'agent' : ''}`}><span className="bubble-author">{m.author}</span><p>{m.text}</p><time>{m.at}</time></div>)}</div><div className="chat-bottom">Trechos selecionados do histórico</div></section>
    <aside className="contact-side"><h2>Contato</h2><dl><dt>Origem indicada</dt><dd>Google ADS</dd><dt>Interesse</dt><dd>Cadastro RNTRC</dd><dt>Campanha</dt><dd>Não determinável</dd></dl><div className="small-note">A conversa mostra apenas trechos selecionados; as etapas do bot foram omitidas.</div></aside></div>}
  </QueryState></>;
}

function LeadsPage() {
  const [input, setInput] = useState('');
  const q = useDeferredValue(input);
  const query = useQuery({ queryKey: ['contacts', q], queryFn: ({ signal }) => getJson<ContactPage>(`/contacts?q=${encodeURIComponent(q)}`, signal) });
  return <><Header title="Leads" /><div className="toolbar"><label className="search"><Search size={18} /><input value={input} onChange={e => setInput(e.target.value)} placeholder="Buscar contato" aria-label="Buscar contato" /></label><span className="sample-tag">Amostra histórica anonimizada</span></div><QueryState isPending={query.isPending} error={query.error}>
    {query.data && <section className="panel table-panel"><div className="table-scroll"><table><thead><tr><th>Contato</th><th>Primeira entrada</th><th>Origem</th><th>Qualificado</th><th>Proposta</th></tr></thead><tbody>{query.data.items.map(c => <tr key={c.id}><td><span className="contact-name">{c.label}</span><small className="id">{c.id}</small></td><td>{new Date(c.firstInboundAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}</td><td><span className="source-pill">{c.source}</span></td><td>{c.qualified ? 'Sim' : '—'}</td><td>{c.proposal ? 'Sim' : '—'}</td></tr>)}</tbody></table></div>{query.data.items.length === 0 && <div className="state">Nenhum contato encontrado.</div>}</section>}
  </QueryState></>;
}

function ReportsPage() {
  const query = useQuery({ queryKey: ['overview'], queryFn: ({ signal }) => getJson<Overview>('/overview', signal) });
  const a = query.data?.attendance;
  return <><Header title="Relatórios" /><QueryState isPending={query.isPending} error={query.error}>
    {a && <><div className="two-column"><section className="panel report"><h2>Durante o expediente</h2><strong>{a.inside}</strong><span>entradas · Google indicado</span><div className="report-stat"><b>{a.insideAnswered}</b><span>respondidas</span></div><div className="report-stat"><b>{String(a.insideMedian).replace('.', ',')} min</b><span>mediana até resposta humana</span></div></section><section className="panel report"><h2>Fora do expediente</h2><strong>{a.outside}</strong><span>entradas · Google indicado</span><div className="report-stat"><b>{a.outsideAnswered}</b><span>respondidas</span></div><div className="report-stat"><b>{String(a.outsideMedian).replace('.', ',')} min</b><span>mediana de espera corrida</span></div></section></div><section className="panel report-summary"><h2>Fechamentos observados</h2><strong>7 eventos em 6 contatos</strong><span>Origem Google indicada · receita não disponível</span></section></>}
  </QueryState></>;
}

function SettingsPage() {
  return <><Header title="Configurações" /><section className="panel settings"><h2>Ambiente local</h2><dl><dt>Modo</dt><dd>Demonstração histórica</dd><dt>WhatsApp</dt><dd>Somente leitura</dd><dt>Sincronização externa</dt><dd>Desativada</dd><dt>Período dos dados</dt><dd>01 a 23 out 2026</dd></dl></section></>;
}

export function App() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const status=useQuery({queryKey:['status'],queryFn:({signal})=>getJson<Status>('/status',signal),refetchInterval:60_000});
  if(status.isPending||status.error) return <QueryState isPending={status.isPending} error={status.error}>{null}</QueryState>;
  const live=status.data?.mode==='local';
  return <div className="shell"><button className="mobile-menu" onClick={() => setOpen(true)} aria-label="Abrir menu"><Menu /></button>{open && <div className="scrim" onClick={() => setOpen(false)} />}
    <aside className={`sidebar ${open ? 'open' : ''}`}><div className="brand"><img src="/jbr-logo-white.webp" alt="Grupo JBR Brasil" /><span className="brand-product">CRM <i/> JBR</span><button className="close-menu" onClick={() => setOpen(false)} aria-label="Fechar menu"><X /></button></div><nav aria-label="Menu principal">{nav.map(n => <NavLink key={n.to} to={n.to} end={n.to === '/'} onClick={() => setOpen(false)}><n.icon size={19} strokeWidth={1.8} /><span>{n.label}</span></NavLink>)}</nav><div className="sidebar-bottom"><span className="status-dot" /> Ambiente local</div></aside>
    <main className="content" key={location.pathname}><Routes><Route path="/" element={live?<ConnectedOverview status={status.data!}/>:<OverviewPage />} /><Route path="/trafego" element={live?<PaidTraffic/>:<AdsPage />} /><Route path="/conversas" element={live?<ConnectedConversations status={status.data!}/>:<ConversationsPage />} /><Route path="/leads" element={live?<Leads status={status.data!}/>:<LeadsPage />} /><Route path="/relatorios" element={live?<ConnectedReports status={status.data!}/>:<ReportsPage />} /><Route path="/configuracoes" element={live?<ConnectedSettings status={status.data!}/>:<SettingsPage />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></main></div>;
}
