export type Metrics = {
  impressions: number; clicks: number; spend: number; buttonConversions: number;
  contacts: number; commercial: number; qualified: number; proposals: number;
  googleIndicated: number; googleCommercial: number; googleQualified: number;
  googleProposals: number; otherChannels: number; unknownSource: number;
  conflictingSource: number; confirmedEvents: number; confirmedRevenue: number | null;
};
export type Overview = { period: string; timezone: string; sourceLabel: string; metrics: Metrics; attendance: { inside: number; insideAnswered: number; insideMedian: number; outside: number; outsideAnswered: number; outsideMedian: number; openAtCollection: number } };
export type Campaign = { id: string; name: string; clicks: number; spend: number; conversions: number };
export type Ads = { period: string; campaigns: Campaign[]; termCoverage: { clicks: number; percent: number } };
export type Contact = { id: string; label: string; firstInboundAt: string; source: string; category: string; qualified: boolean; proposal: boolean; replied: boolean; conversationId: string | null };
export type ContactPage = { items: Contact[]; nextCursor: string | null; totalInSample: number };

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { signal:AbortSignal.any([AbortSignal.timeout(30000),...(signal?[signal]:[])]), credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Falha ao carregar dados (${response.status}).`);
  return response.json() as Promise<T>;
}

export async function sendJson<T>(path:string,method:'POST'|'PUT',body:unknown):Promise<T>{
 const response=await fetch('/api/v1'+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
 const data=await response.json();if(!response.ok)throw new Error(data.message??'Não foi possível salvar.');return data as T;
}

export const formatNumber = (n: number) => new Intl.NumberFormat('pt-BR').format(n);
export const formatMoney = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
