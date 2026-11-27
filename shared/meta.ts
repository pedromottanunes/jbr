import {validPeriod,type Period} from './period';

export const metaPeriodKey=(p:Period)=>p.start+':'+p.end;
export function mergeMetaPeriods(...lists:Period[][]){
 const result:Period[]=[];for(const p of lists.flat()){if(!validPeriod(p))throw Object.assign(new Error('Período Meta inválido.'),{statusCode:400});if(!result.some(r=>metaPeriodKey(r)===metaPeriodKey(p)))result.push({start:p.start,end:p.end});}
 if(result.length>8)throw Object.assign(new Error('Há oito períodos na fila. Aguarde a conclusão.'),{statusCode:429});return result;
}

export const metaAccounts = [
 {id:'1638336274287834',name:'BM TESTE - HÉLIO'},
 {id:'523435535018960',name:'JBR CARTÃO'},
 {id:'2705808446379845',name:'JBR [CA - RESERVA]'},
] as const;
export type MetaMetrics={spend:number;impressions:number;clicks:number;linkClicks:number;reach:number|null;actions:Record<string,number>;values:Record<string,number>};
export type MetaRow=MetaMetrics&{id:string;accountId:string;name:string;campaignId:string;campaignName:string;adsetId:string;adsetName:string;platform?:string;date?:string;status?:string;objective?:string;creative?:{title:string;body:string;image:string|null;permalink:string|null;format:string;instagramId:string}};
export type MetaSnapshot={accountId:string;accountName:string;currency:string;timezone:string;accountStatus:number;period:Period;syncedAt:string;total:MetaMetrics;campaigns:MetaRow[];adsets:MetaRow[];ads:MetaRow[];instagram:MetaRow[];daily:MetaRow[];warnings:string[];derived?:boolean;detailsPending?:boolean};
export type MetaDashboard={period:Period;accounts:{id:string;name:string;available:boolean;syncedAt:string|null;currency:string|null;status:number|null;warning:string|null}[];available:boolean;stale:boolean;needsSync?:boolean;total:MetaMetrics|null;campaigns:MetaRow[];adsets:MetaRow[];ads:MetaRow[];instagram:MetaRow[];daily:MetaRow[];currencies:string[];warnings:string[];syncedAt:string|null};
export const actionLabels:Record<string,string>={
 lead:'Leads',purchase:'Compras',omni_purchase:'Compras em todos os canais',offsite_conversion_fb_pixel_lead:'Leads no site',
 'offsite_conversion.fb_pixel_lead':'Leads no site','offsite_conversion.fb_pixel_purchase':'Compras no site',
 'onsite_conversion.messaging_conversation_started_7d':'Conversas iniciadas',
 'onsite_conversion.total_messaging_connection':'Conexões por mensagem','onsite_conversion.messaging_first_reply':'Primeiras respostas',
 'onsite_conversion.messaging_user_depth_2_message_send':'Conversas com 2 mensagens','onsite_conversion.messaging_user_depth_3_message_send':'Conversas com 3 mensagens',
 link_click:'Cliques no link',landing_page_view:'Visualizações da página de destino',omni_landing_page_view:'Visualizações de destino (todos os canais)',
 post_engagement:'Engajamentos com publicação',page_engagement:'Engajamentos com página',video_view:'Visualizações de vídeo',post_reaction:'Reações',comment:'Comentários',post:'Compartilhamentos',onsite_conversion_post_save:'Salvamentos',
 'onsite_conversion.post_save':'Salvamentos',onsite_web_lead:'Leads na web e na Meta',like:'Curtidas na página',
 post_interaction_gross:'Interações totais',post_interaction_net:'Interações líquidas',
 'onsite_conversion.post_net_like':'Curtidas líquidas','onsite_conversion.post_net_save':'Salvamentos líquidos',
 'onsite_conversion.post_net_comment':'Comentários líquidos','onsite_conversion.post_unlike':'Curtidas removidas','onsite_conversion.post_unsave':'Salvamentos removidos',
};
export const actionLabel=(key:string)=>actionLabels[key]??key;
export const preferredActions=['lead','onsite_conversion.messaging_conversation_started_7d','purchase','offsite_conversion.fb_pixel_lead','offsite_conversion.fb_pixel_purchase'];
export const emptyMeta=():MetaMetrics=>({spend:0,impressions:0,clicks:0,linkClicks:0,reach:null,actions:{},values:{}});
// Reach is not additive across accounts, ads or days. Only a single API row has deduplicated reach.
export function sumMeta(rows:MetaMetrics[]):MetaMetrics{
 const total=emptyMeta();for(const r of rows){for(const k of ['spend','impressions','clicks','linkClicks'] as const)total[k]+=r[k];for(const k of ['actions','values'] as const)for(const [a,v]of Object.entries(r[k]))total[k][a]=(total[k][a]??0)+v;}
 total.reach=rows.length===1?rows[0].reach:null;return total;
}
