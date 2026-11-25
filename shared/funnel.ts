export type Origin = 'site' | 'google' | 'unknown';
export type Stage = 'all' | 'attended' | 'unanswered';
export type Evidence = { at:string; kind:'entry'|'message'|'reply'; text:string; contentStored?:boolean; chatId?:string; messageId?:string; sources?:string[] };
export type ObservedTag = {name:string; scopes:('contato'|'conversa')[]};
export type FunnelLead = { id:string; label:string; phone:string|null; enteredAt:string; origin:Origin; googleTag:boolean; attended:boolean; firstMessageKnown:boolean; evidence:Evidence[];tags:ObservedTag[] };
export type FunnelResult = {
 period:{start:string;end:string}; availableAdsPeriod:{start:string;end:string}|null; timezone:string;
 publishedAt:string|null; adsSyncedAt:string|null;
 metrics:{leads:number;attended:number;unanswered:number;site:number;returning:number;unknownEntry:number;missingMessages:number;qualified:null;proposals:null;won:null};
 ads:{available:boolean;spend:number|null;clicks:number|null;impressions:number|null;conversions:number|null;action:string;currency:string;actions:{id:string;name:string;status:string}[]};
 origins:{id:Origin;label:string;count:number}[];
 items:FunnelLead[];total:number;nextCursor:number|null;
};
