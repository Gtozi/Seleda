/**
 * Concierge Portal API Routes
 * Handles all concierge operations including guest requests, profiles, services, and vendor management
 */

import express from 'express';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { authenticate, requirePermission } from '../middleware/auth';
import { runTransportStatusSideEffects } from '../services/transportLifecycle';
import {
  conciergeRequestDefaults,
  getConciergeSettings,
  wakeupWindowError,
} from '../services/conciergeSettings';
import { canAccommodateBookings } from '../services/fbTableAllocation';

const router = express.Router();

// All concierge endpoints require a signed-in staff account.
router.use(authenticate);

// Post a charge line to the guest's open folio, creating a Guest folio when
// none exists. Shared by POST /billing/charges and the auto-post-on-complete
// path in PUT /requests/:id (service.auto-post-charges setting).
async function postConciergeFolioCharge(
  reservationId: string,
  description: string,
  amount: number,
  quantity = 1,
) {
  let { data: folio } = await supabaseAdmin!
    .from('folios')
    .select('id, balance, total_charges')
    .eq('reservation_id', reservationId)
    .eq('folio_type', 'Guest')
    .neq('status', 'Closed')
    .limit(1)
    .maybeSingle();

  if (!folio) {
    const folioId = `folio-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const { data: created, error: folioError } = await supabaseAdmin!
      .from('folios')
      .insert({ id: folioId, reservation_id: reservationId, folio_type: 'Guest', status: 'Open', balance: 0, total_charges: 0, total_payments: 0, currency: 'USD' })
      .select('id, balance, total_charges')
      .single();
    if (folioError) throw new Error(folioError.message);
    folio = created;
  }

  const { data: lastLine } = await supabaseAdmin!
    .from('folio_lines')
    .select('line_number')
    .eq('folio_id', folio.id)
    .order('line_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  const total = quantity * amount;
  const { data: line, error: lineError } = await supabaseAdmin!
    .from('folio_lines')
    .insert({
      id: `fl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      folio_id: folio.id,
      line_number: (lastLine?.line_number || 0) + 1,
      transaction_date: new Date().toISOString().slice(0, 10),
      posting_date: new Date().toISOString(),
      description,
      amount: total,
      quantity,
      unit_price: amount,
      line_type: 'ServiceCharge',
      source_module: 'concierge',
      department: 'Concierge',
      reservation_id: reservationId,
      is_voided: false,
    })
    .select()
    .single();
  if (lineError) throw new Error(lineError.message);

  await supabaseAdmin!
    .from('folios')
    .update({
      balance: Number(folio.balance || 0) + total,
      total_charges: Number(folio.total_charges || 0) + total,
      updated_at: new Date().toISOString(),
    })
    .eq('id', folio.id);

  return line;
}

// Controlled vocabularies — these columns are free text in Postgres, so values
// are whitelisted at the API boundary to keep queue filters reliable.
const GUEST_REQUEST_STATUSES = ['Open', 'Assigned', 'In Progress', 'Waiting', 'Completed', 'Cancelled'];
const GUEST_REQUEST_PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];
// Mirrors the CHECK constraints on guest_communications and transport_requests.
const COMMUNICATION_MESSAGE_TYPES = ['Request', 'Booking', 'Inquiry', 'Complaint', 'Other'];
const TRANSPORT_REQUEST_TYPES = [
  'Airport Pickup', 'Airport Drop-off', 'City Transfer', 'Hotel Shuttle',
  'Sightseeing Tour', 'VIP Transport', 'Staff Shuttle', 'Courier Service',
];

// ============================================================================
// DASHBOARD ENDPOINTS
// ============================================================================

// Get KPI data for dashboard
router.get('/dashboard/kpi', async (_req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    // Get active guest requests
    const { count: activeRequestsCount } = await supabaseAdmin
      .from('guest_requests')
      .select('*', { count: 'exact', head: true })
      .in('status', ['Open', 'In Progress', 'Assigned'])
      .eq('assigned_department', 'Concierge');

    // Get open concierge tasks
    const { count: openTasksCount } = await supabaseAdmin
      .from('guest_requests')
      .select('*', { count: 'exact', head: true })
      .in('status', ['Open', 'Assigned'])
      .eq('assigned_department', 'Concierge');

    // Active transport jobs — the Transportation module works the
    // transport_requests dispatch queue, not guest_requests.
    const { count: transportationCount } = await supabaseAdmin
      .from('transport_requests')
      .select('*', { count: 'exact', head: true })
      .in('status', ['Requested', 'Confirmed', 'Assigned', 'Driver En Route', 'Guest Picked Up', 'In Progress']);

    // Get restaurant reservations
    const { count: restaurantCount } = await supabaseAdmin
      .from('guest_requests')
      .select('*', { count: 'exact', head: true })
      .eq('request_type', 'Restaurant Booking')
      .in('status', ['Open', 'In Progress', 'Assigned']);

    // Get tour bookings
    const { count: toursCount } = await supabaseAdmin
      .from('guest_requests')
      .select('*', { count: 'exact', head: true })
      .eq('request_type', 'Tour Booking')
      .in('status', ['Open', 'In Progress', 'Assigned']);

    // Get pending deliveries
    const { count: deliveriesCount } = await supabaseAdmin
      .from('guest_requests')
      .select('*', { count: 'exact', head: true })
      .in('request_type', ['Luggage', 'Package'])
      .in('status', ['Open', 'Assigned']);

    // Calculate satisfaction score
    const { data: satisfactionData } = await supabaseAdmin
      .from('guest_requests')
      .select('rating')
      .not('rating', 'is', null)
      .eq('assigned_department', 'Concierge');

    const avgRating = satisfactionData && satisfactionData.length > 0
      ? satisfactionData.reduce((sum, r) => sum + (r.rating || 0), 0) / satisfactionData.length
      : 0;

    // VIP guests in house — VIP guests holding a CheckedIn reservation
    const { data: inHouse } = await supabaseAdmin
      .from('reservations')
      .select('guest_id')
      .eq('status', 'CheckedIn');
    const inHouseGuestIds = [...new Set((inHouse || []).map((r: any) => r.guest_id).filter(Boolean))];
    let vipInHouse = 0;
    if (inHouseGuestIds.length > 0) {
      const { count } = await supabaseAdmin
        .from('guests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'VIP')
        .in('id', inHouseGuestIds);
      vipInHouse = count || 0;
    }

    // Average response time — submitted_at → acknowledged_at (minutes)
    const { data: acked } = await supabaseAdmin
      .from('guest_requests')
      .select('submitted_at, acknowledged_at')
      .eq('assigned_department', 'Concierge')
      .not('acknowledged_at', 'is', null)
      .not('submitted_at', 'is', null);
    const responseMins = (acked || [])
      .map((r: any) => (new Date(r.acknowledged_at).getTime() - new Date(r.submitted_at).getTime()) / 60000)
      .filter((m: number) => isFinite(m) && m >= 0);
    const avgResponse = responseMins.length
      ? Math.round(responseMins.reduce((a, b) => a + b, 0) / responseMins.length)
      : 0;

    // Service completion rate — completed / total concierge requests
    const { count: totalRequests } = await supabaseAdmin
      .from('guest_requests')
      .select('*', { count: 'exact', head: true })
      .eq('assigned_department', 'Concierge');
    const { count: completedRequests } = await supabaseAdmin
      .from('guest_requests')
      .select('*', { count: 'exact', head: true })
      .eq('assigned_department', 'Concierge')
      .eq('status', 'Completed');
    const completionRate = totalRequests
      ? Math.round(((completedRequests || 0) / totalRequests) * 100)
      : 0;

    // Overdue open requests — past the escalation threshold from portal settings
    const { data: escSetting } = await supabaseAdmin
      .from('concierge_settings')
      .select('value')
      .eq('id', 'requests.escalation-threshold')
      .maybeSingle();
    const escalationMins = Number(escSetting?.value?.minutes) || 45;
    const escalationCutoff = new Date(Date.now() - escalationMins * 60000).toISOString();
    const { count: overdueCount } = await supabaseAdmin
      .from('guest_requests')
      .select('*', { count: 'exact', head: true })
      .eq('assigned_department', 'Concierge')
      .in('status', ['Open', 'Assigned'])
      .lt('submitted_at', escalationCutoff);

    res.json({
      activeGuestRequests: activeRequestsCount || 0,
      vipGuestsInHouse: vipInHouse,
      openConciergeTasks: openTasksCount || 0,
      transportationRequests: transportationCount || 0,
      restaurantReservations: restaurantCount || 0,
      tourBookings: toursCount || 0,
      pendingDeliveries: deliveriesCount || 0,
      guestSatisfactionScore: Math.round(avgRating * 10) / 10,
      averageResponseTime: avgResponse,
      serviceCompletionRate: completionRate,
      overdueRequests: overdueCount || 0,
      escalationThreshold: escalationMins
    });
  } catch (error) {
    console.error('Error fetching dashboard KPI:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard KPI data' });
  }
});

