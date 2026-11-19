/**
 * Competitor rate-feed adapter.
 *
 * Pulls a competitor's current room rates from a configured HTTP feed and
 * normalizes them into rms_competitor_rates rows. Real rate-shopping vendors
 * (OTA Insight/Lighthouse, RateGain, Fornova, SHR) all expose some variant of
 * "GET a rates JSON document"; this adapter covers that generic shape and can
 * be specialized later without changing the route.
 *
 * feed_config (JSONB on rms_competitors):
 *   endpoint     — required for a live pull (https URL).
 *   method       — default GET.
 *   headers      — extra request headers.
 *   auth         — { type: 'bearer'|'basic'|'apikey', token, username,
 *                    password, api_key, api_key_header }.
 *   timeout_ms   — default 20000.
 *   rates_path   — dot-path to the rates array in the response body
 *                  (e.g. "data.rates"); defaults to the root array or `.rates`.
 *   field_map    — response-field → canonical-field names:
 *                  { room_type, rate, rate_date, currency, availability }
 *                  (defaults match the canonical names).
 *   mode         — 'simulated' marks a demo competitor; refresh writes
 *                  jittered demo rows with source='simulated'.
 */

export interface NormalizedCompetitorRate {
  room_type: string;
  rate: number;
  rate_date: string;
  currency: string;
  availability: boolean;
}

export class FeedNotConfiguredError extends Error {}
export class FeedRequestError extends Error {}

const getPath = (obj: any, path: string): any =>
  path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

export async function fetchCompetitorRates(competitor: any): Promise<NormalizedCompetitorRate[]> {
  const cfg = (competitor.feed_config || {}) as any;
  const endpoint: string | undefined = cfg.endpoint;
  if (!endpoint) {
    throw new FeedNotConfiguredError('No rate feed configured for this competitor');
  }

  const headers: Record<string, string> = { ...(cfg.headers || {}) };
  const auth = cfg.auth || {};
  if (auth.type === 'bearer' && auth.token) headers['Authorization'] = `Bearer ${auth.token}`;
  else if (auth.type === 'basic' && auth.username != null) {
    headers['Authorization'] = `Basic ${Buffer.from(`${auth.username}:${auth.password || ''}`).toString('base64')}`;
  } else if (auth.type === 'apikey' && auth.api_key) {
    headers[auth.api_key_header || 'x-api-key'] = auth.api_key;
  }
  if (!headers['Accept']) headers['Accept'] = 'application/json';

  const timeout = Number(cfg.timeout_ms) > 0 ? Number(cfg.timeout_ms) : 20000;
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: cfg.method || 'GET',
      headers,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e: any) {
    throw new FeedRequestError(`Rate feed unreachable: ${e?.message || e}`);
  }
  if (!res.ok) {
    throw new FeedRequestError(`Rate feed returned HTTP ${res.status}`);
  }

  let payload: any;
  try {
    payload = await res.json();
  } catch {
    throw new FeedRequestError('Rate feed did not return JSON');
  }

  const fm = cfg.field_map || {};
  const raw: any[] = Array.isArray(payload)
    ? payload
    : Array.isArray(cfg.rates_path ? getPath(payload, cfg.rates_path) : payload?.rates)
      ? (cfg.rates_path ? getPath(payload, cfg.rates_path) : payload.rates)
      : [];
  if (!raw.length) {
    throw new FeedRequestError('Rate feed returned no rates');
  }

  const today = new Date().toISOString().slice(0, 10);
  const f = (row: any, key: string) => row?.[fm[key] || key];
  const rates = raw
    .map((row: any): NormalizedCompetitorRate | null => {
      const room_type = f(row, 'room_type');
      const rate = Number(f(row, 'rate'));
      if (!room_type || !Number.isFinite(rate) || rate <= 0) return null;
      return {
        room_type: String(room_type),
        rate,
        rate_date: String(f(row, 'rate_date') || today).slice(0, 10),
        currency: String(f(row, 'currency') || 'ETB'),
        availability: f(row, 'availability') !== false,
      };
    })
    .filter(Boolean) as NormalizedCompetitorRate[];

  if (!rates.length) {
    throw new FeedRequestError('Rate feed rows did not match field_map');
  }
  return rates;
}

/** True when this competitor is configured for an explicit demo refresh. */
export const isSimulatedCompetitor = (competitor: any): boolean =>
  competitor?.feed_config?.mode === 'simulated';
