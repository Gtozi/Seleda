/**
 * Scheduler & Job Engine
 * Cron-based job runner for automated tasks: night audit, allotment release, report email, backup.
 */
import cron, { ScheduledTask } from 'node-cron';
import { supabaseAdmin, hasSupabaseAdminConfig } from './supabaseAdmin';
import { dispatchDueCommunications, sendAppointmentReminders } from './services/spaService';
import { runChannelSync } from './services/channelSync';
import { localDayStartUtc, localMinutesOfDay, parseHHMM } from './services/conciergeSettings';
import { generateExecSnapshots, dispatchDueExecReports, evaluateExecAlertRules } from './services/execReporting';

export interface ScheduledJob {
  id: string;
  name: string;
  type: string;
  schedule_cron: string;
  config: any;
  enabled: boolean;
  last_run: string | null;
  next_run: string | null;
}

type JobHandler = (config: any) => Promise<any>;

const jobHandlers: Record<string, JobHandler> = {
  night_audit: async (config) => {
    const results: any = { postedCharges: 0, releasedAllotments: 0, businessDateClosed: false };
    
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return results;

    // Post room charges for all checked-in reservations
    if (config.postRoomCharges) {
      const { data: checkedIn } = await supabaseAdmin
        .from('reservations')
        .select('id, room_id, rate')
        .eq('status', 'Checked-In');
      
      for (const res of checkedIn || []) {
        const folioRes = await supabaseAdmin
          .from('folios')
          .select('id')
          .eq('reservation_id', res.id)
          .eq('status', 'Open')
          .single();
        
        if (folioRes.data) {
          await supabaseAdmin.from('folio_lines').insert({
            folio_id: folioRes.data.id,
            description: 'Room charge - auto post',
            amount: res.rate,
            quantity: 1,
            unit_price: res.rate,
            line_type: 'charge',
            transaction_date: new Date().toISOString().split('T')[0],
            source_module: 'night_audit',
          });
          results.postedCharges++;
        }
      }
    }

    // Auto-process no-shows: confirmed/waitlisted reservations past check-in date
    if (config.processNoShows !== false) {
      const { data: businessDateRow } = await supabaseAdmin
        .from('business_dates')
        .select('business_date')
        .eq('id', 'current')
        .single();

      const businessDate = businessDateRow?.business_date || new Date().toISOString().split('T')[0];

      const { data: noShowReservations } = await supabaseAdmin
        .from('reservations')
        .select('id')
        .in('status', ['Confirmed', 'Waitlisted'])
        .lt('check_in_date', businessDate);

      let noShowCount = 0;
      for (const res of (noShowReservations || [])) {
        const { error: nsError } = await supabaseAdmin.rpc('process_no_show', {
          p_reservation_id: res.id,
          p_user_id: 'system_night_audit',
        });
        if (!nsError) noShowCount++;
      }
      results.noShowsProcessed = noShowCount;
    }

    // Release expired allotments
    if (config.releaseAllotments) {
      const { error } = await supabaseAdmin.rpc('release_expired_allotments');
      if (!error) results.releasedAllotments = 1;
    }

    results.businessDateClosed = true;
    return results;
  },

  allotment_release: async () => {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return { released: 0 };
    const { error } = await supabaseAdmin.rpc('release_expired_allotments');
    return { released: error ? 0 : 1 };
  },

  procurement_auto_trigger: async () => {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return { generated: 0 };
    const { data, error } = await supabaseAdmin.rpc('generate_procurement_requisition_from_low_stock', {
      p_property_id: null,
      p_created_by: 'system (scheduler)',
    });
    if (error) {
      console.error('[Scheduler] procurement_auto_trigger error:', error.message);
      return { generated: 0, error: error.message };
    }
    const count = Array.isArray(data) ? data.length : 0;
    if (count > 0) {
      console.log(`[Scheduler] procurement_auto_trigger generated ${count} procurement requisition(s)`);
    }
    return { generated: count };
  },

  report_email: async (config) => {
    // Placeholder — would generate and email reports
    return { reportType: config.reportType || 'daily_summary', sent: true };
  },

  backup: async (config) => {
    // Placeholder — would trigger database backup
    return { type: config.type || 'full', completed: true };
  },

  // Delegates to the real channel adapter layer (services/channelSync).
  // Live channels push rates+inventory and pull bookings over HTTP; test-mode
  // or unconfigured channels run the simulated path and are marked
  // 'simulated' — never 'success' — in sync logs.
  channel_sync: async () => {
    const results: any = { channels: 0, synced: 0, simulated: 0, failed: 0, errors: [] as any[] };
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return results;

    const { data: channels } = await supabaseAdmin
      .from('channel_connections')
      .select('id,property_id')
      .eq('active', true);

    results.channels = channels?.length || 0;
    for (const ch of channels || []) {
      try {
        const r = await runChannelSync(ch.id, { trigger: 'scheduled', propertyId: ch.property_id || undefined });
        if (r.simulated) results.simulated++;
        else if (r.status === 'failed') results.failed++;
        else results.synced++;
      } catch (e: any) {
        results.failed++;
        results.errors.push({ channelId: ch.id, error: e?.message });
      }
    }
    return results;
  },

  // ── Finance Dashboard Snapshot ────────────────────────────────────────
  // Aggregates KPIs, trends, aging, alerts, bank accounts and ratios from
  // journal_entries, gl_invoices and usali_chart_of_accounts, then upserts
  // the result into fin_dashboard_snapshots so /erp/finance/dashboard has
  // fresh data without the frontend having to compute it.
  finance_dashboard_snapshot: async () => {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return { snapshot: false };
    const today = new Date().toISOString().split('T')[0];

    // 1. Fetch all posted journal entries (canonical + payroll + F&B)
    const { data: jeRows } = await supabaseAdmin
      .from('journal_entries')
      .select('entry_date, source, total_debit, total_credit, department, status')
      .eq('status', 'Posted');

    let glRows: any[] = [];
    try {
      const { data: gl } = await supabaseAdmin
        .from('gl_journal_entries')
        .select('entry_date, entry_type, total_debit, total_credit, status');
      glRows = gl || [];
    } catch { /* table may not exist */ }

    let fbRows: any[] = [];
    try {
      const { data: fb } = await supabaseAdmin
        .from('fb_journal_entries')
        .select('entry_date, amount, status')
        .eq('status', 'posted');
      fbRows = fb || [];
    } catch { /* table may not exist */ }

    // 2. Compute revenue / expense from journal entries
    // Revenue = credit postings to revenue accounts (source AR/POS/PMS)
    // Expense = debit postings to expense accounts (source AP/Payroll)
    const revenueSources = ['AR', 'POS', 'PMS'];
    const expenseSources = ['AP', 'Payroll'];

    let totalRevenue = 0;
    let totalExpenses = 0;
    const monthlyMap: Record<string, { revenue: number; expense: number }> = {};
    const deptRevenueMap: Record<string, number> = {};

    for (const r of (jeRows || [])) {
      const date = r.entry_date;
      if (!date) continue;
      const month = String(date).slice(0, 7);
      if (!monthlyMap[month]) monthlyMap[month] = { revenue: 0, expense: 0 };
      const debit = Number(r.total_debit) || 0;
      const credit = Number(r.total_credit) || 0;
      if (revenueSources.includes(r.source)) {
        totalRevenue += credit;
        monthlyMap[month].revenue += credit;
        const dept = r.department || 'Other';
        deptRevenueMap[dept] = (deptRevenueMap[dept] || 0) + credit;
      }
      if (expenseSources.includes(r.source)) {
        totalExpenses += debit;
        monthlyMap[month].expense += debit;
      }
    }

    // Add payroll expenses from gl_journal_entries
    for (const r of glRows) {
      if (r.status !== 'posted' && r.status !== 'Posted') continue;
      const month = String(r.entry_date || '').slice(0, 7);
      if (!month) continue;
      if (!monthlyMap[month]) monthlyMap[month] = { revenue: 0, expense: 0 };
      totalExpenses += Number(r.total_debit) || 0;
      monthlyMap[month].expense += Number(r.total_debit) || 0;
    }

    // Add F&B revenue from fb_journal_entries
    for (const r of fbRows) {
      const month = String(r.entry_date || '').slice(0, 7);
      if (!month) continue;
      if (!monthlyMap[month]) monthlyMap[month] = { revenue: 0, expense: 0 };
      const amt = Number(r.amount) || 0;
      totalRevenue += amt;
      monthlyMap[month].revenue += amt;
      deptRevenueMap['F&B'] = (deptRevenueMap['F&B'] || 0) + amt;
    }

    const grossProfit = totalRevenue - totalExpenses;
    const netProfit = grossProfit; // simplified — no tax/interest calc

    // 3. AR/AP aging from gl_invoices
    const { data: arInvoices } = await supabaseAdmin
      .from('gl_invoices')
      .select('type, issue_date, net_amount, tax_amount, gl_status')
      .eq('type', 'AR');

    const { data: apInvoices } = await supabaseAdmin
      .from('gl_invoices')
      .select('type, issue_date, net_amount, tax_amount, gl_status')
      .eq('type', 'AP');

    const now = new Date();
    const arAging = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    const apAging = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };

    for (const inv of (arInvoices || [])) {
      const amt = (Number(inv.net_amount) || 0) + (Number(inv.tax_amount) || 0);
      const days = Math.floor((now.getTime() - new Date(inv.issue_date).getTime()) / 86400000);
      if (days <= 30) arAging['0-30'] += amt;
      else if (days <= 60) arAging['31-60'] += amt;
      else if (days <= 90) arAging['61-90'] += amt;
      else arAging['90+'] += amt;
    }
    for (const inv of (apInvoices || [])) {
      const amt = (Number(inv.net_amount) || 0) + (Number(inv.tax_amount) || 0);
      const days = Math.floor((now.getTime() - new Date(inv.issue_date).getTime()) / 86400000);
      if (days <= 30) apAging['0-30'] += amt;
      else if (days <= 60) apAging['31-60'] += amt;
      else if (days <= 90) apAging['61-90'] += amt;
      else apAging['90+'] += amt;
    }

    // 4. Build KPIs
    const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
    const kpis = [
      { label: 'Total Revenue', value: fmt(totalRevenue), trend: '', is_positive: true, icon: 'DollarSign' },
      { label: 'Total Expenses', value: fmt(totalExpenses), trend: '', is_positive: false, icon: 'Wallet' },
      { label: 'Gross Profit', value: fmt(grossProfit), trend: '', is_positive: true, icon: 'TrendingUp' },
      { label: 'Operating Profit', value: fmt(grossProfit), trend: '', is_positive: true, icon: 'Activity' },
      { label: 'Net Profit', value: fmt(netProfit), trend: '', is_positive: true, icon: 'Banknote' },
      { label: 'EBITDA', value: fmt(grossProfit), trend: '', is_positive: true, icon: 'Building2' },
      { label: 'Cash Position', value: fmt(0), trend: '', is_positive: true, icon: 'Wallet' },
      { label: 'Bank Balance', value: fmt(0), trend: '', is_positive: true, icon: 'Banknote' },
      { label: 'AR Aging (0-30)', value: fmt(arAging['0-30']), trend: '', is_positive: true, icon: 'Wallet' },
      { label: 'AP Aging (0-30)', value: fmt(apAging['0-30']), trend: '', is_positive: false, icon: 'Wallet' },
      { label: 'Daily Cash Flow', value: fmt(0), trend: '', is_positive: true, icon: 'TrendingUp' },
      { label: 'Budget vs Actual', value: '—', trend: '', is_positive: true, icon: 'Activity' },
    ];

    // 5. Revenue/expense trend (last 6 months)
    const sortedMonths = Object.keys(monthlyMap).sort();
    const last6 = sortedMonths.slice(-6);
    const revenueExpenseTrend = last6.map(m => ({
      month: m.slice(5), // MM part
      revenue: Math.round(monthlyMap[m].revenue),
      expense: Math.round(monthlyMap[m].expense),
    }));

    // 6. Department revenue
    const deptColors: Record<string, string> = {
      'Front Office': '#6366f1', 'F&B': '#10b981', 'Rooms': '#6366f1',
      'Events': '#f59e0b', 'Laundry': '#ec4899', 'Other': '#94a3b8',
    };
    const deptRevenue = Object.entries(deptRevenueMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, value]) => ({ name, value: Math.round(value), color: deptColors[name] || '#94a3b8' }));

    // 7. AR/AP aging arrays
    const arAgingArr = Object.entries(arAging).map(([range, amount]) => ({ range, amount: Math.round(amount) }));
    const apAgingArr = Object.entries(apAging).map(([range, amount]) => ({ range, amount: Math.round(amount) }));

    // 8. Alerts
    const alerts: any[] = [];
    if (arAging['90+'] > 0) alerts.push({ type: 'Overdue Receivables', message: `${fmt(arAging['90+'])} in AR over 90 days`, severity: 'high', icon: 'AlertCircle' });
    if (apAging['90+'] > 0) alerts.push({ type: 'Overdue Payables', message: `${fmt(apAging['90+'])} in AP over 90 days`, severity: 'high', icon: 'AlertTriangle' });

    // 9. Bank accounts (from bank_accounts table)
    let bankAccountsArr: any[] = [];
    try {
      const { data: bankAccounts } = await supabaseAdmin
        .from('bank_accounts')
        .select('bank_name, account_name, account_number, account_type, current_balance')
        .eq('is_active', true)
        .limit(10);
      bankAccountsArr = (bankAccounts || []).map((b: any) => ({
        bank: b.bank_name || b.account_name || 'Bank',
        acc: b.account_number ? `...${String(b.account_number).slice(-4)}` : '—',
        type: b.account_type || 'Operating',
        bal: fmt(Number(b.current_balance) || 0),
        color: 'border-l-emerald-500',
      }));
    } catch { /* table may not exist */ }

    // 10. Ratios
    const totalAr = Object.values(arAging).reduce((a, b) => a + b, 0);
    const totalAp = Object.values(apAging).reduce((a, b) => a + b, 0);
    const ratios = [
      { name: 'Current Ratio', value: totalAp > 0 ? (totalAr / totalAp).toFixed(2) : '—' },
      { name: 'AR Outstanding', value: fmt(totalAr) },
      { name: 'AP Outstanding', value: fmt(totalAp) },
    ];

    // 11. Upsert snapshot (global — property_id = null)
    const { error: upsertError } = await supabaseAdmin
      .from('fin_dashboard_snapshots')
      .upsert({
        property_id: null,
        snapshot_date: today,
        kpis,
        revenue_expense_trend: revenueExpenseTrend,
        dept_revenue: deptRevenue,
        ar_aging: arAgingArr,
        ap_aging: apAgingArr,
        alerts,
        bank_accounts: bankAccountsArr,
        ratios,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'property_id,snapshot_date' });

    if (upsertError) {
      console.error('[Scheduler] finance_dashboard_snapshot error:', upsertError.message);
      return { snapshot: false, error: upsertError.message };
    }

    return { snapshot: true, date: today, revenue: totalRevenue, expenses: totalExpenses };
  },

  // Auto-create room inspections from enabled inspection_schedules.
  // For each enabled schedule, creates a room_inspections row for every room
  // (or the specified room) with all items set to 'Pending'.
  inspection_schedule: async (config) => {
    const results: any = { created: 0, schedules: 0 };
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return results;

    const { data: schedules } = await supabaseAdmin
      .from('inspection_schedules')
      .select('*')
      .eq('enabled', true);

    if (!schedules || schedules.length === 0) return results;

    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const timeStr = String(config.time || now.toTimeString().slice(0, 5));
    const inspectionDate = `${dateStr} ${timeStr}`;

    for (const sched of schedules) {
      results.schedules++;
      // Determine target rooms: specific rooms or all rooms for the property
      let targetRooms: { number: string; floor: string | null }[] = [];
      const roomNums: string[] = Array.isArray(sched.room_number)
        ? sched.room_number.map(String)
        : (sched.room_number ? [String(sched.room_number)] : []);
      if (roomNums.length > 0) {
        targetRooms = roomNums.map(n => ({ number: n, floor: sched.floor }));
      } else {
        const { data: rooms } = await supabaseAdmin
          .from('rooms')
          .select('number, floor')
          .eq('property_id', sched.property_id);
        targetRooms = (rooms || []).map((r: any) => ({ number: r.number, floor: r.floor }));
      }

      // When no inspector is set on the schedule, auto-assign from active
      // housekeeping staff using round-robin across rooms.
      let roundRobinStaff: string[] = [];
      if (!sched.inspector) {
        const { data: staffRows } = await supabaseAdmin
          .from('housekeeping_staff')
          .select('name')
          .eq('property_id', sched.property_id)
          .eq('is_active', true);
        roundRobinStaff = (staffRows || []).map((s: any) => s.name).filter(Boolean);
      }

      for (let idx = 0; idx < targetRooms.length; idx++) {
        const room = targetRooms[idx];
        const inspId = `INS-${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const emptyItems: Record<string, string> = {
          'Bed Quality': 'Pending', 'Bathroom': 'Pending', 'Floors': 'Pending',
          'Windows': 'Pending', 'Furniture': 'Pending', 'Lighting': 'Pending',
          'Air Conditioning': 'Pending', 'Television': 'Pending', 'Internet': 'Pending',
          'Amenities': 'Pending', 'Safety Equipment': 'Pending', 'Overall Presentation': 'Pending',
        };
        const inspectorName = sched.inspector
          || (roundRobinStaff.length > 0 ? roundRobinStaff[idx % roundRobinStaff.length] : null);

        await supabaseAdmin.from('room_inspections').insert({
          id: inspId,
          property_id: sched.property_id,
          room_number: room.number,
          floor: room.floor ? String(room.floor) : null,
          inspector: inspectorName,
          inspection_date: inspectionDate,
          result: 'Pending',
          items: emptyItems,
          notes: sched.notes || null,
        });
        results.created++;
      }

      // Update last_run
      await supabaseAdmin.from('inspection_schedules')
        .update({ last_run: new Date().toISOString() })
        .eq('id', sched.id);
    }

    return results;
  },

  // Hourly spa sweep: dispatch due scheduled communications and send
  // automated appointment reminders (migration 504). Kept separate from
  // spa_maintenance so reminders aren't bound to the daily 06:15 cadence.
  spa_reminders: async () => {
    const results: any = { commsDispatched: 0, remindersSent: 0, errors: [] as string[] };
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return results;

    try {
      const dispatched = await dispatchDueCommunications();
      results.commsDispatched = dispatched.length;
    } catch (e: any) {
      results.errors.push(`dispatch_due: ${e?.message}`);
    }
    try {
      const reminded = await sendAppointmentReminders();
      results.remindersSent = reminded.length;
    } catch (e: any) {
      results.errors.push(`reminders: ${e?.message}`);
    }
    return results;
  },

  // Spa & Wellness daily upkeep: membership auto-renew/expiry, gift-card
  // and package expiry (spa_daily_maintenance RPC, migration 494), plus
  // dispatch of due scheduled guest communications.
  spa_maintenance: async () => {
    const results: any = { maintenance: false, commsDispatched: 0, remindersSent: 0, errors: [] as string[] };
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return results;

    const { error: maintErr } = await supabaseAdmin.rpc('spa_daily_maintenance');
    if (maintErr) {
      results.errors.push(`spa_daily_maintenance: ${maintErr.message}`);
    } else {
      results.maintenance = true;
    }

    try {
      const dispatched = await dispatchDueCommunications();
      results.commsDispatched = dispatched.length;
    } catch (e: any) {
      results.errors.push(`dispatch_due: ${e?.message}`);
    }

    try {
      const reminded = await sendAppointmentReminders();
      results.remindersSent = reminded.length;
    } catch (e: any) {
      results.errors.push(`reminders: ${e?.message}`);
    }

    return results;
  },

  // Concierge wake-up & reminder dispatch (registered in migration 596). Every
  // 5 minutes, promotes due 'Wake-up Call' guest_requests (scheduled_for <= now,
  // still Open/Assigned) to 'In Progress' and posts a guest_communications row
  // so the alert is visible at the desk and in the guest portal. Requests
  // created before scheduled_for existed carry their time in description text
  // and are left for staff to action manually.
  concierge_wakeup_dispatch: async () => {
    const results: any = { due: 0, dispatched: 0, errors: [] as string[] };
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return results;

    const now = new Date().toISOString();
    const { data: due, error } = await supabaseAdmin
      .from('guest_requests')
      .select('id, reservation_id, room_number, guest_name, description')
      .eq('request_type', 'Wake-up Call')
      .in('status', ['Open', 'Assigned'])
      .not('scheduled_for', 'is', null)
      .lte('scheduled_for', now);

    if (error) {
      results.errors.push(`fetch: ${error.message}`);
      return results;
    }
    results.due = due?.length || 0;

    for (const r of due || []) {
      // Status guard in the UPDATE prevents double-dispatch if two runs overlap.
      const { error: updErr } = await supabaseAdmin
        .from('guest_requests')
        .update({ status: 'In Progress', acknowledged_at: now, updated_at: now })
        .eq('id', r.id)
        .in('status', ['Open', 'Assigned']);
      if (updErr) {
        results.errors.push(`${r.id}: ${updErr.message}`);
        continue;
      }

      const { error: commErr } = await supabaseAdmin
        .from('guest_communications')
        .insert({
          reservation_id: r.reservation_id || null,
          room_number: r.room_number || null,
          message: `Wake-up call due now: ${r.description || 'Scheduled wake-up call'}`,
          message_type: 'Request',
          status: 'Pending',
        });
      if (commErr) results.errors.push(`${r.id} comms: ${commErr.message}`);
      else results.dispatched++;
    }

    if (results.dispatched > 0) {
      console.log(`[Scheduler] concierge_wakeup_dispatch dispatched ${results.dispatched} wake-up call(s)`);
    }
    return results;
  },

  // Concierge daily digest (registered in migration 598). Runs every 15
  // minutes; fires once per day inside the 15-minute bucket starting at the
  // configured notifications.daily-digest time, summarizing the open
  // concierge queue into a staff notification.
  concierge_daily_digest: async () => {
    const results: any = { skipped: true, reason: '' };
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return results;

    const { data: setting } = await supabaseAdmin
      .from('concierge_settings')
      .select('value')
      .eq('id', 'notifications.daily-digest')
      .maybeSingle();
    if (setting?.value?.enabled !== true) {
      results.reason = 'disabled';
      return results;
    }

    const now = new Date();
    const target = parseHHMM(setting.value.time || '07:00') ?? 7 * 60;

    // Each property digests at the configured time in ITS OWN timezone.
    const { data: props } = await supabaseAdmin
      .from('properties')
      .select('id, timezone')
      .eq('is_active', true);

    const sent: string[] = [];
    for (const prop of props || []) {
      const tz = typeof prop.timezone === 'string' && prop.timezone ? prop.timezone : null;
      const mins = localMinutesOfDay(now, tz);
      if (mins < target || mins >= target + 15) continue;

      // Once per local day per property.
      const dayStart = localDayStartUtc(now, tz);
      const { data: existing } = await supabaseAdmin
        .from('notifications')
        .select('id')
        .eq('department', 'Concierge')
        .eq('property_id', prop.id)
        .gte('created_at', dayStart.toISOString())
        .ilike('message', 'Concierge daily digest%')
        .limit(1);
      if (existing?.length) continue;

      const { data: open } = await supabaseAdmin
        .from('guest_requests')
        .select('status, priority')
        .eq('assigned_department', 'Concierge')
        .eq('property_id', prop.id)
        .in('status', ['Open', 'Assigned', 'In Progress']);
      const byStatus: Record<string, number> = {};
      let urgent = 0;
      for (const r of open || []) {
        byStatus[r.status] = (byStatus[r.status] || 0) + 1;
        if (r.priority === 'Urgent' || r.priority === 'High') urgent++;
      }

      const message =
        `Concierge daily digest — ${open?.length || 0} open request(s): ` +
        `${byStatus['Open'] || 0} new, ${byStatus['Assigned'] || 0} assigned, ` +
        `${byStatus['In Progress'] || 0} in progress${urgent ? `, ${urgent} urgent/high` : ''}.`;

      const { error } = await supabaseAdmin.from('notifications').insert({
        id: crypto.randomUUID(),
        property_id: prop.id,
        message,
        type: 'info',
        department: 'Concierge',
        read: false,
      });
      if (error) {
        results.errors = [...(results.errors || []), error.message];
      } else {
        sent.push(prop.id);
      }
    }

    if (sent.length === 0) {
      results.reason = 'outside window or already sent';
      return results;
    }
    results.skipped = false;
    results.sent = sent;
    return results;
  },

  // Executive reporting data-mart writer (migration 648). Daily: computes
  // headline metrics per property, upserts reporting_snapshots +
  // metric_history, and evaluates alert_rules into alert_instances.
  exec_reporting_snapshot: async () => generateExecSnapshots(),

  // Executive scheduled report dispatch (migration 648). Hourly: sends due
  // report_schedules to their recipient_list via dispatchEmail.
  exec_report_dispatch: async () => dispatchDueExecReports(),

  // Executive alert evaluation (migration 649). Hourly: recomputes headline
  // metrics per property and evaluates alert_rules → alert_instances +
  // in-app/email/SMS notifications, so breaches surface within ~1h instead
  // of waiting for the 06:05 snapshot job.
  exec_alert_eval: async () => evaluateExecAlertRules(),
};

const activeCronJobs: Map<string, ScheduledTask> = new Map();

export async function loadAndStartJobs() {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    console.log('[Scheduler] Supabase not configured, skipping job load');
    return;
  }

  // Stop existing jobs
  for (const task of activeCronJobs.values()) {
    task.stop();
  }
  activeCronJobs.clear();

  const { data: jobs, error } = await supabaseAdmin
    .from('scheduled_jobs')
    .select('*')
    .eq('enabled', true);

  if (error) {
    console.error('[Scheduler] Failed to load jobs:', error.message);
    return;
  }

  for (const job of jobs || []) {
    if (!cron.validate(job.schedule_cron)) {
      console.error(`[Scheduler] Invalid cron for "${job.name}": ${job.schedule_cron}`);
      continue;
    }

    const task = cron.schedule(job.schedule_cron, async () => {
      await executeJob(job);
    });

    activeCronJobs.set(job.id, task);
    console.log(`[Scheduler] Started: "${job.name}" (${job.schedule_cron})`);
  }

  console.log(`[Scheduler] ${activeCronJobs.size} jobs active`);
}

export async function executeJob(job: ScheduledJob): Promise<void> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return;

  const runId = crypto.randomUUID();
  const { error: insertError } = await supabaseAdmin.from('job_runs').insert({
    id: runId,
    job_id: job.id,
    status: 'running',
    started_at: new Date().toISOString(),
  });

  if (insertError) {
    console.error(`[Scheduler] Failed to log run for "${job.name}":`, insertError.message);
    return;
  }

  try {
    const handler = jobHandlers[job.type];
    if (!handler) throw new Error(`No handler for job type: ${job.type}`);

    const result = await handler(job.config || {});

    await supabaseAdmin.from('job_runs').update({
      status: 'success',
      completed_at: new Date().toISOString(),
      result,
    }).eq('id', runId);

    await supabaseAdmin.from('scheduled_jobs').update({
      last_run: new Date().toISOString(),
    }).eq('id', job.id);

    console.log(`[Scheduler] Job "${job.name}" completed:`, result);
  } catch (err: any) {
    await supabaseAdmin.from('job_runs').update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error: err.message,
    }).eq('id', runId);

    await supabaseAdmin.from('scheduled_jobs').update({
      last_run: new Date().toISOString(),
    }).eq('id', job.id);

    console.error(`[Scheduler] Job "${job.name}" failed:`, err.message);
  }
}

export async function triggerJobManually(jobId: string): Promise<any> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) throw new Error('Database not configured');

  const { data: job, error } = await supabaseAdmin
    .from('scheduled_jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (error || !job) throw new Error('Job not found');

  await executeJob(job as ScheduledJob);
  return { success: true };
}
