import type {FunnelResult} from '../../shared/funnel';
import type {MetaDashboard} from '../../shared/meta';

export function metaFunnelAction(meta:MetaDashboard|undefined,key:string):number|null {
 const actions=meta?.available?meta.total?.actions:undefined;
 return actions&&Object.hasOwn(actions,key)?actions[key]:null;
}

export function metaFunnelSales(data:FunnelResult|undefined,meta:MetaDashboard|undefined,account:string) {
 if(!data||!meta?.available||data.period.start!==meta.period.start||data.period.end!==meta.period.end)return null;
 const ids=new Set([...meta.ads,...meta.instagram].filter(ad=>!account||ad.accountId===account).map(ad=>ad.id));
 const matches=(data.metaAdCohorts??[]).filter(cohort=>cohort.adIds.some(id=>ids.has(id)));
 // No verified matching contact is an unknown result, never a measured zero.
 return matches.length?matches.reduce((total,c)=>({leads:total.leads+c.leads,won:total.won+c.wonObserved}),{leads:0,won:0}):null;
}
