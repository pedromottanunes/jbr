import {ReadGate,ProviderReadError} from '../integrations/read-transport.js';
import type {MongoContext} from './connection.js';
import {pause,checkSignal} from './cancellation.js';
export class PersistentReadGate extends ReadGate {
 constructor(ctx:MongoContext,provider:string,interval:number,guard:()=>Promise<void>,fetcher:typeof fetch=fetch,signal?:AbortSignal){
  super(interval,async(input,init)=>{
   await guard();const limits=ctx.collection('provider_limits'),now=Date.now(),stored=await limits.findOne({_id:provider});
   const wait=Math.max(0,+(stored?.nextAt??0)-now);if(wait>30000)throw new ProviderReadError(429,'Provedor em espera.',wait);
   if(wait)await pause(wait,signal);await guard();checkSignal(signal);
   await limits.updateOne({_id:provider},{$set:{nextAt:new Date(Date.now()+interval)}},{upsert:true});
   const response=await fetcher(input,init);
   if(response.status===429||response.status>=500){const raw=response.headers.get('retry-after');const delay=raw?(Number.isFinite(Number(raw))?Number(raw)*1000:Date.parse(raw)-Date.now()):5000;await limits.updateOne({_id:provider},{$max:{nextAt:new Date(Date.now()+Math.max(interval,delay||5000))}},{upsert:true});}
   return response;
  },signal);
 }
}
