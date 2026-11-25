import { afterEach, expect, it, vi } from 'vitest';
import { buildApp } from './app';

afterEach(() => vi.restoreAllMocks());

it('serves historical data without calling external APIs and does not expose write routes', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch');
  const app = buildApp();
  const overview = await app.inject({ method: 'GET', url: '/api/v1/overview' });
  expect(overview.statusCode).toBe(200);
  expect(overview.json().metrics.contacts).toBe(854);
  expect(overview.headers['cache-control']).toBe('private, no-store');
  const conversation=await app.inject('/api/v1/conversations/historical-sample');
  expect(conversation.statusCode).toBe(200);
  expect(conversation.json().messages).toEqual([]);
  expect(conversation.json().focusMessage).toBeNull();
  const mutation = await app.inject({ method: 'POST', url: '/api/v1/conversations/test/messages' });
  expect(mutation.statusCode).toBe(404);
  expect(fetcher).not.toHaveBeenCalled();
  await app.close();
});
