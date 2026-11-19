import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { writeAuditEvent, getTypeAvailability, rangesOverlap } from '../services/sharedServices';

const router = Router();

// ── Room Management Operations ─────────────────────────────────────

// Update room status
router.put('/rooms/:roomId/status', authenticate, requirePermission('front_office:edit'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { roomId } = req.params;
    const { status, cancel_reservations } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    // Use the safe RPC function that bypasses problematic audit triggers
    // (see migration 218_add_safe_room_update_functions.sql). Direct table
    // updates trigger audit_rooms_trigger which causes 500 errors.
    const { error } = await supabaseAdmin
      .rpc('update_room_status_safe', { room_id: roomId, new_status: status });

    if (error) {
      console.error('Error updating room status:', error);
      return res.status(500).json({ error: error.message });
    }

    // Blocking / out-of-order optionally releases booked reservations on
    // that room (front desk re-accommodates the guests afterwards).
    let cancelledReservations = 0;
    if (cancel_reservations === true) {
      const { data: room } = await supabaseAdmin
        .from('rooms').select('number').eq('id', roomId).maybeSingle();
      if (room?.number) {
        const { data: cancelled, error: cancelErr } = await supabaseAdmin
          .from('reservations')
          .update({ status: 'Cancelled' })
          .eq('room_number', room.number)
          .in('status', ['Confirmed', 'CheckedIn'])
          .select('id');
        if (cancelErr) {
          console.error('Reservation cancel error:', cancelErr);
        } else {
          cancelledReservations = (cancelled || []).length;
        }
      }
    }

    // Write audit event
    writeAuditEvent({
      req,
      user: req.user!,
      action: 'UPDATE',
      module: 'front_office',
      entityType: 'room',
      entityId: roomId,
      details: { status },
      outcome: 'success'
    }).catch((err: any) => {
      console.error('Failed to write audit event:', err);
    });

    res.json({ success: true, message: 'Room status updated successfully', cancelledReservations });
  } catch (error) {
    console.error('Error in room status update:', error);
    res.status(500).json({ error: 'Failed to update room status' });
  }
});

// Update room features
router.put('/rooms/:roomId/features', authenticate, requirePermission('front_office:edit'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { roomId } = req.params;
    const { features } = req.body;

    if (!Array.isArray(features)) {
      return res.status(400).json({ error: 'Features must be an array' });
    }

    // Use the safe RPC function that bypasses problematic audit triggers
    // (see migration 218_add_safe_room_update_functions.sql).
    const { error } = await supabaseAdmin
      .rpc('update_room_features_safe', { room_id: roomId, new_features: features });

    if (error) {
      console.error('Error updating room features:', error);
      return res.status(500).json({ error: error.message });
    }

    // Write audit event
    writeAuditEvent({
      req,
      user: req.user!,
      action: 'UPDATE',
      module: 'front_office',
      entityType: 'room',
      entityId: roomId,
      details: { features },
      outcome: 'success'
    }).catch((err: any) => {
      console.error('Failed to write audit event:', err);
    });

    res.json({ success: true, message: 'Room features updated successfully' });
  } catch (error) {
    console.error('Error in room features update:', error);
    res.status(500).json({ error: 'Failed to update room features' });
  }
});

// ── Public Test Endpoint (No Auth Required) ───────────────────────
router.get('/test-connection', async (_req, res) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    // Test database connection
    const { data, error } = await supabaseAdmin
      .from('reservations')
      .select('count')
      .limit(1);

    if (error) {
      return res.status(500).json({ error: 'Database connection failed', details: error.message });
    }

    res.json({ 
      success: true, 
      message: 'Database connection successful',
      count: data?.length || 0
    });
  } catch (error) {
    res.status(500).json({ error: 'Test failed', details: String(error) });
  }
});

// ── Dashboard ──────────────────────────────────────────────────────

// Dashboard KPIs and metrics
router.get('/dashboard/kpis', authenticate, requirePermission('front_office:view'), async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    // Use the hotel's business date (from the business_dates table) as the
    // operational "today". This is the same date the night audit and check-in
    // validation use. Falling back to UTC date (new Date().toISOString()) can
    // be wrong for hotels in timezones ahead/behind UTC, especially late at
    // night or early morning.
    //
    // Staleness guard: if the business date is more than 1 day behind the
    // actual calendar date (i.e. night audit hasn't been run), fall back to
    // today's date so the dashboard doesn't show empty data from weeks ago.
    const { data: businessDateRow } = await supabaseAdmin
      .from('business_dates')
      .select('business_date')
      .eq('id', 'current')
      .maybeSingle();
    const realToday = new Date().toISOString().split('T')[0];
    let today = businessDateRow?.business_date || realToday;
    if (businessDateRow?.business_date) {
      const bizDate = new Date(businessDateRow.business_date);
      const now = new Date(realToday);
      const diffDays = (now.getTime() - bizDate.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays > 1) {
        console.warn(`[Dashboard KPIs] Business date (${businessDateRow.business_date}) is ${diffDays.toFixed(0)} days stale — falling back to ${realToday}. Night audit may not have been run.`);
        today = realToday;
      }
    }

    // Fetch ALL rooms (no status filter — totalRooms must reflect every room).
    // Canonical statuses: 'Vacant Clean', 'Vacant Dirty', 'Occupied Clean',
    // 'Occupied Dirty', 'Out of Order'. Occupied = status includes 'Occupied'.
    const { data: rooms, error: roomsError } = await supabaseAdmin
      .from('rooms')
      .select('id, number, status, room_type_id');

    if (roomsError) {
      console.error('[Dashboard KPIs] Rooms error:', roomsError);
      return res.status(500).json({ error: roomsError.message, details: 'Failed to fetch rooms' });
    }

    const totalRooms = rooms?.length || 0;
    const occupiedRooms = rooms?.filter(r => typeof r.status === 'string' && r.status.includes('Occupied')).length || 0;
    const availableRooms = rooms?.filter(r => r.status === 'Vacant Clean' || r.status === 'Vacant Dirty').length || 0;
    const outOfOrder = rooms?.filter(r => r.status === 'Out of Order').length || 0;
    const outOfService = rooms?.filter(r => r.status === 'Out of Service' || r.status === 'Maintenance').length || 0;
    const occupancyRate = totalRooms > 0 ? ((occupiedRooms / totalRooms) * 100).toFixed(1) : '0.0';

    // Fetch today's arrivals and departures.
    // Reservation statuses are CamelCase: 'Confirmed', 'CheckedIn', 'CheckedOut'.
    // We fetch by check_in_date = today OR check_out_date = today, PLUS any
    // CheckedOut reservations updated today (to catch early check-outs whose
    // scheduled check_out_date is in the future but who already left today).
    const { data: scheduledRes, error: reservationsError } = await supabaseAdmin
      .from('reservations')
      .select('id, check_in_date, check_out_date, status, guest_id, updated_at')
      .or(`check_in_date.eq.${today},check_out_date.eq.${today}`)
      .in('status', ['Confirmed', 'CheckedIn', 'CheckedOut']);

    // Separately fetch early check-outs: CheckedOut today but check_out_date != today.
    const { data: earlyCheckouts, error: earlyCheckoutError } = await supabaseAdmin
      .from('reservations')
      .select('id, check_in_date, check_out_date, status, guest_id, updated_at')
      .eq('status', 'CheckedOut')
      .gte('updated_at', today)
      .lt('updated_at', today + 'T23:59:59.999Z')
      .neq('check_out_date', today);

    if (reservationsError) {
      console.error('[Dashboard KPIs] Reservations error:', reservationsError);
      return res.status(500).json({ error: reservationsError.message, details: 'Failed to fetch reservations' });
    }
    if (earlyCheckoutError) {
      console.error('[Dashboard KPIs] Early checkouts error:', earlyCheckoutError);
    }

    // Merge and deduplicate (a reservation could appear in both queries if
    // it was checked out today AND has check_out_date = today).
    const allReservations = [...(scheduledRes || []), ...(earlyCheckouts || [])];
    const seenIds = new Set<string>();
    const reservations = allReservations.filter((r: any) => {
      if (seenIds.has(r.id)) return false;
      seenIds.add(r.id);
      return true;
    });

    // ── KPI definitions (hotel-industry standard) ──────────────────────
    // Arrivals Today     = ALL guests who arrived today (check_in_date = today,
    //                       any status: Confirmed, CheckedIn, or CheckedOut
    //                       for early check-outs).
    // Departures Today   = ALL guests who departed today:
    //                         - scheduled departures (check_out_date = today,
    //                           status CheckedIn or CheckedOut)
    //                         - early departures (status = CheckedOut AND
    //                           updated_at is today, even if check_out_date
    //                           is in the future)
    // Expected Check-ins = arrivals who have NOT yet checked in (Confirmed only).
    // Expected Check-outs= departures who have NOT yet checked out (CheckedIn
    //                       with check_out_date = today).
    const arrivalsToday = reservations.filter((r: any) => r.check_in_date === today).length;
    const departuresToday = reservations.filter((r: any) => {
      if (r.check_out_date === today && (r.status === 'CheckedIn' || r.status === 'CheckedOut')) return true;
      // Early check-out: already CheckedOut today but scheduled for a future date
      if (r.status === 'CheckedOut' && r.check_out_date !== today) {
        const updatedDate = r.updated_at ? new Date(r.updated_at).toISOString().split('T')[0] : null;
        return updatedDate === today;
      }
      return false;
    }).length;
    const expectedCheckins = reservations.filter((r: any) => r.check_in_date === today && r.status === 'Confirmed').length;
    const expectedCheckouts = reservations.filter((r: any) => r.check_out_date === today && r.status === 'CheckedIn').length;

    // Stayovers = in-house guests whose stay spans today (neither arriving nor departing today).
    // Fetched separately because the query above only returns today's arrivals/departures.
    const { data: stayoverRes, error: stayoverError } = await supabaseAdmin
      .from('reservations')
      .select('id, status')
      .lt('check_in_date', today)
      .gt('check_out_date', today)
      .eq('status', 'CheckedIn');

    if (stayoverError) {
      console.error('[Dashboard KPIs] Stayovers error:', stayoverError);
    }
    const stayovers = stayoverRes?.length || 0;

    // ── Additional operational KPIs ───────────────────────────────────
    // Cancellations and no-shows today (check_in_date = today).
    const { data: cancelledRes, error: cancelledError } = await supabaseAdmin
      .from('reservations')
      .select('id, status, check_in_date')
      .eq('check_in_date', today)
      .in('status', ['Cancelled', 'NoShow']);

    if (cancelledError) {
      console.error('[Dashboard KPIs] Cancelled/NoShow error:', cancelledError);
    }
    const cancellationsToday = cancelledRes?.filter((r: any) => r.status === 'Cancelled').length || 0;
    const noShowsToday = cancelledRes?.filter((r: any) => r.status === 'NoShow').length || 0;

    // Late check-out requests for today (guests still CheckedIn with
    // late_check_out_requested = true and check_out_date = today).
    const { data: lateCheckoutRes, error: lateCheckoutError } = await supabaseAdmin
      .from('reservations')
      .select('id, late_check_out_requested, check_out_date, status, guest_name, room_number')
      .eq('check_out_date', today)
      .eq('status', 'CheckedIn')
      .eq('late_check_out_requested', true);

    if (lateCheckoutError) {
      console.error('[Dashboard KPIs] Late checkout error:', lateCheckoutError);
    }
    const lateCheckouts = lateCheckoutRes?.length || 0;

    // Group arrivals today (is_group = true, check_in_date = today).
    const groupArrivalsToday = reservations.filter(
      (r: any) => r.check_in_date === today && (r as any).is_group === true
    ).length;

    // Adults & children currently in-house (CheckedIn reservations).
    const { data: inHouseGuests, error: inHouseError } = await supabaseAdmin
      .from('reservations')
      .select('id, adults, children, status')
      .eq('status', 'CheckedIn');

    if (inHouseError) {
      console.error('[Dashboard KPIs] In-house guests error:', inHouseError);
    }
    const adultsInHouse = inHouseGuests?.reduce((sum, r) => sum + (r.adults || 0), 0) || 0;
    const childrenInHouse = inHouseGuests?.reduce((sum, r) => sum + (r.children || 0), 0) || 0;

    // Dirty rooms (Vacant Dirty — rooms needing turnover before arrivals).
    const dirtyRooms = rooms?.filter(r => r.status === 'Vacant Dirty').length || 0;

    // Pending guest requests (not yet completed).
    let pendingRequests = 0;
    try {
      const { count, error: reqError } = await supabaseAdmin
        .from('guest_requests')
        .select('id', { count: 'exact', head: true })
        .neq('status', 'Completed')
        .neq('status', 'Cancelled');
      if (!reqError) pendingRequests = count || 0;
    } catch (e) {
      // guest_requests table may not exist in all environments
      console.error('[Dashboard KPIs] Guest requests error:', e);
    }

    // Fetch revenue data (simplified - in production would aggregate from folios)
    const { data: folios, error: foliosError } = await supabaseAdmin
      .from('folios')
      .select('total_charges, total_payments, created_at')
      .gte('created_at', today);

    if (foliosError) {
      console.error('[Dashboard KPIs] Folios error:', foliosError);
      return res.status(500).json({ error: foliosError.message, details: 'Failed to fetch folios' });
    }

    const todayRevenue = folios?.reduce((sum, f) => sum + (f.total_charges || 0), 0) || 0;

    // Calculate ADR and RevPAR (simplified)
    const adr = occupiedRooms > 0 ? (todayRevenue / occupiedRooms).toFixed(0) : '0';
    const revpar = totalRooms > 0 ? (todayRevenue / totalRooms).toFixed(0) : '0';

    res.json({
      kpis: [
        { title: 'Occupancy %', value: occupancyRate, change: 0, icon: 'Users', color: 'blue' },
        { title: 'ADR', value: `$${adr}`, change: 0, icon: 'DollarSign', color: 'green' },
        { title: 'RevPAR', value: `$${revpar}`, change: 0, icon: 'TrendingUp', color: 'purple' },
        { title: "Today's Revenue", value: `$${todayRevenue.toLocaleString()}`, change: 0, icon: 'DollarSign', color: 'emerald' },
        { title: 'Arrivals Today', value: arrivalsToday, icon: 'Calendar', color: 'orange' },
        { title: 'Departures Today', value: departuresToday, icon: 'Clock', color: 'red' },
        { title: 'Stayovers', value: stayovers, icon: 'BedDouble', color: 'indigo' },
        { title: 'Expected Check-ins', value: expectedCheckins, icon: 'UserCheck', color: 'cyan' },
        { title: 'Expected Check-outs', value: expectedCheckouts, icon: 'UserX', color: 'rose' },
        { title: 'Available Rooms', value: availableRooms, icon: 'Home', color: 'green' },
        { title: 'Out of Order', value: outOfOrder, icon: 'Wrench', color: 'yellow' },
        { title: 'Out of Service', value: outOfService, icon: 'XCircle', color: 'gray' },
        // ── Additional operational KPIs ──
        { title: 'In-house Guests', value: occupiedRooms, icon: 'Users', color: 'blue' },
        { title: 'Adults in House', value: adultsInHouse, icon: 'UserCheck', color: 'cyan' },
        { title: 'Children in House', value: childrenInHouse, icon: 'Heart', color: 'rose' },
        { title: 'Cancellations Today', value: cancellationsToday, icon: 'XCircle', color: 'red' },
        { title: 'No-shows Today', value: noShowsToday, icon: 'UserX', color: 'orange' },
        { title: 'Late Check-outs', value: lateCheckouts, icon: 'Clock', color: 'amber' },
        { title: 'Group Arrivals', value: groupArrivalsToday, icon: 'Users', color: 'teal' },
        { title: 'Dirty Rooms', value: dirtyRooms, icon: 'Wrench', color: 'yellow' },
        { title: 'Pending Requests', value: pendingRequests, icon: 'Bell', color: 'purple' },
      ],
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Dashboard KPIs] Unexpected error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard KPIs', details: error instanceof Error ? error.message : String(error) });
  }
});

// ── Weekly Trends (occupancy + revenue + booking sources) ───────────

