import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import type {BudgetReport} from '../../shared/contracts.js';
export type {BudgetReport} from '../../shared/contracts.js';
import {resolve} from 'node:path';
import type {LocalSettings} from './local-settings.js';
import {BudgetStore,type BudgetPersistence} from './budget-store.js';
import {BudgetError,customerId,parseBudgetPayload,selectBudget,budgetForecast,budgetAlert,defaultBudgetLimits,type BudgetScope,type BudgetLimits,type BudgetState} from './account-budget.js';
import {GoogleAdsReader} from './integrations/google-ads.js';
import {LocalGoogleTokens} from './integrations/google-oauth.js';
import {ProviderReadError} from './integrations/read-transport.js';

const errorMessages:Record<string,string>={
 configuration:'Configure a conta e a autorização Google Ads no backend.',
 reconnect:'A autorização Google expirou ou foi revogada. Reconecte a conta.',
 permission:'A conta autorizada não possui acesso suficiente à conta ou ao recurso.',
 account_mismatch:'A resposta não corresponde à conta vinculada à JBR. A leitura foi bloqueada.',
 invalid_response:'O Google retornou dados inválidos. A última leitura foi preservada.',
 rate_limit:'O limite de consultas foi atingido. Aguarde a próxima tentativa.',
 temporary:'Falha temporária de comunicação com o Google. A última leitura foi preservada.',
 interrupted:'A sincronização foi interrompida. Solicite uma nova atualização.',
 credential_storage:'Não foi possível acessar a proteção local das credenciais.',
 oauth_busy:'Outra renovação de autorização está em andamento. Aguarde a próxima tentativa.',
};
function safeError(error:unknown){
 if(error instanceof BudgetError)return {errorCode:Object.hasOwn(errorMessages,error.code)?error.code:'temporary',retryAfterMs:error.retryAfterMs};
 if(error instanceof ProviderReadError)return {errorCode:error.status===401?'reconnect':error.status===403?'permission':error.status===429?'rate_limit':error.status>=500?'temporary':'invalid_response',retryAfterMs:error.retryAfterMs};
 return {errorCode:error instanceof SyntaxError?'invalid_response':'temporary'};
}
type Reader=Pick<GoogleAdsReader,'account'|'accountBudgets'>;
export class BudgetCoordinator {
 private pending:Promise<void>|undefined;
 constructor(readonly store:BudgetPersistence,readonly scope:BudgetScope,private readonly reader:Reader,private readonly clock:()=>number=Date.now){}
 async request(force:boolean){
  const claim=await this.store.claim(this.scope,force,this.clock());
  if(!claim.claimed)return {status:claim.reason==='running'?'pending':'cooldown',nextAttemptAt:new Date(claim.nextAttemptAt).toISOString()};
  this.pending=this.collect(claim.owner).catch(()=>{/* An expired lease exposes an interrupted job if local persistence fails. */}).finally(()=>{this.pending=undefined;});
  return {status:'pending',nextAttemptAt:new Date(this.clock()+30000).toISOString()};
 }
 private async collect(owner:string){
  try{
   const account=await this.reader.account(this.scope.customerId);
   const response=await this.reader.accountBudgets(this.scope.customerId);
   const payload=parseBudgetPayload(account,response,this.scope.customerId),result=selectBudget(payload,new Date(this.clock()).toISOString());
   await this.store.finish(this.scope,owner,{payload,usable:result.status==='available'||result.status==='unlimited'},this.clock());
  }catch(e){await this.store.finish(this.scope,owner,safeError(e),this.clock());}
 }
 async idle(){await this.pending;}
}
export async function budgetReport(store:BudgetPersistence,scope:BudgetScope,ads:any,now=new Date().toISOString()):Promise<BudgetReport>{
 const [record,limits]=await Promise.all([store.record(scope),store.limits(scope)]),timestamp=Date.parse(now);
 const selected=record?.payload?selectBudget(record.payload,now):null;
 let state:BudgetState=selected?.status??'unavailable',reason=selected?.reason??'A primeira consulta ainda não foi realizada.';
 if(record?.state==='error'){state='error';reason=errorMessages[record.errorCode??'temporary']??errorMessages.temporary;}
 if(record?.state==='pending'){state=await store.pendingAlive(scope,timestamp)?'pending':'error';reason=state==='pending'?'Consultando o orçamento de conta no Google Ads.':errorMessages.interrupted;}
 const lastSuccessAt=record?.lastSuccessAt??null,age=lastSuccessAt?timestamp-Date.parse(lastSuccessAt):Infinity;
 const stale=age>3600000||age<0||state==='error',usable=state==='available'&&!stale;
 const forecast=usable&&record?.payload?budgetForecast(ads,record.payload,selected?.remainingMicros??null,now):{averageDaily:null,days:null,reason:'A previsão depende de orçamento disponível e gastos recentes atualizados.'};
 const lastKnown=record?.lastUsable&&record.lastUsableAt&&(!selected||state==='error'||state==='pending'||state==='unavailable')?{...selectBudget(record.lastUsable,record.lastUsableAt),asOf:record.lastUsableAt}:null;
 return {
  status:state,reason,stale,currency:selected?.currency??record?.lastUsable?.currency??null,timezone:selected?.timezone??null,customerId:scope.customerId,
  budgetId:selected?.budgetId??null,start:selected?.start??null,end:selected?.end??null,
  remaining:state==='available'?selected?.remaining??null:null,limit:state==='available'?selected?.limit??null:null,served:state==='available'||state==='unlimited'?selected?.served??null:null,
  lastAttemptAt:record?.lastAttemptAt??null,lastSuccessAt,previousReading:lastKnown,
  forecast,alert:budgetAlert(selected?.remainingMicros??null,forecast.days,limits,usable),limits,
  nextAttemptAt:record?new Date(Math.max(Date.parse(record.lastAttemptAt)+30000,record.retryAt?Date.parse(record.retryAt):0)).toISOString():null,
  source:'Google Ads · account_budget',
 };
}
export function registerAdsBalance(app:FastifyInstance,settings:LocalSettings|null,readAds:()=>Promise<any>,options:{scope?:BudgetScope;reader?:Reader;autoSync?:boolean;clock?:()=>number;store?:BudgetPersistence;tokenProvider?:import('./integrations/google-oauth.js').GoogleTokenProvider;requestSync?:(force:boolean)=>Promise<any>;syncStatus?:()=>Promise<any>}={}){
 const store=options.store??new BudgetStore(settings!.db);let scope=options.scope;
 try{if(!scope&&process.env.GOOGLE_ADS_CUSTOMER_ID)scope={environment:process.env.CRM_ENVIRONMENT??'local',clientId:'jbr',customerId:customerId(process.env.GOOGLE_ADS_CUSTOMER_ID)};if(scope)scope={...scope,customerId:customerId(scope.customerId)};}catch{scope=undefined;}
 const boundScope=scope;
 const tokens=options.tokenProvider??new LocalGoogleTokens(store,{clientId:process.env.GOOGLE_ADS_CLIENT_ID??'',clientSecret:process.env.GOOGLE_ADS_CLIENT_SECRET??'',refreshPath:resolve('local-data/google-refresh-token.dpapi'),environment:scope?.environment??'local'});
 const reader=options.reader??new GoogleAdsReader({tokenProvider:tokens,version:process.env.GOOGLE_ADS_API_VERSION||'v26',loginCustomerId:process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID||undefined,developerToken:process.env.GOOGLE_ADS_DEVELOPER_TOKEN||undefined});
 const coordinator=boundScope?new BudgetCoordinator(store,boundScope,reader,options.clock):null;
 const querySchema={type:'object',additionalProperties:false,properties:{}};
 const enforceScope=async(req:FastifyRequest,reply:FastifyReply)=>{
  const allowed=req.method==='POST'?['force']:req.method==='PUT'?['urgentCents','attentionCents','urgentDays','attentionDays']:[];
  if(Object.keys(req.query??{}).length||Object.keys(req.body??{}).some(k=>!allowed.includes(k)))return reply.code(400).send({message:'A conta é definida pelo vínculo autorizado no backend.'});
 };
 const unavailable=()=>({status:'unavailable',reason:errorMessages.configuration,stale:true,remaining:null,currency:null,limits:defaultBudgetLimits,lastAttemptAt:null,lastSuccessAt:null,previousReading:null,forecast:{averageDaily:null,days:null,reason:''},alert:null});
 app.get('/api/v1/ads/balance',{preValidation:enforceScope,schema:{querystring:querySchema}},async()=>{
  if(!boundScope)return unavailable();
  const [report,job]=await Promise.all([readAds().then(ads=>budgetReport(store,boundScope,ads,new Date(options.clock?.()??Date.now()).toISOString())),options.syncStatus?.()]);
  return job?.status==='running'?{...report,status:'pending',reason:'Consulta aguardando o worker ou em andamento.',nextAttemptAt:job.nextAttemptAt}:report;
 });
 app.post<{Body:{force?:boolean}}>('/api/v1/ads/balance/sync',{preValidation:enforceScope,schema:{querystring:querySchema,body:{type:'object',additionalProperties:false,properties:{force:{type:'boolean'}}}}},async(req,reply)=>{
  if(!coordinator)return reply.code(409).send({message:errorMessages.configuration});
  const force=req.body.force??true;
  if(options.requestSync&&boundScope){
   const now=options.clock?.()??Date.now(),record=await store.record(boundScope);
   if(record?.state==='pending'&&await store.pendingAlive(boundScope,now))return reply.code(202).send({status:'pending'});
   const next=Math.max(record?Date.parse(record.lastAttemptAt)+(force?30000:900000):0,record?.retryAt?Date.parse(record.retryAt):0);
   if(next>now)return {status:'cooldown',nextAttemptAt:new Date(next).toISOString()};
  }
  const result=options.requestSync?await options.requestSync(force):await coordinator.request(force);return reply.code(result.status==='cooldown'?200:202).send(result);
 });
 app.put<{Body:BudgetLimits}>('/api/v1/ads/balance/limits',{preValidation:enforceScope,schema:{querystring:querySchema,body:{type:'object',required:['urgentCents','attentionCents','urgentDays','attentionDays'],additionalProperties:false,properties:{urgentCents:{type:'integer',minimum:0,maximum:100000000},attentionCents:{type:'integer',minimum:0,maximum:100000000},urgentDays:{type:'number',minimum:0,maximum:365},attentionDays:{type:'number',minimum:0,maximum:365}}}}},async(req,reply)=>{
  if(!boundScope)return reply.code(409).send({message:errorMessages.configuration});
  if(req.body.urgentCents>req.body.attentionCents||req.body.urgentDays>req.body.attentionDays)return reply.code(400).send({message:'Os limites urgentes devem ser menores ou iguais aos limites de atenção.'});
  return store.setLimits(boundScope,req.body);
 });
 let timer:ReturnType<typeof setInterval>|undefined;
 if(coordinator&&(options.autoSync??process.env.NODE_ENV!=='test'))app.addHook('onReady',async()=>{
  await coordinator.request(false);
  timer=setInterval(()=>{void coordinator.request(false).catch(()=>{});},60000);timer.unref();
 });
 app.addHook('preClose',async()=>{if(timer)clearInterval(timer);await coordinator?.idle();});
 return {store,coordinator};
}
