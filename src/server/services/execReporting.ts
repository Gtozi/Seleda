/**
 * Executive reporting pipeline — scheduled jobs backing the Executive portal.
 *
 * generateExecSnapshots()
 *   Daily writer for the reporting data mart (migration 085). Computes the
 *   headline metric set from live operational tables per active property,
 *   upserts reporting_snapshots (module='Executive'), appends metric_history
 *   rows, and evaluates active alert_rules into alert_instances (which the
 *   Alerts & Exceptions module already reads).
 *
 * dispatchDueExecReports()
 *   Reads active report_schedules, decides which are due by frequency, sends
 *   them via the shared dispatchEmail service, and stamps last_sent_at.
 */

import { supabaseAdmin, hasSupabaseAdminConfig } from '../supabaseAdmin';
import { dispatchEmail, dispatchSMS } from './salesMessageDispatch';
import crypto from 'crypto';

const GLOBAL_PROPERTY_ID = '00000000-0000-0000-0000-000000000001';

const WO_CLOSED = new Set(['Completed', 'Verified', 'Closed', 'Cancelled']);
const LEAD_DEAD = new Set(['Lost', 'Closed Lost', 'Converted', 'Won', 'Closed Won']);
const RES_ACTIVE = new Set(['Confirmed', 'CheckedIn', 'Checked-In', 'CheckedOut', 'Checked-Out', 'Waitlisted']);

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