// Returns the last 7 days of occupancy %, revenue, and arrival counts,
// plus a breakdown of booking sources (channels) for the same period.
// Used by the Front Office Dashboard's "Weekly Trends" and "Booking Sources"
// sections. All dates use the hotel business date with a staleness guard.
router.get('/dashboard/weekly-trends', authenticate, requirePermission('front_office:view'), async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    // Resolve the reference "today" for the trend window.
    // Unlike the KPIs endpoint (which falls back to the real calendar date
    // when the business date is stale), trends are HISTORICAL analysis — we
    // want the 7-day window to cover the period where operational data
    // actually exists. So we anchor to the LATEST data date, which is the
    // max of: business_date, latest reservation check_in_date, and latest
    // folio created_at. This ensures trends always show real data instead
    // of an empty window when the business date is stale (e.g. night audit
    // hasn't been run, or a demo/dev environment with static data).
    const { data: businessDateRow } = await supabaseAdmin
      .from('business_dates')
      .select('business_date')
      .eq('id', 'current')
      .maybeSingle();
    const realToday = new Date().toISOString().split('T')[0];

    // Find the latest reservation check_in_date — only count reservations
    // that have actually been checked in (excludes future Confirmed bookings
    // which would anchor the window past the real operational data).
    const { data: latestRes } = await supabaseAdmin
      .from('reservations')
      .select('check_in_date')
      .in('status', ['CheckedIn', 'CheckedOut'])
      .order('check_in_date', { ascending: false })
      .limit(1);

    // Find the latest folio created_at.
    const { data: latestFolio } = await supabaseAdmin
      .from('folios')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1);

    // Compute the reference date = max(business_date, latest check_in_date, latest folio date).
    // We do NOT include realToday as a candidate — if the business date is stale,
    // realToday would always win and produce an empty window. Instead, we anchor
    // to where operational data actually exists, only falling back to realToday
    // if there is no data at all (fresh database).
    const candidateDates: string[] = [];
    if (businessDateRow?.business_date) candidateDates.push(businessDateRow.business_date);
    if (latestRes?.[0]?.check_in_date) candidateDates.push(latestRes[0].check_in_date);
    if (latestFolio?.[0]?.created_at) {
      candidateDates.push(new Date(latestFolio[0].created_at).toISOString().split('T')[0]);
    }
    // Use the latest candidate date, but never go beyond real today.
    const validDates = candidateDates.filter(d => d <= realToday);
    const today = validDates.length > 0
      ? validDates.sort().reverse()[0]
      : realToday;

    // Build the 7-day window (6 days ago through today).
    const todayDate = new Date(today);
    const weekStart = new Date(todayDate);
    weekStart.setDate(weekStart.getDate() - 6);
    const weekStartStr = weekStart.toISOString().split('T')[0];

    // Fetch total room count (for occupancy %).
    const { data: roomsData, error: roomsError } = await supabaseAdmin
      .from('rooms')
      .select('id, status');
    if (roomsError) return res.status(500).json({ error: roomsError.message });
    const totalRooms = roomsData?.length || 0;

    // Fetch reservations that checked in within the last 7 days.
    // We use check_in_date to bucket arrivals per day. room_type is included
    // so we can also build a "top room types" breakdown for the same window.
    const { data: weekReservations, error: resError } = await supabaseAdmin
      .from('reservations')
      .select('id, check_in_date, check_out_date, status, channel, total_amount, room_type')
      .gte('check_in_date', weekStartStr)
      .lte('check_in_date', today)
      .in('status', ['Confirmed', 'CheckedIn', 'CheckedOut']);

    if (resError) {
      console.error('[Weekly Trends] Reservations error:', resError);
      return res.status(500).json({ error: resError.message });
    }

    // Fetch folios created in the last 7 days for revenue.
    const { data: weekFolios, error: foliosError } = await supabaseAdmin
      .from('folios')
      .select('total_charges, created_at')
      .gte('created_at', weekStartStr);

    if (foliosError) {
      console.error('[Weekly Trends] Folios error:', foliosError);
    }

    // Fetch reservations that were in-house on each day of the week for
    // occupancy. A reservation is in-house on day D if check_in_date <= D
    // AND check_out_date > D AND status is CheckedIn (or was CheckedIn at
    // some point). We approximate by fetching all reservations whose stay
    // overlaps the 7-day window and computing per-day occupancy in JS.
    const { data: overlappingRes, error: overlapError } = await supabaseAdmin
      .from('reservations')
      .select('id, check_in_date, check_out_date, status')
      .lte('check_in_date', today)
      .gte('check_out_date', weekStartStr)
      .in('status', ['CheckedIn', 'CheckedOut']);

    if (overlapError) {
      console.error('[Weekly Trends] Overlap error:', overlapError);
    }

    // ── Build per-day buckets ────────────────────────────────────────
    const days: { date: string; label: string; occupancy: number; revenue: number; arrivals: number }[] = [];
    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(todayDate);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const label = dayLabels[d.getDay()];

      // Occupancy: count reservations in-house on this day.
      // In-house means check_in_date <= dateStr AND check_out_date > dateStr
      // AND status is CheckedIn or CheckedOut (was occupied at some point).
      const inHouse = (overlappingRes || []).filter((r: any) =>
        r.check_in_date <= dateStr && r.check_out_date > dateStr &&
        (r.status === 'CheckedIn' || r.status === 'CheckedOut')
      ).length;
      const occupancy = totalRooms > 0 ? Math.round((inHouse / totalRooms) * 100) : 0;

      // Revenue: sum folio total_charges created on this day.
      const revenue = (weekFolios || [])
        .filter((f: any) => {
          if (!f.created_at) return false;
          const fDate = new Date(f.created_at).toISOString().split('T')[0];
          return fDate === dateStr;
        })
        .reduce((sum: number, f: any) => sum + (f.total_charges || 0), 0);

      // Arrivals: reservations with check_in_date = this day.
      const arrivals = (weekReservations || []).filter((r: any) => r.check_in_date === dateStr).length;

      days.push({ date: dateStr, label, occupancy, revenue: Math.round(revenue), arrivals });
    }

    // ── Booking sources breakdown ────────────────────────────────────
    // Group reservations by channel for the 7-day window.
    const channelMap = new Map<string, { count: number; revenue: number }>();
    for (const r of (weekReservations || [])) {
      const channel = r.channel || 'Unknown';
      const existing = channelMap.get(channel) || { count: 0, revenue: 0 };
      existing.count += 1;
      existing.revenue += Number(r.total_amount || 0);
      channelMap.set(channel, existing);
    }
    const sources = Array.from(channelMap.entries())
      .map(([channel, data]) => ({ channel, count: data.count, revenue: Math.round(data.revenue) }))
      .sort((a, b) => b.count - a.count);

    // ── Top room types breakdown ─────────────────────────────────────
    // Group the same 7-day reservations by room_type, counting bookings and
    // summing revenue. Used by the dashboard's "Top Room Types" widget to
    // show which room categories are driving the most business this week.
    const roomTypeMap = new Map<string, { count: number; revenue: number }>();
    for (const r of (weekReservations || [])) {
      const rt = r.room_type || 'Unassigned';
      const existing = roomTypeMap.get(rt) || { count: 0, revenue: 0 };
      existing.count += 1;
      existing.revenue += Number(r.total_amount || 0);
      roomTypeMap.set(rt, existing);
    }
    const roomTypes = Array.from(roomTypeMap.entries())
      .map(([roomType, data]) => ({ roomType, count: data.count, revenue: Math.round(data.revenue) }))
      .sort((a, b) => b.count - a.count);

    const totalArrivals = days.reduce((sum, d) => sum + d.arrivals, 0);
    const totalRevenue = days.reduce((sum, d) => sum + d.revenue, 0);
    const avgOccupancy = days.length > 0 ? Math.round(days.reduce((sum, d) => sum + d.occupancy, 0) / days.length) : 0;

    res.json({
      days,
      sources,
      roomTypes,
      summary: {
        totalArrivals,
        totalRevenue,
        avgOccupancy,
        totalRooms,
      },
    });
  } catch (error) {
    console.error('[Weekly Trends] Unexpected error:', error);
    res.status(500).json({ error: 'Failed to fetch weekly trends', details: error instanceof Error ? error.message : String(error) });
  }
});

// ── Alerts ─────────────────────────────────────────────────────────

