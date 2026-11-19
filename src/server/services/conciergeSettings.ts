/**
 * Concierge settings consumers.
 *
 * Reads `concierge_settings` rows (id = 'section.slug', jsonb `value`) and
 * applies them to request creation, vendor management, and alert surfaces so
 * the Configuration module toggles actually do something. Shared by
 * concierge.routes.ts (staff) and guestMobilePortal.routes.ts (guest) so
 * both surfaces apply the same defaults, desk-hours routing, auto-assign and
 * wake-up window validation.
 */
import { supabaseAdmin } from '../supabaseAdmin';

/** Batch-read concierge_settings values keyed by id (missing rows omitted). */
export async function getConciergeSettings(ids: string[]): Promise<Record<string, any>> {
  const { data } = await supabaseAdmin
    .from('concierge_settings')
    .select('id, value')
    .in('id', ids);
  return Object.fromEntries((data || []).map((r: any) => [r.id, r.value]));
}

/** 'HH:MM' → minutes since midnight; null when unparseable. */
export function parseHHMM(v: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v ?? '').trim());
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return mins >= 0 && mins < 24 * 60 ? mins : null;
}

// ── Property timezone helpers ────────────────────────────────────────────
// Desk hours, wake-up windows and the daily digest are wall-clock concepts —
// they must be evaluated in the property's timezone (properties.timezone,
// IANA name), not the server's.

const tzCache = new Map<string, string | null>();

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The property's IANA timezone, or null (→ server-local fallback). */
export async function getPropertyTimezone(propertyId?: string | null): Promise<string | null> {
  const key = propertyId || '__default__';
  if (tzCache.has(key)) return tzCache.get(key) ?? null;

  let q = supabaseAdmin.from('properties').select('timezone').eq('is_active', true);
  if (propertyId) q = q.eq('id', propertyId);
  const { data } = await q.order('created_at').limit(1).maybeSingle();

  const tz = data?.timezone && isValidTimeZone(String(data.timezone))
    ? String(data.timezone)
    : null;
  tzCache.set(key, tz);
  return tz;
}

/** Minutes since midnight in `timeZone` (or server-local when unset). */
export function localMinutesOfDay(date: Date, timeZone?: string | null): number {
  if (!timeZone) return date.getHours() * 60 + date.getMinutes();
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(date);
    const h = Number(parts.find((p) => p.type === 'hour')?.value) % 24;
    const m = Number(parts.find((p) => p.type === 'minute')?.value);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  } catch {
    return date.getHours() * 60 + date.getMinutes();
  }
}

/** 'YYYY-MM-DD' calendar date in `timeZone` (or server-local when unset). */
export function localDateISO(date: Date, timeZone?: string | null): string {
  if (!timeZone) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  }
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date);
  } catch {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  }
}

/** UTC instant of local midnight for `date`'s day in `timeZone`. */
export function localDayStartUtc(date: Date, timeZone?: string | null): Date {
  if (!timeZone) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  try {
    const localDay = localDateISO(date, timeZone);
    // Two-pass offset refinement handles zones near a DST transition.
    let guess = Date.parse(`${localDay}T00:00:00Z`);
    for (let i = 0; i < 2; i++) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).formatToParts(new Date(guess));
      const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
      const asUtc = Date.UTC(
        get('year'), get('month') - 1, get('day'),
        get('hour') % 24, get('minute'), get('second'),
      );
      guess -= asUtc - guess;
    }
    return new Date(guess);
  } catch {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }
}

/**
 * True when `date`'s local time-of-day falls inside [start, end]. Supports
 * windows that wrap midnight (e.g. 22:00–06:00). Unconfigured/invalid
 * windows return true — a broken setting must never block work.
 */
export function withinWindow(
  date: Date,
  start: unknown,
  end: unknown,
  timeZone?: string | null,
): boolean {
  const s = parseHHMM(start);
  const e = parseHHMM(end);
  if (s == null || e == null || s === e) return true;
  const t = localMinutesOfDay(date, timeZone);
  return s < e ? t >= s && t < e : t >= s || t < e;
}

/**
 * Least-loaded concierge agent. When today's hr_team_roster has concierge
 * rows, candidates are restricted to staff whose shift window covers `now`
 * ('Flexible'/unconfigured shift types count as on-shift); if the roster
 * exists but nobody is on shift, returns null so the caller can route to
 * the Duty Manager. With no roster data at all, falls back to active
 * employees tagged concierge — single-property installs without HR
 * rostering still auto-assign.
 */
