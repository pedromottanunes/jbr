import type {FastifyInstance} from 'fastify';
import type {LocalSettings} from './local-settings.js';
export type BalanceEntry={id:string;kind:'baseline'|'credit';amountCents:number;at:string;note:string;accountId:string;currency:string;snapshotCostMicros:number};
export type BalanceLimits={minimumCents:number;warningDays:number;criticalDays:number};
const defaults:BalanceLimits={minimumCents:20000,warningDays:3,criticalDays:1};
const accountDay=(at:string,zone:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
const dailyCosts=(ads:any)=>{const days=new Map<string,number>(),seen=new Set<string>();for(const r of ads.daily??[]){const id=r.date+':'+r.campaignId;if(seen.has(id))throw new Error('Custos duplicados.');seen.add(id);const n=Math.round(Number(r.spend)*1e6);if(!Number.isSafeInteger(n)||n<0)throw new Error('Custo inválido.');days.set(r.date,(days.get(r.date)??0)+n);}return days;};
export function balanceEstimate(ads:any,entries:BalanceEntry[],limits:BalanceLimits=defaults,now=new Date().toISOString()){
 const accountId=String(ads.account?.id??''),currency=ads.currency??'BRL',zone=ads.timezone??'America/Sao_Paulo',today=accountDay(now,zone);
 const relevant=entries.filter(e=>e.accountId===accountId&&e.currency===currency&&e.at<=now).sort((a,b)=>a.at.localeCompare(b.at));
 const baseline=relevant.filter(e=>e.kind==='baseline').at(-1);
 const fresh=!!ads.connected&&Number.isFinite(Date.parse(ads.syncedAt))&&Date.parse(now)-Date.parse(ads.syncedAt)<=2*3600000&&ads.period?.end>=today;
 const common={accountId,currency,limits,asOf:ads.syncedAt??null,confirmedAt:baseline?.at??null,today,timezone:zone,fresh,entries:relevant.slice(-20).reverse(),balance:null as number|null,daysLeft:null as number|null,averageDaily:null as number|null};
 if(!baseline)return {...common,status:'unconfigured',reason:'Informe um saldo confirmado para iniciar a estimativa.'};
 const from=accountDay(baseline.at,zone);
 if(!ads.connected||!ads.period||ads.period.start>from||ads.period.end<today)return {...common,status:'unavailable',reason:'A coleta de gastos precisa cobrir a confirmação do saldo até hoje.'};
 const costs=dailyCosts(ads),spent=[...costs].filter(([date])=>date>=from&&date<=today).reduce((n,[,v])=>n+v,0)-baseline.snapshotCostMicros;
 const credits=relevant.slice(relevant.indexOf(baseline)+1).filter(e=>e.kind==='credit').reduce((n,e)=>n+e.amountCents,0);
 const balance=(baseline.amountCents+credits)/100-spent/1e6;
 const completed=Array.from({length:7},(_,i)=>new Date(Date.parse(today+'T12:00:00Z')-(i+1)*86400000).toISOString().slice(0,10));
 const averageDaily=completed.every(d=>d>=ads.period.start&&d<=ads.period.end)?completed.reduce((n,d)=>n+(costs.get(d)??0),0)/7e6:null;
 const daysLeft=averageDaily&&averageDaily>0?Math.max(0,balance)/averageDaily:null;
 const baselineOld=Date.parse(now)-Date.parse(baseline.at)>7*86400000;
 const status=!fresh||baselineOld?'stale':balance<=0||(daysLeft!==null&&daysLeft<=limits.criticalDays)?'critical':balance*100<=limits.minimumCents||(daysLeft!==null&&daysLeft<=limits.warningDays)?'warning':'ok';
 return {...common,balance,averageDaily,daysLeft,status,reason:!fresh?'Gastos desatualizados. Atualize a coleta antes de avaliar o saldo.':baselineOld?'Confirme novamente o saldo no Google Ads; a referência tem mais de 7 dias.':'Estimativa com base no saldo informado e nos gastos coletados. Créditos e ajustes do Google podem causar diferenças.'};
}
export function registerAdsBalance(app:FastifyInstance,store:LocalSettings,readAds:()=>Promise<any>){
 const entries=()=>store.db.prepare('SELECT * FROM balance_entries ORDER BY at,rowid').all().map(r=>({id:String(r.id),kind:r.kind as BalanceEntry['kind'],amountCents:Number(r.amount_cents),at:String(r.at),note:String(r.note),accountId:String(r.account_id),currency:String(r.currency),snapshotCostMicros:Number(r.snapshot_cost_micros)}));
 const limits=():BalanceLimits=>{const r=store.db.prepare("SELECT value FROM settings WHERE key='balance'").get();return r?JSON.parse(String(r.value)):defaults;};
 app.get('/api/v1/ads/balance',async()=>balanceEstimate(await readAds(),entries(),limits()));
 app.put<{Body:BalanceLimits}>('/api/v1/ads/balance/limits',{schema:{body:{type:'object',required:['minimumCents','warningDays','criticalDays'],additionalProperties:false,properties:{minimumCents:{type:'integer',minimum:0,maximum:100000000},warningDays:{type:'number',minimum:0,maximum:30},criticalDays:{type:'number',minimum:0,maximum:30}}}}},async(req,reply)=>{if(req.body.criticalDays>req.body.warningDays)return reply.code(400).send({message:'O limite crítico deve ser menor que o limite de atenção.'});store.db.prepare("INSERT INTO settings VALUES ('balance',?,1) ON CONFLICT(key) DO UPDATE SET value=excluded.value,revision=revision+1").run(JSON.stringify(req.body));return limits();});
 app.post<{Body:{id:string;kind:'baseline'|'credit';amountCents:number;note:string}}>('/api/v1/ads/balance/entries',{schema:{body:{type:'object',required:['id','kind','amountCents','note'],additionalProperties:false,properties:{id:{type:'string',pattern:'^[a-f0-9-]{36}$'},kind:{type:'string',enum:['baseline','credit']},amountCents:{type:'integer',minimum:0,maximum:100000000},note:{type:'string',maxLength:120}}}}},async(req,reply)=>{
  const ads=await readAds(),now=new Date().toISOString(),accountId=String(ads.account?.id??''),currency=ads.currency??'BRL';
  const old=store.db.prepare('SELECT * FROM balance_entries WHERE id=?').get(req.body.id);
  if(old){if(old.account_id!==accountId||old.kind!==req.body.kind||old.amount_cents!==req.body.amountCents||old.note!==req.body.note)return reply.code(409).send({message:'Identificador já usado para outro registro.'});return {saved:true};}
  const estimate=balanceEstimate(ads,entries(),limits(),now);
  if(!accountId||!estimate.fresh)return reply.code(409).send({message:'Atualize os gastos do Google Ads até hoje antes de registrar valores.'});
  if(req.body.kind==='credit'&&!estimate.confirmedAt)return reply.code(409).send({message:'Primeiro informe o saldo confirmado.'});
  const snapshot=dailyCosts(ads).get(estimate.today)??0;
  store.db.prepare('INSERT INTO balance_entries VALUES (?,?,?,?,?,?,?,?,?)').run(req.body.id,req.body.kind,req.body.amountCents,now,now,req.body.note,accountId,currency,snapshot);
  return {saved:true};
 });
}
export type BalanceReport=ReturnType<typeof balanceEstimate>;
