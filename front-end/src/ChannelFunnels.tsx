import {useState,type CSSProperties,type ReactNode} from 'react';
import {keepPreviousData,useQuery} from '@tanstack/react-query';
import {ArrowDown,ArrowUpRight,CheckCheck,ChevronDown,Globe2,Info,LoaderCircle,MessageCircle,MessagesSquare,MousePointer2,Reply,Target,Trophy,type LucideIcon} from 'lucide-react';
import type {FunnelResult} from '../../shared/funnel';
import type {MetaDashboard} from '../../shared/meta';
import type {Period} from '../../shared/period';
import {getJson} from './api';
import {GoogleAdsMark,MetaMark} from './Presentation';
import {metaFunnelAction,metaFunnelSales} from './channel-funnel-data';
import './channel-funnels.css';

const number=(value:number|null)=>value===null?'—':new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(value);
type Step={id:string;label:string;value:number|null;source:string;description:string;icon:LucideIcon};

function ChannelSteps({steps,loading}:{steps:Step[];loading:boolean}) {
 return <ol className="channel-steps">{steps.map((step,index)=>{
  const Icon=step.icon;
  return <li key={step.id} style={{'--step-order':index,'--step-inset':`${index*4.5}%`} as CSSProperties}>
   <span className="channel-step-index" aria-hidden="true">{String(index+1).padStart(2,'0')}</span>
   <div className={`channel-step${step.value===null?' is-unavailable':''}`}>
    <Icon size={17} className="channel-step-icon" aria-hidden="true"/>
    <div className="channel-step-label"><span>{step.label}</span><small>{step.source}</small></div>
    <strong className={loading?'channel-value is-loading':'channel-value'} key={`${loading}:${step.value}`} aria-label={loading?'Carregando':step.value===null?'Não disponível':undefined}>{loading?<span className="channel-skeleton"/>:number(step.value)}</strong>
   </div>
  </li>;
 })}</ol>;
}

function Sale({value,context,loading}:{value:number|null;context:string;loading:boolean}) {
 return <div className={`channel-sale${value===null?' is-unavailable':''}`}>
  <span className="channel-sale-connector" aria-hidden="true"><ArrowDown size={12}/></span>
  <span className="channel-sale-icon"><Trophy size={19} aria-hidden="true"/></span>
  <div><b>Venda OK <span>· observada</span></b><small>{context}</small></div>
  <strong className={loading?'channel-value is-loading':'channel-value'} key={`${loading}:${value}`} aria-label={loading?'Carregando':value===null?'Sem vínculo suficiente para contar vendas':undefined}>{loading?<span className="channel-skeleton"/>:number(value)}</strong>
 </div>;
}

function Method({steps,children}:{steps:Step[];children:ReactNode}) {
 return <details className="channel-method"><summary><Info size={13}/> Como este funil é contado <ChevronDown size={13}/></summary>
  <div className="channel-method-content"><dl>{steps.map(s=><div key={s.id}><dt>{s.label}</dt><dd>{s.description}</dd></div>)}</dl>{children}
   <p>O desenho representa a sequência das etapas, sem escala proporcional. “—” significa informação indisponível; zero significa uma contagem disponível sem ocorrências. As etapas não devem ser somadas.</p>
  </div>
 </details>;
}