async function safeRows(query: any): Promise<any[]> {
  try {
    const { data, error } = await query;
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

/** Compute the headline metric set (keyed by metric_definitions.name). */
async function computeHeadlineMetrics(propertyId: string | null): Promise<Map<string, number>> {
  const eq = <T extends { eq: (c: string, v: string) => T }>(q: T): T =>
    propertyId ? q.eq('property_id', propertyId) : q;

  const today = todayStr();

  const [rooms, reservations, orders, workOrders, employees, bankAccounts,
    fbCost, labor, salesLeads] = await Promise.all([
    safeRows(eq(supabaseAdmin!.from('rooms').select('id, status, rate, property_id'))),
    safeRows(eq(supabaseAdmin!.from('reservations')
      .select('id, check_in_date, check_out_date, status, rate, property_id')
      .lte('check_in_date', today).gte('check_out_date', today))),
    safeRows(supabaseAdmin!.from('orders')
      .select('id, status, total_amount, created_at')
      .gte('created_at', today)),
    safeRows(eq(supabaseAdmin!.from('work_orders')
      .select('id, status, property_id'))),
    safeRows(supabaseAdmin!.from('employees').select('id, status')),
    safeRows(eq(supabaseAdmin!.from('bank_accounts')
      .select('id, current_balance, is_active, property_id'))),
    safeRows(eq(supabaseAdmin!.from('fb_cost_analytics')
      .select('food_cost_pct, property_id'))),
    safeRows(eq(supabaseAdmin!.from('hr_labor_cost_analysis')
      .select('budget, actual, property_id'))),
    safeRows(eq(supabaseAdmin!.from('sales_leads')
      .select('id, stage, opportunity_value, conversion_date, property_id'))),
  ]);

  const totalRooms = rooms.length;
  const occupied = rooms.filter(r => r.status === 'Occupied').length;
  const occupancy = totalRooms > 0 ? (occupied / totalRooms) * 100 : 0;

  const inHouse = reservations.filter(r => RES_ACTIVE.has(r.status));
  const adr = inHouse.length > 0
    ? inHouse.reduce((s, r) => s + (Number(r.rate) || 0), 0) / inHouse.length
    : 0;
  const revpar = (occupancy / 100) * adr;
  const roomRevenue = inHouse.reduce((s, r) => s + (Number(r.rate) || 0), 0);
  const fbRevenue = orders
    .filter(o => !['Cancelled', 'Voided'].includes(o.status))
    .reduce((s, o) => s + (Number(o.total_amount) || 0), 0);

  const metrics = new Map<string, number>();
  metrics.set('occupancy rate', Math.round(occupancy * 100) / 100);
  metrics.set('adr', Math.round(adr * 100) / 100);
  metrics.set('average daily rate', Math.round(adr * 100) / 100);
  metrics.set('revpar', Math.round(revpar * 100) / 100);
  metrics.set('total revenue', Math.round((roomRevenue + fbRevenue) * 100) / 100);
  metrics.set('open work orders', workOrders.filter(w => !WO_CLOSED.has(w.status)).length);
  metrics.set('headcount', employees.filter(e => e.status === 'Active' || e.status === 'active').length);
  metrics.set('cash position',
    Math.round(bankAccounts.filter(b => b.is_active !== false)
      .reduce((s, b) => s + (Number(b.current_balance) || 0), 0) * 100) / 100);
  metrics.set('pipeline value',
    Math.round(salesLeads.filter(l => !LEAD_DEAD.has(l.stage) && !l.conversion_date)
      .reduce((s, l) => s + (Number(l.opportunity_value) || 0), 0) * 100) / 100);
  if (fbCost.length > 0) {
    metrics.set('food cost %',
      Math.round((fbCost.reduce((s, f) => s + (Number(f.food_cost_pct) || 0), 0) / fbCost.length) * 100) / 100);
  }
  const laborBudget = labor.reduce((s, l) => s + (Number(l.budget) || 0), 0);
  const laborActual = labor.reduce((s, l) => s + (Number(l.actual) || 0), 0);
  if (laborBudget > 0) {
    metrics.set('labor cost %', Math.round((laborActual / laborBudget) * 10000) / 100);
  }
  return metrics;
}

// ── Alert notification dispatch ─────────────────────────────────────────
// alert_rules.notify_roles uses audience labels ('GM', 'Owner', 'Finance',
// 'Auditor', 'DepartmentManager'). Resolve them to system_users rows.
const NOTIFY_ROLE_MAP: Record<string, string[]> = {
  gm: ['gm', 'general_manager', 'general manager', 'executive'],
  owner: ['owner'],
  finance: ['finance', 'fin_manager', 'finance_manager', 'finance_controller', 'cfo', 'accountant'],
  auditor: ['auditor'],
};

async function resolveNotifyUsers(notifyRoles: any): Promise<{ emails: string[]; phones: string[] }> {
  const roles = (Array.isArray(notifyRoles) ? notifyRoles : []).map((r: any) => String(r).trim().toLowerCase());
  if (roles.length === 0) return { emails: [], phones: [] };

  const users = await safeRows(
    supabaseAdmin!.from('system_users').select('email, mobile_number, role').eq('status', 'Active'));

  const emails = new Set<string>();
  const phones = new Set<string>();
  for (const u of users) {
    const role = String(u.role || '').trim().toLowerCase();
    const matched = roles.some((r: string) =>
      r === 'departmentmanager'
        ? role.includes('manager') || role.includes('director') || role.includes('head')
        : (NOTIFY_ROLE_MAP[r] || [r]).includes(role));
    if (!matched) continue;
    if (u.email) emails.add(String(u.email));
    if (u.mobile_number) phones.add(String(u.mobile_number));
  }
  return { emails: [...emails], phones: [...phones] };
}

/**
 * Deliver an alert-instance notification through the channels configured on
 * the rule: 'InApp'/'Both' → notifications table (bell icon); 'Email'/'Both'
 * → dispatchEmail to resolved role recipients; 'SMS' → dispatchSMS.
 */
async function dispatchAlertNotification(
  rule: any,
  metricName: string,
  value: number,
  propertyId: string | null,
): Promise<void> {
  const channel = String(rule.notify_channel || 'InApp');
  const severity = String(rule.severity || 'Warning');
  const direction = rule.condition === 'BelowTarget' ? 'below' : 'above';
  const message = `[${severity}] Executive alert — ${metricName} is ${direction} target ` +
    `(${Number(value).toLocaleString()} vs threshold ${Number(rule.threshold).toLocaleString()})`;

  try {
    if (channel === 'InApp' || channel === 'Both') {
      const { error } = await supabaseAdmin!.from('notifications').insert({
        id: crypto.randomUUID(),
        property_id: propertyId,
        message: message.slice(0, 500),
        type: severity === 'Critical' ? 'warning' : 'info',
        department: 'Executive',
        read: false,
        created_at: new Date().toISOString(),
      });
      if (error) console.warn('[exec-alerts] notification insert failed:', error.message);
    }

    if (channel === 'Email' || channel === 'Both' || channel === 'SMS') {
      const { emails, phones } = await resolveNotifyUsers(rule.notify_roles);
      if ((channel === 'Email' || channel === 'Both') && emails.length > 0) {
        const body = `<h2>${severity} Executive Alert</h2><p>${message}.</p>` +
          `<p>Review in the Executive portal: /erp/executive/alerts-exceptions</p>`;
        await dispatchEmail(`[SELEDA] ${severity} alert — ${metricName}`, body, emails);
      }
      if ((channel === 'SMS' || channel === 'Both') && phones.length > 0) {
        await dispatchSMS(message, phones);
      }
    }
  } catch (e: any) {
    console.warn('[exec-alerts] notification dispatch failed:', e?.message || e);
  }
}

/** Evaluate active alert_rules against a metric map; insert alert_instances + notify. */
async function evaluateAlertRules(
  metricValues: Map<string, number>,
  metricIdByName: Map<string, string>,
  propertyId: string | null = null,
): Promise<number> {
  const rules = await safeRows(
    supabaseAdmin!.from('alert_rules')
      .select('rule_id, metric_id, condition, threshold, severity, cooldown_period, notify_roles, notify_channel')
      .eq('is_active', true));
  if (rules.length === 0) return 0;

  const openInstances = await safeRows(
    supabaseAdmin!.from('alert_instances')
      .select('rule_id, triggered_at')
      .eq('status', 'Open'));

  let created = 0;
  for (const rule of rules) {
    const name = [...metricIdByName.entries()].find(([, id]) => id === rule.metric_id)?.[0];
    const value = name ? metricValues.get(name) : undefined;
    if (value === undefined) continue;

    const threshold = Number(rule.threshold);
    const breached =
      rule.condition === 'BelowTarget' ? value < threshold :
      rule.condition === 'AboveTarget' ? value > threshold : false;
    if (!breached) continue;

    // Cooldown: skip if an open instance exists inside the cooldown window.
    const existing = openInstances.filter(i => i.rule_id === rule.rule_id);
    if (existing.length > 0) {
      const cooldownMs = parseIntervalMs(rule.cooldown_period) ?? 3600_000;
      const newest = Math.max(...existing.map(i => new Date(i.triggered_at).getTime()));
      if (Date.now() - newest < cooldownMs) continue;
    }

    const { error } = await supabaseAdmin!.from('alert_instances').insert({
      rule_id: rule.rule_id,
      value,
      status: 'Open',
    });
    if (!error) {
      created++;
      await dispatchAlertNotification(rule, name || 'metric', value, propertyId);
    }
  }
  return created;
}

/**
 * Standalone alert-rule evaluation — runs on its own hourly schedule
 * (exec_alert_eval job) so breaches notify within ~1h instead of waiting
 * for the 06:05 snapshot job.
 */
export async function evaluateExecAlertRules(): Promise<Record<string, any>> {
  const result: Record<string, any> = { evaluated: 0, alertsRaised: 0, errors: [] as string[] };
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return result;

  const metricDefs = await safeRows(
    supabaseAdmin!.from('metric_definitions').select('metric_id, name'));
  const metricIdByName = new Map(metricDefs.map(m => [String(m.name).toLowerCase().trim(), m.metric_id]));

  const properties = await safeRows(
    supabaseAdmin!.from('properties').select('id').eq('is_active', true));
  const targets: (string | null)[] = [...properties.map(p => p.id), null];

  for (const propertyId of targets) {
    try {
      const metrics = await computeHeadlineMetrics(propertyId);
      result.alertsRaised += await evaluateAlertRules(metrics, metricIdByName, propertyId);
      result.evaluated++;
    } catch (e: any) {
      result.errors.push(`${propertyId || 'global'}: ${e?.message}`);
    }
  }
  return result;
}

/** Parse Postgres INTERVAL text ('4 hours', '1 week', '24 hours') to ms. */
function parseIntervalMs(interval: any): number | null {
  if (!interval) return null;
  const s = String(interval);
  const m = s.match(/(\d+)\s*(second|minute|hour|day|week|month)/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const mult = unit.startsWith('second') ? 1000
    : unit.startsWith('minute') ? 60_000
    : unit.startsWith('hour') ? 3600_000
    : unit.startsWith('day') ? 86400_000
    : unit.startsWith('week') ? 604800_000
    : 2592000_000;
  return n * mult;
}

/** Daily snapshot writer: reporting_snapshots + metric_history + alerts + digest + forecasts. */
export async function generateExecSnapshots(): Promise<Record<string, any>> {
  const result: Record<string, any> = { snapshots: 0, historyRows: 0, alertsRaised: 0, forecasts: 0, digestSent: 0, errors: [] as string[] };
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return result;

  const metricDefs = await safeRows(
    supabaseAdmin!.from('metric_definitions').select('metric_id, name'));
  const metricIdByName = new Map(metricDefs.map(m => [String(m.name).toLowerCase().trim(), m.metric_id]));

  const properties = await safeRows(
    supabaseAdmin!.from('properties').select('id, property_name').eq('is_active', true));
  const targets: { id: string | null; name: string | null }[] = [
    ...properties.map(p => ({ id: p.id as string, name: (p.property_name as string) || null })),
    { id: null, name: 'All properties' }, // portfolio-wide
  ];
  const date = todayStr();

  for (const target of targets) {
    const propertyId = target.id;
    try {
      const metrics = await computeHeadlineMetrics(propertyId);
      const metricValues: Record<string, number> = {};
      const historyRows: any[] = [];
      for (const [name, value] of metrics) {
        const metricId = metricIdByName.get(name);
        if (!metricId) continue;
        metricValues[metricId] = value;
        historyRows.push({
          metric_id: metricId,
          date,
          value,
          property_id: propertyId || GLOBAL_PROPERTY_ID,
        });
      }

      const { error: snapErr } = await supabaseAdmin!.from('reporting_snapshots').upsert({
        module: 'Executive',
        property_id: propertyId || GLOBAL_PROPERTY_ID,
        snapshot_date: date,
        metric_values: metricValues,
        data_quality_flag: Object.keys(metricValues).length > 0 ? 'Complete' : 'Partial',
        generated_at: new Date().toISOString(),
      }, { onConflict: 'module,property_id,snapshot_date' });
      if (snapErr) {
        result.errors.push(`snapshot ${propertyId || 'global'}: ${snapErr.message}`);
      } else {
        result.snapshots++;
      }

      for (const row of historyRows) {
        const { error } = await supabaseAdmin!.from('metric_history').upsert(row, {
          onConflict: 'metric_id,date,property_id',
        });
        if (!error) result.historyRows++;
      }

      result.alertsRaised += await evaluateAlertRules(metrics, metricIdByName, propertyId);
      result.forecasts += await writeForecastEntries(propertyId || GLOBAL_PROPERTY_ID, metricIdByName);

      // Executive morning briefing — one in-app notification per day per
      // property so the bell icon carries the daily flash for GM/Owner.
      const { data: existingDigest } = await supabaseAdmin!.from('notifications')
        .select('id')
        .eq('department', 'Executive')
        .eq('property_id', propertyId)
        .gte('created_at', `${date}T00:00:00Z`)
        .ilike('message', 'Executive morning briefing%')
        .limit(1);
      if (!existingDigest?.length) {
        const fmt = (n?: number) => n === undefined ? '—' : Number(n).toLocaleString();
        const { error: dErr } = await supabaseAdmin!.from('notifications').insert({
          id: crypto.randomUUID(),
          property_id: propertyId,
          message: `Executive morning briefing — ${target.name || 'property'}: ` +
            `occupancy ${fmt(metrics.get('occupancy rate'))}% · ADR ${fmt(metrics.get('adr'))} · ` +
            `RevPAR ${fmt(metrics.get('revpar'))} · revenue ${fmt(metrics.get('total revenue'))} · ` +
            `${fmt(metrics.get('open work orders'))} open work orders · ${result.alertsRaised} alert(s) raised`,
          type: 'info',
          department: 'Executive',
          read: false,
          created_at: new Date().toISOString(),
        });
        if (!dErr) result.digestSent++;
      }
    } catch (e: any) {
      result.errors.push(`${propertyId || 'global'}: ${e?.message}`);
    }
  }

  return result;
}

/**
 * Populate forecast_entries from the Revenue Management demand forecasts
 * (rms_demand_forecasts) so the data mart's forward projection table — and
 * the standard 'revenue-forecast' report that reads it — has real data.
 */
async function writeForecastEntries(
  propertyId: string,
  metricIdByName: Map<string, string>,
): Promise<number> {
  const metricFor = (key: string) => metricIdByName.get(key);
  const targets = [
    { metricId: metricFor('occupancy rate'), field: 'occupancy' },
    { metricId: metricFor('average daily rate'), field: 'adr' },
    { metricId: metricFor('revpar'), field: 'revpar' },
  ].filter(t => t.metricId);
  if (targets.length === 0) return 0;

  const today = todayStr();
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 30);

  let q = supabaseAdmin!.from('rms_demand_forecasts')
    .select('property_id, forecast_date, occupancy, adr, revpar, confidence')
    .eq('room_type', 'all')
    .gte('forecast_date', today)
    .lte('forecast_date', horizon.toISOString().slice(0, 10));
  // Global aggregate rows read every property's forecasts; property-scoped
  // rows only their own.
  if (propertyId !== GLOBAL_PROPERTY_ID) q = q.eq('property_id', propertyId);
  const forecasts = await safeRows(q);
  if (forecasts.length === 0) return 0;

  let written = 0;
  for (const f of forecasts) {
    const conf = Number(f.confidence) || 0;
    const confidenceLevel = conf >= 80 ? 'High' : conf >= 60 ? 'Medium' : 'Low';
    const scopeId = propertyId === GLOBAL_PROPERTY_ID ? (f.property_id || GLOBAL_PROPERTY_ID) : propertyId;
    for (const t of targets) {
      const value = Number(f[t.field]);
      if (!Number.isFinite(value)) continue;
      const { error } = await supabaseAdmin!.from('forecast_entries').upsert({
        metric_id: t.metricId,
        date: f.forecast_date,
        forecasted_value: value,
        confidence_level: confidenceLevel,
        method: 'rms_demand_forecasts',
        is_projection: true,
        property_id: scopeId,
      }, { onConflict: 'metric_id,date,property_id' });
      if (!error) written++;
    }
  }
  return written;
}

// ── Scheduled report dispatch ─────────────────────────────────────────────

function scheduleDue(schedule: any, now: Date): boolean {
  const last = schedule.last_sent_at ? new Date(schedule.last_sent_at) : null;
  const ageMs = last ? now.getTime() - last.getTime() : Infinity;
  const dom = String(schedule.day_of_week_or_month || '').toLowerCase();

  switch (schedule.frequency) {
    case 'Daily':
      return !last || last.toDateString() !== now.toDateString();
    case 'Weekly': {
      if (dom) {
        const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const target = weekdays.findIndex(d => d.startsWith(dom.slice(0, 3)));
        if (target >= 0 && now.getDay() !== target) return false;
      }
      return ageMs >= 6.5 * 86400_000;
    }
    case 'Monthly': {
      const dayNum = parseInt(dom);
      if (Number.isFinite(dayNum) && now.getDate() !== Math.min(dayNum, 28)) {
        // send on the requested day; on short months send on the last day
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        if (!(dayNum > lastDay && now.getDate() === lastDay)) return false;
      }
      return ageMs >= 27 * 86400_000;
    }
    case 'Quarterly':
      return ageMs >= 85 * 86400_000;
    default:
      return false;
  }
}

/**
 * Render the executive report body: a real KPI table computed from the
 * headline metric set (same numbers as the portal dashboard), plus open
 * alert counts. CSV data is appended for Excel-format schedules so
 * recipients get machine-readable content even without attachments.
 */
async function renderExecReportBody(sched: any, now: Date): Promise<string> {
  const metrics = await computeHeadlineMetrics(null); // portfolio-wide
  const openAlerts = await safeRows(
    supabaseAdmin!.from('alert_instances')
      .select('instance_id, alert_rules(severity)')
      .eq('status', 'Open'));
  const criticalOpen = openAlerts.filter(a => {
    const r = Array.isArray(a.alert_rules) ? a.alert_rules[0] : a.alert_rules;
    return String(r?.severity || '').toLowerCase() === 'critical';
  }).length;

  const titleCase = (s: string) => s.replace(/\b\w/g, c => c.toUpperCase());
  const metricRows = [...metrics.entries()]
    .filter(([name]) => name !== 'adr') // duplicate of 'average daily rate'
    .map(([name, value]) =>
      `<tr><td style="padding:4px 12px;border-bottom:1px solid #e5e7eb">${titleCase(name)}</td>` +
      `<td style="padding:4px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600">${Number(value).toLocaleString()}</td></tr>`)
    .join('');

  const csvLines = ['metric,value',
    ...[...metrics.entries()].filter(([name]) => name !== 'adr')
      .map(([name, value]) => `"${titleCase(name)}",${value}`)];

  const parts = [
    `<h2>${sched.name}</h2>`,
    `<p>Scheduled executive report — ${sched.frequency} · generated ${now.toISOString()}</p>`,
    `<h3>Headline metrics (today, all properties)</h3>`,
    `<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">${metricRows || '<tr><td>No metric data available</td></tr>'}</table>`,
    `<p><strong>Open alerts:</strong> ${openAlerts.length}${criticalOpen ? ` (${criticalOpen} critical)` : ''}</p>`,
  ];
  if (sched.format === 'Excel' || sched.format === 'Both') {
    parts.push(`<h3>CSV</h3><pre style="background:#f3f4f6;padding:12px;font-size:12px">${csvLines.join('\n')}</pre>`);
  }
  parts.push(`<p style="color:#6b7280;font-size:12px">View live data in the Executive portal: /erp/executive/reports-center</p>`);
  return parts.join('');
}

/**
 * Dispatch one report_schedule immediately ("Run now" from the Reports
 * Center). Sends real rendered KPI content to the schedule's recipients.
 */
export async function dispatchExecReportSchedule(scheduleId: string): Promise<Record<string, any>> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) throw new Error('Database not configured');
  const sched = (await safeRows(
    supabaseAdmin!.from('report_schedules')
      .select('schedule_id, name, recipient_list, frequency, format, is_active')
      .eq('schedule_id', scheduleId)))[0];
  if (!sched) throw new Error('Schedule not found');
  const recipients = Array.isArray(sched.recipient_list)
    ? sched.recipient_list.filter((r: any) => typeof r === 'string' && r.includes('@'))
    : [];
  if (recipients.length === 0) throw new Error('Schedule has no valid recipients');

  const now = new Date();
  const body = await renderExecReportBody(sched, now);
  const r = await dispatchEmail(`[SELEDA] ${sched.name} — on-demand report`, body, recipients);
  if (r.failed > 0 && r.delivered === 0) throw new Error(`Dispatch failed (${r.provider})`);
  await supabaseAdmin!.from('report_schedules')
    .update({ last_sent_at: now.toISOString() })
    .eq('schedule_id', scheduleId);
  return { delivered: r.delivered, provider: r.provider, lastSent: now.toISOString() };
}