// Get real-time alerts
router.get('/dashboard/alerts', async (_req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const settings = await getConciergeSettings([
      'notifications.enable-alerts',
      'requests.escalation-threshold',
      'requests.response-target',
      'vendors.min-rating',
    ]);
    // notifications.enable-alerts: master switch for the desk alert feed.
    if (settings['notifications.enable-alerts']?.enabled === false) {
      return res.json([]);
    }

    const alerts: any[] = [];
    const today = new Date().toISOString().split('T')[0];

    // ── VIP arrivals today ────────────────────────────────────────────
    const { data: arrivals } = await supabaseAdmin
      .from('reservations')
      .select('id, guest_id, guest_name, room_number, check_in_date, status')
      .eq('check_in_date', today)
      .in('status', ['Confirmed', 'CheckedIn']);
    const arrivalGuestIds = [...new Set((arrivals || []).map((r: any) => r.guest_id).filter(Boolean))];
    let vipIds = new Set<string>();
    if (arrivalGuestIds.length > 0) {
      const { data: vipGuests } = await supabaseAdmin
        .from('guests').select('id').eq('status', 'VIP').in('id', arrivalGuestIds);
      vipIds = new Set((vipGuests || []).map((g: any) => g.id));
    }
    for (const res of arrivals || []) {
      if (!vipIds.has(res.guest_id)) continue;
      alerts.push({
        id: `ALT-VIP-${res.id}`,
        type: 'VIP Arrival',
        message: `VIP guest ${res.guest_name || 'arriving'} ${res.status === 'CheckedIn' ? 'checked in to' : 'expected in'} Room ${res.room_number || 'TBA'} today`,
        severity: 'Warning',
        timestamp: res.check_in_date,
        guestId: res.guest_id
      });
    }

    // ── Urgent / high-priority concierge requests ─────────────────────
    const { data: urgentRequests } = await supabaseAdmin
      .from('guest_requests')
      .select('*')
      .eq('assigned_department', 'Concierge')
      .in('priority', ['Urgent', 'High'])
      .in('status', ['Open', 'Assigned'])
      .order('submitted_at', { ascending: false })
      .limit(10);

    urgentRequests?.forEach(req => {
      alerts.push({
        id: `ALT-REQ-${req.id}`,
        type: 'Urgent Guest Request',
        message: `${req.guest_name} in Room ${req.room_number}: ${req.description}`,
        severity: req.priority === 'Urgent' ? 'Critical' : 'Warning',
        timestamp: req.submitted_at,
        requestId: req.id
      });
    });

    // ── Overdue open requests (past escalation threshold) ─────────────
    const escalationMins = Number(settings['requests.escalation-threshold']?.minutes) || 45;
    const cutoff = new Date(Date.now() - escalationMins * 60000).toISOString();
    const { data: overdue } = await supabaseAdmin
      .from('guest_requests')
      .select('id, guest_name, room_number, request_type, description, submitted_at')
      .eq('assigned_department', 'Concierge')
      .in('status', ['Open', 'Assigned'])
      .lt('submitted_at', cutoff)
      .order('submitted_at', { ascending: true })
      .limit(5);
    overdue?.forEach(req => {
      alerts.push({
        id: `ALT-ODR-${req.id}`,
        type: 'Overdue Request',
        message: `${req.request_type} for ${req.guest_name} in Room ${req.room_number} open past the ${escalationMins}-minute escalation threshold`,
        severity: 'Critical',
        timestamp: req.submitted_at,
        requestId: req.id
      });
    });

    // ── Package arrivals awaiting delivery ────────────────────────────
    const { data: packages } = await supabaseAdmin
      .from('guest_requests')
      .select('id, guest_name, room_number, description, submitted_at')
      .eq('assigned_department', 'Concierge')
      .eq('request_type', 'Package')
      .in('status', ['Open', 'Assigned'])
      .order('submitted_at', { ascending: false })
      .limit(5);
    packages?.forEach(req => {
      alerts.push({
        id: `ALT-PKG-${req.id}`,
        type: 'Package Arrival',
        message: `Package for ${req.guest_name} in Room ${req.room_number}: ${req.description}`,
        severity: 'Info',
        timestamp: req.submitted_at,
        requestId: req.id
      });
    });

    // ── Upcoming wake-up / reminder calls ─────────────────────────────
    const { data: wakeUps } = await supabaseAdmin
      .from('guest_requests')
      .select('id, guest_name, room_number, description, notes, submitted_at')
      .eq('assigned_department', 'Concierge')
      .eq('request_type', 'Wake-up Call')
      .in('status', ['Open', 'Assigned'])
      .order('submitted_at', { ascending: false })
      .limit(5);
    wakeUps?.forEach(req => {
      alerts.push({
        id: `ALT-WU-${req.id}`,
        type: 'Wake-up Call',
        message: `${req.description}${req.notes ? ` — ${req.notes}` : ''} (${req.guest_name}, Room ${req.room_number})`,
        severity: 'Info',
        timestamp: req.submitted_at,
        requestId: req.id
      });
    });

    // ── Unacknowledged requests past the response-time target ─────────
    const responseTargetMins = Number(settings['requests.response-target']?.minutes) || 0;
    if (responseTargetMins > 0) {
      const ackCutoff = new Date(Date.now() - responseTargetMins * 60000).toISOString();
      const { data: unacked } = await supabaseAdmin
        .from('guest_requests')
        .select('id, guest_name, room_number, request_type, submitted_at')
        .eq('assigned_department', 'Concierge')
        .eq('status', 'Open')
        .is('acknowledged_at', null)
        .lt('submitted_at', ackCutoff)
        .order('submitted_at', { ascending: true })
        .limit(5);
      unacked?.forEach(req => {
        alerts.push({
          id: `ALT-RT-${req.id}`,
          type: 'Response Overdue',
          message: `${req.request_type} for ${req.guest_name} in Room ${req.room_number} unacknowledged past the ${responseTargetMins}-minute target`,
          severity: 'Warning',
          timestamp: req.submitted_at,
          requestId: req.id
        });
      });
    }

    // ── Vendors below the configured minimum rating ───────────────────
    // The rating column arrives with migration 598; on older schemas the
    // query errors and vendors are simply not flagged.
    const minVendorRating = Number(settings['vendors.min-rating']?.rating);
    if (Number.isFinite(minVendorRating)) {
      const { data: lowVendors } = await supabaseAdmin
        .from('vendors')
        .select('id, name, rating')
        .eq('source', 'Concierge')
        .eq('status', 'Active')
        .not('rating', 'is', null)
        .lt('rating', minVendorRating)
        .order('rating', { ascending: true })
        .limit(5);
      lowVendors?.forEach(v => {
        alerts.push({
          id: `ALT-VND-${v.id}`,
          type: 'Vendor Review',
          message: `Vendor ${v.name} rated ${v.rating}/5 — below the ${minVendorRating} minimum`,
          severity: 'Warning',
          timestamp: today
        });
      });
    }

    res.json(alerts.slice(0, 20));
  } catch (error) {
    console.error('Error fetching dashboard alerts:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard alerts' });
  }
});

// ============================================================================
// GUEST REQUESTS ENDPOINTS
// ============================================================================

// Get all guest requests with filtering
router.get('/requests', async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const { status, priority, request_type, department, search, limit = 100 } = req.query;
    const cappedLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);

    let query = supabaseAdmin.from('guest_requests').select('*');

    if (status) query = query.eq('status', status);
    if (priority) query = query.eq('priority', priority);
    if (request_type) query = query.eq('request_type', request_type);
    if (department) query = query.eq('assigned_department', department);
    if (search) {
      const escaped = String(search).replace(/[%,_]/g, '');
      query = query.or(`guest_name.ilike.%${escaped}%,request_number.ilike.%${escaped}%,room_number.ilike.%${escaped}%,request_type.ilike.%${escaped}%,description.ilike.%${escaped}%`);
    }

    query = query.order('submitted_at', { ascending: false }).limit(cappedLimit);

    const { data, error } = await query;

    if (error) return res.status(500).json({ error: error.message });

    // No FK exists on guest_requests.reservation_id, so resolve guest_id with
    // a batch lookup instead of a PostgREST embed.
    const resIds = [...new Set((data || []).map((r: any) => r.reservation_id).filter(Boolean))];
    const resById = new Map<string, any>();
    if (resIds.length > 0) {
      const { data: resv } = await supabaseAdmin
        .from('reservations')
        .select('id, guest_id')
        .in('id', resIds);
      (resv || []).forEach((r: any) => resById.set(r.id, r));
    }

    res.json((data || []).map((r: any) => ({
      ...r,
      guest_id: resById.get(r.reservation_id)?.guest_id || null,
    })));
  } catch (error) {
    console.error('Error fetching guest requests:', error);
    res.status(500).json({ error: 'Failed to fetch guest requests' });
  }
});

// Get single guest request by ID
router.get('/requests/:id', async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from('guest_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Guest request not found' });

    // Resolve the linked reservation for guest-profile navigation.
    let guest_id: string | null = null;
    let reservation: any = null;
    if (data.reservation_id) {
      const { data: resv } = await supabaseAdmin
        .from('reservations')
        .select('id, guest_id, room_type, check_in_date, check_out_date, status')
        .eq('id', data.reservation_id)
        .maybeSingle();
      reservation = resv || null;
      guest_id = resv?.guest_id || null;
    }

    res.json({ ...data, guest_id, reservation });
  } catch (error) {
    console.error('Error fetching guest request:', error);
    res.status(500).json({ error: 'Failed to fetch guest request' });
  }
});

// Create new guest request
router.post('/requests', requirePermission('concierge:requests:manage'), async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const {
      reservation_id,
      room_number,
      guest_name,
      request_type,
      description,
      priority,
      assigned_to,
      assigned_department,
      notes,
      scheduled_for
    } = req.body;

    if (!request_type || !String(request_type).trim()) {
      return res.status(400).json({ error: 'request_type is required' });
    }
    if (!description || !String(description).trim()) {
      return res.status(400).json({ error: 'description is required' });
    }
    if (scheduled_for && Number.isNaN(new Date(scheduled_for).getTime())) {
      return res.status(400).json({ error: 'Invalid scheduled_for' });
    }
    if (priority !== undefined && !GUEST_REQUEST_PRIORITIES.includes(String(priority))) {
      return res.status(400).json({ error: `priority must be one of: ${GUEST_REQUEST_PRIORITIES.join(', ')}` });
    }

    // Resolve the property so desk-hours/wake-up windows evaluate in the
    // property's timezone and roster-based auto-assign is property-scoped.
    let propertyId: string | null = (req as any).user?.propertyId || null;
    if (!propertyId && reservation_id) {
      const { data: resv } = await supabaseAdmin
        .from('reservations')
        .select('property_id')
        .eq('id', reservation_id)
        .maybeSingle();
      propertyId = resv?.property_id || null;
    }

    // Wake-up calls must land inside the configured scheduling window.
    const windowError = await wakeupWindowError(request_type, scheduled_for, propertyId);
    if (windowError) return res.status(400).json({ error: windowError });

    // Apply portal defaults: configured default priority, desk-hours
    // routing to the Duty Manager, and least-loaded auto-assign.
    const defaults = await conciergeRequestDefaults({ priority, assignedTo: assigned_to, propertyId });

    const request_number = `REQ-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

    const { data, error } = await supabaseAdmin
      .from('guest_requests')
      .insert({
        request_number,
        reservation_id,
        property_id: propertyId,
        room_number,
        guest_name,
        request_type,
        description,
        priority: defaults.priority,
        assigned_to: defaults.assignedTo,
        assigned_department,
        notes,
        scheduled_for: scheduled_for || null
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.status(201).json(data);
  } catch (error) {
    console.error('Error creating guest request:', error);
    res.status(500).json({ error: 'Failed to create guest request' });
  }
});

// Create a restaurant reservation in the real F&B book (fb_table_reservations)
// plus a guest_requests audit row so it still appears in the concierge queue.
router.post('/restaurant-reservations', requirePermission('concierge:requests:manage'), async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const { reservation_id, outlet_id, arrival_time, party_size, special_requests, duration } = req.body || {};

    if (!reservation_id) return res.status(400).json({ error: 'reservation_id is required' });
    if (!outlet_id) return res.status(400).json({ error: 'outlet_id is required' });
    const party = Math.floor(Number(party_size));
    if (!Number.isFinite(party) || party < 1 || party > 50) {
      return res.status(400).json({ error: 'party_size must be between 1 and 50' });
    }
    const arrival = new Date(arrival_time);
    if (Number.isNaN(arrival.getTime())) {
      return res.status(400).json({ error: 'arrival_time must be a valid datetime' });
    }
    const dur = Math.min(Math.max(Number(duration) || 120, 15), 480);

    const { data: resv } = await supabaseAdmin
      .from('reservations')
      .select('id, guest_id, guest_name, room_number, property_id')
      .eq('id', reservation_id)
      .maybeSingle();
    if (!resv) return res.status(404).json({ error: 'Reservation not found' });

    const { data: outlet } = await supabaseAdmin
      .from('outlets')
      .select('id, name, type, is_active')
      .eq('id', outlet_id)
      .maybeSingle();
    if (!outlet || !outlet.is_active) {
      return res.status(404).json({ error: 'Outlet not found or inactive' });
    }

    // Table-identity-aware capacity check: simulate assigning every booking
    // in the surrounding window (plus this one) to real tables — the slot is
    // full only when no feasible placement exists.
    const { data: tables } = await supabaseAdmin
      .from('fb_tables')
      .select('id, seats')
      .eq('outlet_id', outlet.id)
      .eq('is_active', true);

    if ((tables || []).length > 0) {
      const windowStart = new Date(arrival.getTime() - 12 * 3600 * 1000).toISOString();
      const windowEnd = new Date(arrival.getTime() + 12 * 3600 * 1000).toISOString();
      const { data: nearby } = await supabaseAdmin
        .from('fb_table_reservations')
        .select('id, arrival_time, duration, party_size')
        .eq('outlet_id', outlet.id)
        .in('status', ['confirmed', 'seated'])
        .gte('arrival_time', windowStart)
        .lte('arrival_time', windowEnd);
      const feasible = canAccommodateBookings(tables || [], [
        ...(nearby || []),
        { party_size: party, arrival_time: arrival.toISOString(), duration: dur },
      ]);
      if (!feasible) {
        return res.status(409).json({ error: `${outlet.name} is fully booked at that time` });
      }
    }

    const { data: booking, error: bookingError } = await supabaseAdmin
      .from('fb_table_reservations')
      .insert({
        outlet_id: outlet.id,
        table_id: null,
        reservation_id: resv.id,
        guest_name: resv.guest_name,
        party_size: party,
        arrival_time: arrival.toISOString(),
        duration: dur,
        status: 'confirmed',
        special_requests: special_requests ? String(special_requests).slice(0, 1000) : null,
        confirmed_by: req.user?.name || req.user?.id || null,
        booked_via: 'concierge',
      })
      .select()
      .single();
    if (bookingError) return res.status(500).json({ error: bookingError.message });

    // Audit row for the concierge queue/history — the booking itself is
    // complete, so the request is closed with the fb reservation id in notes.
    const request_number = `REQ-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
    const { data: request, error: requestError } = await supabaseAdmin
      .from('guest_requests')
      .insert({
        request_number,
        reservation_id: resv.id,
        property_id: resv.property_id || null,
        room_number: resv.room_number || null,
        guest_name: resv.guest_name,
        request_type: 'Restaurant Booking',
        description: `${outlet.name} · ${arrival.toLocaleString('en-US')} · ${party} guest${party > 1 ? 's' : ''}`,
        priority: 'Normal',
        status: 'Completed',
        assigned_department: 'Concierge',
        assigned_to: req.user?.name || null,
        notes: `fb_table_reservations:${booking.id}`,
        scheduled_for: arrival.toISOString(),
        completed_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (requestError) {
      console.error('Restaurant booking created but audit row failed:', requestError);
    }

    res.status(201).json({ booking, request: request || null });
  } catch (error) {
    console.error('Error creating restaurant reservation:', error);
    res.status(500).json({ error: 'Failed to create restaurant reservation' });
  }
});

