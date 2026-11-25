import type {FastifyInstance} from 'fastify';
import type {MongoContext} from './connection.js';
import {MongoReads,viewGeneration} from './datasets.js';
import {MongoSettings,MongoBudgetStore} from './settings.js';
import {mongoGoogleTokens} from './secrets.js';
import {registerFunnel} from '../funnel.js';
import {registerAttendance} from '../attendance.js';
import {registerAttendanceSettings} from '../local-settings.js';
import {registerAgentPerformance} from '../agent-performance.js';
import {registerAdsBalance} from '../budget-service.js';
import {adsDetail} from '../ads-detail.js';
import {validPeriod,type Period} from '../../../shared/period.js';
import {normalize} from './model.js';
import {enqueue,jobStatus} from './jobs.js';
import {messageStorage} from './message-storage.js';
import {setMessageStorage} from './message-retention.js';
import {ensureAttendanceCoverage} from './attendance-coverage.js';
import {recentPeriod} from './attendance-period.js';

const escape=(v:string)=>v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const project={_id:0,generation:0,search:0};
const pageSchema={type:'object',additionalProperties:false,properties:{q:{type:'string',maxLength:100},cursor:{type:'integer',minimum:0,maximum:1000000},limit:{type:'integer',minimum:1,maximum:100}}};
export function registerMongoData(app:FastifyInstance,ctx:MongoContext){
 const read=new MongoReads(ctx),settings=new MongoSettings(ctx),ads=()=>read.ads();
 const config=async()=>(await settings.attendance()).config;
 const requestJob=async(kind:'google'|'umbler'|'budget',payload:Record<string,unknown>)=>{
  if(process.env.INTEGRATIONS_ENABLED!=='true')throw Object.assign(new Error('Integrações desabilitadas.'),{statusCode:409});
  return enqueue(ctx,kind,payload);
 };
 app.get('/api/ready',async()=>{await ctx.db.command({ping:1,maxTimeMS:5000});return {status:'ok',storage:'MongoDB Atlas'};});
 registerFunnel(app,async()=>{const d=await read.analytics();return {leads:d.funnel,publishedAt:d.meta.publishedAt??null};},()=>read.ads('core'));
 registerAttendance(app,async()=>(await read.analytics()).attendance,config);
 registerAttendanceSettings(app,settings);
 app.get('/api/v1/settings/message-storage',()=>messageStorage(ctx));
 app.put<{Body:{storeContent:boolean;revision:number}}>('/api/v1/settings/message-storage',{schema:{body:{type:'object',additionalProperties:false,required:['storeContent','revision'],properties:{storeContent:{type:'boolean'},revision:{type:'integer',minimum:0}}}}},async(req,reply)=>{
  try{const result=await setMessageStorage(ctx,req.body.storeContent,req.body.revision);read.invalidate();return result;}
  catch(error){if(error instanceof Error&&'statusCode'in error&&error.statusCode===409)return reply.code(409).send({message:error.message});throw error;}
 });
 const completedVersions=new Map<string,string>();
 const syncStatus=async(kind:'google'|'umbler'|'budget')=>{const state=await jobStatus(ctx,kind);if(state.status==='complete'||state.publishedAt){const version=JSON.stringify([state.completedAt,state.revision,state.publishedAt]);if(completedVersions.get(kind)!==version){read.invalidate();completedVersions.set(kind,version);}}return state;};
 registerAgentPerformance(app,()=>read.service(),config,{status:()=>syncStatus('umbler'),request:period=>ensureAttendanceCoverage(ctx,period??recentPeriod(),true)});
 app.post<{Body:Period}>('/api/v1/attendance/ensure',{schema:{body:{type:'object',required:['start','end'],additionalProperties:false,properties:{start:{type:'string',maxLength:10},end:{type:'string',maxLength:10}}}}},async(req,reply)=>{
  const result=await ensureAttendanceCoverage(ctx,req.body);return reply.code(result.status==='running'?202:200).send(result);
 });
 registerAdsBalance(app,null,()=>read.ads('daily'),{store:new MongoBudgetStore(ctx),tokenProvider:mongoGoogleTokens(ctx),autoSync:false,syncStatus:()=>syncStatus('budget'),requestSync:async()=>{const job=await requestJob('budget',{force:true});return {status:'pending',nextAttemptAt:job.nextAttemptAt};}});
 app.get('/api/v1/status',async()=>{const r=await read.revision();return {mode:'mongo',storage:'MongoDB Atlas',provider:'Umbler Talk',...r.meta,totals:r.totals,googleAds:{connected:(await read.adsHeader()).connected}};});
 app.get('/api/v1/overview',async()=>{const r=await read.revision();return {mode:'mongo',...r.totals,...r.meta,range:r.range};});
 app.get('/api/v1/ads',ads);
 app.get<{Querystring:{start?:string;end?:string;campaign?:string}}>('/api/v1/ads/detail',{schema:{querystring:{type:'object',additionalProperties:false,properties:{start:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},end:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},campaign:{type:'string',pattern:'^[0-9]*$',maxLength:30}}}}},async req=>adsDetail(await ads(),req.query));
 app.get('/api/v1/ads/sync',()=>syncStatus('google'));
 app.post<{Body:Period&{refresh?:boolean}}>('/api/v1/ads/sync',{schema:{body:{type:'object',required:['start','end'],additionalProperties:false,properties:{start:{type:'string',maxLength:10},end:{type:'string',maxLength:10},refresh:{type:'boolean'}}}}},async(req,reply)=>{
  if(!validPeriod(req.body))return reply.code(400).send({message:'Selecione até 366 dias válidos.'});
  const data=await read.adsHeader(),today=new Intl.DateTimeFormat('en-CA',{timeZone:data.timezone??'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  if(req.body.end>today)return reply.code(400).send({message:'O período não pode terminar no futuro.'});
  if(!req.body.refresh&&data.connected&&req.body.start>=data.period.start&&req.body.end<=data.period.end)return {status:'complete',period:req.body};
  const period={start:data.period?.start<req.body.start?data.period.start:req.body.start,end:data.period?.end>req.body.end?data.period.end:req.body.end};
  if(!validPeriod(period))return reply.code(400).send({message:'A cobertura total deve caber em 366 dias.'});
  return reply.code(202).send(await requestJob('google',period));
 });
 app.get('/api/v1/leads/tags',async()=>{const r=await read.revision();return ctx.collection('contacts').aggregate([{$match:{generation:viewGeneration(r,'contacts')}},{$unwind:'$tags'},{$group:{_id:'$tags.name',count:{$sum:1}}},{$project:{_id:0,name:'$_id',count:1}},{$sort:{name:1}}],{maxTimeMS:15000}).toArray();});
 type Page={q?:string;tag?:string;cursor?:number;limit?:number};
 app.get<{Querystring:Page}>('/api/v1/leads',{schema:{querystring:{...pageSchema,properties:{...pageSchema.properties,tag:{type:'string',maxLength:120},limit:{type:'integer',minimum:1,maximum:50}}}}},async req=>{
  const {q='',tag='',cursor=0,limit=25}=req.query,r=await read.revision(),query:any={generation:viewGeneration(r,'contacts')};
  if(q.trim()){
   const digits=/^[+\d\s().-]+$/.test(q)?q.replace(/\D/g,''):'';
   query.$or=[{search:{$regex:escape(normalize(q.trim()))}},...(digits?[{phone:{$regex:digits.split('').join('[^0-9]*')}}]:[])];
  }if(tag)query['tags.name']=tag;
  const contacts=ctx.collection('contacts'),total=await contacts.countDocuments(query,{maxTimeMS:15000}),rows=await contacts.find(query,{projection:project}).sort({firstInboundAt:-1,id:1}).skip(cursor).limit(limit).maxTimeMS(15000).toArray();
  const chats=await ctx.collection('conversations').find({generation:viewGeneration(r,'conversations'),contact_id:{$in:rows.map(c=>c.id)}},{projection:{contact_id:1,at:1}}).sort({at:-1,id:1}).toArray();
  return {items:rows.map(c=>{const list=chats.filter(x=>x.contact_id===c.id);return {id:c.id,label:c.label,phone:c.phone,firstInboundAt:c.firstInboundAt,source:c.source,tags:c.tags,conversationCount:list.length,lastActivity:list[0]?.at??null};}),total,nextCursor:cursor+limit<total?cursor+limit:null};
 });
 app.get<{Params:{id:string}}>('/api/v1/leads/:id',{schema:{params:{type:'object',required:['id'],properties:{id:{type:'string',maxLength:200}}}}},async(req,reply)=>{
  const r=await read.revision(),c=await ctx.collection('contacts').findOne({generation:viewGeneration(r,'contacts'),id:req.params.id});if(!c)return reply.code(404).send({message:'Contato não encontrado.'});
  const chats=await ctx.collection('conversations').find({generation:viewGeneration(r,'conversations'),contact_id:c.id}).sort({at:-1,id:1}).toArray();
  return {id:c.id,label:c.label,phone:c.phone,firstInboundAt:c.firstInboundAt,source:c.source,tags:c.tags,chats:chats.map(x=>({id:x.id,at:x.at,isOpen:x.is_open,messageCount:x.message_count,limited:x.limited}))};
 });
 for(const type of ['contacts','conversations'] as const)app.get<{Querystring:Page}>('/api/v1/'+type,{schema:{querystring:pageSchema}},async req=>{
  const {q='',cursor=0,limit=type==='contacts'?25:40}=req.query,r=await read.revision(),query:any={generation:viewGeneration(r,type)};
  if(q)query.$or=[{label:{$regex:escape(q),$options:'i'}},{phone:{$regex:escape(q),$options:'i'}}];
  const c=ctx.collection(type),total=await c.countDocuments(query,{maxTimeMS:15000}),rows=await c.find(query).sort(type==='contacts'?{firstInboundAt:-1,id:1}:{at:-1,id:1}).skip(cursor).limit(limit).maxTimeMS(15000).toArray();
  return {items:rows.map(x=>type==='contacts'?{id:x.id,label:x.label,phone:x.phone,firstInboundAt:x.firstInboundAt,source:x.source}:{id:x.id,contactId:x.contact_id,label:x.label,at:x.at,isOpen:x.is_open,messageCount:x.message_count,phone:x.phone}),total,nextCursor:cursor+limit<total?cursor+limit:null};
 });
 app.get<{Params:{id:string};Querystring:{before?:string;message?:string}}>('/api/v1/conversations/:id',{schema:{params:{type:'object',required:['id'],properties:{id:{type:'string',maxLength:200}}},querystring:{type:'object',additionalProperties:false,properties:{before:{type:'string',maxLength:500},message:{type:'string',maxLength:200}}}}},async(req,reply)=>{
  const r=await read.revision(),c=await ctx.collection('conversations').findOne({generation:viewGeneration(r,'conversations'),id:req.params.id});if(!c)return reply.code(404).send({message:'Conversa não encontrada.'});
  // Analytical metadata only: this endpoint never queries stored message bodies.
  const chat={id:c.id,contact_id:c.contact_id,label:c.label,at:c.at,is_open:c.is_open,message_count:c.message_count,limited:c.limited,phone:c.phone,source:c.source};
  return {chat,contentStorageEnabled:false,focusMessage:null,messages:[],nextCursor:null};
 });
}
