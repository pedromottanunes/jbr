import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import type {FastifyInstance} from 'fastify';
import {validPeriod,type Period} from '../shared/period.js';

export function registerGoogleSync(app:FastifyInstance,readAds:()=>Promise<any>){
 let job:{status:'idle'|'running'|'complete'|'error';period?:Period;message?:string}={status:'idle'};
 app.get('/api/v1/ads/sync',async()=>job);
 app.post<{Body:Period&{refresh?:boolean}}>('/api/v1/ads/sync',{schema:{body:{type:'object',required:['start','end'],additionalProperties:false,properties:{start:{type:'string',maxLength:10},end:{type:'string',maxLength:10},refresh:{type:'boolean'}}}}},async(req,reply)=>{
  if(!validPeriod(req.body))return reply.code(400).send({message:'Selecione até 366 dias válidos.'});
  const ads=await readAds();
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:ads.timezone??'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  if(req.body.end>today)return reply.code(400).send({message:'O período não pode terminar no futuro.'});
  if(!req.body.refresh&&ads.connected&&req.body.start>=ads.period.start&&req.body.end<=ads.period.end)return {status:'complete',period:req.body};
  if(job.status==='running')return reply.code(202).send(job);
  if(!req.body.refresh&&job.status==='error'&&job.period?.start===req.body.start&&job.period.end===req.body.end)return job;
  const union={start:ads.period?.start&&ads.period.start<req.body.start?ads.period.start:req.body.start,end:ads.period?.end&&ads.period.end>req.body.end?ads.period.end:req.body.end};
  if(!validPeriod(union))return reply.code(400).send({message:'A cobertura total deve caber em 366 dias.'});
  job={status:'running',period:req.body};
  const child=spawn('powershell.exe',['-NoProfile','-File',resolve('scripts/sync-google.ps1'),'-Start',union.start,'-End',union.end],{cwd:process.cwd(),windowsHide:true,stdio:'ignore'});
  child.once('error',()=>{job={...job,status:'error',message:'Não foi possível iniciar a coleta Google.'};});
  child.once('exit',code=>{job={...job,status:code===0?'complete':'error',...(code===0?{}:{message:'A coleta não terminou. Os dados anteriores foram preservados. Execute a sincronização manual para retomar.'})};});
  return reply.code(202).send(job);
 });
}