// Update guest request
router.put('/requests/:id', requirePermission('concierge:requests:manage'), async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const { id } = req.params;
    const {
      status,
      priority,
      assigned_to,
      assigned_department,
      acknowledged_at,
      completed_at,
      notes,
      rating,
      feedback,
      scheduled_for
    } = req.body;

    if (rating !== undefined && rating !== null) {
      const r = Number(rating);
      if (!Number.isInteger(r) || r < 1 || r > 5) {
        return res.status(400).json({ error: 'rating must be an integer between 1 and 5' });
      }
    }
    // guest_requests.status/priority are unconstrained text columns — a typo
    // would silently drop the row out of every filtered queue, so whitelist here.
    if (status !== undefined && !GUEST_REQUEST_STATUSES.includes(String(status))) {
      return res.status(400).json({ error: `status must be one of: ${GUEST_REQUEST_STATUSES.join(', ')}` });
    }
    if (priority !== undefined && !GUEST_REQUEST_PRIORITIES.includes(String(priority))) {
      return res.status(400).json({ error: `priority must be one of: ${GUEST_REQUEST_PRIORITIES.join(', ')}` });
    }
    if (scheduled_for !== undefined && scheduled_for !== null && Number.isNaN(new Date(scheduled_for).getTime())) {
      return res.status(400).json({ error: 'Invalid scheduled_for' });
    }

    const { data: existing } = await supabaseAdmin
      .from('guest_requests')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Guest request not found' });

    const updateData: any = { updated_at: new Date().toISOString() };
    if (status !== undefined) updateData.status = status;
    if (priority !== undefined) updateData.priority = priority;
    if (assigned_to !== undefined) updateData.assigned_to = assigned_to;
    if (assigned_department !== undefined) updateData.assigned_department = assigned_department;
    if (acknowledged_at !== undefined) updateData.acknowledged_at = acknowledged_at;
    if (completed_at !== undefined) updateData.completed_at = completed_at;
    if (notes !== undefined) updateData.notes = notes;
    if (rating !== undefined) updateData.rating = rating;
    if (feedback !== undefined) updateData.feedback = feedback;
    if (scheduled_for !== undefined) updateData.scheduled_for = scheduled_for;

    const { data, error } = await supabaseAdmin
      .from('guest_requests')
      .update(updateData)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Guest request not found' });

    // Auto-post the linked catalog service's price to the guest folio when a
    // request transitions to Completed and service.auto-post-charges is on.
    // The service is resolved by the "{service} · {details}" description
    // convention; idempotent via a request_number marker on the folio line.
    let postedCharge: any = null;
    if (data.status === 'Completed' && existing.status !== 'Completed' && data.reservation_id) {
      try {
        const { data: setting } = await supabaseAdmin
          .from('concierge_settings')
          .select('value')
          .eq('id', 'service.auto-post-charges')
          .maybeSingle();
        if (setting?.value?.enabled === true) {
          const serviceName = String(data.description || '').split('·')[0].trim();
          const { data: svc } = serviceName
            ? await supabaseAdmin
                .from('guest_services')
                .select('id, name, price')
                .ilike('name', serviceName.replace(/[%_,]/g, ''))
                .limit(1)
                .maybeSingle()
            : { data: null };
          const price = Number(svc?.price) || 0;
          if (svc && price > 0) {
            const marker = String(data.request_number || data.id).replace(/[%_,]/g, '');
            const { data: dup } = await supabaseAdmin
              .from('folio_lines')
              .select('id')
              .eq('reservation_id', data.reservation_id)
              .eq('source_module', 'concierge')
              .eq('is_voided', false)
              .ilike('description', `%${marker}%`)
              .limit(1)
              .maybeSingle();
            if (!dup) {
              postedCharge = await postConciergeFolioCharge(
                data.reservation_id,
                `${svc.name} (${marker})`,
                price,
                1,
              );
            }
          }
        }
      } catch (e) {
        // The status change already succeeded — a posting failure must not
        // fail the request update; it is surfaced on the response instead.
        console.error('Auto-post charge failed:', e);
        return res.json({ ...data, charge_error: 'Folio charge posting failed' });
      }
    }

    res.json(postedCharge ? { ...data, posted_charge: postedCharge } : data);
  } catch (error) {
    console.error('Error updating guest request:', error);
    res.status(500).json({ error: 'Failed to update guest request' });
  }
});

// ============================================================================
// GUEST PROFILES ENDPOINTS
// ============================================================================

const STAY_STATUSES = ['Confirmed', 'CheckedIn', 'CheckedOut'];

// Loyalty tier thresholds — mirrors /api/front-office/guests so every portal
// shows the same tier for the same guest.
function loyaltyTierFor(points: number): string {
  if (points >= 10000) return 'diamond';
  if (points >= 5000) return 'platinum';
  if (points >= 2500) return 'gold';
  if (points >= 1000) return 'silver';
  return 'bronze';
}

function stayFrequencyFor(totalStays: number): string {
  if (totalStays >= 10) return 'Regular';
  if (totalStays >= 5) return 'Frequent';
  return 'Occasional';
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const n = Math.ceil((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000);
  return isFinite(n) && n > 0 ? n : 0;
}

function shapeGuestListItem(guest: any, stays: any[]) {
  const preferences = guest.preferences || {};
  const totalStays = stays.length;
  const totalNights = stays.reduce((s, r) => s + nightsBetween(r.check_in_date, r.check_out_date), 0);
  const lastStay = stays
    .map((r: any) => r.check_in_date)
    .sort()
    .pop() || null;
  const currentStay = stays.find((r: any) => r.status === 'CheckedIn');

  return {
    id: guest.id,
    name: guest.name,
    email: guest.email,
    phone: guest.phone || '',
    nationality: guest.nationality || '',
    status: guest.status || 'Regular',
    isVIP: guest.status === 'VIP',
    loyaltyTier: loyaltyTierFor(guest.loyalty_points || 0),
    loyaltyPoints: guest.loyalty_points || 0,
    totalSpend: Number(guest.total_spend || 0),
    totalStays,
    totalNights,
    lastStay,
    currentRoom: currentStay?.room_number || null,
    roomPreference: preferences.roomType || null,
    dietary: preferences.dietary || null,
  };
}

// Get guest profile — guest record + current stay + stay history +
// concierge request history, all from real tables.
router.get('/guests/:id', async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const { id } = req.params;
    const { data: guest, error } = await supabaseAdmin
      .from('guests')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !guest) return res.status(404).json({ error: 'Guest not found' });

    const { data: stays, error: staysError } = await supabaseAdmin
      .from('reservations')
      .select('*')
      .eq('guest_id', id)
      .in('status', STAY_STATUSES)
      .order('check_in_date', { ascending: false });

    if (staysError) return res.status(500).json({ error: staysError.message });

    const reservationIds = (stays || []).map((r: any) => r.id);
    const requestFilters = [`guest_name.eq."${String(guest.name || '').replace(/"/g, '')}"`];
    if (reservationIds.length > 0) {
      requestFilters.push(`reservation_id.in.(${reservationIds.join(',')})`);
    }

    const { data: requests, error: requestsError } = await supabaseAdmin
      .from('guest_requests')
      .select('*')
      .or(requestFilters.join(','))
      .order('submitted_at', { ascending: false })
      .limit(20);

    if (requestsError) return res.status(500).json({ error: requestsError.message });

    const totalStays = (stays || []).length;
    const totalNights = (stays || []).reduce((s: number, r: any) => s + nightsBetween(r.check_in_date, r.check_out_date), 0);
    const currentReservation = (stays || []).find((r: any) => r.status === 'CheckedIn') || null;
    const openRequests = (requests || []).filter((r: any) => OPEN_REQUEST_STATUSES.includes(r.status));

    res.json({
      guest: shapeGuestListItem(guest, stays || []),
      rawGuest: guest,
      preferences: guest.preferences || {},
      identificationDoc: guest.identification_doc || {},
      specialRequests: guest.special_requests || '',
      notes: guest.notes || '',
      currentReservation,
      stays: stays || [],
      stats: {
        totalStays,
        totalNights,
        totalSpend: Number(guest.total_spend || 0),
        lastStay: stays && stays[0] ? stays[0].check_in_date : null,
        stayFrequency: stayFrequencyFor(totalStays),
        loyaltyTier: loyaltyTierFor(guest.loyalty_points || 0),
        loyaltyPoints: guest.loyalty_points || 0,
      },
      requests: {
        total: (requests || []).length,
        open: openRequests.length,
        items: (requests || []).map((r: any) => ({
          id: r.id,
          requestNumber: r.request_number,
          type: r.request_type,
          description: r.description,
          status: r.status,
          priority: r.priority,
          assignedTo: r.assigned_to,
          submittedAt: r.submitted_at,
          rating: r.rating,
          feedback: r.feedback,
        })),
      },
    });
  } catch (error) {
    console.error('Error fetching guest profile:', error);
    res.status(500).json({ error: 'Failed to fetch guest profile' });
  }
});

