/**
 * Channel sync execution layer for the RMS Channel Manager.
 *
 * Replaces the previously simulated POST /channels/:id/sync with real
 * outbound (rates + inventory) and inbound (bookings) calls, plus a
 * scheduled runner that picks up channels due for sync.
 *
 * Adapter selection: a channel runs the real REST adapter only when it has
 * credentials configured AND test_mode is off. Everything else takes the
 * simulated path and is honestly recorded status='simulated' in
 * inventory_sync_log so the UI can distinguish demo traffic from live sync.
 *
 * Per-channel configuration lives in channel_connections.settings:
 *   {
 *     "auth": "bearer" | "basic" | "apikey",      // default: inferred
 *     "api_key_header": "X-API-Key",              // for auth=apikey
 *     "hotel_code": "SEL01",                      // falls back to credentials.hotel_code / channel_code
 *     "endpoints": {                              // relative to api_endpoint or absolute
 *       "rates": "/rates",
 *       "inventory": "/inventory",
 *       "bookings": "/bookings",
 *       "health": "/health"
 *     },
 *     "booking_field_map": { "id": "booking_id", "guest_name": "guest.name", ... },
 *     "inventory_horizon_days": 14,
 *     "timeout_ms": 20000
 *   }
 * Credentials live in channel_connections.credentials and are never returned
 * to API clients: { api_key, api_secret, token, username, password, hotel_code, headers }
 */

import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';

// ── Types ────────────────────────────────────────────────────────────────

export interface ChannelConnection {
  id: string;
  channel_name: string;
  channel_code: string;
  channel_type: string;
  api_endpoint: string;
  api_version: string | null;
  credentials: Record<string, any> | null;
  webhook_url: string | null;
  sync_interval_minutes: number;
  last_sync_at: string | null;
  rate_parity_threshold: number;
  inventory_sync_enabled: boolean;
  booking_sync_enabled: boolean;
  active: boolean;
  test_mode: boolean;
  settings: Record<string, any> | null;
  property_id: string | null;
}

export interface ChannelRoomMapping {
  our_room_type_id: string;
  channel_room_code: string;
  channel_room_name: string | null;
  rate_multiplier: number;
  inventory_multiplier: number;
  active: boolean;
  sync_enabled: boolean;
}

export interface SyncOutcome {
  processed: number;
  successful: number;
  failed: number;
  errors: string[];
}

export interface ChannelBooking {
  channel_booking_id: string;
  channel_confirmation_code: string | null;
  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  room_type_id: string | null;
  check_in_date: string;
  check_out_date: string;
  adults: number;
  children: number;
  channel_rate: number;
  channel_currency: string;
  booking_status: string;
  channel_raw_data: any;
}

export interface ChannelSyncResult {
  simulated: boolean;
  status: 'success' | 'partial' | 'failed' | 'simulated';
  processed: number;
  successful: number;
  failed: number;
  errors: string[];
  log: any;
}

interface ChannelAdapter {
  testConnection(): Promise<{ ok: boolean; error?: string }>;
  pushRates(items: Record<string, any>[]): Promise<SyncOutcome>;
  pushInventory(items: Record<string, any>[]): Promise<SyncOutcome>;
  pullBookings(sinceIso: string): Promise<{ bookings: ChannelBooking[]; errors: string[] }>;
}

// ── Credentials / config helpers ─────────────────────────────────────────

export function hasChannelCredentials(channel: Pick<ChannelConnection, 'credentials'>): boolean {
  const c = channel.credentials || {};
  // Seed/demo rows ship 'placeholder_*' values — those are not real credentials
  // and must keep the channel on the simulated path.
  const real = (v: any) => typeof v === 'string' && v.trim() !== '' && !v.trim().toLowerCase().startsWith('placeholder');
  return !!(
    real(c.api_key) || real(c.apiKey) || real(c.token) || real(c.access_token) ||
    (real(c.username) && real(c.password)) ||
    (c.headers && typeof c.headers === 'object' && Object.keys(c.headers).length > 0)
  );
}

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_INVENTORY_HORIZON_DAYS = 14;

// ── Generic REST adapter ─────────────────────────────────────────────────
// Drives real OTA/GDS endpoints using the channel's api_endpoint +
// settings.endpoints paths + credentials. Per-supplier adapters (Booking.com
// XML, Expedia EQC, etc.) can subclass or replace this via resolveAdapter.