// Get operational alerts
// Generates real-time operational alerts from live database data.
// Alert types: vip, no-show, overbooking, high-balance, late-checkout,
// room-assignment, unpaid-arrival, pending-request, dirty-rooms-blocking,
// long-stay, group-arrival.
router.get('/alerts', authenticate, requirePermission('front_office:view'), async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    // Resolve "today" — business date with staleness guard (same as KPIs).
    const { data: businessDateRow } = await supabaseAdmin
      .from('business_dates')
      .select('business_date')
      .eq('id', 'current')
      .maybeSingle();
    const realToday = new Date().toISOString().split('T')[0];
    let today = businessDateRow?.business_date || realToday;
    if (businessDateRow?.business_date) {
      const bizDate = new Date(businessDateRow.business_date);
      const now = new Date(realToday);
      const diffDays = (now.getTime() - bizDate.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays > 1) today = realToday;
    }

    const alerts: any[] = [];
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

    // ── 1. VIP guests arriving today ──────────────────────────────────
    // guests.status = 'VIP' OR reservations.guest_status = 'VIP'
    const { data: vipArrivals } = await supabaseAdmin
      .from('reservations')
      .select('id, guest_name, guest_status, room_number, check_in_date, status, guest_id')
      .eq('check_in_date', today)
      .in('status', ['Confirmed', 'CheckedIn'])
      .or('guest_status.eq.VIP');

    // Also check guests table for VIP status (via guest_id join)
    const vipGuestIds = (vipArrivals || []).map((r: any) => r.guest_id).filter(Boolean);
    let vipGuestNames: Set<string> = new Set();
    if (vipGuestIds.length > 0) {
      const { data: vipGuests } = await supabaseAdmin
        .from('guests')
        .select('id, name, status')
        .in('id', vipGuestIds)
        .eq('status', 'VIP');
      vipGuests?.forEach((g: any) => vipGuestNames.add(g.name));
    }

    // Merge: alerts for guest_status=VIP on reservation OR guests.status=VIP
    const seenVipIds = new Set<string>();
    (vipArrivals || []).forEach((r: any) => {
      if (seenVipIds.has(r.id)) return;
      seenVipIds.add(r.id);
      alerts.push({
        id: `vip-${r.id}`,
        type: 'vip',
        message: 'VIP Guest arriving today',
        guestName: r.guest_name || 'Unknown',
        roomNumber: r.room_number || 'Unassigned',
        time: timeStr,
        priority: 'high'
      });
    });

    // ── 2. No-show reservations (yesterday's Confirmed that never checked in) ──
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const { data: noShows } = await supabaseAdmin
      .from('reservations')
      .select('id, guest_name, room_number, check_in_date, status')
      .eq('check_in_date', yesterdayStr)
      .eq('status', 'Confirmed');

    noShows?.forEach((r: any) => {
      alerts.push({
        id: `noshow-${r.id}`,
        type: 'no-show',
        message: 'No-show reservation from yesterday',
        guestName: r.guest_name || 'Unknown',
        roomNumber: r.room_number || 'Unassigned',
        time: 'Yesterday',
        priority: 'high'
      });
    });

    // ── 3. High balance folios (balance > 1000) ───────────────────────
    const { data: highBalanceFolios } = await supabaseAdmin
      .from('folios')
      .select('id, balance, reservation_id, status')
      .gt('balance', 1000)
      .eq('status', 'Open');

    // Fetch guest names for these folios via reservation_id
    const highBalanceResIds = (highBalanceFolios || []).map((f: any) => f.reservation_id).filter(Boolean);
    let resNameMap: Record<string, { guestName: string; roomNumber: string }> = {};
    if (highBalanceResIds.length > 0) {
      const { data: hbRes } = await supabaseAdmin
        .from('reservations')
        .select('id, guest_name, room_number')
        .in('id', highBalanceResIds);
      hbRes?.forEach((r: any) => {
        resNameMap[r.id] = { guestName: r.guest_name || 'Unknown', roomNumber: r.room_number || 'Unassigned' };
      });
    }

    highBalanceFolios?.forEach((f: any) => {
      const info = f.reservation_id ? resNameMap[f.reservation_id] : null;
      alerts.push({
        id: `balance-${f.id}`,
        type: 'high-balance',
        message: `High folio balance: $${Number(f.balance).toLocaleString()}`,
        guestName: info?.guestName || 'Unknown',
        roomNumber: info?.roomNumber || 'Unassigned',
        time: 'Outstanding',
        priority: 'high'
      });
    });

    // ── 4. Overbooking risk (arrivals > available rooms) ──────────────
    const { data: todayArrivals } = await supabaseAdmin
      .from('reservations')
      .select('id, guest_name, room_number, status')
      .eq('check_in_date', today)
      .in('status', ['Confirmed', 'CheckedIn']);

    const { data: availRooms } = await supabaseAdmin
      .from('rooms')
      .select('id, status')
      .in('status', ['Vacant Clean', 'Vacant Dirty']);

    const pendingArrivals = (todayArrivals || []).filter((r: any) => r.status === 'Confirmed').length;
    const availableRoomsCount = availRooms?.length || 0;

    if (pendingArrivals > availableRoomsCount && pendingArrivals > 0) {
      alerts.push({
        id: `overbooking-${today}`,
        type: 'overbooking',
        message: `Overbooking risk: ${pendingArrivals} arrivals but only ${availableRoomsCount} rooms available`,
        guestName: undefined,
        roomNumber: undefined,
        time: timeStr,
        priority: 'high'
      });
    }

    // ── 5. Late check-out requests (today's departures still CheckedIn) ──
    const { data: lateCheckouts } = await supabaseAdmin
      .from('reservations')
      .select('id, guest_name, room_number, check_out_date, late_check_out_requested, status')
      .eq('check_out_date', today)
      .eq('status', 'CheckedIn')
      .eq('late_check_out_requested', true);

    lateCheckouts?.forEach((r: any) => {
      alerts.push({
        id: `late-checkout-${r.id}`,
        type: 'late-checkout',
        message: 'Late check-out requested',
        guestName: r.guest_name || 'Unknown',
        roomNumber: r.room_number || 'Unassigned',
        time: timeStr,
        priority: 'medium'
      });
    });

    // ── 6. Room assignment pending (arrivals today without room_number) ──
    const unassignedArrivals = (todayArrivals || []).filter(
      (r: any) => r.status === 'Confirmed' && !r.room_number
    );
    unassignedArrivals.forEach((r: any) => {
      alerts.push({
        id: `room-assignment-${r.id}`,
        type: 'room-assignment',
        message: 'Arrival today — room not yet assigned',
        guestName: r.guest_name || 'Unknown',
        roomNumber: 'Unassigned',
        time: timeStr,
        priority: 'medium'
      });
    });

    // ── 7. Unpaid arrivals (Confirmed, payment_status = Unpaid, arriving today) ──
    const { data: unpaidArrivals } = await supabaseAdmin
      .from('reservations')
      .select('id, guest_name, room_number, payment_status, total_amount, deposit_amount')
      .eq('check_in_date', today)
      .eq('status', 'Confirmed')
      .eq('payment_status', 'Unpaid');

    unpaidArrivals?.forEach((r: any) => {
      alerts.push({
        id: `unpaid-arrival-${r.id}`,
        type: 'unpaid-arrival',
        message: `Unpaid reservation arriving today — $${Number(r.total_amount || 0).toLocaleString()}`,
        guestName: r.guest_name || 'Unknown',
        roomNumber: r.room_number || 'Unassigned',
        time: timeStr,
        priority: 'medium'
      });
    });

    // ── 8. Pending guest requests (open requests assigned to front office) ──
    try {
      const { data: pendingReqs } = await supabaseAdmin
        .from('guest_requests')
        .select('id, request_number, guest_name, room_number, request_type, priority, status, submitted_at')
        .neq('status', 'Completed')
        .neq('status', 'Cancelled')
        .order('submitted_at', { ascending: false })
        .limit(10);

      pendingReqs?.forEach((r: any) => {
        alerts.push({
          id: `pending-request-${r.id}`,
          type: 'pending-request',
          message: `Pending guest request: ${r.request_type || 'General'}`,
          guestName: r.guest_name || 'Unknown',
          roomNumber: r.room_number || 'N/A',
          time: r.submitted_at ? new Date(r.submitted_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : 'Recently',
          priority: r.priority === 'high' ? 'high' : r.priority === 'medium' ? 'medium' : 'low'
        });
      });
    } catch (e) {
      // guest_requests table may not exist
      console.error('[Alerts] Guest requests error:', e);
    }

    // ── 9. Dirty rooms blocking arrivals (Vacant Dirty when arrivals pending) ──
    const { data: dirtyRoomsData } = await supabaseAdmin
      .from('rooms')
      .select('id, number, status')
      .eq('status', 'Vacant Dirty');

    if (dirtyRoomsData && dirtyRoomsData.length > 0 && pendingArrivals > 0) {
      alerts.push({
        id: `dirty-rooms-blocking-${today}`,
        type: 'dirty-rooms-blocking',
        message: `${dirtyRoomsData.length} dirty room(s) need turnover for ${pendingArrivals} pending arrival(s)`,
        guestName: undefined,
        roomNumber: dirtyRoomsData.slice(0, 5).map((r: any) => r.number).join(', ') + (dirtyRoomsData.length > 5 ? '...' : ''),
        time: timeStr,
        priority: 'medium'
      });
    }

    // ── 10. Long-stay guests (CheckedIn for more than 14 days) ─────────
    const { data: longStayRes } = await supabaseAdmin
      .from('reservations')
      .select('id, guest_name, room_number, check_in_date, check_out_date, status')
      .eq('status', 'CheckedIn');

    const longStayThreshold = 14; // days
    (longStayRes || []).forEach((r: any) => {
      if (!r.check_in_date) return;
      const checkIn = new Date(r.check_in_date);
      const daysStaying = Math.floor((now.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));
      if (daysStaying >= longStayThreshold) {
        alerts.push({
          id: `long-stay-${r.id}`,
          type: 'long-stay',
          message: `Long-stay guest: ${daysStaying} days in house`,
          guestName: r.guest_name || 'Unknown',
          roomNumber: r.room_number || 'Unassigned',
          time: `${daysStaying} days`,
          priority: 'low'
        });
      }
    });

    // ── 11. Group arrivals today ───────────────────────────────────────
    const { data: groupArrivals } = await supabaseAdmin
      .from('reservations')
      .select('id, guest_name, group_name, room_number, is_group, status')
      .eq('check_in_date', today)
      .eq('is_group', true)
      .in('status', ['Confirmed', 'CheckedIn']);

    if (groupArrivals && groupArrivals.length > 0) {
      // Group by group_name to avoid duplicate alerts
      const groupMap = new Map<string, { count: number; guestName: string }>();
      groupArrivals.forEach((r: any) => {
        const gName = r.group_name || r.guest_name || 'Unknown Group';
        const existing = groupMap.get(gName) || { count: 0, guestName: r.guest_name || 'Unknown' };
        existing.count += 1;
        groupMap.set(gName, existing);
      });
      groupMap.forEach((info, gName) => {
        alerts.push({
          id: `group-arrival-${gName.replace(/\s+/g, '-')}`,
          type: 'group-arrival',
          message: `Group arrival today: ${gName} (${info.count} room(s))`,
          guestName: info.guestName,
          roomNumber: 'Multiple',
          time: timeStr,
          priority: 'medium'
        });
      });
    }

    res.json({ alerts });
  } catch (error) {
    console.error('Alerts error:', error);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

// Dismiss an alert
router.post('/alerts/:id/dismiss', authenticate, requirePermission('front_office:manage'), async (req, res) => {
  const { id } = req.params;
  
  // In a real implementation, this would store dismissed alerts in a database
  // For now, we'll just log it and return success
  console.log(`Alert ${id} dismissed by user ${req.user?.id}`);
  
  await writeAuditEvent({
    req,
    user: req.user!,
    action: 'alert.dismissed',
    entityType: 'Alert',
    entityId: id,
    module: 'front_office',
    details: { alertId: id }
  });

  res.json({ success: true });
});

// ── Reservations ─────────────────────────────────────────────────────

// Create new reservation
router.post('/reservations', authenticate, requirePermission('front_office:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { 
      guest_id, 
      guest_name,
      guest_email,
      guest_phone,
      guest_status,
      check_in_date, 
      check_out_date, 
      adults, 
      children, 
      source, 
      status, 
      total_amount, 
      deposit_amount, 
      rooms,
      group_name,
      primary_contact,
      travel_agency,
      corporation
    } = req.body;

    // Generate reservation ID
    const reservationId = `RES-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Generate a unique group reservation ID for group bookings (distinct from group name)
    const groupId = group_name
      ? 'GRP-' + Math.random().toString(36).substring(2, 8).toUpperCase()
      : null;

    // Calculate nights and rate
    const nights = Math.ceil((new Date(check_out_date).getTime() - new Date(check_in_date).getTime()) / (1000 * 60 * 60 * 24)) || 1;
    const rate = total_amount / nights;

    // ── Availability check: prevent overbooking before insert ──
    // Aggregate requested quantity per room type from the rooms payload.
    const requestedByTypeId = new Map<string, number>();
    const requestedByTypeName = new Map<string, number>();
    for (const room of (rooms || [])) {
      const rtId = room.roomTypeId || null;
      const rtName = room.roomType || null;
      if (rtId) requestedByTypeId.set(rtId, (requestedByTypeId.get(rtId) || 0) + 1);
      if (rtName) requestedByTypeName.set(rtName, (requestedByTypeName.get(rtName) || 0) + 1);
    }
    // Single-room fallback when no rooms[] payload is provided
    const singleTypeName = rooms?.[0]?.roomType || req.body?.room_type;
    if (requestedByTypeId.size === 0 && requestedByTypeName.size === 0 && singleTypeName) {
      requestedByTypeName.set(singleTypeName, 1);
    }

    if (requestedByTypeId.size > 0 || requestedByTypeName.size > 0) {
      const { data: liveRooms, error: liveRoomsErr } = await supabaseAdmin.from('rooms').select('*');
      if (liveRoomsErr) return res.status(500).json({ error: liveRoomsErr.message });
      // Pull overlapping reservations (half-open: check_in < checkOut AND check_out > checkIn)
      const { data: liveRes, error: liveResErr } = await supabaseAdmin
        .from('reservations')
        .select('*')
        .lt('check_in_date', check_out_date)
        .gt('check_out_date', check_in_date);
      if (liveResErr) return res.status(500).json({ error: liveResErr.message });
      const liveRoomsList = liveRooms || [];
      const liveResList = liveRes || [];

      // Validate each requested room type. Prefer room_type_id match; fall back
      // to legacy name match via getTypeAvailability using the room_types lookup.
      const { data: rtLookup } = await supabaseAdmin.from('room_types').select('id, name');
      const idForName = new Map((rtLookup || []).map((rt: any) => [rt.name, rt.id]));

      for (const [rtId, qty] of requestedByTypeId.entries()) {
        const avail = getTypeAvailability(rtId, check_in_date, check_out_date, liveRoomsList, liveResList, undefined, qty);
        if (!avail.can_book) {
          return res.status(409).json({ error: `Only ${avail.available} room(s) available for room type ${rtId} (requested ${qty})`, availability: avail });
        }
      }
      for (const [rtName, qty] of requestedByTypeName.entries()) {
        const rtId = idForName.get(rtName);
        if (!rtId) continue; // unknown type — let DB FK/nullability decide
        const avail = getTypeAvailability(rtId, check_in_date, check_out_date, liveRoomsList, liveResList, undefined, qty);
        if (!avail.can_book) {
          return res.status(409).json({ error: `Only ${avail.available} ${rtName} room(s) available (requested ${qty})`, availability: avail });
        }
      }

      // If a specific room_number was assigned, verify it's not already booked
      // for an overlapping period by another reservation.
      const assignedNumbers = (rooms || []).map((r: any) => r.roomNumber).filter(Boolean);
      if (assignedNumbers.length > 0) {
        const conflicts = liveResList.filter((r: any) =>
          r.room_number && assignedNumbers.includes(r.room_number) &&
          r.status !== 'Cancelled' && r.status !== 'NoShow' &&
          rangesOverlap(check_in_date, check_out_date, r.check_in_date, r.check_out_date)
        );
        if (conflicts.length > 0) {
          return res.status(409).json({ error: `Room ${conflicts[0].room_number} is already booked for the selected dates` });
        }
      }
    }

    // Build notes object with group information if provided
    const notesObj: any = {};
    if (group_name || primary_contact || travel_agency || corporation) {
      notesObj.groupName = group_name;
      notesObj.primaryContact = primary_contact;
      notesObj.travelAgency = travel_agency;
      notesObj.corporation = corporation;
    }

    // Build reservation data using existing database structure
    const reservationData: any = {
      id: reservationId,
      guest_id: guest_id || null,
      guest_name: guest_name || 'Guest Name',
      guest_email: guest_email || 'guest@example.com',
      guest_phone: guest_phone || '',
      guest_status: guest_status || 'Regular',
      room_type: rooms?.[0]?.roomType || 'Standard',
      room_number: rooms?.[0]?.roomNumber || null,
      check_in_date: check_in_date,
      check_out_date: check_out_date,
      adults: adults,
      children: children,
      status: status || 'Confirmed',
      rate: rate,
      total_amount: total_amount,
      channel: source || 'Direct Website',
      payment_status: 'Unpaid',
      notes: JSON.stringify(notesObj),
      deposit_amount: deposit_amount || 0,
      is_deposit_paid: deposit_amount > 0,
      // Use existing group fields — group reservation ID (not group name)
      group_booking_id: groupId,
      booking_group_id: groupId,
      corporate_account_id: corporation || null,
      is_group: !!group_name
    };

    // Insert reservation
    const { error: insertError } = await supabaseAdmin
      .from('reservations')
      .insert(reservationData);

    if (insertError) return res.status(500).json({ error: insertError.message });

    // Insert reservation_rooms if provided and table exists
    if (rooms && Array.isArray(rooms) && rooms.length > 0) {
      try {
        const roomEntries = rooms.map((room: any) => ({
          reservation_id: reservationId,
          room_type: room.roomType,
          room_number: room.roomNumber || null,
          adults: room.adults,
          children: room.children,
          amount: room.amount,
          check_in_date: check_in_date,
          check_out_date: check_out_date
        }));

        const { error: roomsInsertError } = await supabaseAdmin
          .from('reservation_rooms')
          .insert(roomEntries);

        if (roomsInsertError) {
          console.error('Error inserting reservation rooms (table may not exist yet):', roomsInsertError);
          // Continue without reservation_rooms - it's optional for now
        }
      } catch (e) {
        console.log('reservation_rooms table not available, using single room from main reservation');
      }
    }

    await writeAuditEvent({
      req,
      user: req.user!,
      action: 'reservation.created',
      entityType: 'Reservation',
      entityId: reservationId,
      module: 'front_office',
      details: { ...reservationData, rooms }
    });

    res.json({ success: true, reservationId });
  } catch (error) {
    console.error('Reservation creation error:', error);
    res.status(500).json({ error: 'Failed to create reservation' });
  }
});

// Get all reservations with filtering (TEMP: No auth for testing)
router.get('/reservations', async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { source, status, search, startDate, endDate } = req.query;

    // First try to get reservations with guest information
    let query = supabaseAdmin
      .from('reservations')
      .select(`
        id,
        guest_id,
        guest_name,
        guest_email,
        guest_phone,
        check_in_date,
        check_out_date,
        status,
        adults,
        children,
        total_amount,
        deposit_amount,
        channel as source,
        room_type,
        room_number,
        notes,
        group_booking_id,
        booking_group_id,
        corporate_account_id,
        is_group
      `);

    // Apply filters
    if (source) {
      query = query.eq('channel', source);
    }
    if (status) {
      query = query.eq('status', status);
    }
    if (search) {
      query = query.or(`id.ilike.%${search}%,guest_name.ilike.%${search}%,guest_email.ilike.%${search}%,guest_phone.ilike.%${search}%,notes.ilike.%${search}%`);
    }
    if (startDate) {
      query = query.gte('check_in_date', startDate);
    }
    if (endDate) {
      query = query.lte('check_out_date', endDate);
    }

    const { data: reservations, error } = await query.order('check_in_date', { ascending: true });

    if (error) {
      console.error('Database query error:', error);
      return res.status(500).json({ error: error.message });
    }

    // Fetch group names from group_bookings table for any reservations that belong to a group.
    // This ensures groupName reflects the actual group name (e.g. "Smith Wedding") rather than
    // falling back to the group booking ID (e.g. "GRP-XXXXXX").
    const groupIds = Array.from(new Set(
      (reservations || [])
        .map((r: any) => r.group_booking_id || r.booking_group_id)
        .filter((id: any) => id && typeof id === 'string' && id.startsWith('GRP-'))
    ));

    const groupNameById: Record<string, string> = {};
    if (groupIds.length > 0) {
      const { data: groupBookings, error: gbError } = await supabaseAdmin
        .from('group_bookings')
        .select('id, group_name')
        .in('id', groupIds);

      if (!gbError && groupBookings) {
        for (const gb of groupBookings) {
          if (gb.group_name) groupNameById[gb.id] = gb.group_name;
        }
      }
    }

    // Transform data to match frontend interface
    const transformedReservations = reservations?.map((res: any) => {
      // Calculate nights
      const nights = Math.ceil((new Date(res.check_out_date).getTime() - new Date(res.check_in_date).getTime()) / (1000 * 60 * 60 * 24));

      // Parse group information from notes if group_booking_id exists
      let groupName = null;
      let primaryContact = null;
      let travelAgency = null;
      let corporation = null;

      const groupId = res.group_booking_id || res.booking_group_id;

      if (groupId || res.is_group) {
        try {
          const notesObj = typeof res.notes === 'string' ? JSON.parse(res.notes || '{}') : (res.notes || {});
          // Prefer the group name from the group_bookings table (looked up above).
          // Fall back to notes.groupName only if the table lookup didn't find one.
          groupName = (groupId && groupNameById[groupId]) || notesObj.groupName || null;
          primaryContact = notesObj.primaryContact;
          travelAgency = notesObj.travelAgency;
          corporation = notesObj.corporation || res.corporate_account_id;
        } catch (e) {
          // If notes parsing fails, still try to use the looked-up group name
          groupName = (groupId && groupNameById[groupId]) || null;
        }
      }
      
      // Extract guest name from notes if available, otherwise use placeholder
      let guestName = 'Guest';
      try {
        const notesObj = typeof res.notes === 'string' ? JSON.parse(res.notes || '{}') : (res.notes || {});
        guestName = notesObj.guestName || res.guest_name || 'Guest';
      } catch (e) {
        guestName = res.guest_name || 'Guest';
      }
      
      // For now, create single room from main reservation data
      const rooms = [{
        roomType: res.room_type || 'Standard',
        roomNumber: res.room_number,
        adults: res.adults || 1,
        children: res.children || 0,
        amount: res.total_amount || 0
      }];
      
      return {
        id: res.id,
        guest_id: res.guest_id,
        booking_group_id: res.booking_group_id,
        guestName: guestName,
        rooms: rooms,
        checkIn: res.check_in_date,
        checkOut: res.check_out_date,
        nights: nights,
        totalAdults: res.adults || 1,
        totalChildren: res.children || 0,
        source: res.source || 'walk-in',
        status: res.status.toLowerCase(),
        totalAmount: res.total_amount,
        deposit: res.deposit_amount,
        balance: res.total_amount - (res.deposit_amount || 0),
        groupName: groupName,
        primaryContact: primaryContact,
        travelAgency: travelAgency,
        corporation: corporation
      };
    }) || [];

    res.json({ reservations: transformedReservations });
  } catch (error) {
    console.error('Reservations fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch reservations' });
  }
});

// Get single guest by ID
// Get single reservation by ID
router.get('/reservations/:id', authenticate, requirePermission('front_office:view'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { id } = req.params;

    const { data: reservation, error } = await supabaseAdmin
      .from('reservations')
      .select(`
        *,
        guests!inner(*),
        room_types!inner(*),
        rooms!inner(*),
        folios!inner(*)
      `)
      .eq('id', id)
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!reservation) return res.status(404).json({ error: 'Reservation not found' });

    res.json({ reservation });
  } catch (error) {
    console.error('Reservation fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch reservation' });
  }
});

// Update rooms for a reservation
router.put('/reservations/:id/rooms', authenticate, requirePermission('front_office:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { id } = req.params;
    const { rooms, groupFields } = req.body;

    // Validate rooms array
    if (!Array.isArray(rooms) || rooms.length === 0) {
      return res.status(400).json({ error: 'Invalid rooms data' });
    }

    // Conflict check: verify none of the requested room numbers are already
    // booked by another Confirmed/CheckedIn reservation for overlapping dates.
    const requestedRoomNumbers = rooms.map((r: any) => r.roomNumber).filter(Boolean);
    if (requestedRoomNumbers.length > 0) {
      const { data: targetRes, error: targetError } = await supabaseAdmin
        .from('reservations')
        .select('check_in_date, check_out_date')
        .eq('id', id)
        .maybeSingle();
      if (targetError || !targetRes) {
        return res.status(404).json({ error: targetError?.message || 'Reservation not found' });
      }

      const { data: conflicts, error: conflictError } = await supabaseAdmin
        .from('reservations')
        .select('id, guest_name, room_number, check_in_date, check_out_date')
        .in('room_number', requestedRoomNumbers)
        .neq('id', id)
        .in('status', ['Confirmed', 'CheckedIn'])
        .lt('check_in_date', targetRes.check_out_date)
        .gt('check_out_date', targetRes.check_in_date)
        .limit(1);
      if (conflictError) return res.status(500).json({ error: conflictError.message });
      if (conflicts && conflicts.length > 0) {
        const c = conflicts[0];
        return res.status(409).json({
          error: `Room ${c.room_number} is already booked by reservation ${c.id} (${c.guest_name}) for ${c.check_in_date} to ${c.check_out_date}.`
        });
      }
    }

    // Calculate totals from rooms
    const totalAdults = rooms.reduce((sum: number, room: any) => sum + (room.adults || 0), 0);
    const totalChildren = rooms.reduce((sum: number, room: any) => sum + (room.children || 0), 0);
    const totalAmount = rooms.reduce((sum: number, room: any) => sum + (room.amount || 0), 0);

    // Build update object using existing database structure
    const updateData: any = {
      adults: totalAdults,
      children: totalChildren,
      total_amount: totalAmount,
      room_type: rooms[0]?.roomType || 'Standard',
      room_number: rooms[0]?.roomNumber || null
    };

    // Add group fields using existing database columns
    if (groupFields) {
      // Generate a unique group reservation ID (distinct from group name) if group is being set
      const existingGroupId = req.body.groupId || null;
      const newGroupId = groupFields.groupName
        ? (existingGroupId || 'GRP-' + Math.random().toString(36).substring(2, 8).toUpperCase())
        : null;
      updateData.group_booking_id = newGroupId;
      updateData.booking_group_id = newGroupId;
      updateData.corporate_account_id = groupFields.corporation || null;
      updateData.is_group = !!groupFields.groupName;
      
      // Store detailed group info in notes
      const notesObj: any = {
        groupName: groupFields.groupName,
        primaryContact: groupFields.primaryContact,
        travelAgency: groupFields.travelAgency,
        corporation: groupFields.corporation
      };
      updateData.notes = JSON.stringify(notesObj);
    }

    // Update reservation with new totals and group fields
    const { error: updateError } = await supabaseAdmin
      .from('reservations')
      .update(updateData)
      .eq('id', id);

    if (updateError) return res.status(500).json({ error: updateError.message });

    // Try to update reservation_rooms if table exists
    try {
      // Delete existing reservation_rooms for this reservation
      await supabaseAdmin
        .from('reservation_rooms')
        .delete()
        .eq('reservation_id', id);

      // Get reservation dates for new room entries
      const { data: reservation } = await supabaseAdmin
        .from('reservations')
        .select('check_in_date, check_out_date')
        .eq('id', id)
        .single();

      if (reservation) {
        // Insert new reservation_rooms entries
        const roomEntries = rooms.map((room: any) => ({
          reservation_id: id,
          room_type: room.roomType,
          room_number: room.roomNumber || null,
          adults: room.adults,
          children: room.children,
          amount: room.amount,
          check_in_date: reservation.check_in_date,
          check_out_date: reservation.check_out_date
        }));

        await supabaseAdmin
          .from('reservation_rooms')
          .insert(roomEntries);
      }
    } catch (e) {
      console.log('reservation_rooms table not available, using single room from main reservation');
    }

    await writeAuditEvent({
      req,
      user: req.user!,
      action: 'reservation.rooms_updated',
      entityType: 'Reservation',
      entityId: id,
      module: 'front_office',
      details: { rooms, totalAdults, totalChildren, totalAmount, groupFields }
    });

    res.json({ success: true, rooms, totalAdults, totalChildren, totalAmount, groupFields });
  } catch (error) {
    console.error('Update rooms error:', error);
    res.status(500).json({ error: 'Failed to update reservation rooms' });
  }
});

// ── Business Intelligence ───────────────────────────────────────────

// BI Dashboard data
router.get('/bi/dashboard', authenticate, requirePermission('front_office:view'), async (req, res) => {
  const { range = '30d' } = req.query;
  
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    // Calculate date range
    const days = parseInt(range.toString().replace('d', '')) || 30;
    const startDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];

    // Fetch revenue data
    const { data: revenueData } = await supabaseAdmin
      .from('folios')
      .select('created_at, total_amount, room_revenue, food_beverage_revenue, other_revenue')
      .gte('created_at', startDate)
      .order('created_at');

    // Fetch occupancy data
    const { data: occupancyData } = await supabaseAdmin
      .from('daily_occupancy')
      .select('*')
      .gte('date', startDate)
      .order('date');

    // Fetch channel performance
    const { data: channelData } = await supabaseAdmin
      .from('reservations')
      .select('channel, total_amount, created_at')
      .gte('created_at', startDate);

    // Process channel data
    const channelMap = new Map();
    let totalRevenue = 0;
    let totalBookings = 0;
    
    channelData?.forEach((res: any) => {
      const channel = res.channel || 'Direct';
      if (!channelMap.has(channel)) {
        channelMap.set(channel, { bookings: 0, revenue: 0 });
      }
      const data = channelMap.get(channel);
      data.bookings++;
      data.revenue += res.total_amount || 0;
      totalRevenue += res.total_amount || 0;
      totalBookings++;
    });

    const channels = Array.from(channelMap.entries()).map(([channel, data]) => ({
      channel,
      bookings: data.bookings,
      revenue: data.revenue,
      share: totalRevenue > 0 ? (data.revenue / totalRevenue) * 100 : 0,
      conversion: totalBookings > 0 ? (data.bookings / totalBookings) * 100 : 0
    }));

    // Fetch real guest segments data
    const { data: segmentData } = await supabaseAdmin
      .from('market_segments')
      .select(`
        segment_name,
        segment_metrics (
          total_revenue,
          total_bookings,
          avg_length_of_stay,
          guest_satisfaction_score
        )
      `)
      .eq('is_active', true);

    const segments = segmentData?.map((segment: any) => ({
      segment: segment.segment_name,
      count: segment.segment_metrics?.[0]?.total_bookings || 0,
      revenue: segment.segment_metrics?.[0]?.total_revenue || 0,
      avgStay: segment.segment_metrics?.[0]?.avg_length_of_stay || 0,
      satisfaction: segment.segment_metrics?.[0]?.guest_satisfaction_score || 0
    })) || [];

    // Calculate real KPIs from the data
    const totalRevenueValue = revenueData?.reduce((sum: number, f: any) => sum + (f.total_amount || 0), 0) || 0;
    
    // Calculate occupancy rate from occupancy data
    const avgOccupancyRate = occupancyData && occupancyData.length > 0 
      ? (occupancyData.reduce((sum: number, d: any) => sum + (d.occupancy_rate || 0), 0) / occupancyData.length).toFixed(1)
      : '0.0';
    
    // Calculate ADR from revenue and room nights
    const totalRoomNights = occupancyData?.reduce((sum: number, d: any) => sum + (d.occupied_rooms || 0), 0) || 0;
    const avgADR = totalRoomNights > 0 ? (totalRevenueValue / totalRoomNights).toFixed(0) : '0';
    
    // Calculate RevPAR
    const totalRooms = occupancyData?.[0]?.total_rooms || 0; // Fallback to 0 if not available
    const avgRevPAR = totalRooms > 0 ? (totalRevenueValue / totalRooms).toFixed(0) : '0';

    res.json({
      kpis: [
        { label: 'Total Revenue', value: totalRevenueValue, change: 0, changeType: 'positive', icon: 'DollarSign', format: 'currency' },
        { label: 'Occupancy Rate', value: parseFloat(avgOccupancyRate), change: 0, changeType: 'positive', icon: 'Users', format: 'percentage' },
        { label: 'Average ADR', value: parseFloat(avgADR), change: 0, changeType: 'positive', icon: 'TrendingUp', format: 'currency' },
        { label: 'RevPAR', value: parseFloat(avgRevPAR), change: 0, changeType: 'positive', icon: 'BarChart3', format: 'currency' },
      ],
      revenue: revenueData || [],
      occupancy: occupancyData || [],
      channels,
      segments
    });
  } catch (error) {
    console.error('BI Dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch BI dashboard data' });
  }
});

// Export BI dashboard data
router.get('/bi/dashboard/export', authenticate, requirePermission('front_office:export'), async (req, res) => {
  const { format = 'csv' } = req.query;
  
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    // Fetch the same data as the dashboard
    const { range = '30d' } = req.query;
    const days = parseInt(range.toString().replace('d', '')) || 30;
    const startDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];

    const { data: revenueData } = await supabaseAdmin
      .from('folios')
      .select('created_at, total_amount, room_revenue, food_beverage_revenue, other_revenue')
      .gte('created_at', startDate)
      .order('created_at');

    if (format === 'csv') {
      // Generate CSV
      const headers = ['Date', 'Total Revenue', 'Room Revenue', 'F&B Revenue', 'Other Revenue'];
      const rows = revenueData?.map((row: any) => [
        row.created_at,
        row.total_amount,
        row.room_revenue,
        row.food_beverage_revenue,
        row.other_revenue
      ]) || [];
      
      const csv = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="bi-dashboard-${startDate}.csv"`);
      res.send(csv);
    } else {
      res.status(400).json({ error: 'Unsupported export format' });
    }
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Failed to export dashboard data' });
  }
});

