import type {MongoContext} from './connection.js';
import {runWorkerOnce,schedule} from './worker.js';
import {pause} from './cancellation.js';
import {maintainPublications} from './publication-gc.js';
import {resumeContentPurge} from './message-retention.js';

// Both deployment modes consume the same durable queue and provider leases.
// No overlapping tick: each batch finishes before the next iteration begins.
export async function runWorkerLoop(ctx:MongoContext,signal:AbortSignal,report:(message:string)=>void=console.error){
 // Two bounded lanes: Meta cannot be blocked by Google publication or Umbler history.
 // Provider leases still prevent duplicate work across local/Render instances.
 await Promise.all([runMainLoop(ctx,signal,report),runMetaLoop(ctx,signal,report)]);
}
async function runMetaLoop(ctx:MongoContext,signal:AbortSignal,report:(message:string)=>void){
 let failures=0;
 while(!signal.aborted){
  try{if(process.env.INTEGRATIONS_ENABLED==='true')await runWorkerOnce(ctx,signal,'meta');failures=0;}
  catch{if(!signal.aborted){failures++;report('Coleta Meta aguardando recuperação.');}}
  if(!signal.aborted)await pause(process.env.INTEGRATIONS_ENABLED!=='true'?30000:Math.min(60000,5000*2**Math.min(failures,4)),signal).catch(error=>{if(!signal.aborted)throw error;});
 }
}
async function runMainLoop(ctx:MongoContext,signal:AbortSignal,report:(message:string)=>void){
 let nextSchedule=0,nextMaintenance=0,failures=0;
 while(!signal.aborted){
  try{
   if(Date.now()>=nextMaintenance){await maintainPublications(ctx,signal);nextMaintenance=Date.now()+60000;}
   if(process.env.INTEGRATIONS_ENABLED==='true'){
    if(process.env.SYNC_SCHEDULER_ENABLED==='true'&&Date.now()>=nextSchedule){await schedule(ctx);nextSchedule=Date.now()+60000;}
    await runWorkerOnce(ctx,signal,'main');
   }else await resumeContentPurge(ctx,signal);
   failures=0;
  }catch{if(!signal.aborted){failures++;report('Worker aguardando recuperação da conexão.');}}
  if(!signal.aborted)await pause(process.env.INTEGRATIONS_ENABLED!=='true'?30000:Math.min(60000,5000*2**Math.min(failures,4)),signal).catch(error=>{if(!signal.aborted)throw error;});
 }
}
