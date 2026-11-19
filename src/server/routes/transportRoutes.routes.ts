/**
 * Transportation Routes API
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed route definitions (standard/dynamic/express) with distance, time
 * and cost estimates. Mounted at /api/transport/routes.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';
import { auditTransport, boundPropertyId, isNotFound, scopeRowWrite } from '../services/transportScope';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'transport-routes:';
const ROUTE_TYPES = ['Standard Route', 'Dynamic Route', 'Express Route'];
const ROUTE_CATEGORIES = ['Airport Transfer', 'City Transfer', 'Corporate Transfer', 'Tour Transportation', 'Staff Transportation'];
const ROUTE_STATUSES = ['Active', 'Inactive', 'Seasonal'];

// ── List routes for a property ───────────────────────────────────────────────
router.get('/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = boundPropertyId(req, req.params.propertyId);
  if (!propertyId) return res.status(403).json({ error: 'No property access' });
  const { status, category } = req.query as { status?: string; category?: string };

  const cacheKey = `${CACHE_PREFIX}${propertyId}:${status || 'all'}:${category || 'all'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  let query = supabaseAdmin
    .from('transport_routes')
    .select('*')
    .eq('property_id', propertyId)
    .order('route_number', { ascending: true })
    .limit(500);
  if (status && ROUTE_STATUSES.includes(status)) query = query.eq('status', status);
  if (category && ROUTE_CATEGORIES.includes(category)) query = query.eq('category', category);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const result = { routes: data || [] };
  cacheService.set(cacheKey, result, 60 * 1000);
  return res.json(result);
});

// ── Create route ─────────────────────────────────────────────────────────────
router.post('/', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, type, category, startPoint, endPoint, distance,
    estimatedTime, tollCost, fuelCost, status, frequentStops } = req.body || {};
  const propertyId = boundPropertyId(req, req.body?.propertyId);

  if (!propertyId || !name || !startPoint || !endPoint) {
    return res.status(400).json({ error: 'propertyId, name, startPoint and endPoint are required' });
  }
  if (type && !ROUTE_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid route type' });
  if (category && !ROUTE_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category' });
  if (status && !ROUTE_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const routeNumber = `RT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

  const { data, error } = await supabaseAdmin.from('transport_routes').insert({
    property_id: propertyId, route_number: routeNumber, name,
    type: type || 'Standard Route', category: category || 'City Transfer',
    start_point: startPoint, end_point: endPoint,
    distance: Number(distance) || 0, estimated_time: Number(estimatedTime) || 0,
    toll_cost: Number(tollCost) || 0, fuel_cost: Number(fuelCost) || 0,
    status: status || 'Active',
    frequent_stops: Array.isArray(frequentStops) ? frequentStops : [],
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'route.create', 'transport_route', data.id, { name, routeNumber });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

// ── Update route ─────────────────────────────────────────────────────────────
router.put('/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (b.type !== undefined && !ROUTE_TYPES.includes(b.type)) return res.status(400).json({ error: 'Invalid route type' });
  if (b.category !== undefined && !ROUTE_CATEGORIES.includes(b.category)) return res.status(400).json({ error: 'Invalid category' });
  if (b.status !== undefined && !ROUTE_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid status' });

  const patch: any = { updated_at: new Date().toISOString() };
  const map: Record<string, string> = {
    name: 'name', type: 'type', category: 'category', startPoint: 'start_point',
    endPoint: 'end_point', distance: 'distance', estimatedTime: 'estimated_time',
    tollCost: 'toll_cost', fuelCost: 'fuel_cost', status: 'status', frequentStops: 'frequent_stops',
  };
  for (const [key, col] of Object.entries(map)) {
    if (b[key] !== undefined) patch[col] = b[key];
  }

  const { data, error } = await scopeRowWrite(supabaseAdmin.from('transport_routes').update(patch).eq('id', req.params.id), req).select().single();
  if (error) return res.status(isNotFound(error) ? 404 : 500).json({ error: error.message });
  auditTransport(req, 'route.update', 'transport_route', data.id, { status: data.status });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

// ── Delete route ─────────────────────────────────────────────────────────────
router.delete('/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin.from('transport_routes').delete().eq('id', req.params.id), req);
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'route.delete', 'transport_route', req.params.id);
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