// Search / list guests — same data source as /api/front-office/guests,
// shaped for the concierge profile browser.
router.get('/guests', async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const { search, status, limit = 100 } = req.query;

    let query = supabaseAdmin
      .from('guests')
      .select('*')
      .order('name', { ascending: true })
      .limit(Number(limit));

    if (search) {
      const escaped = String(search).replace(/,/g, '');
      query = query.or(`name.ilike.%${escaped}%,email.ilike.%${escaped}%,phone.ilike.%${escaped}%`);
    }
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    // Aggregate stays per guest in one query instead of N+1 lookups.
    const guestIds = (data || []).map((g: any) => g.id);
    const { data: stays } = guestIds.length
      ? await supabaseAdmin
          .from('reservations')
          .select('guest_id, check_in_date, check_out_date, room_number, status')
          .in('guest_id', guestIds)
          .in('status', STAY_STATUSES)
      : { data: [] };

    const staysByGuest = new Map<string, any[]>();
    (stays || []).forEach((r: any) => {
      const list = staysByGuest.get(r.guest_id) || [];
      list.push(r);
      staysByGuest.set(r.guest_id, list);
    });

    res.json((data || []).map((g: any) => shapeGuestListItem(g, staysByGuest.get(g.id) || [])));
  } catch (error) {
    console.error('Error searching guests:', error);
    res.status(500).json({ error: 'Failed to search guests' });
  }
});

// ============================================================================
// GUEST SERVICE CENTER ENDPOINTS
// ============================================================================

const OPEN_REQUEST_STATUSES = ['Open', 'Assigned', 'In Progress'];

interface OpenRequestCounts {
  byReservation: Map<string, number>;
  byRoom: Map<string, number>;
}

// Count open guest_requests per reservation and per room so the service
// center can show a real "open requests" badge per guest.
async function fetchOpenRequestCounts(): Promise<OpenRequestCounts> {
  const { data, error } = await supabaseAdmin!
    .from('guest_requests')
    .select('reservation_id, room_number')
    .in('status', OPEN_REQUEST_STATUSES);

  if (error) throw new Error(error.message);

  const byReservation = new Map<string, number>();
  const byRoom = new Map<string, number>();
  (data || []).forEach((r: any) => {
    if (r.reservation_id) {
      byReservation.set(r.reservation_id, (byReservation.get(r.reservation_id) || 0) + 1);
    }
    if (r.room_number) {
      byRoom.set(r.room_number, (byRoom.get(r.room_number) || 0) + 1);
    }
  });
  return { byReservation, byRoom };
}

// Shape a reservations row (joined with guests) into the service-center
// guest contract the frontend renders.
function shapeServiceCenterGuest(row: any, status: string, counts: OpenRequestCounts) {
  const guestStatus = row.guests?.status || row.guest_status || 'Regular';
  const openRequests = counts.byReservation.get(row.id) ?? counts.byRoom.get(row.room_number) ?? 0;
  return {
    id: row.guest_id || row.id,
    reservationId: row.id,
    name: row.guest_name || row.guests?.name || 'Guest',
    roomNumber: row.room_number || 'TBD',
    status,
    isVIP: guestStatus === 'VIP',
    checkInDate: row.check_in_date,
    checkOutDate: row.check_out_date,
    loyaltyStatus: guestStatus,
    openRequests
  };
}

function shapeQueueRequest(row: any) {
  return {
    id: row.id,
    requestNumber: row.request_number,
    guestName: row.guest_name,
    roomNumber: row.room_number,
    type: row.request_type,
    description: row.description,
    priority: String(row.priority || 'Normal').toLowerCase(),
    status: String(row.status || 'Open').toLowerCase().replace(' ', '-'),
    assignedTo: row.assigned_to || null,
    requestedAt: row.submitted_at
  };
}

// Combined overview — one round trip returns every service-center list so
// tab counts stay accurate regardless of which tab is selected.
router.get('/service-center/overview', async (_req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const today = new Date().toISOString().split('T')[0];
    const counts = await fetchOpenRequestCounts();

    const [inHouseRes, arrivingRes, departingRes, queueRes] = await Promise.all([
      supabaseAdmin
        .from('reservations')
        .select('*, guests(*)')
        .eq('status', 'CheckedIn')
        .order('check_in_date', { ascending: false }),
      supabaseAdmin
        .from('reservations')
        .select('*, guests(*)')
        .eq('check_in_date', today)
        .in('status', ['Confirmed', 'Reserved', 'Waitlisted'])
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('reservations')
        .select('*, guests(*)')
        .eq('check_out_date', today)
        .eq('status', 'CheckedIn')
        .order('check_out_date', { ascending: false }),
      supabaseAdmin
        .from('guest_requests')
        .select('*')
        .in('status', OPEN_REQUEST_STATUSES)
        .eq('assigned_department', 'Concierge')
        .order('submitted_at', { ascending: true })
        .limit(50),
    ]);

    const firstError = inHouseRes.error || arrivingRes.error || departingRes.error || queueRes.error;
    if (firstError) return res.status(500).json({ error: firstError.message });

    res.json({
      inHouse: (inHouseRes.data || []).map((row: any) => shapeServiceCenterGuest(row, 'in-house', counts)),
      arriving: (arrivingRes.data || []).map((row: any) => shapeServiceCenterGuest(row, 'arriving', counts)),
      departing: (departingRes.data || []).map((row: any) => shapeServiceCenterGuest(row, 'departing', counts)),
      queue: (queueRes.data || []).map(shapeQueueRequest),
    });
  } catch (error) {
    console.error('Error fetching service center overview:', error);
    res.status(500).json({ error: 'Failed to fetch service center overview' });
  }
});

// Get in-house guests
router.get('/service-center/in-house', async (_req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const counts = await fetchOpenRequestCounts();
    const { data, error } = await supabaseAdmin
      .from('reservations')
      .select('*, guests(*)')
      .eq('status', 'CheckedIn')
      .order('check_in_date', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    res.json((data || []).map((row: any) => shapeServiceCenterGuest(row, 'in-house', counts)));
  } catch (error) {
    console.error('Error fetching in-house guests:', error);
    res.status(500).json({ error: 'Failed to fetch in-house guests' });
  }
});

// Get arriving guests
router.get('/service-center/arriving', async (_req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const today = new Date().toISOString().split('T')[0];
    const counts = await fetchOpenRequestCounts();
    const { data, error } = await supabaseAdmin
      .from('reservations')
      .select('*, guests(*)')
      .eq('check_in_date', today)
      .in('status', ['Confirmed', 'Reserved', 'Waitlisted'])
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    res.json((data || []).map((row: any) => shapeServiceCenterGuest(row, 'arriving', counts)));
  } catch (error) {
    console.error('Error fetching arriving guests:', error);
    res.status(500).json({ error: 'Failed to fetch arriving guests' });
  }
});

// Get departing guests
router.get('/service-center/departing', async (_req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const today = new Date().toISOString().split('T')[0];
    const counts = await fetchOpenRequestCounts();
    const { data, error } = await supabaseAdmin
      .from('reservations')
      .select('*, guests(*)')
      .eq('check_out_date', today)
      .eq('status', 'CheckedIn')
      .order('check_out_date', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    res.json((data || []).map((row: any) => shapeServiceCenterGuest(row, 'departing', counts)));
  } catch (error) {
    console.error('Error fetching departing guests:', error);
    res.status(500).json({ error: 'Failed to fetch departing guests' });
  }
});

// Get service queue
router.get('/service-center/queue', async (_req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const { data, error } = await supabaseAdmin
      .from('guest_requests')
      .select('*')
      .in('status', OPEN_REQUEST_STATUSES)
      .eq('assigned_department', 'Concierge')
      .order('submitted_at', { ascending: true })
      .limit(50);

    if (error) return res.status(500).json({ error: error.message });

    res.json((data || []).map(shapeQueueRequest));
  } catch (error) {
    console.error('Error fetching service queue:', error);
    res.status(500).json({ error: 'Failed to fetch service queue' });
  }
});

// ============================================================================
// GUEST COMMUNICATIONS ENDPOINTS
// ============================================================================

// Get guest communications
router.get('/communications', async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const { guest_id, reservation_id, status, limit = 50 } = req.query;

    let query = supabaseAdmin.from('guest_communications').select('*').limit(Number(limit));

    if (guest_id) query = query.eq('guest_id', guest_id);
    if (reservation_id) query = query.eq('reservation_id', reservation_id);
    if (status) query = query.eq('status', status);

    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) return res.status(500).json({ error: error.message });

    const rows = data || [];

    // Attach guest_name from the linked reservation (no FK to embed)
    const reservationIds = [...new Set(rows.map((r: any) => r.reservation_id).filter(Boolean))];
    if (reservationIds.length) {
      const { data: reservations } = await supabaseAdmin
        .from('reservations')
        .select('id, guest_id, guest_name')
        .in('id', reservationIds);
      const byReservation = new Map((reservations || []).map((r: any) => [r.id, r]));
      for (const row of rows) {
        const reservation = byReservation.get(row.reservation_id);
        if (reservation) {
          row.guest_name = reservation.guest_name;
          row.guest_id = row.guest_id || reservation.guest_id;
        }
      }
    }

    res.json(rows);
  } catch (error) {
    console.error('Error fetching communications:', error);
    res.status(500).json({ error: 'Failed to fetch communications' });
  }
});

// Create communication
router.post('/communications', requirePermission('concierge:requests:manage'), async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const { guest_id, reservation_id, room_number, message, message_type } = req.body;

    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'message is required' });
    }
    // guest_communications.message_type is CHECK-constrained — validate here so
    // a bad value returns 400 instead of a 500 from Postgres.
    if (message_type !== undefined && !COMMUNICATION_MESSAGE_TYPES.includes(String(message_type))) {
      return res.status(400).json({ error: `message_type must be one of: ${COMMUNICATION_MESSAGE_TYPES.join(', ')}` });
    }

    const { data, error } = await supabaseAdmin
      .from('guest_communications')
      .insert({
        guest_id,
        reservation_id,
        room_number,
        message,
        message_type
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.status(201).json(data);
  } catch (error) {
    console.error('Error creating communication:', error);
    res.status(500).json({ error: 'Failed to create communication' });
  }
});

// Reply to communication
router.put('/communications/:id/reply', requirePermission('concierge:requests:manage'), async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const { id } = req.params;
    const { reply, replied_by } = req.body;
    if (!reply || !String(reply).trim()) {
      return res.status(400).json({ error: 'reply is required' });
    }

    const { data, error } = await supabaseAdmin
      .from('guest_communications')
      .update({
        reply: String(reply).trim(),
        replied_at: new Date().toISOString(),
        replied_by: replied_by || req.user?.name || req.user?.id || null,
        status: 'Resolved'
      })
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Communication not found' });

    // Surface the reply in the guest's notification feed (guest portal).
    if (data.guest_id) {
      const { error: notifErr } = await supabaseAdmin.from('guest_notifications').insert({
        guest_id: data.guest_id,
        reservation_id: data.reservation_id || null,
        category: 'message_reply',
        title: 'Reply from the hotel team',
        message: String(reply).trim().slice(0, 500),
      });
      if (notifErr) console.warn('guest reply notification insert failed:', notifErr.message);
    }

    res.json(data);
  } catch (error) {
    console.error('Error replying to communication:', error);
    res.status(500).json({ error: 'Failed to reply to communication' });
  }
});

