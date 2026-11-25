import type {MongoContext} from './connection.js';
import type {Period} from '../../../shared/period.js';
import {enqueue,jobStatus} from './jobs.js';
import {attendanceAnalysisVersion,missingAttendancePeriods,periodBounds,periodDays} from './attendance-period.js';

export async function ensureAttendanceCoverage(ctx:MongoContext,period:Period,refresh=false,now=new Date()){
 periodBounds(period,now);
 const rows=await ctx.collection('attendance_coverage').find({_id:{$in:periodDays(period)}}).maxTimeMS(10000).toArray();
 const missing=refresh?[period]:missingAttendancePeriods(period,rows,now);
 const job=await jobStatus(ctx,'umbler');
 if(!missing.length)return {...job,status:'current',period,missingDays:0};
 if(process.env.INTEGRATIONS_ENABLED!=='true')return {...job,status:'disabled',period,missingDays:missing.flatMap(periodDays).length};
 // An error remains visible throughout the provider's backoff, even if the
 // user changes filters or opens another browser tab.
 if(job.status==='error'&&job.nextAttemptAt&&Date.parse(job.nextAttemptAt)>+now)return {...job,period};
 const queued=await enqueue(ctx,'umbler',{periods:missing,maxRequests:150,automatic:!refresh});
 return {...queued,period,missingDays:missing.flatMap(periodDays).length};
}

export async function markAttendanceCoverage(ctx:MongoContext,owner:string,period:Period,observedAt:string){
 await ctx.transaction(async session=>{
  const held=await ctx.collection('integration_leases').updateOne({_id:'umbler',owner,expiresAt:{$gt:new Date()}},{$set:{expiresAt:new Date(Date.now()+120000)}},{session});
  if(!held.matchedCount)throw new Error('Posse da coleta expirada.');
  await ctx.collection('attendance_coverage').bulkWrite(periodDays(period).map(day=>({updateOne:{filter:{_id:day},update:{$set:{version:attendanceAnalysisVersion,checkedAt:new Date(),observedAt}},upsert:true}})),{session});
 });
}
