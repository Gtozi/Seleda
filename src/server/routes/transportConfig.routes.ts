/**
 * Transportation Configuration API
 * ──────────────────────────────────────────────────────────────────────────
 * Configuration lists — transportation types, service areas, vehicle
 * categories, fuel types, and driver groups. Backed by the grouped
 * `transport_config_items` table (migration 522). Mounted at
 * /api/transport/config.
 *
 *   - GET    /:propertyId     all config items grouped by list
 *   - POST   /item            create a config item
 *   - PUT    /item/:id        update a config item
 *   - DELETE /item/:id        remove a config item
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

const ITEM_GROUPS = ['transport_type', 'service_area', 'vehicle_category', 'fuel_type', 'driver_group'] as const;
type ItemGroup = (typeof ITEM_GROUPS)[number];

const GROUP_RESPONSE_KEYS: Record<ItemGroup, string> = {
  transport_type: 'transportTypes',
  service_area: 'serviceAreas',
  vehicle_category: 'vehicleCategories',
  fuel_type: 'fuelTypes',
  driver_group: 'driverGroups',
};

// Only these columns are writable per group.
const GROUP_FIELDS: Record<ItemGroup, string[]> = {
  transport_type: ['name', 'active', 'base_rate'],
  service_area: ['name', 'active', 'description'],
  vehicle_category: ['name', 'active', 'capacity'],
  fuel_type: ['name', 'active'],
  driver_group: ['name', 'active'],
};

const CACHE_PREFIX = 'transport:config:';

// ── All config items grouped by list ─────────────────────────────────────────
router.get('/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = boundPropertyId(req, req.params.propertyId);
  if (!propertyId) return res.status(403).json({ error: 'No property access' });

  const cached = cacheService.get(`${CACHE_PREFIX}${propertyId}`);
  if (cached) return res.json(cached);

  const { data, error } = await supabaseAdmin
    .from('transport_config_items')
    .select('*')
    .eq('property_id', propertyId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  const result: Record<string, any[]> = {
    transportTypes: [],
    serviceAreas: [],
    vehicleCategories: [],
    fuelTypes: [],
    driverGroups: [],
  };
  for (const item of data || []) {
    const key = GROUP_RESPONSE_KEYS[item.item_group as ItemGroup];
    if (key) result[key].push(item);
  }

  cacheService.set(`${CACHE_PREFIX}${propertyId}`, result, 60 * 1000);
  return res.json(result);
});

// ── Create a config item ─────────────────────────────────────────────────────
router.post('/item', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const body = req.body || {};
  const { itemGroup } = body;
  const propertyId = boundPropertyId(req, body.propertyId);
  if (!propertyId) return res.status(400).json({ error: 'propertyId is required' });
  if (!(ITEM_GROUPS as readonly string[]).includes(itemGroup)) {
    return res.status(400).json({ error: `itemGroup must be one of: ${ITEM_GROUPS.join(', ')}` });
  }
  if (!body.name || !String(body.name).trim()) return res.status(400).json({ error: 'name is required' });

  const insert: Record<string, any> = {
    property_id: propertyId,
    item_group: itemGroup,
    name: String(body.name).trim(),
    active: body.active !== false,
    sort_order: Number.isFinite(body.sortOrder) ? body.sortOrder : 0,
  };
  for (const f of GROUP_FIELDS[itemGroup as ItemGroup]) {
    if (f === 'name' || f === 'active') continue;
    const camel = f.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (body[camel] !== undefined) insert[f] = body[camel];
  }

  const { data, error } = await supabaseAdmin.from('transport_config_items').insert(insert).select().single();
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'config_item.create', 'transport_config_item', data.id, { itemGroup: body.itemGroup, name: insert.name });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

// ── Update a config item ─────────────────────────────────────────────────────
router.put('/item/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const body = req.body || {};

  const { data: existing, error: fetchErr } = await scopeRowWrite(
    supabaseAdmin.from('transport_config_items').select('property_id, item_group').eq('id', req.params.id), req
  ).maybeSingle();
  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!existing) return res.status(404).json({ error: 'Config item not found' });

  const updates: Record<string, any> = { updated_at: new Date().toISOString() };
  let has = false;
  for (const f of GROUP_FIELDS[existing.item_group as ItemGroup] || []) {
    const camel = f.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (body[camel] !== undefined) {
      updates[f] = f === 'name' ? String(body[camel]).trim() : body[camel];
      has = true;
    }
  }
  if (!has) return res.status(400).json({ error: 'No valid fields to update' });

  const { data, error } = await scopeRowWrite(
    supabaseAdmin.from('transport_config_items').update(updates).eq('id', req.params.id), req
  ).select().single();
  if (error) return res.status(isNotFound(error) ? 404 : 500).json({ error: error.message });
  auditTransport(req, 'config_item.update', 'transport_config_item', data.id, updates);
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

// ── Delete a config item ─────────────────────────────────────────────────────
router.delete('/item/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data: existing, error: fetchErr } = await scopeRowWrite(
    supabaseAdmin.from('transport_config_items').select('property_id').eq('id', req.params.id), req
  ).maybeSingle();
  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!existing) return res.status(404).json({ error: 'Config item not found' });

  const { error } = await scopeRowWrite(supabaseAdmin.from('transport_config_items').delete().eq('id', req.params.id), req);
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'config_item.delete', 'transport_config_item', req.params.id);
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