// ── Guest Profiles ─────────────────────────────────────────────────────

// Get all guests with search and filtering
router.get('/guests', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { search, status, loyaltyTier, sortBy = 'name', sortOrder = 'asc', limit = 50, offset = 0 } = req.query;

    // Build a count query (without pagination/order) to get the total
    let countQuery = supabaseAdmin
      .from('guests')
      .select('*', { count: 'exact', head: true });

    let query = supabaseAdmin
      .from('guests')
      .select('*');

    // Apply search filter
    if (search) {
      const escaped = String(search).replace(/,/g, '');
      const searchFilter = `name.ilike.%${escaped}%,email.ilike.%${escaped}%,phone.ilike.%${escaped}%`;
      query = query.or(searchFilter);
      countQuery = countQuery.or(searchFilter);
    }

    // Apply status filter
    if (status) {
      query = query.eq('status', status);
      countQuery = countQuery.eq('status', status);
    }

    // Apply loyalty tier filter (derived from loyalty_points thresholds)
    if (loyaltyTier) {
      const tier = String(loyaltyTier);
      let pointsFilter: (n: number) => string;
      switch (tier) {
        case 'diamond': pointsFilter = (n) => `loyalty_points.gte.${n}`; break;
        case 'platinum': pointsFilter = (n) => `loyalty_points.gte.${n}`; break;
        case 'gold': pointsFilter = (n) => `loyalty_points.gte.${n}`; break;
        case 'silver': pointsFilter = (n) => `loyalty_points.gte.${n}`; break;
        default: pointsFilter = () => ''; break;
      }
      const thresholds: Record<string, number> = { diamond: 10000, platinum: 5000, gold: 2500, silver: 1000 };
      if (thresholds[tier]) {
        query = query.filter('loyalty_points', 'gte', String(thresholds[tier]));
        countQuery = countQuery.filter('loyalty_points', 'gte', String(thresholds[tier]));
        void pointsFilter;
      }
    }

    // Apply sorting
    const allowedSortColumns = ['name', 'email', 'phone', 'nationality', 'status', 'loyalty_points', 'total_spend', 'created_at'];
    const sortColumn = allowedSortColumns.includes(String(sortBy)) ? String(sortBy) : 'name';
    query = query.order(sortColumn, { ascending: sortOrder !== 'desc' });

    // Apply pagination
    const limitNum = Math.min(Math.max(parseInt(limit as string) || 50, 1), 200);
    const offsetNum = Math.max(parseInt(offset as string) || 0, 0);
    query = query.range(offsetNum, offsetNum + limitNum - 1);

    const [guestsResult, countResult] = await Promise.all([
      query,
      countQuery,
    ]);

    const { data: guests, error } = guestsResult;
    const { count: total } = countResult;

    if (error) return res.status(500).json({ error: error.message });

    // Transform data to match frontend interface
    const transformedGuests = guests?.map((guest: any) => {
      // Parse preferences
      const preferences = guest.preferences || {};
      
      // Parse identification document
      const idDoc = guest.identification_doc || {};
      
      // Calculate loyalty tier based on points
      let loyaltyTier = 'none';
      if (guest.loyalty_points >= 10000) loyaltyTier = 'diamond';
      else if (guest.loyalty_points >= 5000) loyaltyTier = 'platinum';
      else if (guest.loyalty_points >= 2500) loyaltyTier = 'gold';
      else if (guest.loyalty_points >= 1000) loyaltyTier = 'silver';

      // Split name into first and last name
      const nameParts = guest.name?.split(' ') || ['', ''];
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      return {
        id: guest.id,
        firstName: firstName,
        lastName: lastName,
        email: guest.email,
        phone: guest.phone || '',
        nationality: guest.nationality || '',
        passportNumber: idDoc.number || '',
        visaInfo: idDoc.visaInfo || '',
        idDocument: idDoc,
        emergencyContact: preferences.emergencyContact || null,
        company: preferences.company || null,
        preferences: {
          language: preferences.language || 'English',
          roomType: preferences.roomType || 'Standard',
          pillowType: preferences.pillowType || 'Medium',
          bedType: preferences.bedType || 'Queen',
          dietary: preferences.dietary || 'None',
          newspaper: preferences.newspaper || 'None',
          amenities: preferences.amenities || []
        },
        history: {
          totalStays: 0, // Will be calculated from reservations
          totalRevenue: guest.total_spend || 0,
          totalNights: 0, // Will be calculated from reservations
          lastStay: null, // Will be fetched from reservations
          stayFrequency: 'Occasional',
          loyaltyTier: loyaltyTier as any,
          loyaltyPoints: guest.loyalty_points || 0,
          complaints: 0, // Will be calculated from feedback
          compliments: 0, // Will be calculated from feedback
          blacklistStatus: guest.status === 'blacklisted'
        },
        parentGroupId: guest.parent_group_id,
        parentCorporateId: guest.parent_corporate_id,
        status: guest.status,
        specialRequests: guest.special_requests,
        notes: guest.notes
      };
    }) || [];

    // Fetch reservation history for each guest
    for (const guest of transformedGuests) {
      const { data: reservations } = await supabaseAdmin
        .from('reservations')
        .select('check_in_date, check_out_date, total_amount')
        .eq('guest_id', guest.id)
        .in('status', ['Confirmed', 'CheckedIn', 'CheckedOut']);

      if (reservations && reservations.length > 0) {
        guest.history.totalStays = reservations.length;
        guest.history.totalNights = reservations.reduce((sum: number, res: any) => {
          const nights = Math.ceil((new Date(res.check_out_date).getTime() - new Date(res.check_in_date).getTime()) / (1000 * 60 * 60 * 24));
          return sum + nights;
        }, 0);
        guest.history.lastStay = reservations[0].check_in_date;
        
        // Determine stay frequency
        if (guest.history.totalStays >= 10) guest.history.stayFrequency = 'Regular';
        else if (guest.history.totalStays >= 5) guest.history.stayFrequency = 'Frequent';
        else guest.history.stayFrequency = 'Occasional';
      }
    }

    res.json({ guests: transformedGuests, total: total ?? transformedGuests.length, limit: Math.min(Math.max(parseInt(limit as string) || 50, 1), 200), offset: Math.max(parseInt(offset as string) || 0, 0) });
  } catch (error) {
    console.error('Guests fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch guests' });
  }
});

// Get single guest by ID with full details
router.get('/guests/:id', authenticate, requirePermission('front_office:view'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { id } = req.params;
    // ?minimal=true skips reservation history, group profile, and group
    // memberships — used by the edit-guest form which only needs the guest
    // record itself. This avoids several sequential round-trips and makes the
    // "Loading guest for editing..." state resolve near-instantly.
    const minimal = req.query.minimal === 'true';

    const { data: guest, error } = await supabaseAdmin
      .from('guests')
      .select('*')
      .eq('id', id)
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!guest) return res.status(404).json({ error: 'Guest not found' });

    // For the edit form we only need the guest record — skip the heavy extras.
    if (minimal) {
      const idDoc = guest.identification_doc || {};
      const nameParts = guest.name?.split(' ') || ['', ''];
      const transformedGuest = {
        id: guest.id,
        firstName: nameParts[0] || '',
        lastName: nameParts.slice(1).join(' ') || '',
        email: guest.email,
        phone: guest.phone || '',
        nationality: guest.nationality || '',
        passportNumber: idDoc.number || '',
        visaInfo: idDoc.visaInfo || '',
        idDocument: idDoc,
        emergencyContact: (guest.preferences || {}).emergencyContact || null,
        company: (guest.preferences || {}).company || null,
        preferences: (guest.preferences || {}),
        status: guest.status,
        specialRequests: guest.special_requests,
        notes: guest.notes,
        loyaltyPoints: guest.loyalty_points || 0,
        raw: guest
      };
      return res.json({ guest: transformedGuest, reservations: [], groupProfile: null, groupMemberships: [], rawGuest: guest });
    }

    // Fetch reservation history, group profile, and group memberships in
    // parallel — these are independent of each other (groupProfile only
    // depends on guest.parent_group_id, which is already known).
    const reservationsPromise = supabaseAdmin
      .from('reservations')
      .select('*')
      .eq('guest_id', id)
      .in('status', ['Confirmed', 'CheckedIn', 'CheckedOut'])
      .order('check_in_date', { ascending: false });

    const groupProfilePromise = guest.parent_group_id
      ? supabaseAdmin.from('group_profiles').select('*').eq('id', guest.parent_group_id).single()
      : Promise.resolve({ data: null, error: null });

    const groupMembershipsPromise = Promise.resolve(
      supabaseAdmin.rpc('get_guest_active_groups', { p_guest_id: id })
    ).catch((e: any) => {
      // RPC may not exist in older schemas — fail soft, fall back to legacy groupProfile.
      console.warn('get_guest_active_groups RPC unavailable:', e?.message);
      return { data: null, error: e };
    });

    const [
      { data: reservations },
      { data: group },
      { data: memberships, error: membershipsError },
    ] = await Promise.all([reservationsPromise, groupProfilePromise, groupMembershipsPromise]);

    const groupProfile = group;
    let groupMemberships: any[] = [];
    if (!membershipsError && memberships) {
      groupMemberships = memberships;
    }

    // Build a transformed guest shape (consistent with the list endpoint) so the
    // frontend detail view can rely on a single interface regardless of source.
    const preferences = guest.preferences || {};
    const idDoc = guest.identification_doc || {};
    let loyaltyTier = 'none';
    if (guest.loyalty_points >= 10000) loyaltyTier = 'diamond';
    else if (guest.loyalty_points >= 5000) loyaltyTier = 'platinum';
    else if (guest.loyalty_points >= 2500) loyaltyTier = 'gold';
    else if (guest.loyalty_points >= 1000) loyaltyTier = 'silver';
    const nameParts = guest.name?.split(' ') || ['', ''];
    const totalNights = (reservations || []).reduce((sum: number, res: any) => {
      const nights = Math.ceil((new Date(res.check_out_date).getTime() - new Date(res.check_in_date).getTime()) / (1000 * 60 * 60 * 24));
      return sum + (isFinite(nights) ? nights : 0);
    }, 0);
    const transformedGuest = {
      id: guest.id,
      firstName: nameParts[0] || '',
      lastName: nameParts.slice(1).join(' ') || '',
      email: guest.email,
      phone: guest.phone || '',
      nationality: guest.nationality || '',
      passportNumber: idDoc.number || '',
      visaInfo: idDoc.visaInfo || '',
      idDocument: idDoc,
      emergencyContact: preferences.emergencyContact || null,
      company: preferences.company || null,
      preferences: {
        language: preferences.language || 'English',
        roomType: preferences.roomType || 'Standard',
        pillowType: preferences.pillowType || 'Medium',
        bedType: preferences.bedType || 'Queen',
        dietary: preferences.dietary || 'None',
        newspaper: preferences.newspaper || 'None',
        amenities: preferences.amenities || []
      },
      history: {
        totalStays: (reservations || []).length,
        totalRevenue: guest.total_spend || 0,
        totalNights,
        lastStay: reservations && reservations[0] ? reservations[0].check_in_date : null,
        stayFrequency: (reservations || []).length >= 10 ? 'Regular' : (reservations || []).length >= 5 ? 'Frequent' : 'Occasional',
        loyaltyTier,
        loyaltyPoints: guest.loyalty_points || 0,
        complaints: 0,
        compliments: 0,
        blacklistStatus: guest.status === 'blacklisted'
      },
      parentGroupId: guest.parent_group_id,
      parentCorporateId: guest.parent_corporate_id,
      status: guest.status,
      specialRequests: guest.special_requests,
      notes: guest.notes,
      // Raw fields also exposed for the detail view
      raw: guest
    };

    res.json({ guest: transformedGuest, reservations, groupProfile, groupMemberships, rawGuest: guest });
  } catch (error) {
    console.error('Guest fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch guest' });
  }
});

