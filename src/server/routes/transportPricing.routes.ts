/**
 * Transport Pricing API
 * ──────────────────────────────────────────────────────────────────────────
 * Pricing rules (Fixed / Distance-Based / Time-Based / Zone-Based / Package)
 * and the quote endpoint used to auto-price trips (spec §22 "Pricing").
 * Mounted at /api/transport/pricing.
 *
 *   - GET    /:propertyId        list rules
 *   - POST   /                   create rule
 *   - PUT    /:id                update rule
 *   - DELETE /:id                delete rule
 *   - GET    /quote/:propertyId  ?type=&distanceKm=&durationMin=&pickup=&destination=
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';
import { auditTransport, boundPropertyId, isNotFound, scopeRowWrite } from '../services/transportScope';
import { computeQuote, type PricingRule, type QuoteInput } from '../services/transportOps';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'transport-pricing:';
const RULE_TYPES = ['Fixed', 'Distance-Based', 'Time-Based', 'Zone-Based', 'Package'];

// ── Quote ────────────────────────────────────────────────────────────────────
// Registered before /:propertyId so 'quote' isn't bound as a property id.
router.get('/quote/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = boundPropertyId(req, req.params.propertyId);
  if (!propertyId) return res.status(403).json({ error: 'No property access' });

  const { type, distanceKm, durationMin, pickup, destination } = req.query as Record<string, string | undefined>;
  if (!type) return res.status(400).json({ error: 'type is required' });

  const { data: rules, error } = await supabaseAdmin
    .from('transport_pricing_rules')
    .select('*')
    .eq('property_id', propertyId)
    .eq('active', true)
    .order('priority', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const input: QuoteInput = {
    type,
    distanceKm: distanceKm != null && distanceKm !== '' ? Number(distanceKm) : null,
    durationMin: durationMin != null && durationMin !== '' ? Number(durationMin) : null,
    pickupLocation: pickup || null,
    destination: destination || null,
  };
  const { amount, rule } = computeQuote((rules || []) as PricingRule[], input);
  return res.json({ amount, ruleId: rule?.id || null, ruleName: rule?.name || null });
});

// ── List rules ───────────────────────────────────────────────────────────────
router.get('/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = boundPropertyId(req, req.params.propertyId);
  if (!propertyId) return res.status(403).json({ error: 'No property access' });

  const cacheKey = `${CACHE_PREFIX}${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const { data, error } = await supabaseAdmin
    .from('transport_pricing_rules')
    .select('*')
    .eq('property_id', propertyId)
    .order('priority', { ascending: false })
    .limit(500);
  if (error) return res.status(500).json({ error: error.message });
  const result = { rules: data || [] };
  cacheService.set(cacheKey, result, 60 * 1000);
  return res.json(result);
});

// ── Create rule ──────────────────────────────────────────────────────────────
router.post('/', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, transportType, ruleType, baseFare, perKmRate, perMinuteRate,
    zoneFrom, zoneTo, packagePrice, minFare, priority } = req.body || {};
  const propertyId = boundPropertyId(req, req.body?.propertyId);

  if (!propertyId || !name) return res.status(400).json({ error: 'propertyId and name are required' });
  if (ruleType && !RULE_TYPES.includes(ruleType)) return res.status(400).json({ error: 'Invalid rule type' });

  const { data, error } = await supabaseAdmin.from('transport_pricing_rules').insert({
    property_id: propertyId,
    name,
    transport_type: transportType || null,
    rule_type: ruleType || 'Fixed',
    base_fare: Number(baseFare) || 0,
    per_km_rate: Number(perKmRate) || 0,
    per_minute_rate: Number(perMinuteRate) || 0,
    zone_from: zoneFrom || null,
    zone_to: zoneTo || null,
    package_price: packagePrice != null ? Number(packagePrice) : null,
    min_fare: Number(minFare) || 0,
    priority: Number(priority) || 0,
  }).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'pricing_rule.create', 'transport_pricing_rule', data.id, { name, ruleType: data.rule_type });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

// ── Update rule ──────────────────────────────────────────────────────────────
router.put('/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (b.ruleType !== undefined && !RULE_TYPES.includes(b.ruleType)) return res.status(400).json({ error: 'Invalid rule type' });

  const patch: any = { updated_at: new Date().toISOString() };
  const map: Record<string, string> = {
    name: 'name', transportType: 'transport_type', ruleType: 'rule_type',
    baseFare: 'base_fare', perKmRate: 'per_km_rate', perMinuteRate: 'per_minute_rate',
    zoneFrom: 'zone_from', zoneTo: 'zone_to', packagePrice: 'package_price',
    minFare: 'min_fare', active: 'active', priority: 'priority',
  };
  for (const [key, col] of Object.entries(map)) {
    if (b[key] !== undefined) patch[col] = b[key];
  }

  const { data, error } = await scopeRowWrite(
    supabaseAdmin.from('transport_pricing_rules').update(patch).eq('id', req.params.id), req
  ).select('*').single();
  if (error) return res.status(isNotFound(error) ? 404 : 500).json({ error: error.message });
  auditTransport(req, 'pricing_rule.update', 'transport_pricing_rule', data.id);
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

// ── Delete rule ──────────────────────────────────────────────────────────────
router.delete('/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(
    supabaseAdmin.from('transport_pricing_rules').delete().eq('id', req.params.id), req
  );
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'pricing_rule.delete', 'transport_pricing_rule', req.params.id);
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
