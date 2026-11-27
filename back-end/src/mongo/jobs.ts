import type {MongoContext} from './connection.js';
import {validPeriod, type Period} from '../../../shared/period.js';
import {mergeAttendancePeriods,subtractPeriods,umblerPeriods,missingAttendancePeriods,periodDays} from './attendance-period.js';
import {mergeMetaPeriods} from '../../../shared/meta.js';

export type JobKind = 'google' | 'umbler' | 'budget' | 'meta';
const active = (status: string) => status === 'queued' || status === 'running';
export function mergePeriods(...values: any[]): Period | undefined {
  const periods = values.filter(p => p?.start && p?.end) as Period[];
  if (!periods.length) return undefined;
  const period = {start: periods.map(p => p.start).sort()[0], end: periods.map(p => p.end).sort().at(-1)!};
  if (!periods.every(validPeriod) || !validPeriod(period)) throw Object.assign(new Error('A cobertura total deve caber em 366 dias.'), {statusCode: 400});
  return period;
}
export async function jobStatus(ctx: MongoContext, kind: JobKind) {
  const r = await ctx.collection('sync_jobs').findOne({_id: kind});
  return r ? {
    status: active(r.status) ? 'running' : r.status,
    startedAt: r.startedAt?.toISOString(), completedAt: r.completedAt?.toISOString(), revision: r.revision,
    nextAttemptAt: r.availableAt?.toISOString(),
    publishedAt:r.publishedAt?.toISOString(),
    periods:r.payload?.periods,
    period: r.payload?.start ? {start: r.payload.start, end: r.payload.end} : undefined,
    message: r.message,
  } : {status: 'idle'};
}

// Coalesce tabs and retain a broader period requested while a job is running.
export async function enqueue(ctx: MongoContext, kind: JobKind, payload: Record<string, unknown> = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await ctx.transaction(async session => {
        const jobs = ctx.collection('sync_jobs'), r = await jobs.findOne({_id: kind}, {session}), now = new Date();
        let requested=payload;
        if(kind==='meta'){
          const periods=mergeMetaPeriods((payload.periods??[]) as Period[]);if(!periods.length)throw new Error('Período Meta ausente.');
          requested={periods};
          if(r&&active(r.status)){
            const merged=mergeMetaPeriods(r.payload.periods,periods);
            await jobs.updateOne({_id:kind},{$set:{'payload.periods':merged}},{session});return;
          }
        }
        if(kind==='umbler'){
          let periods=umblerPeriods(payload,now);
          if(payload.automatic){
            const days=[...new Set(periods.flatMap(periodDays))];
            const coverage=await ctx.collection('attendance_coverage').find({_id:{$in:days}},{session}).toArray();
            periods=mergeAttendancePeriods(periods.flatMap(p=>missingAttendancePeriods(p,coverage,now)));
            if(!periods.length)return;
          }
          requested={periods,maxRequests:Math.min(150,Math.max(1,Number(payload.maxRequests??150))),automatic:!!payload.automatic};
        }
        if (r && active(r.status)) {
          if(kind==='umbler'){
            const extra=subtractPeriods((requested as any).periods,[...umblerPeriods(r.payload,now),...(r.pendingPayload?.periods??[])]);
            if(extra.length)await jobs.updateOne({_id:kind},{$set:{pendingPayload:{periods:mergeAttendancePeriods([...(r.pendingPayload?.periods??[]),...extra]),maxRequests:150,automatic:true}}},{session});
            return;
          }
          if (kind !== 'google') return;
          const merged = mergePeriods(r.payload, r.pendingPayload, payload);
          const current = r.pendingPayload ?? r.payload;
          if (!merged || (current?.start === merged.start && current?.end === merged.end)) return;
          await jobs.updateOne({_id: kind}, {$set: {[r.status === 'running' ? 'pendingPayload' : 'payload']: merged}}, {session});
          return;
        }
        if (kind === 'google') mergePeriods(payload);
        await jobs.updateOne({_id: kind}, {
          $set: {kind, status: 'queued', payload:requested, attempts: 0, batches:0, availableAt: new Date(Math.max(+now, +(r?.availableAt ?? 0))), requestedAt: now, message: null},
          $inc: {revision: 1}, $unset: {owner: '', leaseUntil: '', pendingPayload: '', completedAt: ''},
        }, {upsert: true, session});
      });
      return jobStatus(ctx, kind);
    } catch (e) { if ((e as any).code !== 11000 || attempt === 3) throw e; }
  }
  throw new Error('Fila ocupada.');
}

export async function completeJob(ctx: MongoContext, id: string, owner: string, result?:{status:string}) {
  await ctx.transaction(async session => {
    const jobs = ctx.collection('sync_jobs');
    const r = await jobs.findOne({_id: id, owner, status: 'running', leaseUntil: {$gt: new Date()}}, {session});
    if (!r) throw new Error('Posse da tarefa expirada.');
    if(r.kind==='meta'){
      const remaining=r.payload.periods.slice(1);
      await jobs.updateOne({_id:id,owner},{$set:{status:remaining.length?'queued':'complete',completedAt:new Date(),publishedAt:new Date(),availableAt:new Date(Date.now()+30000),attempts:0,message:null,'payload.periods':remaining},$unset:{owner:'',leaseUntil:''}},{session});return;
    }
    if(r.kind==='umbler'){
      const partial=result?.status==='partial',current=umblerPeriods(r.payload,r.requestedAt),remaining=partial?current:current.slice(1);
      // Keep the current interval stable while its discovery/history pages resume.
      const rest=subtractPeriods(r.pendingPayload?.periods??[],remaining);
      const periods=[...remaining,...rest],batches=Number(r.batches??0)+1;
      const delay=partial&&batches%6===0?15*60_000:60_000;
      await jobs.updateOne({_id:id,owner},{
        $set:{status:periods.length?'queued':'complete',completedAt:new Date(),publishedAt:new Date(),availableAt:new Date(Date.now()+delay),attempts:0,batches,
          message:partial?'Análise parcial salva. A coleta continuará do ponto registrado.':null,
          payload:{...r.payload,periods},...(!partial?{requestedAt:new Date()}:{}),
        },$unset:{owner:'',leaseUntil:'',pendingPayload:''},
      },{session});
      return;
    }
    await jobs.updateOne({_id: id, owner}, {
      $set: {status: r.pendingPayload ? 'queued' : 'complete', completedAt: new Date(), availableAt: new Date(Date.now() + 30000), message: null,
        ...(r.pendingPayload ? {payload: r.pendingPayload, attempts: 0, requestedAt: new Date()} : {})},
      ...(r.pendingPayload ? {$inc: {revision: 1}} : {}),
      $unset: {owner: '', leaseUntil: '', pendingPayload: ''},
    }, {session});
  });
}