class GenericRestChannelAdapter implements ChannelAdapter {
  constructor(
    private channel: ChannelConnection,
    // Accepted for adapter-signature parity; payload builders take mappings
    // explicitly, so the adapter itself never reads this.
    _mappings: ChannelRoomMapping[],
  ) {}

  private settings(): Record<string, any> { return this.channel.settings || {}; }
  private credentials(): Record<string, any> { return this.channel.credentials || {}; }

  private timeout(): number { return Number(this.settings().timeout_ms) || DEFAULT_TIMEOUT_MS; }

  private hotelCode(): string {
    return this.settings().hotel_code || this.credentials().hotel_code || this.channel.channel_code;
  }

  private endpoint(kind: 'rates' | 'inventory' | 'bookings' | 'health'): string | null {
    const path = this.settings().endpoints?.[kind];
    if (path === false || path === null) return null; // explicitly disabled
    const base = this.channel.api_endpoint.replace(/\/+$/, '');
    if (!path) {
      // Sensible defaults relative to the channel base URL.
      const defaults: Record<string, string> = { rates: '/rates', inventory: '/inventory', bookings: '/bookings', health: '' };
      const rel = defaults[kind];
      return rel ? `${base}${rel}` : base;
    }
    if (/^https?:\/\//i.test(path)) return path;
    return `${base}${String(path).startsWith('/') ? '' : '/'}${path}`;
  }

  private authHeaders(): Record<string, string> {
    const c = this.credentials();
    const s = this.settings();
    const headers: Record<string, string> = { ...(c.headers && typeof c.headers === 'object' ? c.headers : {}) };
    const authMode = s.auth || (c.username && c.password ? 'basic' : c.api_key && s.api_key_header ? 'apikey' : 'bearer');
    if (authMode === 'basic' && c.username) {
      headers['Authorization'] = `Basic ${Buffer.from(`${c.username}:${c.password || ''}`).toString('base64')}`;
    } else if (authMode === 'apikey' && (c.api_key || c.apiKey)) {
      headers[s.api_key_header || 'X-API-Key'] = String(c.api_key || c.apiKey);
    } else if (c.token || c.access_token || c.api_key || c.apiKey) {
      headers['Authorization'] = `Bearer ${c.token || c.access_token || c.api_key || c.apiKey}`;
    }
    return headers;
  }

  private async request(method: 'GET' | 'POST', url: string, body?: any): Promise<any> {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', ...this.authHeaders() },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout()),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`${method} ${url} → HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    try { return text ? JSON.parse(text) : {}; } catch { return {}; }
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    const url = this.endpoint('health');
    if (!url) return { ok: false, error: 'No endpoint configured' };
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json', ...this.authHeaders() },
        signal: AbortSignal.timeout(this.timeout()),
      });
      return res.status < 400
        ? { ok: true }
        : { ok: false, error: `HTTP ${res.status}` };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Connection failed' };
    }
  }

  async pushRates(items: Record<string, any>[]): Promise<SyncOutcome> {
    const url = this.endpoint('rates');
    if (!url || !items.length) return { processed: 0, successful: 0, failed: 0, errors: [] };
    try {
      await this.request('POST', url, {
        channel: this.channel.channel_code,
        hotel: this.hotelCode(),
        generated_at: new Date().toISOString(),
        rates: items,
      });
      return { processed: items.length, successful: items.length, failed: 0, errors: [] };
    } catch (e: any) {
      return { processed: items.length, successful: 0, failed: items.length, errors: [e?.message || 'rate push failed'] };
    }
  }

  async pushInventory(items: Record<string, any>[]): Promise<SyncOutcome> {
    const url = this.endpoint('inventory');
    if (!url || !items.length) return { processed: 0, successful: 0, failed: 0, errors: [] };
    try {
      await this.request('POST', url, {
        channel: this.channel.channel_code,
        hotel: this.hotelCode(),
        generated_at: new Date().toISOString(),
        inventory: items,
      });
      return { processed: items.length, successful: items.length, failed: 0, errors: [] };
    } catch (e: any) {
      return { processed: items.length, successful: 0, failed: items.length, errors: [e?.message || 'inventory push failed'] };
    }
  }

  async pullBookings(sinceIso: string): Promise<{ bookings: ChannelBooking[]; errors: string[] }> {
    const url = this.endpoint('bookings');
    if (!url) return { bookings: [], errors: [] };
    try {
      const sep = url.includes('?') ? '&' : '?';
      const json = await this.request('GET', `${url}${sep}since=${encodeURIComponent(sinceIso)}&hotel=${encodeURIComponent(this.hotelCode())}`);
      const raw: any[] = Array.isArray(json) ? json : (json.bookings || json.reservations || []);
      const map = this.settings().booking_field_map || {};
      const pick = (obj: any, key: string, ...alts: string[]) => {
        const names = [map[key], key, ...alts].filter(Boolean) as string[];
        for (const n of names) {
          const v = n.split('.').reduce((o: any, p: string) => o?.[p], obj);
          if (v !== undefined && v !== null) return v;
        }
        return undefined;
      };
      const bookings: ChannelBooking[] = raw.map((b: any) => ({
        channel_booking_id: String(pick(b, 'channel_booking_id', 'id', 'booking_id', 'reservation_id')),
        channel_confirmation_code: pick(b, 'channel_confirmation_code', 'confirmation_code', 'confirmation') ?? null,
        guest_name: String(pick(b, 'guest_name', 'name', 'guest') ?? 'Unknown'),
        guest_email: pick(b, 'guest_email', 'email') ?? null,
        guest_phone: pick(b, 'guest_phone', 'phone') ?? null,
        room_type_id: pick(b, 'room_type_id', 'room_code', 'room_type') ?? null,
        check_in_date: String(pick(b, 'check_in_date', 'check_in', 'arrival')),
        check_out_date: String(pick(b, 'check_out_date', 'check_out', 'departure')),
        adults: Number(pick(b, 'adults') ?? 1),
        children: Number(pick(b, 'children') ?? 0),
        channel_rate: Number(pick(b, 'channel_rate', 'rate', 'amount', 'total') ?? 0),
        channel_currency: String(pick(b, 'channel_currency', 'currency') ?? 'USD'),
        booking_status: String(pick(b, 'booking_status', 'status') ?? 'confirmed'),
        channel_raw_data: b,
      })).filter(b => b.channel_booking_id && b.channel_booking_id !== 'undefined' && b.check_in_date && b.check_out_date);
      return { bookings, errors: [] };
    } catch (e: any) {
      return { bookings: [], errors: [e?.message || 'booking pull failed'] };
    }
  }
}

