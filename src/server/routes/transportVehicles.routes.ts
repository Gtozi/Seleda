/**
 * Transportation Vehicles API
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed fleet registry. Optionally links to transport_drivers for the
 * assigned driver. Mounted at /api/transport/vehicles.
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

const CACHE_PREFIX = 'transport-vehicles:';
const VEHICLE_CATEGORIES = ['Sedan', 'SUV', 'Van', 'Minibus', 'Luxury', 'Shuttle Bus', 'Utility Vehicle', 'Motorcycle', 'Electric', 'Electric Vehicle'];
const VEHICLE_STATUSES = ['Active', 'In Use', 'Maintenance', 'Out of Service', 'Retired', 'Sold'];
const VEHICLE_CONDITIONS = ['Excellent', 'Good', 'Fair', 'Service Required'];
const FUEL_TYPES = ['Gasoline', 'Diesel', 'Electric', 'Hybrid'];

const SELECT = '*, transport_drivers(id, employees(name, phone))';

// ── List vehicles for a property ─────────────────────────────────────────────
router.get('/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = boundPropertyId(req, req.params.propertyId);
  if (!propertyId) return res.status(403).json({ error: 'No property access' });
  const { status } = req.query as { status?: string };

  const cacheKey = `${CACHE_PREFIX}${propertyId}:${status || 'all'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  let query = supabaseAdmin
    .from('transport_vehicles')
    .select(SELECT)
    .eq('property_id', propertyId)
    .order('vehicle_number', { ascending: true });
  if (status && VEHICLE_STATUSES.includes(status)) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const result = { vehicles: data || [] };
  cacheService.set(cacheKey, result, 60 * 1000);
  return res.json(result);
});

// ── Create vehicle ───────────────────────────────────────────────────────────
router.post('/', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { vehicleNumber, registrationNumber, vin, make, model, year, color,
    category, capacity, fuelType, insuranceProvider, insurancePolicy, insuranceExpiry,
    registrationExpiry, status, purchaseDate, purchasePrice, currentValue, mileage,
    lastService, nextService, driverId, currentLocation, fuelLevel, utilization, condition } = req.body || {};
  const propertyId = boundPropertyId(req, req.body?.propertyId);

  if (!propertyId || !vehicleNumber) return res.status(400).json({ error: 'propertyId and vehicleNumber are required' });
  if (category && !VEHICLE_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category' });
  if (status && !VEHICLE_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  if (fuelType && !FUEL_TYPES.includes(fuelType)) return res.status(400).json({ error: 'Invalid fuel type' });
  if (condition && !VEHICLE_CONDITIONS.includes(condition)) return res.status(400).json({ error: 'Invalid condition' });

  const { data, error } = await supabaseAdmin.from('transport_vehicles').insert({
    property_id: propertyId, vehicle_number: vehicleNumber,
    registration_number: registrationNumber || null, vin: vin || null,
    make: make || null, model: model || null,
    year: year != null ? Number(year) : null, color: color || null,
    category: category || 'Sedan', capacity: Number(capacity) || 4,
    fuel_type: fuelType || 'Gasoline',
    insurance_provider: insuranceProvider || null, insurance_policy: insurancePolicy || null,
    insurance_expiry: insuranceExpiry || null, registration_expiry: registrationExpiry || null,
    status: status || 'Active',
    purchase_date: purchaseDate || null,
    purchase_price: Number(purchasePrice) || 0, current_value: Number(currentValue) || 0,
    mileage: Number(mileage) || 0,
    last_service: lastService || null, next_service: nextService || null,
    driver_id: driverId || null, current_location: currentLocation || null,
    fuel_level: fuelLevel != null ? Number(fuelLevel) : 100,
    utilization: utilization != null ? Number(utilization) : 0,
    condition: condition || 'Good',
  }).select(SELECT).single();
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'vehicle.create', 'transport_vehicle', data.id, { vehicleNumber });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

// ── Update vehicle ───────────────────────────────────────────────────────────
router.put('/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { vehicleNumber, registrationNumber, vin, make, model, year, color, category, capacity,
    fuelType, insuranceProvider, insurancePolicy, insuranceExpiry, registrationExpiry, status,
    purchaseDate, purchasePrice, currentValue, mileage, lastService, nextService, driverId,
    currentLocation, fuelLevel, utilization, condition } = req.body || {};

  if (category !== undefined && !VEHICLE_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category' });
  if (status !== undefined && !VEHICLE_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  if (fuelType !== undefined && !FUEL_TYPES.includes(fuelType)) return res.status(400).json({ error: 'Invalid fuel type' });
  if (condition !== undefined && !VEHICLE_CONDITIONS.includes(condition)) return res.status(400).json({ error: 'Invalid condition' });

  const patch: any = { updated_at: new Date().toISOString() };
  if (vehicleNumber !== undefined) patch.vehicle_number = vehicleNumber;
  if (registrationNumber !== undefined) patch.registration_number = registrationNumber;
  if (vin !== undefined) patch.vin = vin;
  if (make !== undefined) patch.make = make;
  if (model !== undefined) patch.model = model;
  if (year !== undefined) patch.year = year != null ? Number(year) : null;
  if (color !== undefined) patch.color = color;
  if (category !== undefined) patch.category = category;
  if (capacity !== undefined) patch.capacity = Number(capacity) || 4;
  if (fuelType !== undefined) patch.fuel_type = fuelType;
  if (insuranceProvider !== undefined) patch.insurance_provider = insuranceProvider;
  if (insurancePolicy !== undefined) patch.insurance_policy = insurancePolicy;
  if (insuranceExpiry !== undefined) patch.insurance_expiry = insuranceExpiry;
  if (registrationExpiry !== undefined) patch.registration_expiry = registrationExpiry;
  if (status !== undefined) patch.status = status;
  if (purchaseDate !== undefined) patch.purchase_date = purchaseDate;
  if (purchasePrice !== undefined) patch.purchase_price = Number(purchasePrice) || 0;
  if (currentValue !== undefined) patch.current_value = Number(currentValue) || 0;
  if (mileage !== undefined) patch.mileage = Number(mileage) || 0;
  if (lastService !== undefined) patch.last_service = lastService;
  if (nextService !== undefined) patch.next_service = nextService;
  if (driverId !== undefined) patch.driver_id = driverId || null;
  if (currentLocation !== undefined) patch.current_location = currentLocation;
  if (fuelLevel !== undefined) patch.fuel_level = Number(fuelLevel) || 0;
  if (utilization !== undefined) patch.utilization = Number(utilization) || 0;
  if (condition !== undefined) patch.condition = condition;

  const { data, error } = await scopeRowWrite(supabaseAdmin.from('transport_vehicles').update(patch).eq('id', req.params.id), req).select(SELECT).single();
  if (error) return res.status(isNotFound(error) ? 404 : 500).json({ error: error.message });
  auditTransport(req, 'vehicle.update', 'transport_vehicle', data.id, { status: data.status });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

// ── Delete vehicle ───────────────────────────────────────────────────────────
router.delete('/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin.from('transport_vehicles').delete().eq('id', req.params.id), req);
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'vehicle.delete', 'transport_vehicle', req.params.id);
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
