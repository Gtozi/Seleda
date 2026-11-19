/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Revenue Management Portal — Pricing Recommendations endpoints.
 *
 * DB-integrated (Supabase-direct, service role) following the same pattern
 * as /api/hk-portal/*: reads/writes rms_pricing_recommendations directly,
 * no intermediate service layer required.
 *
 * Mounted at /api/rms-portal.
 */

import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { hasChannelCredentials, runChannelSync, testChannelConnection } from '../services/channelSync';
import { fetchCompetitorRates, isSimulatedCompetitor } from '../services/competitorRates';
import { buildRecommendationRows, competitorFeedSource, derivedRevenueKpis, meanForecastAccuracy, rateKpis, revenueGrowthPct } from '../services/rmsAnalytics';

const router = Router();

// Write access for all RMS modules — every mutating route below shares this
// list; the old per-section *_WRITE_ROLES constants were identical copies.
const RMS_WRITE_ROLES = ['revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'];

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

// Backward-compatible multi-property scoping: when a `propertyId` is supplied
// (query for GETs, body for writes), RMS routes constrain the operation to
// that property. If omitted, existing behavior is preserved so seed/demo data
// without a property_id still renders.
const propQuery = (req: any): string | undefined =>
  (req.query?.propertyId as string) || undefined;
const propBody = (req: any): string | undefined =>
  (req.body?.propertyId as string) || (req.body?.property_id as string) || undefined;
const withProp = (q: any, propertyId: string | null | undefined) =>
  propertyId ? q.eq('property_id', propertyId) : q;
// For registry tables whose seed rows are global defaults (property_id NULL),
// include both the caller's property rows and the global rows.
const withPropOrGlobal = (q: any, propertyId: string | null | undefined) =>
  propertyId ? q.or(`property_id.eq.${propertyId},property_id.is.null`) : q;

// ── Shared scoped-CRUD factories ──────────────────────────────────────────
// Collapses the repeated "filter allowed fields -> update/delete by id, scoped
// by property" boilerplate used by ~50 handlers below. `fields` is the body
// allowlist; `notFound` is the 404 message when the (property-scoped) row
// doesn't exist.
const pickUpdates = (body: any, fields: string[]): Record<string, any> => {
  const updates: Record<string, any> = {};
  for (const k of fields) if (body?.[k] !== undefined) updates[k] = body[k];
  return updates;
};

const updateScoped = (table: string, fields: string[], notFound = 'Record not found') =>
  async (req: any, res: any) => {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
    const propertyId = propBody(req);
    const updates = pickUpdates(req.body, fields);
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'no fields' });
    const q = supabaseAdmin.from(table).update(updates).eq('id', req.params.id);
    const { data, error } = await (propertyId ? q.eq('property_id', propertyId) : q).select().single();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: notFound });
    res.json({ success: true, data });
  };

const deleteScoped = (table: string) =>
  async (req: any, res: any) => {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
    const propertyId = propBody(req);
    const q = supabaseAdmin.from(table).delete().eq('id', req.params.id);
    const { error } = await (propertyId ? q.eq('property_id', propertyId) : q);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  };

// ── Tenant isolation ─────────────────────────────────────────────────────
// RMS queries run under the service role, which bypasses RLS, so tenant
// scoping must be enforced in this layer. Full-access roles may act across
// properties; every other authenticated user is pinned to their
// system_users.property_id — a mismatched propertyId is rejected, and an
// omitted one defaults to their own property so they never see another
// tenant's rows.
const CROSS_PROPERTY_ROLES = ['executive','general_manager','system_admin','admin','gm','owner','superuser'];
const enforcePropertyScope = (req: any, res: any, next: any) => {
  const user = req.user;
  if (!user || CROSS_PROPERTY_ROLES.includes(user.role) || !user.propertyId) return next();
  const requested = propQuery(req) || propBody(req);
  if (requested && requested !== user.propertyId) {
    return res.status(403).json({ error: 'Access denied for this property' });
  }
  if (!requested) {
    if (req.method === 'GET' || req.method === 'HEAD') {
      req.query.propertyId = user.propertyId;
    } else {
      req.body = { ...(req.body && typeof req.body === 'object' ? req.body : {}), propertyId: user.propertyId };
    }
  }
  next();
};

router.use(authenticate, enforcePropertyScope);

// ── GET /recommendations ─────────────────────────────────────────────────
// Optional query: ?status=pending|approved|rejected|applied
// Returns all recommendations, newest first.
router.get('/recommendations', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const propertyId = propQuery(req);
  let query = withProp(supabaseAdmin
    .from('rms_pricing_recommendations')
    .select('*')
    .order('created_at', { ascending: false }), propertyId);

  const status = req.query.status as string | undefined;
  if (status && ['pending', 'approved', 'rejected', 'applied'].includes(status)) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data: data || [] });
});

// ── POST /recommendations/:id/approve ───────────────────────────────────
// Write routes require a revenue/admin role — supabaseAdmin is a service
// role and bypasses RLS, so authorization must be enforced here via
// requireRole. (The rms:* permission codes are not seeded, so we use
// requireRole rather than requirePermission.)
router.post('/recommendations/:id/approve', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { id } = req.params;
  const userId = req.user?.id;
  const propertyId = propBody(req);
  const q = supabaseAdmin
    .from('rms_pricing_recommendations')
    .update({
      status: 'approved',
      applied_by: userId,
      applied_at: new Date().toISOString(),
    })
    .eq('id', id);
  const { data, error } = await (propertyId ? q.eq('property_id', propertyId) : q)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Recommendation not found' });
  res.json({ success: true, data });
});

// ── POST /recommendations/:id/reject ────────────────────────────────────
router.post('/recommendations/:id/reject', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { id } = req.params;
  const userId = req.user?.id;
  const propertyId = propBody(req);
  const q = supabaseAdmin
    .from('rms_pricing_recommendations')
    .update({
      status: 'rejected',
      applied_by: userId,
      applied_at: new Date().toISOString(),
    })
    .eq('id', id);
  const { data, error } = await (propertyId ? q.eq('property_id', propertyId) : q)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Recommendation not found' });
  res.json({ success: true, data });
});

// ── POST /recommendations/batch-approve ──────────────────────────────────
// Body: { ids: string[] }
router.post('/recommendations/batch-approve', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (ids.length === 0) return res.status(400).json({ error: 'ids required' });

  const userId = req.user?.id;
  const propertyId = propBody(req);
  const q = supabaseAdmin
    .from('rms_pricing_recommendations')
    .update({
      status: 'approved',
      applied_by: userId,
      applied_at: new Date().toISOString(),
    })
    .in('id', ids)
    .eq('status', 'pending');
  const { data, error } = await (propertyId ? q.eq('property_id', propertyId) : q).select('id');

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, updated: data?.length || 0 });
});

// ── POST /recommendations/batch-reject ───────────────────────────────────
// Body: { ids: string[] }
router.post('/recommendations/batch-reject', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (ids.length === 0) return res.status(400).json({ error: 'ids required' });

  const userId = req.user?.id;
  const propertyId = propBody(req);
  const q = supabaseAdmin
    .from('rms_pricing_recommendations')
    .update({
      status: 'rejected',
      applied_by: userId,
      applied_at: new Date().toISOString(),
    })
    .in('id', ids)
    .eq('status', 'pending');
  const { data, error } = await (propertyId ? q.eq('property_id', propertyId) : q).select('id');

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, updated: data?.length || 0 });
});

// ── POST /recommendations/:id/apply ─────────────────────────────────────
// Pushes the recommended rate to the authoritative selling rate
// (room_types.base_price — the base for getEffectiveNightlyRate used by
// public booking + front desk) AND the RMS rate-plan registry, then marks
// the recommendation as applied.
router.post('/recommendations/:id/apply', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { id } = req.params;
  const userId = req.user?.id;
  const propertyId = propBody(req);

  const recQ = supabaseAdmin.from('rms_pricing_recommendations').select('*').eq('id', id).eq('status', 'approved');
  const { data: rec, error: recErr } = await (propertyId ? recQ.eq('property_id', propertyId) : recQ).maybeSingle();
  if (recErr) return res.status(500).json({ error: recErr.message });
  if (!rec) return res.status(404).json({ error: 'Approved recommendation not found' });

  const targets: { ratePlan: boolean; roomType: boolean } = { ratePlan: false, roomType: false };

  // 1) Authoritative selling rate: room_types.base_price. The recommendation
  //    carries room_type_id (text id) and room_type (display name) — match by
  //    id first, then name as fallback, scoped to the rec's property.
  const recProp = propertyId || rec.property_id || undefined;
  let rtQ = supabaseAdmin.from('room_types').select('id');
  if (rec.room_type_id) rtQ = rtQ.eq('id', rec.room_type_id);
  else rtQ = rtQ.eq('name', rec.room_type);
  if (recProp) rtQ = rtQ.eq('property_id', recProp);
  let { data: roomType, error: rtErr } = await rtQ.maybeSingle();
  if (rtErr) return res.status(500).json({ error: rtErr.message });
  // Fallback: id stored but name matches a different row (renamed type).
  if (!roomType && rec.room_type_id && rec.room_type) {
    let nameQ = supabaseAdmin.from('room_types').select('id').eq('name', rec.room_type);
    if (recProp) nameQ = nameQ.eq('property_id', recProp);
    const { data: byName } = await nameQ.maybeSingle();
    roomType = byName || null;
  }
  if (roomType) {
    const { error: updErr } = await supabaseAdmin.from('room_types')
      .update({ base_price: rec.recommended_rate, updated_at: new Date().toISOString() })
      .eq('id', roomType.id);
    if (updErr) return res.status(500).json({ error: updErr.message });
    // Keep per-room rack rates in step — the canonical
    // get_effective_nightly_rate() falls back to rooms.rate.
    await supabaseAdmin.from('rooms')
      .update({ rate: rec.recommended_rate })
      .eq('room_type_id', roomType.id);
    // Date-scoped override for the recommendation's own date — an apply for
    // "tonight" must not silently rewrite the base rate for every future date.
    const overrideDate = rec.recommendation_date || new Date().toISOString().slice(0, 10);
    let ovQ = supabaseAdmin.from('rms_daily_rate_overrides').select('id')
      .eq('room_type_id', roomType.id).eq('rate_date', overrideDate);
    ovQ = recProp ? ovQ.eq('property_id', recProp) : ovQ.is('property_id', null);
    const { data: existingOverride } = await ovQ.maybeSingle();
    const overrideRow = {
      property_id: recProp || null,
      room_type_id: roomType.id,
      rate_date: overrideDate,
      rate: rec.recommended_rate,
      source: 'rms',
      recommendation_id: rec.id,
      created_by: userId || null,
      updated_at: new Date().toISOString(),
    };
    const { error: ovErr } = existingOverride
      ? await supabaseAdmin.from('rms_daily_rate_overrides').update(overrideRow).eq('id', existingOverride.id)
      : await supabaseAdmin.from('rms_daily_rate_overrides').insert(overrideRow);
    if (ovErr) return res.status(500).json({ error: ovErr.message });
    targets.roomType = true;
  }

  // 2) RMS rate-plan registry (drives RMS UI + channel rate pushes).
  const planQ = supabaseAdmin.from('rms_rate_plans').select('id')
    .or(`code.eq.${rec.room_type_id},name.eq.${rec.room_type}`);
  const { data: plan, error: planErr } = await (recProp ? planQ.eq('property_id', recProp) : planQ).maybeSingle();
  if (planErr) return res.status(500).json({ error: planErr.message });

  if (plan) {
    const { error: updErr } = await supabaseAdmin.from('rms_rate_plans')
      .update({ base_rate: rec.recommended_rate, updated_at: new Date().toISOString() })
      .eq('id', plan.id);
    if (updErr) return res.status(500).json({ error: updErr.message });
    targets.ratePlan = true;
  }

  const appliedQ = supabaseAdmin.from('rms_pricing_recommendations')
    .update({ status: 'applied', applied_by: userId, applied_at: new Date().toISOString() })
    .eq('id', id);
  const { data, error } = await (propertyId ? appliedQ.eq('property_id', propertyId) : appliedQ).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data, ratePlanUpdated: targets.ratePlan, sellingRateUpdated: targets.roomType });
});

