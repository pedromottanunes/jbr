import type {MongoContext} from './connection.js';
import {defaultAttendanceConfig,type AttendanceConfig} from '../../../shared/business-hours.js';
import {defaultBudgetLimits,type BudgetScope,type BudgetLimits,type BudgetPayload} from '../account-budget.js';
import {scopeKey,budgetLeaseMs,type BudgetRecord,type BudgetPersistence} from '../budget-store.js';
import {randomUUID} from 'node:crypto';

export class MongoSettings {
 constructor(readonly ctx:MongoContext){}
 async attendance(){const r=await this.ctx.collection('settings').findOne({_id:'attendance'});return {config:(r?.config??defaultAttendanceConfig) as AttendanceConfig,revision:Number(r?.revision??0)};}
 async setAttendance(config:AttendanceConfig,revision:number){
  try{const r=await this.ctx.collection('settings').findOneAndUpdate({_id:'attendance',revision},{$set:{config,updatedAt:new Date()},$inc:{revision:1}},{upsert:revision===0,returnDocument:'after'});if(r)return {config:r.config as AttendanceConfig,revision:r.revision as number};}
  catch(e){if((e as any).code!==11000)throw e;}
  throw Object.assign(new Error('Configuração alterada em outra aba.'),{statusCode:409});
 }
}
export class MongoBudgetStore implements BudgetPersistence {
 constructor(readonly ctx:MongoContext){}
 async record(scope:BudgetScope):Promise<BudgetRecord|null>{const r=await this.ctx.collection('google_budget_snapshots').findOne({_id:scopeKey(scope)});return r?{state:r.state,lastAttemptAt:r.lastAttemptAt,lastSuccessAt:r.lastSuccessAt??null,payload:r.payload??null,lastUsable:r.lastUsable??null,lastUsableAt:r.lastUsableAt??null,errorCode:r.errorCode??null,retryAt:r.retryAt??null}:null;}
 async limits(scope:BudgetScope):Promise<BudgetLimits>{return (await this.ctx.collection('google_budget_limits').findOne({_id:scopeKey(scope)}))?.value??defaultBudgetLimits;}
 async setLimits(scope:BudgetScope,value:BudgetLimits){await this.ctx.collection('google_budget_limits').updateOne({_id:scopeKey(scope)},{$set:{value}},{upsert:true});return value;}
 async lease(resource:string,owner:string,now:number,ttl:number){return !!await this.ctx.lease(resource,ttl,owner);}
 async release(resource:string,owner:string){await this.ctx.release(resource,owner);}
 async alive(resource:string,owner:string,now:number){return !!await this.ctx.collection('integration_leases').findOne({_id:resource,owner,expiresAt:{$gt:new Date(now)}});}
 async tokenCache(key:string){const r=await this.ctx.collection('oauth_cache').findOne({_id:key});return r?{encrypted:r.encrypted as string,expires_at:+r.expiresAt}:null;}
 async saveTokenCache(key:string,encrypted:string,expires:number){await this.ctx.collection('oauth_cache').updateOne({_id:key},{$set:{encrypted,expiresAt:new Date(expires)}},{upsert:true});}
 async claim(scope:BudgetScope,force:boolean,now:number){
  const owner=randomUUID(),c=this.ctx.collection('google_budget_snapshots');
  try{const row=await c.findOneAndUpdate({_id:scopeKey(scope),$and:[{$or:[{leaseUntil:{$lte:now}},{leaseUntil:{$exists:false}}]},{$or:[{lastAttemptAt:{$lte:new Date(now-(force?30000:900000)).toISOString()}},{lastAttemptAt:{$exists:false}}]},{$or:[{retryAt:{$lte:new Date(now).toISOString()}},{retryAt:null}]}]},{$set:{state:'pending',lastAttemptAt:new Date(now).toISOString(),owner,leaseUntil:now+budgetLeaseMs,errorCode:null,retryAt:null}},{upsert:true,returnDocument:'after'});if(row)return {claimed:true as const,owner};}
  catch(e){if((e as any).code!==11000)throw e;}
  const record=await c.findOne({_id:scopeKey(scope)});return {claimed:false as const,reason:record?.leaseUntil>now?'running':'cooldown',nextAttemptAt:Math.max(record?.leaseUntil??0,record?.lastAttemptAt?Date.parse(record.lastAttemptAt)+(force?30000:900000):0,record?.retryAt?Date.parse(record.retryAt):0)};
 }
 async finish(scope:BudgetScope,owner:string,result:{payload:BudgetPayload;usable:boolean}|{errorCode:string;retryAfterMs?:number},now:number){
  const at=new Date(now).toISOString();const update='payload'in result?{state:'success',lastSuccessAt:at,payload:result.payload,...(result.usable?{lastUsable:result.payload,lastUsableAt:at}:{}),errorCode:null,retryAt:null}:{state:'error',errorCode:result.errorCode,retryAt:result.retryAfterMs?new Date(now+result.retryAfterMs).toISOString():null};
  return (await this.ctx.collection('google_budget_snapshots').updateOne({_id:scopeKey(scope),owner,leaseUntil:{$gt:now}},{$set:update,$unset:{owner:'',leaseUntil:''}})).matchedCount===1;
 }
 async pendingAlive(scope:BudgetScope,now:number){return !!await this.ctx.collection('google_budget_snapshots').findOne({_id:scopeKey(scope),leaseUntil:{$gt:now}});}
}
