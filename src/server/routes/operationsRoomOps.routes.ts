/**
 * Room Operations routes — mounted at /api/ops-portal.
 *
 * Backs the /erp/operations/room-operations tab (RoomOperationsOverview.tsx).
 * Pure live-data — the shared `rooms` table is the source of truth:
 *
 *   GET   /room-operations?propertyId=
 *         rooms (number/type/floor/status) normalized to the board model,
 *         enriched per room from:
 *           reservations (CheckedIn)      → guest name            (FO)
 *           housekeeping_task_mgmt        → open cleaning tasks   (HK)
 *           work_orders                   → open work orders      (Engineering)
 *           room_inspections              → last inspection       (HK)
 *           guest_requests (open)         → request count         (FO concierge)
 *
 *   PATCH /room-operations/rooms/:id         — set rooms.status (shared with
 *                                              the FO room rack + HK board)
 *   POST  /room-operations/rooms/:id/cleaning-task — create a real
 *                                              housekeeping_task_mgmt row
 *   POST  /room-operations/rooms/:id/work-order    — create a real
 *                                              work_orders row (Engineering)
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();
const CACHE_TTL_MS = 15 * 1000;

// Canonical rooms.status vocabulary used across FO/HK portals.
const ROOM_STATUSES = [
  'Occupied Clean', 'Occupied Dirty', 'Vacant Clean', 'Vacant Dirty',
  'Inspected', 'Out of Order', 'Out of Service', 'Maintenance',
] as const;

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

async function fetchRows(query: any, tag: string): Promise<any[]> {
  try {
    const r = await query;
    if (r.error) {
      console.warn(`[ops-rooms] ${tag}: ${r.error.message}`);
      return [];
    }
    return (r.data as any[]) || [];
  } catch (e: any) {
    console.warn(`[ops-rooms] ${tag}: ${e?.message || e}`);
    return [];
  }
}

// rooms.status → board bucket.
const boardStatus = (s: any): string => {
  const v = String(s || '').toLowerCase();
  if (v.includes('out of order')) return 'out-of-order';
  if (v.includes('out of service')) return 'out-of-service';
  if (v.includes('maintenance')) return 'maintenance';
  if (v.includes('inspected')) return 'inspected';
  if (v.includes('occupied')) return 'occupied';
  if (v.includes('dirty')) return 'dirty';
  if (v.includes('clean')) return 'clean';
  return 'vacant';
};

const normRoom = (n: any) => String(n ?? '').toLowerCase().replace(/^room\s+/i, '');

// GET /api/ops-portal/room-operations
router.get('/room-operations', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.query as Record<string, string>).propertyId || undefined;
  const eqProp = (q: any): any => (propertyId ? q.eq('property_id', propertyId) : q);

  const cacheKey = `ops-rooms:${propertyId || 'all'}`;
  const cached = cacheService.get<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const [rooms, reservations, hkTasks, workOrders, inspections, requests] = await Promise.all([
      fetchRows(eqProp(supabaseAdmin!.from('rooms')
        .select('id, number, type, floor, status, rate, features')
        .order('number')), 'rooms'),
      fetchRows(eqProp(supabaseAdmin!.from('reservations')
        .select('id, guest_name, room_number, check_in_date, check_out_date, status')
        .in('status', ['CheckedIn', 'Checked In', 'InHouse'])), 'reservations'),
      fetchRows(eqProp(supabaseAdmin!.from('housekeeping_task_mgmt')
        .select('id, type, location, status, assigned_to, priority, due_date')
        .not('status', 'in', '("Completed","Cancelled")')), 'hk tasks'),
      fetchRows(eqProp(supabaseAdmin!.from('work_orders')
        .select('id, title, room_number, status, priority, assigned_to')
        .not('status', 'in', '("Completed","Closed","Cancelled","Verified")')), 'work orders'),
      fetchRows(eqProp(supabaseAdmin!.from('room_inspections')
        .select('id, room_number, result, inspection_date, inspector')
        .order('inspection_date', { ascending: false })), 'inspections'),
      fetchRows(eqProp(supabaseAdmin!.from('guest_requests')
        .select('id, room_number, request_type, status, priority')
        .in('status', ['Pending', 'pending', 'In Progress', 'in-progress', 'Acknowledged'])), 'guest requests'),
    ]);

    const resByRoom = new Map(reservations.map((r) => [normRoom(r.room_number), r]));
    const hkByRoom = new Map<string, any[]>();
    for (const t of hkTasks) {
      const key = normRoom(String(t.location || '').replace(/^room\s*/i, ''));
      if (!key) continue;
      const arr = hkByRoom.get(key) || [];
      arr.push(t);
      hkByRoom.set(key, arr);
    }
    const woByRoom = new Map<string, any[]>();
    for (const w of workOrders) {
      const key = normRoom(w.room_number);
      if (!key) continue;
      const arr = woByRoom.get(key) || [];
      arr.push(w);
      woByRoom.set(key, arr);
    }
    const inspByRoom = new Map<string, any>();
    for (const i of inspections) {
      const key = normRoom(i.room_number);
      if (key && !inspByRoom.has(key)) inspByRoom.set(key, i);
    }
    const reqByRoom = new Map<string, any[]>();
    for (const q of requests) {
      const key = normRoom(q.room_number);
      if (!key) continue;
      const arr = reqByRoom.get(key) || [];
      arr.push(q);
      reqByRoom.set(key, arr);
    }

    const out = rooms.map((r) => {
      const key = normRoom(r.number);
      const res = resByRoom.get(key);
      const hk = hkByRoom.get(key) || [];
      const wo = woByRoom.get(key) || [];
      const insp = inspByRoom.get(key);
      const reqs = reqByRoom.get(key) || [];

      return {
        id: r.id,
        roomNumber: r.number,
        roomType: r.type,
        floor: r.floor ?? (Math.floor(Number(String(r.number).replace(/\D/g, '') || '0') / 100) || 0),
        rawStatus: r.status,
        status: boardStatus(r.status),
        cleanliness: String(r.status || '').includes('Dirty') ? 'dirty'
          : String(r.status || '').includes('Clean') ? 'clean' : undefined,
        rate: r.rate != null ? Number(r.rate) : undefined,
        features: r.features || [],
        guestName: res?.guest_name || undefined,
        reservationId: res?.id,
        checkOutDate: res?.check_out_date,
        hkTasks: hk.map((t) => ({ id: t.id, type: t.type, status: t.status, assignedTo: t.assigned_to, priority: t.priority })),
        workOrders: wo.map((w) => ({ id: w.id, title: w.title, status: w.status, priority: w.priority, assignedTo: w.assigned_to })),
        lastInspection: insp ? { result: insp.result, date: insp.inspection_date, inspector: insp.inspector } : undefined,
        openRequests: reqs.length,
        needsAttention: wo.length > 0 || reqs.some((q) => ['High', 'Critical', 'high', 'critical'].includes(q.priority)) || boardStatus(r.status) === 'out-of-order' || boardStatus(r.status) === 'maintenance',
      };
    });

    const byStatus = out.reduce((m: Record<string, number>, r) => {
      m[r.status] = (m[r.status] || 0) + 1; return m;
    }, {});

    const payload = {
      generatedAt: new Date().toISOString(),
      rooms: out,
      floors: [...new Set(out.map((r) => r.floor))].sort((a, b) => a - b),
      stats: {
        total: out.length,
        byStatus,
        occupied: byStatus['occupied'] || 0,
        ready: (byStatus['clean'] || 0) + (byStatus['inspected'] || 0),
        dirty: byStatus['dirty'] || 0,
        blocked: (byStatus['out-of-order'] || 0) + (byStatus['out-of-service'] || 0) + (byStatus['maintenance'] || 0),
        needsAttention: out.filter((r) => r.needsAttention).length,
      },
    };
    cacheService.set(cacheKey, payload, CACHE_TTL_MS);
    return res.json(payload);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to load room operations' });
  }
});