// ── POST /recommendations/generate ──────────────────────────────────────
// Simulated AI generator: one recommendation per room type for today,
// using the current demand forecast and competitor average.
// If the caller sends roomType, it creates a single manual recommendation.
router.post('/recommendations/generate', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  const propertyId = propBody(req);
  const today = new Date().toISOString().slice(0, 10);

  if (b.roomType) {
    const { data, error } = await supabaseAdmin.from('rms_pricing_recommendations').insert({
      property_id: propertyId || null,
      room_type_id: b.roomTypeId || b.roomType,
      room_type: b.roomType,
      recommendation_date: b.date || today,
      current_rate: b.currentRate ?? 150,
      recommended_rate: b.recommendedRate ?? 160,
      confidence: b.confidence ?? 85,
      reason: b.reason || 'Manual recommendation',
      status: 'pending',
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, data });
    return;
  }

  const [typesRes, fcRes, compRes] = await Promise.all([
    withProp(supabaseAdmin.from('room_types').select('id, name, base_price').eq('is_active', true), propertyId),
    withProp(supabaseAdmin.from('rms_demand_forecasts').select('room_type, occupancy, demand, confidence').eq('forecast_date', today), propertyId),
    // Only real market pulls count toward competitor_avg — simulated/seed
    // rows are demo data and must not drive pricing recommendations.
    withProp(supabaseAdmin.from('rms_competitor_rates').select('room_type, rate').eq('rate_date', today).not('source', 'in', '("simulated","seed")'), propertyId),
  ]);
  if (typesRes.error) return res.status(500).json({ error: typesRes.error.message });
  if (fcRes.error) return res.status(500).json({ error: fcRes.error.message });
  if (compRes.error) return res.status(500).json({ error: compRes.error.message });

  const compByRoom: Record<string, number[]> = {};
  (compRes.data || []).forEach((r: any) => { (compByRoom[r.room_type] ||= []).push(Number(r.rate)); });

  const inserts = buildRecommendationRows(typesRes.data || [], fcRes.data || [], compByRoom, { today, propertyId });

  const { data, error } = await supabaseAdmin.from('rms_pricing_recommendations').insert(inserts).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, simulated: true, records: inserts.length, data });
});

// ============================================================================
// Competitor Management
// ============================================================================

// ── GET /competitors ─────────────────────────────────────────────────────
// Returns competitors with their room mappings and latest rates joined in.
router.get('/competitors', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propQuery(req);

  const { data: compData, error: compErr } = await withProp(
    supabaseAdmin.from('rms_competitors').select('*').order('name'),
    propertyId,
  );
  if (compErr) return res.status(500).json({ error: compErr.message });
  const compIds = new Set((compData || []).map((c: any) => c.id));

  const [mapRes, rateRes, anRes, alertRes] = await Promise.all([
    supabaseAdmin.from('rms_competitor_room_mappings').select('*').in('competitor_id', Array.from(compIds)),
    supabaseAdmin.from('rms_competitor_rates').select('*').order('rate_date', { ascending: false }).in('competitor_id', Array.from(compIds)),
    supabaseAdmin.from('rms_competitor_analysis').select('*').order('snapshot_date', { ascending: false }).in('competitor_id', Array.from(compIds)),
    supabaseAdmin.from('rms_parity_alerts').select('*').eq('resolved', false).order('created_at', { ascending: false }).in('competitor_id', Array.from(compIds)),
  ]);

  const mapsByComp: Record<string, any[]> = {};
  (mapRes.data || []).forEach((m: any) => {
    (mapsByComp[m.competitor_id] ||= []).push(m);
  });
  const ratesByComp: Record<string, any[]> = {};
  (rateRes.data || []).forEach((r: any) => {
    (ratesByComp[r.competitor_id] ||= []).push(r);
  });
  const analysisByComp: Record<string, any> = {};
  (anRes.data || []).forEach((a: any) => {
    if (!analysisByComp[a.competitor_id]) analysisByComp[a.competitor_id] = a;
  });

  const competitors = (compData || []).map((c: any) => ({
    ...c,
    roomMappings: mapsByComp[c.id] || [],
    rates: ratesByComp[c.id] || [],
    analysis: analysisByComp[c.id] || null,
  }));

  res.json({
    success: true,
    data: competitors,
    analysis: anRes.data || [],
    parityAlerts: alertRes.data || [],
  });
});

