import { Router, type Response } from 'express';
import { createHash, randomUUID } from 'crypto';
import { z } from 'zod';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { getTypeAvailability, getRoomImageUrl, autoAssignRoomsForPublicBookings, writeAuditEvent } from '../services/sharedServices';
import { computeFees, getSeasonMultiplier, getRatePlanModifier, getEffectiveNightlyRate, type FeeComponent, type SeasonRow, type RatePlanRow } from '../../utils/pricing';
import { getGlobalSettings, getTenantModuleToggles } from '../services/settingsService';
import { getTenantCodeFromSubdomain } from '../middleware/subdomain';
import { nextSpaId, timeToMin } from '../services/spaService';
import { rateLimit } from '../middleware/rateLimit';
import { getTaxRates, evaluateBusinessRules } from '../services/adminConfigService';
import { startWorkflows } from '../services/workflowEngine';

const router = Router();

// Unauthenticated write endpoints are spam vectors — cap per-IP submission
// rates. Inquiry-style writes get a looser bucket than actual bookings.
const publicInquiryLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20 });
const publicBookingLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 10 });

// Read-only catalogue endpoints change rarely — let browsers/CDNs reuse them briefly.
// Availability (/rooms) and anything guest-specific are deliberately excluded.
const CACHEABLE_GET = new Set(['/settings', '/properties', '/restaurants', '/spa-treatments', '/experiences', '/transportation', '/special-offers', '/reviews', '/venues', '/gallery', '/packages', '/guest-services', '/rate-plans']);
router.use((req, res, next) => {
  if (req.method === 'GET' && CACHEABLE_GET.has(req.path)) res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
  next();
});

// ── Live updates (SSE) ───────────────────────────────────────────────────
// While at least one visitor is connected, a single timer fingerprints the tables behind
// the public pages (row count + newest updated_at). When a fingerprint changes, every
// client gets a tiny `change` event naming the topic and refetches just that data.
const LIVE_TABLES: Record<string, string> = {
  offers: 'rms_promotions', reviews: 'public_testimonials', properties: 'properties', packages: 'packages',
  dining: 'outlets', venues: 'banquet_venues', spa: 'spa_treatments', services: 'guest_services', gallery: 'room_types',
};
const LIVE_INTERVAL_MS = 10_000;
const liveClients = new Set<Response>();
const liveFingerprints = new Map<string, string>();
let liveTimer: ReturnType<typeof setInterval> | null = null;

const topicFingerprint = async (topic: string): Promise<string> => {
  if (topic === 'settings') {
    const data = await getGlobalSettings();
    return createHash('md5').update(JSON.stringify(data ?? {})).digest('hex');
  }
  const table = LIVE_TABLES[topic];
  const withStamp = await supabaseAdmin!.from(table).select('updated_at', { count: 'exact' }).order('updated_at', { ascending: false, nullsFirst: false }).limit(1);
  if (!withStamp.error) return `${withStamp.count}:${withStamp.data?.[0]?.updated_at ?? ''}`;
  const countOnly = await supabaseAdmin!.from(table).select('*', { count: 'exact', head: true });
  return `${countOnly.count ?? 'x'}`;
};

const liveTick = async () => {
  if (!supabaseAdmin) return;
  const changed: string[] = [];
  await Promise.all([...Object.keys(LIVE_TABLES), 'settings'].map(async topic => {
    try {
      const fp = await topicFingerprint(topic);
      const prev = liveFingerprints.get(topic);
      liveFingerprints.set(topic, fp);
      if (prev !== undefined && prev !== fp) changed.push(topic);
    } catch { /* table may not exist on older schemas — skip */ }
  }));
  for (const res of liveClients) {
    for (const topic of changed) res.write(`event: change\ndata: ${JSON.stringify({ topic })}\n\n`);
    res.write(': ping\n\n');
  }
};

router.get('/live', (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).end();
  if (liveClients.size >= 500) return res.status(503).end();
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders?.();
  res.write('retry: 5000\n\n');
  liveClients.add(res);
  if (!liveTimer) {
    liveFingerprints.clear();
    void liveTick();
    liveTimer = setInterval(() => void liveTick(), LIVE_INTERVAL_MS);
  }
  req.on('close', () => {
    liveClients.delete(res);
    if (!liveClients.size && liveTimer) { clearInterval(liveTimer); liveTimer = null; }
  });
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

// ── RMS daily rate overrides ─────────────────────────────────────────────
// rms_daily_rate_overrides (migration 571) carries date-scoped selling rates
// written by RMS "apply". A property-specific row wins over the global
// (property_id NULL) row for the same room type + date.
type RateOverrideRow = { room_type_id: string; rate_date: string; rate: number; property_id: string | null };
type OverrideMap = Map<string, Map<string, { rate: number; specific: boolean }>>;
const buildRateOverrideMap = (rows: RateOverrideRow[] | null | undefined): OverrideMap => {
  const m: OverrideMap = new Map();
  for (const r of rows || []) {
    const byDate = m.get(r.room_type_id) || new Map<string, { rate: number; specific: boolean }>();
    const specific = !!r.property_id;
    const existing = byDate.get(r.rate_date);
    if (!existing || (specific && !existing.specific)) {
      byDate.set(r.rate_date, { rate: Number(r.rate), specific });
    }
    m.set(r.room_type_id, byDate);
  }
  return m;
};
// Average nightly base across the stay — override wins, else base_price.
const avgNightlyBase = (roomTypeId: string, basePrice: number, checkIn: string, checkOut: string, overrides: OverrideMap): number => {
  const byDate = overrides.get(roomTypeId);
  if (!byDate || !byDate.size) return basePrice;
  let sum = 0, n = 0;
  for (let d = new Date(checkIn); d < new Date(checkOut); d.setDate(d.getDate() + 1)) {
    sum += byDate.get(d.toISOString().slice(0, 10))?.rate ?? basePrice;
    n++;
  }
  return n ? sum / n : basePrice;
};

// Website inquiries land in the Sales CRM pipeline (sales_leads, source 'Website')
// so the sales team sees them — the legacy inquiry tables never existed.
const createWebsiteLead = async (l: { leadName: string; company?: string; contactPerson?: string; contactEmail?: string; contactPhone?: string; expectedCloseDate?: string; notes?: string; priority?: string }): Promise<{ ok: true; id: string } | { ok: false }> => {
  const id = randomUUID();
  const { error } = await supabaseAdmin!.from('sales_leads').insert({
    id,
    lead_number: `LEAD-${Date.now().toString().slice(-6)}`,
    lead_name: l.leadName,
    company: l.company || null,
    contact_person: l.contactPerson || null,
    contact_email: l.contactEmail || null,
    contact_phone: l.contactPhone || null,
    source: 'Website',
    stage: 'Prospect',
    priority: l.priority || 'Medium',
    expected_close_date: l.expectedCloseDate && /^\d{4}-\d{2}-\d{2}$/.test(l.expectedCloseDate) ? l.expectedCloseDate : null,
    notes: l.notes || null,
  });
  if (error) { console.error('Website lead insert failed:', error.message); return { ok: false }; }
  return { ok: true, id };
};

// Public settings (no auth)
router.get('/settings', async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  const data = await getGlobalSettings();
  if (!data) return res.json({ settings: {} });

  // Tenant subdomains (<tenant>.seledabet.com) get that tenant's portal/module
  // toggles merged over the global map.
  const tenantCode = getTenantCodeFromSubdomain(req);
  if (tenantCode) {
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('code', tenantCode)
      .maybeSingle();
    if (tenant?.id) {
      const tenantToggles = await getTenantModuleToggles(tenant.id);
      if (tenantToggles) {
        data.module_toggles = { ...(data.module_toggles || {}), ...tenantToggles };
      }
    }
  }

  const feeComponents = data.fee_components || [];
  const vatFee = feeComponents.find((f: any) => f.name.toLowerCase().includes('vat') && f.isEnabled);
  const scFee = feeComponents.find((f: any) => f.name.toLowerCase().includes('service charge') && f.isEnabled);

  return res.json({
    settings: {
      customHotelName: data.custom_hotel_name || '',
      customHotelAddress: data.custom_hotel_address || '',
      publicTagline: data.public_tagline || '',
      heroImageUrl: data.hero_image_url && !data.hero_image_url.startsWith('/src')
        ? data.hero_image_url
        : 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&q=80&w=1920',
      hotelLogo: data.hotel_logo || '',
      contactPhone: data.contact_phone || '',
      contactEmail: data.contact_email || '',
      taxPercent: vatFee ? vatFee.value : (data.tax_percent || 0),
      serviceChargePercent: scFee ? scFee.value : (data.service_charge_percent || 0),
      exchangeRate: data.exchange_rate || 1,
      publicBookingEnabled: data.public_booking_enabled ?? true,
      guestPortalEnabled: data.guest_portal_enabled ?? true,
      moduleToggles: data.module_toggles || {},
      maintenanceMode: data.maintenance_mode ?? false,
      maintenanceMessage: data.maintenance_message || '',
      bookingTerms: data.booking_terms || '',
      hotelTin: data.hotel_tin || '',
      hotelVatNo: data.hotel_vat_no || '',
      invoiceBankDetails: data.invoice_bank_details || '',
      checkInTime: data.check_in_time || '01:00 PM',
      checkOutTime: data.check_out_time || '10:00 AM',
      starRating: '5',
      feeComponents: feeComponents.map((f: any) => ({
        id: f.id,
        name: f.name,
        feeType: f.feeType,
        value: f.value,
        isEnabled: f.isEnabled
      })),
      policySections: data.policy_sections || [],
      cancellationGraceHours: data.cancellation_grace_hours || 24,
      cancellationPenaltyPercent: data.cancellation_penalty_percent || 50,
      bookingHeroTitle: data.booking_hero_title || 'Find your perfect stay',
      bookingHeroDescription: data.booking_hero_description || 'Book directly with us for the best available rates, personalized service, and instant confirmation.',
      bookingStep1Label: data.booking_step1_label || 'Select Room',
      bookingStep2Label: data.booking_step2_label || 'Add-ons',
      bookingStep3Label: data.booking_step3_label || 'Details',
      bookingRoomsSectionTitle: data.booking_rooms_section_title || 'Select your room',
      bookingPackagesSectionTitle: data.booking_packages_section_title || 'Packages',
      bookingGuestServicesSectionTitle: data.booking_guest_services_section_title || 'Guest Services',
      bookingYourRoomsTitle: data.booking_your_rooms_title || 'Your Rooms',
      bookingGuestDetailsTitle: data.booking_guest_details_title || 'Guest Details',
      bookingSummaryTitle: data.booking_summary_title || 'Booking Summary',
      bookingHeaderSubtitle: data.booking_header_subtitle || 'Direct Reservations',
      bookingNoRoomsMessage: data.booking_no_rooms_message || 'No rooms available for the selected dates.',
      bookingNoRoomsSubtext: data.booking_no_rooms_subtext || 'Try adjusting your dates or contact the hotel.',
      bookingTermsAgreement: data.booking_terms_agreement || 'I agree to the hotel terms and conditions and cancellation policy.',
      bookingReadTermsText: data.booking_read_terms_text || 'Read terms',
      bookingConfirmButtonText: data.booking_confirm_button_text || 'Confirm booking',
      bookingSecureBookingText: data.booking_secure_booking_text || 'Secure booking · No card required'
    }
  });
});