// ── Simulated adapter ────────────────────────────────────────────────────

class SimulatedChannelAdapter implements ChannelAdapter {
  constructor(_mappings: ChannelRoomMapping[]) {}
  async testConnection() { return { ok: true, error: 'Simulated channel — no real endpoint contacted' }; }
  async pushRates(items: Record<string, any>[]) { return { processed: items.length, successful: items.length, failed: 0, errors: [] }; }
  async pushInventory(items: Record<string, any>[]) { return { processed: items.length, successful: items.length, failed: 0, errors: [] }; }
  async pullBookings() { return { bookings: [] as ChannelBooking[], errors: [] }; }
}

function resolveAdapter(channel: ChannelConnection, mappings: ChannelRoomMapping[]): ChannelAdapter {
  return !channel.test_mode && hasChannelCredentials(channel)
    ? new GenericRestChannelAdapter(channel, mappings)
    : new SimulatedChannelAdapter(mappings);
}

// ── Payload builders ─────────────────────────────────────────────────────

const dayIso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

async function buildRateItems(channel: ChannelConnection, mappings: ChannelRoomMapping[]) {
  const typeIds = mappings.map(m => m.our_room_type_id);
  const { data: types } = await supabaseAdmin!.from('room_types').select('id,name,base_price').in('id', typeIds);
  const byId = new Map((types || []).map((t: any) => [t.id, t]));
  return mappings.map(m => {
    const t: any = byId.get(m.our_room_type_id);
    const base = Number(t?.base_price ?? 0);
    return {
      room_code: m.channel_room_code,
      room_name: m.channel_room_name || t?.name || m.our_room_type_id,
      our_room_type_id: m.our_room_type_id,
      rate: Math.round(base * Number(m.rate_multiplier || 1) * 100) / 100,
      currency: channel.settings?.currency || 'USD',
      start_date: dayIso(new Date()),
      end_date: dayIso(addDays(new Date(), 365)),
    };
  });
}

