import { ReadGate } from './read-transport.js';

function numericId(value: string): string {
  const id = value.replace(/-/g, '');
  if (!/^\d{10}$/.test(id)) throw new Error('ID de conta Google Ads inválido.');
  return id;
}

function date(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error('Data inválida.');
  return value;
}

export function campaignDailyQuery(from: string, to: string): string {
  const start = date(from), end = date(to);
  if (start > end) throw new Error('Período invertido.');
  if ((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 > 31) throw new Error('Consulta acima de 31 dias.');
  return `SELECT segments.date, campaign.id, campaign.name, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${start}' AND '${end}'`;
}

export class GoogleAdsReader {
  constructor(private readonly options: { accessToken: string; developerToken?: string; version: string; loginCustomerId?: string }, private readonly gate: ReadGate = new ReadGate(1_000)) {}

  async campaigns(customerId: string, from: string, to: string): Promise<unknown> {
    return this.query(customerId, campaignDailyQuery(from, to));
  }

  account(customerId:string) { return this.query(customerId, 'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1'); }
  conversionActions(customerId:string) { return this.query(customerId, 'SELECT conversion_action.id, conversion_action.name, conversion_action.status, conversion_action.type, conversion_action.category, conversion_action.primary_for_goal FROM conversion_action'); }
  report(customerId:string,kind:GoogleReport,from:string,to:string) {return this.query(customerId,reportQuery(kind,from,to));}
  dailyConversions(customerId:string,from:string,to:string) {
    campaignDailyQuery(from,to);
    return this.query(customerId, `SELECT segments.date, segments.conversion_action, segments.conversion_action_name, metrics.all_conversions_by_conversion_date FROM customer WHERE segments.date BETWEEN '${from}' AND '${to}'`);
  }
  private async query(customerId:string,query:string):Promise<unknown> {
    if (!/^v\d+$/.test(this.options.version)) throw new Error('Versão Google Ads inválida.');
    const id = numericId(customerId);
    const headers: Record<string, string> = { Authorization: `Bearer ${this.options.accessToken}`, 'Content-Type': 'application/json' };
    if (this.options.developerToken) headers['developer-token'] = this.options.developerToken;
    if (this.options.loginCustomerId) headers['login-customer-id'] = numericId(this.options.loginCustomerId);
    const url = new URL(`https://googleads.googleapis.com/${this.options.version}/customers/${id}/googleAds:searchStream`);
    return this.gate.send(url, { method: 'POST', headers, body: JSON.stringify({ query }) }, this.options.accessToken);
  }
}

export const reportFields={
 campaigns:['campaign','campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign.optimization_score, campaign_budget.amount_micros, metrics.search_impression_share'],
 keywords:['keyword_view','segments.date, campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status'],
 groups:['ad_group','segments.date, campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group.status, ad_group.type'],
 terms:['search_term_view','segments.date, campaign.id, campaign.name, ad_group.id, ad_group.name, search_term_view.search_term, search_term_view.status'],
 ads:['ad_group_ad','segments.date, campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_ad.ad.id, ad_group_ad.status, ad_group_ad.ad.type, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.ad.final_urls'],
 hours:['campaign','segments.date, segments.hour, campaign.id'],
} as const;
export type GoogleReport=keyof typeof reportFields;
export function reportQuery(kind:GoogleReport,from:string,to:string){
 campaignDailyQuery(from,to);
 if(!Object.hasOwn(reportFields,kind))throw new Error('Relatório inválido.');
 const [resource,fields]=reportFields[kind];
 return `SELECT ${fields}, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM ${resource} WHERE segments.date BETWEEN '${from}' AND '${to}'`;
}