// Public room availability (no auth)
const roomsQuerySchema = z.object({
  checkIn: z.string().min(1, 'checkIn is required'),
  checkOut: z.string().min(1, 'checkOut is required'),
}).refine((data) => {
  const start = new Date(data.checkIn);
  const end = new Date(data.checkOut);
  return !isNaN(start.getTime()) && !isNaN(end.getTime()) && end > start;
}, {
  message: "checkOut must be a valid date after checkIn",
  path: ["checkOut"],
});

router.get('/rooms', async (req, res) => {
  const validation = roomsQuerySchema.safeParse(req.query);
  if (!validation.success) {
    return res.status(400).json({ error: 'Validation failed', details: validation.error.flatten() });
  }

  const { checkIn, checkOut } = validation.data;

  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const [{ data: roomTypes, error: rtError }, { data: rooms, error: roomsError }, { data: reservations, error: resError }, { data: seasons }, allotmentsResult, overridesResult] = await Promise.all([
    supabaseAdmin.from('room_types').select('*').eq('is_active', true),
    supabaseAdmin.from('rooms').select('*'),
    supabaseAdmin.from('reservations').select('*').lt('check_in_date', checkOut).gt('check_out_date', checkIn),
    supabaseAdmin.from('seasons').select('*'),
    // Allotments reduce sellable inventory for operators. is_released allotments
    // no longer block. Table may not exist on older schemas — tolerate the error.
    supabaseAdmin.from('allotments').select('room_type_id, stay_date, blocked_qty, picked_up_qty, is_released').gte('stay_date', checkIn).lt('stay_date', checkOut).eq('is_released', false),
    // RMS daily rate overrides — tolerate error on older schemas.
    supabaseAdmin.from('rms_daily_rate_overrides').select('room_type_id, rate_date, rate, property_id').gte('rate_date', checkIn).lt('rate_date', checkOut)
  ]);
  if (rtError) return res.status(500).json({ error: rtError.message });
  if (roomsError) return res.status(500).json({ error: roomsError.message });
  if (resError) return res.status(500).json({ error: resError.message });

  const roomTypesList = roomTypes || [];
  const roomsList = rooms || [];
  const reservationsList = reservations || [];
  const season = getSeasonMultiplier(checkIn, (seasons || []) as SeasonRow[]);
  const rateOverrides = buildRateOverrideMap(overridesResult?.data as RateOverrideRow[] | undefined);

  // Sum allotment blocks per room type across the stay range, mirroring the
  // create_booking_atomic RPC so display availability == bookable availability.
  const allotmentBlockByType = new Map<string, number>();
  for (const a of (allotmentsResult?.data || [])) {
    const blocked = Math.max(0, (a.blocked_qty || 0) - (a.picked_up_qty || 0));
    allotmentBlockByType.set(a.room_type_id, (allotmentBlockByType.get(a.room_type_id) || 0) + blocked);
  }

  const result = roomTypesList.map((rt: any) => {
    const availability = getTypeAvailability(rt.id, checkIn, checkOut, roomsList, reservationsList);
    const allotmentBlock = allotmentBlockByType.get(rt.id) || 0;
    const displayAvailable = Math.max(0, availability.available - allotmentBlock);
    return {
      type: rt.id,
      title: rt.name,
      description: rt.description || `${rt.name} room`,
      rate: avgNightlyBase(rt.id, Number(rt.base_price) || 0, checkIn, checkOut, rateOverrides),
      baseRate: rt.base_price,
      capacity: rt.max_occupancy,
      available: displayAvailable,
      features: rt.amenities || [],
      imageUrl: rt.image_url_1 || getRoomImageUrl(rt.name),
      imageUrl2: rt.image_url_2 || null,
      imageUrl3: rt.image_url_3 || null,
      roomSizeSqm: rt.room_size_sqm,
      bedConfiguration: rt.bed_configuration,
      displayOrder: rt.display_order || 0,
      totalRooms: availability.capacity,
      isActive: rt.is_active !== false,
    };
  }).filter((rt: any) => rt.available > 0).sort((a: any, b: any) => a.displayOrder - b.displayOrder);

  return res.json({ rooms: result, season });
});

// Public rate plans (no auth)
router.get('/rate-plans', async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  const { data, error } = await supabaseAdmin.from('rate_plans').select('*').eq('active', true);
  if (error) return res.status(500).json({ error: error.message });
  const seen = new Set<string>();
  const ratePlans = (data || [])
    .filter((rp: any) => {
      const key = (rp.name || '').toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((rp: any) => ({
      id: rp.id,
      name: rp.name,
      description: rp.description || '',
      baseModifier: Number(rp.base_modifier) || 1,
      minStay: rp.min_stay || 1,
      maxStay: rp.max_stay || null,
      cancellationPolicy: rp.cancellation_policy || '',
    }))
    .sort((a: any, b: any) => a.baseModifier - b.baseModifier);
  return res.json({ ratePlans });
});

// Public packages (no auth)
router.get('/packages', async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  const { data, error } = await supabaseAdmin.from('packages').select('*');
  if (error) return res.status(500).json({ error: error.message });
  return res.json({
    packages: (data || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      description: p.description || '',
      price: Number(p.price),
      chargeFrequency: p.charge_frequency || 'once',
    }))
  });
});

// Public guest services (no auth)
router.get('/guest-services', async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  const { data, error } = await supabaseAdmin.from('guest_services').select('*').eq('available', true);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({
    guestServices: (data || []).map((gs: any) => ({
      id: gs.id,
      name: gs.name,
      description: gs.description || '',
      category: gs.category || 'dining',
      price: Number(gs.price),
      available: gs.available,
    }))
  });
});

