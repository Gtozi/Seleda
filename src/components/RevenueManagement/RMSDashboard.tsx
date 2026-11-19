/**
 * RMS Dashboard - Main Dashboard Component
 *
 * DB-integrated: all data comes from GET /api/rms-portal/dashboard, which
 * aggregates the rms_* tables (inventory room types, BI revenue periods,
 * demand forecasts, parity issues, distribution channels, AI pricing
 * recommendations, forecast accuracy, competitor snapshots, dashboard
 * metrics). Apply/Dismiss reuses the ai-recommendations endpoints.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  TrendingUp, DollarSign, Bed, Target, Calendar,
  CheckCircle2, XCircle, AlertTriangle, Users, Activity, BarChart3, LineChart,
  RefreshCw, Loader2, ServerCrash, Sparkles,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import StatCard from '../FrontOffice/StatCard';
import { rmsGet, rmsPost, rmsRequest } from '../../services/rmsService';

const API = '/api/rms-portal';

interface DashboardData {
  kpis: {
    occupancyRate: number; adr: number; revpar: number; goppar: number;
    revenuePerGuest: number; totalRevenue: number; marketPenetration: number;
    mpi: number; rgci: number; forecastRevenue: number; revenueGrowth: number;
    pendingRecommendations: number; parityViolations: number; forecastAccuracy: number;
  };
  recommendations: any[];
  parity: { channel: string; status: 'ok' | 'violation'; rate: number; channelRate: number }[];
  competitors: { name: string; rate: number; occupancy: number; adr: number; revpar?: number; isOurs?: boolean; source?: string }[];
  forecast: { day: string; date: string; forecast: number; demand: number; adr: number; confidence: number; level: string }[];
  live?: boolean;
  sources?: {
    inventory: string; roomRevenue: string; derivedKpis: string; forecasts: string;
  };
}

const SOURCE_LABELS: Record<string, string> = {
  pms_rooms: 'live PMS rooms',
  folio_lines: 'live folio postings',
  reservations: 'live reservations',
  rms_inventory_room_types: 'seed inventory',
  rms_bi_revenue_periods: 'BI period data',
  rms_dashboard_metrics: 'configured ratios',
  rms_demand_forecasts: 'demand forecasts',
  feed: 'live feed',
  simulated: 'simulated',
  snapshot: 'snapshot',
};

const sourceTone = (source?: string) =>
  source === 'pms_rooms' || source === 'folio_lines' || source === 'reservations' || source === 'feed'
    ? 'success' : 'warning';

const RMSDashboard = () => {
  const { currentPropertyId, formatAmount } = useERP();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const json = await rmsGet(`${API}/dashboard`, { propertyId: currentPropertyId });
      setData(json);
    } catch (e: any) {
      setError(e?.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const setRecStatus = async (id: string, status: 'applied' | 'dismissed') => {
    setActingId(id);
    try {
      await rmsRequest(`${API}/ai-recommendations/${id}/status`, { method: 'PUT', body: { status }, propertyId: currentPropertyId });
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to update recommendation');
    } finally {
      setActingId(null);
    }
  };

  const generateNew = async () => {
    setGenerating(true);
    try {
      await rmsPost(`${API}/ai-recommendations`, {
        rec_type: 'pricing', priority: 'medium',
        title: 'Review rate positioning',
        description: 'AI-generated rate review based on latest demand forecast and comp set.',
        room_type: 'All Room Types',
        details: { currentRate: data?.kpis.adr || 0, recommendedRate: Math.round((data?.kpis.adr || 0) * 1.05) },
        confidence: 75, timeframe: 'Next 7 days', reason: 'Generated from dashboard',
      }, { propertyId: currentPropertyId });
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to generate recommendation');
    } finally {
      setGenerating(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        <span className="ml-2 text-sm text-slate-500">Loading revenue dashboard…</span>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-6">
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      </div>
    );
  }

  const m = data!.kpis;

  return (
    <div className={layout.sectionStack + ' animate-fade-in'}>
      <PageHeader
        title="Revenue Management Dashboard"
        subtitle="Live KPIs aggregated from pricing, inventory, distribution, and BI data"
        icon={TrendingUp}
        actions={
          <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Refresh
          </button>
        }
      />

      {error && (
        <div className="px-4 py-2 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-600 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Data-source transparency — which path actually fed the KPIs */}
      {data?.sources && (
        <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500 dark:text-slate-400">
          <span className="font-medium">Data sources:</span>
          <Badge tone={sourceTone(data.sources.inventory)}>
            Inventory: {SOURCE_LABELS[data.sources.inventory] || data.sources.inventory}
          </Badge>
          <Badge tone={sourceTone(data.sources.roomRevenue)}>
            Revenue/ADR: {SOURCE_LABELS[data.sources.roomRevenue] || data.sources.roomRevenue}
          </Badge>
          <Badge tone="neutral">
            Derived KPIs: {SOURCE_LABELS[data.sources.derivedKpis] || data.sources.derivedKpis}
          </Badge>
        </div>
      )}

      {/* KPI Cards */}
      <div className={layout.kpiGrid}>
        <StatCard title="Occupancy Rate" value={`${m.occupancyRate}%`} icon={Bed} tone="info" change={m.occupancyRate > 75 ? 5 : -3} changeLabel="vs last week" />
        <StatCard title="ADR" value={formatAmount(m.adr)} icon={DollarSign} tone="success" change={m.revenueGrowth} />
        <StatCard title="RevPAR" value={formatAmount(m.revpar)} icon={Target} tone="accent" change={m.revenueGrowth} />
        <StatCard title="GOPPAR" value={formatAmount(m.goppar)} icon={TrendingUp} tone="success" change={m.revenueGrowth} />
        <StatCard title="Revenue Per Guest" value={formatAmount(m.revenuePerGuest)} icon={Users} tone="info" change={m.revenueGrowth} />
        <StatCard title="Total Revenue" value={formatAmount(m.totalRevenue)} icon={LineChart} tone="success" change={m.revenueGrowth} />
        <StatCard title="Market Penetration" value={`${m.marketPenetration}%`} icon={BarChart3} tone="warning" change={3} />
        <StatCard title="MPI" value={m.mpi.toFixed(2)} icon={Activity} tone="danger" change={5} />
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard title="RGI (Revenue Generation Index)" value={m.rgci.toFixed(2)} icon={Target} tone="accent" caption="Target: 1.00" />
        <StatCard
          title="Forecast Revenue"
          value={formatAmount(m.forecastRevenue)}
          icon={Calendar}
          tone="info"
          caption={`Actual: ${formatAmount(m.totalRevenue)}`}
          change={m.totalRevenue > 0 ? Math.round(((m.forecastRevenue - m.totalRevenue) / m.totalRevenue) * 100) : 0}
          changeLabel="vs actual"
        />
        <StatCard title="Pending Recommendations" value={m.pendingRecommendations} icon={Sparkles} tone="warning" caption="Awaiting review" />
      </div>

      {/* Recommendations + Parity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <SectionCard
          title="Pricing Recommendations"
          subtitle="AI-generated rate adjustments"
          className="lg:col-span-2"
          actions={
            <button onClick={generateNew} disabled={generating} className={button.primary + ' disabled:opacity-50'}>
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Generate New
            </button>
          }
        >
          <div className="space-y-4">
            {data!.recommendations.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-6">No pending pricing recommendations. Generate a new one above.</p>
            )}
            {data!.recommendations.map((rec: any) => {
              const current = Number(rec.details?.currentRate ?? rec.details?.currentWeekendRate ?? 0);
              const recommended = Number(rec.details?.recommendedRate ?? rec.details?.recommendedWeekendRate ?? 0);
              const change = recommended - current;
              const pct = current > 0 ? Math.round((change / current) * 100) : 0;
              return (
                <div key={rec.id} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-medium text-slate-900 dark:text-white">{rec.room_type || rec.title}</h3>
                      <Badge tone={rec.confidence >= 90 ? 'success' : rec.confidence >= 80 ? 'info' : 'warning'}>
                        {rec.confidence}% confidence
                      </Badge>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400">{rec.reason || rec.description || rec.title}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm text-slate-600 dark:text-slate-400 line-through">{formatAmount(current)}</p>
                    <p className="text-lg font-semibold text-slate-900 dark:text-white">{formatAmount(recommended)}</p>
                    <p className={`text-sm font-medium ${change > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {change > 0 ? '+' : ''}{pct}%
                    </p>
                  </div>
                  <div className="ml-4 flex gap-2">
                    {actingId === rec.id ? (
                      <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                    ) : (
                      <>
                        <button onClick={() => setRecStatus(rec.id, 'applied')} className="p-2 hover:bg-green-100 dark:hover:bg-green-900/30 rounded-lg transition-colors" title="Apply">
                          <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                        </button>
                        <button onClick={() => setRecStatus(rec.id, 'dismissed')} className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors" title="Dismiss">
                          <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard
          title="Rate Parity"
          subtitle="Channel rate monitoring"
          actions={m.parityViolations > 0
            ? <AlertTriangle className="w-5 h-5 text-amber-500" />
            : <CheckCircle2 className="w-5 h-5 text-green-500" />}
        >
          <div className="space-y-4">
            {data!.parity.map((p) => (
              <ParityStatusCard key={p.channel} channel={p.channel} status={p.status} rate={p.rate} channelRate={p.channelRate} formatAmount={formatAmount} />
            ))}
            {data!.parity.length === 0 && <p className="text-sm text-slate-500 text-center py-4">No distribution channels configured.</p>}
          </div>
          {m.parityViolations > 0 && (
            <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                <AlertTriangle className="w-4 h-4 inline mr-1" />
                {m.parityViolations} rate parity violation(s) detected
              </p>
            </div>
          )}
        </SectionCard>
      </div>

      {/* Competitors + Forecast */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard title="Competitor Analysis" subtitle="Market comparison">
          <div className="space-y-3">
            {data!.competitors.map((comp) => (
              <CompetitorRow key={comp.name} competitor={comp} isOurs={!!comp.isOurs} formatAmount={formatAmount} />
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Demand Forecast"
          subtitle="Upcoming occupancy prediction"
          actions={
            <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
              <Activity className="w-4 h-4" />
              {m.forecastAccuracy}% accuracy
            </div>
          }
        >
          <div className="space-y-4">
            {data!.forecast.map((f) => (
              <ForecastBar key={f.day} day={f.day} demand={f.demand} forecast={f.forecast} />
            ))}
            {data!.forecast.length === 0 && <p className="text-sm text-slate-500 text-center py-4">No forecast data.</p>}
          </div>
        </SectionCard>
      </div>
    </div>
  );
};

const ParityStatusCard: React.FC<{ channel: string; status: 'ok' | 'violation'; rate: number; channelRate: number; formatAmount: (n: number) => string }> = ({ channel, status, rate, channelRate, formatAmount }) => {
  const diff = rate - channelRate;
  const diffPercent = rate > 0 ? Math.round((diff / rate) * 100) : 0;

  return (
    <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
      <div className="flex items-center gap-3">
        {status === 'ok' ? (
          <CheckCircle2 className="w-5 h-5 text-green-500" />
        ) : (
          <AlertTriangle className="w-5 h-5 text-amber-500" />
        )}
        <div>
          <p className="font-medium text-slate-900 dark:text-white">{channel}</p>
          <p className="text-sm text-slate-600 dark:text-slate-400">Our rate: {formatAmount(rate)}</p>
        </div>
      </div>
      <div className="text-right">
        <p className="text-sm text-slate-600 dark:text-slate-400">Channel: {formatAmount(channelRate)}</p>
        <p className={`text-sm font-medium ${status === 'ok' ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
          {diffPercent}%
        </p>
      </div>
    </div>
  );
};

const CompetitorRow: React.FC<{ competitor: { name: string; rate: number; occupancy: number; adr: number; source?: string }; isOurs: boolean; formatAmount: (n: number) => string }> = ({ competitor, isOurs, formatAmount }) => {
  return (
    <div className={`flex items-center justify-between p-3 rounded-lg ${isOurs ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800' : 'bg-slate-50 dark:bg-slate-700/50'}`}>
      <div>
        <p className={`font-medium ${isOurs ? 'text-blue-700 dark:text-blue-300' : 'text-slate-900 dark:text-white'}`}>
          {competitor.name}
          {isOurs && ' (Ours)'}
        </p>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          ADR: {formatAmount(competitor.adr)} • Occupancy: {competitor.occupancy}%
          {competitor.source && (
            <span className={`ml-2 text-xs ${sourceTone(competitor.source) === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
              · {SOURCE_LABELS[competitor.source] || competitor.source}
            </span>
          )}
        </p>
      </div>
      <p className="font-semibold text-slate-900 dark:text-white">{formatAmount(competitor.rate)}</p>
    </div>
  );
};

const ForecastBar: React.FC<{ day: string; demand: number; forecast: number }> = ({ day, demand, forecast }) => {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm text-slate-600 dark:text-slate-400">{day}</p>
        <p className="text-sm font-medium text-slate-900 dark:text-white">{forecast}%</p>
      </div>
      <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: `${forecast}%` }} />
      </div>
      {demand !== forecast && (
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Actual: {demand}% ({forecast > demand ? '+' : ''}{forecast - demand}%)
        </p>
      )}
    </div>
  );
};

export default RMSDashboard;
