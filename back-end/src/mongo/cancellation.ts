import {setTimeout} from 'node:timers/promises';

export class WorkerStopping extends Error {
  constructor() { super('Worker encerrando; coleta será retomada.'); this.name = 'WorkerStopping'; }
}
export function checkSignal(signal?: AbortSignal) { if (signal?.aborted) throw new WorkerStopping(); }
export async function pause(ms: number, signal?: AbortSignal) {
  checkSignal(signal);
  try { await setTimeout(ms, undefined, {signal}); } catch (error) { checkSignal(signal); throw error; }
}
