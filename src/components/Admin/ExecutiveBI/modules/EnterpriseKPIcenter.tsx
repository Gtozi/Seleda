/**
 * Enterprise KPI Center Module
 *
 * Live, DB-integrated KPI scorecards aggregated server-side across every
 * portal — Front Office, Housekeeping, F&B, Engineering, HR, Procurement,
 * Inventory, Sales, Security and Sustainability — via
 * GET /api/executive/kpi-center (see executive.routes.ts).
 *
 * Features:
 * - KPI scorecards grouped by portal-aligned categories
 * - Real period-over-period trends (7/30/90/365-day windows)
 * - Search + category filters
 * - CSV export
 * - Drill-down detail modal
 */

import { useEffect, useMemo, useState } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Search,
  Download,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  X,
  Building2,
} from 'lucide-react';
import { useERP } from '../../../../context/ERPContext';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { drillTargetFor } from '../../../../config/execDrilldown';
import { ExecPeriodSelector, windowLabel } from '../ExecPeriodSelector';
import { fetchKpiCenter, type EnterpriseKpi, type ExecWindow } from '../../../../services/executiveService';

/** Tiny inline SVG sparkline for the metric_history daily series. */
const KpiSparkline = ({ history, up }: { history: { date: string; value: number }[]; up: boolean | null }) => {
  if (history.length < 2) return null;
  const values = history.map(h => h.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 96;
  const h = 24;
  const step = w / (values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / span) * (h - 2) - 1).toFixed(1)}`).join(' ');
  const stroke = up === null ? '#94a3b8' : up ? '#059669' : '#e11d48';
  return (
    <svg width={w} height={h} className="shrink-0" aria-hidden="true">
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};

const CATEGORY_ICONS: Record<string, string> = {
  Financial: 'bg-emerald-500',
  'Rooms & Operations': 'bg-indigo-500',
  'Guest Experience': 'bg-amber-500',
  Housekeeping: 'bg-cyan-500',
  'Food & Beverage': 'bg-orange-500',
  Engineering: 'bg-slate-500',
  'Human Resources': 'bg-purple-500',
  Procurement: 'bg-pink-500',
  Inventory: 'bg-teal-500',
  'Sales & Marketing': 'bg-blue-500',
  'Security & Risk': 'bg-rose-500',
  Sustainability: 'bg-green-600',
};

const EnterpriseKPIcenter = () => {
  const navigate = useNavigate();
  const { currentPropertyId, formatAmount } = useERP();
  const [kpis, setKpis] = useState<EnterpriseKpi[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<ExecWindow>(30);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedKPI, setSelectedKPI] = useState<EnterpriseKpi | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchKpiCenter(currentPropertyId, days);
      setKpis(res.kpis);
      setGeneratedAt(res.generatedAt);
    } catch (e: any) {
      setError(e?.message || 'Failed to load KPIs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId, days]);

  const formatValue = (value: number, unit: string): string => {
    switch (unit) {
      case 'currency':
        return formatAmount(value);
      case '%':
        return `${value.toLocaleString()}%`;
      case '/5':
        return `${value.toFixed(1)}/5`;
      case 'count':
        return Math.round(value).toLocaleString();
      default:
        return `${value.toLocaleString()}${unit ? ` ${unit}` : ''}`;
    }
  };

  const categories = useMemo(
    () => [...new Set(kpis.map(k => k.category))],
    [kpis],
  );

  const filteredKPIs = kpis.filter(kpi => {
    const matchesCategory = selectedCategory === 'all' || kpi.category === selectedCategory;
    const q = searchTerm.toLowerCase();
    const matchesSearch =
      kpi.name.toLowerCase().includes(q) ||
      kpi.owner.toLowerCase().includes(q) ||
      kpi.source.toLowerCase().includes(q);
    return matchesCategory && matchesSearch;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'on-track':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400';
      case 'at-risk':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
      case 'off-track':
        return 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'on-track':
        return <CheckCircle2 className="w-4 h-4" />;
      case 'at-risk':
        return <AlertTriangle className="w-4 h-4" />;
      case 'off-track':
        return <XCircle className="w-4 h-4" />;
      default:
        return null;
    }
  };

  /** Progress bar fill — for lower-is-better KPIs we show target headroom instead. */
  const progressWidth = (kpi: EnterpriseKpi) => {
    if (kpi.target === 0) return kpi.currentValue > 0 ? 100 : 0;
    if (kpi.lowerIsBetter) return Math.min((kpi.target / Math.max(kpi.currentValue, 0.0001)) * 100, 100);
    return Math.min((kpi.currentValue / kpi.target) * 100, 100);
  };

  /** Whether the period-over-period movement is a good thing. */
  const trendIsGood = (kpi: EnterpriseKpi) =>
    kpi.trend === null ? null : kpi.lowerIsBetter ? kpi.trend <= 0 : kpi.trend >= 0;

  const categoryStats = categories.reduce((acc, category) => {
    const categoryKPIs = kpis.filter(kpi => kpi.category === category);
    acc[category] = {
      total: categoryKPIs.length,
      onTrack: categoryKPIs.filter(k => k.status === 'on-track').length,
      atRisk: categoryKPIs.filter(k => k.status === 'at-risk').length,
      offTrack: categoryKPIs.filter(k => k.status === 'off-track').length,
    };
    return acc;
  }, {} as Record<string, { total: number; onTrack: number; atRisk: number; offTrack: number }>);

  const exportCsv = () => {
    const header = 'KPI,Category,Source,Current,Previous,Target,Threshold,Unit,Trend %,Status,Owner,Last Updated';
    const rows = kpis.map(k =>
      [
        `"${k.name}"`, `"${k.category}"`, `"${k.source}"`, k.currentValue,
        k.previousValue ?? '', k.target, k.threshold, `"${k.unit}"`,
        k.trend ?? '', k.status, `"${k.owner}"`, k.lastUpdated,
      ].join(','),
    );
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `enterprise-kpis-${String(days)}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Enterprise KPI Center
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Live KPIs aggregated across all departments
            {generatedAt && (
              <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">
                · updated {new Date(generatedAt).toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Period selector */}
          <ExecPeriodSelector value={days} onChange={setDays} />
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            onClick={exportCsv}
            disabled={kpis.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg text-rose-700 dark:text-rose-300">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span className="flex-1 text-sm">{error}</span>
          <button onClick={load} className="text-sm font-medium underline hover:no-underline">
            Retry
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && kpis.length === 0 ? (
        <div className="flex items-center justify-center py-24 text-gray-500 dark:text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin mr-3" />
          <span>Loading live KPIs…</span>
        </div>
      ) : (
        <>
          {/* Category Overview — one card per portal-aligned group */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {categories.map(category => {
              const stats = categoryStats[category];
              const onTrackPercent = stats.total > 0 ? (stats.onTrack / stats.total) * 100 : 0;

              return (
                <div
                  key={category}
                  onClick={() => setSelectedCategory(selectedCategory === category ? 'all' : category)}
                  className={`p-4 rounded-lg border cursor-pointer transition-all ${
                    selectedCategory === category
                      ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500 dark:border-indigo-400'
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-600'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${CATEGORY_ICONS[category] || 'bg-gray-400'}`} />
                      <h3 className="font-semibold text-gray-900 dark:text-white text-sm truncate">
                        {category}
                      </h3>
                    </div>
                    <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                      {stats.total}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-emerald-600 dark:text-emerald-400">On Track: {stats.onTrack}</span>
                      <span className="text-rose-600 dark:text-rose-400">Off: {stats.offTrack}</span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div
                        className="bg-emerald-500 h-2 rounded-full transition-all"
                        style={{ width: `${onTrackPercent}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Filters */}
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search KPIs, owners, or source departments..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="all">All Categories</option>
              {categories.map(category => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </div>

          {/* KPI Grid */}
          {filteredKPIs.length === 0 ? (
            <div className="text-center py-16 text-gray-500 dark:text-gray-400">
              <Building2 className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>No KPIs match the current filters.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredKPIs.map(kpi => (
                <div
                  key={kpi.id}
                  className="bg-white dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow cursor-pointer"
                  onClick={() => setSelectedKPI(kpi)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 dark:text-white truncate">
                        {kpi.name}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        {kpi.category} · <span className="text-indigo-500 dark:text-indigo-400">{kpi.source}</span>
                      </p>
                    </div>
                    <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium shrink-0 ${getStatusColor(kpi.status)}`}>
                      {getStatusIcon(kpi.status)}
                      <span className="capitalize">{kpi.status.replace('-', ' ')}</span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-end justify-between">
                      <div>
                        <p className="text-2xl font-bold text-gray-900 dark:text-white">
                          {formatValue(kpi.currentValue, kpi.unit)}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Current ({windowLabel(days)})
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          {kpi.target !== 0 ? formatValue(kpi.target, kpi.unit) : '—'}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Target
                        </p>
                      </div>
                    </div>

                    {kpi.history && kpi.history.length > 1 && (
                      <div className="flex items-center justify-between gap-2">
                        <KpiSparkline history={kpi.history} up={trendIsGood(kpi)} />
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
                          {kpi.history.length}d history
                        </span>
                      </div>
                    )}

                    {kpi.target !== 0 && (
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all ${
                            kpi.status === 'on-track' ? 'bg-emerald-500' :
                            kpi.status === 'at-risk' ? 'bg-amber-500' :
                            'bg-rose-500'
                          }`}
                          style={{ width: `${progressWidth(kpi)}%` }}
                        />
                      </div>
                    )}

                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1">
                        {kpi.trend === null ? (
                          <>
                            <Minus className="w-3 h-3 text-gray-400" />
                            <span className="text-gray-500 dark:text-gray-400">snapshot</span>
                          </>
                        ) : (
                          <>
                            {trendIsGood(kpi) ? (
                              <TrendingUp className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <TrendingDown className="w-3 h-3 text-rose-600" />
                            )}
                            <span className={trendIsGood(kpi) ? 'text-emerald-600' : 'text-rose-600'}>
                              {kpi.trend >= 0 ? '+' : ''}{kpi.trend}%
                            </span>
                            <span className="text-gray-500 dark:text-gray-400">vs prev {windowLabel(days)}</span>
                          </>
                        )}
                      </div>
                      <div className="text-gray-500 dark:text-gray-400 truncate ml-2">
                        {kpi.owner}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* KPI Detail Modal */}
      {selectedKPI && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                    {selectedKPI.name}
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400 mt-1">
                    {selectedKPI.category} · sourced from {selectedKPI.source}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedKPI(null)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Current ({windowLabel(days)})</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                    {formatValue(selectedKPI.currentValue, selectedKPI.unit)}
                  </p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Previous ({windowLabel(days)})</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                    {selectedKPI.previousValue !== null
                      ? formatValue(selectedKPI.previousValue, selectedKPI.unit)
                      : '—'}
                  </p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Target / Threshold</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                    {selectedKPI.target !== 0
                      ? `${formatValue(selectedKPI.target, selectedKPI.unit)} / ${formatValue(selectedKPI.threshold, selectedKPI.unit)}`
                      : '—'}
                  </p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Trend</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                    {selectedKPI.trend !== null
                      ? `${selectedKPI.trend >= 0 ? '+' : ''}${selectedKPI.trend}%`
                      : '—'}
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <span className="text-gray-700 dark:text-gray-300">Owner</span>
                  <span className="font-medium text-gray-900 dark:text-white">{selectedKPI.owner}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <span className="text-gray-700 dark:text-gray-300">Status</span>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(selectedKPI.status)}`}>
                    {selectedKPI.status.replace('-', ' ')}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <span className="text-gray-700 dark:text-gray-300">Direction</span>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {selectedKPI.lowerIsBetter ? 'Lower is better' : 'Higher is better'}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <span className="text-gray-700 dark:text-gray-300">Last Updated</span>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {new Date(selectedKPI.lastUpdated).toLocaleString()}
                  </span>
                </div>
                {(() => {
                  const target = drillTargetFor(selectedKPI.source);
                  if (!target) return null;
                  return (
                    <button
                      onClick={() => { setSelectedKPI(null); navigate(target.path); }}
                      className="w-full flex items-center justify-center gap-2 p-3 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
                    >
                      Open {target.label}
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EnterpriseKPIcenter;