// PATCH /api/ops-portal/room-operations/rooms/:id — set rooms.status.
router.patch('/room-operations/rooms/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const status = req.body?.status;
  if (!status || !ROOM_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${ROOM_STATUSES.join(', ')}` });
  }
  const { data, error } = await supabaseAdmin
    .from('rooms').update({ status }).eq('id', req.params.id).select('id, number, status').single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-rooms:*');
  return res.json({ ok: true, room: data });
});

// POST /api/ops-portal/room-operations/rooms/:id/cleaning-task — real HK task.
router.post('/room-operations/rooms/:id/cleaning-task', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data: room, error: rErr } = await supabaseAdmin
    .from('rooms').select('id, number, status, property_id').eq('id', req.params.id).single();
  if (rErr || !room) return res.status(404).json({ error: 'room not found' });

  const { data, error } = await supabaseAdmin.from('housekeeping_task_mgmt').insert({
    id: `HKT-OPS-${Date.now()}`,
    property_id: req.body?.propertyId || room.property_id || null,
    // housekeeping_task_mgmt: category CHECK allows 'Manual'|'Automatic';
    // type uses the HK vocabulary (Room Refresh, Stayover Service, …).
    type: req.body?.type || (String(room.status).includes('Occupied') ? 'Stayover Service' : 'Room Refresh'),
    category: 'Manual',
    location: `Room ${room.number}`,
    priority: req.body?.priority || (String(room.status).includes('Dirty') ? 'High' : 'Medium'),
    status: 'Pending',
    due_date: new Date().toISOString().slice(0, 10),
    notes: req.body?.notes || `Requested from Operations room board (${room.status})`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-rooms:*');
  return res.status(201).json({ ok: true, task: data });
});

// POST /api/ops-portal/room-operations/rooms/:id/work-order — real WO.
router.post('/room-operations/rooms/:id/work-order', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (!b.title?.trim()) return res.status(400).json({ error: 'title is required' });
  const { data: room, error: rErr } = await supabaseAdmin
    .from('rooms').select('id, number, property_id').eq('id', req.params.id).single();
  if (rErr || !room) return res.status(404).json({ error: 'room not found' });

  const woId = `WO-ROOM-${Date.now()}`;
  const { data, error } = await supabaseAdmin.from('work_orders').insert({
    id: woId,
    wo_number: woId,
    title: b.title.trim(),
    description: b.description?.trim() || `Raised from Operations room board — Room ${room.number}`,
    type: 'Corrective',
    priority: b.priority || 'Medium',
    status: 'Open',
    room_number: room.number,
    created_by: req.user?.name || 'manager',
    created_date: new Date().toISOString(),
    property_id: b.propertyId || room.property_id || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-rooms:*');
  return res.status(201).json({ ok: true, workOrder: data });
});

export default router;