// =====================
// Guest In-Stay Requests
// =====================

// These endpoints are unauthenticated, so the booking link is the credential:
// callers must supply the reservationId AND the guestId of the reservation's
// owner (same bearer model as canActForGuest). Anything less is rejected.
const GUEST_LINK_STATUSES = new Set([
  'Reserved', 'Confirmed', 'Pending', 'Guaranteed',
  'CheckedIn', 'Checked In', 'InHouse', 'In House',
]);

async function verifyGuestLink(res: any, reservationId: unknown, guestId: unknown) {
  if (typeof reservationId !== 'string' || typeof guestId !== 'string' || !reservationId || !guestId) {
    res.status(401).json({ error: 'reservationId and guestId are required' });
    return null;
  }
  const { data, error } = await supabaseAdmin!
    .from('reservations')
    .select('id, guest_id, guest_name, room_number, property_id, status')
    .eq('id', reservationId)
    .maybeSingle();
  if (error) { res.status(500).json({ error: error.message }); return null; }
  if (!data || data.guest_id !== guestId || !GUEST_LINK_STATUSES.has(String(data.status))) {
    res.status(403).json({ error: 'Invalid guest credentials' });
    return null;
  }
  return data;
}

// Submit a guest request (booking-link credential)
router.post('/guest-requests', publicInquiryLimiter, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  const { reservationId, guestId, requestType, description, priority } = req.body;
  if (!reservationId || !requestType) {
    return res.status(400).json({ error: 'reservationId and requestType are required' });
  }
  const resv = await verifyGuestLink(res, reservationId, guestId);
  if (!resv) return;

  const deptMap: Record<string, string> = {
    Housekeeping: 'Housekeeping',
    Maintenance: 'Engineering',
    'Room Service': 'F&B',
    Concierge: 'Front Office',
  };
  const assignedDept = deptMap[requestType] || 'Front Office';
  const reqNum = `GR-${Date.now().toString().slice(-6)}`;

  // Room/guest identity resolved server-side — never trusted from the client.
  const { data, error } = await supabaseAdmin.from('guest_requests').insert({
    request_number: reqNum,
    property_id: resv.property_id || null,
    reservation_id: reservationId,
    room_number: resv.room_number || null,
    guest_name: resv.guest_name || null,
    request_type: requestType,
    description: description || null,
    priority: priority || 'Normal',
    status: 'Open',
    assigned_department: assignedDept,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true, request: data });
});

// List guest requests by reservation (booking-link credential)
router.get('/guest-requests/:reservationId', async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  const resv = await verifyGuestLink(res, req.params.reservationId, req.query.guestId);
  if (!resv) return;
  const { data, error } = await supabaseAdmin.from('guest_requests')
    .select('*').eq('reservation_id', req.params.reservationId).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ requests: data || [] });
});

// Guest folio view (read-only, booking-link credential)
router.get('/guest-folio/:reservationId', async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  const resv = await verifyGuestLink(res, req.params.reservationId, req.query.guestId);
  if (!resv) return;
  const { data: folios, error: folioError } = await supabaseAdmin.from('folios')
    .select('*').eq('reservation_id', req.params.reservationId).order('opened_at', { ascending: false });
  if (folioError) return res.status(500).json({ error: folioError.message });

  if (!folios || folios.length === 0) {
    return res.json({ folios: [] });
  }

  const folioIds = folios.map(f => f.id);
  const { data: lines, error: lineError } = await supabaseAdmin.from('folio_lines')
    .select('*').in('folio_id', folioIds).eq('is_voided', false).order('line_number', { ascending: true });
  if (lineError) return res.status(500).json({ error: lineError.message });

  const foliosWithLines = folios.map(f => ({
    ...f,
    lines: (lines || []).filter(l => l.folio_id === f.id),
  }));

  return res.json({ folios: foliosWithLines });
});

// =====================
// Public Portal Endpoints
// =====================

// Public properties (no auth)
router.get('/properties', async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  const [{ data, error }, { data: roomTypes }, { data: rooms }, { data: testimonials }] = await Promise.all([
    supabaseAdmin.from('properties').select('*').eq('is_active', true).order('created_at'),
    supabaseAdmin.from('room_types').select('property_id, base_price').eq('is_active', true),
    supabaseAdmin.from('rooms').select('property_id'),
    supabaseAdmin.from('public_testimonials').select('property_id, rating').eq('status', 'approved'),
  ]);
  if (error) return res.status(500).json({ error: error.message });
  const addr = (a: any) => (a && typeof a === 'object' ? [a.street || a.line1, a.city, a.country].filter(Boolean).join(', ') : typeof a === 'string' ? a : '');
  return res.json({
    properties: (data || []).map((prop: any) => {
      const meta = prop.metadata || {};
      const prices = (roomTypes || []).filter((r: any) => !r.property_id || r.property_id === prop.id).map((r: any) => Number(r.base_price)).filter((n: number) => n > 0);
      const ratings = (testimonials || []).filter((t: any) => !t.property_id || t.property_id === 'single-property' || t.property_id === prop.id).map((t: any) => Number(t.rating)).filter((n: number) => n > 0);
      return {
        id: prop.id,
        name: prop.property_name,
        type: prop.property_type || 'hotel',
        location: addr(prop.address),
        country: prop.address?.country || 'Ethiopia',
        description: meta.description || '',
        imageUrl: meta.imageUrl || meta.image_url || '',
        amenities: Array.isArray(meta.amenities) ? meta.amenities : [],
        facilities: Array.isArray(meta.facilities) ? meta.facilities : [],
        contact: { phone: prop.contact_phone || '', email: prop.contact_email || '', website: meta.website || '' },
        roomCount: (rooms || []).filter((r: any) => r.property_id === prop.id).length,
        startingPrice: prices.length ? Math.min(...prices) : 0,
        starRating: prop.star_rating || null,
        rating: ratings.length ? Math.round((ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length) * 10) / 10 : null,
        reviewCount: ratings.length
      };
    })
  });
});

// Public restaurants (no auth)
router.get('/restaurants', async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  // Dining outlets managed by F&B (restaurants and bars only — not minibar/room service/banquet).
  const { data, error } = await supabaseAdmin.from('outlets').select('id, name, type, operating_hours, property_id')
    .eq('is_active', true).in('type', ['Restaurant', 'Bar']).order('name');
  if (error) return res.status(500).json({ error: error.message });
  const today = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date().getDay()];
  const hoursText = (h: any): string => {
    if (!h) return '';
    if (typeof h === 'string') return h;
    const d = h[today] || h;
    return d?.open && d?.close ? `${d.open} - ${d.close}` : '';
  };
  return res.json({
    restaurants: (data || []).map((o: any) => ({
      id: o.id,
      name: o.name,
      cuisine: o.type === 'Bar' ? 'Bar & Lounge' : 'Restaurant',
      description: '',
      openingHours: hoursText(o.operating_hours),
      propertyId: o.property_id || null,
    }))
  });
});

// Public spa treatments (no auth). ?propertyId=<uuid> scopes to that
// property's catalog plus shared rows; otherwise only shared rows.
router.get('/spa-treatments', async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  const propId = isUuid(req.query.propertyId) ? String(req.query.propertyId) : null;

  let q = supabaseAdmin
    .from('spa_treatments')
    .select('id, name, category, description, duration_minutes, price, is_popular')
    .eq('is_active', true);
  q = propId ? q.or(`property_id.is.null,property_id.eq.${propId}`) : q.is('property_id', null);

  const { data, error } = await q.order('is_popular', { ascending: false }).order('name');
  if (error) return res.status(500).json({ error: error.message });

  // Shared seeds can repeat the same treatment under several properties —
  // the public page should show each treatment once.
  const seen = new Set<string>();
  const treatments = (data || []).filter((t: any) => {
    if (seen.has(t.name)) return false;
    seen.add(t.name);
    return true;
  }).map((treatment: any) => ({
    id: treatment.id,
    name: treatment.name,
    category: treatment.category || 'Wellness',
    duration: `${treatment.duration_minutes || 60} min`,
    price: Number(treatment.price) || 0,
    popular: !!treatment.is_popular,
    description: treatment.description || ''
  }));

  return res.json({ treatments });
});

