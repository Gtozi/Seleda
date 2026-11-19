/**
 * Billing & Charges API
 * ──────────────────────────────────────────────────────────────────────────
 * Trip billing charges posted to folios / corporate / internal accounts.
 * Mounted at /api/transport/billing.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';
import { auditTransport, boundPropertyId, isNotFound, scopeRowWrite } from '../services/transportScope';
import { postTransportChargeToFolio } from '../services/transportLifecycle';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'transport-billing:';
const BILLING_TYPES = ['Guest Folio', 'Corporate Account', 'Event Master Account', 'Internal Cost Center'];
const CHARGE_STATUSES = ['Pending', 'Posted', 'Failed', 'Refunded'];
const PAYMENT_METHODS = ['Room Charge', 'Credit Card', 'Cash', 'Corporate Credit', 'Internal Transfer'];

const SELECT = '*, transport_requests(request_number, guest_name, room, type)';

// ── List charges ─────────────────────────────────────────────────────────────
router.get('/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = boundPropertyId(req, req.params.propertyId);
  if (!propertyId) return res.status(403).json({ error: 'No property access' });
  const { status, billingType } = req.query as { status?: string; billingType?: string };

  const cacheKey = `${CACHE_PREFIX}${propertyId}:${status || 'all'}:${billingType || 'all'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  let query = supabaseAdmin
    .from('transport_billing_charges')
    .select(SELECT)
    .eq('property_id', propertyId)
    .order('charge_date', { ascending: false })
    .limit(500);
  if (status && CHARGE_STATUSES.includes(status)) query = query.eq('status', status);
  if (billingType && BILLING_TYPES.includes(billingType)) query = query.eq('billing_type', billingType);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const result = { charges: data || [] };
  cacheService.set(cacheKey, result, 60 * 1000);
  return res.json(result);
});

// ── Create charge ────────────────────────────────────────────────────────────
router.post('/', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { tripId, guestName, room, type, billingType, amount, status,
    chargeDate, paymentMethod, reference } = req.body || {};
  const propertyId = boundPropertyId(req, req.body?.propertyId);

  if (!propertyId || !billingType) return res.status(400).json({ error: 'propertyId and billingType are required' });
  if (!BILLING_TYPES.includes(billingType)) return res.status(400).json({ error: 'Invalid billing type' });
  if (status && !CHARGE_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  if (paymentMethod && !PAYMENT_METHODS.includes(paymentMethod)) return res.status(400).json({ error: 'Invalid payment method' });

  const chargeNumber = `BL-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

  const { data, error } = await supabaseAdmin.from('transport_billing_charges').insert({
    property_id: propertyId,
    charge_number: chargeNumber,
    trip_id: tripId || null,
    guest_name: guestName || null,
    room: room || null,
    type: type || null,
    billing_type: billingType,
    amount: Number(amount) || 0,
    status: 'Pending',
    charge_date: chargeDate || new Date().toISOString().slice(0, 10),
    payment_method: paymentMethod || null,
    reference: reference || null,
  }).select(SELECT).single();
  if (error) return res.status(500).json({ error: error.message });

  // Guest Folio charges post straight onto the guest's open folio.
  let result: any = data;
  if (data && billingType === 'Guest Folio' && (status === 'Posted' || !status || status === 'Pending')) {
    const lineId = await postTransportChargeToFolio({ ...data, charge_number: chargeNumber });
    const nextStatus = lineId ? 'Posted' : (status === 'Posted' ? 'Posted' : 'Pending');
    const patch: any = { status: nextStatus, updated_at: new Date().toISOString() };
    if (lineId) patch.reference = lineId;
    const { data: updated } = await supabaseAdmin
      .from('transport_billing_charges')
      .update(patch)
      .eq('id', data.id)
      .select(SELECT)
      .single();
    if (updated) result = updated;
  }

  auditTransport(req, 'charge.create', 'transport_billing_charge', result.id, { chargeNumber, billingType, amount: result.amount });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(result);
});

// ── Update charge ────────────────────────────────────────────────────────────
router.put('/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (b.billingType !== undefined && !BILLING_TYPES.includes(b.billingType)) return res.status(400).json({ error: 'Invalid billing type' });
  if (b.status !== undefined && !CHARGE_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid status' });
  if (b.paymentMethod !== undefined && !PAYMENT_METHODS.includes(b.paymentMethod)) return res.status(400).json({ error: 'Invalid payment method' });

  const patch: any = { updated_at: new Date().toISOString() };
  const map: Record<string, string> = {
    tripId: 'trip_id', guestName: 'guest_name', room: 'room', type: 'type',
    billingType: 'billing_type', amount: 'amount', status: 'status',
    chargeDate: 'charge_date', paymentMethod: 'payment_method', reference: 'reference',
  };
  for (const [key, col] of Object.entries(map)) {
    if (b[key] !== undefined) patch[col] = b[key];
  }
  if (b.tripId !== undefined) patch.trip_id = b.tripId || null;

  const { data, error } = await scopeRowWrite(
    supabaseAdmin.from('transport_billing_charges').update(patch).eq('id', req.params.id), req
  ).select(SELECT).single();
  if (error) return res.status(isNotFound(error) ? 404 : 500).json({ error: error.message });

  // Marking a Guest Folio charge Posted pushes it onto the guest's folio —
  // but only once (a UUID reference means a folio line was already posted).
  let result: any = data;
  const alreadyPostedToFolio = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data?.reference || '');
  if (data && data.billing_type === 'Guest Folio' && data.status === 'Posted' && patch.status === 'Posted' && !alreadyPostedToFolio) {
    const lineId = await postTransportChargeToFolio(data);
    if (lineId && !data.reference) {
      const { data: updated } = await supabaseAdmin
        .from('transport_billing_charges')
        .update({ reference: lineId, updated_at: new Date().toISOString() })
        .eq('id', data.id)
        .select(SELECT)
        .single();
      if (updated) result = updated;
    }
  }

  auditTransport(req, 'charge.update', 'transport_billing_charge', data.id, { status: data.status, amount: data.amount });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(result);
});

// ── Delete charge ────────────────────────────────────────────────────────────
router.delete('/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(
    supabaseAdmin.from('transport_billing_charges').delete().eq('id', req.params.id), req
  );
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'charge.delete', 'transport_billing_charge', req.params.id);
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
