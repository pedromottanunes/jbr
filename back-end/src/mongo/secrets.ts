import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import type {MongoContext} from './connection.js';
import {BudgetError} from '../account-budget.js';
import {LocalGoogleTokens} from '../integrations/google-oauth.js';
import {MongoBudgetStore} from './settings.js';

export function protectSecret(value:string,encrypt:boolean){
 const key=Buffer.from(process.env.CREDENTIALS_ENCRYPTION_KEY??'','base64');if(key.length!==32)throw new BudgetError('credential_storage');
 if(encrypt){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const bytes=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return ['v1',iv.toString('base64'),cipher.getAuthTag().toString('base64'),bytes.toString('base64')].join('.');}
 try{const [version,iv,tag,bytes]=value.split('.');if(version!=='v1')throw new Error();const cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64'));cipher.setAuthTag(Buffer.from(tag,'base64'));return Buffer.concat([cipher.update(Buffer.from(bytes,'base64')),cipher.final()]).toString('utf8');}catch{throw new BudgetError('credential_storage');}
}
export async function storeSecret(ctx:MongoContext,id:string,value:string){if(!value)throw new BudgetError('configuration');await ctx.collection('integration_credentials').updateOne({_id:id},{$set:{encrypted:protectSecret(value,true),updatedAt:new Date()}},{upsert:true});}
export async function readSecret(ctx:MongoContext,id:string){const r=await ctx.collection('integration_credentials').findOne({_id:id});if(!r)throw new BudgetError('reconnect');return protectSecret(r.encrypted,false);}
export function mongoGoogleTokens(ctx:MongoContext){return new LocalGoogleTokens(new MongoBudgetStore(ctx),{clientId:process.env.GOOGLE_ADS_CLIENT_ID??'',clientSecret:process.env.GOOGLE_ADS_CLIENT_SECRET??'',refreshPath:'atlas:google-refresh',environment:process.env.CRM_ENVIRONMENT??'local',readRefresh:()=>readSecret(ctx,'google-refresh')},fetch,async(v,e)=>protectSecret(v,e));}
