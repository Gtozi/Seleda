/**
 * Vehicle Maintenance API
 * ──────────────────────────────────────────────────────────────────────────
 * Maintenance requests linked to the fleet. Mounted at /api/transport/maintenance.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';
import { auditTransport, boundPropertyId, isNotFound, scopeRowWrite } from '../services/transportScope';

const router = Router();

// Transport status → Engineering work_order status (work_orders use
// Open/In Progress/On Hold/Completed/Cancelled).
const TO_WO_STATUS: Record<string, string> = {
  'Pending': 'Open', 'Scheduled': 'Open', 'In Progress': 'In Progress',
  'Completed': 'Completed', 'Cancelled': 'Cancelled',
};

/**
 * Create the linked Engineering work order for a vehicle maintenance request
 * (spec §20 — the portal is an interface into Engineering, not a silo).
 */
async function createLinkedWorkOrder(req: any, mr: any, vehicle: any): Promise<string | null> {
  try {
    const woId = `WO-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const { data, error } = await supabaseAdmin!.from('work_orders').insert({
      id: woId,
      wo_number: `WO-${Date.now().toString().slice(-6)}`,
      title: `Fleet ${mr.type} — ${vehicle?.vehicle_number || mr.vehicle_id || 'vehicle'}`,
      description: mr.description || `${mr.type} for ${vehicle?.vehicle_number || 'vehicle'}`,
      type: mr.type === 'Preventive Maintenance' ? 'Preventive' : 'Corrective',
      priority: mr.priority === 'High' ? 'High' : mr.priority === 'Low' ? 'Low' : 'Medium',
      status: 'Open',
      room_number: vehicle?.vehicle_number || null,
      scheduled_date: mr.scheduled_date || null,
      cost_estimate: mr.estimated_cost || 0,
      notes: `Transport maintenance request ${mr.request_number}${mr.vendor ? ` · vendor ${mr.vendor}` : ''}`,
      created_by: req.user?.id || null,
    }).select('id').single();
    if (error) { console.warn('[transport] WO creation failed:', error.message); return null; }
    return data?.id || null;
  } catch (e: any) {
    console.warn('[transport] WO creation failed:', e?.message);
    return null;
  }
}

/** Push a transport maintenance status onto the linked work order. */
async function syncWorkOrderStatus(workOrderId: string | null | undefined, status: string | undefined) {
  if (!workOrderId || !status || !TO_WO_STATUS[status]) return;
  const patch: any = { status: TO_WO_STATUS[status] };
  if (status === 'Completed') patch.completed_at = new Date().toISOString();
  await supabaseAdmin!.from('work_orders').update(patch).eq('id', workOrderId);
}

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'transport-maintenance:';
const REQUEST_TYPES = ['Preventive Maintenance', 'Breakdown Repair', 'Inspection', 'Emergency Repair'];
const PRIORITIES = ['High', 'Normal', 'Low'];
const STATUSES = ['Pending', 'In Progress', 'Scheduled', 'Completed', 'Cancelled'];

const SELECT = '*, transport_vehicles(vehicle_number, make, model, status, mileage)';

// ── List maintenance requests ────────────────────────────────────────────────
router.get('/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = boundPropertyId(req, req.params.propertyId);
  if (!propertyId) return res.status(403).json({ error: 'No property access' });
  const { status, priority } = req.query as { status?: string; priority?: string };

  const cacheKey = `${CACHE_PREFIX}${propertyId}:${status || 'all'}:${priority || 'all'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  let query = supabaseAdmin
    .from('transport_maintenance_requests')
    .select(SELECT)
    .eq('property_id', propertyId)
    .order('requested_date', { ascending: false })
    .limit(500);
  if (status && STATUSES.includes(status)) query = query.eq('status', status);
  if (priority && PRIORITIES.includes(priority)) query = query.eq('priority', priority);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const result = { requests: data || [] };
  cacheService.set(cacheKey, result, 60 * 1000);
  return res.json(result);
});

// ── Create request ───────────────────────────────────────────────────────────
router.post('/', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { vehicleId, type, priority, description, status,
    requestedDate, scheduledDate, estimatedCost, vendor, assignedTo, notes } = req.body || {};
  const propertyId = boundPropertyId(req, req.body?.propertyId);

  if (!propertyId || !type) return res.status(400).json({ error: 'propertyId and type are required' });
  if (!REQUEST_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid type' });
  if (priority && !PRIORITIES.includes(priority)) return res.status(400).json({ error: 'Invalid priority' });
  if (status && !STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const requestNumber = `MR-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

  const { data, error } = await supabaseAdmin.from('transport_maintenance_requests').insert({
    property_id: propertyId,
    request_number: requestNumber,
    vehicle_id: vehicleId || null,
    type,
    priority: priority || 'Normal',
    description: description || null,
    status: status || 'Pending',
    requested_date: requestedDate || new Date().toISOString().slice(0, 10),
    scheduled_date: scheduledDate || null,
    estimated_cost: Number(estimatedCost) || 0,
    vendor: vendor || null,
    assigned_to: assignedTo || null,
    notes: notes || null,
  }).select(SELECT).single();
  if (error) return res.status(500).json({ error: error.message });

  // Bridge to Engineering: every vehicle maintenance request spawns a real
  // work order so Engineering sees and executes it.
  const { data: vehicle } = vehicleId
    ? await supabaseAdmin.from('transport_vehicles').select('vehicle_number').eq('id', vehicleId).maybeSingle()
    : { data: null };
  const woId = await createLinkedWorkOrder(req, data, vehicle);
  let result = data;
  if (woId) {
    const { data: linked } = await supabaseAdmin
      .from('transport_maintenance_requests')
      .update({ work_order_id: woId })
      .eq('id', data.id)
      .select(SELECT)
      .single();
    if (linked) result = linked;
  }

  auditTransport(req, 'maintenance_request.create', 'transport_maintenance_request', result.id, { requestNumber, workOrderId: woId });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(result);
});

// ── Update request ───────────────────────────────────────────────────────────
router.put('/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (b.type !== undefined && !REQUEST_TYPES.includes(b.type)) return res.status(400).json({ error: 'Invalid type' });
  if (b.priority !== undefined && !PRIORITIES.includes(b.priority)) return res.status(400).json({ error: 'Invalid priority' });
  if (b.status !== undefined && !STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid status' });

  const patch: any = { updated_at: new Date().toISOString() };
  const map: Record<string, string> = {
    vehicleId: 'vehicle_id', type: 'type', priority: 'priority', description: 'description',
    status: 'status', requestedDate: 'requested_date', scheduledDate: 'scheduled_date',
    completedDate: 'completed_date', estimatedCost: 'estimated_cost', actualCost: 'actual_cost',
    vendor: 'vendor', assignedTo: 'assigned_to', notes: 'notes',
  };
  for (const [key, col] of Object.entries(map)) {
    if (b[key] !== undefined) patch[col] = b[key];
  }
  if (b.vehicleId !== undefined) patch.vehicle_id = b.vehicleId || null;
  if (b.status === 'Completed' && b.completedDate === undefined) {
    patch.completed_date = new Date().toISOString().slice(0, 10);
  }

  const { data, error } = await scopeRowWrite(supabaseAdmin.from('transport_maintenance_requests').update(patch).eq('id', req.params.id), req).select(SELECT).single();
  if (error) return res.status(isNotFound(error) ? 404 : 500).json({ error: error.message });
  if (b.status !== undefined) {
    syncWorkOrderStatus(data.work_order_id, data.status).catch(() => {});
  }
  auditTransport(req, 'maintenance_request.update', 'transport_maintenance_request', data.id, { status: data.status });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

// ── Delete request ───────────────────────────────────────────────────────────
router.delete('/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin.from('transport_maintenance_requests').delete().eq('id', req.params.id), req);
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'maintenance_request.delete', 'transport_maintenance_request', req.params.id);
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