async function buildInventoryItems(channel: ChannelConnection, mappings: ChannelRoomMapping[]) {
  const horizon = Number(channel.settings?.inventory_horizon_days) || DEFAULT_INVENTORY_HORIZON_DAYS;
  const start = new Date(); start.setUTCHours(0, 0, 0, 0);
  const end = addDays(start, horizon);
  const typeIds = mappings.map(m => m.our_room_type_id);

  let roomsQ = supabaseAdmin!.from('rooms').select('id,room_type_id').in('room_type_id', typeIds);
  if (channel.property_id) roomsQ = roomsQ.eq('property_id', channel.property_id);
  let resQ = supabaseAdmin!.from('reservations')
    .select('room_type_id,check_in_date,check_out_date')
    .in('room_type_id', typeIds)
    .lt('check_in_date', dayIso(end))
    .gt('check_out_date', dayIso(start))
    .in('status', ['Confirmed', 'CheckedIn', 'confirmed', 'checked_in', 'in_house', 'Pending']);
  if (channel.property_id) resQ = resQ.eq('property_id', channel.property_id);

  const [roomsRes, resRes] = await Promise.all([roomsQ, resQ]);
  const totalByType = new Map<string, number>();
  for (const r of roomsRes.data || []) totalByType.set(r.room_type_id, (totalByType.get(r.room_type_id) || 0) + 1);
  const bookedByTypeDate = new Map<string, number>();
  for (const res of resRes.data || []) {
    for (let d = new Date(Math.max(start.getTime(), new Date(res.check_in_date).getTime())); d < new Date(res.check_out_date) && d < end; d = addDays(d, 1)) {
      const k = `${res.room_type_id}|${dayIso(d)}`;
      bookedByTypeDate.set(k, (bookedByTypeDate.get(k) || 0) + 1);
    }
  }

  const items: Record<string, any>[] = [];
  const snapshots: Record<string, any>[] = [];
  for (const m of mappings) {
    const total = totalByType.get(m.our_room_type_id) || 0;
    for (let d = new Date(start); d < end; d = addDays(d, 1)) {
      const date = dayIso(d);
      const booked = bookedByTypeDate.get(`${m.our_room_type_id}|${date}`) || 0;
      const available = Math.max(0, Math.round((total - booked) * Number(m.inventory_multiplier || 1)));
      items.push({ room_code: m.channel_room_code, date, total_rooms: total, available_rooms: available });
      snapshots.push({ channel_id: channel.id, room_type_id: m.our_room_type_id, date, total_rooms: total, available_rooms: available, booked_rooms: booked, sync_status: 'pending' });
    }
  }
  return { items, snapshots };
}

// ── Main sync orchestrator ───────────────────────────────────────────────

export async function runChannelSync(
  channelId: string,
  opts: { trigger?: string; propertyId?: string } = {},
): Promise<ChannelSyncResult> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) throw new Error('Database not configured');

  let chQ = supabaseAdmin.from('channel_connections').select('*').eq('id', channelId);
  if (opts.propertyId) chQ = chQ.eq('property_id', opts.propertyId);
  const { data: channel, error: chErr } = await chQ.maybeSingle();
  if (chErr) throw new Error(chErr.message);
  if (!channel) throw Object.assign(new Error('Channel not found'), { code: 'not_found' });
  if (!channel.active) throw Object.assign(new Error('Channel is inactive'), { code: 'inactive' });

  const { data: mappingRows } = await supabaseAdmin
    .from('channel_room_mapping').select('*').eq('channel_id', channelId).eq('active', true).eq('sync_enabled', true);
  const mappings = (mappingRows || []) as ChannelRoomMapping[];

  const startedAt = new Date();
  const adapter = resolveAdapter(channel as ChannelConnection, mappings);
  const simulated = adapter instanceof SimulatedChannelAdapter;

  const aggregate: SyncOutcome = { processed: 0, successful: 0, failed: 0, errors: [] };
  const merge = (o: SyncOutcome) => {
    aggregate.processed += o.processed;
    aggregate.successful += o.successful;
    aggregate.failed += o.failed;
    aggregate.errors.push(...o.errors);
  };

  // Outbound: rates + inventory
  const rateItems = await buildRateItems(channel as ChannelConnection, mappings);
  merge(await adapter.pushRates(rateItems));

  if (channel.inventory_sync_enabled) {
    const { items: invItems, snapshots } = await buildInventoryItems(channel as ChannelConnection, mappings);
    merge(await adapter.pushInventory(invItems));
    if (!simulated && snapshots.length) {
      await supabaseAdmin.from('channel_inventory_snapshot')
        .upsert(snapshots.map(s => ({ ...s, sync_status: aggregate.failed === 0 ? 'synced' : 'pending', synced_at: new Date().toISOString() })),
          { onConflict: 'channel_id,room_type_id,date' });
    }
  }

  // Inbound: bookings
  if (channel.booking_sync_enabled) {
    const since = channel.settings?.last_booking_pull || channel.last_sync_at || new Date(Date.now() - 86400000).toISOString();
    const pulled = await adapter.pullBookings(since);
    aggregate.errors.push(...pulled.errors);
    if (pulled.errors.length) aggregate.failed += 1;
    aggregate.processed += pulled.bookings.length;
    if (pulled.bookings.length && !simulated) {
      const { error: upErr } = await supabaseAdmin.from('channel_bookings')
        .upsert(pulled.bookings.map(b => ({
          ...b,
          channel_id: channelId,
          property_id: channel.property_id || null,
          nights: Math.max(1, Math.round((new Date(b.check_out_date).getTime() - new Date(b.check_in_date).getTime()) / 86400000) || 1),
          total_amount: Number(b.channel_rate || 0),
          sync_status: 'pending',
        })), { onConflict: 'channel_id,channel_booking_id' });
      if (upErr) { aggregate.failed += pulled.bookings.length; aggregate.errors.push(upErr.message); }
      else {
        aggregate.successful += pulled.bookings.length;
        const newSettings = { ...(channel.settings || {}), last_booking_pull: new Date().toISOString() };
        await supabaseAdmin.from('channel_connections').update({ settings: newSettings }).eq('id', channelId);
      }
    }
  }

  const finishedAt = new Date();
  const status = simulated ? 'simulated' : aggregate.failed === 0 ? 'success' : aggregate.successful > 0 ? 'partial' : 'failed';
  const { data: log, error: logError } = await supabaseAdmin.from('inventory_sync_log').insert({
    channel_id: channelId,
    sync_type: 'full',
    sync_start: startedAt.toISOString(),
    sync_end: finishedAt.toISOString(),
    records_processed: aggregate.processed,
    records_successful: aggregate.successful,
    records_failed: aggregate.failed,
    status,
    error_summary: aggregate.errors.length ? { errors: aggregate.errors.slice(0, 10) } : null,
    trigger_type: opts.trigger || 'manual',
  }).select().single();
  if (logError) throw new Error(logError.message);

  await supabaseAdmin.from('channel_connections').update({
    last_sync_at: finishedAt.toISOString(),
    last_sync_status: status,
    last_sync_error: aggregate.errors[0] || null,
  }).eq('id', channelId);

  return {
    simulated,
    status,
    processed: aggregate.processed,
    successful: aggregate.successful,
    failed: aggregate.failed,
    errors: aggregate.errors,
    log,
  };
}

