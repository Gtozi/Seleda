/**
 * Transportation Driver Management API
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed CRUD for drivers. Links to shared HR employees table.
 * Mounted at /api/transport/drivers.
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

const CACHE_PREFIX = 'transport-drivers:';

// ── List drivers with employee details ───────────────────────────────────────
router.get('/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = boundPropertyId(req, req.params.propertyId);
  if (!propertyId) return res.status(403).json({ error: 'No property access' });

  const { data, error } = await supabaseAdmin
    .from('transport_drivers')
    .select('*, employees!inner(name, phone, email, hire_date, status)')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ drivers: data || [] });
});

// ── Create driver ────────────────────────────────────────────────────────────
router.post('/', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { employeeId, licenseNumber, licenseCategory, licenseExpiry, medicalCertificate,
    certifications, assignedVehicle, shift, incidents, totalTrips, performance, status } = req.body || {};
  const propertyId = boundPropertyId(req, req.body?.propertyId);

  if (!propertyId || !employeeId || !licenseNumber) return res.status(400).json({ error: 'propertyId, employeeId and licenseNumber are required' });

  const { data, error } = await supabaseAdmin.from('transport_drivers').insert({
    property_id: propertyId, employee_id: employeeId, license_number: licenseNumber,
    license_category: licenseCategory || null, license_expiry: licenseExpiry || null,
    medical_certificate: medicalCertificate || null,
    certifications: certifications || [],
    assigned_vehicle: assignedVehicle || null,
    shift: shift || null,
    incidents: Number(incidents) || 0,
    total_trips: Number(totalTrips) || 0,
    performance: Number(performance) || 0,
    status: status || 'Active',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'driver.create', 'transport_driver', data.id);
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

// ── Update driver ────────────────────────────────────────────────────────────
router.put('/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { licenseNumber, licenseCategory, licenseExpiry, medicalCertificate, certifications,
    assignedVehicle, shift, incidents, totalTrips, performance, status } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (licenseNumber !== undefined) patch.license_number = licenseNumber;
  if (licenseCategory !== undefined) patch.license_category = licenseCategory;
  if (licenseExpiry !== undefined) patch.license_expiry = licenseExpiry;
  if (medicalCertificate !== undefined) patch.medical_certificate = medicalCertificate;
  if (certifications !== undefined) patch.certifications = certifications;
  if (assignedVehicle !== undefined) patch.assigned_vehicle = assignedVehicle;
  if (shift !== undefined) patch.shift = shift;
  if (incidents !== undefined) patch.incidents = Number(incidents) || 0;
  if (totalTrips !== undefined) patch.total_trips = Number(totalTrips) || 0;
  if (performance !== undefined) patch.performance = Number(performance) || 0;
  if (status !== undefined) patch.status = status;

  const { data, error } = await scopeRowWrite(supabaseAdmin.from('transport_drivers').update(patch).eq('id', req.params.id), req).select().single();
  if (error) return res.status(isNotFound(error) ? 404 : 500).json({ error: error.message });
  auditTransport(req, 'driver.update', 'transport_driver', data.id, { status: data.status });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

// ── Delete driver ────────────────────────────────────────────────────────────
router.delete('/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin.from('transport_drivers').delete().eq('id', req.params.id), req);
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'driver.delete', 'transport_driver', req.params.id);
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