// ============================================================================
// VENDOR MANAGEMENT ENDPOINTS
// ============================================================================

// Get vendors
router.get('/vendors', async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const { category, status, source, limit = 50 } = req.query;

    let query = supabaseAdmin.from('vendors').select('*').limit(Number(limit));

    if (category) query = query.eq('category', category);
    if (status) query = query.eq('status', status);
    // The vendors table is shared with Accounts Payable — default to
    // concierge-owned rows; ?source=all exposes the full list.
    if (source === 'all') { /* no filter */ }
    else query = query.eq('source', source || 'Concierge');

    query = query.order('name', { ascending: true });

    const { data, error } = await query;

    if (error) return res.status(500).json({ error: error.message });

    // Flag vendors under the configured minimum rating for review.
    const minRating = Number(
      (await getConciergeSettings(['vendors.min-rating']))['vendors.min-rating']?.rating
    );

    res.json((data || []).map((v: any) => ({
      ...v,
      below_min_rating:
        Number.isFinite(minRating) && v.rating != null && Number(v.rating) < minRating,
    })));
  } catch (error) {
    console.error('Error fetching vendors:', error);
    res.status(500).json({ error: 'Failed to fetch vendors' });
  }
});

// Create vendor
router.post('/vendors', requirePermission('concierge:vendors:manage'), async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const {
      name, contact_name, email, phone, address,
      tax_id, category, status, withholding_rate, rating
    } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (rating != null && (Number.isNaN(Number(rating)) || Number(rating) < 0 || Number(rating) > 5)) {
      return res.status(400).json({ error: 'rating must be between 0 and 5' });
    }

    // vendors.require-approval: new concierge vendors land on Hold until a
    // duty manager flips them Active via PUT /vendors/:id.
    const requireApproval =
      (await getConciergeSettings(['vendors.require-approval']))['vendors.require-approval']
        ?.enabled === true;

    const { data, error } = await supabaseAdmin
      .from('vendors')
      .insert({
        name,
        contact_name,
        email,
        phone,
        address,
        tax_id,
        category,
        status: requireApproval ? 'Hold' : status,
        withholding_rate,
        rating: rating != null ? Number(rating) : null,
        source: 'Concierge'
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.status(201).json(data);
  } catch (error) {
    console.error('Error creating vendor:', error);
    res.status(500).json({ error: 'Failed to create vendor' });
  }
});

// Update vendor (edit details, hold/reactivate, adjust balance)
router.put('/vendors/:id', requirePermission('concierge:vendors:manage'), async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const { id } = req.params;
    const {
      name, contact_name, email, phone, address,
      tax_id, category, status, withholding_rate, balance, rating
    } = req.body || {};

    if (rating !== undefined && rating != null && (Number.isNaN(Number(rating)) || Number(rating) < 0 || Number(rating) > 5)) {
      return res.status(400).json({ error: 'rating must be between 0 and 5' });
    }

    const updates: Record<string, any> = {};
    for (const [key, value] of Object.entries({
      name, contact_name, email, phone, address,
      tax_id, category, status, withholding_rate, balance,
      rating: rating != null ? Number(rating) : rating === null ? null : undefined
    })) {
      if (value !== undefined) updates[key] = value;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('vendors')
      .update(updates)
      .eq('id', id)
      .eq('source', 'Concierge')
      .select()
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Vendor not found' });

    res.json(data);
  } catch (error) {
    console.error('Error updating vendor:', error);
    res.status(500).json({ error: 'Failed to update vendor' });
  }
});

// ============================================================================
// TRANSPORTATION ENDPOINTS
// ============================================================================

// Get airport shuttle requests — reads from the shared transport_requests
// workflow (concierge-created rows + rows bridged from legacy
// airport_shuttle_requests via source_ref='asr:<id>').
export const TRANSPORT_TO_CONCIERGE_STATUS: Record<string, string> = {
  'Requested': 'Pending',
  'Confirmed': 'Confirmed',
  'Assigned': 'In Progress',
  'Driver En Route': 'In Progress',
  'Guest Picked Up': 'In Progress',
  'In Progress': 'In Progress',
  'Completed': 'Completed',
  'Cancelled': 'Cancelled',
  'No Show': 'Cancelled',
};
const CONCIERGE_TO_TRANSPORT_STATUS: Record<string, string[]> = {
  'Pending': ['Requested'],
  'Confirmed': ['Confirmed'],
  'In Progress': ['Assigned', 'Driver En Route', 'Guest Picked Up', 'In Progress'],
  'Completed': ['Completed'],
  'Cancelled': ['Cancelled', 'No Show'],
};

export function transportToShuttleShape(r: any) {
  const notes: string = r.special_instructions || '';
  const flightMatch = notes.match(/Flight\s+([^|;]+)/i);
  return {
    id: r.id,
    reservation_id: r.reservation_id || null,
    request_number: r.request_number,
    guest_id: r.guest_id || null,
    guest_name: r.guest_name,
    room: r.room || null,
    type: r.type || null,
    flight_number: flightMatch ? flightMatch[1].trim() : null,
    scheduled_time: r.scheduled_time,
    pickup_location: r.pickup_location,
    dropoff_location: r.destination,
    quantity: r.passenger_count,
    status: TRANSPORT_TO_CONCIERGE_STATUS[r.status] || 'Pending',
    assigned_vehicle: r.assigned_vehicle || null,
    notes,
    created_at: r.created_at,
  };
}

router.get('/transportation/shuttle-requests', async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const { status, limit = 50 } = req.query;
    const userPropertyId = (req as any).user?.propertyId || null;

    let query = supabaseAdmin
      .from('transport_requests')
      .select('*')
      .or("source.eq.Concierge,source_ref.like.asr:%")
      .limit(Number(limit));

    if (userPropertyId) query = query.eq('property_id', userPropertyId);

    const statuses = status ? CONCIERGE_TO_TRANSPORT_STATUS[String(status)] : null;
    if (statuses) query = query.in('status', statuses);

    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) return res.status(500).json({ error: error.message });

    res.json((data || []).map(transportToShuttleShape));
  } catch (error) {
    console.error('Error fetching shuttle requests:', error);
    res.status(500).json({ error: 'Failed to fetch shuttle requests' });
  }
});

// Create shuttle request — writes directly into the shared transport_requests
// workflow so the request is visible to dispatch immediately.
router.post('/transportation/shuttle-requests', requirePermission('concierge:requests:manage'), async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const {
      reservation_id, guest_name, flight_number, scheduled_time,
      pickup_location, dropoff_location, quantity, notes, type: requestedType
    } = req.body;

    if (!guest_name || !scheduled_time || !pickup_location || !dropoff_location) {
      return res.status(400).json({ error: 'guest_name, scheduled_time, pickup_location and dropoff_location are required' });
    }
    const when = new Date(scheduled_time);
    if (Number.isNaN(when.getTime())) {
      return res.status(400).json({ error: 'Invalid scheduled_time' });
    }

    // Resolve property: the caller's property, else the reservation's, else
    // the first property (single-property installs). When a reservation is
    // linked, also capture guest_id and room for profile navigation.
    let propertyId: string | null = (req as any).user?.propertyId || null;
    let linkedGuestId: string | null = null;
    let linkedRoom: string | null = null;
    if (reservation_id) {
      const { data: resv } = await supabaseAdmin
        .from('reservations').select('property_id, guest_id, room_number').eq('id', reservation_id).maybeSingle();
      if (!propertyId) propertyId = resv?.property_id || null;
      linkedGuestId = resv?.guest_id || null;
      linkedRoom = resv?.room_number || null;
    }
    if (!propertyId) {
      const { data: prop } = await supabaseAdmin
        .from('properties').select('id').order('created_at').limit(1).maybeSingle();
      propertyId = prop?.id || null;
    }
    if (!propertyId) return res.status(400).json({ error: 'No property available' });

    // transport_requests.type is CHECK-constrained — accept an explicit type
    // (City Transfer, VIP Transport, …) and only fall back to the airport
    // heuristic when the caller doesn't supply one.
    let type = 'Airport Pickup';
    if (requestedType !== undefined && requestedType !== null && String(requestedType).trim()) {
      if (!TRANSPORT_REQUEST_TYPES.includes(String(requestedType))) {
        return res.status(400).json({ error: `type must be one of: ${TRANSPORT_REQUEST_TYPES.join(', ')}` });
      }
      type = String(requestedType);
    } else if (/airport/i.test(String(dropoff_location))) {
      type = 'Airport Drop-off';
    }
    const requestNumber = `TR-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
    const instructions = [
      flight_number ? `Flight ${flight_number}` : null,
      notes || null,
    ].filter(Boolean).join(' | ') || null;

    const { data, error } = await supabaseAdmin
      .from('transport_requests')
      .insert({
        property_id: propertyId,
        request_number: requestNumber,
        guest_id: linkedGuestId,
        reservation_id: reservation_id || null,
        guest_name,
        room: linkedRoom,
        type,
        source: 'Concierge',
        pickup_location,
        destination: dropoff_location,
        scheduled_time: when.toISOString(),
        passenger_count: Math.max(1, Number(quantity) || 1),
        status: 'Requested',
        special_instructions: instructions,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.status(201).json(transportToShuttleShape(data));
  } catch (error) {
    console.error('Error creating shuttle request:', error);
    res.status(500).json({ error: 'Failed to create shuttle request' });
  }
});

// Update a shuttle request's status — accepts the concierge vocabulary and
// maps it onto the shared transport lifecycle (Confirm → Confirmed, etc.).
export const SHUTTLE_STATUS_MAP: Record<string, string> = {
  'Confirmed': 'Confirmed',
  'In Progress': 'In Progress',
  'Completed': 'Completed',
  'Cancelled': 'Cancelled',
};

router.put('/transportation/shuttle-requests/:id', requirePermission('concierge:requests:manage'), async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const { status, notes } = req.body || {};
    const transportStatus = SHUTTLE_STATUS_MAP[String(status)];
    if (!transportStatus) {
      return res.status(400).json({ error: `status must be one of: ${Object.keys(SHUTTLE_STATUS_MAP).join(', ')}` });
    }

    const { data: existing } = await supabaseAdmin
      .from('transport_requests')
      .select('id, status')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Shuttle request not found' });

    const patch: Record<string, any> = {
      status: transportStatus,
      updated_at: new Date().toISOString(),
    };
    if (notes !== undefined) patch.special_instructions = notes;
    const now = new Date().toISOString();
    if (transportStatus === 'In Progress') patch.actual_start_time = now;
    if (transportStatus === 'Completed' || transportStatus === 'Cancelled') patch.actual_end_time = now;

    const { data, error } = await supabaseAdmin
      .from('transport_requests')
      .update(patch)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });

    try {
      await runTransportStatusSideEffects(data, existing.status);
    } catch (sideEffectError: any) {
      console.warn('[concierge] shuttle side-effects failed:', sideEffectError?.message);
    }

    res.json(transportToShuttleShape(data));
  } catch (error) {
    console.error('Error updating shuttle request:', error);
    res.status(500).json({ error: 'Failed to update shuttle request' });
  }
});

// ============================================================================
// GUEST SERVICES ENDPOINTS
// ============================================================================

// Get available guest services
router.get('/services', async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const { category, available_only } = req.query;

    let query = supabaseAdmin.from('guest_services').select('*');

    if (category) query = query.eq('category', category);
    if (available_only !== 'false') query = query.eq('available', true);

    query = query.order('name', { ascending: true });

    const { data, error } = await query;

    if (error) return res.status(500).json({ error: error.message });

    res.json(data || []);
  } catch (error) {
    console.error('Error fetching guest services:', error);
    res.status(500).json({ error: 'Failed to fetch guest services' });
  }
});

// Create a guest service (catalog management)
router.post('/services', requirePermission('concierge:catalog:manage'), async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const { name, description, category, price, available } = req.body || {};

    if (!name?.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!category?.trim()) {
      return res.status(400).json({ error: 'category is required' });
    }

    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
    const id = `svc_${category}_${slug}`;

    const { data: existing } = await supabaseAdmin
      .from('guest_services')
      .select('id')
      .eq('id', id)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'A service with this name already exists in this category' });
    }

    const { data, error } = await supabaseAdmin
      .from('guest_services')
      .insert({
        id,
        name: name.trim(),
        description: description?.trim() || null,
        category: category.trim(),
        price: Number(price) || 0,
        available: available !== false,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.status(201).json(data);
  } catch (error) {
    console.error('Error creating guest service:', error);
    res.status(500).json({ error: 'Failed to create guest service' });
  }
});

// Update a guest service
router.put('/services/:id', requirePermission('concierge:catalog:manage'), async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const { id } = req.params;
    const { name, description, category, price, available } = req.body || {};

    const updates: Record<string, any> = {};
    for (const [key, value] of Object.entries({ name, description, category, price, available })) {
      if (value !== undefined) updates[key] = value;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('guest_services')
      .update(updates)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Service not found' });

    res.json(data);
  } catch (error) {
    console.error('Error updating guest service:', error);
    res.status(500).json({ error: 'Failed to update guest service' });
  }
});

// Delete a guest service
router.delete('/services/:id', requirePermission('concierge:catalog:manage'), async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from('guest_services')
      .delete()
      .eq('id', id);

    if (error) return res.status(500).json({ error: error.message });

    res.json({ deleted: true, id });
  } catch (error) {
    console.error('Error deleting guest service:', error);
    res.status(500).json({ error: 'Failed to delete guest service' });
  }
});

// ============================================================================
// LOCAL RECOMMENDATIONS ENDPOINTS
// ============================================================================

const RECOMMENDATION_CATEGORIES = ['restaurants', 'attractions', 'shopping', 'cultural'];
const RECOMMENDATION_PRICE_TIERS = ['$', '$$', '$$$', '$$$$'];

// Get local recommendations (knowledge base)
router.get('/local-recommendations', async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const { category, search, active_only = 'true' } = req.query;

    let query = supabaseAdmin.from('local_recommendations').select('*');

    if (category && category !== 'all') query = query.eq('category', String(category));
    if (active_only === 'true') query = query.eq('active', true);
    if (search) {
      const term = String(search).replace(/[%,]/g, '');
      query = query.or(`name.ilike.%${term}%,address.ilike.%${term}%,notes.ilike.%${term}%`);
    }

    query = query.order('rating', { ascending: false, nullsFirst: false }).order('name', { ascending: true });

    const { data, error } = await query;

    if (error) return res.status(500).json({ error: error.message });

    res.json(data || []);
  } catch (error) {
    console.error('Error fetching local recommendations:', error);
    res.status(500).json({ error: 'Failed to fetch local recommendations' });
  }
});

// Add a local recommendation
router.post('/local-recommendations', requirePermission('concierge:recommendations:manage'), async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const { name, category, rating, address, phone, notes, price_tier } = req.body || {};

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (!RECOMMENDATION_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `Category must be one of: ${RECOMMENDATION_CATEGORIES.join(', ')}` });
    }
    if (rating != null && (Number(rating) < 0 || Number(rating) > 5 || Number.isNaN(Number(rating)))) {
      return res.status(400).json({ error: 'Rating must be between 0 and 5' });
    }
    if (price_tier != null && !RECOMMENDATION_PRICE_TIERS.includes(price_tier)) {
      return res.status(400).json({ error: 'Invalid price tier' });
    }

    const id = `lr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

    const { data, error } = await supabaseAdmin
      .from('local_recommendations')
      .insert({
        id,
        name: String(name).trim(),
        category,
        rating: rating != null ? Number(rating) : null,
        address: address?.trim() || null,
        phone: phone?.trim() || null,
        notes: notes?.trim() || null,
        price_tier: price_tier || null,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.status(201).json(data);
  } catch (error) {
    console.error('Error creating local recommendation:', error);
    res.status(500).json({ error: 'Failed to create local recommendation' });
  }
});

