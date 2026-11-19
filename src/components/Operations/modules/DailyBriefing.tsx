/**
 * Daily Briefing — Operations Portal (/erp/operations/daily-briefing).
 *
 * The hotel's operational briefing, aggregated live from the real tables
 * of every other portal: reservations & VIP guests (Front Office),
 * group blocks, banquet events & venues, engineering work orders +
 * corrective maintenance, airport transfers & flight status,
 * department shift requirements, F&B orders, spa appointments, and the
 * ops_command_alerts feed for outstanding issues.
 *
 * DB-integrated via /api/ops-portal/daily-briefing (migration 628):
 *  - GET returns the persisted snapshot for the selected date when one
 *    exists (persisted badge + generated-by), otherwise live data.
 *  - "Generate & Save" recomputes and upserts ops_daily_briefings so the
 *    date can be revisited later.
 *  - Download produces a real Markdown file; Share copies a summary to
 *    the clipboard.
 *
 * UI follows the shared portal design language (PageHeader, SectionCard,
 * StatCard, Badge, brandTheme tokens) — same as the HK / Engineering /
 * F&B modules and the Operations Command Center.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FileText,
  Calendar,
  Users,
  Star,
  Plane,
  Briefcase,
  DollarSign,
  AlertTriangle,
  RefreshCw,
  Download,
  Share2,
  Clock,
  MapPin,
  Wrench,
  CheckCircle2,
  BedDouble,
  LogIn,
  Loader2,
  Save,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';
import {
  fetchDailyBriefing,
  generateDailyBriefing,
  type DailyBriefing as DailyBriefingData,
  type DailyBriefingStaffingDept,
} from '../../../services/operationsService';

// ── Static maps ──────────────────────────────────────────────────────────

const SEVERITY_TONE: Record<string, StatusTone> = {
  critical: 'danger',
  warning: 'warning',
  info: 'info',
  high: 'danger',
  urgent: 'danger',
  emergency: 'danger',
  medium: 'warning',
  normal: 'neutral',
  low: 'neutral',
};

const toneFor = (value: string): StatusTone =>
  SEVERITY_TONE[String(value || '').toLowerCase()] ?? 'neutral';

const FLIGHT_TONE: Record<string, StatusTone> = {
  'in flight': 'info',
  landed: 'success',
  scheduled: 'neutral',
  delayed: 'warning',
  cancelled: 'danger',
  diverted: 'danger',
};

// ── Helpers ──────────────────────────────────────────────────────────────

function fmtDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  return isNaN(d.getTime())
    ? dateStr
    : d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// Plain-text/markdown rendering used by Download and Share.
function briefingToMarkdown(b: DailyBriefingData, fmtMoney: (n: number) => string): string {
  const lines: string[] = [
    `# Daily Briefing — ${fmtDate(b.date)}`,
    '',
    `Occupancy: ${b.occupancy.current}% (${b.occupancy.occupied}/${b.occupancy.roomsTotal} rooms) — expected ${b.occupancy.expected}%`,
    `Arrivals: ${b.occupancy.arrivals}   Departures: ${b.occupancy.departures}   In-house guests: ${b.occupancy.inHouseGuests}`,
    `Revenue — yesterday: ${fmtMoney(b.revenue.yesterday)}   forecast: ${fmtMoney(b.revenue.forecast)}   variance: ${fmtMoney(b.revenue.variance)}`,
    b.staffing.overall !== null ? `Staffing coverage: ${b.staffing.overall}%` : 'Staffing coverage: not tracked',
    '',
  ];
  const list = (title: string, items: string[]) => {
    lines.push(`## ${title}`, ...(items.length ? items.map(i => `- ${i}`) : ['- None']), '');
  };
  list('VIP Arrivals', b.vipArrivals.map(v => `${v.name} — ${v.room}${v.notes ? ` (${v.notes})` : ''}`));
  list('Group Arrivals', b.groupArrivals.map(g => `${g.name} — ${g.rooms} rooms${g.guests ? `, ${g.guests} guests` : ''}`));
  list('Events', b.events.map(e => `${e.name} (${e.type}) — ${e.location}, ${e.attendees} attendees [${e.status}]`));
  list('Airport Transfers & Flights', b.flights.map(f =>
    `${f.airline} ${f.flight} — ${f.scheduledTime} ${f.flightStatus}${f.delay ? ` (delay: ${f.delay})` : ''}${f.guestName ? ` — ${f.guestName}` : ''}`));
  list('Maintenance Impacts', b.maintenance.map(m => `[${m.priority}] ${m.task} — ${m.location} (${m.status})`));
  list('Staffing', b.staffing.departments.map(d =>
    `${d.name}: ${d.assigned === null ? d.status : `${d.assigned}/${d.required} — ${d.status}`}`));
  list('Outstanding Issues', b.outstandingIssues.map(i => `[${i.priority}] ${i.issue} — ${i.department}`));
  return lines.join('\n');
}

// ── Component ────────────────────────────────────────────────────────────

const DailyBriefing: React.FC = () => {
  const { currentPropertyId, addNotification, formatAmount } = useERP();

  const [briefing, setBriefing] = useState<DailyBriefingData | null>(null);
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchDailyBriefing(currentPropertyId || undefined, selectedDate);
      setBriefing(data);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load daily briefing');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, selectedDate]);

  useEffect(() => { load(); }, [load]);

  // Recompute from live data and persist the snapshot for this date.
  const generate = async () => {
    setGenerating(true);
    try {
      const data = await generateDailyBriefing(currentPropertyId || undefined, selectedDate);
      setBriefing(data);
      setError(null);
      addNotification('Daily briefing generated and saved.', 'task', 'Executive');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to generate briefing', 'warning', 'Executive');
    } finally {
      setGenerating(false);
    }
  };

  const download = () => {
    if (!briefing) return;
    const blob = new Blob([briefingToMarkdown(briefing, formatAmount)], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `daily-briefing-${briefing.date}.md`;
    a.click();
    URL.revokeObjectURL(url);
    addNotification('Briefing downloaded.', 'task', 'Executive');
  };

  const share = async () => {
    if (!briefing) return;
    try {
      await navigator.clipboard.writeText(briefingToMarkdown(briefing, formatAmount));
      addNotification('Briefing summary copied to clipboard.', 'task', 'Executive');
    } catch {
      addNotification('Could not copy to clipboard', 'warning', 'Executive');
    }
  };

  const staffing = useMemo(() => briefing?.staffing.departments || [], [briefing]);

  // ── Render ────────────────────────────────────────────────────────────

  if (loading && !briefing) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={28} className="animate-spin text-[var(--color-accent-operations)]" />
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Daily Briefing"
        subtitle={`Hotel operational briefing for ${fmtDate(selectedDate)}`}
        icon={FileText}
        actions={
          <>
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm focus:ring-1 focus:ring-[var(--color-accent-operations)] outline-none"
            />
            <button
              onClick={generate}
              disabled={generating || loading}
              className={button.primary}
              title="Recompute from live data and save this date's briefing"
            >
              {generating ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Generate &amp; Save
            </button>
            <button onClick={load} disabled={loading} className={button.secondary} title="Reload">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={download} disabled={!briefing} className={button.secondary} title="Download as Markdown">
              <Download size={16} />
            </button>
            <button onClick={share} disabled={!briefing} className={button.secondary} title="Copy summary to clipboard">
              <Share2 size={16} />
            </button>
          </>
        }
      />

      {briefing && (
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          {briefing.persisted ? (
            <>
              <Badge tone="success" icon={CheckCircle2}>Saved snapshot</Badge>
              <span>
                Generated{briefing.generatedBy ? ` by ${briefing.generatedBy}` : ''} ·{' '}
                {new Date(briefing.generatedAt).toLocaleString()}
              </span>
            </>
          ) : (
            <>
              <Badge tone="info" icon={Clock}>Live data</Badge>
              <span>Not yet saved — use Generate &amp; Save to persist this date's briefing.</span>
            </>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 p-4 rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
          <AlertTriangle size={18} className="text-[var(--color-warning)] shrink-0" />
          <p className="text-sm text-gray-700 dark:text-gray-300 flex-1">{error}</p>
          <button onClick={load} className={button.secondary}>Retry</button>
        </div>
      )}

      {briefing && (
        <>
          {/* KPI row */}
          <div className={layout.kpiGrid}>
            <StatCard
              title="Occupancy"
              value={`${briefing.occupancy.current}%`}
              icon={BedDouble}
              tone="accent"
              caption={`${briefing.occupancy.occupied}/${briefing.occupancy.roomsTotal} rooms · expected ${briefing.occupancy.expected}%`}
            />
            <StatCard
              title="Arrivals / Departures"
              value={`${briefing.occupancy.arrivals} / ${briefing.occupancy.departures}`}
              icon={LogIn}
              tone="info"
              caption={`${briefing.occupancy.inHouseGuests} guests in-house`}
            />
            <StatCard
              title="Revenue Forecast"
              value={formatAmount(briefing.revenue.forecast)}
              icon={DollarSign}
              tone="success"
              caption={`yesterday ${formatAmount(briefing.revenue.yesterday)} · ${briefing.revenue.variance >= 0 ? '+' : ''}${formatAmount(briefing.revenue.variance)}`}
            />
            <StatCard
              title="Staffing Coverage"
              value={briefing.staffing.overall !== null ? `${briefing.staffing.overall}%` : '—'}
              icon={Briefcase}
              tone="warning"
              caption={briefing.staffing.departments.filter(d => (d.gap ?? 0) > 0).map(d => d.name).join(', ') || 'all tracked departments covered'}
            />
          </div>

          {/* VIP Arrivals */}
          <SectionCard
            title="VIP Arrivals"
            subtitle="VIP guests checking in today + housekeeping VIP preparations"
            icon={Star}
            tone="warning"
            pad="md"
            actions={<Badge tone="warning">{briefing.vipArrivals.length}</Badge>}
          >
            {briefing.vipArrivals.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No VIP arrivals on the books for this date.</p>
            ) : (
              <div className="space-y-3">
                {briefing.vipArrivals.map((vip, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-[var(--color-warning)]/5 border border-[var(--color-warning)]/20">
                    <div className={`shrink-0 p-2.5 rounded-xl ${statusTone.warning.soft}`}>
                      <Star size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-gray-900 dark:text-white">{vip.name}</p>
                        <Badge tone={vip.status === 'CheckedIn' ? 'success' : 'neutral'}>{vip.status}</Badge>
                        <Badge tone="info">{vip.source}</Badge>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{vip.room}</p>
                      {vip.notes && <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">{vip.notes}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Events + Group arrivals */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SectionCard
              title="Events"
              subtitle="Banquet & event bookings covering this date"
              icon={Calendar}
              tone="accent"
              pad="md"
              actions={<Badge tone="accent">{briefing.events.length}</Badge>}
            >
              {briefing.events.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">No events scheduled.</p>
              ) : (
                <div className="space-y-3">
                  {briefing.events.map((ev, i) => (
                    <div key={i} className="p-3 rounded-xl bg-gray-50 dark:bg-slate-900/50">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-900 dark:text-white truncate">{ev.name}</p>
                          <p className="text-sm text-gray-600 dark:text-gray-400">{ev.type}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {ev.attendees > 0 && <Badge tone="info">{ev.attendees} guests</Badge>}
                          <Badge tone={ev.status === 'InProgress' ? 'success' : 'neutral'}>{ev.status}</Badge>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 dark:text-gray-500">
                        <span className="flex items-center gap-1"><Clock size={12} />{ev.dateRange}</span>
                        <span className="flex items-center gap-1"><MapPin size={12} />{ev.location}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="Group Arrivals"
              subtitle="Group blocks & group reservations checking in"
              icon={Users}
              tone="info"
              pad="md"
              actions={<Badge tone="info">{briefing.groupArrivals.length}</Badge>}
            >
              {briefing.groupArrivals.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">No group arrivals for this date.</p>
              ) : (
                <div className="space-y-3">
                  {briefing.groupArrivals.map((g, i) => (
                    <div key={i} className="p-3 rounded-xl bg-[var(--color-info)]/5 border border-[var(--color-info)]/20">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-gray-900 dark:text-white truncate">{g.name}</p>
                        <Badge tone="neutral">{g.source}</Badge>
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-sm text-gray-600 dark:text-gray-400">
                        <span>{g.rooms} rooms</span>
                        {g.guests > 0 && <span>{g.guests} guests</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>

          {/* Maintenance + Airport transfers */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SectionCard
              title="Maintenance Impacts"
              subtitle="Open work orders & corrective tasks, highest priority first"
              icon={Wrench}
              tone="danger"
              pad="md"
              actions={<Badge tone="danger">{briefing.maintenance.length}</Badge>}
            >
              {briefing.maintenance.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">No open maintenance items.</p>
              ) : (
                <div className="space-y-2">
                  {briefing.maintenance.map((m, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-gray-50 dark:bg-slate-900/50">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 dark:text-white truncate">{m.task}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
                          {m.location} · {m.source} · {m.status}
                        </p>
                      </div>
                      <Badge tone={toneFor(m.priority)} className="shrink-0">{m.priority}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="Airport Transfers & Flights"
              subtitle="Scheduled transfers with live flight status"
              icon={Plane}
              tone="info"
              pad="md"
              actions={<Badge tone="info">{briefing.flights.length}</Badge>}
            >
              {briefing.flights.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">No airport transfers scheduled for this date.</p>
              ) : (
                <div className="space-y-2">
                  {briefing.flights.map((f, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-gray-50 dark:bg-slate-900/50">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 dark:text-white">
                          {f.airline} {f.flight}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
                          {f.scheduledTime && `${f.scheduledTime} · `}{f.direction}
                          {f.guestName && ` · ${f.guestName}`}
                          {f.guests > 0 && ` · ${f.guests} pax`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {f.delay && <Badge tone="warning">delay {f.delay}</Badge>}
                        <Badge tone={FLIGHT_TONE[f.flightStatus.toLowerCase()] ?? 'neutral'}>{f.flightStatus}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>

          {/* Staffing */}
          <SectionCard
            title="Staffing Coverage"
            subtitle="Assigned vs. required staff across department shifts"
            icon={Briefcase}
            tone="warning"
            pad="md"
          >
            <div className="space-y-3">
              {staffing.map((d: DailyBriefingStaffingDept) => {
                const pct = d.assigned === null || d.required === 0
                  ? null
                  : Math.min(100, Math.round((d.assigned / d.required) * 100));
                return (
                  <div key={d.name} className="flex items-center gap-4">
                    <div className="w-32 shrink-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{d.name}</p>
                    </div>
                    <div className="flex-1 h-2 rounded-full bg-gray-100 dark:bg-slate-700 overflow-hidden">
                      {pct !== null && (
                        <div
                          className={`h-full rounded-full ${pct >= 100 ? 'bg-[var(--color-success)]' : pct >= 75 ? 'bg-[var(--color-warning)]' : 'bg-[var(--color-danger)]'}`}
                          style={{ width: `${pct}%` }}
                        />
                      )}
                    </div>
                    <div className="w-40 shrink-0 text-right">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {d.assigned === null ? '—' : `${d.assigned}/${d.required}`}
                      </span>{' '}
                      <Badge tone={d.gap === null ? 'neutral' : d.gap === 0 ? 'success' : 'warning'}>
                        {d.status}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </SectionCard>

          {/* Outstanding issues */}
          <SectionCard
            title="Outstanding Issues"
            subtitle="Active alerts from the Operations Command Center feed"
            icon={AlertTriangle}
            tone="danger"
            pad="none"
            actions={<Badge tone="danger">{briefing.outstandingIssues.length}</Badge>}
          >
            {briefing.outstandingIssues.length === 0 ? (
              <p className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">No outstanding issues — all clear.</p>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-slate-700">
                {briefing.outstandingIssues.map((issue, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-between gap-3 px-6 py-3 border-l-4 ${statusTone[toneFor(issue.priority)].border}`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{issue.issue}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">{issue.department}</p>
                    </div>
                    <Badge tone={toneFor(issue.priority)} className="shrink-0 capitalize">{issue.priority}</Badge>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
};

export default DailyBriefing;