// Public spa booking request (no auth). Creates a 'Requested' appointment;
// staff confirm/assign a therapist from the spa portal. Contact details are
// carried in notes since spa_appointments has no phone/email columns.
router.post('/spa-booking-requests', publicInquiryLimiter, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const {
    guest_name, phone, email, treatment_id,
    preferred_date, preferred_time, notes, propertyId,
  } = req.body || {};

  if (!guest_name || !treatment_id || !preferred_date || !preferred_time) {
    return res.status(400).json({ error: 'guest_name, treatment_id, preferred_date and preferred_time are required' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(preferred_date)) {
    return res.status(400).json({ error: 'preferred_date must be YYYY-MM-DD' });
  }
  if (preferred_date < new Date().toISOString().slice(0, 10)) {
    return res.status(400).json({ error: 'Cannot request a past date' });
  }
  if (timeToMin(preferred_time) === null) {
    return res.status(400).json({ error: 'preferred_time must be HH:MM' });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  const propId = isUuid(propertyId) ? propertyId : null;

  const { data: treatment } = await supabaseAdmin
    .from('spa_treatments')
    .select('id, name, duration_minutes, price, is_active')
    .eq('id', treatment_id)
    .maybeSingle();
  if (!treatment || !treatment.is_active) {
    return res.status(400).json({ error: 'Unknown or unavailable treatment' });
  }

  const id = await nextSpaId('APT-');
  const contactNote = [
    phone ? `Phone: ${phone}` : null,
    email ? `Email: ${email}` : null,
    notes || null,
  ].filter(Boolean).join(' | ') || null;

  const { data, error } = await supabaseAdmin
    .from('spa_appointments')
    .insert({
      id,
      guest_id: null,
      guest_name: String(guest_name).slice(0, 200),
      treatment_id: treatment.id,
      treatment: treatment.name,
      appointment_date: preferred_date,
      start_time: preferred_time,
      duration_minutes: Number(treatment.duration_minutes) || 60,
      status: 'Requested',
      source: 'Public Booking Request',
      amount: treatment.price,
      notes: contactNote,
      property_id: propId,
    })
    .select('id, treatment, appointment_date, start_time, status, amount')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ booking: data });
});

// Public experiences (no auth)
router.get('/experiences', async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  // No dedicated experiences catalog exists yet — surface bookable guest services
  // in the experience-style categories so the page reflects real, priced offerings.
  const { data, error } = await supabaseAdmin.from('guest_services').select('*');
  if (error) return res.status(500).json({ error: error.message });
  const EXP = /tour|safari|excursion|activity|trip|hike|cultural|coffee|guide|spa|yoga|cooking/i;
  return res.json({
    experiences: (data || [])
      .filter((g: any) => g.available !== false && EXP.test(`${g.name} ${g.category || ''}`))
      .map((g: any) => ({
        id: g.id,
        name: g.name,
        duration: '',
        price: Number(g.price) || 0,
        type: g.category || 'experience',
        description: g.description || ''
      }))
  });
});

// Public transportation services (no auth). Backed by the property's
// transport_config_items transport_type catalog — ?propertyId=<uuid> scopes
// it, otherwise the first property's catalog is shown.
router.get('/transportation', async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  let propId = isUuid(req.query.propertyId) ? String(req.query.propertyId) : null;
  if (!propId) {
    const { data: firstProp } = await supabaseAdmin
      .from('properties').select('id').order('created_at').limit(1).maybeSingle();
    propId = firstProp?.id || null;
  }
  if (!propId) return res.json({ services: [] });

  const { data, error } = await supabaseAdmin
    .from('transport_config_items')
    .select('id, name, base_rate, sort_order')
    .eq('property_id', propId)
    .eq('item_group', 'transport_type')
    .eq('active', true)
    .order('sort_order', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  const CAPACITY_BY_TYPE: Record<string, string> = {
    'Airport Pickup': '4 passengers', 'Airport Drop-off': '4 passengers',
    'City Transfer': '4 passengers', 'Hotel Shuttle': '12 passengers',
    'Sightseeing Tour': '10 passengers', 'VIP Transport': '3 passengers',
    'Staff Shuttle': '12 passengers', 'Courier Service': '—',
  };
  return res.json({
    propertyId: propId,
    services: (data || []).map((s: any) => ({
      id: s.id,
      name: s.name,
      price: Number(s.base_rate) || 0,
      capacity: CAPACITY_BY_TYPE[s.name] || '4 passengers',
      vehicle: s.name,
      description: ''
    }))
  });
});