// Update a local recommendation (edit details or toggle active)
router.put('/local-recommendations/:id', requirePermission('concierge:recommendations:manage'), async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const { name, category, rating, address, phone, notes, price_tier, active } = req.body || {};

    if (category !== undefined && !RECOMMENDATION_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `Category must be one of: ${RECOMMENDATION_CATEGORIES.join(', ')}` });
    }
    if (rating !== undefined && rating != null && (Number(rating) < 0 || Number(rating) > 5 || Number.isNaN(Number(rating)))) {
      return res.status(400).json({ error: 'Rating must be between 0 and 5' });
    }
    if (price_tier !== undefined && price_tier != null && !RECOMMENDATION_PRICE_TIERS.includes(price_tier)) {
      return res.status(400).json({ error: 'Invalid price tier' });
    }

    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    if (name !== undefined) {
      if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
      patch.name = String(name).trim();
    }
    if (category !== undefined) patch.category = category;
    if (rating !== undefined) patch.rating = rating != null ? Number(rating) : null;
    if (address !== undefined) patch.address = address?.trim() || null;
    if (phone !== undefined) patch.phone = phone?.trim() || null;
    if (notes !== undefined) patch.notes = notes?.trim() || null;
    if (price_tier !== undefined) patch.price_tier = price_tier || null;
    if (active !== undefined) patch.active = Boolean(active);

    const { data, error } = await supabaseAdmin
      .from('local_recommendations')
      .update(patch)
      .eq('id', req.params.id)
      .select()
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Recommendation not found' });

    res.json(data);
  } catch (error) {
    console.error('Error updating local recommendation:', error);
    res.status(500).json({ error: 'Failed to update local recommendation' });
  }
});

// Delete a local recommendation
router.delete('/local-recommendations/:id', requirePermission('concierge:recommendations:manage'), async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const { data, error } = await supabaseAdmin
      .from('local_recommendations')
      .delete()
      .eq('id', req.params.id)
      .select('id')
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Recommendation not found' });

    res.json({ deleted: true, id: req.params.id });
  } catch (error) {
    console.error('Error deleting local recommendation:', error);
    res.status(500).json({ error: 'Failed to delete local recommendation' });
  }
});

// ============================================================================
// BILLING & CHARGES ENDPOINTS
// ============================================================================

// Get concierge-posted charges (folio_lines tagged source_module='concierge')
router.get('/billing/charges', async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const { reservation_id, limit = 100 } = req.query;

    let query = supabaseAdmin
      .from('folio_lines')
      .select('*')
      .eq('source_module', 'concierge')
      .order('posting_date', { ascending: false })
      .limit(Number(limit));

    if (reservation_id) query = query.eq('reservation_id', reservation_id);

    const { data, error } = await query;

    if (error) return res.status(500).json({ error: error.message });

    const rows = data || [];

    // Attach guest/room/folio info (no FK embeds available)
    const reservationIds = [...new Set(rows.map((r: any) => r.reservation_id).filter(Boolean))];
    const folioIds = [...new Set(rows.map((r: any) => r.folio_id).filter(Boolean))];

    const [reservationsRes, foliosRes] = await Promise.all([
      reservationIds.length
        ? supabaseAdmin.from('reservations').select('id, guest_id, guest_name, room_number').in('id', reservationIds)
        : Promise.resolve({ data: [] }),
      folioIds.length
        ? supabaseAdmin.from('folios').select('id, status, currency').in('id', folioIds)
        : Promise.resolve({ data: [] }),
    ]);

    const byReservation = new Map((reservationsRes.data || []).map((r: any) => [r.id, r]));
    const byFolio = new Map((foliosRes.data || []).map((f: any) => [f.id, f]));

    for (const row of rows) {
      const reservation = byReservation.get(row.reservation_id);
      const folio = byFolio.get(row.folio_id);
      if (reservation) {
        row.guest_name = reservation.guest_name;
        row.room_number = reservation.room_number;
        row.guest_id = reservation.guest_id;
      }
      if (folio) {
        row.folio_status = folio.status;
        row.currency = folio.currency;
      }
    }

    res.json(rows);
  } catch (error) {
    console.error('Error fetching concierge charges:', error);
    res.status(500).json({ error: 'Failed to fetch charges' });
  }
});

// Post a concierge charge to the guest's folio (creates an open Guest folio if needed)
router.post('/billing/charges', requirePermission('concierge:billing:manage'), async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const { reservation_id, description, amount, quantity = 1 } = req.body || {};

    if (!reservation_id) return res.status(400).json({ error: 'reservation_id is required' });
    if (!description || !String(description).trim()) return res.status(400).json({ error: 'description is required' });
    const qty = Number(quantity) || 1;
    const unitPrice = Number(amount);
    if (Number.isNaN(unitPrice) || unitPrice < 0) return res.status(400).json({ error: 'amount must be a positive number' });

    const line = await postConciergeFolioCharge(reservation_id, String(description).trim(), unitPrice, qty);
    res.status(201).json(line);
  } catch (error) {
    console.error('Error posting concierge charge:', error);
    res.status(500).json({ error: 'Failed to post charge' });
  }
});

// Void a concierge-posted charge — sets is_voided and reverses the folio totals.
// Voided lines are kept for audit; they are never edited or deleted.
router.post('/billing/charges/:id/void', requirePermission('concierge:billing:manage'), async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const { reason } = req.body || {};

    const { data: line, error: fetchError } = await supabaseAdmin
      .from('folio_lines')
      .select('id, folio_id, amount, is_voided, source_module')
      .eq('id', req.params.id)
      .maybeSingle();
    if (fetchError) return res.status(500).json({ error: fetchError.message });
    if (!line) return res.status(404).json({ error: 'Charge not found' });
    if (line.source_module !== 'concierge') {
      return res.status(403).json({ error: 'Only concierge-posted charges can be voided here' });
    }
    if (line.is_voided) return res.status(400).json({ error: 'Charge is already voided' });

    const now = new Date().toISOString();
    const { data: voided, error: voidError } = await supabaseAdmin
      .from('folio_lines')
      .update({
        is_voided: true,
        voided_at: now,
        voided_by: (req as any).user?.id || null,
        void_reason: reason ? String(reason).trim().slice(0, 500) : null,
      })
      .eq('id', req.params.id)
      .select()
      .single();
    if (voidError) return res.status(500).json({ error: voidError.message });

    // Reverse the folio totals
    const { data: folio } = await supabaseAdmin
      .from('folios')
      .select('id, balance, total_charges')
      .eq('id', line.folio_id)
      .maybeSingle();
    if (folio) {
      const amount = Number(line.amount || 0);
      await supabaseAdmin
        .from('folios')
        .update({
          balance: Math.max(0, Number(folio.balance || 0) - amount),
          total_charges: Math.max(0, Number(folio.total_charges || 0) - amount),
          updated_at: now,
        })
        .eq('id', folio.id);
    }

    res.json(voided);
  } catch (error) {
    console.error('Error voiding concierge charge:', error);
    res.status(500).json({ error: 'Failed to void charge' });
  }
});

