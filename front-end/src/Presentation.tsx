import {
  BadgeCheck, ChartNoAxesCombined, CheckCheck, CircleDollarSign, Clock3,
  Crosshair, FileText, Globe2, Layers3, ListFilter, Megaphone, MessageSquare,
  MessageSquareReply, MousePointer2, ScanSearch, Tag, UserRound, UsersRound,
  Wallet, Waypoints, type LucideIcon,
} from 'lucide-react';
import {tagCategory} from '../../shared/lead-tags';

export function GoogleAdsMark() {
  return <img className="google-ads-mark" src="/google-ads.svg" alt="" aria-hidden="true" width="28" height="28"/>;
}
export function MetaMark(){return <svg className="meta-mark" viewBox="0 0 32 24" fill="none" aria-hidden="true"><path d="M3 15.5C3 8 6 3 9.3 3c4.4 0 8.2 10.8 11.4 15.1 1.1 1.5 2.2 2 3.4 2 2.9 0 4.9-2.1 4.9-5.9C29 7.9 26.2 3 22.8 3 18 3 14.1 14.4 11 18.4c-1.1 1.4-2.2 1.9-3.6 1.9C4.7 20.3 3 18.5 3 15.5Z" stroke="currentColor" strokeWidth="3.3" strokeLinecap="round" strokeLinejoin="round"/></svg>;}

const normalize=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').toUpperCase().trim();

// Presentation only: colors identify existing labels; they do not infer a CRM stage.
export function LeadTag({name,title}:{name:string;title?:string}) {
  const category=tagCategory(name), key=normalize(name);
  let tone:string=category, Icon:LucideIcon=Tag;
  if(category==='origem') Icon=Globe2;
  if(category==='servico') Icon=Layers3;
  if(category==='responsavel') Icon=UserRound;
  if(category==='atendimento') {
    Icon=MessageSquare;
    if(/AGUARD|POS |FORA HORARIO/.test(key)){tone='waiting';Icon=Clock3;}
    if(/SEM RESPOSTA|NAO RESPONDEU|ENGANO/.test(key)){tone='unanswered';Icon=MessageSquare;}
    if(key==='CLIENTE RESPONDEU'){tone='answered';Icon=MessageSquareReply;}
    if(key==='VENDA OK'||key==='PAGAMENTO FINALIZADO'){tone='success';Icon=CheckCheck;}
    if(key==='NEGOCIACAO'){tone='negotiation';Icon=CircleDollarSign;}
  }
  return <span className={`lead-tag tone-${tone}`} title={title}>
    {key==='GOOGLE ADS'?<GoogleAdsMark/>:<Icon size={12} strokeWidth={1.8} aria-hidden="true"/>}
    <span className="tag-text">{name}</span>
  </span>;
}

export function ContactAvatar({name}:{name:string}) {
  const words=name.match(/[\p{L}\p{N}]+/gu)??[];
  const initials=words.slice(0,2).map(w=>Array.from(w)[0]).join('').toLocaleUpperCase('pt-BR')||'•';
  const color=Array.from(name).reduce((total,c)=>total+c.codePointAt(0)!,0)%5;
  return <span className={`contact-avatar avatar-${color}`} aria-hidden="true">{initials}</span>;
}

const metrics:Record<string,LucideIcon>={
  'Investimento':Wallet,'Cliques':MousePointer2,'Conversões':Crosshair,
  'Custo por conversão':CircleDollarSign,'Leads recebidos':UsersRound,
  'Com CTA do site':Globe2,'Com resposta humana':MessageSquareReply,
  'Sem resposta registrada':Clock3,
};
export function MetricIcon({label}:{label:string}) {
  const Icon=metrics[label]??ChartNoAxesCombined;
  return <i className="metric-icon" aria-hidden="true"><Icon size={20} strokeWidth={1.8}/></i>;
}

const sections:Record<string,LucideIcon>={
  'Campanhas':Megaphone,'Palavras-chave':ScanSearch,'Grupos de anúncios':Layers3,
  'Termos de pesquisa':ListFilter,'Anúncios e textos':FileText,
  'Evolução diária':ChartNoAxesCombined,'Dias da semana':ChartNoAxesCombined,
  'Horários':Clock3,'Funil de leads':Waypoints,'Atendimento geral':MessageSquareReply,'Origem dos leads':Globe2,
  'Google + CRM':Waypoints,'Integrações':Layers3,'Cobertura da coleta':BadgeCheck,
};
export function HeadingIcon({label}:{label:string}) {
  const Icon=sections[label]??ChartNoAxesCombined;
  return <span className="heading-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.8}/></span>;
}
