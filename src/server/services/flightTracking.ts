/**
 * Flight tracking integration (spec §8)
 * ──────────────────────────────────────────────────────────────────────────
 * Provider-agnostic flight lookup. Configure via env:
 *   FLIGHT_API_URL — endpoint template; `{flight}` is replaced with the IATA/ICAO
 *                    flight number (default: aviationstack-compatible)
 *   FLIGHT_API_KEY — access key appended as access_key= / apikey= (provider-dependent)
 *
 * Without FLIGHT_API_KEY the service is a no-op and endpoints report
 * `configured: false` — flight_status stays manual, exactly as before.
 */

export interface FlightStatusResult {
  flightStatus: 'Scheduled' | 'In Flight' | 'Landed' | 'Delayed' | 'Cancelled' | 'Diverted';
  estimatedLanding?: string | null;
  actualLanding?: string | null;
  delayMinutes?: number | null;
  terminal?: string | null;
  raw?: any;
}

export const isFlightTrackingConfigured = (): boolean => Boolean(process.env.FLIGHT_API_KEY);

function mapStatus(s: string | undefined | null): FlightStatusResult['flightStatus'] {
  const v = (s || '').toLowerCase();
  if (v.includes('cancel')) return 'Cancelled';
  if (v.includes('divert')) return 'Diverted';
  if (v.includes('land') || v === 'arrived') return 'Landed';
  if (v.includes('delay')) return 'Delayed';
  if (v.includes('active') || v.includes('en-route') || v.includes('enroute') || v.includes('airborne')) return 'In Flight';
  return 'Scheduled';
}

/**
 * Look up a flight. Normalizes an aviationstack-style response
 * ({ data: [{ flight_status, arrival, departure }] }); providers with a
 * different shape can be adapted in `normalize` below.
 */
export async function lookupFlight(flightNumber: string, date?: string): Promise<FlightStatusResult | null> {
  const key = process.env.FLIGHT_API_KEY;
  if (!key || !flightNumber) return null;

  const base = (process.env.FLIGHT_API_URL || 'https://api.aviationstack.com/v1/flights').replace('{flight}', '');
  const url = new URL(base);
  url.searchParams.set('access_key', key);
  url.searchParams.set('flight_iata', flightNumber);
  if (date) url.searchParams.set('flight_date', date);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) return null;
    const json: any = await res.json();
    const f = Array.isArray(json?.data) ? json.data[0] : json?.data || json;
    if (!f || typeof f !== 'object') return null;

    const delayMin = f.arrival?.delayed ?? f.departure?.delayed ?? null;
    return {
      flightStatus: mapStatus(f.flight_status || f.status),
      estimatedLanding: f.arrival?.estimated || f.arrival?.scheduled || null,
      actualLanding: f.arrival?.actual || null,
      delayMinutes: delayMin != null ? Number(delayMin) : null,
      terminal: f.arrival?.terminal || f.departure?.terminal || null,
      raw: f,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