export async function testChannelConnection(channelId: string, propertyId?: string) {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) throw new Error('Database not configured');
  let chQ = supabaseAdmin.from('channel_connections').select('*').eq('id', channelId);
  if (propertyId) chQ = chQ.eq('property_id', propertyId);
  const { data: channel, error } = await chQ.maybeSingle();
  if (error) throw new Error(error.message);
  if (!channel) throw Object.assign(new Error('Channel not found'), { code: 'not_found' });
  const adapter = resolveAdapter(channel as ChannelConnection, []);
  return adapter.testConnection();
}

// ── Scheduled runner ─────────────────────────────────────────────────────

const SYNC_TICK_MS = Number(process.env.CHANNEL_SYNC_TICK_MS) || 60_000;
let syncTimer: ReturnType<typeof setInterval> | null = null;
let syncRunning = false;

async function syncDueChannels() {
  if (syncRunning || !hasSupabaseAdminConfig || !supabaseAdmin) return;
  syncRunning = true;
  try {
    const { data: channels, error } = await supabaseAdmin
      .from('channel_connections')
      .select('*')
      .eq('active', true)
      .eq('test_mode', false);
    if (error || !channels) return;
    const now = Date.now();
    for (const ch of channels as ChannelConnection[]) {
      if (!hasChannelCredentials(ch)) continue;
      const due = !ch.last_sync_at || now - new Date(ch.last_sync_at).getTime() >= (ch.sync_interval_minutes || 30) * 60000;
      if (!due) continue;
      try {
        await runChannelSync(ch.id, { trigger: 'scheduled', propertyId: ch.property_id || undefined });
      } catch (e) {
        console.error(`[channel-sync] scheduled sync failed for ${ch.channel_code}:`, (e as Error).message);
      }
    }
  } finally {
    syncRunning = false;
  }
}

export function startChannelSyncScheduler() {
  if (syncTimer || !hasSupabaseAdminConfig) return;
  syncTimer = setInterval(() => { syncDueChannels().catch(e => console.error('[channel-sync] tick error:', e)); }, SYNC_TICK_MS);
  if (typeof syncTimer.unref === 'function') syncTimer.unref();
}

export function stopChannelSyncScheduler() {
  if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
}
