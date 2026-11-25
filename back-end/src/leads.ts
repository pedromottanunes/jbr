import type {FastifyInstance} from 'fastify';
import type {DatabaseSync} from 'node:sqlite';
type Tag={name:string;scopes:('contato'|'conversa')[]};
type Lead={id:string;label:string;phone:string|null;firstInboundAt:string|null;source:string;tags:Tag[];chats:{id:string;at:string|null;isOpen:number;messageCount:number;limited:number}[]};
export function registerLeads(app:FastifyInstance,db:DatabaseSync){
 let version:string|null=null,cache:Lead[]|null=null;
 function data(){
  const current=String(db.prepare("SELECT value FROM crm_meta WHERE key='publishedAt'").get()?.value??'');
  if(cache&&current===version)return cache;
  db.exec('BEGIN');try{
   const rows=db.prepare('SELECT id,label,phone,first_inbound_at AS firstInboundAt,source FROM crm_contacts').all() as unknown as Omit<Lead,'tags'|'chats'>[];
   const leads=rows.map(r=>({...r,tags:[] as Tag[],chats:[] as Lead['chats']}));const map=new Map(leads.map(l=>[l.id,l]));
   for(const row of db.prepare('SELECT id,contact_id,at,is_open,message_count,limited FROM crm_chats ORDER BY at DESC,id').iterate()){
    const lead=map.get(String(row.contact_id));if(lead)lead.chats.push({id:String(row.id),at:row.at?String(row.at):null,isOpen:Number(row.is_open),messageCount:Number(row.message_count),limited:Number(row.limited)});
   }
   if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='chats'").get())for(const row of db.prepare('SELECT organization_id,raw_json FROM chats').iterate()){
    const raw=JSON.parse(String(row.raw_json)),lead=map.get(String(row.organization_id)+':'+raw.contact?.id);if(!lead)continue;
    for(const [scope,tags] of [['contato',raw.contact?.tags],['conversa',raw.tags]] as const){if(!Array.isArray(tags))continue;for(const tag of tags){if(typeof tag?.name!=='string'||!tag.name.trim())continue;const name=tag.name.trim();let t=lead.tags.find(x=>x.name===name);if(!t){t={name,scopes:[]};lead.tags.push(t);}if(!t.scopes.includes(scope))t.scopes.push(scope);}}
   }
   for(const l of leads)l.tags.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
   leads.sort((a,b)=>(b.firstInboundAt??'').localeCompare(a.firstInboundAt??'')||a.id.localeCompare(b.id));
   db.exec('COMMIT');cache=leads;version=current;return leads;
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 const normalize=(s:string)=>s.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR');
 app.get('/api/v1/leads/tags',async()=>{const counts=new Map<string,number>();for(const lead of data())for(const t of lead.tags)counts.set(t.name,(counts.get(t.name)??0)+1);return [...counts].map(([name,count])=>({name,count})).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));});
 app.get<{Querystring:{q?:string;tag?:string;cursor?:number;limit?:number}}>('/api/v1/leads',{schema:{querystring:{type:'object',additionalProperties:false,properties:{q:{type:'string',maxLength:100},tag:{type:'string',maxLength:120},cursor:{type:'integer',minimum:0,maximum:1000000},limit:{type:'integer',minimum:1,maximum:50}}}}},async req=>{
  const {q='',tag='',cursor=0,limit=25}=req.query;const query=normalize(q.trim());const digits=/^[+\d\s().-]+$/.test(q)?q.replace(/\D/g,''):'';
  const items=data().filter(l=>(!query||normalize(l.label+' '+(l.phone??'')).includes(query)||!!(digits&&l.phone?.replace(/\D/g,'').includes(digits)))&&(!tag||l.tags.some(t=>t.name===tag)));
  return {items:items.slice(cursor,cursor+limit).map(({chats,...l})=>({...l,conversationCount:chats.length,lastActivity:chats[0]?.at??null})),total:items.length,nextCursor:cursor+limit<items.length?cursor+limit:null};
 });
 app.get<{Params:{id:string}}>('/api/v1/leads/:id',{schema:{params:{type:'object',required:['id'],properties:{id:{type:'string',maxLength:200}}}}},async(req,reply)=>{const lead=data().find(l=>l.id===req.params.id);return lead??reply.code(404).send({message:'Contato não encontrado.'});});
}