/** Send due report_schedules to their recipient_list via dispatchEmail. */
export async function dispatchDueExecReports(): Promise<Record<string, any>> {
  const result: Record<string, any> = { checked: 0, sent: 0, skipped: 0, failed: 0, errors: [] as string[] };
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return result;

  const schedules = await safeRows(
    supabaseAdmin!.from('report_schedules')
      .select('schedule_id, name, recipient_list, frequency, day_of_week_or_month, report_content, format, last_sent_at')
      .eq('is_active', true));
  result.checked = schedules.length;

  const now = new Date();
  for (const sched of schedules) {
    if (!scheduleDue(sched, now)) {
      result.skipped++;
      continue;
    }
    const recipients = Array.isArray(sched.recipient_list) ? sched.recipient_list.filter((r: any) => typeof r === 'string' && r.includes('@')) : [];
    if (recipients.length === 0) {
      result.errors.push(`${sched.name}: no valid recipients`);
      continue;
    }

    try {
      const body = await renderExecReportBody(sched, now);
      const r = await dispatchEmail(`[SELEDA] ${sched.name} — ${sched.frequency} report`, body, recipients);
      if (r.failed > 0 && r.delivered === 0) {
        result.failed++;
        result.errors.push(`${sched.name}: dispatch failed (${r.provider})`);
        continue;
      }
      await supabaseAdmin!.from('report_schedules')
        .update({ last_sent_at: now.toISOString() })
        .eq('schedule_id', sched.schedule_id);
      result.sent++;
    } catch (e: any) {
      result.failed++;
      result.errors.push(`${sched.name}: ${e?.message}`);
    }
  }

  return result;
}
