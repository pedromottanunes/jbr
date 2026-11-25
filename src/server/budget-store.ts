import type {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {defaultBudgetLimits,type BudgetLimits,type BudgetPayload,type BudgetScope} from './account-budget.js';

export const scopeKey=(scope:BudgetScope)=>JSON.stringify([scope.environment,scope.clientId,scope.customerId]);
export const budgetLeaseMs=600000;
export type BudgetRecord={state:'pending'|'success'|'error';lastAttemptAt:string;lastSuccessAt:string|null;payload:BudgetPayload|null;lastUsable:BudgetPayload|null;lastUsableAt:string|null;errorCode:string|null;retryAt:string|null};
export class BudgetStore {
 constructor(readonly db:DatabaseSync){db.exec(`
  CREATE TABLE IF NOT EXISTS google_budget_snapshots (scope TEXT PRIMARY KEY,state TEXT NOT NULL,last_attempt_at TEXT NOT NULL,last_success_at TEXT,payload TEXT,last_usable TEXT,last_usable_at TEXT,error_code TEXT,retry_at TEXT);
  CREATE TABLE IF NOT EXISTS google_budget_limits (scope TEXT PRIMARY KEY,value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS google_read_leases (resource TEXT PRIMARY KEY,owner TEXT NOT NULL,expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS google_oauth_cache (credential_key TEXT PRIMARY KEY,encrypted TEXT NOT NULL,expires_at INTEGER NOT NULL);
 `);}
 tokenCache(key:string){const r=this.db.prepare('SELECT * FROM google_oauth_cache WHERE credential_key=?').get(key);return r?{encrypted:String(r.encrypted),expires_at:Number(r.expires_at)}:null;}
 saveTokenCache(key:string,encrypted:string,expires:number){this.db.prepare('INSERT INTO google_oauth_cache VALUES (?,?,?) ON CONFLICT(credential_key) DO UPDATE SET encrypted=excluded.encrypted,expires_at=excluded.expires_at').run(key,encrypted,expires);}

 record(scope:BudgetScope):BudgetRecord|null {
  const r=this.db.prepare('SELECT * FROM google_budget_snapshots WHERE scope=?').get(scopeKey(scope));
  return r?{state:r.state as BudgetRecord['state'],lastAttemptAt:String(r.last_attempt_at),lastSuccessAt:r.last_success_at?String(r.last_success_at):null,payload:r.payload?JSON.parse(String(r.payload)):null,lastUsable:r.last_usable?JSON.parse(String(r.last_usable)):null,lastUsableAt:r.last_usable_at?String(r.last_usable_at):null,errorCode:r.error_code?String(r.error_code):null,retryAt:r.retry_at?String(r.retry_at):null}:null;
 }
 limits(scope:BudgetScope):BudgetLimits {const r=this.db.prepare('SELECT value FROM google_budget_limits WHERE scope=?').get(scopeKey(scope));return r?JSON.parse(String(r.value)):defaultBudgetLimits;}
 setLimits(scope:BudgetScope,value:BudgetLimits){this.db.prepare('INSERT INTO google_budget_limits VALUES (?,?) ON CONFLICT(scope) DO UPDATE SET value=excluded.value').run(scopeKey(scope),JSON.stringify(value));return value;}
 lease(resource:string,owner:string,now:number,ttl:number){
  return Number(this.db.prepare('INSERT INTO google_read_leases VALUES (?,?,?) ON CONFLICT(resource) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE google_read_leases.expires_at<=?').run(resource,owner,now+ttl,now).changes)>0;
 }
 release(resource:string,owner:string){this.db.prepare('DELETE FROM google_read_leases WHERE resource=? AND owner=?').run(resource,owner);}
 alive(resource:string,owner:string,now:number){return !!this.db.prepare('SELECT 1 FROM google_read_leases WHERE resource=? AND owner=? AND expires_at>?').get(resource,owner,now);}
 claim(scope:BudgetScope,force:boolean,now:number){
  const key=scopeKey(scope),resource='budget:'+key,owner=randomUUID();
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const record=this.record(scope),lease=this.db.prepare('SELECT expires_at FROM google_read_leases WHERE resource=?').get(resource);
   if(lease&&Number(lease.expires_at)>now){this.db.exec('COMMIT');return {claimed:false as const,reason:'running',nextAttemptAt:Number(lease.expires_at)};}
   const nextAttemptAt=Math.max(record?Date.parse(record.lastAttemptAt)+(force?30000:900000):0,record?.retryAt?Date.parse(record.retryAt):0);
   if(nextAttemptAt>now){this.db.exec('COMMIT');return {claimed:false as const,reason:'cooldown',nextAttemptAt};}
   if(!this.lease(resource,owner,now,budgetLeaseMs))throw new Error('Lease contention');
   this.db.prepare("INSERT INTO google_budget_snapshots(scope,state,last_attempt_at) VALUES (?,'pending',?) ON CONFLICT(scope) DO UPDATE SET state='pending',last_attempt_at=excluded.last_attempt_at,error_code=NULL,retry_at=NULL").run(key,new Date(now).toISOString());
   this.db.exec('COMMIT');return {claimed:true as const,owner};
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 finish(scope:BudgetScope,owner:string,result:{payload:BudgetPayload;usable:boolean}|{errorCode:string;retryAfterMs?:number},now:number){
  const key=scopeKey(scope),resource='budget:'+key;
  this.db.exec('BEGIN IMMEDIATE');
  try{
   if(!this.alive(resource,owner,now)){this.db.exec('COMMIT');return false;}
   if('payload' in result){
    const json=JSON.stringify(result.payload),at=new Date(now).toISOString();
    this.db.prepare("UPDATE google_budget_snapshots SET state='success',last_success_at=?,payload=?,last_usable=CASE WHEN ? THEN ? ELSE last_usable END,last_usable_at=CASE WHEN ? THEN ? ELSE last_usable_at END,error_code=NULL,retry_at=NULL WHERE scope=?").run(at,json,+result.usable,json,+result.usable,at,key);
   }else this.db.prepare("UPDATE google_budget_snapshots SET state='error',error_code=?,retry_at=? WHERE scope=?").run(result.errorCode,result.retryAfterMs?new Date(now+result.retryAfterMs).toISOString():null,key);
   this.release(resource,owner);this.db.exec('COMMIT');return true;
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 pendingAlive(scope:BudgetScope,now:number){return !!this.db.prepare('SELECT 1 FROM google_read_leases WHERE resource=? AND expires_at>?').get('budget:'+scopeKey(scope),now);}
}

export type BudgetPersistence = { [K in 'record'|'limits'|'setLimits'|'lease'|'release'|'alive'|'claim'|'finish'|'pendingAlive'|'tokenCache'|'saveTokenCache']: (...args:Parameters<BudgetStore[K]>)=>ReturnType<BudgetStore[K]>|Promise<ReturnType<BudgetStore[K]>> };
