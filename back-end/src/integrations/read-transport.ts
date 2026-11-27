/** One guarded transport for provider reads. No generic URL is accepted by callers. */
import {setTimeout as delay} from 'node:timers/promises';
import {BudgetError} from '../account-budget.js';
export class ProviderReadError extends Error {
  constructor(public readonly status: number, message: string, public readonly retryAfterMs=0) { super(message); }
}
export function transientReadError(error:unknown){
 return error instanceof BudgetError?['temporary','rate_limit','oauth_busy'].includes(error.code):
  error instanceof ProviderReadError?error.status===429||error.status===408||error.status>=500:
  error instanceof Error&&(['TimeoutError','AbortError'].includes(error.name)||error instanceof TypeError&&/fetch failed|network|socket/i.test(error.message));
}
export function integrationActionRequired(error:unknown){
 return error instanceof ProviderReadError?[401,403].includes(error.status):
  error instanceof BudgetError&&['reconnect','permission','configuration','credential_storage','account_mismatch'].includes(error.code);
}

export type ReadTransport = typeof fetch;

export class ReadGate {
  private tail: Promise<void> = Promise.resolve();
  private nextAllowedAt = 0;
  constructor(private readonly minIntervalMs: number, private readonly fetcher: ReadTransport = fetch, private readonly stopSignal?:AbortSignal) {}

  async send(url: URL, init: RequestInit, token: string): Promise<unknown> {
    if (!token || /[\r\n]/.test(token)) throw new Error('Credencial inválida.');
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      this.stopSignal?.throwIfAborted();
      const remaining = this.nextAllowedAt - Date.now();
      if (remaining > 0) {try{await delay(remaining,undefined,{signal:this.stopSignal});}catch(error){this.stopSignal?.throwIfAborted();throw error;}}
      this.nextAllowedAt = Date.now() + this.minIntervalMs;
      const signal=AbortSignal.any([AbortSignal.timeout(20_000),...(init.signal?[init.signal]:[]),...(this.stopSignal?[this.stopSignal]:[])]);
      const response = await this.fetcher(url, { ...init, redirect: 'error', signal });
      if (!response.ok) {
        const retry=response.headers.get('retry-after');
        const wait=retry?(Number.isFinite(Number(retry))?Number(retry)*1000:Date.parse(retry)-Date.now()):0;
        await response.body?.cancel();
        throw new ProviderReadError(response.status, `Provedor retornou HTTP ${response.status}.`,Number.isFinite(wait)?Math.max(0,wait):0);
      }
      const reader=response.body?.getReader();if(!reader)throw new Error('Resposta vazia do provedor.');
      const chunks:Uint8Array[]=[];let size=0;
      try{while(true){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>12_000_000)throw new Error('Resposta acima do limite configurado.');chunks.push(value);}}
      catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } finally { release(); }
  }
}