// Create new guest
router.post('/guests', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { firstName, lastName, email, phone, nationality, passportNumber, visaInfo, idDocument, emergencyContact, company, preferences, status, loyaltyPoints, notes, specialRequests } = req.body;

    // Build full name for deduplication check
    const fullName = `${firstName} ${lastName}`;

    // FIXED: Check for existing guest with same email AND name before creating
    const { data: existingGuest } = await supabaseAdmin
      .from('guests')
      .select('id')
      .eq('email', email)
      .eq('name', fullName)
      .limit(1)
      .single();

    if (existingGuest) {
      // Guest already exists, return existing ID
      return res.json({ success: true, guestId: existingGuest.id, existing: true });
    }

    // Generate guest ID only if no existing guest found
    const guestId = `GST-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Build preferences object
    const preferencesObj: any = {
      language: preferences?.language || 'English',
      roomType: preferences?.roomType || 'Standard',
      pillowType: preferences?.pillowType || 'Medium',
      bedType: preferences?.bedType || 'Queen',
      dietary: preferences?.dietary || 'None',
      newspaper: preferences?.newspaper || 'None',
      amenities: preferences?.amenities || []
    };

    if (emergencyContact) {
      preferencesObj.emergencyContact = emergencyContact;
    }

    if (company) {
      preferencesObj.company = company;
    }

    // Build identification document object (merge passportNumber/visaInfo with structured idDocument)
    const idDocObj: any = {};
    if (passportNumber || idDocument?.number) {
      idDocObj.number = idDocument?.number || passportNumber;
    }
    if (visaInfo || idDocument?.visaInfo) {
      idDocObj.visaInfo = idDocument?.visaInfo || visaInfo;
    }
    if (idDocument) {
      if (idDocument.type) idDocObj.type = idDocument.type;
      if (idDocument.expiryDate) idDocObj.expiryDate = idDocument.expiryDate;
      if (idDocument.issueDate) idDocObj.issueDate = idDocument.issueDate;
      if (idDocument.issuingCountry) idDocObj.issuingCountry = idDocument.issuingCountry;
      if (idDocument.frontImageUrl) idDocObj.frontImageUrl = idDocument.frontImageUrl;
      if (idDocument.backImageUrl) idDocObj.backImageUrl = idDocument.backImageUrl;
    }

    // Validate status against DB constraint
    const validStatuses = ['VIP', 'Regular', 'Loyalty Member'];
    const finalStatus = status && validStatuses.includes(status) ? status : 'Regular';

    // Insert guest
    const guestData = {
      id: guestId,
      name: fullName,
      email: email,
      phone: phone || null,
      nationality: nationality || null,
      status: finalStatus,
      loyalty_points: typeof loyaltyPoints === 'number' ? loyaltyPoints : 0,
      total_spend: 0,
      preferences: preferencesObj,
      identification_doc: idDocObj,
      special_requests: specialRequests || '',
      notes: notes || ''
    };

    const { error: insertError } = await supabaseAdmin
      .from('guests')
      .insert(guestData);

    if (insertError) return res.status(500).json({ error: insertError.message });

    await writeAuditEvent({
      req,
      user: req.user!,
      action: 'guest.created',
      entityType: 'Guest',
      entityId: guestId,
      module: 'front_office',
      details: guestData
    });

    res.json({ success: true, guestId });
  } catch (error) {
    console.error('Guest creation error:', error);
    res.status(500).json({ error: 'Failed to create guest' });
  }
});

// Update guest
router.put('/guests/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { id } = req.params;
    const { firstName, lastName, email, phone, nationality, passportNumber, visaInfo, idDocument, emergencyContact, company, preferences, status, loyaltyPoints, notes, specialRequests } = req.body;

    // Build preferences object
    const preferencesObj: any = {
      language: preferences?.language || 'English',
      roomType: preferences?.roomType || 'Standard',
      pillowType: preferences?.pillowType || 'Medium',
      bedType: preferences?.bedType || 'Queen',
      dietary: preferences?.dietary || 'None',
      newspaper: preferences?.newspaper || 'None',
      amenities: preferences?.amenities || []
    };

    if (emergencyContact) {
      preferencesObj.emergencyContact = emergencyContact;
    }

    if (company) {
      preferencesObj.company = company;
    }

    // Fetch existing identification_doc to preserve image URLs and verified status
    const { data: existingGuest } = await supabaseAdmin
      .from('guests')
      .select('identification_doc')
      .eq('id', id)
      .maybeSingle();
    const existingDoc = (existingGuest?.identification_doc as Record<string, any>) || {};

    // Build identification document object (merge with existing to preserve image URLs)
    const idDocObj: any = { ...existingDoc };
    if (passportNumber || idDocument?.number) {
      idDocObj.number = idDocument?.number || passportNumber;
    }
    if (visaInfo || idDocument?.visaInfo) {
      idDocObj.visaInfo = idDocument?.visaInfo || visaInfo;
    }
    if (idDocument) {
      if (idDocument.type !== undefined) idDocObj.type = idDocument.type;
      if (idDocument.expiryDate !== undefined) idDocObj.expiryDate = idDocument.expiryDate;
      if (idDocument.issueDate !== undefined) idDocObj.issueDate = idDocument.issueDate;
      if (idDocument.issuingCountry !== undefined) idDocObj.issuingCountry = idDocument.issuingCountry;
      // Only overwrite image URLs if explicitly provided (preserve existing otherwise)
      if (idDocument.frontImageUrl !== undefined) idDocObj.frontImageUrl = idDocument.frontImageUrl;
      if (idDocument.backImageUrl !== undefined) idDocObj.backImageUrl = idDocument.backImageUrl;
    }

    // Update guest
    const updateData: any = {
      name: `${firstName} ${lastName}`,
      email: email,
      phone: phone || null,
      nationality: nationality || null,
      preferences: preferencesObj,
      identification_doc: idDocObj
    };

    // Validate status against DB constraint before applying
    const validStatuses = ['VIP', 'Regular', 'Loyalty Member'];
    if (status && validStatuses.includes(status)) updateData.status = status;
    if (typeof loyaltyPoints === 'number') updateData.loyalty_points = Math.max(0, Math.floor(loyaltyPoints));
    if (notes !== undefined) updateData.notes = notes;
    if (specialRequests !== undefined) updateData.special_requests = specialRequests;

    const { error: updateError } = await supabaseAdmin
      .from('guests')
      .update(updateData)
      .eq('id', id);

    if (updateError) return res.status(500).json({ error: updateError.message });

    await writeAuditEvent({
      req,
      user: req.user!,
      action: 'guest.updated',
      entityType: 'Guest',
      entityId: id,
      module: 'front_office',
      details: updateData
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Guest update error:', error);
    res.status(500).json({ error: 'Failed to update guest' });
  }
});

// Delete a guest profile (refuses if guest has active/future reservations)
router.delete('/guests/:id', authenticate, requirePermission('front_office:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { id } = req.params;

    // Block deletion if guest has non-cancelled reservations
    const { data: blockingRes, error: resError } = await supabaseAdmin
      .from('reservations')
      .select('id, status')
      .eq('guest_id', id)
      .in('status', ['Confirmed', 'CheckedIn', 'Waitlisted'])
      .limit(1);

    if (resError) return res.status(500).json({ error: resError.message });
    if (blockingRes && blockingRes.length > 0) {
      return res.status(409).json({ error: 'Cannot delete guest with active or confirmed reservations.' });
    }

    const { error } = await supabaseAdmin
      .from('guests')
      .delete()
      .eq('id', id);

    if (error) return res.status(500).json({ error: error.message });

    await writeAuditEvent({
      req,
      user: req.user!,
      action: 'guest.deleted',
      entityType: 'Guest',
      entityId: id,
      module: 'front_office',
      details: {}
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Guest deletion error:', error);
    res.status(500).json({ error: 'Failed to delete guest' });
  }
});

// Update guest ID document (metadata + image URLs)
// Files are uploaded client-side to the `id-cards` Supabase storage bucket;
// this endpoint persists the metadata + public URLs to guests.identification_doc.
router.put('/guests/:id/id-document', authenticate, requirePermission('front_office:edit'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { id } = req.params;
    const {
      docType,
      docNumber,
      expiryDate,
      issueDate,
      issuingCountry,
      frontImageUrl,
      backImageUrl,
    } = req.body;

    // Fetch existing identification_doc to merge (preserve fields not provided)
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('guests')
      .select('identification_doc')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) return res.status(500).json({ error: fetchError.message });

    const existingDoc = (existing?.identification_doc as Record<string, any>) || {};

    const identificationDoc: Record<string, any> = {
      type: docType ?? existingDoc.type ?? null,
      number: docNumber ?? existingDoc.number ?? null,
      expiryDate: expiryDate ?? existingDoc.expiryDate ?? null,
      issueDate: issueDate ?? existingDoc.issueDate ?? null,
      issuingCountry: issuingCountry ?? existingDoc.issuingCountry ?? null,
      frontImageUrl: frontImageUrl ?? existingDoc.frontImageUrl ?? null,
      backImageUrl: backImageUrl ?? existingDoc.backImageUrl ?? null,
      uploadedAt: new Date().toISOString(),
      isUploaded: Boolean(frontImageUrl || backImageUrl || existingDoc.frontImageUrl || existingDoc.backImageUrl),
      verifiedAt: existingDoc.verifiedAt ?? null,
    };

    const { error: updateError } = await supabaseAdmin
      .from('guests')
      .update({ identification_doc: identificationDoc })
      .eq('id', id);

    if (updateError) return res.status(500).json({ error: updateError.message });

    await writeAuditEvent({
      req,
      user: req.user!,
      action: 'guest.id_document_updated',
      entityType: 'Guest',
      entityId: id,
      module: 'front_office',
      details: { docType: identificationDoc.type, hasFrontImage: Boolean(identificationDoc.frontImageUrl), hasBackImage: Boolean(identificationDoc.backImageUrl) }
    });

    res.json({ success: true, identificationDoc });
  } catch (error) {
    console.error('ID document update error:', error);
    res.status(500).json({ error: 'Failed to update ID document' });
  }
});

// Merge duplicate guest profiles (source -> target)
router.post('/guests/merge', authenticate, requirePermission('front_office:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { sourceId, targetId } = req.body;
    if (!sourceId || !targetId) return res.status(400).json({ error: 'sourceId and targetId are required' });
    if (sourceId === targetId) return res.status(400).json({ error: 'Cannot merge a guest with itself' });

    // Reassign reservations from source to target
    const { error: resError } = await supabaseAdmin
      .from('reservations')
      .update({ guest_id: targetId })
      .eq('guest_id', sourceId);

    if (resError) return res.status(500).json({ error: resError.message });

    // Sum loyalty points and total_spend into target
    const { data: source } = await supabaseAdmin
      .from('guests')
      .select('loyalty_points, total_spend')
      .eq('id', sourceId)
      .single();

    if (source) {
      const { data: target } = await supabaseAdmin
        .from('guests')
        .select('loyalty_points, total_spend')
        .eq('id', targetId)
        .single();

      if (target) {
        await supabaseAdmin
          .from('guests')
          .update({
            loyalty_points: (target.loyalty_points || 0) + (source.loyalty_points || 0),
            total_spend: (target.total_spend || 0) + (source.total_spend || 0)
          })
          .eq('id', targetId);
      }
    }

    // Delete the source guest
    const { error: delError } = await supabaseAdmin
      .from('guests')
      .delete()
      .eq('id', sourceId);

    if (delError) return res.status(500).json({ error: delError.message });

    await writeAuditEvent({
      req,
      user: req.user!,
      action: 'guest.merged',
      entityType: 'Guest',
      entityId: targetId,
      module: 'front_office',
      details: { sourceId, targetId }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Guest merge error:', error);
    res.status(500).json({ error: 'Failed to merge guests' });
  }
});

// Get all group profiles
router.get('/groups', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { search, limit = 50, offset = 0 } = req.query;

    let query = supabaseAdmin
      .from('group_profiles')
      .select('*');

    // Apply search filter
    if (search) {
      query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`);
    }

    // Apply pagination
    query = query.range(parseInt(offset as string), parseInt(offset as string) + parseInt(limit as string) - 1);

    const { data: groups, error } = await query;

    if (error) return res.status(500).json({ error: error.message });

    res.json({ groups: groups || [] });
  } catch (error) {
    console.error('Groups fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// Get group profile by ID
router.get('/groups/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { id } = req.params;

    const { data: group, error } = await supabaseAdmin
      .from('group_profiles')
      .select('*')
      .eq('id', id)
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!group) return res.status(404).json({ error: 'Group not found' });

    // Fetch group members
    const { data: members } = await supabaseAdmin
      .from('guests')
      .select('*')
      .eq('parent_group_id', id);

    // Fetch group reservations
    const { data: reservations } = await supabaseAdmin
      .from('reservations')
      .select('*')
      .eq('group_booking_id', id)
      .or(`booking_group_id.eq.${id}`);

    res.json({ group, members: members || [], reservations: reservations || [] });
  } catch (error) {
    console.error('Group fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch group' });
  }
});

// Create new group profile
router.post('/groups', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { name, type, email, phone, address, city, state, zip_code, country, notes } = req.body;

    // Generate group ID
    const groupId = `GRP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const { data: group, error } = await supabaseAdmin
      .from('group_profiles')
      .insert({
        id: groupId,
        name: name,
        type: type || 'Other',
        email: email,
        phone: phone,
        address: address,
        city: city,
        state: state,
        zip_code: zip_code,
        country: country,
        notes: notes || ''
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true, group });
  } catch (error) {
    console.error('Group creation error:', error);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// Update group profile
router.put('/groups/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { id } = req.params;
    const { name, type, email, phone, address, city, state, zip_code, country, notes } = req.body;

    const { data: group, error } = await supabaseAdmin
      .from('group_profiles')
      .update({
        name: name,
        type: type,
        email: email,
        phone: phone,
        address: address,
        city: city,
        state: state,
        zip_code: zip_code,
        country: country,
        notes: notes,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!group) return res.status(404).json({ error: 'Group not found' });

    res.json({ success: true, group });
  } catch (error) {
    console.error('Group update error:', error);
    res.status(500).json({ error: 'Failed to update group' });
  }
});

// Delete group profile
router.delete('/groups/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from('group_profiles')
      .delete()
      .eq('id', id);

    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true });
  } catch (error) {
    console.error('Group deletion error:', error);
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

// ── Night Audit ────────────────────────────────────────────────────

// Get current night audit summary and recent history
router.get('/night-audit', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { data: current, error: currentError } = await supabaseAdmin
      .from('business_dates')
      .select('*')
      .eq('id', 'current')
      .single();

    if (currentError || !current) {
      return res.status(404).json({ error: 'Business date not found', details: currentError?.message });
    }

    const businessDate = current.business_date;

    const [roomsResult, folioLinesResult, reservationsResult, historyResult] = await Promise.all([
      supabaseAdmin.from('rooms').select('status'),
      supabaseAdmin.from('folio_lines').select('amount, posted_to_gl').eq('transaction_date', businessDate).eq('is_voided', false),
      supabaseAdmin.from('reservations').select('status, check_in_date, check_out_date, channel'),
      supabaseAdmin.from('business_dates').select('*').order('business_date', { ascending: false }).limit(30),
    ]);

    if (roomsResult.error) throw roomsResult.error;
    if (folioLinesResult.error) throw folioLinesResult.error;
    if (reservationsResult.error) throw reservationsResult.error;

    const rooms = roomsResult.data || [];
    const folioLines = folioLinesResult.data || [];
    const reservations = reservationsResult.data || [];
    const historyRows = (historyResult.data || []) as any[];

    const totalRooms = rooms.length;
    const occupiedRooms = rooms.filter((r: any) => (r.status || '').toLowerCase().startsWith('occupied')).length;
    const expectedRevenue = folioLines.reduce((sum, l: any) => sum + Number(l.amount || 0), 0);
    const postedRevenue = current.is_night_audit_complete
      ? Number(current.revenue_posted || 0)
      : folioLines.filter((l: any) => l.posted_to_gl).reduce((sum, l: any) => sum + Number(l.amount || 0), 0);
    const transactions = folioLines.length;
    const checkedIn = reservations.filter((r: any) => r.status === 'CheckedIn' && r.check_in_date === businessDate).length;
    const checkedOut = reservations.filter((r: any) => r.status === 'CheckedOut' && r.check_out_date === businessDate).length;
    const noShows = reservations.filter((r: any) => r.status === 'NoShow').length;
    const walkIns = reservations.filter((r: any) => (r.channel || '').toLowerCase() === 'walkin').length;

    const status: 'not_started' | 'in_progress' | 'completed' | 'failed' = current.is_night_audit_complete
      ? 'completed'
      : current.night_audit_started_at
      ? 'in_progress'
      : 'not_started';

    const summary = {
      date: businessDate,
      status,
      startedAt: current.night_audit_started_at,
      completedAt: current.night_audit_completed_at,
      totalRooms,
      occupiedRooms,
      expectedRevenue,
      postedRevenue,
      variance: expectedRevenue - postedRevenue,
      transactions,
      checkedIn,
      checkedOut,
      noShows,
      walkIns,
    };

    const history = historyRows.map((row: any) => ({
      date: row.business_date,
      status: row.is_night_audit_complete ? 'completed' : row.night_audit_started_at ? 'in_progress' : 'not_started',
      startedAt: row.night_audit_started_at,
      completedAt: row.night_audit_completed_at,
      totalRooms,
      occupiedRooms: Number(row.rooms_sold || 0),
      expectedRevenue: Number(row.revenue_posted || 0),
      postedRevenue: Number(row.revenue_posted || 0),
      variance: 0,
      transactions: 0,
      checkedIn: Number(row.arrivals || 0),
      checkedOut: Number(row.departures || 0),
      noShows: Number(row.no_shows || 0),
      walkIns: 0,
    }));

    res.json({ summary, history });
  } catch (error) {
    console.error('Error fetching night audit:', error);
    res.status(500).json({ error: 'Failed to fetch night audit' });
  }
});

// Run night audit for the current business date
router.post('/night-audit/run', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { data: current, error: currentError } = await supabaseAdmin
      .from('business_dates')
      .select('*')
      .eq('id', 'current')
      .single();

    if (currentError || !current) {
      return res.status(404).json({ error: 'Business date not found', details: currentError?.message });
    }

    const businessDate = current.business_date;

    const [roomsResult, folioLinesResult, reservationsResult] = await Promise.all([
      supabaseAdmin.from('rooms').select('status'),
      supabaseAdmin.from('folio_lines').select('amount, posted_to_gl').eq('transaction_date', businessDate).eq('is_voided', false),
      supabaseAdmin.from('reservations').select('status, check_in_date, check_out_date, channel'),
    ]);

    if (roomsResult.error) throw roomsResult.error;
    if (folioLinesResult.error) throw folioLinesResult.error;
    if (reservationsResult.error) throw reservationsResult.error;

    const rooms = roomsResult.data || [];
    const folioLines = folioLinesResult.data || [];
    const reservations = reservationsResult.data || [];

    const totalRooms = rooms.length;
    const occupiedRooms = rooms.filter((r: any) => (r.status || '').toLowerCase().startsWith('occupied')).length;
    const expectedRevenue = folioLines.reduce((sum, l: any) => sum + Number(l.amount || 0), 0);
    const transactions = folioLines.length;
    const checkedIn = reservations.filter((r: any) => r.status === 'CheckedIn' && r.check_in_date === businessDate).length;
    const checkedOut = reservations.filter((r: any) => r.status === 'CheckedOut' && r.check_out_date === businessDate).length;
    const noShows = reservations.filter((r: any) => r.status === 'NoShow').length;
    const walkIns = reservations.filter((r: any) => (r.channel || '').toLowerCase() === 'walkin').length;

    const now = new Date().toISOString();

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('business_dates')
      .update({
        is_night_audit_complete: true,
        night_audit_started_at: current.night_audit_started_at || now,
        night_audit_completed_at: now,
        night_audit_by: req.user?.id || null,
        revenue_posted: expectedRevenue,
        rooms_sold: occupiedRooms,
        arrivals: checkedIn,
        departures: checkedOut,
        no_shows: noShows,
        exceptions_count: 0,
        exceptions: [],
        updated_at: now,
      })
      .eq('id', 'current')
      .select()
      .single();

    if (updateError) throw updateError;

    const summary = {
      date: businessDate,
      status: 'completed' as const,
      startedAt: updated?.night_audit_started_at || now,
      completedAt: updated?.night_audit_completed_at || now,
      totalRooms,
      occupiedRooms,
      expectedRevenue,
      postedRevenue: expectedRevenue,
      variance: 0,
      transactions,
      checkedIn,
      checkedOut,
      noShows,
      walkIns,
    };

    writeAuditEvent({
      req,
      user: req.user!,
      action: 'front_office.night_audit.completed',
      module: 'front_office',
      entityType: 'business_date',
      entityId: 'current',
      details: { businessDate, summary },
      outcome: 'success',
    }).catch((err: any) => {
      console.error('Failed to write night audit audit event:', err);
    });

    res.json({ success: true, summary });
  } catch (error) {
    console.error('Error running night audit:', error);
    res.status(500).json({ error: 'Failed to run night audit' });
  }
});

// ── Keys & Access Management ───────────────────────────────────────────

// Fetch keys with optional filters
router.get('/keys', authenticate, requirePermission('front_office:view'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { status, accessLevel, search } = req.query;

    let query = supabaseAdmin.from('keys').select('*').order('issued_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    if (accessLevel) {
      query = query.eq('access_level', accessLevel);
    }

    if (search) {
      query = query.or(`guest_name.ilike.%${search}%,staff_name.ilike.%${search}%,room_number.ilike.%${search}%,key_code.ilike.%${search}%,reservation_id.ilike.%${search}%`);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching keys:', error);
      return res.status(500).json({ error: error.message });
    }

    res.json({ keys: data || [] });
  } catch (error) {
    console.error('Error in keys fetch:', error);
    res.status(500).json({ error: 'Failed to fetch keys' });
  }
});

// Fetch a single key by ID
router.get('/keys/:keyId', authenticate, requirePermission('front_office:view'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { keyId } = req.params;

    const { data, error } = await supabaseAdmin
      .from('keys')
      .select('*')
      .eq('id', keyId)
      .single();

    if (error) {
      console.error('Error fetching key:', error);
      return res.status(500).json({ error: error.message });
    }

    if (!data) {
      return res.status(404).json({ error: 'Key not found' });
    }

    res.json({ key: data });
  } catch (error) {
    console.error('Error in key fetch:', error);
    res.status(500).json({ error: 'Failed to fetch key' });
  }
});

// Encode a new key
router.post('/keys', authenticate, requirePermission('front_office:edit'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const {
      guestName,
      reservationId,
      roomNumber,
      keyType,
      accessLevel,
      expiresAt,
      notes,
      encoderId,
    } = req.body;

    if (!keyType || !accessLevel || !expiresAt) {
      return res.status(400).json({ error: 'keyType, accessLevel, and expiresAt are required' });
    }

    // Generate a unique key code
    const keyCode = `K-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    const keyData = {
      guest_name: guestName || null,
      reservation_id: reservationId || null,
      room_number: roomNumber || null,
      key_code: keyCode,
      key_type: keyType,
      access_level: accessLevel,
      status: 'active',
      expires_at: expiresAt,
      issued_by: req.user?.name || 'System',
      notes: notes || '',
    };

    const { data, error } = await supabaseAdmin
      .from('keys')
      .insert(keyData)
      .select()
      .single();

    if (error) {
      console.error('Error encoding key:', error);
      return res.status(500).json({ error: error.message });
    }

    // Update encoder encodings_today count if encoderId provided
    if (encoderId) {
      try {
        await supabaseAdmin.rpc('increment_encodings_today', { p_encoder_id: encoderId });
      } catch {
        // Ignore if function doesn't exist yet or encoder not found
      }
    }

    // Write audit event
    writeAuditEvent({
      req,
      user: req.user!,
      action: 'CREATE',
      module: 'front_office',
      entityType: 'key',
      entityId: data.id,
      details: { keyCode, keyType, accessLevel, roomNumber },
      outcome: 'success',
    }).catch((err: any) => {
      console.error('Failed to write audit event:', err);
    });

    res.json({ key: data });
  } catch (error) {
    console.error('Error in key encoding:', error);
    res.status(500).json({ error: 'Failed to encode key' });
  }
});

