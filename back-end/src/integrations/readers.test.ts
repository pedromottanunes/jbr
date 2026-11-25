import { describe, expect, it, vi } from 'vitest';
import { ReadGate } from './read-transport';
import { UmblerReader } from './umbler';
import { GoogleAdsReader, campaignDailyQuery } from './google-ads';

describe('guarded provider readers', () => {
  it('serializes simultaneous calls through one gate', async () => {
    let active = 0, peak = 0;
    const fetcher = vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 10));
      active -= 1;
      return new Response('{}', { status: 200 });
    });
    const gate = new ReadGate(0, fetcher);
    const reader = new UmblerReader('test-token', gate);
    await Promise.all(Array.from({ length: 5 }, () => reader.read('/v1/chats/')));
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(peak).toBe(1);
  });
  it('rejects WhatsApp mutations before any network call', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const reader = new UmblerReader('test-token', new ReadGate(0, fetcher));
    await expect(reader.read('/v1/chats/abc/messages/')).rejects.toThrow('não permitida');
    await expect(reader.read('/v1/chats/abc/relative-messages/')).resolves.toEqual({});
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1].method).toBe('GET');
    expect(String(fetcher.mock.calls[0][0])).toBe('https://app-utalk.umbler.com/api/v1/chats/abc/relative-messages/');
  });

  it('normalizes IDs and constrains GAQL dates', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }));
    const reader = new GoogleAdsReader({ accessToken: 'test', developerToken: 'dev', version: 'v23', loginCustomerId: '123-456-7890' }, new ReadGate(0, fetcher));
    await reader.campaigns('098-765-4321', '2026-10-01', '2026-10-23');
    expect(String(fetcher.mock.calls[0][0])).toContain('/customers/0987654321/googleAds:searchStream');
    expect(fetcher.mock.calls[0][1].headers['login-customer-id']).toBe('1234567890');
    expect(() => campaignDailyQuery("2026-10-01' OR 1=1", '2026-10-23')).toThrow();
    expect(() => campaignDailyQuery('2026-02-31', '2026-03-01')).toThrow();
    expect(() => campaignDailyQuery('2026-10-23', '2026-10-01')).toThrow();
  });
});
