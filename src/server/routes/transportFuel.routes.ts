/**
 * Fuel Management API
 * ──────────────────────────────────────────────────────────────────────────
 * Fuel cards + fuel purchases. Mounted at /api/transport/fuel.
 * GET returns a combined { cards, purchases } snapshot for the page.
 */

import crypto from 'crypto';
import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';
import { auditTransport, boundPropertyId, isNotFound, scopeRowWrite } from '../services/transportScope';
import { detectFuelAnomaly } from '../services/transportOps';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'transport-fuel:';
const CARD_STATUSES = ['Active', 'Blocked', 'Expired', 'Lost'];
const FUEL_TYPES = ['Gasoline', 'Diesel', 'Electric', 'Hybrid'];

const PURCHASE_SELECT = `*,
  transport_vehicles(vehicle_number, make, model),
  transport_drivers(employees(name)),
  transport_fuel_cards(card_number, type)`;

// ── Combined snapshot: cards + purchases ─────────────────────────────────────
router.get('/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = boundPropertyId(req, req.params.propertyId);
  if (!propertyId) return res.status(403).json({ error: 'No property access' });

  const cacheKey = `${CACHE_PREFIX}${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const [cardsRes, purchasesRes] = await Promise.all([
    supabaseAdmin
      .from('transport_fuel_cards')
      .select('*')
      .eq('property_id', propertyId)
      .order('card_number', { ascending: true })
      .limit(500),
    supabaseAdmin
      .from('transport_fuel_purchases')
      .select(PURCHASE_SELECT)
      .eq('property_id', propertyId)
      .order('purchase_date', { ascending: false })
      .limit(500),
  ]);
  if (cardsRes.error) return res.status(500).json({ error: cardsRes.error.message });
  if (purchasesRes.error) return res.status(500).json({ error: purchasesRes.error.message });

  const result = { cards: cardsRes.data || [], purchases: purchasesRes.data || [] };
  cacheService.set(cacheKey, result, 60 * 1000);
  return res.json(result);
});

// ── Create purchase ──────────────────────────────────────────────────────────
router.post('/purchases', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { purchaseDate, vehicleId, driverId, station, fuelType,
    gallons, pricePerGallon, totalCost, odometer, fuelCardId, efficiency } = req.body || {};
  const propertyId = boundPropertyId(req, req.body?.propertyId);

  if (!propertyId) return res.status(400).json({ error: 'propertyId is required' });
  if (fuelType && !FUEL_TYPES.includes(fuelType)) return res.status(400).json({ error: 'Invalid fuel type' });

  const purchaseNumber = `FL-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

  // Theft/anomaly checks (spec §19): tank overfill, cost mismatch, odometer
  // regression and implausible computed efficiency.
  let flagReason: string | null = null;
  if (vehicleId) {
    const [{ data: vehicle }, { data: prev }] = await Promise.all([
      supabaseAdmin.from('transport_vehicles').select('tank_capacity_gal, mileage').eq('id', vehicleId).maybeSingle(),
      supabaseAdmin.from('transport_fuel_purchases')
        .select('odometer')
        .eq('property_id', propertyId)
        .eq('vehicle_id', vehicleId)
        .not('odometer', 'is', null)
        .order('purchase_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    flagReason = detectFuelAnomaly(
      { gallons, odometer, total_cost: totalCost, price_per_gallon: pricePerGallon },
      vehicle,
      prev
    );
  }

  const { data, error } = await supabaseAdmin.from('transport_fuel_purchases').insert({
    property_id: propertyId,
    purchase_number: purchaseNumber,
    purchase_date: purchaseDate || new Date().toISOString().slice(0, 10),
    vehicle_id: vehicleId || null,
    driver_id: driverId || null,
    station: station || null,
    fuel_type: fuelType || 'Gasoline',
    gallons: Number(gallons) || 0,
    price_per_gallon: Number(pricePerGallon) || 0,
    total_cost: Number(totalCost) || 0,
    odometer: odometer != null ? Number(odometer) : null,
    fuel_card_id: fuelCardId || null,
    efficiency: efficiency != null ? Number(efficiency) : null,
    flagged: flagReason != null,
    flag_reason: flagReason,
  }).select(PURCHASE_SELECT).single();
  if (error) return res.status(500).json({ error: error.message });
  if (flagReason) {
    await supabaseAdmin.from('notifications').insert({
      id: crypto.randomUUID(),
      property_id: propertyId,
      message: `Fuel anomaly on ${purchaseNumber}: ${flagReason}`,
      type: 'warning',
      department: 'Transportation',
      read: false,
      created_at: new Date().toISOString(),
    }).then(({ error: nErr }: any) => {
      if (nErr) console.warn('[transport-fuel] anomaly notification failed:', nErr.message);
    });
  }
  auditTransport(req, 'fuel_purchase.create', 'transport_fuel_purchase', data.id, { purchaseNumber, flagged: flagReason != null });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

// ── Update purchase ──────────────────────────────────────────────────────────
router.put('/purchases/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (b.fuelType !== undefined && !FUEL_TYPES.includes(b.fuelType)) return res.status(400).json({ error: 'Invalid fuel type' });

  const patch: any = { updated_at: new Date().toISOString() };
  const map: Record<string, string> = {
    purchaseDate: 'purchase_date', vehicleId: 'vehicle_id', driverId: 'driver_id',
    station: 'station', fuelType: 'fuel_type', gallons: 'gallons',
    pricePerGallon: 'price_per_gallon', totalCost: 'total_cost', odometer: 'odometer',
    fuelCardId: 'fuel_card_id', efficiency: 'efficiency',
    flagged: 'flagged', flagReason: 'flag_reason',
  };
  for (const [key, col] of Object.entries(map)) {
    if (b[key] !== undefined) patch[col] = b[key];
  }
  if (b.vehicleId !== undefined) patch.vehicle_id = b.vehicleId || null;
  if (b.driverId !== undefined) patch.driver_id = b.driverId || null;
  if (b.fuelCardId !== undefined) patch.fuel_card_id = b.fuelCardId || null;

  const { data, error } = await scopeRowWrite(supabaseAdmin.from('transport_fuel_purchases').update(patch).eq('id', req.params.id), req).select(PURCHASE_SELECT).single();
  if (error) return res.status(isNotFound(error) ? 404 : 500).json({ error: error.message });
  auditTransport(req, 'fuel_purchase.update', 'transport_fuel_purchase', data.id, patch);
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

// ── Delete purchase ──────────────────────────────────────────────────────────
router.delete('/purchases/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin.from('transport_fuel_purchases').delete().eq('id', req.params.id), req);
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'fuel_purchase.delete', 'transport_fuel_purchase', req.params.id);
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Create fuel card ─────────────────────────────────────────────────────────
router.post('/cards', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { maskedNumber, type, status, creditLimit, balance, assignedVehicle, expiryDate } = req.body || {};
  const propertyId = boundPropertyId(req, req.body?.propertyId);

  if (!propertyId) return res.status(400).json({ error: 'propertyId is required' });
  if (status && !CARD_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const cardNumber = `FC-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

  const { data, error } = await supabaseAdmin.from('transport_fuel_cards').insert({
    property_id: propertyId,
    card_number: cardNumber,
    masked_number: maskedNumber || null,
    type: type || 'Shell',
    status: status || 'Active',
    credit_limit: Number(creditLimit) || 0,
    balance: Number(balance) || 0,
    assigned_vehicle: assignedVehicle || null,
    expiry_date: expiryDate || null,
  }).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'fuel_card.create', 'transport_fuel_card', data.id, { cardNumber });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

// ── Update fuel card ─────────────────────────────────────────────────────────
router.put('/cards/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (b.status !== undefined && !CARD_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid status' });

  const patch: any = { updated_at: new Date().toISOString() };
  const map: Record<string, string> = {
    maskedNumber: 'masked_number', type: 'type', status: 'status',
    creditLimit: 'credit_limit', balance: 'balance',
    assignedVehicle: 'assigned_vehicle', expiryDate: 'expiry_date',
  };
  for (const [key, col] of Object.entries(map)) {
    if (b[key] !== undefined) patch[col] = b[key];
  }

  const { data, error } = await scopeRowWrite(supabaseAdmin.from('transport_fuel_cards').update(patch).eq('id', req.params.id), req).select('*').single();
  if (error) return res.status(isNotFound(error) ? 404 : 500).json({ error: error.message });
  auditTransport(req, 'fuel_card.update', 'transport_fuel_card', data.id, { status: data.status });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

// ── Delete fuel card ─────────────────────────────────────────────────────────
router.delete('/cards/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin.from('transport_fuel_cards').delete().eq('id', req.params.id), req);
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'fuel_card.delete', 'transport_fuel_card', req.params.id);
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
