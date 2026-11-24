/** One guarded transport for provider reads. No generic URL is accepted by callers. */
export class ProviderReadError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export type ReadTransport = typeof fetch;

export class ReadGate {
  private tail: Promise<void> = Promise.resolve();
  private nextAllowedAt = 0;
  constructor(private readonly minIntervalMs: number, private readonly fetcher: ReadTransport = fetch) {}

  async send(url: URL, init: RequestInit, token: string): Promise<unknown> {
    if (!token || /[\r\n]/.test(token)) throw new Error('Credencial inválida.');
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      const remaining = this.nextAllowedAt - Date.now();
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
      this.nextAllowedAt = Date.now() + this.minIntervalMs;
      const response = await this.fetcher(url, { ...init, redirect: 'error', signal: init.signal ?? AbortSignal.timeout(20_000) });
      if (!response.ok) throw new ProviderReadError(response.status, `Provedor retornou HTTP ${response.status}.`);
      const body = await response.text();
      if (body.length > 12_000_000) throw new Error('Resposta acima do limite configurado.');
      return JSON.parse(body) as unknown;
    } finally { release(); }
  }
}