// Update a key
router.patch('/keys/:keyId', authenticate, requirePermission('front_office:edit'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { keyId } = req.params;
    const {
      guestName,
      reservationId,
      roomNumber,
      keyType,
      accessLevel,
      expiresAt,
      notes,
    } = req.body;

    const updateData: any = {};
    if (guestName !== undefined) updateData.guest_name = guestName || null;
    if (reservationId !== undefined) updateData.reservation_id = reservationId || null;
    if (roomNumber !== undefined) updateData.room_number = roomNumber || null;
    if (keyType !== undefined) updateData.key_type = keyType;
    if (accessLevel !== undefined) updateData.access_level = accessLevel;
    if (expiresAt !== undefined) updateData.expires_at = expiresAt;
    if (notes !== undefined) updateData.notes = notes;

    const { data, error } = await supabaseAdmin
      .from('keys')
      .update(updateData)
      .eq('id', keyId)
      .select()
      .single();

    if (error) {
      console.error('Error updating key:', error);
      return res.status(500).json({ error: error.message });
    }

    if (!data) {
      return res.status(404).json({ error: 'Key not found' });
    }

    // Write audit event
    writeAuditEvent({
      req,
      user: req.user!,
      action: 'UPDATE',
      module: 'front_office',
      entityType: 'key',
      entityId: keyId,
      details: updateData,
      outcome: 'success',
    }).catch((err: any) => {
      console.error('Failed to write audit event:', err);
    });

    res.json({ key: data });
  } catch (error) {
    console.error('Error in key update:', error);
    res.status(500).json({ error: 'Failed to update key' });
  }
});

// Return a key (mark as returned/deactivated)
router.patch('/keys/:keyId/return', authenticate, requirePermission('front_office:edit'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { keyId } = req.params;
    const { notes } = req.body;

    const { data, error } = await supabaseAdmin
      .from('keys')
      .update({
        status: 'returned',
        returned_at: new Date().toISOString(),
        notes: notes || '',
      })
      .eq('id', keyId)
      .select()
      .single();

    if (error) {
      console.error('Error returning key:', error);
      return res.status(500).json({ error: error.message });
    }

    if (!data) {
      return res.status(404).json({ error: 'Key not found' });
    }

    // Write audit event
    writeAuditEvent({
      req,
      user: req.user!,
      action: 'UPDATE',
      module: 'front_office',
      entityType: 'key',
      entityId: keyId,
      details: { status: 'returned', notes },
      outcome: 'success',
    }).catch((err: any) => {
      console.error('Failed to write audit event:', err);
    });

    res.json({ key: data });
  } catch (error) {
    console.error('Error in key return:', error);
    res.status(500).json({ error: 'Failed to return key' });
  }
});

// Delete a key
router.delete('/keys/:keyId', authenticate, requirePermission('front_office:edit'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { keyId } = req.params;

    const { error } = await supabaseAdmin
      .from('keys')
      .delete()
      .eq('id', keyId);

    if (error) {
      console.error('Error deleting key:', error);
      return res.status(500).json({ error: error.message });
    }

    // Write audit event
    writeAuditEvent({
      req,
      user: req.user!,
      action: 'DELETE',
      module: 'front_office',
      entityType: 'key',
      entityId: keyId,
      details: {},
      outcome: 'success',
    }).catch((err: any) => {
      console.error('Failed to write audit event:', err);
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error in key deletion:', error);
    res.status(500).json({ error: 'Failed to delete key' });
  }
});

// Fetch key encoders
router.get('/keys/encoders', authenticate, requirePermission('front_office:view'), async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { data, error } = await supabaseAdmin
      .from('key_encoders')
      .select('*')
      .order('name');

    if (error) {
      console.error('Error fetching encoders:', error);
      return res.status(500).json({ error: error.message });
    }

    res.json({ encoders: data || [] });
  } catch (error) {
    console.error('Error in encoders fetch:', error);
    res.status(500).json({ error: 'Failed to fetch encoders' });
  }
});

// Fetch access logs
router.get('/keys/access-logs', authenticate, requirePermission('front_office:view'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { startDate, endDate, keyCode, limit } = req.query;

    let query = supabaseAdmin
      .from('access_logs')
      .select('*')
      .order('time', { ascending: false });

    if (startDate) {
      query = query.gte('time', startDate);
    }

    if (endDate) {
      query = query.lte('time', endDate);
    }

    if (keyCode) {
      query = query.eq('key_code', keyCode);
    }

    if (limit) {
      query = query.limit(Number(limit));
    } else {
      query = query.limit(100); // Default limit
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching access logs:', error);
      return res.status(500).json({ error: error.message });
    }

    res.json({ logs: data || [] });
  } catch (error) {
    console.error('Error in access logs fetch:', error);
    res.status(500).json({ error: 'Failed to fetch access logs' });
  }
});

// Fetch key statistics
router.get('/keys/stats', authenticate, requirePermission('front_office:view'), async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { data, error } = await supabaseAdmin.rpc('get_key_stats');

    if (error) {
      console.error('Error fetching key stats:', error);
      return res.status(500).json({ error: error.message });
    }

    res.json(data || {
      activeKeys: 0,
      dueOutToday: 0,
      lostDamaged: 0,
      onlineEncoders: 0,
    });
  } catch (error) {
    console.error('Error in key stats fetch:', error);
    res.status(500).json({ error: 'Failed to fetch key stats' });
  }
});

// Print a key card (generates print job)
router.post('/keys/:keyId/print', authenticate, requirePermission('front_office:edit'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { keyId } = req.params;

    // Verify key exists
    const { data: key, error: keyError } = await supabaseAdmin
      .from('keys')
      .select('*')
      .eq('id', keyId)
      .single();

    if (keyError || !key) {
      return res.status(404).json({ error: 'Key not found' });
    }

    // Generate a print job ID
    const jobId = `PRINT-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    // Write audit event
    writeAuditEvent({
      req,
      user: req.user!,
      action: 'PRINT',
      module: 'front_office',
      entityType: 'key',
      entityId: keyId,
      details: { keyCode: key.key_code, jobId },
      outcome: 'success',
    }).catch((err: any) => {
      console.error('Failed to write audit event:', err);
    });

    res.json({ jobId });
  } catch (error) {
    console.error('Error in key print:', error);
    res.status(500).json({ error: 'Failed to print key card' });
  }
});

// ── Guest Requests ──────────────────────────────────────────────────────

// Get all guest requests with optional filtering
router.get('/guest-requests', async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { status, priority, department, search } = req.query as Record<string, string>;
    
    let query = supabaseAdmin
      .from('guest_requests')
      .select('*')
      .order('submitted_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (priority) query = query.eq('priority', priority);
    if (department) query = query.eq('assigned_department', department);
    if (search) {
      query = query.or(`guest_name.ilike.%${search}%,room_number.ilike.%${search}%,description.ilike.%${search}%,request_number.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    res.json({ requests: data || [] });
  } catch (error) {
    console.error('Error fetching guest requests:', error);
    res.status(500).json({ error: 'Failed to fetch guest requests' });
  }
});

// Get guest request statistics
router.get('/guest-requests/stats', async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const today = new Date().toISOString().split('T')[0];

    // Get count by status
    const { data: statusCounts, error: statusError } = await supabaseAdmin
      .from('guest_requests')
      .select('status')
      .gte('submitted_at', today);

    if (statusError) return res.status(500).json({ error: statusError.message });

    const pending = statusCounts?.filter(r => r.status === 'Open' || r.status === 'pending').length || 0;
    const inProgress = statusCounts?.filter(r => r.status === 'In Progress' || r.status === 'assigned').length || 0;
    const completedToday = statusCounts?.filter(r => r.status === 'Completed' || r.status === 'completed').length || 0;

    // Calculate average response time (from submission to acknowledgment)
    const { data: responseTimes } = await supabaseAdmin
      .from('guest_requests')
      .select('submitted_at, acknowledged_at')
      .not('acknowledged_at', 'is', null)
      .gte('submitted_at', today);

    let avgResponseTime = '0 min';
    if (responseTimes && responseTimes.length > 0) {
      const totalMinutes = responseTimes.reduce((sum, req) => {
        const submitted = new Date(req.submitted_at).getTime();
        const acknowledged = new Date(req.acknowledged_at!).getTime();
        return sum + (acknowledged - submitted) / (1000 * 60);
      }, 0);
      avgResponseTime = `${Math.round(totalMinutes / responseTimes.length)} min`;
    }

    // Get analytics data
    const { data: allRequests } = await supabaseAdmin
      .from('guest_requests')
      .select('*')
      .gte('submitted_at', today);

    const totalToday = allRequests?.length || 0;
    
    // Calculate average resolution time
    const completedRequests = allRequests?.filter(r => r.completed_at) || [];
    let avgResolutionTime = '0 min';
    if (completedRequests.length > 0) {
      const totalMinutes = completedRequests.reduce((sum, req) => {
        const submitted = new Date(req.submitted_at).getTime();
        const completed = new Date(req.completed_at!).getTime();
        return sum + (completed - submitted) / (1000 * 60);
      }, 0);
      avgResolutionTime = `${Math.round(totalMinutes / completedRequests.length)} min`;
    }

    // Calculate satisfaction rate
    const ratedRequests = allRequests?.filter(r => r.rating) || [];
    let satisfactionRate = '0/5';
    if (ratedRequests.length > 0) {
      const avgRating = ratedRequests.reduce((sum, req) => sum + (req.rating || 0), 0) / ratedRequests.length;
      satisfactionRate = `${avgRating.toFixed(1)}/5`;
    }

    // Get top category
    const categoryCounts: Record<string, number> = {};
    allRequests?.forEach(req => {
      const category = req.request_type || 'Other';
      categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    });
    
    let topCategory = 'None';
    let topCategoryCount = 0;
    let topCategoryPercent = '0%';
    
    if (Object.keys(categoryCounts).length > 0) {
      topCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0][0];
      topCategoryCount = categoryCounts[topCategory];
      topCategoryPercent = totalToday > 0 ? `${Math.round((topCategoryCount / totalToday) * 100)}%` : '0%';
    }

    res.json({
      pending,
      inProgress,
      completedToday,
      avgResponseTime,
      totalToday,
      avgResolutionTime,
      satisfactionRate,
      topCategory,
      topCategoryPercent
    });
  } catch (error) {
    console.error('Error fetching guest request stats:', error);
    res.status(500).json({ error: 'Failed to fetch guest request statistics' });
  }
});

// Get a single guest request by ID
router.get('/guest-requests/:id', async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from('guest_requests')
      .select('*')
      .eq('id', id)
      .single();

    if (error) return res.status(404).json({ error: 'Guest request not found' });

    res.json(data);
  } catch (error) {
    console.error('Error fetching guest request:', error);
    res.status(500).json({ error: 'Failed to fetch guest request' });
  }
});

