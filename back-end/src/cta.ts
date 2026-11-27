import catalog from './cta-catalog.json' with {type:'json'};
import {createHash} from 'node:crypto';
export const normalize=(s:string)=>s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const patterns=new Map(catalog.map(c=>[normalize(c.text),c]));
export const matchCtaRecord=(text:string)=>patterns.get(normalize(text));
export const matchCta=(text:string)=>matchCtaRecord(text)?.sources;
export const ctaTexts=()=>[...patterns.values()].map(c=>c.text);
// Only known catalog entries get a stable identifier. Never hash/store arbitrary messages.
const ctaId=(text:string)=>createHash('sha256').update(normalize(text)).digest('hex');
const byId=new Map([...patterns.values()].map(c=>[ctaId(c.text),c]));
export const ctaCatalogVersion=createHash('sha256').update([...byId.keys()].sort().join(':')).digest('hex');
// Positive matches remain valid across additions. Only unknown/removed matches
// need their first message fetched again when the catalog changes.
export function needsCtaRefresh(raw:{ctaKey?:string|null;ctaCatalogVersion?:string}){
 return !(raw.ctaKey&&byId.has(raw.ctaKey))&&raw.ctaCatalogVersion!==ctaCatalogVersion;
}
export type CtaEvidence={content?:string;ctaKey?:string|null};
export const ctaRecordFor=(message:CtaEvidence)=>message.ctaKey!==undefined
 ?(message.ctaKey?byId.get(message.ctaKey):undefined):matchCtaRecord(message.content??'');
export const extractCtaKey=(message:CtaEvidence):string|null=>{
 const record=ctaRecordFor(message);return record?ctaId(record.text):null;
};
