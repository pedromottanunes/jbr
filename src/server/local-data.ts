import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { readFile, stat } from 'node:fs/promises';
import { registerFunnel } from './funnel.js';
import { adsDetail } from './ads-detail.js';
import { registerGoogleSync } from './google-sync.js';
import { registerLeads } from './leads.js';
import { registerAttendance } from './attendance.js';
import {LocalSettings,registerAttendanceSettings} from './local-settings.js';
import {registerAgentPerformance} from './agent-performance.js';
import {registerAdsBalance} from './ads-balance.js';

export function registerLocalData(app: FastifyInstance, databasePath = resolve('local-data/umbler.sqlite3')) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  const settings=new LocalSettings(join(dirname(databasePath),'crm-settings.sqlite3'));
  app.addHook('onClose',async()=>settings.close());
  db.exec('PRAGMA busy_timeout=3000; PRAGMA query_only=ON;');
  app.addHook('onClose', async () => db.close());
  const statement = (sql: string) => db.prepare(sql);
  const count = (table: string) => Number(statement(`SELECT count(*) AS n FROM ${table}`).get()!.n);
  const meta = () => Object.fromEntries(statement('SELECT key,value FROM crm_meta WHERE key NOT LIKE ?').all('import:%').map(r => [String(r.key), JSON.parse(String(r.value))]));
  const totals = () => ({ contacts: count('crm_contacts'), conversations: count('crm_chats'), messages: count('crm_messages'), conversationsWithMessages: Number(statement('SELECT count(*) AS n FROM crm_chats WHERE message_count>0').get()!.n), googleIndicated: Number(statement("SELECT count(*) AS n FROM crm_contacts WHERE source='Google indicado'").get()!.n) });
  const pageSchema = { type: 'object', additionalProperties: false, properties: { q: { type: 'string', maxLength: 100 }, cursor: { type: 'integer', minimum: 0, maximum: 1000000 }, limit: { type: 'integer', minimum: 1, maximum: 100 } } };
  let adsCache:{key:string;value:Promise<any>}|undefined;
  const ads = async () => { try {
    const path=join(dirname(databasePath),'google-ads.json'),info=await stat(path),key=`${info.mtimeMs}:${info.size}`;
    if(adsCache?.key!==key)adsCache={key,value:readFile(path,'utf8').then(JSON.parse)};
    return await adsCache.value;
  } catch { adsCache=undefined;return { connected:false,campaigns:[],metrics:null }; } };
  registerFunnel(app,db,ads);
  registerLeads(app,db);
  registerAttendance(app,db,()=>settings.attendance().config);
  registerAttendanceSettings(app,settings);
  registerAgentPerformance(app,db,()=>settings.attendance().config);
  registerAdsBalance(app,settings,ads);
  registerGoogleSync(app,ads);
  app.get<{Querystring:{start?:string;end?:string;campaign?:string}}>('/api/v1/ads/detail',{schema:{querystring:{type:'object',additionalProperties:false,properties:{start:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},end:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},campaign:{type:'string',pattern:'^[0-9]*$',maxLength:30}}}}},async req=>adsDetail(await ads(),req.query));
  app.get('/api/v1/status', async () => ({ mode: 'local', provider: 'Umbler Talk', ...meta(), totals: totals(), googleAds: { connected: (await ads()).connected } }));
  app.get('/api/v1/overview', async () => ({ mode: 'local', ...totals(), ...meta(), range: statement('SELECT min(at) AS first,max(at) AS last FROM crm_messages').get() }));
  app.get('/api/v1/ads', async () => ads());
  app.get<{Querystring: {q?: string;cursor?: number;limit?: number}}>('/api/v1/contacts', { schema: {querystring:pageSchema} }, async request => {
    const {q='',cursor=0,limit=25}=request.query;
    const search=`%${q.replace(/[!%_]/g,'!$&')}%`;
    const where="WHERE label LIKE ? ESCAPE '!' OR phone LIKE ? ESCAPE '!'";
    const items=statement(`SELECT id,label,phone,first_inbound_at AS firstInboundAt,source FROM crm_contacts ${where} ORDER BY first_inbound_at DESC,id LIMIT ? OFFSET ?`).all(search,search,limit,cursor);
    const total=Number(statement(`SELECT count(*) AS n FROM crm_contacts ${where}`).get(search,search)!.n);
    return {items,total,nextCursor:cursor+limit<total?cursor+limit:null};
  });
  app.get<{Querystring: {q?: string;cursor?: number;limit?: number}}>('/api/v1/conversations', {schema:{querystring:pageSchema}}, async request => {
    const {q='',cursor=0,limit=40}=request.query;
    const search=`%${q.replace(/[!%_]/g,'!$&')}%`;
    const where="WHERE c.label LIKE ? ESCAPE '!' OR p.phone LIKE ? ESCAPE '!'";
    const select=`FROM crm_chats c JOIN crm_contacts p ON p.id=c.contact_id ${where}`;
    const items=statement(`SELECT c.id,c.contact_id AS contactId,c.label,c.at,c.is_open AS isOpen,c.message_count AS messageCount,p.phone ${select} ORDER BY c.at DESC,c.id LIMIT ? OFFSET ?`).all(search,search,limit,cursor);
    const total=Number(statement(`SELECT count(*) AS n ${select}`).get(search,search)!.n);
    return {items,total,nextCursor:cursor+limit<total?cursor+limit:null};
  });
  app.get<{Params:{id:string};Querystring:{before?:string;message?:string}}>('/api/v1/conversations/:id', {schema:{params:{type:'object',required:['id'],properties:{id:{type:'string',maxLength:200}}},querystring:{type:'object',additionalProperties:false,properties:{before:{type:'string',maxLength:500},message:{type:'string',maxLength:200}}}}}, async (request,reply) => {
    const chat=statement('SELECT c.*,p.phone,p.source FROM crm_chats c JOIN crm_contacts p ON p.id=c.contact_id WHERE c.id=?').get(request.params.id);
    if(!chat) return reply.code(404).send({message:'Conversa não encontrada.'});
    let before: [string,string]|undefined;
    if(request.query.before) {
      try { const parsed=JSON.parse(Buffer.from(request.query.before,'base64url').toString()); if(!Array.isArray(parsed)||parsed.length!==2||!parsed.every(x=>typeof x==='string')) throw new Error(); before=[parsed[0],parsed[1]]; }
      catch { return reply.code(400).send({message:'Cursor inválido.'}); }
    }
    const rows= before ? statement('SELECT * FROM crm_messages WHERE chat_id=? AND (at<? OR (at=? AND id<?)) ORDER BY at DESC,id DESC LIMIT 101').all(chat.id!,before[0],before[0],before[1]) : statement('SELECT * FROM crm_messages WHERE chat_id=? ORDER BY at DESC,id DESC LIMIT 101').all(chat.id!);
    const hasMore=rows.length>100; const messages=rows.slice(0,100); const last=messages.at(-1);
    const focusMessage=request.query.message?statement('SELECT * FROM crm_messages WHERE chat_id=? AND id=? AND private=0').get(chat.id!,request.query.message)??null:null;
    return {chat,focusMessage,messages:messages.reverse(),nextCursor:hasMore&&last?Buffer.from(JSON.stringify([last.at,last.id])).toString('base64url'):null};
  });
}