// Create a new guest request
router.post('/guest-requests', async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const {
      reservationId,
      roomNumber,
      guestName,
      requestType,
      description,
      priority,
      notes,
      assignedDepartment,
      propertyId
    } = req.body || {};

    if (!guestName || !description) {
      return res.status(400).json({ error: 'Guest name and description are required' });
    }

    // Generate request number
    const requestNumber = `REQ-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    const insertRow: any = {
      request_number: requestNumber,
      reservation_id: reservationId || null,
      room_number: roomNumber || null,
      guest_name: guestName,
      request_type: requestType || 'Housekeeping',
      description,
      priority: priority || 'Normal',
      status: 'Open',
      notes: notes || null,
      submitted_at: new Date().toISOString(),
    };
    if (assignedDepartment) insertRow.assigned_department = assignedDepartment;
    if (propertyId) insertRow.property_id = propertyId;

    const { data, error } = await supabaseAdmin.from('guest_requests').insert(insertRow).select().single();

    if (error) return res.status(500).json({ error: error.message });

    // Write audit event
    writeAuditEvent({
      req,
      user: req.user!,
      action: 'CREATE',
      module: 'front_office',
      entityType: 'guest_request',
      entityId: data.id,
      details: { requestNumber: data.request_number, guestName, requestType },
      outcome: 'success'
    }).catch((err: any) => {
      console.error('Failed to write audit event:', err);
    });

    res.status(201).json(data);
  } catch (error) {
    console.error('Error creating guest request:', error);
    res.status(500).json({ error: 'Failed to create guest request' });
  }
});

// Update a guest request
router.put('/guest-requests/:id', async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { id } = req.params;
    const {
      status,
      assignedTo,
      assignedDepartment,
      priority,
      notes,
      rating,
      feedback
    } = req.body || {};

    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (status) {
      updateData.status = status;
      if (status === 'In Progress' || status === 'assigned') {
        updateData.acknowledged_at = new Date().toISOString();
      }
      if (status === 'Completed' || status === 'completed') {
        updateData.completed_at = new Date().toISOString();
      }
    }
    if (assignedTo) updateData.assigned_to = assignedTo;
    if (assignedDepartment) updateData.assigned_department = assignedDepartment;
    if (priority) updateData.priority = priority;
    if (notes !== undefined) updateData.notes = notes;
    if (rating !== undefined) updateData.rating = rating;
    if (feedback !== undefined) updateData.feedback = feedback;

    const { data, error } = await supabaseAdmin
      .from('guest_requests')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Notify the guest of the status change in their notification feed.
    if (status && data?.guest_id) {
      const label = data.service_name || data.request_type || 'Your request';
      const { error: notifErr } = await supabaseAdmin.from('guest_notifications').insert({
        guest_id: data.guest_id,
        reservation_id: data.reservation_id || null,
        property_id: data.property_id || null,
        category: 'request_update',
        title: `Request ${data.status}`,
        message: `${label} is now ${data.status}.`,
      });
      if (notifErr) console.warn('guest request notification insert failed:', notifErr.message);
    }

    // Write audit event
    writeAuditEvent({
      req,
      user: req.user!,
      action: 'UPDATE',
      module: 'front_office',
      entityType: 'guest_request',
      entityId: id,
      details: updateData,
      outcome: 'success'
    }).catch((err: any) => {
      console.error('Failed to write audit event:', err);
    });

    res.json(data);
  } catch (error) {
    console.error('Error updating guest request:', error);
    res.status(500).json({ error: 'Failed to update guest request' });
  }
});

// Delete a guest request
router.delete('/guest-requests/:id', async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from('guest_requests')
      .delete()
      .eq('id', id);

    if (error) return res.status(500).json({ error: error.message });

    // Write audit event
    writeAuditEvent({
      req,
      user: req.user!,
      action: 'DELETE',
      module: 'front_office',
      entityType: 'guest_request',
      entityId: id,
      details: {},
      outcome: 'success'
    }).catch((err: any) => {
      console.error('Failed to write audit event:', err);
    });

    res.json({ success: true, message: 'Guest request deleted successfully' });
  } catch (error) {
    console.error('Error deleting guest request:', error);
    res.status(500).json({ error: 'Failed to delete guest request' });
  }
});

// Get staff members for assignment
router.get('/guest-requests/staff', async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    // This would typically query a staff table, but for now we'll return a static list
    // In a real implementation, this should query a staff/employees table
    const staff = [
      { id: 'STF-01', name: 'Housekeeping A', role: 'Housekeeper', department: 'Housekeeping', available: true, activeRequests: 0 },
      { id: 'STF-02', name: 'Housekeeping B', role: 'Housekeeper', department: 'Housekeeping', available: true, activeRequests: 0 },
      { id: 'STF-03', name: 'Maintenance A', role: 'Technician', department: 'Engineering', available: true, activeRequests: 0 },
      { id: 'STF-04', name: 'Maintenance B', role: 'Technician', department: 'Engineering', available: true, activeRequests: 0 },
      { id: 'STF-05', name: 'Room Service', role: 'Server', department: 'F&B', available: true, activeRequests: 0 },
      { id: 'STF-06', name: 'Concierge', role: 'Concierge', department: 'Front Office', available: true, activeRequests: 0 },
    ];

    // In a real implementation, you would calculate active requests from the database
    const { data: requests } = await supabaseAdmin
      .from('guest_requests')
      .select('assigned_to, status')
      .in('status', ['Open', 'pending', 'In Progress', 'assigned']);

    // Count active requests per staff member
    const requestCounts: Record<string, number> = {};
    requests?.forEach(req => {
      if (req.assigned_to) {
        requestCounts[req.assigned_to] = (requestCounts[req.assigned_to] || 0) + 1;
      }
    });

    const staffWithCounts = staff.map(member => ({
      ...member,
      activeRequests: requestCounts[member.name] || 0
    }));

    res.json({ staff: staffWithCounts });
  } catch (error) {
    console.error('Error fetching staff:', error);
    res.status(500).json({ error: 'Failed to fetch staff' });
  }
});

// ── Communications Center ──────────────────────────────────────────────

// Get all communications with optional filtering
router.get('/communications', async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { status, type, channel, search } = req.query as Record<string, string>;
    
    let query = supabaseAdmin
      .from('communications')
      .select('*')
      .order('sent_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (type) query = query.eq('type', type);
    if (channel) query = query.eq('channel', channel);
    if (search) {
      query = query.or(`subject.ilike.%${search}%,content.ilike.%${search}%,from_name.ilike.%${search}%,to_name.ilike.%${search}%,message_number.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    res.json({ communications: data || [] });
  } catch (error) {
    console.error('Error fetching communications:', error);
    res.status(500).json({ error: 'Failed to fetch communications' });
  }
});

// Get communication statistics
router.get('/communications/stats', async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const today = new Date().toISOString().split('T')[0];

    // Get count by status
    const { data: statusCounts, error: statusError } = await supabaseAdmin
      .from('communications')
      .select('status')
      .gte('sent_at', today);

    if (statusError) return res.status(500).json({ error: statusError.message });

    const unread = statusCounts?.filter(c => c.status === 'unread').length || 0;
    const read = statusCounts?.filter(c => c.status === 'read').length || 0;
    const replied = statusCounts?.filter(c => c.status === 'replied').length || 0;

    // Get counts by type
    const { data: typeCounts } = await supabaseAdmin
      .from('communications')
      .select('type')
      .gte('sent_at', today);

    const messages = typeCounts?.filter(c => c.type === 'message').length || 0;
    const notifications = typeCounts?.filter(c => c.type === 'notification').length || 0;
    const alerts = typeCounts?.filter(c => c.type === 'alert').length || 0;
    const reminders = typeCounts?.filter(c => c.type === 'reminder').length || 0;

    // Get priority counts
    const { data: priorityCounts } = await supabaseAdmin
      .from('communications')
      .select('priority')
      .gte('sent_at', today);

    const urgent = priorityCounts?.filter(c => c.priority === 'urgent').length || 0;
    const high = priorityCounts?.filter(c => c.priority === 'high').length || 0;

    res.json({
      unread,
      read,
      replied,
      messages,
      notifications,
      alerts,
      reminders,
      urgent,
      high
    });
  } catch (error) {
    console.error('Error fetching communication stats:', error);
    res.status(500).json({ error: 'Failed to fetch communication statistics' });
  }
});

// Get a single communication by ID
router.get('/communications/:id', async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from('communications')
      .select('*')
      .eq('id', id)
      .single();

    if (error) return res.status(404).json({ error: 'Communication not found' });

    res.json(data);
  } catch (error) {
    console.error('Error fetching communication:', error);
    res.status(500).json({ error: 'Failed to fetch communication' });
  }
});

