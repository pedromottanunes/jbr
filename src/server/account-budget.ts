export type BudgetState = 'available'|'unlimited'|'unavailable'|'pending'|'error';
export type BudgetScope = {environment:string;clientId:string;customerId:string};
export type BudgetLimits = {urgentCents:number;attentionCents:number;urgentDays:number;attentionDays:number};
export const defaultBudgetLimits:BudgetLimits={urgentCents:10000,attentionCents:50000,urgentDays:2,attentionDays:5};
export type AccountBudget = {id:string;status:string;start:string|null;proposedStart:string|null;end:string|null;endType:string|null;limitMicros:string|null;limitType:string|null;servedMicros:string|null};
export type BudgetPayload = {customerId:string;currency:string;timezone:string;budgets:AccountBudget[]};
export class BudgetError extends Error {
 constructor(public readonly code:string, public readonly retryAfterMs=0){super(code);}
}
export function customerId(value:string){const id=value.replace(/-/g,'').trim();if(!/^\d{10}$/.test(id))throw new BudgetError('configuration');return id;}
export function streamRows(value:unknown):Record<string,any>[] {
 if(!Array.isArray(value)||value.some(b=>!b||typeof b!=='object'||Array.isArray(b)||(b.results!==undefined&&!Array.isArray(b.results))))throw new BudgetError('invalid_response');
 const rows=value.flatMap(b=>b.results??[]);
 if(rows.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw new BudgetError('invalid_response');
 return rows;
}
function optionalString(value:unknown){if(value===undefined||value===null)return null;if(typeof value!=='string')throw new BudgetError('invalid_response');return value.trim()||null;}
function micros(value:unknown){
 if(value===undefined||value===null)return null;
 if(typeof value==='number'){if(!Number.isSafeInteger(value)||value<0)throw new BudgetError('invalid_response');value=String(value);}
 if(typeof value!=='string'||!/^\d{1,19}$/.test(value)||BigInt(value)>9223372036854775807n)throw new BudgetError('invalid_response');
 return BigInt(value).toString();
}
function account(value:any,expected:string){
 if(!value||String(value.id)!==expected)throw new BudgetError('account_mismatch');
 if(typeof value.currencyCode!=='string'||!/^[A-Z]{3}$/.test(value.currencyCode)||typeof value.timeZone!=='string')throw new BudgetError('invalid_response');
 try{new Intl.DateTimeFormat('en',{timeZone:value.timeZone}).format();new Intl.NumberFormat('en',{style:'currency',currency:value.currencyCode}).format(1);}catch{throw new BudgetError('invalid_response');}
 return {customerId:expected,currency:value.currencyCode,timezone:value.timeZone};
}
export function parseBudgetPayload(accountResponse:unknown,budgetResponse:unknown,requestedId:string):BudgetPayload {
 const id=customerId(requestedId),accounts=streamRows(accountResponse);
 if(accounts.length!==1)throw new BudgetError('invalid_response');
 const meta=account(accounts[0].customer,id),seen=new Set<string>();
 const budgets=streamRows(budgetResponse).map(row=>{
  const rowAccount=account(row.customer,id);
  if(rowAccount.currency!==meta.currency||rowAccount.timezone!==meta.timezone)throw new BudgetError('invalid_response');
  const b=row.accountBudget;
  if(!b||typeof b.id!=='string'||!/^\d+$/.test(b.id)||typeof b.status!=='string'||seen.has(b.id))throw new BudgetError('invalid_response');
  seen.add(b.id);
  return {id:b.id,status:b.status,start:optionalString(b.approvedStartDateTime),proposedStart:optionalString(b.proposedStartDateTime),end:optionalString(b.approvedEndDateTime),endType:optionalString(b.approvedEndTimeType),limitMicros:micros(b.adjustedSpendingLimitMicros),limitType:optionalString(b.adjustedSpendingLimitType),servedMicros:micros(b.amountServedMicros)};
 });
 return {...meta,budgets};
}
export function localAccountTime(now:string,timezone:string){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
 return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
function validLocalTime(value:string|null):value is string {
 if(!value||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value))return false;
 const at=Date.parse(value.replace(' ','T')+'Z');return Number.isFinite(at)&&new Date(at).toISOString().slice(0,19).replace('T',' ')===value;
}
export function microsDecimal(value:string){const v=BigInt(value);return `${v/1000000n}.${(v%1000000n).toString().padStart(6,'0')}`;}
export function selectBudget(payload:BudgetPayload,now:string){
 const base={customerId:payload.customerId,currency:payload.currency,timezone:payload.timezone,budgetId:null as string|null,start:null as string|null,end:null as string|null,remaining:null as string|null,limit:null as string|null,served:null as string|null,remainingMicros:null as string|null};
 const unavailable=(reason:string)=>({...base,status:'unavailable' as const,reason});
 const localNow=localAccountTime(now,payload.timezone),active:AccountBudget[]=[];
 for(const b of payload.budgets){
  if(b.status!=='APPROVED')continue;
  const start=b.start??b.proposedStart;
  if(!validLocalTime(start))return unavailable('O início de vigência não foi informado de forma válida.');
  if(start>localNow)continue;
  if(b.endType==='NOW')continue;
  if(b.endType==='FOREVER'){
   if(b.end)return unavailable('O término de vigência precisa ser conferido.');
  }else{
   if(!validLocalTime(b.end))return unavailable('O término de vigência não está disponível.');
   if(b.end<=start)return unavailable('A vigência retornada precisa ser conferida.');
   if(b.end<=localNow)continue;
  }
  active.push(b);
 }
 if(!active.length)return unavailable('Nenhum orçamento de conta aprovado e vigente foi disponibilizado. O recurso depende da configuração de faturamento mensal.');
 if(active.length>1)return unavailable('Mais de um orçamento parece vigente. Confira os orçamentos de conta no Google Ads.');
 const b=active[0],selected={...base,budgetId:b.id,start:b.start??b.proposedStart,end:b.end,limit:b.limitMicros!==null?microsDecimal(b.limitMicros):null,served:b.servedMicros!==null?microsDecimal(b.servedMicros):null};
 if(b.limitType==='INFINITE')return {...selected,status:'unlimited' as const,reason:'Orçamento de conta sem limite financeiro definido.'};
 if(b.limitType&&b.limitType!=='UNSPECIFIED')return {...selected,status:'unavailable' as const,reason:'O tipo de limite retornado não permite o cálculo.'};
 if(b.limitMicros===null||b.servedMicros===null)return {...selected,status:'unavailable' as const,reason:'Limite ajustado ou valor veiculado ausente. Não é possível calcular o restante.'};
 const difference=BigInt(b.limitMicros)-BigInt(b.servedMicros),remainingMicros=(difference>0n?difference:0n).toString();
 return {...selected,status:'available' as const,remainingMicros,remaining:microsDecimal(remainingMicros),reason:'Limite ajustado menos o valor dos anúncios veiculados, na vigência da conta.'};
}
export function budgetForecast(ads:any,payload:BudgetPayload,remainingMicros:string|null,now:string){
 const missing={averageDaily:null as string|null,days:null as number|null,reason:'Gastos recentes insuficientes ou desatualizados para prever a duração.'};
 if(remainingMicros===null||!ads?.connected||String(ads.account?.id)!==payload.customerId||ads.currency!==payload.currency||ads.timezone!==payload.timezone||!Array.isArray(ads.daily))return missing;
 const age=Date.parse(now)-Date.parse(ads.syncedAt);if(!Number.isFinite(age)||age<0||age>3600000)return missing;
 const today=localAccountTime(now,payload.timezone).slice(0,10);
 const days=Array.from({length:7},(_,i)=>new Date(Date.parse(today+'T12:00:00Z')-(i+1)*86400000).toISOString().slice(0,10));
 if(!ads.period||days.some(d=>d<ads.period.start||d>ads.period.end))return missing;
 let total=0n;const seen=new Set<string>();
 for(const row of ads.daily){
  if(!days.includes(row.date))continue;
  const key=`${row.date}:${row.campaignId}`;
  if(!row.campaignId||seen.has(key)||typeof row.spend!=='number'||!Number.isFinite(row.spend)||row.spend<0)return missing;
  seen.add(key);const value=Math.round(row.spend*1000000);if(!Number.isSafeInteger(value))return missing;total+=BigInt(value);
 }
 if(total===0n)return {...missing,averageDaily:'0.000000',reason:'O gasto dos últimos sete dias completos é zero; não há previsão de duração.'};
 const average=total/7n;
 const estimatedDays=Number(BigInt(remainingMicros))/Number(total)*7;
 return {averageDaily:microsDecimal(average.toString()),days:Number.isFinite(estimatedDays)?estimatedDays:null,reason:'Estimativa pelos últimos sete dias completos; não garante quando os anúncios pararão.'};
}
export function budgetAlert(remaining:string|null,days:number|null,limits:BudgetLimits,usable:boolean){
 if(!usable||remaining===null)return null;
 const value=BigInt(remaining);
 if(value===0n)return 'exhausted' as const;
 if(value<=BigInt(limits.urgentCents)*10000n||(days!==null&&days<=limits.urgentDays))return 'urgent' as const;
 if(value<=BigInt(limits.attentionCents)*10000n||(days!==null&&days<=limits.attentionDays))return 'attention' as const;
 return 'normal' as const;
}
