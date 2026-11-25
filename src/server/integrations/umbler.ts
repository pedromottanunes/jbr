import { ReadGate } from './read-transport.js';

const BASE = 'https://app-utalk.umbler.com/api';
const allowedPaths = [
  /^\/v1\/members\/me\/$/,
  /^\/v1\/channels\/$/,
  /^\/v1\/tags\/$/,
  /^\/v1\/organizations\/[A-Za-z0-9_-]+\/$/,
  /^\/v1\/contact-ratings\/$/,
  /^\/v1\/chats\/$/,
  /^\/v1\/messages\/[A-Za-z0-9_-]+\/$/,
  /^\/v1\/chats\/[A-Za-z0-9_-]+\/relative-messages\/$/
];

export class UmblerReader {
  constructor(private readonly token: string, private readonly gate: ReadGate = new ReadGate(3_000)) {}

  async read(path: string, params: Record<string, string | number> = {}): Promise<unknown> {
    if (!allowedPaths.some(pattern => pattern.test(path))) throw new Error('Rota Umbler de leitura não permitida.');
    const url = new URL(BASE + path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    return this.gate.send(url, { method: 'GET', headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' } }, this.token);
  }
}