// ============================================================================
// REPORTS REGISTRY (mirrors hk_reports / eng_reports pattern)
// ============================================================================
//   - GET  /reports           list reports (optional ?category=)
//   - GET  /reports/stats     aggregated KPI counts
//   - GET  /reports/:id       fetch a single report
//   - GET  /reports/:id/data  generate real report data (sections + summary)
//   - POST /reports/:id/run   re-run a single report
//   - POST /reports/run-all   queue all reports for refresh
//   - PATCH /reports/:id      update frequency / format / status

const CONCIERGE_REPORT_SELECT = 'id, category, name, description, last_run, status, format, frequency, updated_at';
const CONCIERGE_REPORT_STATUSES = ['Ready', 'Scheduled', 'Generating', 'Failed'] as const;
const CONCIERGE_REPORT_FORMATS = ['PDF', 'Excel', 'CSV'] as const;

interface ConciergeReportSection {
  title: string;
  columns: string[];
  rows: Record<string, any>[];
}
interface ConciergeReportResult {
  sections: ConciergeReportSection[];
  summary: Record<string, any>;
}

function reportFilterByDate(rows: any[], field: string, from?: string, to?: string): any[] {
  if (!from && !to) return rows;
  return rows.filter((r) => {
    const v = r[field];
    if (!v) return false;
    const d = typeof v === 'string' ? v.split('T')[0] : new Date(v).toISOString().split('T')[0];
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

function reportCountBy(rows: any[], field: string): Record<string, number> {
  const m: Record<string, number> = {};
  for (const r of rows) {
    const k = String(r[field] ?? 'Unknown');
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}

function reportCountRows(counts: Record<string, number>, labelCol: string, valCol: string): Record<string, any>[] {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ [labelCol]: k, [valCol]: v }));
}

function hoursBetween(a?: string | null, b?: string | null): number | null {
  if (!a || !b) return null;
  return Math.round(((new Date(b).getTime() - new Date(a).getTime()) / 3600000) * 10) / 10;
}

type ConciergeReportGenerator = (dateFrom: string, dateTo: string) => Promise<ConciergeReportResult>;

const conciergeFetchRequests = async (requestType?: string) => {
  let q = supabaseAdmin!.from('guest_requests').select('*').eq('assigned_department', 'Concierge');
  if (requestType) q = q.eq('request_type', requestType);
  const { data } = await q.order('submitted_at', { ascending: false });
  return data || [];
};

const requestRow = (r: any) => ({
  'Request #': r.request_number || r.id,
  Guest: r.guest_name,
  Room: r.room_number || '—',
  Type: r.request_type,
  Status: r.status,
  Priority: r.priority,
  Assignee: r.assigned_to || '—',
  Submitted: r.submitted_at ? new Date(r.submitted_at).toLocaleString() : '—',
});

const REPORT_GENERATORS: Record<string, ConciergeReportGenerator> = {
  'daily-activity': async (from, to) => {
    const rows = reportFilterByDate(await conciergeFetchRequests(), 'submitted_at', from, to);
    const byStatus = reportCountBy(rows, 'status');
    const byType = reportCountBy(rows, 'request_type');
    return {
      sections: [
        { title: 'Requests by Status', columns: ['Status', 'Count'], rows: reportCountRows(byStatus, 'Status', 'Count') },
        { title: 'Requests by Type', columns: ['Type', 'Count'], rows: reportCountRows(byType, 'Type', 'Count') },
        { title: 'All Requests', columns: ['Request #', 'Guest', 'Room', 'Type', 'Status', 'Priority', 'Assignee', 'Submitted'], rows: rows.map(requestRow) },
      ],
      summary: { total: rows.length, byStatus, byType },
    };
  },

  'request-analysis': async (from, to) => {
    const rows = reportFilterByDate(await conciergeFetchRequests(), 'submitted_at', from, to);
    const byType = reportCountBy(rows, 'request_type');
    const byStatus = reportCountBy(rows, 'status');
    const byPriority = reportCountBy(rows, 'priority');
    const completed = rows.filter((r) => r.status === 'Completed').length;
    return {
      sections: [
        { title: 'By Type', columns: ['Type', 'Count'], rows: reportCountRows(byType, 'Type', 'Count') },
        { title: 'By Status', columns: ['Status', 'Count'], rows: reportCountRows(byStatus, 'Status', 'Count') },
        { title: 'By Priority', columns: ['Priority', 'Count'], rows: reportCountRows(byPriority, 'Priority', 'Count') },
        { title: 'Request Listing', columns: ['Request #', 'Guest', 'Room', 'Type', 'Status', 'Priority', 'Assignee', 'Submitted'], rows: rows.map(requestRow) },
      ],
      summary: { total: rows.length, completed, completionRate: rows.length ? Math.round((completed / rows.length) * 100) : 0 },
    };
  },

  'service-queue': async () => {
    const all = await conciergeFetchRequests();
    const rows = all.filter((r) => ['Open', 'Assigned', 'In Progress'].includes(r.status));
    const aged = rows.map((r) => ({
      ...requestRow(r),
      'Age (h)': hoursBetween(r.submitted_at, new Date().toISOString()) ?? '—',
    }));
    return {
      sections: [
        { title: 'Queue by Status', columns: ['Status', 'Count'], rows: reportCountRows(reportCountBy(rows, 'status'), 'Status', 'Count') },
        { title: 'Open Queue', columns: ['Request #', 'Guest', 'Room', 'Type', 'Status', 'Priority', 'Assignee', 'Submitted', 'Age (h)'], rows: aged },
      ],
      summary: { open: rows.length },
    };
  },

  'guest-satisfaction': async (from, to) => {
    const all = reportFilterByDate(await conciergeFetchRequests(), 'submitted_at', from, to);
    const rated = all.filter((r) => r.rating != null);
    const avg = rated.length ? Math.round((rated.reduce((s, r) => s + Number(r.rating), 0) / rated.length) * 10) / 10 : 0;
    return {
      sections: [
        { title: 'Ratings Distribution', columns: ['Rating', 'Count'], rows: reportCountRows(reportCountBy(rated, 'rating'), 'Rating', 'Count') },
        { title: 'Guest Feedback', columns: ['Request #', 'Guest', 'Type', 'Rating', 'Feedback'], rows: rated.map((r) => ({ 'Request #': r.request_number || r.id, Guest: r.guest_name, Type: r.request_type, Rating: r.rating, Feedback: r.feedback || '—' })) },
      ],
      summary: { rated: rated.length, avgRating: avg },
    };
  },

  'vip-services': async (from, to) => {
    const rows = reportFilterByDate(await conciergeFetchRequests('VIP Service'), 'submitted_at', from, to);
    return {
      sections: [
        { title: 'VIP Requests by Status', columns: ['Status', 'Count'], rows: reportCountRows(reportCountBy(rows, 'status'), 'Status', 'Count') },
        { title: 'VIP Requests', columns: ['Request #', 'Guest', 'Room', 'Type', 'Status', 'Priority', 'Assignee', 'Submitted'], rows: rows.map(requestRow) },
      ],
      summary: { total: rows.length },
    };
  },

  communications: async (from, to) => {
    const { data } = await supabaseAdmin!.from('guest_communications').select('*').order('created_at', { ascending: false });
    const rows = reportFilterByDate(data || [], 'created_at', from, to);
    return {
      sections: [
        { title: 'Messages by Type', columns: ['Type', 'Count'], rows: reportCountRows(reportCountBy(rows, 'message_type'), 'Type', 'Count') },
        { title: 'Messages by Status', columns: ['Status', 'Count'], rows: reportCountRows(reportCountBy(rows, 'status'), 'Status', 'Count') },
        { title: 'Message Log', columns: ['Room', 'Type', 'Message', 'Status', 'Replied By', 'Received'], rows: rows.map((r: any) => ({ Room: r.room_number || '—', Type: r.message_type, Message: r.message, Status: r.status, 'Replied By': r.replied_by || '—', Received: r.created_at ? new Date(r.created_at).toLocaleString() : '—' })) },
      ],
      summary: { total: rows.length },
    };
  },

  'charges-billing': async (from, to) => {
    const { data } = await supabaseAdmin!.from('folio_lines').select('*').eq('source_module', 'concierge').order('posting_date', { ascending: false });
    const rows = reportFilterByDate(data || [], 'posting_date', from, to).filter((r) => !r.is_voided);
    const total = rows.reduce((s, r) => s + Number(r.amount), 0);
    const byReservation: Record<string, number> = {};
    for (const r of rows) byReservation[r.reservation_id || 'Unknown'] = (byReservation[r.reservation_id || 'Unknown'] || 0) + Number(r.amount);
    return {
      sections: [
        { title: 'Charges by Guest Reservation', columns: ['Reservation', 'Total'], rows: Object.entries(byReservation).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ Reservation: k, Total: v.toFixed(2) })) },
        { title: 'Charge Lines', columns: ['Reservation', 'Description', 'Qty', 'Unit Price', 'Amount', 'Posted'], rows: rows.map((r: any) => ({ Reservation: r.reservation_id || '—', Description: r.description, Qty: r.quantity, 'Unit Price': r.unit_price, Amount: r.amount, Posted: r.posting_date ? new Date(r.posting_date).toLocaleString() : '—' })) },
      ],
      summary: { count: rows.length, total, avg: rows.length ? Math.round((total / rows.length) * 100) / 100 : 0 },
    };
  },

  'vendor-performance': async () => {
    const { data } = await supabaseAdmin!.from('vendors').select('*').order('category').order('name');
    const rows = data || [];
    return {
      sections: [
        { title: 'Vendors by Category', columns: ['Category', 'Count'], rows: reportCountRows(reportCountBy(rows, 'category'), 'Category', 'Count') },
        { title: 'Vendors by Status', columns: ['Status', 'Count'], rows: reportCountRows(reportCountBy(rows, 'status'), 'Status', 'Count') },
        { title: 'Vendor Directory', columns: ['Vendor', 'Category', 'Contact', 'Status', 'Balance'], rows: rows.map((r: any) => ({ Vendor: r.name, Category: r.category, Contact: r.contact_name || '—', Status: r.status, Balance: r.balance })) },
      ],
      summary: { total: rows.length, active: rows.filter((r: any) => r.status === 'Active').length, outstanding: rows.reduce((s: number, r: any) => s + Number(r.balance || 0), 0) },
    };
  },

  'experience-sales': async (from, to) => {
    const { data: services } = await supabaseAdmin!.from('guest_services').select('*').in('category', ['concierge', 'tour', 'ticketing', 'shopping', 'itinerary']);
    const all = reportFilterByDate(await conciergeFetchRequests(), 'submitted_at', from, to);
    const bookings = all.filter((r) => ['Tour Booking', 'Ticket Booking', 'Personal Shopping', 'Itinerary Planning', 'Restaurant Booking'].includes(r.request_type));
    const priceByName = new Map((services || []).map((s: any) => [s.name, Number(s.price)]));
    const revenue = bookings.reduce((s, r) => s + (priceByName.get(r.description?.split('·')[0]?.trim()) || 0), 0);
    return {
      sections: [
        { title: 'Bookings by Type', columns: ['Type', 'Count'], rows: reportCountRows(reportCountBy(bookings, 'request_type'), 'Type', 'Count') },
        { title: 'Catalog by Category', columns: ['Category', 'Items', 'Avg Price'], rows: Object.entries(reportCountBy(services || [], 'category')).map(([k, v]) => ({ Category: k, Items: v, 'Avg Price': Math.round((services || []).filter((s: any) => s.category === k).reduce((s2: number, s: any) => s2 + Number(s.price), 0) / v) })) },
        { title: 'Bookings', columns: ['Request #', 'Guest', 'Room', 'Type', 'Status', 'Priority', 'Assignee', 'Submitted'], rows: bookings.map(requestRow) },
      ],
      summary: { bookings: bookings.length, catalogItems: (services || []).length, estRevenue: revenue },
    };
  },

  'service-performance': async (from, to) => {
    const rows = reportFilterByDate(await conciergeFetchRequests(), 'submitted_at', from, to);
    const byType: Record<string, { total: number; completed: number; hours: number[] }> = {};
    for (const r of rows) {
      const t = r.request_type || 'Other';
      byType[t] = byType[t] || { total: 0, completed: 0, hours: [] };
      byType[t].total++;
      if (r.status === 'Completed') {
        byType[t].completed++;
        const h = hoursBetween(r.submitted_at, r.completed_at);
        if (h != null) byType[t].hours.push(h);
      }
    }
    const typeRows = Object.entries(byType).sort((a, b) => b[1].total - a[1].total).map(([t, s]) => ({
      Type: t,
      Total: s.total,
      Completed: s.completed,
      'Rate %': s.total ? Math.round((s.completed / s.total) * 100) : 0,
      'Avg Turnaround (h)': s.hours.length ? Math.round((s.hours.reduce((a, b) => a + b, 0) / s.hours.length) * 10) / 10 : '—',
    }));
    return {
      sections: [
        { title: 'Performance by Request Type', columns: ['Type', 'Total', 'Completed', 'Rate %', 'Avg Turnaround (h)'], rows: typeRows },
      ],
      summary: { types: typeRows.length, totalRequests: rows.length },
    };
  },

  'itinerary-bookings': async (from, to) => {
    const rows = reportFilterByDate(await conciergeFetchRequests('Itinerary Planning'), 'submitted_at', from, to);
    return {
      sections: [
        { title: 'Itinerary Requests by Status', columns: ['Status', 'Count'], rows: reportCountRows(reportCountBy(rows, 'status'), 'Status', 'Count') },
        { title: 'Itinerary Requests', columns: ['Request #', 'Guest', 'Room', 'Type', 'Status', 'Priority', 'Assignee', 'Submitted'], rows: rows.map(requestRow) },
      ],
      summary: { total: rows.length },
    };
  },

  'recommendations-audit': async () => {
    const { data } = await supabaseAdmin!.from('local_recommendations').select('*').eq('active', true);
    const rows = data || [];
    const rated = rows.filter((r: any) => r.rating != null);
    return {
      sections: [
        { title: 'Coverage by Category', columns: ['Category', 'Count'], rows: reportCountRows(reportCountBy(rows, 'category'), 'Category', 'Count') },
        { title: 'All Recommendations', columns: ['Name', 'Category', 'Rating', 'Price Tier', 'Phone'], rows: rows.map((r: any) => ({ Name: r.name, Category: r.category, Rating: r.rating ?? '—', 'Price Tier': r.price_tier || '—', Phone: r.phone || '—' })) },
      ],
      summary: { total: rows.length, avgRating: rated.length ? Math.round((rated.reduce((s: number, r: any) => s + Number(r.rating), 0) / rated.length) * 10) / 10 : 0 },
    };
  },
};

