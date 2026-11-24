import catalog from './cta-catalog.json' with {type:'json'};
export const normalize=(s:string)=>s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const patterns=new Map(catalog.map(c=>[normalize(c.text),c]));
export const matchCtaRecord=(text:string)=>patterns.get(normalize(text));
export const matchCta=(text:string)=>matchCtaRecord(text)?.sources;
export const ctaTexts=()=>[...patterns.values()].map(c=>c.text);
