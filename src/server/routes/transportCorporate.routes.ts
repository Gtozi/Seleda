/**
 * Transportation Corporate API
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed corporate contracts and contract-linked trips.
 * Mounted at /api/transport/corporate.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';
import { auditTransport, boundPropertyId, isNotFound, scopeRowWrite } from '../services/transportScope';
import { findBridgedRequest, runBridgedRequestSideEffects } from '../services/transportLifecycle';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'transport-corp:';
const CONTRACT_TYPES = ['Executive Transfer', 'Business Meetings', 'Airport Transfers'];
const CONTRACT_STATUSES = ['Active', 'Pending', 'Expired', 'Cancelled'];
const RATE_TYPES = ['Fixed Rate', 'Distance-Based', 'Time-Based', 'Package Rate'];
const BILLING_CYCLES = ['Monthly', 'Weekly', 'Per Trip'];
const TRIP_STATUSES = ['Requested', 'Confirmed', 'In Progress', 'Completed', 'Cancelled'];

const CONTRACT_SELECT = '*';
const TRIP_SELECT = '*, transport_corporate_contracts(contract_number, company), transport_drivers(id, employees(name, phone))';

// ── Aggregated snapshot for a property ───────────────────────────────────────
router.get('/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = boundPropertyId(req, req.params.propertyId);
  if (!propertyId) return res.status(403).json({ error: 'No property access' });

  const cacheKey = `${CACHE_PREFIX}${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const [contractRes, tripRes] = await Promise.all([
    supabaseAdmin
      .from('transport_corporate_contracts')
      .select(CONTRACT_SELECT)
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('transport_corporate_trips')
      .select(TRIP_SELECT)
      .eq('property_id', propertyId)
      .order('scheduled_time', { ascending: false })
      .limit(200),
  ]);

  if (contractRes.error) return res.status(500).json({ error: contractRes.error.message });
  if (tripRes.error) return res.status(500).json({ error: tripRes.error.message });

  const result = { contracts: contractRes.data || [], trips: tripRes.data || [] };
  cacheService.set(cacheKey, result, 60 * 1000);
  return res.json(result);
});

// ── Create contract ──────────────────────────────────────────────────────────
router.post('/contracts', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { company, contact, email, phone, type, status, startDate, endDate,
    monthlyVolume, rateType, standardRate, billingCycle, creditLimit, currentBalance } = req.body || {};
  const propertyId = boundPropertyId(req, req.body?.propertyId);
  if (!propertyId || !company || !contact || !type) {
    return res.status(400).json({ error: 'propertyId, company, contact and type are required' });
  }
  if (!CONTRACT_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid contract type' });
  if (status && !CONTRACT_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  if (rateType && !RATE_TYPES.includes(rateType)) return res.status(400).json({ error: 'Invalid rate type' });
  if (billingCycle && !BILLING_CYCLES.includes(billingCycle)) return res.status(400).json({ error: 'Invalid billing cycle' });

  const contractNumber = `CC-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

  const { data, error } = await supabaseAdmin.from('transport_corporate_contracts').insert({
    property_id: propertyId, contract_number: contractNumber, company, contact,
    email: email || null, phone: phone || null, type, status: status || 'Pending',
    start_date: startDate || null, end_date: endDate || null,
    monthly_volume: Number(monthlyVolume) || 0,
    rate_type: rateType || 'Fixed Rate', standard_rate: Number(standardRate) || 0,
    billing_cycle: billingCycle || 'Monthly',
    credit_limit: Number(creditLimit) || 0, current_balance: Number(currentBalance) || 0,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'contract.create', 'transport_corporate_contract', data.id, { company, contractNumber });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

// ── Update contract ──────────────────────────────────────────────────────────
router.put('/contracts/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (b.type !== undefined && !CONTRACT_TYPES.includes(b.type)) return res.status(400).json({ error: 'Invalid contract type' });
  if (b.status !== undefined && !CONTRACT_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid status' });
  if (b.rateType !== undefined && !RATE_TYPES.includes(b.rateType)) return res.status(400).json({ error: 'Invalid rate type' });
  if (b.billingCycle !== undefined && !BILLING_CYCLES.includes(b.billingCycle)) return res.status(400).json({ error: 'Invalid billing cycle' });

  const patch: any = { updated_at: new Date().toISOString() };
  const map: Record<string, string> = {
    company: 'company', contact: 'contact', email: 'email', phone: 'phone', type: 'type',
    status: 'status', startDate: 'start_date', endDate: 'end_date', monthlyVolume: 'monthly_volume',
    rateType: 'rate_type', standardRate: 'standard_rate', billingCycle: 'billing_cycle',
    creditLimit: 'credit_limit', currentBalance: 'current_balance',
  };
  for (const [key, col] of Object.entries(map)) {
    if (b[key] !== undefined) patch[col] = b[key];
  }

  const { data, error } = await scopeRowWrite(supabaseAdmin.from('transport_corporate_contracts').update(patch).eq('id', req.params.id), req).select().single();
  if (error) return res.status(isNotFound(error) ? 404 : 500).json({ error: error.message });
  auditTransport(req, 'contract.update', 'transport_corporate_contract', data.id, { status: data.status });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

// ── Delete contract ──────────────────────────────────────────────────────────
router.delete('/contracts/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin.from('transport_corporate_contracts').delete().eq('id', req.params.id), req);
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'contract.delete', 'transport_corporate_contract', req.params.id);
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Create corporate trip ────────────────────────────────────────────────────
router.post('/trips', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { contractId, company, guestName, type, pickup, destination,
    scheduledTime, assignedVehicle, driverId, passengerCount, status, amount, billedTo } = req.body || {};
  const propertyId = boundPropertyId(req, req.body?.propertyId);
  if (!propertyId || !guestName || !pickup || !destination || !scheduledTime) {
    return res.status(400).json({ error: 'propertyId, guestName, pickup, destination and scheduledTime are required' });
  }
  if (status && !TRIP_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const tripNumber = `CT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

  const { data, error } = await supabaseAdmin.from('transport_corporate_trips').insert({
    property_id: propertyId, trip_number: tripNumber, contract_id: contractId || null,
    company: company || null, guest_name: guestName, type: type || null,
    pickup, destination, scheduled_time: scheduledTime,
    assigned_vehicle: assignedVehicle || null, driver_id: driverId || null,
    passenger_count: Number(passengerCount) || 1, status: status || 'Confirmed',
    amount: amount !== undefined && amount !== null && amount !== '' ? Number(amount) : null,
    billed_to: billedTo || 'Corporate Account',
  }).select(TRIP_SELECT).single();
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'corporate_trip.create', 'transport_corporate_trip', data.id, { tripNumber, guestName });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

// ── Update corporate trip ────────────────────────────────────────────────────
router.put('/trips/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (b.status !== undefined && !TRIP_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid status' });

  const patch: any = { updated_at: new Date().toISOString() };
  const map: Record<string, string> = {
    contractId: 'contract_id', company: 'company', guestName: 'guest_name', type: 'type',
    pickup: 'pickup', destination: 'destination', scheduledTime: 'scheduled_time',
    assignedVehicle: 'assigned_vehicle', driverId: 'driver_id', passengerCount: 'passenger_count',
    status: 'status', amount: 'amount', billedTo: 'billed_to',
  };
  for (const [key, col] of Object.entries(map)) {
    if (b[key] !== undefined) patch[col] = b[key];
  }
  if (b.contractId !== undefined) patch.contract_id = b.contractId || null;
  if (b.driverId !== undefined) patch.driver_id = b.driverId || null;
  if (b.amount !== undefined) patch.amount = b.amount === null || b.amount === '' ? null : Number(b.amount);

  // Snapshot the bridged transport_requests row before the update so the
  // status transition is detectable after the trigger syncs it.
  const bridged = await findBridgedRequest(`ct:${req.params.id}`);

  const { data, error } = await scopeRowWrite(supabaseAdmin.from('transport_corporate_trips').update(patch).eq('id', req.params.id), req).select(TRIP_SELECT).single();
  if (error) return res.status(isNotFound(error) ? 404 : 500).json({ error: error.message });
  auditTransport(req, 'corporate_trip.update', 'transport_corporate_trip', data.id, { status: data.status });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  await runBridgedRequestSideEffects(bridged);
  return res.json(data);
});

// ── Delete corporate trip ────────────────────────────────────────────────────
router.delete('/trips/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin.from('transport_corporate_trips').delete().eq('id', req.params.id), req);
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'corporate_trip.delete', 'transport_corporate_trip', req.params.id);
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════════
// Corporate Invoices (spec §11 "Monthly Billing", §22 "Corporate Billing")
// Charges live in transport_billing_charges (billing_type='Corporate Account')
// with trip_id → the transport_requests row bridged from a corporate trip
// (source_ref='ct:<tripId>'). Invoice generation walks that chain.
// ════════════════════════════════════════════════════════════════════════════

const INVOICE_STATUSES = ['Draft', 'Issued', 'Paid', 'Overdue', 'Cancelled'];
const INVOICE_SELECT = '*, transport_corporate_contracts(contract_number, company)';

// ── List invoices ────────────────────────────────────────────────────────────
router.get('/:propertyId/invoices', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = boundPropertyId(req, req.params.propertyId);
  if (!propertyId) return res.status(403).json({ error: 'No property access' });
  const { status, contractId } = req.query as { status?: string; contractId?: string };

  let query = supabaseAdmin
    .from('transport_corporate_invoices')
    .select(INVOICE_SELECT)
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (status && INVOICE_STATUSES.includes(status)) query = query.eq('status', status);
  if (contractId) query = query.eq('contract_id', contractId);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ invoices: data || [] });
});

// ── Generate an invoice for a contract over a period ─────────────────────────
router.post('/contracts/:id/generate-invoice', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { periodStart, periodEnd, dueDate, notes } = req.body || {};
  if (!periodStart || !periodEnd) {
    return res.status(400).json({ error: 'periodStart and periodEnd are required (YYYY-MM-DD)' });
  }

  const { data: contract, error: cErr } = await scopeRowWrite(
    supabaseAdmin.from('transport_corporate_contracts').select('*').eq('id', req.params.id), req
  ).maybeSingle();
  if (cErr) return res.status(500).json({ error: cErr.message });
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  // 1. Corporate trips on this contract inside the period.
  const { data: trips, error: tErr } = await supabaseAdmin
    .from('transport_corporate_trips')
    .select('id')
    .eq('property_id', contract.property_id)
    .eq('contract_id', contract.id)
    .neq('status', 'Cancelled')
    .gte('scheduled_time', `${periodStart}T00:00:00`)
    .lt('scheduled_time', `${periodEnd}T23:59:59.999`);
  if (tErr) return res.status(500).json({ error: tErr.message });
  const tripIds = (trips || []).map((t: any) => t.id);
  if (!tripIds.length) {
    return res.status(400).json({ error: 'No billable trips for this contract in the period' });
  }

  // 2. Bridged transport_requests rows for those trips.
  const { data: bridged, error: bErr } = await supabaseAdmin
    .from('transport_requests')
    .select('id')
    .eq('property_id', contract.property_id)
    .in('source_ref', tripIds.map((id: string) => `ct:${id}`));
  if (bErr) return res.status(500).json({ error: bErr.message });
  const requestIds = (bridged || []).map((r: any) => r.id);

  // 3. Unbilled Corporate Account charges on those requests.
  let chargesQ = supabaseAdmin
    .from('transport_billing_charges')
    .select('id, amount, status')
    .eq('property_id', contract.property_id)
    .eq('billing_type', 'Corporate Account')
    .is('invoice_id', null)
    .neq('status', 'Refunded');
  chargesQ = requestIds.length
    ? chargesQ.in('trip_id', requestIds)
    // Fallback: charges keyed directly to the corporate trip id.
    : chargesQ.in('trip_id', tripIds);
  const { data: charges, error: chErr } = await chargesQ;
  if (chErr) return res.status(500).json({ error: chErr.message });
  if (!charges?.length) {
    return res.status(400).json({ error: 'No unbilled corporate charges in the period' });
  }

  const total = Math.round(charges.reduce((s: number, c: any) => s + Number(c.amount || 0), 0) * 100) / 100;
  const invoiceNumber = `CI-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

  const { data: invoice, error: iErr } = await supabaseAdmin.from('transport_corporate_invoices').insert({
    property_id: contract.property_id,
    invoice_number: invoiceNumber,
    contract_id: contract.id,
    company: contract.company,
    period_start: periodStart,
    period_end: periodEnd,
    charge_count: charges.length,
    total_amount: total,
    status: 'Issued',
    issued_at: new Date().toISOString(),
    due_date: dueDate || null,
    notes: notes || null,
  }).select(INVOICE_SELECT).single();
  if (iErr) return res.status(500).json({ error: iErr.message });

  // 4. Mark the charges billed and roll the contract balance forward.
  await supabaseAdmin
    .from('transport_billing_charges')
    .update({ invoice_id: invoice.id, status: 'Posted', updated_at: new Date().toISOString() })
    .in('id', charges.map((c: any) => c.id));
  await supabaseAdmin
    .from('transport_corporate_contracts')
    .update({ current_balance: Number(contract.current_balance || 0) + total, updated_at: new Date().toISOString() })
    .eq('id', contract.id);

  auditTransport(req, 'corporate_invoice.generate', 'transport_corporate_invoice', invoice.id, {
    invoiceNumber, contractId: contract.id, chargeCount: charges.length, total,
  });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  cacheService.invalidatePattern('^transport-billing\\:');
  return res.status(201).json(invoice);
});

// ── Update invoice status (Issue → Paid / Overdue / Cancelled) ───────────────
router.put('/invoices/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (b.status !== undefined && !INVOICE_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid status' });

  const { data: existing, error: loadErr } = await scopeRowWrite(
    supabaseAdmin.from('transport_corporate_invoices').select('*').eq('id', req.params.id), req
  ).maybeSingle();
  if (loadErr) return res.status(500).json({ error: loadErr.message });
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });

  const patch: any = { updated_at: new Date().toISOString() };
  if (b.status !== undefined) patch.status = b.status;
  if (b.dueDate !== undefined) patch.due_date = b.dueDate;
  if (b.notes !== undefined) patch.notes = b.notes;
  if (b.status === 'Issued' && !existing.issued_at) patch.issued_at = new Date().toISOString();
  if (b.status === 'Paid') patch.paid_at = new Date().toISOString();

  const { data, error } = await scopeRowWrite(
    supabaseAdmin.from('transport_corporate_invoices').update(patch).eq('id', req.params.id), req
  ).select(INVOICE_SELECT).single();
  if (error) return res.status(isNotFound(error) ? 404 : 500).json({ error: error.message });

  // Payment settles the contract balance.
  if (b.status === 'Paid' && existing.status !== 'Paid' && existing.contract_id) {
    const { data: contract } = await supabaseAdmin
      .from('transport_corporate_contracts')
      .select('current_balance')
      .eq('id', existing.contract_id)
      .maybeSingle();
    if (contract) {
      await supabaseAdmin
        .from('transport_corporate_contracts')
        .update({
          current_balance: Math.max(0, Number(contract.current_balance || 0) - Number(existing.total_amount || 0)),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.contract_id);
    }
  }

  auditTransport(req, 'corporate_invoice.update', 'transport_corporate_invoice', data.id, { status: data.status });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

export default router;
