/**
 * VIP Guest Management routes — mounted at /api/ops-portal.
 *
 * Backs the /erp/operations/vip-management tab (VIPGuestManagement.tsx).
 *
 *   GET    /vip-guests?propertyId=
 *          Builds the VIP roster from the real FO tables:
 *            guests (status VIP / Loyalty Member)   — identity, preferences
 *            reservations                           — room, dates, stay status
 *            ops_vip_profiles                       — ops category/butler/notes (mig. 636)
 *            guest_requests                         — open special requests (FO)
 *            transport_airport_transfers            — arrival logistics (Transport)
 *            spa_appointments                       — spa bookings (Spa)
 *            housekeeping_task_mgmt                 — VIP prep tasks (HK)
 *
 *   POST   /vip-guests                     — create guest + VIP profile
 *   PATCH  /vip-guests/:guestId/profile    — upsert ops_vip_profiles
 *   POST   /vip-guests/:guestId/requests   — raise a real guest_request
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();
const CACHE_TTL_MS = 20 * 1000;
const VIP_CATEGORIES = [
  'VIP', 'VVIP', 'Loyalty Elite', 'Corporate Executive', 'Government Official', 'Celebrity',
] as const;

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

async function fetchRows(query: any, tag: string): Promise<any[]> {
  try {
    const r = await query;
    if (r.error) {
      console.warn(`[ops-vip] ${tag}: ${r.error.message}`);
      return [];
    }
    return (r.data as any[]) || [];
  } catch (e: any) {
    console.warn(`[ops-vip] ${tag}: ${e?.message || e}`);
    return [];
  }
}

const normPrefs = (raw: any): string[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === 'object') {
    return Object.entries(raw)
      .filter(([, v]) => v && v !== 'false' && v !== false)
      .map(([k, v]) => (v === true ? k : `${k}: ${v}`));
  }
  return String(raw).split(/[;|\n]/).map((s) => s.trim()).filter(Boolean);
};

const stayStatus = (res: any): 'arrived' | 'expected' | 'departed' => {
  if (!res) return 'expected';
  const s = String(res.status || '').toLowerCase();
  if (s === 'checkedin' || s === 'inhouse' || s === 'checked in') return 'arrived';
  if (s === 'checkedout' || s === 'checked out' || s === 'noshow' || s === 'cancelled') return 'departed';
  return 'expected';
};

// Pick the most relevant reservation: in-house > upcoming > most recent past.
function pickReservation(rows: any[]): any | undefined {
  const rank = (r: any) => {
    const s = String(r.status || '').toLowerCase();
    if (s === 'checkedin' || s === 'inhouse') return 0;
    if (s === 'confirmed' || s === 'booked' || s === 'pending') return 1;
    return 2;
  };
  return [...rows].sort((a, b) =>
    rank(a) - rank(b) || String(b.check_in_date || '').localeCompare(String(a.check_in_date || ''))
  )[0];
}

// GET /api/ops-portal/vip-guests
router.get('/vip-guests', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.query as Record<string, string>).propertyId || undefined;
  const eqProp = (q: any): any => (propertyId ? q.eq('property_id', propertyId) : q);

  const cacheKey = `ops-vip:${propertyId || 'all'}`;
  const cached = cacheService.get<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const guests = await fetchRows(eqProp(supabaseAdmin!.from('guests')
      .select('id, name, email, phone, status, loyalty_points, special_requests, preferences, nationality, total_spend')
      .in('status', ['VIP', 'Loyalty Member'])), 'guests');
    if (!guests.length) {
      return res.json({ generatedAt: new Date().toISOString(), guests: [], stats: { total: 0, arrived: 0, expected: 0, departed: 0 } });
    }

    const guestIds = guests.map((g) => g.id);
    const guestNames = guests.map((g) => g.name).filter(Boolean);

    const [reservations, profiles, requests, transfers, spa, hkTasks] = await Promise.all([
      fetchRows(supabaseAdmin!.from('reservations')
        .select('id, guest_id, guest_name, room_number, room_type, check_in_date, check_out_date, status, adults, children')
        .in('guest_id', guestIds)
        .order('check_in_date', { ascending: false }), 'reservations'),
      fetchRows(eqProp(supabaseAdmin!.from('ops_vip_profiles').select('*')), 'profiles'),
      fetchRows(guestNames.length
        ? eqProp(supabaseAdmin!.from('guest_requests')
            .select('id, reservation_id, room_number, guest_name, request_type, description, priority, status, submitted_at')
            .in('status', ['Pending', 'pending', 'In Progress', 'in-progress', 'Acknowledged', 'assigned'])
            .or(`guest_name.in.(${guestNames.map((n) => `"${String(n).replace(/"/g, '')}"`).join(',')})`))
        : Promise.resolve([]), 'guest_requests'),
      fetchRows(eqProp(supabaseAdmin!.from('transport_airport_transfers')
        .select('id, guest_id, guest_name, service, type, flight_number, airline, scheduled_time, status, pickup_location, destination')
        .in('guest_id', guestIds)
        .order('scheduled_time', { ascending: false })), 'transfers'),
      fetchRows(eqProp(supabaseAdmin!.from('spa_appointments')
        .select('id, guest_id, guest_name, treatment, therapist, appointment_date, start_time, status, amount')
        .in('guest_id', guestIds)
        .order('appointment_date', { ascending: false })), 'spa'),
      fetchRows(eqProp(supabaseAdmin!.from('housekeeping_task_mgmt')
        .select('id, type, location, assigned_to, priority, status, due_date')
        .or('type.ilike.%VIP%,category.ilike.%VIP%')), 'hk vip tasks'),
    ]);

    const resByGuest = new Map<string, any[]>();
    for (const r of reservations) {
      const arr = resByGuest.get(r.guest_id) || [];
      arr.push(r);
      resByGuest.set(r.guest_id, arr);
    }
    const profileByGuest = new Map(profiles.map((p: any) => [p.guest_id, p]));

    // Requests/transfers may key on reservation_id or guest_name rather than guest_id.
    const resIds = new Set(reservations.map((r: any) => r.id));
    const reqByGuest = new Map<string, any[]>();
    for (const q of requests) {
      let gid: string | undefined;
      if (q.reservation_id && resIds.has(q.reservation_id)) {
        gid = reservations.find((r) => r.id === q.reservation_id)?.guest_id;
      }
      if (!gid) gid = guests.find((g) => g.name === q.guest_name)?.id;
      if (!gid) continue;
      const arr = reqByGuest.get(gid) || [];
      arr.push(q);
      reqByGuest.set(gid, arr);
    }
    const xferByGuest = new Map<string, any[]>();
    for (const t of transfers) {
      const gid = t.guest_id || guests.find((g) => g.name === t.guest_name)?.id;
      if (!gid) continue;
      const arr = xferByGuest.get(gid) || [];
      arr.push(t);
      xferByGuest.set(gid, arr);
    }
    const spaByGuest = new Map<string, any[]>();
    for (const s of spa) {
      const gid = s.guest_id || guests.find((g) => g.name === s.guest_name)?.id;
      if (!gid) continue;
      const arr = spaByGuest.get(gid) || [];
      arr.push(s);
      spaByGuest.set(gid, arr);
    }

    const out = guests.map((g) => {
      const res = pickReservation(resByGuest.get(g.id) || []);
      const profile = profileByGuest.get(g.id);
      const defaultCategory = g.status === 'Loyalty Member' ? 'Loyalty Elite' : 'VIP';
      const room = res?.room_number;
      const prep = hkTasks.filter((t: any) =>
        room && t.location && String(t.location).toLowerCase().includes(`room ${String(room).toLowerCase()}`));

      return {
        id: g.id,
        name: g.name,
        category: profile?.category || defaultCategory,
        roomNumber: room ? `Room ${room}` : (res?.room_type || undefined),
        reservationId: res?.id,
        checkInDate: res?.check_in_date,
        checkOutDate: res?.check_out_date,
        status: stayStatus(res),
        preferences: normPrefs(g.preferences),
        specialRequests: normPrefs(g.special_requests),
        butlerAssigned: profile?.butler || undefined,
        notifications: profile?.notifications !== false,
        email: g.email || undefined,
        phone: g.phone || undefined,
        nationality: g.nationality || undefined,
        loyaltyPoints: g.loyalty_points || 0,
        totalSpend: g.total_spend || 0,
        profileNotes: profile?.notes || undefined,
        openRequests: (reqByGuest.get(g.id) || []).map((q) => ({
          id: q.id, type: q.request_type, description: q.description,
          priority: q.priority, status: q.status, submittedAt: q.submitted_at,
        })),
        transfers: (xferByGuest.get(g.id) || []).map((t) => ({
          id: t.id, service: t.service || t.type, flightNumber: t.flight_number,
          airline: t.airline, scheduledTime: t.scheduled_time, status: t.status,
          route: [t.pickup_location, t.destination].filter(Boolean).join(' → '),
        })),
        spaAppointments: (spaByGuest.get(g.id) || []).map((s) => ({
          id: s.id, treatment: s.treatment, therapist: s.therapist,
          date: s.appointment_date, time: s.start_time, status: s.status,
        })),
        prepTasks: prep.map((t) => ({
          id: t.id, type: t.type, location: t.location,
          assignedTo: t.assigned_to, status: t.status, dueDate: t.due_date,
        })),
      };
    });

    const payload = {
      generatedAt: new Date().toISOString(),
      guests: out,
      stats: {
        total: out.length,
        arrived: out.filter((g) => g.status === 'arrived').length,
        expected: out.filter((g) => g.status === 'expected').length,
        departed: out.filter((g) => g.status === 'departed').length,
        openRequests: out.reduce((n, g) => n + g.openRequests.length, 0),
      },
    };
    cacheService.set(cacheKey, payload, CACHE_TTL_MS);
    return res.json(payload);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to load VIP guests' });
  }
});

// POST /api/ops-portal/vip-guests — create a guest record + VIP profile.
router.post('/vip-guests', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (!b.name?.trim()) return res.status(400).json({ error: 'name is required' });
  if (b.category && !VIP_CATEGORIES.includes(b.category)) {
    return res.status(400).json({ error: 'invalid category' });
  }

  const guestId = `GST-${Date.now()}`;
  const { error: gErr } = await supabaseAdmin.from('guests').insert({
    id: guestId,
    name: b.name.trim(),
    email: b.email || `${guestId.toLowerCase()}@guest.local`,
    phone: b.phone || null,
    status: 'VIP',
    loyalty_points: 0,
    nationality: b.nationality || null,
    special_requests: b.specialRequests || null,
    property_id: b.propertyId || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (gErr) return res.status(500).json({ error: gErr.message });

  const { error: pErr } = await supabaseAdmin.from('ops_vip_profiles').upsert({
    guest_id: guestId,
    property_id: b.propertyId || null,
    category: b.category || 'VIP',
    butler: b.butler || null,
    notes: b.notes || null,
    created_by: req.user?.name || 'manager',
  }, { onConflict: 'guest_id' });
  if (pErr) console.warn(`[ops-vip] profile: ${pErr.message}`);

  cacheService.invalidate('ops-vip:*');
  return res.status(201).json({ ok: true, guestId });
});

// PATCH /api/ops-portal/vip-guests/:guestId/profile — upsert ops profile fields.
router.patch('/vip-guests/:guestId/profile', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (b.category !== undefined && !VIP_CATEGORIES.includes(b.category)) {
    return res.status(400).json({ error: 'invalid category' });
  }
  const update: Record<string, any> = {
    guest_id: req.params.guestId,
    property_id: b.propertyId || null,
    created_by: req.user?.name || 'manager',
  };
  if (b.category !== undefined) update.category = b.category;
  if (b.butler !== undefined) update.butler = b.butler;
  if (b.notifications !== undefined) update.notifications = !!b.notifications;
  if (b.notes !== undefined) update.notes = b.notes;

  const { data, error } = await supabaseAdmin
    .from('ops_vip_profiles').upsert(update, { onConflict: 'guest_id' }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-vip:*');
  return res.json({ ok: true, profile: data });
});

// POST /api/ops-portal/vip-guests/:guestId/requests — raise a real guest_request
// (visible in the Front Office concierge queue).
router.post('/vip-guests/:guestId/requests', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (!b.description?.trim()) return res.status(400).json({ error: 'description is required' });

  const { data: guest, error: gErr } = await supabaseAdmin
    .from('guests').select('id, name').eq('id', req.params.guestId).single();
  if (gErr || !guest) return res.status(404).json({ error: 'guest not found' });

  // Find the guest's active reservation for room/reservation linkage.
  const { data: resRows } = await supabaseAdmin.from('reservations')
    .select('id, room_number, status, check_in_date')
    .eq('guest_id', guest.id)
    .order('check_in_date', { ascending: false });
  const active = pickReservation(resRows || []);

  const { data, error } = await supabaseAdmin.from('guest_requests').insert({
    id: `GRQ-VIP-${Date.now()}`,
    reservation_id: active?.id || null,
    room_number: active?.room_number || null,
    guest_name: guest.name,
    request_type: b.type || 'VIP Service',
    description: b.description.trim(),
    priority: b.priority || 'High',
    status: 'Pending',
    assigned_department: b.department || 'FO',
    submitted_at: new Date().toISOString(),
    property_id: b.propertyId || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-vip:*');
  return res.status(201).json({ ok: true, request: data });
});

export default router;
