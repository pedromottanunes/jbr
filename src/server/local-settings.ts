import {DatabaseSync} from 'node:sqlite';
import type {FastifyInstance} from 'fastify';
import {defaultAttendanceConfig,type AttendanceConfig} from '../shared/business-hours.js';
export class LocalSettings {
 readonly db:DatabaseSync;
 constructor(path:string){
  this.db=new DatabaseSync(path);this.db.exec(`PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL;
   CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS balance_entries (id TEXT PRIMARY KEY,kind TEXT NOT NULL,amount_cents INTEGER NOT NULL,at TEXT NOT NULL,created_at TEXT NOT NULL,note TEXT NOT NULL,account_id TEXT NOT NULL,currency TEXT NOT NULL,snapshot_cost_micros INTEGER NOT NULL);
  `);
 }
 attendance(){const r=this.db.prepare("SELECT value,revision FROM settings WHERE key='attendance'").get();return {config:r?JSON.parse(String(r.value)) as AttendanceConfig:defaultAttendanceConfig,revision:Number(r?.revision??0)};}
 setAttendance(config:AttendanceConfig,revision:number){
  this.db.exec('BEGIN IMMEDIATE');try{if(this.attendance().revision!==revision)throw Object.assign(new Error('Configuração alterada em outra aba.'),{statusCode:409});this.db.prepare("INSERT INTO settings VALUES ('attendance',?,1) ON CONFLICT(key) DO UPDATE SET value=excluded.value,revision=revision+1").run(JSON.stringify(config));this.db.exec('COMMIT');return this.attendance();}catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 close(){this.db.close();}
}
export function registerAttendanceSettings(app:FastifyInstance,store:{attendance:()=>ReturnType<LocalSettings['attendance']>|Promise<ReturnType<LocalSettings['attendance']>>;setAttendance:(config:AttendanceConfig,revision:number)=>unknown}){
 app.get('/api/v1/attendance/config',async()=>store.attendance());
 app.put<{Body:AttendanceConfig&{revision:number}}>('/api/v1/attendance/config',{schema:{body:{type:'object',additionalProperties:false,required:['saturdayFrom','slaMinutes','revision'],properties:{saturdayFrom:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},slaMinutes:{type:'integer',minimum:1,maximum:480},revision:{type:'integer',minimum:0}}}}},async(req,reply)=>{
  const {revision,...config}=req.body;const date=new Date(config.saturdayFrom+'T12:00:00Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==config.saturdayFrom)return reply.code(400).send({message:'Data inválida.'});
  return store.setAttendance(config,revision);
 });
}
