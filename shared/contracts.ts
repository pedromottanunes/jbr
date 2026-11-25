// JSON contracts shared by the API and browser. No server imports or credentials.
import type {AttendanceConfig} from './business-hours.js';
import type {Period} from './period.js';

export type AdMetrics={impressions:number;clicks:number;spend:number;conversions:number};
export type AdRow=AdMetrics&{id:string;name:string;campaign:string;campaignId:string;group:string;status:string;type:string;budget?:number;strategy?:string;share?:number|null;optimization?:number|null;texts?:string[]};
type ChartPoint={label:string;metrics:AdMetrics};
export type AdsDetail={
  available:boolean;period:Period;coverage:Period|null;timezone:string;currency:string;syncedAt:string|null;
  campaignOptions:{id:string;name:string}[];total:AdMetrics|null;
  daily:(ChartPoint&{date:string})[];weekdays:ChartPoint[];hours:ChartPoint[]|null;
  campaigns:AdRow[];keywords:AdRow[]|null;groups:AdRow[]|null;terms:AdRow[]|null;ads:AdRow[]|null;
};

export type BudgetState='available'|'unlimited'|'unavailable'|'pending'|'error';
export type BudgetLimits={urgentCents:number;attentionCents:number;urgentDays:number;attentionDays:number};
type BudgetReading={
  asOf:string;status:'available'|'unlimited'|'unavailable';reason:string;customerId:string;currency:string;timezone:string;
  budgetId:string|null;start:string|null;end:string|null;remaining:string|null;limit:string|null;served:string|null;remainingMicros:string|null;
};
export type BudgetReport={
  status:BudgetState;reason:string;stale:boolean;currency:string|null;timezone:string|null;customerId:string;
  budgetId:string|null;start:string|null;end:string|null;remaining:string|null;limit:string|null;served:string|null;
  lastAttemptAt:string|null;lastSuccessAt:string|null;previousReading:BudgetReading|null;
  forecast:{averageDaily:string|null;days:number|null;reason:string};
  alert:'exhausted'|'urgent'|'attention'|'normal'|null;limits:BudgetLimits;nextAttemptAt:string|null;source:string;
};

type TimeSummary={median:number|null;average:number|null;p90:number|null};
type ResponseSummary={count:number;wall:TimeSummary;business:TimeSummary};
export type AgentPerformance={
  period:Period;config:AttendanceConfig;basis:string;
  coverage:{eligibleChats:number;partialChats:number;unknownAuthors:number};
  items:{
    id:string;name:string;human:boolean;active:boolean;assigned:number;responded:number;leads:number;messages:number;
    first:ResponseSummary;following:ResponseSummary;queue:TimeSummary;firstSlaRate:number|null;
    withinSla:number;firstUnknown:number;noReply:number;transfersIn:number;transfersOut:number;closed:number;reopened:number;
    pending:{chatId:string;label:string;minutes:number;businessMinutes:number;at:string;observedAt:string}[];
    details:{chatId:string;label:string;at:string;kind:string;wall:number|null;business:number|null;bucket:string}[];
  }[];
};
