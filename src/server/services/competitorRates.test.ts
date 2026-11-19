import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { fetch as undiciFetch } from 'undici';
import { fetchCompetitorRates, isSimulatedCompetitor, FeedNotConfiguredError, FeedRequestError } from './competitorRates';

describe('isSimulatedCompetitor', () => {
  it('detects explicit simulated mode', () => {
    expect(isSimulatedCompetitor({ feed_config: { mode: 'simulated' } })).toBe(true);
    expect(isSimulatedCompetitor({ feed_config: { endpoint: 'https://x' } })).toBe(false);
    expect(isSimulatedCompetitor({})).toBe(false);
    expect(isSimulatedCompetitor(null)).toBe(false);
  });
});

describe('fetchCompetitorRates', () => {
  let server: http.Server;
  let baseUrl: string;
  let lastAuth: string | undefined;
  let lastPath: string | undefined;

  const FEED_BODY = {
    data: [
      { type: 'Deluxe', price: 180, date: '2026-01-15' },
      { type: 'Suite', price: 260, date: '2026-01-15' },
      { bad: 'row' }, // malformed — must be dropped
    ],
  };

  let realFetch: any;

  beforeAll(async () => {
    // The global vitest setup replaces fetch with vi.fn() — restore the real
    // implementation so the adapter exercises an actual HTTP round-trip.
    realFetch = globalThis.fetch;
    globalThis.fetch = undiciFetch as any;

    server = http.createServer((req, res) => {
      lastAuth = req.headers.authorization;
      lastPath = req.url;
      if (req.url === '/fail') { res.writeHead(502); res.end('bad gateway'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(FEED_BODY));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
    server.close();
  });

  it('throws FeedNotConfiguredError without an endpoint', async () => {
    await expect(fetchCompetitorRates({ feed_config: {} })).rejects.toBeInstanceOf(FeedNotConfiguredError);
    await expect(fetchCompetitorRates({})).rejects.toBeInstanceOf(FeedNotConfiguredError);
  });

  it('pulls and normalizes rates via rates_path + field_map', async () => {
    const rates = await fetchCompetitorRates({
      feed_config: {
        endpoint: `${baseUrl}/rates`,
        rates_path: 'data',
        field_map: { room_type: 'type', rate: 'price', rate_date: 'date' },
      },
    });
    expect(lastPath).toBe('/rates');
    expect(rates).toHaveLength(2);
    expect(rates[0]).toMatchObject({ room_type: 'Deluxe', rate: 180, rate_date: '2026-01-15' });
    expect(rates[1]).toMatchObject({ room_type: 'Suite', rate: 260 });
  });

  it('sends bearer auth from credentials', async () => {
    await fetchCompetitorRates({
      feed_config: {
        endpoint: `${baseUrl}/rates`,
        rates_path: 'data',
        field_map: { room_type: 'type', rate: 'price', rate_date: 'date' },
        auth: { type: 'bearer', token: 'feed-token-1' },
      },
    });
    expect(lastAuth).toBe('Bearer feed-token-1');
  });

  it('throws FeedRequestError on HTTP failure', async () => {
    await expect(
      fetchCompetitorRates({ feed_config: { endpoint: `${baseUrl}/fail` } }),
    ).rejects.toBeInstanceOf(FeedRequestError);
  });

  it('defaults rate_date to today when the feed omits it', async () => {
    const rates = await fetchCompetitorRates({
      feed_config: {
        endpoint: `${baseUrl}/rates`,
        rates_path: 'data',
        field_map: { room_type: 'type', rate: 'price' },
      },
    });
    const today = new Date().toISOString().slice(0, 10);
    expect(rates.every((r) => r.rate_date === today)).toBe(true);
  });
});
