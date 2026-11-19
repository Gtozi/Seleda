/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Demand Forecasts — DB-integrated.
 *
 * Fetches from /api/rms-portal/forecasts (Supabase-direct, same pattern
 * as /api/hk-portal/*). Period and room-type filters are passed as query
 * params; the backend scopes the response.
 *
 * UI uses the shared Front Office primitives (PageHeader, SectionCard,
 * Badge, StatCard) so the module matches the Housekeeping / F&B portals.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  TrendingUp,
  Calendar,
  Activity,
  Target,
  DollarSign,
  Bed,
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  ServerCrash,
  type LucideIcon,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { useERP } from '../../context/ERPContext';
import { button, type StatusTone } from '../FrontOffice/brandTheme';
import { rmsGet } from '../../services/rmsService';

// ── Types ────────────────────────────────────────────────────────────────
interface ForecastRow {
  id: string;
  forecast_date: string;
  room_type: string;
  occupancy: number;
  adr: number;
  revpar: number;
  demand: 'high' | 'medium' | 'low';
  confidence: number;
}

interface DemandFactor {
  id: string;
  factor: string;
  impact: 'positive' | 'neutral' | 'negative';
  confidence: number;
  description: string | null;
}

interface AccuracySnapshot {
  id: string;
  period: '7d' | '30d' | '90d';
  accuracy: number;
  variance_pct: number;
  snapshot_date: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────
const DEMAND_TONE: Record<string, StatusTone> = {
  high: 'success',
  medium: 'warning',
  low: 'danger',
};
const IMPACT_TONE: Record<string, StatusTone> = {
  positive: 'success',
  neutral: 'neutral',
  negative: 'danger',
};
const PERIOD_LABEL: Record<string, string> = {
  '7d': 'Last 7 Days',
  '30d': 'Last 30 Days',
  '90d': 'Last 90 Days',
};

// ── Component ───────────────────────────────────────────────────────────
const DemandForecasts = () => {
  const { currentPropertyId } = useERP();
  const [forecasts, setForecasts] = useState<ForecastRow[]>([]);
  const [factors, setFactors] = useState<DemandFactor[]>([]);
  const [accuracy, setAccuracy] = useState<AccuracySnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [period, setPeriod] = useState<'7' | '30' | '90' | '365'>('30');
  const [roomType, setRoomType] = useState<string>('all');
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await rmsGet('/api/rms-portal/forecasts', {
        propertyId: currentPropertyId,
        query: { days: period, roomType: roomType === 'all' ? null : roomType },
      });
      setForecasts(Array.isArray(json.data) ? json.data : []);
      setFactors(Array.isArray(json.factors) ? json.factors : []);
      setAccuracy(Array.isArray(json.accuracy) ? json.accuracy : []);
    } catch (e: any) {
      setError(e.message || 'Failed to load forecasts');
    } finally {
      setLoading(false);
    }
  }, [period, roomType, currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const metrics = useMemo(() => {
    if (forecasts.length === 0) {
      return { avgOccupancy: 0, avgADR: 0, avgRevPAR: 0, avgConfidence: 0, highDemandDays: 0 };
    }
    const avg = (key: keyof ForecastRow) =>
      Math.round(forecasts.reduce((sum, f) => sum + Number(f[key]), 0) / forecasts.length);
    return {
      avgOccupancy: avg('occupancy'),
      avgADR: avg('adr'),
      avgRevPAR: avg('revpar'),
      avgConfidence: avg('confidence'),
      highDemandDays: forecasts.filter(f => f.demand === 'high').length,
    };
  }, [forecasts]);

  const roomTypes = useMemo(() => {
    const set = new Set<string>(['all']);
    forecasts.forEach(f => set.add(f.room_type));
    return Array.from(set);
  }, [forecasts]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Date', 'Room Type', 'Occupancy %', 'ADR', 'RevPAR', 'Demand', 'Confidence %'];
      const rows = forecasts.map(f => [
        f.forecast_date,
        f.room_type,
        f.occupancy,
        f.adr,
        f.revpar,
        f.demand,
        f.confidence,
      ]);
      const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `demand-forecasts-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin mr-2" />
          Loading forecasts…
        </div>
      </div>
    );
  }

  if (error && forecasts.length === 0) {
    return (
      <div className="p-6">
        <div className="flex flex-col items-center justify-center py-20 text-rose-600 dark:text-rose-400">
          <ServerCrash className="w-10 h-10 mb-3" />
          <p className="font-medium">{error}</p>
          <button onClick={load} className="mt-4 text-sm text-blue-600 hover:underline">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Demand Forecasts"
        subtitle="AI-powered demand predictions and revenue forecasting"
        actions={
          <>
            <select
              value={roomType}
              onChange={(e) => setRoomType(e.target.value)}
              className="px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-900 dark:text-white"
            >
              {roomTypes.map(t => (
                <option key={t} value={t}>{t === 'all' ? 'All Room Types' : t}</option>
              ))}
            </select>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as any)}
              className="px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-900 dark:text-white"
            >
              <option value="7">Next 7 days</option>
              <option value="30">Next 30 days</option>
              <option value="90">Next 90 days</option>
              <option value="365">Next 365 days</option>
            </select>
            <button onClick={handleExport} disabled={exporting} className={button.secondary}>
              <Download className="w-4 h-4" />
              {exporting ? 'Exporting…' : 'Export'}
            </button>
          </>
        }
      />

      {error && (
        <div className="text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg px-4 py-2">
          {error}
        </div>
      )}

      {/* Forecast Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <StatCard title="Avg Occupancy"   value={`${metrics.avgOccupancy}%`}   icon={Bed}        tone="info" />
        <StatCard title="Avg ADR"         value={`$${metrics.avgADR}`}         icon={DollarSign} tone="success" />
        <StatCard title="Avg RevPAR"      value={`$${metrics.avgRevPAR}`}      icon={Target}     tone="accent" />
        <StatCard title="Confidence"      value={`${metrics.avgConfidence}%`} icon={Activity}   tone="warning" />
        <StatCard title="High Demand Days" value={metrics.highDemandDays}      icon={TrendingUp} tone="danger" />
      </div>

      {/* Forecast Chart / Table */}
      <SectionCard title="Demand Forecast" icon={TrendingUp} pad="md">
        <div className="space-y-3">
          {forecasts.map((f) => (
            <ForecastRowItem key={f.id} forecast={f} />
          ))}
          {forecasts.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-4">No forecast data for the selected filters</p>
          )}
        </div>
      </SectionCard>

      {/* Demand Factors */}
      <SectionCard title="Demand Factors" icon={Activity} pad="md">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {factors.map((factor) => (
            <DemandFactorCard key={factor.id} factor={factor} />
          ))}
          {factors.length === 0 && (
            <p className="text-sm text-slate-500 col-span-full text-center py-4">No demand factors recorded</p>
          )}
        </div>
      </SectionCard>

      {/* Forecast Accuracy */}
      <SectionCard title="Forecast Accuracy" icon={CheckCircle2} pad="md">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {accuracy.map((a) => (
            <AccuracyCard key={a.id} snapshot={a} />
          ))}
          {accuracy.length === 0 && (
            <p className="text-sm text-slate-500 col-span-full text-center py-4">No accuracy snapshots available</p>
          )}
        </div>
      </SectionCard>
    </div>
  );
};