// ── POST /competitors ────────────────────────────────────────────────────
router.post('/competitors', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, star_rating, proximity, distance_km, contact_email, contact_phone, website, active, feed_config } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const { data, error } = await supabaseAdmin
    .from('rms_competitors')
    .insert({
      name, star_rating: star_rating || 4, proximity: proximity || 'nearby',
      distance_km: distance_km || 0, contact_email, contact_phone, website,
      active: active !== false,
      ...(feed_config && typeof feed_config === 'object' ? { feed_config } : {}),
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

// ── PUT /competitors/:id ─────────────────────────────────────────────────
router.put('/competitors/:id', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { id } = req.params;
  const { name, star_rating, proximity, distance_km, contact_email, contact_phone, website, active, feed_config } = req.body || {};
  const updates: Record<string, any> = {};
  if (name !== undefined) updates.name = name;
  if (star_rating !== undefined) updates.star_rating = star_rating;
  if (proximity !== undefined) updates.proximity = proximity;
  if (distance_km !== undefined) updates.distance_km = distance_km;
  if (contact_email !== undefined) updates.contact_email = contact_email;
  if (contact_phone !== undefined) updates.contact_phone = contact_phone;
  if (website !== undefined) updates.website = website;
  if (active !== undefined) updates.active = active;
  if (feed_config !== undefined) updates.feed_config = feed_config && typeof feed_config === 'object' ? feed_config : null;

  const { data, error } = await supabaseAdmin
    .from('rms_competitors').update(updates).eq('id', id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

// ── DELETE /competitors/:id ──────────────────────────────────────────────
router.delete('/competitors/:id', authenticate, requireRole(...RMS_WRITE_ROLES), deleteScoped('rms_competitors'));

// ── POST /competitors/:id/refresh ────────────────────────────────────────
// Pulls current rates through the competitor's configured feed
// (rms_competitors.feed_config). Demo competitors (feed_config.mode =
// 'simulated', or an explicit { simulate: true } body) write jittered rows
// marked source='simulated'. A competitor with no feed configured returns
// 400 — we do not fabricate rates silently.
router.post('/competitors/:id/refresh', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { id } = req.params;
  const propertyId = propBody(req);
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  const q = supabaseAdmin.from('rms_competitors').select('id, name, feed_config').eq('id', id);
  const { data: comp, error: compErr } = await (propertyId ? q.eq('property_id', propertyId) : q).maybeSingle();
  if (compErr) return res.status(500).json({ error: compErr.message });
  if (!comp) return res.status(404).json({ error: 'Competitor not found' });

  const failPull = async (message: string) => {
    await supabaseAdmin!.from('rms_competitors').update({ last_rate_error: now }).eq('id', id);
    return res.status(502).json({ success: false, error: message });
  };

  const hasFeed = !!comp.feed_config?.endpoint;
  const wantsSimulated = isSimulatedCompetitor(comp) || req.body?.simulate === true;

  if (hasFeed && !wantsSimulated) {
    try {
      const rates = await fetchCompetitorRates(comp);
      const inserts = rates.map(r => ({
        competitor_id: id,
        room_type: r.room_type,
        rate_date: r.rate_date,
        rate: r.rate,
        currency: r.currency,
        availability: r.availability,
        source: 'feed',
      }));
      const { error: insertErr } = await supabaseAdmin.from('rms_competitor_rates').insert(inserts);
      if (insertErr) return res.status(500).json({ error: insertErr.message });
      const { error: updErr } = await supabaseAdmin
        .from('rms_competitors')
        .update({ last_rate_update: now, last_rate_error: null })
        .eq('id', id);
      if (updErr) return res.status(500).json({ error: updErr.message });
      return res.json({ success: true, simulated: false, source: 'feed', records: inserts.length });
    } catch (e: any) {
      return failPull(e?.message || 'Rate feed pull failed');
    }
  }

  if (!wantsSimulated) {
    return res.status(400).json({
      success: false,
      error: 'No rate feed configured for this competitor — set feed_config.endpoint (or feed_config.mode = "simulated" for demo data)',
    });
  }

  // Explicit demo path — jittered snapshot, honestly labeled.
  const { data: mappings, error: mapErr } = await supabaseAdmin
    .from('rms_competitor_room_mappings')
    .select('our_room_type')
    .eq('competitor_id', id);
  if (mapErr) return res.status(500).json({ error: mapErr.message });

  const roomTypes = (mappings || []).map((m: any) => m.our_room_type).filter(Boolean);
  const latestByRoom: Record<string, number> = {};
  if (roomTypes.length) {
    const { data: latestRates, error: rateErr } = await supabaseAdmin
      .from('rms_competitor_rates')
      .select('room_type, rate')
      .eq('competitor_id', id)
      .in('room_type', roomTypes)
      .order('rate_date', { ascending: false });
    if (rateErr) return res.status(500).json({ error: rateErr.message });
    (latestRates || []).forEach((r: any) => { if (!(r.room_type in latestByRoom)) latestByRoom[r.room_type] = r.rate; });
  }

  const inserts = (mappings || []).map((m: any) => {
    const base = latestByRoom[m.our_room_type] || 150;
    const jitter = 0.95 + Math.random() * 0.1;
    return {
      competitor_id: id,
      room_type: m.our_room_type,
      rate_date: today,
      rate: Math.round(base * jitter * 100) / 100,
      currency: 'ETB',
      availability: true,
      source: 'simulated',
    };
  });

  if (inserts.length) {
    const { error: insertErr } = await supabaseAdmin.from('rms_competitor_rates').insert(inserts);
    if (insertErr) return res.status(500).json({ error: insertErr.message });
  }

  const { error: updErr } = await supabaseAdmin
    .from('rms_competitors')
    .update({ last_rate_update: now })
    .eq('id', id);
  if (updErr) return res.status(500).json({ error: updErr.message });

  res.json({ success: true, simulated: true, records: inserts.length });
});

// ============================================================================
// Demand Forecasts
// ============================================================================

// ── GET /forecasts ───────────────────────────────────────────────────────
// Returns daily demand forecasts, qualitative demand factors, and rolling
// forecast-accuracy snapshots. Optional `?days=N` limits the forecast
// window (default 30).
router.get('/forecasts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propQuery(req);

  const days = Math.min(Math.max(parseInt(String(req.query.days || '30'), 10) || 30, 1), 365);
  const roomType = req.query.roomType as string | undefined;

  const today = new Date();
  const startDate = today.toISOString().slice(0, 10);
  const endDate = new Date(today.getTime() + days * 86400000).toISOString().slice(0, 10);

  let fcQuery = withProp(supabaseAdmin
    .from('rms_demand_forecasts')
    .select('*')
    .gte('forecast_date', startDate)
    .lte('forecast_date', endDate)
    .order('forecast_date', { ascending: true })
    .limit(days), propertyId);

  if (roomType && roomType !== 'all') {
    fcQuery = fcQuery.eq('room_type', roomType);
  }

  const [fcRes, dfRes, faRes] = await Promise.all([
    fcQuery,
    withProp(supabaseAdmin.from('rms_demand_factors').select('*').order('created_at', { ascending: false }), propertyId),
    withProp(supabaseAdmin.from('rms_forecast_accuracy').select('*').order('snapshot_date', { ascending: false }).limit(3), propertyId),
  ]);

  if (fcRes.error) return res.status(500).json({ error: fcRes.error.message });

  res.json({
    success: true,
    data: fcRes.data || [],
    factors: dfRes.data || [],
    accuracy: faRes.data || [],
  });
});

// ============================================================================
// LOS (Length of Stay) Rules
// ============================================================================

// ── GET /los-rules ──────────────────────────────────────────────────────
// Returns LOS stay constraints and LOS-based pricing adjustments.
router.get('/los-rules', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propQuery(req);

  const [rulesRes, adjRes] = await Promise.all([
    withProp(supabaseAdmin.from('rms_los_rules').select('*').order('priority', { ascending: true }), propertyId),
    withProp(supabaseAdmin.from('rms_los_pricing_adjustments').select('*').order('los_nights', { ascending: true }), propertyId),
  ]);

  if (rulesRes.error) return res.status(500).json({ error: rulesRes.error.message });

  res.json({
    success: true,
    rules: rulesRes.data || [],
    adjustments: adjRes.data || [],
  });
});

// ── POST /los-rules ─────────────────────────────────────────────────────
router.post('/los-rules', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name required' });
  const propertyId = propBody(req);
  const { data, error } = await supabaseAdmin
    .from('rms_los_rules')
    .insert({
      property_id: propertyId || null,
      name: b.name,
      room_type: b.room_type || 'all',
      start_date: b.start_date || null,
      end_date: b.end_date || null,
      min_los: b.min_los ?? 1,
      max_los: b.max_los ?? null,
      cta_closed_days: b.cta_closed_days || null,
      ctd_closed_days: b.ctd_closed_days || null,
      priority: b.priority ?? 100,
      active: b.active !== false,
      notes: b.notes || null,
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

// ── PUT /los-rules/:id ──────────────────────────────────────────────────
router.put('/los-rules/:id', authenticate, requireRole(...RMS_WRITE_ROLES), updateScoped('rms_los_rules', ['name','room_type','start_date','end_date','min_los','max_los','cta_closed_days','ctd_closed_days','priority','active','notes'], 'LOS rule not found'));

// ── DELETE /los-rules/:id ───────────────────────────────────────────────
router.delete('/los-rules/:id', authenticate, requireRole(...RMS_WRITE_ROLES), deleteScoped('rms_los_rules'));

// ── POST /los-rules/adjustments ────────────────────────────────────────
router.post('/los-rules/adjustments', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name required' });
  const propertyId = propBody(req);
  const { data, error } = await supabaseAdmin
    .from('rms_los_pricing_adjustments')
    .insert({
      property_id: propertyId || null,
      name: b.name,
      room_type: b.room_type || 'all',
      los_nights: b.los_nights || 1,
      adjustment_type: b.adjustment_type || 'percentage',
      adjustment_value: b.adjustment_value ?? 0,
      start_date: b.start_date || null,
      end_date: b.end_date || null,
      active: b.active !== false,
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

// ── PUT /los-rules/adjustments/:id ─────────────────────────────────────
router.put('/los-rules/adjustments/:id', authenticate, requireRole(...RMS_WRITE_ROLES), updateScoped('rms_los_pricing_adjustments', ['name','room_type','los_nights','adjustment_type','adjustment_value','start_date','end_date','active'], 'Adjustment not found'));

// ── DELETE /los-rules/adjustments/:id ───────────────────────────────────
router.delete('/los-rules/adjustments/:id', authenticate, requireRole(...RMS_WRITE_ROLES), deleteScoped('rms_los_pricing_adjustments'));

// ============================================================================
// Corporate Rates
// ============================================================================

// ── GET /corporate-rates ─────────────────────────────────────────────────
// Returns corporate accounts with their negotiated rates joined in.
router.get('/corporate-rates', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propQuery(req);

  const [acctRes, rateRes] = await Promise.all([
    withProp(supabaseAdmin.from('rms_corporate_accounts').select('*').order('name'), propertyId),
    withProp(supabaseAdmin.from('rms_corporate_rates').select('*').order('room_type'), propertyId),
  ]);

  if (acctRes.error) return res.status(500).json({ error: acctRes.error.message });

  const ratesByAcct: Record<string, any[]> = {};
  (rateRes.data || []).forEach((r: any) => {
    (ratesByAcct[r.account_id] ||= []).push(r);
  });

  const accounts = (acctRes.data || []).map((a: any) => ({
    ...a,
    rates: ratesByAcct[a.id] || [],
  }));

  res.json({
    success: true,
    data: accounts,
    rates: rateRes.data || [],
  });
});

// ── POST /corporate-rates/accounts ──────────────────────────────────────
router.post('/corporate-rates/accounts', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name required' });
  const propertyId = propBody(req);
  const { data, error } = await supabaseAdmin
    .from('rms_corporate_accounts')
    .insert({
      property_id: propertyId || null,
      name: b.name,
      contact_name: b.contact_name || null,
      contact_email: b.contact_email || null,
      contact_phone: b.contact_phone || null,
      industry: b.industry || null,
      annual_volume: b.annual_volume || 0,
      status: b.status || 'active',
      notes: b.notes || null,
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

// ── PUT /corporate-rates/accounts/:id ───────────────────────────────────
router.put('/corporate-rates/accounts/:id', authenticate, requireRole(...RMS_WRITE_ROLES), updateScoped('rms_corporate_accounts', ['name','contact_name','contact_email','contact_phone','industry','annual_volume','status','notes'], 'Account not found'));

// ── DELETE /corporate-rates/accounts/:id ─────────────────────────────────
router.delete('/corporate-rates/accounts/:id', authenticate, requireRole(...RMS_WRITE_ROLES), deleteScoped('rms_corporate_accounts'));

// ── POST /corporate-rates ───────────────────────────────────────────────
router.post('/corporate-rates', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (!b.account_id || !b.room_type) return res.status(400).json({ error: 'account_id and room_type required' });
  const propertyId = propBody(req);
  const { data, error } = await supabaseAdmin
    .from('rms_corporate_rates')
    .insert({
      property_id: propertyId || null,
      account_id: b.account_id,
      room_type: b.room_type,
      rate_plan: b.rate_plan || 'Corporate',
      rate_type: b.rate_type || 'fixed',
      rate_value: b.rate_value ?? 0,
      currency: b.currency || 'ETB',
      meal_plan: b.meal_plan || 'RO',
      start_date: b.start_date || new Date().toISOString().slice(0, 10),
      end_date: b.end_date || null,
      status: b.status || 'active',
      notes: b.notes || null,
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

// ── PUT /corporate-rates/:id ────────────────────────────────────────────
router.put('/corporate-rates/:id', authenticate, requireRole(...RMS_WRITE_ROLES), updateScoped('rms_corporate_rates', ['account_id','room_type','rate_plan','rate_type','rate_value','currency','meal_plan','start_date','end_date','status','notes'], 'Rate not found'));

// ── DELETE /corporate-rates/:id ─────────────────────────────────────────
router.delete('/corporate-rates/:id', authenticate, requireRole(...RMS_WRITE_ROLES), deleteScoped('rms_corporate_rates'));

// ============================================================================
// Channel Manager
// ============================================================================

router.get('/channels', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propQuery(req);
  const channelsRes = await withProp(supabaseAdmin.from('channel_connections').select('id,channel_name,channel_code,channel_type,api_endpoint,api_version,sync_interval_minutes,last_sync_at,last_sync_status,last_sync_error,rate_parity_enabled,rate_parity_threshold,inventory_sync_enabled,booking_sync_enabled,active,test_mode,settings,webhook_url,credentials,created_at,updated_at,property_id').order('channel_name'), propertyId);
  if (channelsRes.error) return res.status(500).json({ error: channelsRes.error.message });
  const channels = channelsRes.data || [];
  const channelIds = channels.map((c: any) => c.id);
  const [mappingsRes, logsRes, roomTypesRes] = await Promise.all([
    channelIds.length ? supabaseAdmin.from('channel_room_mapping').select('*').in('channel_id', channelIds).order('mapped_at', { ascending: false }) : { data: [], error: null },
    channelIds.length ? supabaseAdmin.from('inventory_sync_log').select('id,channel_id,sync_type,sync_start,sync_end,records_processed,records_successful,records_failed,status,error_summary,trigger_type').in('channel_id', channelIds).order('sync_start', { ascending: false }).limit(50) : { data: [], error: null },
    supabaseAdmin.from('room_types').select('id,name').order('name'),
  ]);
  if (mappingsRes.error) return res.status(500).json({ error: mappingsRes.error.message });
  const mappings = mappingsRes.data || [];
  const channelsWithMappings = channels.map((channel: any) => {
    const { credentials, ...rest } = channel;
    return {
      ...rest,
      has_credentials: hasChannelCredentials(channel),
      room_mappings: mappings.filter((mapping: any) => mapping.channel_id === channel.id),
    };
  });
  res.json({ success: true, channels: channelsWithMappings, syncHistory: logsRes.data || [], roomTypes: roomTypesRes.data || [] });
});

router.post('/channels', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  const propertyId = propBody(req);
  if (!b.channel_name || !b.channel_code || !b.api_endpoint) return res.status(400).json({ error: 'channel_name, channel_code and api_endpoint required' });
  const credentials = (b.credentials && typeof b.credentials === 'object' && !Array.isArray(b.credentials))
    ? Object.fromEntries(Object.entries(b.credentials).filter(([, v]) => v !== undefined && v !== null && v !== '')) : {};
  const settings = (b.settings && typeof b.settings === 'object' && !Array.isArray(b.settings)) ? b.settings : {};
  const { data, error } = await supabaseAdmin.from('channel_connections').insert({
    property_id: propertyId || null,
    channel_name: b.channel_name, channel_code: String(b.channel_code).toUpperCase(), channel_type: b.channel_type || 'ota',
    api_endpoint: b.api_endpoint, api_version: b.api_version || null, credentials,
    webhook_url: b.webhook_url || null,
    sync_interval_minutes: b.sync_interval_minutes || 30, rate_parity_enabled: b.rate_parity_enabled !== false,
    rate_parity_threshold: b.rate_parity_threshold ?? 5, inventory_sync_enabled: b.inventory_sync_enabled !== false,
    booking_sync_enabled: b.booking_sync_enabled !== false, active: b.active !== false, test_mode: b.test_mode === true, settings,
  }).select('id,channel_name,channel_code,channel_type,api_endpoint,api_version,sync_interval_minutes,last_sync_at,last_sync_status,last_sync_error,rate_parity_enabled,rate_parity_threshold,inventory_sync_enabled,booking_sync_enabled,active,test_mode,created_at,updated_at,property_id').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

router.put('/channels/:id', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propBody(req);
  const allowed = ['channel_name','channel_code','channel_type','api_endpoint','api_version','sync_interval_minutes','rate_parity_enabled','rate_parity_threshold','inventory_sync_enabled','booking_sync_enabled','active','test_mode','webhook_url'];
  const updates = Object.fromEntries(allowed.filter(key => req.body?.[key] !== undefined).map(key => [key, req.body[key]]));
  if (updates.channel_code) updates.channel_code = String(updates.channel_code).toUpperCase();
  if (req.body?.settings && typeof req.body.settings === 'object' && !Array.isArray(req.body.settings)) {
    updates.settings = req.body.settings;
  }
  // Credential merge: only non-empty values are applied so a blank form field
  // does not wipe an existing secret. Credentials are never echoed back.
  if (req.body?.credentials && typeof req.body.credentials === 'object' && !Array.isArray(req.body.credentials)) {
    const incoming = Object.fromEntries(Object.entries(req.body.credentials).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    if (Object.keys(incoming).length) {
      let credQ = supabaseAdmin.from('channel_connections').select('credentials').eq('id', req.params.id);
      if (propertyId) credQ = credQ.eq('property_id', propertyId);
      const { data: existing } = await credQ.maybeSingle();
      if (!existing) return res.status(404).json({ error: 'Channel not found' });
      updates.credentials = { ...(existing.credentials || {}), ...incoming };
    }
  }
  const q = supabaseAdmin.from('channel_connections').update(updates).eq('id', req.params.id);
  const { data, error } = await (propertyId ? q.eq('property_id', propertyId) : q).select('id,channel_name,channel_code,channel_type,api_endpoint,api_version,sync_interval_minutes,last_sync_at,last_sync_status,last_sync_error,rate_parity_enabled,rate_parity_threshold,inventory_sync_enabled,booking_sync_enabled,active,test_mode,created_at,updated_at,property_id').single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Channel not found' });
  res.json({ success: true, data });
});

router.delete('/channels/:id', authenticate, requireRole(...RMS_WRITE_ROLES), deleteScoped('channel_connections'));

router.post('/channels/:id/sync', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  try {
    const result = await runChannelSync(req.params.id, { trigger: 'manual', propertyId: propBody(req) });
    res.status(result.status === 'failed' ? 502 : 200).json({
      success: result.status !== 'failed',
      simulated: result.simulated,
      status: result.status,
      records: result.processed,
      successful: result.successful,
      failed: result.failed,
      errors: result.errors,
      data: result.log,
    });
  } catch (e: any) {
    const status = e?.code === 'not_found' ? 404 : e?.code === 'inactive' ? 400 : 500;
    res.status(status).json({ error: e?.message || 'Channel sync failed' });
  }
});

// Test connectivity + credentials against the channel's real endpoint.
router.post('/channels/:id/test', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  try {
    const result = await testChannelConnection(req.params.id, propBody(req));
    res.json({ success: result.ok, error: result.error || null });
  } catch (e: any) {
    const status = e?.code === 'not_found' ? 404 : 500;
    res.status(status).json({ error: e?.message || 'Connection test failed' });
  }
});

router.post('/channels/:id/mappings', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  const propertyId = propBody(req);
  if (!b.our_room_type_id || !b.channel_room_code) return res.status(400).json({ error: 'our_room_type_id and channel_room_code required' });
  const cq = supabaseAdmin.from('channel_connections').select('id').eq('id', req.params.id);
  const { data: channel, error: fetchErr } = await (propertyId ? cq.eq('property_id', propertyId) : cq).maybeSingle();
  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  const { data, error } = await supabaseAdmin.from('channel_room_mapping').insert({
    channel_id: req.params.id, our_room_type_id: b.our_room_type_id, channel_room_code: b.channel_room_code,
    channel_room_name: b.channel_room_name || null, quality_score: b.quality_score ?? 1,
    rate_multiplier: b.rate_multiplier ?? 1, inventory_multiplier: b.inventory_multiplier ?? 1,
    active: b.active !== false, sync_enabled: b.sync_enabled !== false,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

router.put('/channels/:channelId/mappings/:id', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propBody(req);
  const allowed = ['our_room_type_id','channel_room_code','channel_room_name','quality_score','rate_multiplier','inventory_multiplier','active','sync_enabled'];
  const updates = Object.fromEntries(allowed.filter(key => req.body?.[key] !== undefined).map(key => [key, req.body[key]]));
  if (propertyId) {
    const cq = supabaseAdmin.from('channel_connections').select('id').eq('id', req.params.channelId).eq('property_id', propertyId).maybeSingle();
    const { data: channel, error: fetchErr } = await cq;
    if (fetchErr) return res.status(500).json({ error: fetchErr.message });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
  }
  const { data, error } = await supabaseAdmin.from('channel_room_mapping').update(updates).eq('id', req.params.id).eq('channel_id', req.params.channelId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

router.delete('/channels/:channelId/mappings/:id', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propBody(req);
  if (propertyId) {
    const cq = supabaseAdmin.from('channel_connections').select('id').eq('id', req.params.channelId).eq('property_id', propertyId).maybeSingle();
    const { data: channel, error: fetchErr } = await cq;
    if (fetchErr) return res.status(500).json({ error: fetchErr.message });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
  }
  const { error } = await supabaseAdmin.from('channel_room_mapping').delete().eq('id', req.params.id).eq('channel_id', req.params.channelId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ============================================================================
// Dynamic Pricing
// ============================================================================


// ── GET /dynamic-pricing ────────────────────────────────────────────────
router.get('/dynamic-pricing', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propQuery(req);
  const [strategiesRes, rulesRes, adjRes] = await Promise.all([
    withProp(supabaseAdmin.from('rms_dynamic_pricing_strategies').select('*').order('code'), propertyId),
    withProp(supabaseAdmin.from('rms_dynamic_pricing_rules').select('*').order('created_at', { ascending: false }), propertyId),
    withProp(supabaseAdmin.from('rms_dynamic_pricing_adjustments').select('*').order('created_at', { ascending: false }).limit(20), propertyId),
  ]);
  if (strategiesRes.error) return res.status(500).json({ error: strategiesRes.error.message });
  res.json({ success: true, strategies: strategiesRes.data || [], rules: rulesRes.data || [], adjustments: adjRes.data || [] });
});

// ── Strategies ─────────────────────────────────────────────────────────
router.post('/dynamic-pricing/strategies', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (!b.code || !b.name) return res.status(400).json({ error: 'code and name required' });
  const propertyId = propBody(req);
  const { data, error } = await supabaseAdmin.from('rms_dynamic_pricing_strategies').insert({
    property_id: propertyId || null,
    code: String(b.code).toLowerCase(), name: b.name, description: b.description || null,
    active: b.active !== false, auto_update: b.auto_update !== false,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

router.put('/dynamic-pricing/strategies/:id', authenticate, requireRole(...RMS_WRITE_ROLES), updateScoped('rms_dynamic_pricing_strategies', ['name','description','active','auto_update'], 'Strategy not found'));

// ── Rules ──────────────────────────────────────────────────────────────
router.post('/dynamic-pricing/rules', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (!b.room_type || !b.strategy_code) return res.status(400).json({ error: 'room_type and strategy_code required' });
  const propertyId = propBody(req);
  const { data, error } = await supabaseAdmin.from('rms_dynamic_pricing_rules').insert({
    property_id: propertyId || null,
    room_type: b.room_type, strategy_code: b.strategy_code, condition_type: b.condition_type || 'occupancy',
    threshold_value: b.threshold_value ?? null, threshold_label: b.threshold_label || null,
    adjustment: b.adjustment ?? 0, active: b.active !== false,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

router.put('/dynamic-pricing/rules/:id', authenticate, requireRole(...RMS_WRITE_ROLES), updateScoped('rms_dynamic_pricing_rules', ['room_type','strategy_code','condition_type','threshold_value','threshold_label','adjustment','active'], 'Rule not found'));

router.delete('/dynamic-pricing/rules/:id', authenticate, requireRole(...RMS_WRITE_ROLES), deleteScoped('rms_dynamic_pricing_rules'));

// ── Generate rates (simulated) ─────────────────────────────────────────
// Produces one adjustment per real rate plan, using the current demand forecast.
// Marked as simulated because no live pricing engine is connected.
router.post('/dynamic-pricing/generate', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propBody(req);
  const today = new Date().toISOString().slice(0, 10);

  const [plansRes, fcRes] = await Promise.all([
    withProp(supabaseAdmin.from('rms_rate_plans').select('name, base_rate'), propertyId),
    withProp(supabaseAdmin.from('rms_demand_forecasts').select('room_type, occupancy, demand, confidence').gte('forecast_date', today), propertyId),
  ]);
  if (plansRes.error) return res.status(500).json({ error: plansRes.error.message });
  if (fcRes.error) return res.status(500).json({ error: fcRes.error.message });

  const forecastByRoom: Record<string, any> = {};
  (fcRes.data || []).forEach((f: any) => { if (!(f.room_type in forecastByRoom)) forecastByRoom[f.room_type] = f; });

  const inserts = (plansRes.data || []).map((p: any) => {
    const base = Number(p.base_rate) || 0;
    const fc = forecastByRoom[p.name];
    let factor = 0;
    let reason = 'Simulated rate adjustment';
    if (fc) {
      if (fc.demand === 'high') { factor = 0.08; reason = `High demand forecast (occupancy ${fc.occupancy}%)`; }
      else if (fc.demand === 'low') { factor = -0.05; reason = `Low demand forecast (occupancy ${fc.occupancy}%)`; }
      else { factor = 0; reason = `Stable demand forecast (occupancy ${fc.occupancy}%)`; }
    }
    const newRate = Math.max(0, Math.round(base * (1 + factor) * 100) / 100);
    return {
      property_id: propertyId || null,
      room_type: p.name,
      old_rate: base,
      new_rate: newRate,
      reason,
    };
  });

  const { error } = await supabaseAdmin.from('rms_dynamic_pricing_adjustments').insert(inserts);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, simulated: true, records: inserts.length });
});

// ============================================================================
// Rate Management
// ============================================================================


// ── GET /rate-management ────────────────────────────────────────────────
router.get('/rate-management', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propQuery(req);
  const [plansRes, seasonalRes, weekendRes] = await Promise.all([
    withProp(supabaseAdmin.from('rms_rate_plans').select('*').order('name'), propertyId),
    withProp(supabaseAdmin.from('rms_seasonal_rates').select('*').order('start_date'), propertyId),
    withProp(supabaseAdmin.from('rms_weekend_rates').select('*').order('room_type'), propertyId),
  ]);
  if (plansRes.error) return res.status(500).json({ error: plansRes.error.message });
  res.json({ success: true, ratePlans: plansRes.data || [], seasonalRates: seasonalRes.data || [], weekendRates: weekendRes.data || [] });
});

// ── Rate Plans ─────────────────────────────────────────────────────────
router.post('/rate-management/plans', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (!b.name || !b.code) return res.status(400).json({ error: 'name and code required' });
  const propertyId = propBody(req);
  const { data, error } = await supabaseAdmin.from('rms_rate_plans').insert({
    property_id: propertyId || null,
    name: b.name, code: String(b.code).toUpperCase(), plan_type: b.plan_type || 'Standard',
    base_rate: b.base_rate ?? 0, currency: b.currency || 'USD', active: b.active !== false,
    description: b.description || null, features: b.features || [],
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

router.put('/rate-management/plans/:id', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propBody(req);
  const updates: Record<string, any> = {};
  ['name','code','plan_type','base_rate','currency','active','description','features'].forEach(k => { if (req.body?.[k] !== undefined) updates[k] = req.body[k]; });
  if (updates.code) updates.code = String(updates.code).toUpperCase();
  const q = supabaseAdmin.from('rms_rate_plans').update(updates).eq('id', req.params.id);
  const { data, error } = await (propertyId ? q.eq('property_id', propertyId) : q).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Rate plan not found' });
  res.json({ success: true, data });
});

router.delete('/rate-management/plans/:id', authenticate, requireRole(...RMS_WRITE_ROLES), deleteScoped('rms_rate_plans'));

// ── Seasonal Rates ─────────────────────────────────────────────────────
router.post('/rate-management/seasonal', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (!b.name || !b.start_date || !b.end_date) return res.status(400).json({ error: 'name, start_date, end_date required' });
  const propertyId = propBody(req);
  const { data, error } = await supabaseAdmin.from('rms_seasonal_rates').insert({
    property_id: propertyId || null,
    name: b.name, start_date: b.start_date, end_date: b.end_date, adjustment: b.adjustment ?? 0, active: b.active !== false,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

router.put('/rate-management/seasonal/:id', authenticate, requireRole(...RMS_WRITE_ROLES), updateScoped('rms_seasonal_rates', ['name','start_date','end_date','adjustment','active'], 'Seasonal rate not found'));

router.delete('/rate-management/seasonal/:id', authenticate, requireRole(...RMS_WRITE_ROLES), deleteScoped('rms_seasonal_rates'));

// ── Weekend Rates ──────────────────────────────────────────────────────
router.post('/rate-management/weekend', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (!b.room_type) return res.status(400).json({ error: 'room_type required' });
  const propertyId = propBody(req);
  const { data, error } = await supabaseAdmin.from('rms_weekend_rates').insert({
    property_id: propertyId || null,
    room_type: b.room_type, weekday_rate: b.weekday_rate ?? 0, weekend_rate: b.weekend_rate ?? 0, active: b.active !== false,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

router.put('/rate-management/weekend/:id', authenticate, requireRole(...RMS_WRITE_ROLES), updateScoped('rms_weekend_rates', ['room_type','weekday_rate','weekend_rate','active'], 'Weekend rate not found'));

router.delete('/rate-management/weekend/:id', authenticate, requireRole(...RMS_WRITE_ROLES), deleteScoped('rms_weekend_rates'));

// ============================================================================
// Inventory Controls
// ============================================================================


// ── GET /inventory-controls ────────────────────────────────────────────
router.get('/inventory-controls', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propQuery(req);
  const [roomsRes, limitsRes, allotRes, stopSellRes] = await Promise.all([
    withProp(supabaseAdmin.from('rms_inventory_room_types').select('*').order('name'), propertyId),
    withProp(supabaseAdmin.from('rms_inventory_sell_limits').select('*').order('created_at'), propertyId),
    withProp(supabaseAdmin.from('rms_inventory_allotments').select('*').order('expiry'), propertyId),
    withProp(supabaseAdmin.from('rms_inventory_stop_sell').select('*').order('start_date'), propertyId),
  ]);
  if (roomsRes.error) return res.status(500).json({ error: roomsRes.error.message });
  res.json({ success: true, roomTypes: roomsRes.data || [], sellLimits: limitsRes.data || [], allotments: allotRes.data || [], stopSellDates: stopSellRes.data || [] });
});

// ── Room types ─────────────────────────────────────────────────────────
router.put('/inventory-controls/rooms/:id', authenticate, requireRole(...RMS_WRITE_ROLES), updateScoped('rms_inventory_room_types', ['name','total_rooms','available','sold','stop_sell'], 'Room type not found'));

// ── Sell Limits ────────────────────────────────────────────────────────
router.post('/inventory-controls/sell-limits', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  const propertyId = propBody(req);
  const { data, error } = await supabaseAdmin.from('rms_inventory_sell_limits').insert({
    property_id: propertyId || null,
    room_type: b.room_type, channel: b.channel, limit_amount: b.limit_amount ?? 0, used: b.used ?? 0, active: b.active !== false,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

router.put('/inventory-controls/sell-limits/:id', authenticate, requireRole(...RMS_WRITE_ROLES), updateScoped('rms_inventory_sell_limits', ['room_type','channel','limit_amount','used','active'], 'Sell limit not found'));

router.delete('/inventory-controls/sell-limits/:id', authenticate, requireRole(...RMS_WRITE_ROLES), deleteScoped('rms_inventory_sell_limits'));

// ── Allotments ─────────────────────────────────────────────────────────
router.post('/inventory-controls/allotments', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  const propertyId = propBody(req);
  const { data, error } = await supabaseAdmin.from('rms_inventory_allotments').insert({
    property_id: propertyId || null,
    operator: b.operator, room_type: b.room_type, total: b.total ?? 0, released: b.released ?? 0,
    expiry: b.expiry, active: b.active !== false,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

router.put('/inventory-controls/allotments/:id', authenticate, requireRole(...RMS_WRITE_ROLES), updateScoped('rms_inventory_allotments', ['operator','room_type','total','released','expiry','active'], 'Allotment not found'));

router.delete('/inventory-controls/allotments/:id', authenticate, requireRole(...RMS_WRITE_ROLES), deleteScoped('rms_inventory_allotments'));

// ── Stop Sell ──────────────────────────────────────────────────────────
router.post('/inventory-controls/stop-sell', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  const propertyId = propBody(req);
  const { data, error } = await supabaseAdmin.from('rms_inventory_stop_sell').insert({
    property_id: propertyId || null,
    room_type: b.room_type, start_date: b.start_date, end_date: b.end_date, reason: b.reason || '', active: b.active !== false,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

router.put('/inventory-controls/stop-sell/:id', authenticate, requireRole(...RMS_WRITE_ROLES), updateScoped('rms_inventory_stop_sell', ['room_type','start_date','end_date','reason','active'], 'Stop-sell not found'));

router.delete('/inventory-controls/stop-sell/:id', authenticate, requireRole(...RMS_WRITE_ROLES), deleteScoped('rms_inventory_stop_sell'));

// ============================================================================
// Yield Management
// ============================================================================


// ── GET /yield-management ──────────────────────────────────────────────
router.get('/yield-management', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propQuery(req);
  const [optRes, metricsRes, oppRes, scenariosRes] = await Promise.all([
    withProp(supabaseAdmin.from('rms_yield_optimization_types').select('*').order('code'), propertyId),
    withProp(supabaseAdmin.from('rms_yield_metrics').select('*').order('display_order'), propertyId),
    withProp(supabaseAdmin.from('rms_yield_opportunities').select('*').order('potential_revenue', { ascending: false }), propertyId),
    withProp(supabaseAdmin.from('rms_yield_scenarios').select('*').order('name'), propertyId),
  ]);
  if (optRes.error) return res.status(500).json({ error: optRes.error.message });
  res.json({ success: true, optimizationTypes: optRes.data || [], yieldMetrics: metricsRes.data || [], opportunities: oppRes.data || [], scenarios: scenariosRes.data || [] });
});

// ── Opportunities ─────────────────────────────────────────────────────
router.put('/yield-management/opportunities/:id/apply', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propBody(req);
  const q = supabaseAdmin.from('rms_yield_opportunities').update({ applied: true }).eq('id', req.params.id);
  const { data, error } = await (propertyId ? q.eq('property_id', propertyId) : q).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Opportunity not found' });
  res.json({ success: true, data });
});

router.post('/yield-management/opportunities', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  const propertyId = propBody(req);
  const { data, error } = await supabaseAdmin.from('rms_yield_opportunities').insert({
    property_id: propertyId || null,
    opportunity_type: b.opportunity_type, room_type: b.room_type, suggestion: b.suggestion,
    potential_revenue: b.potential_revenue ?? 0, confidence: b.confidence ?? 0, applied: false,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

router.delete('/yield-management/opportunities/:id', authenticate, requireRole(...RMS_WRITE_ROLES), deleteScoped('rms_yield_opportunities'));

// ── Metrics ───────────────────────────────────────────────────────────
router.put('/yield-management/metrics/:id', authenticate, requireRole(...RMS_WRITE_ROLES), updateScoped('rms_yield_metrics', ['metric_name','current_value','target_value','trend','display_order'], 'Metric not found'));

// ── Scenarios ─────────────────────────────────────────────────────────
router.post('/yield-management/scenarios', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  const propertyId = propBody(req);
  const { data, error } = await supabaseAdmin.from('rms_yield_scenarios').insert({
    property_id: propertyId || null,
    name: b.name, occupancy: b.occupancy ?? 0, adr: b.adr ?? 0, revpar: b.revpar ?? 0, revenue: b.revenue ?? 0, active: b.active !== false,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

router.put('/yield-management/scenarios/:id', authenticate, requireRole(...RMS_WRITE_ROLES), updateScoped('rms_yield_scenarios', ['name','occupancy','adr','revpar','revenue','active'], 'Scenario not found'));

router.delete('/yield-management/scenarios/:id', authenticate, requireRole(...RMS_WRITE_ROLES), deleteScoped('rms_yield_scenarios'));

// ============================================================================
// Market Segmentation
// ============================================================================


// ── GET /market-segmentation ───────────────────────────────────────────
router.get('/market-segmentation', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propQuery(req);
  const { data, error } = await withProp(supabaseAdmin.from('rms_market_segments').select('*').order('revenue', { ascending: false }), propertyId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, segments: data || [] });
});

router.post('/market-segmentation', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  const propertyId = propBody(req);
  const { data, error } = await supabaseAdmin.from('rms_market_segments').insert({
    property_id: propertyId || null,
    code: b.code, name: b.name, icon_name: b.icon_name,
    revenue: b.revenue ?? 0, adr: b.adr ?? 0, revpar: b.revpar ?? 0,
    occupancy: b.occupancy ?? 0, profitability: b.profitability ?? 0,
    growth: b.growth ?? 0, color: b.color, active: b.active !== false,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

router.put('/market-segmentation/:id', authenticate, requireRole(...RMS_WRITE_ROLES), updateScoped('rms_market_segments', ['code','name','icon_name','revenue','adr','revpar','occupancy','profitability','growth','color','active'], 'Segment not found'));

router.delete('/market-segmentation/:id', authenticate, requireRole(...RMS_WRITE_ROLES), deleteScoped('rms_market_segments'));

// ============================================================================
// Channel Performance
// ============================================================================


// ── GET /channel-performance ───────────────────────────────────────────
router.get('/channel-performance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propQuery(req);
  const { data, error } = await withProp(supabaseAdmin.from('rms_channel_performance').select('*').order('net_revenue', { ascending: false }), propertyId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, channels: data || [] });
});

router.post('/channel-performance', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  const propertyId = propBody(req);
  const { data, error } = await supabaseAdmin.from('rms_channel_performance').insert({
    property_id: propertyId || null,
    code: b.code, name: b.name, icon_name: b.icon_name, revenue: b.revenue ?? 0, adr: b.adr ?? 0,
    conversion: b.conversion ?? 0, acquisition_cost: b.acquisition_cost ?? 0, cancellation_rate: b.cancellation_rate ?? 0,
    net_revenue: b.net_revenue ?? 0, bookings: b.bookings ?? 0, growth: b.growth ?? 0, active: b.active !== false,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

router.put('/channel-performance/:id', authenticate, requireRole(...RMS_WRITE_ROLES), updateScoped('rms_channel_performance', ['code','name','icon_name','revenue','adr','conversion','acquisition_cost','cancellation_rate','net_revenue','bookings','growth','active'], 'Channel not found'));

router.delete('/channel-performance/:id', authenticate, requireRole(...RMS_WRITE_ROLES), deleteScoped('rms_channel_performance'));

// ============================================================================
// Distribution Management
// ============================================================================


// ── GET /distribution-management ───────────────────────────────────────
router.get('/distribution-management', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propQuery(req);
  const [channelsRes, parityRes, rulesRes, syncRes] = await Promise.all([
    withProp(supabaseAdmin.from('rms_distribution_channels').select('*').order('name'), propertyId),
    withProp(supabaseAdmin.from('rms_rate_parity_issues').select('*').order('created_at', { ascending: false }), propertyId),
    withProp(supabaseAdmin.from('rms_distribution_rules').select('*').order('created_at'), propertyId),
    withProp(supabaseAdmin.from('rms_sync_schedule').select('*').order('sync_type'), propertyId),
  ]);
  if (channelsRes.error) return res.status(500).json({ error: channelsRes.error.message });
  res.json({ success: true, channels: channelsRes.data || [], parityIssues: parityRes.data || [], rules: rulesRes.data || [], syncSchedule: syncRes.data || [] });
});

// ── Channels ───────────────────────────────────────────────────────────
router.put('/distribution-management/channels/:id', authenticate, requireRole(...RMS_WRITE_ROLES), updateScoped('rms_distribution_channels', ['status','last_sync','availability_sync','rate_sync','booking_sync','parity_status','active'], 'Channel not found'));

// ── Parity issues ──────────────────────────────────────────────────────
router.delete('/distribution-management/parity/:id', authenticate, requireRole(...RMS_WRITE_ROLES), deleteScoped('rms_rate_parity_issues'));

// ── Rules ──────────────────────────────────────────────────────────────
router.post('/distribution-management/rules', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  const propertyId = propBody(req);
  const { data, error } = await supabaseAdmin.from('rms_distribution_rules').insert({
    property_id: propertyId || null,
    channel: b.channel, room_type: b.room_type, allocation: b.allocation ?? 0,
    restriction: b.restriction || 'None', active: b.active !== false,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

router.put('/distribution-management/rules/:id', authenticate, requireRole(...RMS_WRITE_ROLES), updateScoped('rms_distribution_rules', ['channel','room_type','allocation','restriction','active'], 'Rule not found'));

router.delete('/distribution-management/rules/:id', authenticate, requireRole(...RMS_WRITE_ROLES), deleteScoped('rms_distribution_rules'));

// ── Sync schedule ──────────────────────────────────────────────────────
router.put('/distribution-management/sync/:id', authenticate, requireRole(...RMS_WRITE_ROLES), updateScoped('rms_sync_schedule', ['sync_type','frequency','last_run','next_run','active'], 'Sync schedule not found'));

// ── Sync all ───────────────────────────────────────────────────────────
router.post('/distribution-management/sync-all', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propBody(req);
  const now = new Date().toISOString();
  // Simulated sync: stamp connected channels with a real timestamp and return count.
  const q = supabaseAdmin.from('rms_distribution_channels')
    .update({ last_sync: now, updated_at: now })
    .eq('status', 'connected')
    .select('id');
  const { data, error } = await (propertyId ? q.eq('property_id', propertyId) : q);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, simulated: true, records: data?.length || 0 });
});

// ============================================================================
// Group Evaluation
// ============================================================================


// ── GET /group-evaluation ──────────────────────────────────────────────
router.get('/group-evaluation', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propQuery(req);
  const today = new Date().toISOString().slice(0, 10);
  const [inquiriesRes, criteriaRes] = await Promise.all([
    withProp(supabaseAdmin.from('rms_group_inquiries').select('*').gte('check_in', today).order('check_in'), propertyId),
    withProp(supabaseAdmin.from('rms_evaluation_criteria').select('*').order('display_order'), propertyId),
  ]);
  if (inquiriesRes.error) return res.status(500).json({ error: inquiriesRes.error.message });
  res.json({ success: true, inquiries: inquiriesRes.data || [], criteria: criteriaRes.data || [] });
});

// ── Inquiries ──────────────────────────────────────────────────────────
router.post('/group-evaluation/inquiries', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  const propertyId = propBody(req);
  const { data, error } = await supabaseAdmin.from('rms_group_inquiries').insert({
    property_id: propertyId || null,
    name: b.name, company: b.company, contact: b.contact, status: b.status || 'pending',
    rooms: b.rooms ?? 0, nights: b.nights ?? 0, check_in: b.check_in, check_out: b.check_out,
    proposed_rate: b.proposed_rate ?? 0, projected_revenue: b.projected_revenue ?? 0,
    profitability: b.profitability ?? 0, space_utilization: b.space_utilization ?? 0,
    recommendation: b.recommendation || 'review', confidence: b.confidence ?? 0,
    priority: b.priority || 'medium',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

router.put('/group-evaluation/inquiries/:id/status', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status } = req.body || {};
  const propertyId = propBody(req);
  if (!['pending','approved','rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const q = supabaseAdmin.from('rms_group_inquiries').update({ status }).eq('id', req.params.id);
  const { data, error } = await (propertyId ? q.eq('property_id', propertyId) : q).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Inquiry not found' });
  res.json({ success: true, data });
});

router.delete('/group-evaluation/inquiries/:id', authenticate, requireRole(...RMS_WRITE_ROLES), deleteScoped('rms_group_inquiries'));

// ============================================================================
// Displacement Analysis
// ============================================================================


// ── GET /displacement-analysis ─────────────────────────────────────────
router.get('/displacement-analysis', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propQuery(req);
  const [scenariosRes, formulasRes] = await Promise.all([
    withProp(supabaseAdmin.from('rms_displacement_scenarios').select('*').order('created_at', { ascending: false }), propertyId),
    withProp(supabaseAdmin.from('rms_displacement_formula').select('*').order('display_order'), propertyId),
  ]);
  if (scenariosRes.error) return res.status(500).json({ error: scenariosRes.error.message });
  res.json({ success: true, scenarios: scenariosRes.data || [], formulas: formulasRes.data || [] });
});

// ── Scenarios ──────────────────────────────────────────────────────────
router.post('/displacement-analysis/scenarios', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  const propertyId = propBody(req);
  const { data, error } = await supabaseAdmin.from('rms_displacement_scenarios').insert({
    property_id: propertyId || null,
    name: b.name, dates: b.dates, rooms: b.rooms ?? 0, nights: b.nights ?? 0, status: b.status || 'pending',
    revenue_lost: b.revenue_lost ?? 0, revenue_gained: b.revenue_gained ?? 0, opportunity_cost: b.opportunity_cost ?? 0,
    ancillary_revenue: b.ancillary_revenue ?? 0, total_profitability: b.total_profitability ?? 0,
    recommendation: b.recommendation || 'review', confidence: b.confidence ?? 0, active: b.active !== false,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

router.put('/displacement-analysis/scenarios/:id', authenticate, requireRole(...RMS_WRITE_ROLES), updateScoped('rms_displacement_scenarios', ['name','dates','rooms','nights','status','revenue_lost','revenue_gained','opportunity_cost','ancillary_revenue','total_profitability','recommendation','confidence','active'], 'Scenario not found'));

router.delete('/displacement-analysis/scenarios/:id', authenticate, requireRole(...RMS_WRITE_ROLES), deleteScoped('rms_displacement_scenarios'));

// ============================================================================
// Overbooking Management
// ============================================================================


// ── GET /overbooking-management ─────────────────────────────────────────
router.get('/overbooking-management', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propQuery(req);
  const today = new Date().toISOString().slice(0, 10);
  const [limitsRes, washRes, trendsRes, noshowRes, walkRes, riskRes] = await Promise.all([
    withProp(supabaseAdmin.from('rms_overbooking_limits').select('*').order('room_type'), propertyId),
    withProp(supabaseAdmin.from('rms_wash_analysis').select('*').order('period'), propertyId),
    withProp(supabaseAdmin.from('rms_cancellation_trends').select('*').order('segment'), propertyId),
    withProp(supabaseAdmin.from('rms_noshow_predictions').select('*').gte('date', today).order('date'), propertyId),
    withProp(supabaseAdmin.from('rms_walk_partners').select('*').order('partner'), propertyId),
    withProp(supabaseAdmin.from('rms_risk_assessment').select('*').gte('date', today).order('date'), propertyId),
  ]);
  if (limitsRes.error) return res.status(500).json({ error: limitsRes.error.message });
  res.json({ success: true, overbookingLimits: limitsRes.data || [], washAnalysis: washRes.data || [], cancellationTrends: trendsRes.data || [], noshowPredictions: noshowRes.data || [], walkPartners: walkRes.data || [], riskAssessment: riskRes.data || [] });
});

// ── Limits ──────────────────────────────────────────────────────────────
router.put('/overbooking-management/limits/:id', authenticate, requireRole(...RMS_WRITE_ROLES), updateScoped('rms_overbooking_limits', ['overbook_limit','current_overbook','risk_level','active'], 'Limit not found'));

// ── Walk partners ───────────────────────────────────────────────────────
router.post('/overbooking-management/walk-partners', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  const propertyId = propBody(req);
  const { data, error } = await supabaseAdmin.from('rms_walk_partners').insert({
    property_id: propertyId || null,
    partner: b.partner, distance: b.distance, rate: b.rate, agreement: b.agreement || 'pending', active: b.active !== false,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

router.put('/overbooking-management/walk-partners/:id', authenticate, requireRole(...RMS_WRITE_ROLES), updateScoped('rms_walk_partners', ['partner','distance','rate','agreement','active'], 'Walk partner not found'));

router.delete('/overbooking-management/walk-partners/:id', authenticate, requireRole(...RMS_WRITE_ROLES), deleteScoped('rms_walk_partners'));

// ── Risk assessment ─────────────────────────────────────────────────────
router.post('/overbooking-management/risk-assessment', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  const propertyId = propBody(req);
  const { data, error } = await supabaseAdmin.from('rms_risk_assessment').insert({
    property_id: propertyId || null,
    date: b.date, room_type: b.room_type || 'All', overbook_count: b.overbook_count ?? 0,
    risk_level: b.risk_level || 'low', factors: b.factors || [], active: b.active !== false,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

// ============================================================================
// Restrictions Management
// ============================================================================


// ── GET /restrictions-management ────────────────────────────────────────
router.get('/restrictions-management', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propQuery(req);
  const [restrictionsRes, alertsRes] = await Promise.all([
    withProp(supabaseAdmin.from('rms_restrictions').select('*').order('restriction_type').order('room_type'), propertyId),
    withProp(supabaseAdmin.from('rms_restriction_alerts').select('*').order('created_at'), propertyId),
  ]);
  if (restrictionsRes.error) return res.status(500).json({ error: restrictionsRes.error.message });
  res.json({ success: true, restrictions: restrictionsRes.data || [], alerts: alertsRes.data || [] });
});

// ── Restrictions CRUD ───────────────────────────────────────────────────
router.post('/restrictions-management/restrictions', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  const propertyId = propBody(req);
  const { data, error } = await supabaseAdmin.from('rms_restrictions').insert({
    property_id: propertyId || null,
    restriction_type: b.restriction_type, room_type: b.room_type, dates: b.dates || 'All dates',
    min_nights: b.min_nights, max_nights: b.max_nights, reason: b.reason,
    min_rate: b.min_rate, max_rate: b.max_rate, min_advance: b.min_advance, max_advance: b.max_advance,
    active: b.active !== false,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

router.put('/restrictions-management/restrictions/:id', authenticate, requireRole(...RMS_WRITE_ROLES), updateScoped('rms_restrictions', ['restriction_type','room_type','dates','min_nights','max_nights','reason','min_rate','max_rate','min_advance','max_advance','active'], 'Restriction not found'));

router.delete('/restrictions-management/restrictions/:id', authenticate, requireRole(...RMS_WRITE_ROLES), deleteScoped('rms_restrictions'));

// ── Alerts ──────────────────────────────────────────────────────────────
router.post('/restrictions-management/alerts', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  const propertyId = propBody(req);
  const { data, error } = await supabaseAdmin.from('rms_restriction_alerts').insert({
    property_id: propertyId || null,
    alert_type: b.alert_type || 'info', message: b.message, date_range: b.date_range, active: b.active !== false,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

router.delete('/restrictions-management/alerts/:id', authenticate, requireRole(...RMS_WRITE_ROLES), deleteScoped('rms_restriction_alerts'));

// ============================================================================
// Package Pricing
// ============================================================================


router.get('/package-pricing', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propQuery(req);
  const { data, error } = await withProp(supabaseAdmin.from('rms_packages').select('*').order('package_type').order('name'), propertyId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, packages: data || [] });
});

router.post('/package-pricing', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  const propertyId = propBody(req);
  const { data, error } = await supabaseAdmin.from('rms_packages').insert({
    property_id: propertyId || null,
    name: b.name, package_type: b.package_type, room_type: b.room_type || 'All Room Types',
    base_rate: b.base_rate || 0, package_rate: b.package_rate || 0,
    includes: b.includes || [], validity: b.validity || 'All year', active: b.active !== false,
    bookings: b.bookings || 0, revenue: b.revenue || 0,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

router.put('/package-pricing/:id', authenticate, requireRole(...RMS_WRITE_ROLES), updateScoped('rms_packages', ['name','package_type','room_type','base_rate','package_rate','includes','validity','active','bookings','revenue'], 'Package not found'));

router.delete('/package-pricing/:id', authenticate, requireRole(...RMS_WRITE_ROLES), deleteScoped('rms_packages'));

// ============================================================================
// Promotions Analysis
// ============================================================================


router.get('/promotions-analysis', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propQuery(req);
  const [promosRes, couponsRes] = await Promise.all([
    withProp(supabaseAdmin.from('rms_promotions').select('*').order('status').order('name'), propertyId),
    withProp(supabaseAdmin.from('rms_coupon_performance').select('*').order('code'), propertyId),
  ]);
  if (promosRes.error) return res.status(500).json({ error: promosRes.error.message });
  res.json({ success: true, promotions: promosRes.data || [], coupons: couponsRes.data || [] });
});

router.post('/promotions-analysis', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  const propertyId = propBody(req);
  const { data, error } = await supabaseAdmin.from('rms_promotions').insert({
    property_id: propertyId || null,
    name: b.name, code: b.code, promo_type: b.promo_type || 'discount', discount: b.discount || 0,
    status: b.status || 'active', start_date: b.start_date || null, end_date: b.end_date || null,
    bookings: b.bookings || 0, revenue: b.revenue || 0, incremental_revenue: b.incremental_revenue || 0,
    roi: b.roi || 0, target_segment: b.target_segment || 'all',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

router.put('/promotions-analysis/:id', authenticate, requireRole(...RMS_WRITE_ROLES), updateScoped('rms_promotions', ['name','code','promo_type','discount','status','start_date','end_date','bookings','revenue','incremental_revenue','roi','target_segment'], 'Promotion not found'));

router.delete('/promotions-analysis/:id', authenticate, requireRole(...RMS_WRITE_ROLES), deleteScoped('rms_promotions'));

// ============================================================================
// Business Intelligence
// ============================================================================


router.get('/business-intelligence', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propQuery(req);
  const [periodsRes, yoyRes, trendsRes, accuracyRes, heatRes] = await Promise.all([
    withProp(supabaseAdmin.from('rms_bi_revenue_periods').select('*').order('display_order'), propertyId),
    withProp(supabaseAdmin.from('rms_bi_yoy_metrics').select('*').order('display_order'), propertyId),
    withProp(supabaseAdmin.from('rms_bi_market_trends').select('*').order('display_order'), propertyId),
    withProp(supabaseAdmin.from('rms_bi_forecast_accuracy').select('*').order('display_order'), propertyId),
    withProp(supabaseAdmin.from('rms_bi_heat_map').select('*').order('room_type').order('month'), propertyId),
  ]);
  if (periodsRes.error) return res.status(500).json({ error: periodsRes.error.message });
  res.json({ success: true, periods: periodsRes.data || [], yoy: yoyRes.data || [], trends: trendsRes.data || [], accuracy: accuracyRes.data || [], heatMap: heatRes.data || [] });
});

router.post('/business-intelligence/trends', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  const propertyId = propBody(req);
  const { data, error } = await supabaseAdmin.from('rms_bi_market_trends').insert({
    property_id: propertyId || null,
    trend: b.trend, impact: b.impact || 'positive', confidence: b.confidence || 0, display_order: b.display_order || 99,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

router.delete('/business-intelligence/trends/:id', authenticate, requireRole(...RMS_WRITE_ROLES), deleteScoped('rms_bi_market_trends'));

// ============================================================================
// AI Recommendations
// ============================================================================


router.get('/ai-recommendations', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propQuery(req);
  const [recsRes, insightsRes] = await Promise.all([
    withProp(supabaseAdmin.from('rms_ai_recommendations').select('*').order('created_at'), propertyId),
    withProp(supabaseAdmin.from('rms_ai_insights').select('*').order('display_order'), propertyId),
  ]);
  if (recsRes.error) return res.status(500).json({ error: recsRes.error.message });
  res.json({ success: true, recommendations: recsRes.data || [], insights: insightsRes.data || [] });
});

router.post('/ai-recommendations', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  const propertyId = propBody(req);
  const { data, error } = await supabaseAdmin.from('rms_ai_recommendations').insert({
    property_id: propertyId || null,
    rec_type: b.rec_type || 'pricing', priority: b.priority || 'medium', title: b.title,
    description: b.description, room_type: b.room_type, channel: b.channel, details: b.details || {},
    potential_revenue: b.potential_revenue || 0, confidence: b.confidence || 0,
    timeframe: b.timeframe, status: b.status || 'pending', reason: b.reason,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

router.put('/ai-recommendations/:id/status', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const status = req.body?.status;
  const propertyId = propBody(req);
  if (!['pending','applied','dismissed'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const q = supabaseAdmin.from('rms_ai_recommendations').update({ status }).eq('id', req.params.id);
  const { data, error } = await (propertyId ? q.eq('property_id', propertyId) : q).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Recommendation not found' });
  res.json({ success: true, data });
});

router.post('/ai-recommendations/apply-all', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propBody(req);
  let q = supabaseAdmin.from('rms_ai_recommendations').update({ status: 'applied' }).eq('status', 'pending');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

router.delete('/ai-recommendations/:id', authenticate, requireRole(...RMS_WRITE_ROLES), deleteScoped('rms_ai_recommendations'));

// ============================================================================
// Scenario Planning
// ============================================================================


router.get('/scenario-planning', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propQuery(req);
  const { data, error } = await withProp(supabaseAdmin.from('rms_scenarios').select('*').order('created_at'), propertyId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, scenarios: data || [] });
});

router.post('/scenario-planning', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  const propertyId = propBody(req);
  const { data, error } = await supabaseAdmin.from('rms_scenarios').insert({
    property_id: propertyId || null,
    name: b.name, scenario_type: b.scenario_type || 'pricing', description: b.description,
    parameters: b.parameters || {}, results: b.results || {}, status: b.status || 'draft',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

router.put('/scenario-planning/:id', authenticate, requireRole(...RMS_WRITE_ROLES), updateScoped('rms_scenarios', ['name','scenario_type','description','parameters','results','status'], 'Scenario not found'));

router.post('/scenario-planning/:id/duplicate', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propBody(req);
  const q = supabaseAdmin.from('rms_scenarios').select('*').eq('id', req.params.id);
  const { data: src, error: fetchErr } = await (propertyId ? q.eq('property_id', propertyId) : q).single();
  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!src) return res.status(404).json({ error: 'Scenario not found' });
  const { data, error } = await supabaseAdmin.from('rms_scenarios').insert({
    property_id: src.property_id,
    name: `${src.name} (Copy)`, scenario_type: src.scenario_type, description: src.description,
    parameters: src.parameters, results: src.results, status: 'draft',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

router.delete('/scenario-planning/:id', authenticate, requireRole(...RMS_WRITE_ROLES), deleteScoped('rms_scenarios'));

// ============================================================================
// Reports registry — mimics the HK reports pattern (HKReportsModule).
// Read/write over the `rms_reports` registry table (migration 561).
//   - GET  /reports           list reports (optional ?category=)
//   - GET  /reports/stats     aggregated KPI counts
//   - GET  /reports/:id       fetch a single report
//   - GET  /reports/:id/data  generate real report data (sections + summary)
//   - POST /reports/:id/run   re-run a single report
//   - POST /reports/run-all   queue all reports for refresh
//   - PATCH /reports/:id      update frequency / format / status
// ============================================================================

const RMS_REPORT_CATEGORIES = ['revenue','occupancy','adr','revpar','channel','segment','custom'] as const;
const RMS_REPORT_STATUSES = ['Ready','Scheduled','Generating','Failed'] as const;
const RMS_REPORT_FORMATS = ['PDF','Excel','CSV'] as const;
const RMS_REPORT_SELECT = 'id, category, name, description, last_run, status, format, frequency, generator_key, updated_at';

interface RmsReportSection { title: string; columns: string[]; rows: Record<string, any>[] }
interface RmsReportResult { sections: RmsReportSection[]; summary: Record<string, any> }
type RmsReportGenerator = (propertyId?: string | null) => Promise<RmsReportResult>;

const rmsCountRows = (counts: Record<string, number>, k: string, v: string) =>
  Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([key, val]) => ({ [k]: key, [v]: val }));

const genRmsDailyRevenue: RmsReportGenerator = async (propertyId) => {
  const { data } = await withProp(supabaseAdmin!.from('rms_bi_revenue_periods').select('*').order('display_order'), propertyId);
  const rows = data || [];
  return {
    sections: [
      { title: 'Revenue by Period', columns: ['Period','Revenue','Occupancy %','ADR','RevPAR'], rows: rows.map((r: any) => ({ Period: r.period, Revenue: r.revenue, 'Occupancy %': r.occupancy, ADR: r.adr, RevPAR: r.revpar })) },
      { title: 'Revenue by Segment', columns: ['Segment','Revenue','Occupancy %','ADR'], rows: (await withProp(supabaseAdmin!.from('rms_market_segments').select('name, revenue, occupancy, adr'), propertyId)).data?.map((s: any) => ({ Segment: s.name, Revenue: s.revenue, 'Occupancy %': s.occupancy, ADR: s.adr })) || [] },
    ],
    summary: { periods: rows.length, totalRevenue: rows.reduce((s: number, r: any) => s + (Number(r.revenue) || 0), 0) },
  };
};

const genRmsMonthlyRevenue: RmsReportGenerator = async (propertyId) => {
  const { data: periods } = await withProp(supabaseAdmin!.from('rms_bi_revenue_periods').select('*').order('display_order'), propertyId);
  const { data: yoy } = await withProp(supabaseAdmin!.from('rms_bi_yoy_metrics').select('*').order('display_order'), propertyId);
  return {
    sections: [
      { title: 'Monthly Revenue', columns: ['Period','Revenue','Occupancy %','ADR','RevPAR'], rows: (periods || []).map((r: any) => ({ Period: r.period, Revenue: r.revenue, 'Occupancy %': r.occupancy, ADR: r.adr, RevPAR: r.revpar })) },
      { title: 'Year-over-Year', columns: ['Metric','Current','Previous','Growth %'], rows: (yoy || []).map((r: any) => ({ Metric: r.metric, Current: r.current_value, Previous: r.previous_value, 'Growth %': r.growth })) },
    ],
    summary: { totalRevenue: (periods || []).reduce((s: number, r: any) => s + (Number(r.revenue) || 0), 0) },
  };
};

const genRmsOccupancy: RmsReportGenerator = async (propertyId) => {
  const { data: periods } = await withProp(supabaseAdmin!.from('rms_bi_revenue_periods').select('*').order('display_order'), propertyId);
  const { data: heat } = await withProp(supabaseAdmin!.from('rms_bi_heat_map').select('*').order('room_type').order('month'), propertyId);
  return {
    sections: [
      { title: 'Occupancy by Period', columns: ['Period','Occupancy %'], rows: (periods || []).map((r: any) => ({ Period: r.period, 'Occupancy %': r.occupancy })) },
      { title: 'Occupancy by Room Type / Month', columns: ['Room Type','Month','Intensity %'], rows: (heat || []).map((h: any) => ({ 'Room Type': h.room_type, Month: h.month, 'Intensity %': h.intensity })) },
    ],
    summary: { avgOccupancy: periods?.length ? Math.round(periods.reduce((s: number, r: any) => s + Number(r.occupancy || 0), 0) / periods.length) : 0 },
  };
};

const genRmsAdr: RmsReportGenerator = async (propertyId) => {
  const { data: segments } = await withProp(supabaseAdmin!.from('rms_market_segments').select('name, adr'), propertyId);
  const { data: channels } = await withProp(supabaseAdmin!.from('rms_channel_performance').select('name, adr'), propertyId);
  const { data: periods } = await withProp(supabaseAdmin!.from('rms_bi_revenue_periods').select('period, adr').order('display_order'), propertyId);
  return {
    sections: [
      { title: 'ADR by Segment', columns: ['Segment','ADR'], rows: (segments || []).map((s: any) => ({ Segment: s.name, ADR: s.adr })) },
      { title: 'ADR by Channel', columns: ['Channel','ADR'], rows: (channels || []).map((c: any) => ({ Channel: c.name, ADR: c.adr })) },
      { title: 'ADR by Period', columns: ['Period','ADR'], rows: (periods || []).map((p: any) => ({ Period: p.period, ADR: p.adr })) },
    ],
    summary: { avgAdr: periods?.length ? Math.round(periods.reduce((s: number, r: any) => s + Number(r.adr || 0), 0) / periods.length) : 0 },
  };
};

const genRmsRevpar: RmsReportGenerator = async (propertyId) => {
  const { data: periods } = await withProp(supabaseAdmin!.from('rms_bi_revenue_periods').select('*').order('display_order'), propertyId);
  const { data: segments } = await withProp(supabaseAdmin!.from('rms_market_segments').select('name, revpar'), propertyId);
  return {
    sections: [
      { title: 'RevPAR by Period', columns: ['Period','RevPAR','Occupancy %','ADR'], rows: (periods || []).map((r: any) => ({ Period: r.period, RevPAR: r.revpar, 'Occupancy %': r.occupancy, ADR: r.adr })) },
      { title: 'RevPAR by Segment', columns: ['Segment','RevPAR'], rows: (segments || []).map((s: any) => ({ Segment: s.name, RevPAR: s.revpar })) },
    ],
    summary: { avgRevpar: periods?.length ? Math.round(periods.reduce((s: number, r: any) => s + Number(r.revpar || 0), 0) / periods.length) : 0 },
  };
};

const genRmsChannelPerf: RmsReportGenerator = async (propertyId) => {
  const { data } = await withProp(supabaseAdmin!.from('rms_channel_performance').select('*').order('revenue', { ascending: false }), propertyId);
  const rows = data || [];
  return {
    sections: [
      { title: 'Channel Performance', columns: ['Channel','Bookings','Revenue','Net Revenue','ADR','Conversion %','Cancellation %'], rows: rows.map((r: any) => ({ Channel: r.name, Bookings: r.bookings, Revenue: r.revenue, 'Net Revenue': r.net_revenue, ADR: r.adr, 'Conversion %': r.conversion, 'Cancellation %': r.cancellation_rate })) },
      { title: 'Bookings by Channel', columns: ['Channel','Bookings'], rows: rmsCountRows(Object.fromEntries(rows.map((r: any) => [r.name, Number(r.bookings) || 0])), 'Channel', 'Bookings') },
    ],
    summary: { channels: rows.length, totalRevenue: rows.reduce((s: number, r: any) => s + (Number(r.revenue) || 0), 0) },
  };
};

const genRmsSegment: RmsReportGenerator = async (propertyId) => {
  const { data } = await withProp(supabaseAdmin!.from('rms_market_segments').select('*').order('revenue', { ascending: false }), propertyId);
  const rows = data || [];
  return {
    sections: [
      { title: 'Market Segments', columns: ['Segment','Revenue','Occupancy %','ADR','RevPAR','Profitability %','Growth %'], rows: rows.map((r: any) => ({ Segment: r.name, Revenue: r.revenue, 'Occupancy %': r.occupancy, ADR: r.adr, RevPAR: r.revpar, 'Profitability %': r.profitability, 'Growth %': r.growth })) },
    ],
    summary: { segments: rows.length, totalRevenue: rows.reduce((s: number, r: any) => s + (Number(r.revenue) || 0), 0) },
  };
};

const genRmsCustomPricing: RmsReportGenerator = async (propertyId) => {
  const { data: packages } = await withProp(supabaseAdmin!.from('rms_packages').select('*'), propertyId);
  const { data: recs } = await withProp(supabaseAdmin!.from('rms_ai_recommendations').select('*').eq('rec_type', 'pricing'), propertyId);
  return {
    sections: [
      { title: 'Package Pricing', columns: ['Package','Type','Room Type','Base Rate','Package Rate','Bookings','Revenue'], rows: (packages || []).map((p: any) => ({ Package: p.name, Type: p.package_type, 'Room Type': p.room_type, 'Base Rate': p.base_rate, 'Package Rate': p.package_rate, Bookings: p.bookings, Revenue: p.revenue })) },
      { title: 'Pricing Recommendations', columns: ['Title','Priority','Potential Revenue','Confidence %','Status'], rows: (recs || []).map((r: any) => ({ Title: r.title, Priority: r.priority, 'Potential Revenue': r.potential_revenue, 'Confidence %': r.confidence, Status: r.status })) },
    ],
    summary: { packages: (packages || []).length, pricingRecs: (recs || []).length },
  };
};

const RMS_REPORT_GENERATORS: Record<string, RmsReportGenerator> = {
  'rms-daily-revenue': genRmsDailyRevenue,
  'rms-monthly-revenue': genRmsMonthlyRevenue,
  'rms-occupancy-analysis': genRmsOccupancy,
  'rms-adr-performance': genRmsAdr,
  'rms-revpar-dashboard': genRmsRevpar,
  'rms-channel-performance': genRmsChannelPerf,
  'rms-market-segment': genRmsSegment,
  'rms-custom-pricing': genRmsCustomPricing,
};

// Resolves the generator for a report row. Reports are looked up by id within
// the caller's property scope (withPropOrGlobal), and the generator is chosen
// by the row's generator_key — falling back to the row id for legacy rows.
// This decouples generation from the global seed ids, so per-property or
// custom reports can reuse a generator via generator_key.
const resolveReportGenerator = async (id: string, propertyId?: string) => {
  const q = supabaseAdmin!.from('rms_reports').select('id, generator_key').eq('id', id);
  const { data: report, error } = await withPropOrGlobal(q, propertyId).maybeSingle();
  if (error) return { error };
  if (!report) return { reportMissing: true as const };
  const key = (report as any).generator_key || (report as any).id;
  return { generator: RMS_REPORT_GENERATORS[key], key };
};

router.get('/reports', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propQuery(req);
  const category = req.query.category as string;
  let q = supabaseAdmin.from('rms_reports').select(RMS_REPORT_SELECT).order('id', { ascending: true });
  if (category && (RMS_REPORT_CATEGORIES as readonly string[]).includes(category)) q = q.eq('category', category);
  q = withPropOrGlobal(q, propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.get('/reports/stats', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propQuery(req);
  let q = supabaseAdmin.from('rms_reports').select('category, status');
  q = withPropOrGlobal(q, propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const rows = data || [];
  const byCategory: Record<string, number> = {};
  for (const r of rows) byCategory[r.category] = (byCategory[r.category] || 0) + 1;
  res.json({ total: rows.length, ready: rows.filter(r => r.status === 'Ready').length, scheduled: rows.filter(r => r.status === 'Scheduled').length, failed: rows.filter(r => r.status === 'Failed').length, byCategory });
});

router.post('/reports/run-all', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propBody(req);
  let q = supabaseAdmin.from('rms_reports').update({ status: 'Ready', last_run: new Date().toISOString() }).neq('status', 'Ready');
  q = withPropOrGlobal(q, propertyId);
  const { data, error } = await q.select(RMS_REPORT_SELECT);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ refreshed: data?.length || 0, reports: data || [] });
});

router.get('/reports/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propQuery(req);
  const q = supabaseAdmin.from('rms_reports').select(RMS_REPORT_SELECT).eq('id', req.params.id);
  const { data, error } = await withPropOrGlobal(q, propertyId).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Report not found' });
  res.json(data);
});

router.get('/reports/:id/data', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propQuery(req);
  const resolved = await resolveReportGenerator(req.params.id, propertyId);
  if (resolved.error) return res.status(500).json({ error: resolved.error.message });
  if (resolved.reportMissing) return res.status(404).json({ error: 'Report not found' });
  if (!resolved.generator) return res.status(404).json({ error: `No data generator for report: ${req.params.id}` });
  try { res.json(await resolved.generator(propertyId)); } catch (err: any) { res.status(500).json({ error: err.message || 'Failed to generate report data' }); }
});

router.post('/reports/:id/run', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propBody(req);
  const resolved = await resolveReportGenerator(req.params.id, propertyId);
  if (resolved.error) return res.status(500).json({ error: resolved.error.message });
  if (resolved.reportMissing) return res.status(404).json({ error: 'Report not found' });
  // No generator bound — mark the run as Failed rather than pretending it
  // produced data (the old code silently stamped 'Ready').
  if (!resolved.generator) {
    await supabaseAdmin.from('rms_reports').update({ status: 'Failed' }).eq('id', req.params.id);
    return res.status(404).json({ error: `No data generator for report: ${req.params.id}` });
  }
  let rowCount: number | undefined;
  try { const result = await resolved.generator(propertyId); rowCount = result.sections.reduce((s, sec) => s + sec.rows.length, 0); } catch { /* non-fatal */ }
  const q = supabaseAdmin.from('rms_reports').update({ status: 'Ready', last_run: new Date().toISOString() }).eq('id', req.params.id);
  const { data, error } = await withPropOrGlobal(q, propertyId).select(RMS_REPORT_SELECT).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Report not found' });
  res.json({ ...data, rowCount });
});

router.patch('/reports/:id', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const body = req.body || {};
  const propertyId = propBody(req);
  const updates: Record<string, any> = {};
  if (typeof body.frequency === 'string' && body.frequency.trim()) updates.frequency = body.frequency.trim();
  if (typeof body.format === 'string' && (RMS_REPORT_FORMATS as readonly string[]).includes(body.format)) updates.format = body.format;
  if (typeof body.status === 'string' && (RMS_REPORT_STATUSES as readonly string[]).includes(body.status)) updates.status = body.status;
  if (typeof body.generator_key === 'string' && body.generator_key in RMS_REPORT_GENERATORS) updates.generator_key = body.generator_key;
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'No valid fields to update (frequency, format, status, generator_key)' });
  const q = supabaseAdmin.from('rms_reports').update(updates).eq('id', req.params.id);
  const { data, error } = await withPropOrGlobal(q, propertyId).select(RMS_REPORT_SELECT).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Report not found' });
  res.json(data);
});

// ============================================================================
// Configuration
// ============================================================================


router.get('/configuration', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = propQuery(req);
  const [settingsRes, statusRes] = await Promise.all([
    withPropOrGlobal(supabaseAdmin.from('rms_config_settings').select('*'), propertyId),
    withPropOrGlobal(supabaseAdmin.from('rms_system_status').select('*'), propertyId),
  ]);
  if (settingsRes.error) return res.status(500).json({ error: settingsRes.error.message });
  if (statusRes.error) return res.status(500).json({ error: statusRes.error.message });
  // Global rows (property_id NULL) are defaults; a property-scoped row with
  // the same key is an override and wins.
  const mergeScoped = (rows: any[] | null, keyField: string) => {
    const byKey = new Map<string, any>();
    for (const r of rows || []) {
      if (!byKey.has(r[keyField]) || (propertyId ? r.property_id === propertyId : r.property_id === null)) byKey.set(r[keyField], r);
    }
    return Array.from(byKey.values());
  };
  res.json({
    success: true,
    settings: mergeScoped(settingsRes.data, 'setting_key')
      .sort((a, b) => String(a.section).localeCompare(String(b.section)) || (a.display_order ?? 0) - (b.display_order ?? 0)),
    systemStatus: mergeScoped(statusRes.data, 'component')
      .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0)),
  });
});

// Batch update: { settings: { key: value, ... } }
// Property-scoped callers get per-property override rows; the global default
// row (property_id NULL) is untouched so other properties keep their config.
router.put('/configuration', authenticate, requireRole(...RMS_WRITE_ROLES), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const updates = req.body?.settings;
  const propertyId = propBody(req);
  if (!updates || typeof updates !== 'object') return res.status(400).json({ error: 'settings object required' });
  const errors: string[] = [];
  for (const [key, value] of Object.entries(updates)) {
    const { data: rows, error: selErr } = await withPropOrGlobal(
      supabaseAdmin.from('rms_config_settings').select('*').eq('setting_key', key),
      propertyId,
    );
    if (selErr) { errors.push(`${key}: ${selErr.message}`); continue; }
    const globalRow = (rows || []).find((r: any) => r.property_id === null);
    const ownRow = propertyId ? (rows || []).find((r: any) => r.property_id === propertyId) : undefined;
    let writeErr: { message: string } | null = null;
    if (propertyId) {
      if (ownRow) {
        writeErr = (await supabaseAdmin.from('rms_config_settings').update({ value }).eq('id', ownRow.id)).error;
      } else if (globalRow) {
        const { id: _id, created_at: _ca, updated_at: _ua, ...meta } = globalRow;
        writeErr = (await supabaseAdmin.from('rms_config_settings').insert({ ...meta, property_id: propertyId, value })).error;
      } else {
        errors.push(`${key}: setting not found`);
        continue;
      }
    } else if (globalRow) {
      writeErr = (await supabaseAdmin.from('rms_config_settings').update({ value }).eq('id', globalRow.id)).error;
    } else {
      errors.push(`${key}: setting not found`);
      continue;
    }
    if (writeErr) errors.push(`${key}: ${writeErr.message}`);
  }
  if (errors.length) return res.status(500).json({ error: errors.join('; ') });
  res.json({ success: true, updated: Object.keys(updates).length });
});

// ============================================================
// RMS DASHBOARD — aggregated KPIs / recommendations / parity /
// competitors / demand forecast, all derived live from rms_* tables.
// ============================================================

router.get('/dashboard', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  try {
    const propertyId = propQuery(req);

    // Competitors must be resolved first when property-scoped so we can filter their child analysis.
    const compsQ = withProp(supabaseAdmin.from('rms_competitors').select('id, name, active, feed_config').eq('active', true), propertyId);
    const compsRes = await compsQ;
    if (compsRes.error) return res.status(500).json({ error: compsRes.error.message });
    const comps = compsRes.data || [];
    const compIds = comps.map((c: any) => c.id);

    const compAnalysisQ = propertyId && compIds.length
      ? supabaseAdmin.from('rms_competitor_analysis').select('*').in('competitor_id', compIds).order('snapshot_date', { ascending: false })
      : supabaseAdmin.from('rms_competitor_analysis').select('*').order('snapshot_date', { ascending: false });

    const [
      metricsRes, roomTypesRes, biPeriodsRes, forecastsRes,
      parityRes, channelsRes, recsRes, accuracyRes, compAnalysisRes,
    ] = await Promise.all([
      withProp(supabaseAdmin.from('rms_dashboard_metrics').select('*').order('display_order'), propertyId),
      withProp(supabaseAdmin.from('rms_inventory_room_types').select('*'), propertyId),
      withProp(supabaseAdmin.from('rms_bi_revenue_periods').select('*').order('display_order'), propertyId),
      withProp(supabaseAdmin.from('rms_demand_forecasts').select('*').gte('forecast_date', new Date().toISOString().slice(0, 10)).order('forecast_date'), propertyId),
      withProp(supabaseAdmin.from('rms_rate_parity_issues').select('*').eq('active', true), propertyId),
      withProp(supabaseAdmin.from('rms_distribution_channels').select('*').eq('active', true), propertyId),
      withProp(supabaseAdmin.from('rms_ai_recommendations').select('*').eq('rec_type', 'pricing').eq('status', 'pending').order('confidence', { ascending: false }), propertyId),
      withProp(supabaseAdmin.from('rms_bi_forecast_accuracy').select('*'), propertyId),
      compAnalysisQ,
    ]);
    for (const r of [metricsRes, roomTypesRes, biPeriodsRes, forecastsRes, parityRes, channelsRes, recsRes, accuracyRes, compAnalysisRes]) {
      if (r.error) return res.status(500).json({ error: r.error.message });
    }

    const metrics = Object.fromEntries((metricsRes.data || []).map((m: any) => [m.metric_key, Number(m.value)]));
    const roomTypes = roomTypesRes.data || [];
    const biPeriods = biPeriodsRes.data || [];
    const forecasts = forecastsRes.data || [];
    const parityIssues = parityRes.data || [];
    const channels = channelsRes.data || [];
    const recs = recsRes.data || [];
    const accuracyRows = accuracyRes.data || [];
    const compAnalysis = compAnalysisRes.data || [];

    // ── Core KPIs ──────────────────────────────────────────────
    let totalRooms = roomTypes.reduce((s: number, r: any) => s + (r.total_rooms || 0), 0);
    let totalSold = roomTypes.reduce((s: number, r: any) => s + (r.sold || 0), 0);
    let occupancyRate = totalRooms > 0 ? Math.round((totalSold / totalRooms) * 100) : 0;

    const latestPeriod = biPeriods[biPeriods.length - 1];
    const prevPeriod = biPeriods[biPeriods.length - 2];
    let adr = latestPeriod ? Number(latestPeriod.adr) : 0;
    let revpar = latestPeriod ? Number(latestPeriod.revpar) : 0;
    let roomRevenue = latestPeriod ? Number(latestPeriod.revenue) : 0;
    const revenueGrowth = revenueGrowthPct(latestPeriod?.revenue, prevPeriod?.revenue);

    const forecastAccuracy = meanForecastAccuracy(accuracyRows.map((a: any) => Number(a.accuracy || 0)));

    // ── Live PMS data ───────────────────────────────────────────
    // Uses posted folio 'Room' lines for today when available; otherwise
    // falls back to the in-house reservation total. Falls back to seed when
    // the PMS has no rooms yet. `sources` records which path actually fed the
    // KPIs so the UI can say so instead of silently mixing live and seed data.
    const sources = {
      inventory: 'rms_inventory_room_types',
      roomRevenue: 'rms_bi_revenue_periods',
      derivedKpis: 'rms_dashboard_metrics',
      forecasts: 'rms_demand_forecasts',
    };
    const today = new Date().toISOString().slice(0, 10);
    const roomsRes = await withProp(supabaseAdmin.from('rooms').select('id'), propertyId);
    let liveSold = 0;
    let liveRevenue = 0;
    if ((roomsRes.data || []).length > 0) {
      const [foliosRes, liveRes] = await Promise.all([
        withProp(supabaseAdmin.from('folios').select('id'), propertyId),
        withProp(supabaseAdmin.from('reservations').select('total_amount').lte('check_in_date', today).gte('check_out_date', today).neq('status', 'Cancelled'), propertyId),
      ]);
      const folioIds = (foliosRes.data || []).map((f: any) => f.id);
      let folioLines: any[] = [];
      if (folioIds.length > 0) {
        const flRes = await supabaseAdmin.from('folio_lines')
          .select('amount, quantity')
          .in('folio_id', folioIds)
          .eq('transaction_date', today)
          .eq('line_type', 'Room')
          .eq('is_voided', false);
        folioLines = flRes.data || [];
      }
      if (folioLines.length > 0) {
        liveSold = folioLines.reduce((s: number, fl: any) => s + (Number(fl.quantity) || 1), 0);
        liveRevenue = folioLines.reduce((s: number, fl: any) => s + Number(fl.amount || 0), 0);
        sources.roomRevenue = 'folio_lines';
      } else if (liveRes.data?.length) {
        liveSold = liveRes.data.length;
        liveRevenue = liveRes.data.reduce((s: number, r: any) => s + Number(r.total_amount || 0), 0);
        sources.roomRevenue = 'reservations';
      }
      sources.inventory = 'pms_rooms';
      totalRooms = roomsRes.data.length;
      totalSold = liveSold;
      roomRevenue = Math.round(liveRevenue);
      const live = rateKpis({ totalRooms, totalSold, roomRevenue });
      occupancyRate = live.occupancyRate;
      adr = live.adr;
      revpar = live.revpar;
    }

    const { goppar, revenuePerGuest, totalRevenue, forecastRevenue } =
      derivedRevenueKpis({ adr, revpar, totalSold, roomRevenue, metrics });

    // ── Rate parity per distribution channel ───────────────────
    const parity = channels.map((c: any) => {
      const issue = parityIssues.find((i: any) => (i.channel || '').toLowerCase() === (c.name || c.channel_name || '').toLowerCase());
      return {
        channel: c.name || c.channel_name,
        status: issue ? 'violation' : 'ok',
        rate: issue ? Number(issue.our_rate) : adr,
        channelRate: issue ? Number(issue.channel_rate) : adr,
      };
    });

    // ── Competitor comparison (latest snapshot per competitor) ──
    const latestByComp: Record<string, any> = {};
    for (const row of compAnalysis) {
      if (!latestByComp[row.competitor_id]) latestByComp[row.competitor_id] = row;
    }
    const competitors: any[] = comps.map((c: any) => {
      const snap = latestByComp[c.id];
      return {
        name: c.name,
        rate: snap ? Number(snap.adr) : 0,
        occupancy: snap ? Number(snap.occupancy) : 0,
        adr: snap ? Number(snap.adr) : 0,
        revpar: snap ? Number(snap.revpar) : 0,
        marketShare: snap ? Number(snap.market_share) : 0,
        source: competitorFeedSource(c),
      };
    });
    competitors.push({ name: 'Our Hotel', rate: adr, occupancy: occupancyRate, adr, revpar, marketShare: 0, isOurs: true, source: sources.roomRevenue });

    // ── Demand forecast bars (first 5 forecast days) ───────────
    const dayLabels = ['Today', 'Tomorrow', 'In 2 days', 'In 3 days', 'In 4 days'];
    const forecast = forecasts.slice(0, 5).map((f: any, i: number) => ({
      day: dayLabels[i] || `Day ${i}`,
      date: f.forecast_date,
      forecast: Math.round(Number(f.occupancy || 0)),
      demand: i === 0 ? occupancyRate : Math.round(Number(f.occupancy || 0)),
      adr: Number(f.adr || 0),
      confidence: f.confidence,
      level: f.demand,
    }));

    res.json({
      success: true,
      kpis: {
        occupancyRate, adr, revpar, goppar, revenuePerGuest, totalRevenue,
        marketPenetration: metrics.market_penetration ?? 0,
        mpi: metrics.mpi ?? 0,
        rgci: metrics.rgci ?? 0,
        forecastRevenue, revenueGrowth,
        pendingRecommendations: recs.length,
        parityViolations: parityIssues.length,
        forecastAccuracy,
      },
      recommendations: recs,
      parity,
      competitors,
      forecast,
      // Data-source transparency: which path actually fed each KPI group, so
      // the UI can label live-PMS vs seed/BI numbers instead of mixing them
      // silently.
      sources,
      live: sources.inventory === 'pms_rooms',
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to load dashboard' });
  }
});

export default router;
