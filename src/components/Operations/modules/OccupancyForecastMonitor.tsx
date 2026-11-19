/**
 * Occupancy & Forecast Monitor — Operations Portal (/erp/operations/occupancy-forecast).
 *
 * Live forecast computed server-side from real data — reservations (booked
 * room-nights, arrivals, departures, per-night rate revenue), rooms (sellable
 * inventory minus OOO/OOS/Maintenance), and group_blocks (blocked rooms).
 * Today view shows actual-vs-yesterday deltas; 7-day / 30-day views show the
 * forward pickup curve plus upcoming group blocks.
 *
 * UI follows the shared portal design language (PageHeader, SectionCard,
 * StatCard, Badge, brandTheme) — same as HK / Engineering / F&B modules.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  TrendingUp,
  Calendar,
  Users,
  Bed,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Building,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';
import {
  fetchOccupancyForecast,
  type OccupancyForecastOverview,
} from '../../../services/operationsService';

const delta = (n: number, label: string) => (
  <span className={`flex items-center gap-1 text-sm ${n >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
    {n >= 0 ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
    {Math.abs(n)} {label}
  </span>
);

const occTone = (occ: number) =>
  occ >= 85 ? 'bg-emerald-500' : occ >= 60 ? 'bg-[var(--color-accent-operations)]' : occ >= 30 ? 'bg-amber-500' : 'bg-slate-400';

const OccupancyForecastMonitor: React.FC = () => {
  const { currentPropertyId, formatAmount } = useERP();

  const [view, setView] = useState<'current' | '7-day' | '30-day'>('7-day');
  const [data, setData] = useState<OccupancyForecastOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchOccupancyForecast(currentPropertyId, view === '30-day' ? 30 : 7));
    } catch (e: any) {
      setError(e?.message || 'Failed to load forecast');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, view]);

  useEffect(() => { load(); }, [load]);

  const today = data?.today;
  const forecast = useMemo(
    () => (view === 'current' ? (data?.forecast || []).slice(0, 3) : data?.forecast || []),
    [data, view],
  );

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        icon={TrendingUp}
        title="Occupancy & Forecast Monitor"
        subtitle="Live booking pace, arrivals/departures and revenue forecast across all sources"
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-700 p-1 rounded-lg">
              {(['current', '7-day', '30-day'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    view === v
                      ? 'bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {v === 'current' ? 'Today' : v === '7-day' ? '7-Day' : '30-Day'}
                </button>
              ))}
            </div>
            <button className={button.ghost} onClick={load} disabled={loading}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        }
      />

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-danger)]/10 text-[var(--color-danger)] text-sm">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {/* KPI cards — today's actuals vs yesterday */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Current Occupancy" icon={Users} tone="accent"
          value={today ? `${today.occupancy}%` : '—'}
          caption={today ? `${today.bookedRooms} of ${data!.sellableRooms} sellable` : undefined}
        />
        <StatCard
          title="Available Rooms" icon={Bed} tone="success"
          value={today?.availableRooms ?? '—'}
          caption={today ? deltaLabel(today.availableDelta, 'vs yesterday') : undefined}
        />
        <StatCard
          title="Today's Arrivals" icon={Calendar} tone="info"
          value={today?.arrivals ?? '—'}
          caption={today ? deltaLabel(today.arrivalsDelta, 'vs yesterday') : undefined}
        />
        <StatCard
          title="Today's Departures" icon={TrendingUp} tone="warning"
          value={today?.departures ?? '—'}
          caption={today ? deltaLabel(today.departuresDelta, 'vs yesterday') : undefined}
        />
      </div>

      {/* Delta strip (compact yesterday comparison) */}
      {today && (
        <div className="flex items-center gap-6 flex-wrap text-sm text-slate-600 dark:text-slate-400">
          <span className="flex items-center gap-1">Occupancy {delta(today.occupancyDelta, 'pts vs yesterday')}</span>
          <span className="flex items-center gap-1">Available {delta(today.availableDelta, 'vs yesterday')}</span>
          <span className="flex items-center gap-1">Est. revenue today: <strong className="text-slate-900 dark:text-white">{formatAmount(today.revenue)}</strong></span>
          <span className="text-xs text-slate-400">Avg rate {formatAmount(data!.avgRate)} · {data!.blockedRooms} room{data!.blockedRooms === 1 ? '' : 's'} OOO/OOS</span>
        </div>
      )}

      {/* Upcoming group blocks */}
      {(data?.upcomingGroups.length || 0) > 0 && (
        <SectionCard title="Upcoming Group Blocks" icon={Building} tone="info" pad="md">
          <div className="flex flex-wrap gap-2">
            {data!.upcomingGroups.map((g) => (
              <Badge key={g.id} tone="info" icon={Building}>
                {g.name} · {g.rooms} rooms · {g.arrival} → {g.departure}
              </Badge>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Forecast rows */}
      <SectionCard
        title={`Occupancy Forecast — next ${view === '30-day' ? 30 : 7} days`}
        subtitle="Booked room-nights (transient + group blocks) vs sellable inventory"
        icon={Calendar}
        pad="none"
      >
        {loading && !data ? (
          <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
            <Loader2 size={20} className="animate-spin" /> Computing forecast…
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-800">
            {forecast.map((d) => (
              <div key={d.date} className={`flex items-center gap-4 px-4 py-3 ${d.isToday ? 'bg-[var(--color-accent-operations)]/5' : ''}`}>
                <div className="w-28 shrink-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    {new Date(`${d.date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </p>
                  {d.isToday && <Badge tone="accent" className="mt-0.5">Today</Badge>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 text-sm">
                    <span className="text-slate-600 dark:text-slate-400">Occupancy</span>
                    <span className="font-bold text-slate-900 dark:text-white">{d.occupancy}%</span>
                    {d.groupRooms > 0 && <Badge tone="info">+{d.groupRooms} group</Badge>}
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                    <div className={`h-2 rounded-full transition-all ${occTone(d.occupancy)}`} style={{ width: `${d.occupancy}%` }} />
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm">
                    <span className="text-emerald-600 dark:text-emerald-400">+{d.arrivals} arr</span>
                    <span className="text-slate-400"> / </span>
                    <span className="text-rose-600 dark:text-rose-400">−{d.departures} dep</span>
                  </p>
                  <p className="text-xs text-slate-500">{formatAmount(d.revenue)} · {d.bookedRooms} rooms</p>
                </div>
              </div>
            ))}
            {forecast.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-10">No booking data in this window</p>
            )}
          </div>
        )}
      </SectionCard>
    </div>
  );
};

function deltaLabel(n: number, label: string) {
  return `${n >= 0 ? '+' : ''}${n} ${label}`;
}

export default OccupancyForecastMonitor;