// ── ForecastRowItem ─────────────────────────────────────────────────────
const ForecastRowItem = ({ forecast: f }: { forecast: ForecastRow }) => (
  <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600">
    <div className="flex items-center gap-4">
      <Calendar className="w-5 h-5 text-slate-600 dark:text-slate-400" />
      <div>
        <p className="font-medium text-slate-900 dark:text-white">
          {new Date(f.forecast_date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
        </p>
        <Badge tone={DEMAND_TONE[f.demand] || 'neutral'}>{f.demand} demand</Badge>
      </div>
    </div>
    <div className="flex items-center gap-6">
      <Metric label="Occupancy" value={`${f.occupancy}%`} />
      <Metric label="ADR" value={`$${f.adr}`} />
      <Metric label="RevPAR" value={`$${f.revpar}`} />
      <Metric label="Confidence" value={`${f.confidence}%`} accent />
    </div>
  </div>
);

const Metric = ({ label, value, accent }: { label: string; value: string; accent?: boolean }) => (
  <div className="text-center">
    <p className="text-xs text-slate-600 dark:text-slate-400">{label}</p>
    <p className={`font-semibold ${accent ? 'text-blue-600 dark:text-blue-400' : 'text-slate-900 dark:text-white'}`}>
      {value}
    </p>
  </div>
);

// ── DemandFactorCard ────────────────────────────────────────────────────
const DemandFactorCard = ({ factor: f }: { factor: DemandFactor }) => (
  <div className="p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600">
    <div className="flex items-center justify-between mb-2">
      <h4 className="font-medium text-slate-900 dark:text-white">{f.factor}</h4>
      <Badge tone={IMPACT_TONE[f.impact] || 'neutral'}>{f.impact}</Badge>
    </div>
    <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">{f.description || '—'}</p>
    <div className="flex items-center justify-between text-xs">
      <span className="text-slate-600 dark:text-slate-400">Confidence</span>
      <span className="font-medium text-slate-900 dark:text-white">{f.confidence}%</span>
    </div>
  </div>
);

// ── AccuracyCard ────────────────────────────────────────────────────────
const ACCURACY_ICON: Record<string, LucideIcon> = {
  '7d': CheckCircle2,
  '30d': Activity,
  '90d': AlertTriangle,
};

const AccuracyCard = ({ snapshot: a }: { snapshot: AccuracySnapshot }) => {
  const Icon = ACCURACY_ICON[a.period] || Activity;
  return (
    <div className="p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600">
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-medium text-slate-900 dark:text-white">{PERIOD_LABEL[a.period] || a.period}</h4>
        <Icon className={`w-5 h-5 ${a.period === '7d' ? 'text-green-500' : a.period === '30d' ? 'text-blue-500' : 'text-amber-500'}`} />
      </div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-slate-600 dark:text-slate-400">Accuracy</span>
        <span className="text-lg font-bold text-slate-900 dark:text-white">{a.accuracy}%</span>
      </div>
      <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: `${a.accuracy}%` }} />
      </div>
      <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">Variance: ±{a.variance_pct}%</p>
    </div>
  );
};

export default DemandForecasts;