export async function pickConciergeAssignee(opts: {
  propertyId?: string | null;
  now?: Date;
  timeZone?: string | null;
} = {}): Promise<string | null> {
  const now = opts.now ?? new Date();

  let rosterQ = supabaseAdmin
    .from('hr_team_roster')
    .select('employee_name, shift')
    .eq('roster_date', localDateISO(now, opts.timeZone))
    .neq('shift', 'Off')
    .ilike('department', '%concierge%');
  if (opts.propertyId) rosterQ = rosterQ.eq('property_id', opts.propertyId);
  const { data: roster } = await rosterQ;

  let candidates: string[];
  if (roster && roster.length > 0) {
    let typesQ = supabaseAdmin
      .from('hr_shift_types')
      .select('name, start_time, end_time')
      .eq('is_active', true);
    if (opts.propertyId) typesQ = typesQ.eq('property_id', opts.propertyId);
    const { data: shiftTypes } = await typesQ;
    const windows = new Map((shiftTypes || []).map((t: any) => [t.name, t]));

    const nowMin = localMinutesOfDay(now, opts.timeZone);
    candidates = roster
      .filter((r: any) => {
        const st = windows.get(r.shift);
        const s = parseHHMM(st?.start_time);
        const e = parseHHMM(st?.end_time);
        if (s == null || e == null || s === e) return true;
        return s < e ? nowMin >= s && nowMin < e : nowMin >= s || nowMin < e;
      })
      .map((r: any) => r.employee_name)
      .filter(Boolean);
    if (candidates.length === 0) return null;
  } else {
    const { data: staff } = await supabaseAdmin
      .from('employees')
      .select('name')
      .eq('status', 'Active')
      .or('position.ilike.%concierge%,department.ilike.%concierge%');
    candidates = (staff || []).map((s: any) => s.name).filter(Boolean);
  }
  if (candidates.length === 0) return null;

  const { data: open } = await supabaseAdmin
    .from('guest_requests')
    .select('assigned_to')
    .eq('assigned_department', 'Concierge')
    .in('status', ['Open', 'Assigned', 'In Progress']);
  const load = new Map<string, number>();
  for (const r of open || []) {
    if (r.assigned_to) load.set(r.assigned_to, (load.get(r.assigned_to) || 0) + 1);
  }
  candidates.sort((a, b) => (load.get(a) || 0) - (load.get(b) || 0) || a.localeCompare(b));
  return candidates[0];
}

export interface RequestDefaults {
  priority: string;
  assignedTo: string | null;
}

/**
 * Apply requests.default-priority, hours.desk-hours and requests.auto-assign
 * to a new concierge request. Outside desk hours the request routes to the
 * Duty Manager; inside hours, auto-assign picks the least-loaded agent.
 */
export async function conciergeRequestDefaults(input: {
  priority?: unknown;
  assignedTo?: unknown;
  propertyId?: string | null;
  now?: Date;
}): Promise<RequestDefaults> {
  const settings = await getConciergeSettings([
    'requests.default-priority',
    'requests.auto-assign',
    'hours.desk-hours',
  ]);
  const now = input.now ?? new Date();
  const timeZone = await getPropertyTimezone(input.propertyId);

  const priority =
    (input.priority ? String(input.priority) : null) ||
    settings['requests.default-priority']?.value ||
    'Normal';

  let assignedTo = input.assignedTo ? String(input.assignedTo) : null;
  if (!assignedTo) {
    const hours = settings['hours.desk-hours'];
    const deskOpen = hours ? withinWindow(now, hours.start, hours.end, timeZone) : true;
    if (!deskOpen) {
      assignedTo = 'Duty Manager';
    } else if (settings['requests.auto-assign']?.enabled === true) {
      assignedTo = await pickConciergeAssignee({
        propertyId: input.propertyId,
        now,
        timeZone,
      });
    }
  }

  return { priority, assignedTo };
}

/**
 * Wake-up calls must land inside the configured hours.wakeup-window,
 * evaluated in the property's timezone. Returns an error message when the
 * scheduled time is outside it.
 */
export async function wakeupWindowError(
  requestType: unknown,
  scheduledFor: unknown,
  propertyId?: string | null,
): Promise<string | null> {
  if (requestType !== 'Wake-up Call' || !scheduledFor) return null;
  const at = new Date(String(scheduledFor));
  if (Number.isNaN(at.getTime())) return null;
  const w = (await getConciergeSettings(['hours.wakeup-window']))['hours.wakeup-window'];
  if (!w) return null;
  const timeZone = await getPropertyTimezone(propertyId);
  if (withinWindow(at, w.start, w.end, timeZone)) return null;
  return `Wake-up calls can only be scheduled between ${w.start} and ${w.end}`;
}