// Public transport booking (no auth). Creates a transport_request with
// source='Website' so it lands in dispatch like any other request.
router.post('/transportation/book', publicInquiryLimiter, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  const { serviceId, serviceName, guestName, phone, email, date, time,
    pickupLocation, dropoffLocation, passengers, notes, propertyId } = req.body || {};

  if (!guestName || !date || !time || !pickupLocation) {
    return res.status(400).json({ error: 'guestName, date, time and pickupLocation are required' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || timeToMin(time) === null) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD and time HH:MM' });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  // Resolve the service → transport request type + rate + property.
  let service: any = null;
  if (isUuid(serviceId)) {
    const { data } = await supabaseAdmin
      .from('transport_config_items')
      .select('id, property_id, name, base_rate, active')
      .eq('id', serviceId).eq('item_group', 'transport_type')
      .maybeSingle();
    if (data?.active) service = data;
  }
  if (!service && serviceName) {
    const { data } = await supabaseAdmin
      .from('transport_config_items')
      .select('id, property_id, name, base_rate, active')
      .eq('name', serviceName).eq('item_group', 'transport_type').eq('active', true)
      .limit(1).maybeSingle();
    if (data) service = data;
  }
  if (!service) return res.status(400).json({ error: 'Unknown or unavailable transport service' });

  const propId = isUuid(propertyId) && propertyId === service.property_id
    ? propertyId
    : service.property_id;

  const scheduledTime = new Date(`${date}T${time}:00`).toISOString();
  const requestNumber = `TR-${date.replace(/-/g, '')}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
  const contactNote = [
    phone ? `Phone: ${phone}` : null,
    email ? `Email: ${email}` : null,
    notes || null,
  ].filter(Boolean).join(' | ') || null;

  const { data, error } = await supabaseAdmin.from('transport_requests').insert({
    property_id: propId,
    request_number: requestNumber,
    guest_name: String(guestName).slice(0, 200),
    type: service.name,
    source: 'Website',
    pickup_location: String(pickupLocation).slice(0, 300),
    destination: String(dropoffLocation || pickupLocation).slice(0, 300),
    scheduled_time: scheduledTime,
    passenger_count: Math.max(1, Number(passengers) || 1),
    status: 'Requested',
    special_instructions: contactNote,
    amount: Number(service.base_rate) || 0,
  }).select('id, request_number, type, scheduled_time, status, amount').single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ booking: data });
});

// Public special offers (no auth)
router.get('/special-offers', async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  // Active RMS promotions inside their date window (managed in Revenue Management).
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin.from('rms_promotions').select('*').eq('status', 'active');
  if (error) return res.status(500).json({ error: error.message });
  return res.json({
    offers: (data || [])
      .filter((p: any) => (!p.start_date || p.start_date <= today) && (!p.end_date || p.end_date >= today))
      .map((p: any) => ({
        id: p.id,
        title: p.name,
        discount: Number(p.discount) > 0 ? `${Number(p.discount)}% off` : 'Special Offer',
        description: p.target_segment ? `For ${p.target_segment}` : '',
        validUntil: p.end_date || '',
        type: p.promo_type || 'special',
        code: p.code || '',
        imageUrl: ''
      }))
  });
});

// Public photo gallery (no auth) — room photos managed in room type setup, plus property photos.
router.get('/gallery', async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  const [{ data: roomTypes, error }, { data: props }] = await Promise.all([
    supabaseAdmin.from('room_types').select('name, image_url_1, image_url_2, image_url_3, display_order').eq('is_active', true).order('display_order'),
    supabaseAdmin.from('properties').select('property_name, metadata').eq('is_active', true),
  ]);
  if (error) return res.status(500).json({ error: error.message });
  const ok = (u: unknown): u is string => typeof u === 'string' && /^(https?:)?\/\//.test(u);
  const images: { url: string; caption: string; category: string }[] = [];
  for (const p of props || []) {
    const u = p.metadata?.imageUrl || p.metadata?.image_url;
    if (ok(u)) images.push({ url: u, caption: p.property_name, category: 'Property' });
  }
  for (const rt of roomTypes || []) {
    for (const u of [rt.image_url_1, rt.image_url_2, rt.image_url_3]) {
      if (ok(u)) images.push({ url: u, caption: rt.name, category: 'Rooms' });
    }
  }
  return res.json({ images });
});

// Public meeting/banquet venues (no auth) — managed in the Banquet & Events portal.
router.get('/venues', async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  const { data, error } = await supabaseAdmin.from('banquet_venues').select('id, venue_name, venue_type, capacity, features').eq('is_active', true).order('capacity', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({
    venues: (data || []).map((v: any) => ({
      id: v.id,
      name: v.venue_name,
      type: v.venue_type || '',
      capacity: Number(v.capacity) || 0,
      features: Array.isArray(v.features) ? v.features.map(String) : []
    }))
  });
});

// Public reviews (no auth)
router.get('/reviews', async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  const { data, error } = await supabaseAdmin.from('public_testimonials').select('*').eq('status', 'approved').order('created_at', { ascending: false }).limit(20);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({
    reviews: (data || []).map((review: any) => ({
      id: review.id,
      name: review.guest_name || 'Guest',
      location: review.location || '',
      rating: review.rating || 5,
      date: review.stay_date || review.created_at || '',
      roomType: review.room_type || '',
      comment: review.comment || ''
    }))
  });
});

// Submit meeting inquiry (no auth)
router.post('/meeting-inquiry', publicInquiryLimiter, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  
  const inquirySchema = z.object({
    eventType: z.string(),
    attendees: z.string(),
    startDate: z.string(),
    endDate: z.string().optional(),
    requirements: z.string().optional(),
    contactName: z.string(),
    contactEmail: z.string().email(),
    contactPhone: z.string(),
    company: z.string().optional()
  });

  const validation = inquirySchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: 'Validation failed', details: validation.error.flatten() });
  }

  const d = validation.data;
  const result = await createWebsiteLead({
    leadName: `${d.eventType} inquiry — ${d.company || d.contactName}`,
    company: d.company, contactPerson: d.contactName, contactEmail: d.contactEmail, contactPhone: d.contactPhone,
    expectedCloseDate: d.startDate,
    notes: [`Meeting/Event inquiry (website)`, `Type: ${d.eventType}`, `Attendees: ${d.attendees}`, `Dates: ${d.startDate}${d.endDate ? ` → ${d.endDate}` : ''}`, d.requirements && `Requirements: ${d.requirements}`].filter(Boolean).join('\n'),
  });
  if (!result.ok) return res.status(500).json({ error: 'Could not submit your inquiry. Please try again or call us.' });
  return res.json({ success: true, inquiryId: result.id });
});

// Submit wedding inquiry (no auth)
router.post('/wedding-inquiry', publicInquiryLimiter, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  
  const inquirySchema = z.object({
    weddingDate: z.string(),
    guestCount: z.string(),
    package: z.string().optional(),
    contactName: z.string(),
    contactEmail: z.string().email(),
    contactPhone: z.string(),
    message: z.string().optional()
  });

  const validation = inquirySchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: 'Validation failed', details: validation.error.flatten() });
  }

  const d = validation.data;
  const result = await createWebsiteLead({
    leadName: `Wedding inquiry — ${d.contactName}`,
    contactPerson: d.contactName, contactEmail: d.contactEmail, contactPhone: d.contactPhone,
    expectedCloseDate: d.weddingDate,
    notes: [`Wedding inquiry (website)`, `Date: ${d.weddingDate}`, `Guests: ${d.guestCount}`, d.package && `Package: ${d.package}`, d.message && `Message: ${d.message}`].filter(Boolean).join('\n'),
  });
  if (!result.ok) return res.status(500).json({ error: 'Could not submit your inquiry. Please try again or call us.' });
  return res.json({ success: true, inquiryId: result.id });
});

// Submit contact form (no auth)
router.post('/contact', publicInquiryLimiter, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  
  const contactSchema = z.object({
    name: z.string(),
    email: z.string().email(),
    subject: z.string(),
    message: z.string()
  });

  const validation = contactSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: 'Validation failed', details: validation.error.flatten() });
  }

  const d = validation.data;
  const result = await createWebsiteLead({
    leadName: `Website contact — ${d.subject}`.slice(0, 200),
    contactPerson: d.name, contactEmail: d.email,
    notes: `Contact form (website)\nSubject: ${d.subject}\n\n${d.message}`,
    priority: 'Low',
  });
  if (!result.ok) return res.status(500).json({ error: 'Could not send your message. Please try again or call us.' });
  return res.json({ success: true, submissionId: result.id });
});

// Looks up a voucher and returns its discount, or an error descriptor. The
// server is the only source of truth for voucher value — never the client.
type VoucherCheck = { ok: true; voucher: any; discount: number } | { ok: false; status: number; error: string };
const checkVoucher = async (code: unknown): Promise<VoucherCheck> => {
  const voucherNo = typeof code === 'string' ? code.trim() : '';
  if (!voucherNo) return { ok: false, status: 400, error: 'Voucher code is required' };
  const { data: voucher } = await supabaseAdmin!.from('vouchers').select('*').eq('voucher_no', voucherNo).maybeSingle();
  if (!voucher) return { ok: false, status: 404, error: 'Voucher not found' };
  if (voucher.status !== 'issued') return { ok: false, status: 409, error: `Voucher is ${voucher.status}` };
  const today = new Date().toISOString().slice(0, 10);
  if (voucher.valid_to && String(voucher.valid_to) < today) return { ok: false, status: 409, error: 'Voucher expired' };
  return { ok: true, voucher, discount: Math.max(0, Number(voucher.net_value) || 0) };
};

// Public voucher preview (no auth) — never consumes the voucher.
router.post('/vouchers/validate', publicInquiryLimiter, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const result = await checkVoucher(req.body?.voucher_no);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ voucher_no: result.voucher.voucher_no, discount_amount: result.discount, valid_to: result.voucher.valid_to });
});

// Public booking creation (no auth)
router.post('/bookings', publicBookingLimiter, async (req, res) => {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const { checkIn, checkOut, guestName, guestEmail, guestPhone, guestNationality, packageIds, guestServiceIds, specialRequests, items, airportShuttleRequests, groupName, primaryContact, operator_id, voucher_code, ratePlanId } = req.body || {};

    const effectiveGuestName = guestName || primaryContact;

    if (!checkIn || !checkOut || !effectiveGuestName || !guestEmail) {
      return res.status(400).json({ error: 'checkIn, checkOut, guestName, guestEmail are required' });
    }
    if (!z.string().email().safeParse(guestEmail).success) {
      return res.status(400).json({ error: 'A valid guest email is required' });
    }
    const isoDate = /^\d{4}-\d{2}-\d{2}$/;
    if (!isoDate.test(String(checkIn)) || !isoDate.test(String(checkOut)) || isNaN(new Date(checkIn).getTime()) || isNaN(new Date(checkOut).getTime())) {
      return res.status(400).json({ error: 'checkIn and checkOut must be valid YYYY-MM-DD dates' });
    }
    const todayStr = new Date().toISOString().slice(0, 10);
    if (checkIn < todayStr) return res.status(400).json({ error: 'Check-in date cannot be in the past' });
    if (checkOut <= checkIn) return res.status(400).json({ error: 'Check-out must be after check-in' });
    if ((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000 > 90) {
      return res.status(400).json({ error: 'Online bookings are limited to 90 nights. Please contact the hotel for longer stays.' });
    }

    const cartItems = Array.isArray(items) && items.length > 0 ? items : [];
    if (cartItems.length === 0) {
      return res.status(400).json({ error: 'At least one room is required' });
    }

    // Check if public booking is enabled and not in maintenance mode
    const settings = await getGlobalSettings();
    if (!settings?.public_booking_enabled) {
      return res.status(503).json({ error: 'Public booking is currently disabled' });
    }
    if (settings?.maintenance_mode) {
      return res.status(503).json({ error: settings.maintenance_message || 'System is under maintenance. Please try again later.' });
    }

    const [{ data: roomTypes }, { data: rooms }, { data: reservations }, { data: packages }, { data: guestServices }, { data: allotments }, { data: seasons }, { data: ratePlans }, { data: rateOverrideRows }] = await Promise.all([
      supabaseAdmin.from('room_types').select('*'),
      supabaseAdmin.from('rooms').select('*'),
      supabaseAdmin.from('reservations').select('*').lt('check_in_date', checkOut).gt('check_out_date', checkIn),
      supabaseAdmin.from('packages').select('*'),
      supabaseAdmin.from('guest_services').select('*'),
      operator_id ? supabaseAdmin.from('allotments').select('*').eq('operator_id', operator_id).gte('stay_date', checkIn).lte('stay_date', checkOut).eq('is_released', false) : Promise.resolve({ data: [] }),
      supabaseAdmin.from('seasons').select('*'),
      supabaseAdmin.from('rate_plans').select('*'),
      // RMS daily rate overrides — tolerate error on older schemas.
      supabaseAdmin.from('rms_daily_rate_overrides').select('room_type_id, rate_date, rate, property_id').gte('rate_date', checkIn).lt('rate_date', checkOut).then(r => r, () => ({ data: [] }))
    ]);

    const rateOverrides = buildRateOverrideMap(rateOverrideRows as RateOverrideRow[] | undefined);

    const roomTypesList = roomTypes || [];
    const roomsList = rooms || [];
    const reservationsList = reservations || [];
    const allotmentsList = allotments || [];
    const centralTax = await getTaxRates({ appliesTo: 'rooms' });
    const taxPercent = centralTax.vat ?? ((settings as any)?.tax_percent || 0);
    const serviceChargePercent = centralTax.serviceCharge ?? ((settings as any)?.service_charge_percent || 0);
    const feeComponents = ((settings as any)?.fee_components || []) as FeeComponent[];
    const nights = Math.max(1, Math.ceil((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / (1000 * 60 * 60 * 24)));

    // ── Pricing parity with the front desk: seasonal multiplier + rate plan ──
    const season = getSeasonMultiplier(checkIn, (seasons || []) as SeasonRow[]);
    const ratePlan = getRatePlanModifier(ratePlanId, (ratePlans || []) as RatePlanRow[]);
    const packageIdsList: string[] = Array.isArray(packageIds) ? packageIds : (packageIds ? [packageIds] : []);
    const guestServiceIdsList: string[] = Array.isArray(guestServiceIds) ? guestServiceIds : (guestServiceIds ? [guestServiceIds] : []);

    // Build a map of allotment availability by room type and date
    const allotmentAvailability = new Map<string, Map<string, number>>(); // roomTypeId -> date -> available
    if (operator_id && allotmentsList.length > 0) {
      for (const allotment of allotmentsList) {
        const key = `${allotment.room_type_id}`;
        if (!allotmentAvailability.has(key)) {
          allotmentAvailability.set(key, new Map());
        }
        const available = (allotment.blocked_qty || 0) - (allotment.picked_up_qty || 0);
        allotmentAvailability.get(key)!.set(allotment.stay_date, available);
      }
    }

    // Validate availability and compute pricing per item
    const enrichedItems = [];
    let roomSubtotal = 0;
    for (const item of cartItems) {
      const roomTypeId = item.roomType;
      const roomType = roomTypesList.find((rt: any) => rt.id === roomTypeId);
      if (!roomType) {
        return res.status(400).json({ error: `Room type ${roomTypeId} not found` });
      }
      const qty = Math.max(1, Number(item.quantity) || 1);
      // Apply seasonal + rate-plan adjustment so public rates match front desk.
      // RMS daily overrides replace the base price for the nights they cover.
      const stayBase = avgNightlyBase(roomTypeId, Number(roomType.base_price) || 0, checkIn, checkOut, rateOverrides);
      const rate = getEffectiveNightlyRate(stayBase, season.multiplier, ratePlan.modifier);

      // Check allotment availability if operator is selected
      if (operator_id && allotmentAvailability.has(roomTypeId)) {
        const dateMap = allotmentAvailability.get(roomTypeId)!;
        let minAllotmentAvailable = Infinity;
        let currentDate = new Date(checkIn);
        while (currentDate < new Date(checkOut)) {
          const dateStr = currentDate.toISOString().split('T')[0];
          const available = dateMap.get(dateStr) || 0;
          minAllotmentAvailable = Math.min(minAllotmentAvailable, available);
          currentDate.setDate(currentDate.getDate() + 1);
        }
        if (minAllotmentAvailable < qty) {
          return res.status(409).json({ error: `Only ${minAllotmentAvailable} ${roomType.name} room${minAllotmentAvailable === 1 ? '' : 's'} available in operator allotment for selected dates` });
        }
      } else {
        // Use regular availability check (match by room_type_id, not name)
        const availability = getTypeAvailability(roomTypeId, checkIn, checkOut, roomsList, reservationsList, undefined, qty);
        if (!availability.can_book) {
          return res.status(409).json({ error: `Only ${availability.available} ${roomType.name} room${availability.available === 1 ? '' : 's'} available for selected dates` });
        }
      }

      const itemRoomTotal = rate * nights * qty;
      roomSubtotal += itemRoomTotal;
      const occupancies = Array.isArray(item.occupancies) && item.occupancies.length > 0
        ? item.occupancies.map((o: any) => ({ adults: Number(o.adults) || 1, children: Number(o.children) || 0 }))
        : Array.from({ length: qty }, () => ({ adults: Number(item.adults) || 1, children: Number(item.children) || 0 }));
      enrichedItems.push({ roomTypeId, roomTypeName: roomType.name, qty, rate, itemRoomTotal, adults: Number(item.adults) || 1, children: Number(item.children) || 0, occupancies });
    }

    let packageTotal = 0;
    for (const pid of packageIdsList) {
      const pkg = (packages || []).find((p: any) => p.id === pid);
      if (pkg) {
        packageTotal += Number(pkg.price) * (pkg.charge_frequency === 'daily' ? nights : 1);
      }
    }

    const shuttleRequestsList = Array.isArray(airportShuttleRequests) ? airportShuttleRequests : [];
    const shuttleQuantity = shuttleRequestsList.reduce((sum, req) => sum + (Number(req.quantity) || 0), 0);

    let guestServicesTotal = 0;
    let shuttleServiceCounted = false;
    for (const gsid of guestServiceIdsList) {
      const gs = (guestServices || []).find((g: any) => g.id === gsid);
      if (gs) {
        const isShuttle = (gs.name || '').toLowerCase().includes('airport') || (gs.name || '').toLowerCase().includes('shuttle');
        if (isShuttle) {
          if (!shuttleServiceCounted) {
            guestServicesTotal += Number(gs.price) * Math.max(1, shuttleQuantity);
            shuttleServiceCounted = true;
          }
        } else {
          guestServicesTotal += Number(gs.price);
        }
      }
    }

    const subtotal = roomSubtotal + packageTotal + guestServicesTotal;
    // Unified fee engine (compounded VAT, honors all fee components) — shared
    // with the client and the front desk so displayed == stored == invoiced.
    const fees = computeFees(subtotal, feeComponents, taxPercent, serviceChargePercent);
    const tax = fees.tax;
    const serviceCharge = fees.serviceCharge;
    const additionalFees = fees.additionalFees;
    // Voucher value comes from the database, never from the client payload.
    let voucherDiscountAmount = 0;
    let voucherNo: string | null = null;
    if (voucher_code) {
      const vc = await checkVoucher(voucher_code);
      if (!vc.ok) return res.status(vc.status).json({ error: vc.error });
      voucherNo = vc.voucher.voucher_no;
      voucherDiscountAmount = Math.min(vc.discount, subtotal + tax + serviceCharge + additionalFees);
    }
    const totalAmount = subtotal + tax + serviceCharge + additionalFees - voucherDiscountAmount;

    const totalRoomCount = enrichedItems.reduce((sum, item) => sum + item.qty, 0);
    const isGroupBooking = totalRoomCount > 1;

    // Central business rules (category "booking"): admins can block public bookings that match a rule.
    const bookingRules = await evaluateBusinessRules('booking', {
      booking: { nights, total: totalAmount, rooms: totalRoomCount, channel: 'public', groupBooking: isGroupBooking, checkIn, checkOut },
    });
    if (bookingRules.blocked.length) return res.status(422).json({ error: bookingRules.blocked.join('; ') });

    // ── Idempotency key: derived from email + dates + item fingerprint ──
    const idempotencyKey = (typeof req.headers['idempotency-key'] === 'string' && req.headers['idempotency-key'].trim().slice(0, 128))
      || `${guestEmail}::${checkIn}::${checkOut}::${enrichedItems.map(i => `${i.roomTypeName}x${i.qty}`).join(',')}::${Date.now()}`;

    // ── Single atomic RPC call — all inserts happen inside one Postgres txn ──
    const rpcPayload = {
      p_idempotency_key:   idempotencyKey,
      p_guest_name:        effectiveGuestName,
      p_guest_email:       guestEmail,
      p_guest_phone:       guestPhone || '',
      p_guest_nationality: guestNationality || '',
      p_special_requests:  specialRequests || '',
      p_check_in:          checkIn,
      p_check_out:         checkOut,
      p_items:             enrichedItems.map(i => ({
        roomTypeName: i.roomTypeName,
        roomTypeId:   i.roomTypeId,
        qty:          i.qty,
        rate:         i.rate,
        adults:       i.adults,
        children:     i.children,
        occupancies:  i.occupancies,
      })),
      p_package_ids:       packageIdsList,
      p_guest_service_ids: guestServiceIdsList,
      p_package_total:     packageTotal,
      p_guest_svc_total:   guestServicesTotal,
      p_tax_percent:       taxPercent,
      p_svc_charge_pct:    serviceChargePercent,
      p_group_name:        groupName || null,
      p_operator_id:       operator_id && typeof operator_id === 'string' ? operator_id : null,
      // Absolute fee amounts from the unified engine so the RPC stores exactly
      // what the guest was shown (compounded VAT + additional fees).
      p_tax_amount:        tax,
      p_svc_amount:        serviceCharge,
      p_addon_amount:      additionalFees,
      p_channel:           'Direct Website',
      p_status:            'Waitlisted',
    };

    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc('create_booking_atomic', rpcPayload);

    if (rpcError) {
      const msg: string = rpcError.message || '';
      const details: string = rpcError.details || '';
      const hint: string = rpcError.hint || '';
      console.error('Atomic booking RPC error:', { message: msg, details, hint, code: rpcError.code, payload: rpcPayload });
      if (msg.includes('AVAILABILITY_ERROR:')) {
        return res.status(409).json({ error: msg.replace('AVAILABILITY_ERROR:', '').trim() });
      }
      return res.status(500).json({ error: 'Booking failed. Please try again.', details: msg });
    }

    const result = rpcResult as any;
    const reservationIds: string[] = result.reservationIds || [];
    const guestIds: string[] = result.guestIds || [];
    const guestId: string = guestIds[0] || result.guestId;
    const groupBookingId: string | null = result.groupId || null;

    // Central workflows: reservation.created (non-blocking, errors are swallowed inside).
    for (const rid of reservationIds) {
      await startWorkflows('reservation.created', { entityType: 'reservation', entityId: rid, context: { nights, total: totalAmount, channel: 'public', guestEmail } });
    }

    // ── Scope the reservations to their property (create_booking_atomic doesn't set it).
    // Without this, property-scoped ERP views (Front Office, Housekeeping, reports) hide web bookings.
    try {
      const { data: created } = await supabaseAdmin.from('reservations').select('id, room_type_id, property_id').in('id', reservationIds);
      for (const r of created || []) {
        if (r.property_id) continue;
        const propertyId = roomTypesList.find((rt: any) => rt.id === r.room_type_id)?.property_id;
        if (propertyId) await supabaseAdmin.from('reservations').update({ property_id: propertyId }).eq('id', r.id);
      }
    } catch (e) {
      console.error('Failed to scope public reservations to property:', e);
    }

    // ── Auto-assign rooms to the new public reservations (individual or group) ──
    const roomAssignments: Record<string, string> = await autoAssignRoomsForPublicBookings(reservationIds, supabaseAdmin, checkIn, checkOut);

    // ── Airport shuttle requests (non-critical, outside atomic txn) ──
    const airportShuttleService = (guestServices || []).find((gs: any) => {
      const name = (gs.name || '').toLowerCase();
      return name.includes('airport') || name.includes('shuttle');
    });
    if (airportShuttleService && guestServiceIdsList.includes(airportShuttleService.id) && shuttleRequestsList.length > 0 && reservationIds.length > 0) {
      let shuttleIndex = 0;
      for (const shuttleReq of shuttleRequestsList) {
        const shuttleId = `shuttle_${Date.now()}_${shuttleIndex++}`;
        const { error: shuttleError } = await supabaseAdmin.from('airport_shuttle_requests').insert({
          id: shuttleId,
          guest_id: guestId,
          reservation_id: reservationIds[0],
          room_number: null,
          scheduled_date: shuttleReq.scheduledDate,
          scheduled_time: shuttleReq.scheduledTime,
          shuttle_type: shuttleReq.shuttleType,
          flight_number: shuttleReq.flightNumber || null,
          flight_time: shuttleReq.flightTime || null,
          status: 'Pending',
          notes: shuttleReq.notes || null,
          quantity: Math.max(1, Number(shuttleReq.quantity) || 1)
        });
        if (shuttleError) {
          console.error('Error creating airport shuttle request:', shuttleError);
        }
      }
    }

    await writeAuditEvent({
      req,
      action: isGroupBooking ? 'public_group_booking.created' : 'public_booking.created',
      entityType: isGroupBooking ? 'GroupBooking' : 'Reservation',
      entityId: groupBookingId || reservationIds[0] || guestId,
      module: 'public_booking',
      outcome: 'success',
      details: { guestEmail, reservationIds, groupBookingId, checkIn, checkOut, totalAmount, itemCount: cartItems.length, roomCount: totalRoomCount, isGroupBooking, idempotent: result.idempotent, roomAssignments }
    });

    // Handle voucher redemption if a voucher code was provided
    if (voucherNo && reservationIds[0]) {
      try {
        const { data: redeemData, error: redeemError } = await supabaseAdmin.rpc('redeem_voucher', {
          p_voucher_no: voucherNo,
          p_reservation_id: reservationIds[0],
          p_redeemed_by: 'public-booking'
        });
        if (redeemError) throw redeemError;
        const applied = Math.min(Number((redeemData as any)?.net_value) || 0, voucherDiscountAmount);
        const { data: firstRes } = await supabaseAdmin.from('reservations').select('total_amount, charges').eq('id', reservationIds[0]).single();
        if (firstRes && applied > 0) {
          const newCharges = Array.isArray(firstRes.charges) ? [...firstRes.charges] : [];
          newCharges.push({ description: `Voucher discount (${voucherNo})`, amount: -applied, date: new Date().toISOString() });
          await supabaseAdmin.from('reservations')
            .update({ total_amount: Math.max(0, Number(firstRes.total_amount) - applied), charges: newCharges })
            .eq('id', reservationIds[0]);
        }
      } catch (e) {
        // Booking already exists; surface the failure to staff instead of silently dropping it.
        console.error('Failed to redeem voucher:', e);
        await writeAuditEvent({ req, action: 'public_booking.voucher_redeem_failed', entityType: 'Reservation', entityId: reservationIds[0], module: 'public_booking', outcome: 'failure', details: { voucherNo, voucherDiscountAmount } });
      }
    }

    // Update allotment pickup log if operator is selected
    if (operator_id && allotmentAvailability.size > 0) {
      try {
        const currentDate = new Date(checkIn);
        while (currentDate < new Date(checkOut)) {
          const dateStr = currentDate.toISOString().split('T')[0];
          for (const item of enrichedItems) {
            const allotment = allotmentsList.find((a: any) =>
              a.room_type_id === item.roomTypeId &&
              a.stay_date === dateStr &&
              a.operator_id === operator_id
            );
            if (allotment) {
              await supabaseAdmin.from('allotment_pickup_log').insert({
                allotment_id: allotment.id,
                reservation_id: reservationIds[0] || groupBookingId,
                pickup_date: dateStr,
                quantity: item.qty,
                picked_up_by: 'system',
                notes: 'Auto-pickup from public booking'
              });
              // Update allotment picked_up_qty
              await supabaseAdmin.from('allotments')
                .update({ picked_up_qty: (allotment.picked_up_qty || 0) + item.qty })
                .eq('id', allotment.id);
            }
          }
          currentDate.setDate(currentDate.getDate() + 1);
        }
      } catch (e) {
        console.error('Failed to update allotment pickup log:', e);
        // Continue anyway - booking is successful even if allotment update fails
      }
    }

    return res.json({
      success: true,
      reservationIds,
      guestId,
      totalAmount,
      subtotal,
      tax,
      serviceCharge,
      additionalFees,
      voucherDiscount: voucherDiscountAmount,
      season: { name: season.name, multiplier: season.multiplier },
      ratePlan: { name: ratePlan.name, modifier: ratePlan.modifier },
      isGroupBooking,
      groupBookingId,
      status: 'Waitlisted',
      idempotent: result.idempotent || false,
      roomAssignments,
    });
  });

// Public booking payment confirmation (no auth)
router.post('/bookings/confirm-payment', publicBookingLimiter, async (req, res) => {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }
    const { reservationIds, guestEmail, paymentMethod: rawMethod, paymentDetails: rawDetails } = req.body || {};
    if (!Array.isArray(reservationIds) || reservationIds.length === 0 || reservationIds.length > 50 || !reservationIds.every((id: unknown) => typeof id === 'string')) {
      return res.status(400).json({ error: 'reservationIds is required' });
    }
    if (typeof guestEmail !== 'string' || !guestEmail.trim()) {
      return res.status(400).json({ error: 'guestEmail is required to confirm payment' });
    }
    const ALLOWED_METHODS = ['Credit Card', 'Mobile Money (Telebirr)', 'Direct Bank Transfer'];
    const paymentMethod = ALLOWED_METHODS.includes(rawMethod) ? rawMethod : 'Credit Card';
    // Whitelist non-sensitive, short fields only — never persist raw card data.
    const paymentDetails: Record<string, string> = {};
    for (const k of ['cardholderName', 'maskedCardNumber', 'phoneNumber', 'method']) {
      const v = rawDetails?.[k];
      if (typeof v === 'string' && v.length <= 64) paymentDetails[k] = v;
    }
    try {
      // 1. Only the booking's own guest may confirm, and only for pending web bookings.
      const { data: reservations, error: fetchError } = await supabaseAdmin
        .from('reservations')
        .select('id, total_amount, payments, notes, guest_email, status, channel, payment_status')
        .in('id', reservationIds);

      if (fetchError) throw fetchError;
      if (!reservations || reservations.length !== reservationIds.length) {
        return res.status(404).json({ error: 'Reservations not found' });
      }
      const email = guestEmail.trim().toLowerCase();
      if (reservations.some((r: any) => String(r.guest_email || '').toLowerCase() !== email)) {
        return res.status(403).json({ error: 'Email does not match reservation' });
      }
      if (reservations.some((r: any) => r.channel !== 'Direct Website')) {
        return res.status(403).json({ error: 'Reservation is not payable online' });
      }
      if (reservations.every((r: any) => r.payment_status === 'Paid')) {
        return res.json({ success: true, status: 'Confirmed', paymentStatus: 'Paid', alreadyPaid: true, roomAssignments: {} });
      }
      if (reservations.some((r: any) => !['Waitlisted', 'Pending', 'Reserved'].includes(r.status))) {
        return res.status(409).json({ error: 'Reservation can no longer be paid online' });
      }

      // 2. Ensure rooms are assigned before confirming payment (promotion)
      const roomAssignments = await autoAssignRoomsForPublicBookings(reservationIds, supabaseAdmin);

      // 3. Loop through and update each reservation with a payment record
      for (const r of reservations) {
        if (r.payment_status === 'Paid') continue;
        const paymentObj = {
          description: `Direct Website Deposit Payment (${paymentMethod})`,
          amount: r.total_amount,
          date: new Date().toISOString(),
          method: paymentMethod,
          details: paymentDetails
        };
        const currentPayments = Array.isArray(r.payments) ? r.payments : [];
        const updatedPayments = [...currentPayments, paymentObj];

        const paymentNote = `Website direct payment confirmed via ${paymentMethod}. Details: ${JSON.stringify(paymentDetails)}`;
        const updatedNotes = r.notes
          ? `${r.notes}\n${paymentNote}`
          : paymentNote;

        const { error: updateError } = await supabaseAdmin
          .from('reservations')
          .update({
            status: 'Confirmed',
            payment_status: 'Paid',
            payments: updatedPayments,
            notes: updatedNotes
          })
          .eq('id', r.id);

        if (updateError) throw updateError;
      }

      // 3. Write a system audit log for the payment confirmation
      await writeAuditEvent({
        req,
        action: 'public_payment.confirmed',
        entityType: 'Reservation',
        entityId: reservationIds[0],
        module: 'public_booking',
        outcome: 'success',
        details: { reservationIds, paymentMethod, roomAssignments }
      });

      return res.json({ success: true, status: 'Confirmed', paymentStatus: 'Paid', roomAssignments });
    } catch (e: any) {
      console.error('Payment confirmation error:', e);
      return res.status(500).json({ error: e.message || 'Payment confirmation failed' });
    }
  });

// Public billing calculation endpoint (no auth required for public booking portal)
router.get('/billing/calculate-breakdown', async (req, res) => {
    const { baseAmount, discountPercent, reservationId } = req.query;

    if (!baseAmount || isNaN(Number(baseAmount))) {
      return res.status(400).json({ error: 'baseAmount is required and must be a number' });
    }

    if (hasSupabaseAdminConfig && supabaseAdmin) {
      try {
        const { data, error } = await supabaseAdmin.rpc('calculate_billing_breakdown', {
          p_base_amount: Number(baseAmount),
          p_discount_percent: discountPercent ? Number(discountPercent) : 0,
          p_reservation_id: reservationId || null,
        });

        if (error) return res.status(500).json({ error: error.message });
        return res.json(data);
      } catch (error: any) {
        return res.status(500).json({ error: error.message });
      }
    }

    return res.status(503).json({ error: 'Database not configured' });
  });

// Public: Submit a pre-registration (no auth required)
router.post('/pre-registration', publicInquiryLimiter, async (req, res) => {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
    const body = req.body;
    if (!body.reservation_id || !body.guest_email || !body.guest_name) {
      return res.status(400).json({ error: 'reservation_id, guest_email, and guest_name are required' });
    }

    // Verify the reservation exists and email matches
    const { data: resData, error: resError } = await supabaseAdmin
      .from('reservations')
      .select('id, guest_email, guest_name, status')
      .eq('id', body.reservation_id)
      .single();
    if (resError || !resData) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    if (resData.guest_email?.toLowerCase() !== body.guest_email?.toLowerCase()) {
      return res.status(403).json({ error: 'Email does not match reservation' });
    }

    const { data, error } = await supabaseAdmin
      .from('pre_registrations')
      .upsert({
        reservation_id: body.reservation_id,
        guest_email: body.guest_email,
        guest_name: body.guest_name,
        guest_phone: body.guest_phone || null,
        guest_nationality: body.guest_nationality || null,
        date_of_birth: body.date_of_birth || null,
        passport_number: body.passport_number || null,
        id_type: body.id_type || 'passport',
        id_number: body.id_number || null,
        id_expiry_date: body.id_expiry_date || null,
        id_issue_date: body.id_issue_date || null,
        id_issuing_country: body.id_issuing_country || null,
        room_type_preference: body.room_type_preference || null,
        pillow_preference: body.pillow_preference || null,
        dietary_restrictions: body.dietary_restrictions || null,
        language_preference: body.language_preference || null,
        tin: body.tin || null,
        vat_no: body.vat_no || null,
        vat_date: body.vat_date || null,
        vehicle_plate: body.vehicle_plate || null,
        vehicle_make: body.vehicle_make || null,
        vehicle_model: body.vehicle_model || null,
        emergency_contact_name: body.emergency_contact_name || null,
        emergency_contact_phone: body.emergency_contact_phone || null,
        emergency_contact_relationship: body.emergency_contact_relationship || null,
        estimated_arrival_time: body.estimated_arrival_time || null,
        id_front_image_url: body.id_front_image_url || null,
        id_back_image_url: body.id_back_image_url || null,
        special_requests: body.special_requests || null,
        status: 'pending',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'reservation_id,guest_email' })
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ preRegistration: data });
  });

// Public: Check pre-registration status by reservation ID + email
router.get('/pre-registration/:reservationId', async (req, res) => {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
    const { reservationId } = req.params;
    const email = typeof req.query.email === 'string' ? req.query.email.trim() : '';
    // Pre-registrations hold ID documents — never return them on reservationId alone.
    if (!email) return res.status(400).json({ error: 'email is required' });
    const { data, error } = await supabaseAdmin.from('pre_registrations').select('*')
      .eq('reservation_id', reservationId).ilike('guest_email', email.replace(/[%_\\]/g, '\\$&')).maybeSingle();
    if (error || !data) return res.json({ preRegistration: null });
    res.json({ preRegistration: data });
  });

export default router;
