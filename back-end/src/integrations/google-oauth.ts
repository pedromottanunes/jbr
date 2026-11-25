import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import type {BudgetPersistence} from '../budget-store.js';
import {BudgetError} from '../account-budget.js';

export interface GoogleTokenProvider {get(force?:boolean,previousToken?:string):Promise<string>}
export async function windowsProtect(value:string,encrypt:boolean):Promise<string>{
 if(process.platform!=='win32')throw new BudgetError('credential_storage');
 const command=encrypt?"$s=[Console]::In.ReadToEnd() | ConvertTo-SecureString -AsPlainText -Force; try {$s | ConvertFrom-SecureString} finally {$s.Dispose()}":"$s=[Console]::In.ReadToEnd() | ConvertTo-SecureString; try {[System.Net.NetworkCredential]::new('', $s).Password} finally {$s.Dispose()}";
 return new Promise((resolve,reject)=>{
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; "+command],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let output='';const timeout=setTimeout(()=>{child.kill();reject(new BudgetError('credential_storage'));},15000);
  child.stdout.on('data',chunk=>{output+=chunk;if(output.length>20000)child.kill();});child.stderr.resume();child.stdin.on('error',()=>{});
  child.on('error',()=>{clearTimeout(timeout);reject(new BudgetError('credential_storage'));});
  child.on('close',code=>{clearTimeout(timeout);if(code===0&&output.trim())resolve(output.trim());else reject(new BudgetError('credential_storage'));});child.stdin.end(value);
 });
}
export class LocalGoogleTokens implements GoogleTokenProvider {
 private inFlight:Promise<string>|undefined;
 private memory:{token:string;expires:number}|undefined;
 private readonly key:string;
 constructor(private readonly store:BudgetPersistence,private readonly options:{clientId:string;clientSecret:string;refreshPath:string;environment:string;readRefresh?:()=>Promise<string>},private readonly fetcher:typeof fetch=fetch,private readonly protect=windowsProtect){
  this.key=createHash('sha256').update(JSON.stringify([options.environment,options.clientId,options.refreshPath])).digest('hex');
 }
 async get(force=false,previousToken?:string):Promise<string>{
  if(this.memory&&this.memory.expires>Date.now()+120000&&(!force||this.memory.token!==previousToken))return this.memory.token;
  if(this.inFlight)return this.inFlight;
  this.inFlight=this.refresh(force,previousToken).finally(()=>{this.inFlight=undefined;});return this.inFlight;
 }
 private async refresh(force:boolean,previous?:string){
  const resource='oauth:'+this.key,owner=randomUUID(),deadline=Date.now()+65000;
  while(true){
   const cached=await this.store.tokenCache(this.key);
   if(cached&&Number(cached.expires_at)>Date.now()+120000){
    try{const token=await this.protect(String(cached.encrypted),false);if(!force||token!==previous){this.memory={token,expires:Number(cached.expires_at)};return token;}}catch{/* Recover a cache that cannot be decrypted by this Windows identity. */}
   }
   if(await this.store.lease(resource,owner,Date.now(),120000))break;
   if(Date.now()>=deadline)throw new BudgetError('oauth_busy');
   await new Promise(resolve=>setTimeout(resolve,250));
  }
  try{
   const latest=await this.store.tokenCache(this.key);
   if(latest&&Number(latest.expires_at)>Date.now()+120000){try{const token=await this.protect(String(latest.encrypted),false);if(!force||token!==previous){this.memory={token,expires:Number(latest.expires_at)};return token;}}catch{/* Refresh below. */}}
   if(!this.options.clientId||!this.options.clientSecret)throw new BudgetError('configuration');
   let refreshToken:string;
   try{refreshToken=this.options.readRefresh?await this.options.readRefresh():await this.protect(await readFile(this.options.refreshPath,'utf8'),false);}catch{throw new BudgetError('reconnect');}
   const body=new URLSearchParams({client_id:this.options.clientId,client_secret:this.options.clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'});
   let result:any;
   for(let attempt=0;attempt<3;attempt++){
    try{
     const response=await this.fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,redirect:'error',signal:AbortSignal.timeout(20000)});
     if(!response.ok){
      const retry=response.headers.get('retry-after'),delay=retry?(Number.isFinite(Number(retry))?Number(retry)*1000:Date.parse(retry)-Date.now()):0;
      throw new BudgetError(response.status===400||response.status===401?'reconnect':response.status===403?'permission':response.status===429?'rate_limit':'temporary',Number.isFinite(delay)?Math.max(0,delay):0);
     }
     result=await response.json();break;
    }catch(e){
     const error=e instanceof BudgetError?e:new BudgetError('temporary');
     if(!['temporary','rate_limit'].includes(error.code)||attempt===2||error.retryAfterMs>5000)throw error;
     await new Promise(resolve=>setTimeout(resolve,Math.max(error.retryAfterMs,1000*2**attempt)));
    }
   }
   if(typeof result.access_token!=='string'||!Number.isFinite(result.expires_in)||result.expires_in<60)throw new BudgetError('invalid_response');
   const expires=Date.now()+Math.min(result.expires_in,86400)*1000,encrypted=await this.protect(result.access_token,true);
   await this.store.saveTokenCache(this.key,encrypted,expires);
   this.memory={token:result.access_token,expires};return result.access_token as string;
  }finally{await this.store.release(resource,owner);}
 }
}