// GET /api/concierge/reports — list reports (optional ?category=)
router.get('/reports', async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }
    const { category } = req.query;
    let query = supabaseAdmin.from('concierge_reports').select(CONCIERGE_REPORT_SELECT).order('id', { ascending: true });
    if (category) query = query.eq('category', String(category));
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (error) {
    console.error('Error fetching concierge reports:', error);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// GET /api/concierge/reports/stats — aggregated KPI counts
router.get('/reports/stats', async (_req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }
    const { data, error } = await supabaseAdmin.from('concierge_reports').select('category, status');
    if (error) return res.status(500).json({ error: error.message });
    const rows = data || [];
    const byCategory: Record<string, number> = {};
    for (const r of rows) byCategory[r.category] = (byCategory[r.category] || 0) + 1;
    res.json({
      total: rows.length,
      ready: rows.filter((r: any) => r.status === 'Ready').length,
      scheduled: rows.filter((r: any) => r.status === 'Scheduled').length,
      failed: rows.filter((r: any) => r.status === 'Failed').length,
      byCategory,
    });
  } catch (error) {
    console.error('Error fetching concierge report stats:', error);
    res.status(500).json({ error: 'Failed to fetch report stats' });
  }
});

// POST /api/concierge/reports/run-all — queue all reports for refresh
router.post('/reports/run-all', requirePermission('concierge:reports:manage'), async (_req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }
    const { data, error } = await supabaseAdmin
      .from('concierge_reports')
      .update({ status: 'Ready', last_run: new Date().toISOString(), updated_at: new Date().toISOString() })
      .neq('status', 'Ready')
      .select(CONCIERGE_REPORT_SELECT);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ refreshed: data?.length || 0, reports: data || [] });
  } catch (error) {
    console.error('Error running all concierge reports:', error);
    res.status(500).json({ error: 'Failed to run all reports' });
  }
});

// GET /api/concierge/reports/:id — fetch a single report
router.get('/reports/:id', async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }
    const { data, error } = await supabaseAdmin
      .from('concierge_reports').select(CONCIERGE_REPORT_SELECT).eq('id', req.params.id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Report not found' });
    res.json(data);
  } catch (error) {
    console.error('Error fetching concierge report:', error);
    res.status(500).json({ error: 'Failed to fetch report' });
  }
});

// GET /api/concierge/reports/:id/data — generate real report data
// Optional query params: ?from=YYYY-MM-DD &to=YYYY-MM-DD
router.get('/reports/:id/data', async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }
    const generator = REPORT_GENERATORS[req.params.id];
    if (!generator) {
      return res.status(404).json({ error: `No data generator for report: ${req.params.id}` });
    }
    const result = await generator(String(req.query.from || ''), String(req.query.to || ''));
    res.json(result);
  } catch (error: any) {
    console.error('Error generating concierge report data:', error);
    res.status(500).json({ error: error.message || 'Failed to generate report data' });
  }
});

// POST /api/concierge/reports/:id/run — re-run a single report
router.post('/reports/:id/run', requirePermission('concierge:reports:manage'), async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }
    const reportId = req.params.id;

    let rowCount: number | undefined;
    const generator = REPORT_GENERATORS[reportId];
    if (generator) {
      try {
        const result = await generator(String(req.query.from || ''), String(req.query.to || ''));
        rowCount = result.sections.reduce((s, sec) => s + sec.rows.length, 0);
      } catch {
        // Non-fatal — still mark Ready; the data endpoint surfaces real errors.
      }
    }

    const { data, error } = await supabaseAdmin
      .from('concierge_reports')
      .update({ status: 'Ready', last_run: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', reportId)
      .select(CONCIERGE_REPORT_SELECT)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Report not found' });
    res.json({ ...data, rowCount });
  } catch (error) {
    console.error('Error running concierge report:', error);
    res.status(500).json({ error: 'Failed to run report' });
  }
});

// PATCH /api/concierge/reports/:id — update frequency / format / status
router.patch('/reports/:id', requirePermission('concierge:reports:manage'), async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }
    const body = req.body || {};
    const updates: Record<string, any> = {};
    if (typeof body.frequency === 'string' && body.frequency.trim()) updates.frequency = body.frequency.trim();
    if (typeof body.format === 'string' && (CONCIERGE_REPORT_FORMATS as readonly string[]).includes(body.format)) updates.format = body.format;
    if (typeof body.status === 'string' && (CONCIERGE_REPORT_STATUSES as readonly string[]).includes(body.status)) updates.status = body.status;
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update (frequency, format, status)' });
    }
    updates.updated_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('concierge_reports').update(updates).eq('id', req.params.id).select(CONCIERGE_REPORT_SELECT).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Report not found' });
    res.json(data);
  } catch (error) {
    console.error('Error updating concierge report:', error);
    res.status(500).json({ error: 'Failed to update report' });
  }
});

// ============================================================================
// PORTAL SETTINGS (mirrors spa_settings pattern)
// ============================================================================
//   - GET    /settings        list settings (optional ?section=)
//   - POST   /settings        create a setting (id = 'section.slug')
//   - PATCH  /settings/:id(*) update name / description / value / status
//   - DELETE /settings/:id(*) remove a setting

const CONCIERGE_SETTING_SECTIONS = ['requests', 'notifications', 'hours', 'vendors', 'service'] as const;
const CONCIERGE_SETTING_STATUSES = ['Configured', 'Not Configured'] as const;

// GET /api/concierge/settings — list settings (optional ?section=)
router.get('/settings', async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }
    const { section } = req.query;
    let query = supabaseAdmin.from('concierge_settings').select('*').order('id', { ascending: true });
    if (section) query = query.eq('section', String(section));
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (error) {
    console.error('Error fetching concierge settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// POST /api/concierge/settings — create a setting
router.post('/settings', requirePermission('concierge:settings:manage'), async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }
    const { section, name, description, value, status } = req.body || {};
    if (!section || !name) return res.status(400).json({ error: 'section and name are required' });
    if (!(CONCIERGE_SETTING_SECTIONS as readonly string[]).includes(section)) {
      return res.status(400).json({ error: `Invalid section. Must be one of: ${CONCIERGE_SETTING_SECTIONS.join(', ')}` });
    }
    if (status && !(CONCIERGE_SETTING_STATUSES as readonly string[]).includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${CONCIERGE_SETTING_STATUSES.join(', ')}` });
    }

    const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const id = `${section}.${slug}`;
    const { data: dup } = await supabaseAdmin.from('concierge_settings').select('id').eq('id', id).maybeSingle();
    if (dup) return res.status(409).json({ error: `Setting ${id} already exists` });

    const { data, error } = await supabaseAdmin
      .from('concierge_settings')
      .insert({
        id, section, name,
        description: description || '',
        value: value || { enabled: false },
        status: status || 'Not Configured',
      })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  } catch (error) {
    console.error('Error creating concierge setting:', error);
    res.status(500).json({ error: 'Failed to create setting' });
  }
});

// PATCH /api/concierge/settings/:id(*) — update name / description / value / status
router.patch('/settings/:id(*)', requirePermission('concierge:settings:manage'), async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }
    if (req.body.status && !(CONCIERGE_SETTING_STATUSES as readonly string[]).includes(req.body.status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${CONCIERGE_SETTING_STATUSES.join(', ')}` });
    }
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const f of ['name', 'description', 'value', 'status']) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }
    const { data, error } = await supabaseAdmin
      .from('concierge_settings').update(updates).eq('id', req.params.id).select().maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Setting not found' });
    res.json(data);
  } catch (error) {
    console.error('Error updating concierge setting:', error);
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

// DELETE /api/concierge/settings/:id(*) — remove a setting
router.delete('/settings/:id(*)', requirePermission('concierge:settings:manage'), async (req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }
    const { error } = await supabaseAdmin.from('concierge_settings').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting concierge setting:', error);
    res.status(500).json({ error: 'Failed to delete setting' });
  }
});

export default router;