export function ChannelFunnels({data,period,enabled,refreshing=false}:{data:FunnelResult|undefined;period:Period;enabled:boolean;refreshing?:boolean}) {
 const [account,setAccount]=useState('');
 const query=useQuery({queryKey:['meta-detail',period.start,period.end,account],enabled,queryFn:({signal})=>getJson<MetaDashboard>('/meta/detail?'+new URLSearchParams({...period,account}),signal),staleTime:60_000,placeholderData:keepPreviousData});
 const meta=query.isPlaceholderData?undefined:query.data;
 const current=data?.period.start===period.start&&data.period.end===period.end?data:undefined;
 const total=meta?.available?meta.total:null,sales=metaFunnelSales(current,meta,account);
 const googleLoading=!current&&refreshing,metaLoading=enabled&&query.isFetching&&!meta;
 const selectedAction=current?.ads.actions.find(a=>a.id===current.ads.action)?.name;
 const google:Step[]=[
  {id:'clicks',label:'Cliques nos anúncios',value:current?.ads.clicks??null,source:'Google Ads',icon:MousePointer2,description:'Cliques dos anúncios no período escolhido. São ações, não pessoas únicas.'},
  {id:'conversions',label:'Conversões da ação',value:current?.ads.conversions??null,source:selectedAction??'Selecione a ação acima',icon:Target,description:`Conversões da ação selecionada: ${selectedAction??'nenhuma'}. Só representam cliques no botão do site se essa for a ação configurada. Usam a data da conversão e podem ser fracionadas.`},
  {id:'cta',label:'Leads com CTA do site',value:current?.metrics.siteChannelLeads??null,source:'WhatsApp · inclui retornos',icon:Globe2,description:'Contatos únicos que abriram uma conversa com um CTA reconhecido do site no período, incluindo contatos que retornaram. Pela regra da JBR, todos são Google; essa regra prevalece sobre referências a anúncios da Meta no mesmo recorte.'},
  {id:'reply',label:'Com resposta humana',value:current?.metrics.siteAttended??null,source:'WhatsApp · Umbler',icon:Reply,description:'Desses contatos com CTA, quantos receberam resposta humana na mesma conversa, após a entrada e até o fim do período. Automações e mensagens privadas não contam.'},
 ];
 const metaSteps:Step[]=[
  {id:'clicks',label:'Cliques nos anúncios',value:total?.clicks??null,source:'Meta Ads · todos os cliques',icon:MousePointer2,description:'Todos os cliques informados pela Meta para as contas selecionadas; nem todo clique abre o WhatsApp.'},
  {id:'started',label:'Conversas iniciadas',value:metaFunnelAction(meta,'onsite_conversion.messaging_conversation_started_7d'),source:'Meta Ads',icon:MessageCircle,description:'Conversas iniciadas atribuídas aos anúncios pela Meta, incluindo retomadas após inatividade conforme os critérios da plataforma. Não equivale a contatos novos únicos.'},
  {id:'reply',label:'Primeiras respostas',value:metaFunnelAction(meta,'onsite_conversion.messaging_first_reply'),source:'Meta Ads',icon:Reply,description:'Ação messaging_first_reply informada pela Meta. Não é a medição de tempo ou de resposta humana dos atendentes no Umbler.'},
  {id:'depth2',label:'Conversas com 2 mensagens',value:metaFunnelAction(meta,'onsite_conversion.messaging_user_depth_2_message_send'),source:'Meta Ads',icon:MessagesSquare,description:'Ação messaging_user_depth_2_message_send informada pela Meta. Etapa de profundidade da conversa; não deve ser somada às outras etapas.'},
  {id:'depth3',label:'Conversas com 3 mensagens',value:metaFunnelAction(meta,'onsite_conversion.messaging_user_depth_3_message_send'),source:'Meta Ads',icon:CheckCheck,description:'Ação messaging_user_depth_3_message_send informada pela Meta. Pode se sobrepor às conversas das etapas anteriores.'},
 ];
 const metaStatus=!enabled?'Integração indisponível':query.error?'Falha na atualização':query.isFetching?'Atualizando':!meta?.available?'Coleta incompleta':meta.stale?'Dados em cache':meta.needsSync?'Detalhes em análise':'Dados disponíveis';
 const googleStatus=refreshing?'Atualizando':!current?.ads.available?'Google indisponível':current.metrics.missingMessages>0?'Histórico parcial':'Google Ads + CRM';
 return <div className="channel-funnels" aria-label="Funis por canal">
  <section className="panel channel-funnel channel-google" aria-labelledby="google-funnel-title" aria-busy={googleLoading}>
   <header className="channel-funnel-heading"><h2 id="google-funnel-title"><GoogleAdsMark/> Funil Google</h2><span className="channel-rule"><CheckCheck size={13}/> CTA do site = Google</span></header>
   <div className="channel-journey"><span>Anúncio</span><ArrowUpRight size={12}/><span>Site</span><ArrowUpRight size={12}/><span>Atendimento</span><span className="channel-update" role="status" title="Indicadores calculados com as primeiras mensagens e respostas disponíveis no CRM.">{refreshing&&<LoaderCircle size={12} className="channel-spinner"/>}{googleStatus}</span></div>
   <ChannelSteps steps={google} loading={googleLoading}/>
   <Sale value={current?.metrics.siteWonObserved??null} loading={googleLoading} context="Etiqueta nos leads com CTA · sem data de venda"/>
   <Method steps={google}><p>Venda OK conta contatos com CTA no período e essa etiqueta no histórico coletado, mesmo sem resposta humana disponível. Não comprova fechamento dentro do período. Cada contato conta uma vez. O funil de entradas abaixo considera apenas a primeira entrada conhecida; aqui também entram retornos com um novo CTA.</p><p>A classificação Google segue a regra comercial da JBR. Não identifica tecnicamente qual anúncio trouxe cada contato. Os totais do Google e os contatos do CRM usam critérios diferentes; não calculamos uma taxa de conversão individual entre essas fontes.</p></Method>
  </section>
  <section className="panel channel-funnel channel-meta" aria-labelledby="meta-funnel-title" aria-busy={metaLoading}>
   <header className="channel-funnel-heading"><h2 id="meta-funnel-title"><MetaMark/> Funil Meta</h2><select aria-label="Conta do funil Meta" value={account} onChange={e=>setAccount(e.target.value)}><option value="">Todas as contas</option>{query.data?.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></header>
   <div className="channel-journey"><span>Anúncio</span><ArrowUpRight size={12}/><span>Conversa</span><ArrowUpRight size={12}/><span>Interação</span><span className={`channel-update${query.error?' has-error':''}`} role="status">{query.isFetching&&<LoaderCircle size={12} className="channel-spinner"/>}{metaStatus}</span></div>
   <ChannelSteps steps={metaSteps} loading={metaLoading}/>
   <Sale value={sales?.won??null} loading={metaLoading||googleLoading} context={sales?`Em ${number(sales.leads)} contatos vinculados · cobertura parcial`:'Aguardando vínculo entre contato e anúncio'}/>
   <Method steps={metaSteps}><p>As etapas da Meta são métricas agregadas de publicidade, com atribuição pela data da impressão e regras da plataforma. Não comprovam que as mesmas pessoas percorreram todas as etapas. O relatório de mensagens pode incluir outros destinos além do WhatsApp, conforme os anúncios das contas selecionadas.</p><p>Venda OK cruza referências de anúncios na abertura das conversas do Umbler com anúncios da conta e do período selecionados. Cada contato conta uma única vez, mesmo com vários anúncios. Contatos com CTA do site ficam no Google. Sem vínculo verificável, o valor fica indisponível; a cobertura histórica pode ser parcial.</p><p>A etiqueta foi observada no histórico e não informa a data da venda. Não calculamos uma taxa de fechamento entre ações da Meta e contatos do Umbler.</p></Method>
  </section>
 </div>;
}
