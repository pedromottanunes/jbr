import {BSON} from 'mongodb';

// Bounded documents reduce index/write amplification without changing report rows.
export const adsStorageFormat='buckets-v1';
export function packAdsRows(generation:string,kind:string,items:any[],maxBytes=1024*1024,maxRows=200){
 const result:any[]=[];let rows:any[]=[],position=0,bytes=256+generation.length*3+kind.length*3;
 const flush=()=>{if(!rows.length)return;result.push({_id:generation+':'+kind+':'+position.toString(36),id:kind+':'+position,generation,kind,position,rows});position+=rows.length;rows=[];bytes=256+generation.length*3+kind.length*3;};
 for(const row of items){
  const size=BSON.calculateObjectSize({value:row})+16;
  if(size+256+generation.length*3+kind.length*3>maxBytes)throw new Error('Linha Google excede o tamanho seguro.');
  if(rows.length>=maxRows||bytes+size>maxBytes)flush();
  rows.push(row);bytes+=size;
 }
 flush();return result;
}
export function unpackAdsRows(documents:any[]){
 const groups:Record<string,any[]>={};
 for(const document of documents){const rows=Array.isArray(document.rows)?document.rows:[document.row];for(const row of rows)(groups[document.kind]??=[]).push(row);}
 return groups;
}
