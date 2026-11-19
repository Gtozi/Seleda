/**
 * Contractor & Taxi Management API
 * ──────────────────────────────────────────────────────────────────────────
 * External contractors + their trips. Mounted at /api/transport/contractors.
 * GET returns a combined { contractors, trips } snapshot for the page.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';
import { auditTransport, boundPropertyId, isNotFound, scopeRowWrite } from '../services/transportScope';
import { expectedInvoiceAmount } from '../services/transportOps';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'transport-contractors:';
const CONTRACTOR_TYPES = ['Taxi Company', 'Chauffeur Service', 'Bus Operator', 'Tour Operator'];
const CONTRACTOR_STATUSES = ['Active', 'Pending', 'Inactive'];
const RATE_STRUCTURES = ['Per Mile', 'Hourly', 'Per Trip', 'Package'];
const TRIP_STATUSES = ['Scheduled', 'In Progress', 'Completed', 'Cancelled'];

const TRIP_SELECT = '*, transport_contractors(contractor_number, name, type)';

// ── Combined snapshot: contractors + trips ───────────────────────────────────
router.get('/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = boundPropertyId(req, req.params.propertyId);
  if (!propertyId) return res.status(403).json({ error: 'No property access' });

  const cacheKey = `${CACHE_PREFIX}${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const [contractorsRes, tripsRes] = await Promise.all([
    supabaseAdmin
      .from('transport_contractors')
      .select('*')
      .eq('property_id', propertyId)
      .order('contractor_number', { ascending: true })
      .limit(500),
    supabaseAdmin
      .from('transport_contractor_trips')
      .select(TRIP_SELECT)
      .eq('property_id', propertyId)
      .order('trip_date', { ascending: false })
      .limit(500),
  ]);
  if (contractorsRes.error) return res.status(500).json({ error: contractorsRes.error.message });
  if (tripsRes.error) return res.status(500).json({ error: tripsRes.error.message });

  const result = { contractors: contractorsRes.data || [], trips: tripsRes.data || [] };
  cacheService.set(cacheKey, result, 60 * 1000);
  return res.json(result);
});

// ── Create contractor ────────────────────────────────────────────────────────
router.post('/contractors', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, type, contact, phone, email, status, contractStart, contractEnd,
    rateStructure, baseRate, perMileRate, performance, totalTrips, onTimeRate, rating } = req.body || {};
  const propertyId = boundPropertyId(req, req.body?.propertyId);

  if (!propertyId || !name) return res.status(400).json({ error: 'propertyId and name are required' });
  if (type && !CONTRACTOR_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid type' });
  if (status && !CONTRACTOR_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  if (rateStructure && !RATE_STRUCTURES.includes(rateStructure)) return res.status(400).json({ error: 'Invalid rate structure' });

  const contractorNumber = `CTR-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

  const { data, error } = await supabaseAdmin.from('transport_contractors').insert({
    property_id: propertyId,
    contractor_number: contractorNumber,
    name,
    type: type || 'Taxi Company',
    contact: contact || null,
    phone: phone || null,
    email: email || null,
    status: status || 'Pending',
    contract_start: contractStart || null,
    contract_end: contractEnd || null,
    rate_structure: rateStructure || 'Per Trip',
    base_rate: Number(baseRate) || 0,
    per_mile_rate: Number(perMileRate) || 0,
    performance: Number(performance) || 0,
    total_trips: Number(totalTrips) || 0,
    on_time_rate: Number(onTimeRate) || 0,
    rating: Number(rating) || 0,
  }).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'contractor.create', 'transport_contractor', data.id, { name });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

// ── Update contractor ────────────────────────────────────────────────────────
router.put('/contractors/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (b.type !== undefined && !CONTRACTOR_TYPES.includes(b.type)) return res.status(400).json({ error: 'Invalid type' });
  if (b.status !== undefined && !CONTRACTOR_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid status' });
  if (b.rateStructure !== undefined && !RATE_STRUCTURES.includes(b.rateStructure)) return res.status(400).json({ error: 'Invalid rate structure' });

  const patch: any = { updated_at: new Date().toISOString() };
  const map: Record<string, string> = {
    name: 'name', type: 'type', contact: 'contact', phone: 'phone', email: 'email',
    status: 'status', contractStart: 'contract_start', contractEnd: 'contract_end',
    rateStructure: 'rate_structure', baseRate: 'base_rate', perMileRate: 'per_mile_rate',
    performance: 'performance', totalTrips: 'total_trips', onTimeRate: 'on_time_rate', rating: 'rating',
  };
  for (const [key, col] of Object.entries(map)) {
    if (b[key] !== undefined) patch[col] = b[key];
  }

  const { data, error } = await scopeRowWrite(supabaseAdmin.from('transport_contractors').update(patch).eq('id', req.params.id), req).select('*').single();
  if (error) return res.status(isNotFound(error) ? 404 : 500).json({ error: error.message });
  auditTransport(req, 'contractor.update', 'transport_contractor', data.id, patch);
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

// ── Delete contractor ────────────────────────────────────────────────────────
router.delete('/contractors/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin.from('transport_contractors').delete().eq('id', req.params.id), req);
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'contractor.delete', 'transport_contractor', req.params.id);
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Create contractor trip ───────────────────────────────────────────────────
router.post('/trips', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { contractorId, tripDate, destination, amount, status } = req.body || {};
  const propertyId = boundPropertyId(req, req.body?.propertyId);

  if (!propertyId) return res.status(400).json({ error: 'propertyId is required' });
  if (status && !TRIP_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const tripNumber = `CT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

  const { data, error } = await supabaseAdmin.from('transport_contractor_trips').insert({
    property_id: propertyId,
    trip_number: tripNumber,
    contractor_id: contractorId || null,
    trip_date: tripDate || new Date().toISOString().slice(0, 10),
    destination: destination || null,
    amount: Number(amount) || 0,
    status: status || 'Scheduled',
  }).select(TRIP_SELECT).single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

// ── Update contractor trip ───────────────────────────────────────────────────
router.put('/trips/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (b.status !== undefined && !TRIP_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid status' });

  const patch: any = { updated_at: new Date().toISOString() };
  const map: Record<string, string> = {
    contractorId: 'contractor_id', tripDate: 'trip_date', destination: 'destination',
    amount: 'amount', status: 'status',
  };
  for (const [key, col] of Object.entries(map)) {
    if (b[key] !== undefined) patch[col] = b[key];
  }
  if (b.contractorId !== undefined) patch.contractor_id = b.contractorId || null;

  const { data, error } = await scopeRowWrite(supabaseAdmin.from('transport_contractor_trips').update(patch).eq('id', req.params.id), req).select(TRIP_SELECT).single();
  if (error) return res.status(isNotFound(error) ? 404 : 500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

// ── Delete contractor trip ───────────────────────────────────────────────────
router.delete('/trips/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin.from('transport_contractor_trips').delete().eq('id', req.params.id), req);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════════
// Contractor Invoices (spec §21 "Invoice Verification")
// ════════════════════════════════════════════════════════════════════════════

const INVOICE_STATUSES = ['Submitted', 'Under Review', 'Verified', 'Disputed', 'Paid', 'Rejected'];
const INVOICE_SELECT = '*, transport_contractors(contractor_number, name, type, rate_structure, base_rate)';

// ── List invoices ────────────────────────────────────────────────────────────
router.get('/:propertyId/invoices', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = boundPropertyId(req, req.params.propertyId);
  if (!propertyId) return res.status(403).json({ error: 'No property access' });
  const { status } = req.query as { status?: string };

  let query = supabaseAdmin
    .from('transport_contractor_invoices')
    .select(INVOICE_SELECT)
    .eq('property_id', propertyId)
    .order('submitted_date', { ascending: false })
    .limit(500);
  if (status && INVOICE_STATUSES.includes(status)) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ invoices: data || [] });
});

// ── Submit an invoice ────────────────────────────────────────────────────────
router.post('/invoices', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { contractorId, periodStart, periodEnd, tripCount, amount, notes } = req.body || {};
  const propertyId = boundPropertyId(req, req.body?.propertyId);

  if (!propertyId || !contractorId) return res.status(400).json({ error: 'propertyId and contractorId are required' });

  // Compute expected amount from the contractor's rate card for verification.
  const { data: contractor } = await supabaseAdmin
    .from('transport_contractors')
    .select('rate_structure, base_rate')
    .eq('id', contractorId)
    .maybeSingle();
  const expected = contractor ? expectedInvoiceAmount(contractor, Number(tripCount) || 0) : null;
  const invoiceAmount = Number(amount) || 0;

  const invoiceNumber = `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

  const { data, error } = await supabaseAdmin.from('transport_contractor_invoices').insert({
    property_id: propertyId,
    invoice_number: invoiceNumber,
    contractor_id: contractorId,
    period_start: periodStart || null,
    period_end: periodEnd || null,
    trip_count: Number(tripCount) || 0,
    amount: invoiceAmount,
    expected_amount: expected,
    variance: expected != null ? Math.round((invoiceAmount - expected) * 100) / 100 : null,
    notes: notes || null,
  }).select(INVOICE_SELECT).single();
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'contractor_invoice.create', 'transport_contractor_invoice', data.id, { invoiceNumber, amount: invoiceAmount });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

// ── Update invoice (status transitions, notes) ───────────────────────────────
router.put('/invoices/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (b.status !== undefined && !INVOICE_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid status' });

  const patch: any = { updated_at: new Date().toISOString() };
  const map: Record<string, string> = {
    contractorId: 'contractor_id', periodStart: 'period_start', periodEnd: 'period_end',
    tripCount: 'trip_count', amount: 'amount', status: 'status', notes: 'notes',
  };
  for (const [key, col] of Object.entries(map)) {
    if (b[key] !== undefined) patch[col] = b[key];
  }
  if (b.status === 'Verified') {
    patch.verified_by = req.user?.name || req.user?.id || null;
    patch.verified_at = new Date().toISOString();
  }
  if (b.status === 'Paid') patch.paid_at = new Date().toISOString();

  const { data, error } = await scopeRowWrite(
    supabaseAdmin.from('transport_contractor_invoices').update(patch).eq('id', req.params.id), req
  ).select(INVOICE_SELECT).single();
  if (error) return res.status(isNotFound(error) ? 404 : 500).json({ error: error.message });
  auditTransport(req, 'contractor_invoice.update', 'transport_contractor_invoice', data.id, { status: data.status });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

// ── Delete invoice ───────────────────────────────────────────────────────────
router.delete('/invoices/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(
    supabaseAdmin.from('transport_contractor_invoices').delete().eq('id', req.params.id), req
  );
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'contractor_invoice.delete', 'transport_contractor_invoice', req.params.id);
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