// Create a new communication
router.post('/communications', async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const {
      to,
      toType,
      subject,
      content,
      channel,
      priority,
      roomId,
      reservationId,
      guestId
    } = req.body || {};

    if (!to || !content) {
      return res.status(400).json({ error: 'Recipient and content are required' });
    }

    // Generate message number
    const messageNumber = `MSG-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    const { data, error } = await supabaseAdmin.from('communications').insert({
      message_number: messageNumber,
      type: 'message',
      from_name: 'Front Desk',
      from_type: 'staff',
      to_name: to,
      to_type: toType || 'guest',
      subject,
      content,
      channel: channel || 'in_room',
      priority: priority || 'medium',
      status: 'unread',
      room_number: roomId || null,
      reservation_id: reservationId || null,
      guest_id: guestId || null,
      sent_at: new Date().toISOString(),
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });

    // Write audit event
    writeAuditEvent({
      req,
      user: req.user!,
      action: 'CREATE',
      module: 'front_office',
      entityType: 'communication',
      entityId: data.id,
      details: { messageNumber: data.message_number, to, channel },
      outcome: 'success'
    }).catch((err: any) => {
      console.error('Failed to write audit event:', err);
    });

    res.status(201).json(data);
  } catch (error) {
    console.error('Error creating communication:', error);
    res.status(500).json({ error: 'Failed to create communication' });
  }
});

// Update a communication
router.put('/communications/:id', async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { id } = req.params;
    const {
      status,
      reply,
      priority
    } = req.body || {};

    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (status) {
      updateData.status = status;
      if (status === 'read') {
        updateData.read_at = new Date().toISOString();
      }
      if (status === 'replied') {
        updateData.replied_at = new Date().toISOString();
      }
    }
    if (reply !== undefined) updateData.reply = reply;
    if (priority) updateData.priority = priority;

    const { data, error } = await supabaseAdmin
      .from('communications')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Write audit event
    writeAuditEvent({
      req,
      user: req.user!,
      action: 'UPDATE',
      module: 'front_office',
      entityType: 'communication',
      entityId: id,
      details: updateData,
      outcome: 'success'
    }).catch((err: any) => {
      console.error('Failed to write audit event:', err);
    });

    res.json(data);
  } catch (error) {
    console.error('Error updating communication:', error);
    res.status(500).json({ error: 'Failed to update communication' });
  }
});

// Delete a communication
router.delete('/communications/:id', async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from('communications')
      .delete()
      .eq('id', id);

    if (error) return res.status(500).json({ error: error.message });

    // Write audit event
    writeAuditEvent({
      req,
      user: req.user!,
      action: 'DELETE',
      module: 'front_office',
      entityType: 'communication',
      entityId: id,
      details: {},
      outcome: 'success'
    }).catch((err: any) => {
      console.error('Failed to write audit event:', err);
    });

    res.json({ success: true, message: 'Communication deleted successfully' });
  } catch (error) {
    console.error('Error deleting communication:', error);
    res.status(500).json({ error: 'Failed to delete communication' });
  }
});

// Get communication templates
router.get('/communications/templates', async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { data, error } = await supabaseAdmin
      .from('communication_templates')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    res.json({ templates: data || [] });
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// Create communication template
router.post('/communications/templates', async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const {
      name,
      description,
      category,
      channels,
      subjectTemplate,
      contentTemplate
    } = req.body || {};

    if (!name || !category) {
      return res.status(400).json({ error: 'Name and category are required' });
    }

    const { data, error } = await supabaseAdmin.from('communication_templates').insert({
      name,
      description,
      category,
      channels: channels || [],
      subject_template: subjectTemplate,
      content_template: contentTemplate,
      active: true,
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });

    res.status(201).json(data);
  } catch (error) {
    console.error('Error creating template:', error);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

// Update communication template
router.put('/communications/templates/:id', async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { id } = req.params;
    const {
      name,
      description,
      category,
      channels,
      subjectTemplate,
      contentTemplate,
      active
    } = req.body || {};

    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (name) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (category) updateData.category = category;
    if (channels) updateData.channels = channels;
    if (subjectTemplate !== undefined) updateData.subject_template = subjectTemplate;
    if (contentTemplate !== undefined) updateData.content_template = contentTemplate;
    if (active !== undefined) updateData.active = active;

    const { data, error } = await supabaseAdmin
      .from('communication_templates')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.json(data);
  } catch (error) {
    console.error('Error updating template:', error);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// Delete communication template
router.delete('/communications/templates/:id', async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from('communication_templates')
      .delete()
      .eq('id', id);

    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true, message: 'Template deleted successfully' });
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// ── Room Blocks (date-range status overrides) ────────────────────

// Create a room block (date-range status override)
router.post('/room-blocks', authenticate, requirePermission('front_office:edit'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  const blockSchema = z.object({
    room_id: z.string(),
    room_number: z.string(),
    status: z.enum(['Blocked', 'Out of Order', 'Out of Service', 'Maintenance', 'House Use']),
    start_date: z.string(),
    end_date: z.string(),
    reason: z.string().optional(),
  });

  const validation = blockSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: 'Validation failed', details: validation.error.flatten() });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('room_blocks')
      .insert({
        ...validation.data,
        created_by: req.user!.id,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating room block:', error);
      return res.status(500).json({ error: error.message });
    }

    writeAuditEvent({
      req,
      user: req.user!,
      action: 'room_block.created',
      module: 'front_office',
      entityType: 'room_block',
      entityId: data.id,
      details: validation.data,
      outcome: 'success'
    }).catch((err: any) => {
      console.error('Failed to write audit event:', err);
    });

    res.json({ success: true, block: data });
  } catch (error) {
    console.error('Error creating room block:', error);
    res.status(500).json({ error: 'Failed to create room block' });
  }
});

// List room blocks (optional date filter)
router.get('/room-blocks', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { start_date, end_date } = req.query;
    let query = supabaseAdmin.from('room_blocks').select('*').order('created_at', { ascending: false });

    // If a date range is provided, return blocks that overlap that range
    if (start_date && end_date) {
      query = query.lte('start_date', end_date).gte('end_date', start_date);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching room blocks:', error);
      return res.status(500).json({ error: error.message });
    }

    res.json({ blocks: data || [] });
  } catch (error) {
    console.error('Error fetching room blocks:', error);
    res.status(500).json({ error: 'Failed to fetch room blocks' });
  }
});

// Delete a room block
router.delete('/room-blocks/:id', authenticate, requirePermission('front_office:edit'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { id } = req.params;
    const { error } = await supabaseAdmin
      .from('room_blocks')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting room block:', error);
      return res.status(500).json({ error: error.message });
    }

    writeAuditEvent({
      req,
      user: req.user!,
      action: 'room_block.deleted',
      module: 'front_office',
      entityType: 'room_block',
      entityId: id,
      details: {},
      outcome: 'success'
    }).catch((err: any) => {
      console.error('Failed to write audit event:', err);
    });

    res.json({ success: true, message: 'Room block deleted successfully' });
  } catch (error) {
    console.error('Error deleting room block:', error);
    res.status(500).json({ error: 'Failed to delete room block' });
  }
});

// ── Front Office Staff Operations ──────────────────────────────────────
// Staff Roster (with HR linkage), Shift Requirements, Staffing Requirements,
// Training, Productivity. Tailored for Front Office.

const FO_STAFF_ROLES_SET = new Set([
  'Front Desk Agent', 'Concierge', 'Bell Attendant',
  'Night Auditor', 'Guest Relations', 'Cashier', 'Supervisor',
]);
const FO_STAFF_SHIFTS_SET = new Set(['Morning', 'Evening', 'Night']);

function shapeFOStaff(row: any, employee: any = null) {
  return {
    id: row.id,
    name: row.name,
    avatar: row.avatar || (row.name || '').split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase(),
    role: row.role,
    shift: row.shift,
    station: row.station,
    checkIns: row.check_ins ?? 0,
    checkOuts: row.check_outs ?? 0,
    guestSatisfaction: row.guest_satisfaction ?? 0,
    upsellRevenue: row.upsell_revenue ?? 0,
    avgResponseMin: row.avg_response_min ?? 0,
    workload: row.workload ?? 0,
    status: row.status,
    isActive: row.is_active,
    employeeId: row.employee_id || null,
    email: employee?.email || null,
    phone: employee?.phone || null,
    hireDate: employee?.hire_date || null,
    salary: employee?.salary ?? null,
    department: employee?.department || 'Front Office',
    position: employee?.position || row.role,
  };
}

// List all FO staff for a property, with HR employee data joined.
router.get('/staff/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data: staffRows, error } = await supabaseAdmin
    .from('fo_staff').select('*')
    .eq('property_id', req.params.propertyId)
    .eq('is_active', true)
    .order('name');
  if (error) return res.status(500).json({ error: error.message });

  const employeeIds = (staffRows || []).map((s: any) => s.employee_id).filter(Boolean);
  let employeesById: Record<string, any> = {};
  if (employeeIds.length > 0) {
    const { data: empRows } = await supabaseAdmin
      .from('employees').select('id, email, phone, hire_date, salary, department, position')
      .in('id', employeeIds);
    (empRows || []).forEach((e: any) => { employeesById[e.id] = e; });
  }

  const staff = (staffRows || []).map((s: any) =>
    shapeFOStaff(s, s.employee_id ? employeesById[s.employee_id] : null)
  );

  return res.json({
    propertyId: req.params.propertyId,
    staff,
    summary: {
      total: staff.length,
      onDuty: staff.filter((s: any) => s.status === 'Active Duty').length,
      avgSatisfaction: staff.length ? (staff.reduce((sum: number, s: any) => sum + Number(s.guestSatisfaction), 0) / staff.length).toFixed(2) : '0',
    },
    generatedAt: new Date().toISOString(),
  });
});

// Create a new FO staff member. Optionally links to existing HR employee
// or creates a new HR employee record.
router.post('/staff', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const {
    propertyId, name, role, shift, station, status,
    checkIns, checkOuts, guestSatisfaction, upsellRevenue, avgResponseMin, workload,
    employeeId, email, phone, hireDate, salary,
  } = req.body || {};

  if (!propertyId || !name?.trim()) return res.status(400).json({ error: 'propertyId and name are required' });
  if (role && !FO_STAFF_ROLES_SET.has(role)) return res.status(400).json({ error: `role must be one of: ${[...FO_STAFF_ROLES_SET].join(', ')}` });
  if (shift && !FO_STAFF_SHIFTS_SET.has(shift)) return res.status(400).json({ error: `shift must be one of: ${[...FO_STAFF_SHIFTS_SET].join(', ')}` });

  const id = `FO-${Date.now()}`;
  const avatar = name.trim().split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase();
  const resolvedRole = role || 'Front Desk Agent';

  let linkedEmployeeId = employeeId || null;
  let employeeRecord: any = null;

  if (linkedEmployeeId) {
    const { data: emp } = await supabaseAdmin
      .from('employees').select('id, email, phone, hire_date, salary, department, position')
      .eq('id', linkedEmployeeId).single();
    if (emp) employeeRecord = emp;
    else linkedEmployeeId = null;
  } else if (email || phone || hireDate || salary) {
    const empId = `EMP-FO-${Date.now()}`;
    const { data: newEmp, error: empError } = await supabaseAdmin
      .from('employees').insert({
        id: empId, name: name.trim(), email: email || null, phone: phone || null,
        department: 'Front Office', position: resolvedRole, status: 'Active',
        hire_date: hireDate || new Date().toISOString().split('T')[0],
        salary: salary ?? 0, avatar_initials: avatar, property_id: propertyId,
      }).select('id, email, phone, hire_date, salary, department, position').single();
    if (!empError && newEmp) { linkedEmployeeId = empId; employeeRecord = newEmp; }
  }

  const { data, error } = await supabaseAdmin
    .from('fo_staff').insert({
      id, property_id: propertyId, name: name.trim(), avatar,
      status: status || 'Active Duty', is_active: true,
      role: resolvedRole, shift: shift || 'Morning', station: station || 'Front Desk',
      check_ins: checkIns ?? 0, check_outs: checkOuts ?? 0,
      guest_satisfaction: guestSatisfaction ?? 0, upsell_revenue: upsellRevenue ?? 0,
      avg_response_min: avgResponseMin ?? 0, workload: workload ?? 0,
      employee_id: linkedEmployeeId,
    }).select('*').single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(shapeFOStaff(data, employeeRecord));
});

// List available HR employees not yet linked to fo_staff.
router.get('/staff/available-employees/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data: linkedRows } = await supabaseAdmin
    .from('fo_staff').select('employee_id').not('employee_id', 'is', null);
  const linkedIds = (linkedRows || []).map((r: any) => r.employee_id);

  let q = supabaseAdmin
    .from('employees').select('id, name, email, phone, position, hire_date, salary, department')
    .eq('status', 'Active')
    .eq('department', 'Front Office')
    .order('name');
  const { propertyId } = req.params;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(propertyId || '')) {
    q = q.eq('property_id', propertyId);
  }
  if (linkedIds.length > 0) q = q.filter('id', 'not.in', `(${linkedIds.join(',')})`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ employees: data || [] });
});

// Update a FO staff member (reassign station/shift/role, update metrics, link HR).
router.put('/staff/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const {
    name, role, shift, station, status, isActive, employeeId,
    checkIns, checkOuts, guestSatisfaction, upsellRevenue, avgResponseMin, workload,
  } = req.body || {};

  if (role !== undefined && !FO_STAFF_ROLES_SET.has(role))
    return res.status(400).json({ error: `role must be one of: ${[...FO_STAFF_ROLES_SET].join(', ')}` });
  if (shift !== undefined && !FO_STAFF_SHIFTS_SET.has(shift))
    return res.status(400).json({ error: `shift must be one of: ${[...FO_STAFF_SHIFTS_SET].join(', ')}` });

  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (name !== undefined) patch.name = name.trim();
  if (role !== undefined) patch.role = role;
  if (shift !== undefined) patch.shift = shift;
  if (station !== undefined) patch.station = station;
  if (status !== undefined) patch.status = status;
  if (isActive !== undefined) patch.is_active = isActive;
  if (employeeId !== undefined) patch.employee_id = employeeId || null;
  if (checkIns !== undefined) patch.check_ins = Number(checkIns);
  if (checkOuts !== undefined) patch.check_outs = Number(checkOuts);
  if (guestSatisfaction !== undefined) patch.guest_satisfaction = Number(guestSatisfaction);
  if (upsellRevenue !== undefined) patch.upsell_revenue = Number(upsellRevenue);
  if (avgResponseMin !== undefined) patch.avg_response_min = Number(avgResponseMin);
  if (workload !== undefined) patch.workload = Number(workload);

  if (Object.keys(patch).length === 1) return res.status(400).json({ error: 'Nothing to update' });

  const { data, error } = await supabaseAdmin
    .from('fo_staff').update(patch).eq('id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Staff not found' });

  let employeeRecord: any = null;
  if (data.employee_id) {
    const { data: emp } = await supabaseAdmin
      .from('employees').select('id, email, phone, hire_date, salary, department, position')
      .eq('id', data.employee_id).single();
    if (emp) employeeRecord = emp;
  }
  return res.json(shapeFOStaff(data, employeeRecord));
});

// Delete (soft-delete by default, hard=true to remove).
router.delete('/staff/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { hard } = req.query as Record<string, string>;
  if (hard === 'true') {
    const { error } = await supabaseAdmin.from('fo_staff').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
  } else {
    const { error } = await supabaseAdmin
      .from('fo_staff').update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
  }
  return res.json({ success: true, id: req.params.id });
});


const FO_STAFF_ROLES = new Set(['Front Desk Agent', 'Concierge', 'Bell Attendant', 'Night Auditor', 'Guest Relations', 'Cashier', 'Supervisor']);

// ── Shift Requirements ────────────────────────────────────────────────
router.get('/staff/shifts/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin
    .from('fo_shift_requirements').select('*')
    .eq('property_id', req.params.propertyId).order('start_time');
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/staff/shifts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { propertyId, name, startTime, endTime, assignedStaff, requiredStaff } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  const { data, error } = await supabaseAdmin
    .from('fo_shift_requirements')
    .insert({ name: name.trim(), start_time: startTime || '07:00', end_time: endTime || '15:00',
      assigned_staff: assignedStaff ?? 0, required_staff: requiredStaff ?? 1, property_id: propertyId || null })
    .select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/staff/shifts/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  const { name, startTime, endTime, assignedStaff, requiredStaff } = req.body || {};
  if (name !== undefined) patch.name = name;
  if (startTime !== undefined) patch.start_time = startTime;
  if (endTime !== undefined) patch.end_time = endTime;
  if (assignedStaff !== undefined) patch.assigned_staff = Number(assignedStaff);
  if (requiredStaff !== undefined) patch.required_staff = Number(requiredStaff);
  const { data, error } = await supabaseAdmin
    .from('fo_shift_requirements').update(patch).eq('id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/staff/shifts/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { error } = await supabaseAdmin.from('fo_shift_requirements').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Staffing Requirements ─────────────────────────────────────────────
router.get('/staff/staffing/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin
    .from('fo_staffing_requirements').select('*')
    .eq('property_id', req.params.propertyId).order('station');
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/staff/staffing', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { propertyId, station, role, requiredCount, assignedCount, shift } = req.body || {};
  if (!role) return res.status(400).json({ error: 'role is required' });
  if (!FO_STAFF_ROLES.has(role)) return res.status(400).json({ error: `role must be one of: ${[...FO_STAFF_ROLES].join(', ')}` });
  const { data, error } = await supabaseAdmin
    .from('fo_staffing_requirements')
    .insert({ station: station ?? null, role, required_count: requiredCount ?? 1, assigned_count: assignedCount ?? 0,
      shift: shift || 'Morning', property_id: propertyId || null })
    .select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/staff/staffing/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  const { station, role, requiredCount, assignedCount, shift } = req.body || {};
  if (station !== undefined) patch.station = station || null;
  if (role !== undefined) patch.role = role;
  if (requiredCount !== undefined) patch.required_count = Number(requiredCount);
  if (assignedCount !== undefined) patch.assigned_count = Number(assignedCount);
  if (shift !== undefined) patch.shift = shift;
  const { data, error } = await supabaseAdmin
    .from('fo_staffing_requirements').update(patch).eq('id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/staff/staffing/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { error } = await supabaseAdmin.from('fo_staffing_requirements').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Training ──────────────────────────────────────────────────────────
router.get('/staff/training/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin
    .from('fo_staff_training').select('*')
    .eq('property_id', req.params.propertyId).order('due_date');
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/staff/training', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { propertyId, course, employeeId, dueDate, status } = req.body || {};
  if (!course?.trim()) return res.status(400).json({ error: 'course is required' });
  const { data, error } = await supabaseAdmin
    .from('fo_staff_training')
    .insert({ course: course.trim(), employee_id: employeeId || null, due_date: dueDate || null,
      status: status || 'Not Started', property_id: propertyId || null })
    .select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/staff/training/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  const { course, employeeId, dueDate, status } = req.body || {};
  if (course !== undefined) patch.course = course;
  if (employeeId !== undefined) patch.employee_id = employeeId || null;
  if (dueDate !== undefined) patch.due_date = dueDate || null;
  if (status !== undefined) patch.status = status;
  const { data, error } = await supabaseAdmin
    .from('fo_staff_training').update(patch).eq('id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/staff/training/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { error } = await supabaseAdmin.from('fo_staff_training').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Productivity ──────────────────────────────────────────────────────
router.get('/staff/productivity/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin
    .from('fo_staff_productivity').select('*')
    .eq('property_id', req.params.propertyId).order('period_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/staff/productivity', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { propertyId, employeeId, checkIns, checkOuts, guestSatisfaction, upsellRevenue, avgResponseMin, hours, periodDate } = req.body || {};
  const { data, error } = await supabaseAdmin
    .from('fo_staff_productivity')
    .insert({ employee_id: employeeId || null, check_ins: checkIns ?? 0, check_outs: checkOuts ?? 0,
      guest_satisfaction: guestSatisfaction ?? 0, upsell_revenue: upsellRevenue ?? 0,
      avg_response_min: avgResponseMin ?? 0, hours: hours ?? 8, period_date: periodDate || null,
      property_id: propertyId || null })
    .select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/staff/productivity/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  const { employeeId, checkIns, checkOuts, guestSatisfaction, upsellRevenue, avgResponseMin, hours, periodDate } = req.body || {};
  if (employeeId !== undefined) patch.employee_id = employeeId || null;
  if (checkIns !== undefined) patch.check_ins = Number(checkIns);
  if (checkOuts !== undefined) patch.check_outs = Number(checkOuts);
  if (guestSatisfaction !== undefined) patch.guest_satisfaction = Number(guestSatisfaction);
  if (upsellRevenue !== undefined) patch.upsell_revenue = Number(upsellRevenue);
  if (avgResponseMin !== undefined) patch.avg_response_min = Number(avgResponseMin);
  if (hours !== undefined) patch.hours = Number(hours);
  if (periodDate !== undefined) patch.period_date = periodDate || null;
  const { data, error } = await supabaseAdmin
    .from('fo_staff_productivity').update(patch).eq('id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/staff/productivity/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { error } = await supabaseAdmin.from('fo_staff_productivity').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Attendance (Front Office) ──────────────────────────────────────────
const FO_ATT_SHIFTS = new Set(['Morning', 'Evening', 'Night']);
const FO_ATT_STATUSES = new Set(['Present', 'Late', 'Absent', 'On Leave', 'Sick', 'Half Day', 'Day Off', 'Public Holiday', 'Work From Home', 'Mission', 'Training Day']);

function shapeFOAttendance(row: any) {
  return {
    id: row.id,
    staffId: row.staff_id,
    staffName: row.staff_name,
    departmentScope: row.department_scope,
    employeeId: row.employee_id || null,
    attendanceDate: row.attendance_date,
    shift: row.shift,
    checkIn: row.check_in || null,
    checkOut: row.check_out || null,
    status: row.status,
    hoursWorked: Number(row.hours_worked) || 0,
    overtimeHours: Number(row.overtime_hours) || 0,
    notes: row.notes || null,
    email: null as string | null,
    phone: null as string | null,
    department: null as string | null,
    position: null as string | null,
  };
}

// Attendance summary grouped per staff member (one row per staff).
router.get('/attendance/summary/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin
    .from('staff_attendance').select('*')
    .eq('property_id', req.params.propertyId)
    .eq('department_scope', 'FO')
    .order('staff_name')
    .order('attendance_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const byStaff: Record<string, any> = {};
  for (const row of data || []) {
    if (!byStaff[row.staff_id]) {
      byStaff[row.staff_id] = {
        staffId: row.staff_id,
        staffName: row.staff_name,
        employeeId: row.employee_id || null,
        records: [],
        present: 0, late: 0, absent: 0, onLeave: 0, sick: 0, halfDay: 0,
        dayOff: 0, publicHoliday: 0, workFromHome: 0, mission: 0, trainingDay: 0,
        totalHours: 0, totalOvertime: 0, totalDays: 0,
      };
    }
    const s = byStaff[row.staff_id];
    s.totalDays++;
    s.totalHours += Number(row.hours_worked) || 0;
    s.totalOvertime += Number(row.overtime_hours) || 0;
    s.records.push(shapeFOAttendance(row));
    switch (row.status) {
      case 'Present': s.present++; break;
      case 'Late': s.late++; break;
      case 'Absent': s.absent++; break;
      case 'On Leave': s.onLeave++; break;
      case 'Sick': s.sick++; break;
      case 'Half Day': s.halfDay++; break;
      case 'Day Off': s.dayOff++; break;
      case 'Public Holiday': s.publicHoliday++; break;
      case 'Work From Home': s.workFromHome++; break;
      case 'Mission': s.mission++; break;
      case 'Training Day': s.trainingDay++; break;
    }
  }

  const empIds = Object.values(byStaff).map((s: any) => s.employeeId).filter(Boolean);
  let employeesById: Record<string, any> = {};
  if (empIds.length > 0) {
    const { data: empRows } = await supabaseAdmin
      .from('employees').select('id, email, phone, department, position')
      .in('id', empIds);
    (empRows || []).forEach((e: any) => { employeesById[e.id] = e; });
  }

  const summary = Object.values(byStaff).map((s: any) => {
    const emp = s.employeeId ? employeesById[s.employeeId] : null;
    return {
      ...s,
      email: emp?.email || null,
      phone: emp?.phone || null,
      department: emp?.department || null,
      position: emp?.position || null,
      attendanceRate: s.totalDays > 0
        ? Math.round(((s.present + s.late) / s.totalDays) * 100) : 0,
    };
  });

  return res.json({
    propertyId: req.params.propertyId,
    summary,
    totals: {
      staffCount: summary.length,
      totalHours: summary.reduce((sum: number, s: any) => sum + s.totalHours, 0),
      totalOvertime: summary.reduce((sum: number, s: any) => sum + s.totalOvertime, 0),
      avgAttendanceRate: summary.length > 0
        ? Math.round(summary.reduce((sum: number, s: any) => sum + s.attendanceRate, 0) / summary.length) : 0,
    },
  });
});

// List attendance for a property (FO scope), optional date filter.
router.get('/attendance/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { date } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('staff_attendance').select('*')
    .eq('property_id', req.params.propertyId)
    .eq('department_scope', 'FO')
    .order('attendance_date', { ascending: false })
    .order('staff_name');
  if (date) q = q.eq('attendance_date', date);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Join HR employee data
  const empIds = (data || []).map((r: any) => r.employee_id).filter(Boolean);
  let employeesById: Record<string, any> = {};
  if (empIds.length > 0) {
    const { data: empRows } = await supabaseAdmin
      .from('employees').select('id, email, phone, department, position')
      .in('id', empIds);
    (empRows || []).forEach((e: any) => { employeesById[e.id] = e; });
  }

  const records = (data || []).map((row: any) => {
    const shaped = shapeFOAttendance(row);
    const emp = row.employee_id ? employeesById[row.employee_id] : null;
    if (emp) {
      shaped.email = emp.email || null;
      shaped.phone = emp.phone || null;
      shaped.department = emp.department || null;
      shaped.position = emp.position || null;
    }
    return shaped;
  });

  return res.json({
    propertyId: req.params.propertyId,
    attendance: records,
    summary: {
      total: records.length,
      present: records.filter(r => r.status === 'Present').length,
      late: records.filter(r => r.status === 'Late').length,
      absent: records.filter(r => r.status === 'Absent').length,
      onLeave: records.filter(r => r.status === 'On Leave' || r.status === 'Sick').length,
      totalHours: records.reduce((s, r) => s + r.hoursWorked, 0),
      totalOvertime: records.reduce((s, r) => s + r.overtimeHours, 0),
    },
  });
});

// Create / check-in a staff member for today.
router.post('/attendance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { propertyId, staffId, staffName, shift, status, checkIn, notes } = req.body || {};
  if (!propertyId || !staffId || !staffName) return res.status(400).json({ error: 'propertyId, staffId, staffName are required' });
  if (shift && !FO_ATT_SHIFTS.has(shift)) return res.status(400).json({ error: 'Invalid shift' });
  if (status && !FO_ATT_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid status' });

  const today = new Date().toISOString().split('T')[0];
  const id = `ATT-FO-${staffId}-${today}`;

  // Look up the staff member's HR employee_id
  let employeeId: string | null = null;
  const { data: staffRow } = await supabaseAdmin
    .from('fo_staff').select('employee_id').eq('id', staffId).single();
  if (staffRow?.employee_id) employeeId = staffRow.employee_id;

  const { data, error } = await supabaseAdmin
    .from('staff_attendance').upsert({
      id, property_id: propertyId, staff_id: staffId, staff_name: staffName,
      department_scope: 'FO', attendance_date: today,
      shift: shift || 'Morning', status: status || 'Present',
      check_in: checkIn || new Date().toISOString(),
      hours_worked: 0, overtime_hours: 0, notes: notes || null,
      employee_id: employeeId,
    }, { onConflict: 'staff_id,attendance_date' }).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(shapeFOAttendance(data));
});

// Update attendance (check-out, status change, hours, notes).
router.put('/attendance/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { status, checkIn, checkOut, hoursWorked, overtimeHours, shift, notes } = req.body || {};
  if (status && !FO_ATT_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid status' });
  if (shift && !FO_ATT_SHIFTS.has(shift)) return res.status(400).json({ error: 'Invalid shift' });

  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (status !== undefined) patch.status = status;
  if (checkIn !== undefined) patch.check_in = checkIn;
  if (checkOut !== undefined) patch.check_out = checkOut;
  if (hoursWorked !== undefined) patch.hours_worked = Number(hoursWorked);
  if (overtimeHours !== undefined) patch.overtime_hours = Number(overtimeHours);
  if (shift !== undefined) patch.shift = shift;
  if (notes !== undefined) patch.notes = notes;

  const { data, error } = await supabaseAdmin
    .from('staff_attendance').update(patch).eq('id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Attendance record not found' });
  return res.json(shapeFOAttendance(data));
});

// Delete an attendance record.
router.delete('/attendance/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { error } = await supabaseAdmin.from('staff_attendance').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true, id: req.params.id });
});

export default router;
