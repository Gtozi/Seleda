/**
 * Sustainability Intelligence Module
 *
 * Live data from GET /api/executive/sustainability-intelligence:
 * - Utility consumption/cost/carbon from energy_metrics
 * - Equipment efficiency from energy_equipment_efficiency
 * - Green projects from energy_projects
 * - Waste aggregated across uinv_waste + fb_waste_records + kitchen_waste + bar_waste
 * - Supplier ESG from proc_sustainability
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Leaf,
  TrendingUp,
  TrendingDown,
  Zap,
  Droplets,
  Fuel,
  Cloud,
  Trash2,
  Download,
  RefreshCw,
  AlertTriangle,
  Minus,
  BarChart3,
  Database,
  Sun,
} from 'lucide-react';
import { useERP } from '../../../../context/ERPContext';
import {
  fetchSustainabilityIntelligence,
  SusMetric,
  SusCategory,
} from '../../../../services/executiveService';

const SUS_CATEGORIES: { id: SusCategory | 'all'; label: string; icon: any }[] = [
  { id: 'all', label: 'All Analytics', icon: BarChart3 },
  { id: 'energy', label: 'Energy', icon: Zap },
  { id: 'water', label: 'Water', icon: Droplets },
  { id: 'fuel', label: 'Fuel', icon: Fuel },
  { id: 'carbon', label: 'Carbon', icon: Cloud },
  { id: 'waste', label: 'Waste', icon: Trash2 },
  { id: 'esg', label: 'ESG', icon: Leaf },
];

const PROJ_STATUS: Record<string, string> = {
  Completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  'In Progress': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  Planned: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
};

const EFF_STATUS: Record<string, string> = {
  Critical: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400',
  Warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  Optimal: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
};

const SustainabilityIntelligence = () => {
  const { currentPropertyId, formatAmount } = useERP();
  const [data, setData] = useState<{
    metrics: SusMetric[];
    utilityBreakdown: { utility: string; cur: number; prev: number; unit: string }[];
    energyProjects: { name: string; type: string; status: string; estSavings: number; actSavings: number; investment: number; roi: number }[];
    wasteByDept: { department: string; value: number; sharePct: number }[];
    equipmentBelowTarget: { name: string; category: string; current: number; target: number; status: string }[];
    topSuppliers: { name: string; score: number; local: boolean; cert: string | null }[];
    roomNights: number;
  }>({
    metrics: [], utilityBreakdown: [], energyProjects: [],
    wasteByDept: [], equipmentBelowTarget: [], topSuppliers: [], roomNights: 0,
  });
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [selectedCategory, setSelectedCategory] = useState<SusCategory | 'all'>('all');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchSustainabilityIntelligence(currentPropertyId, days);
      setData({
        metrics: res.metrics,
        utilityBreakdown: res.utilityBreakdown,
        energyProjects: res.energyProjects,
        wasteByDept: res.wasteByDept,
        equipmentBelowTarget: res.equipmentBelowTarget,
        topSuppliers: res.topSuppliers,
        roomNights: res.roomNights,
      });
      setGeneratedAt(res.generatedAt);
    } catch (e: any) {
      setError(e?.message || 'Failed to load sustainability intelligence');
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
      case 'currency': return formatAmount(value);
      case '%': return `${value.toLocaleString()}%`;
      case '/100': return `${value.toFixed(1)}/100`;
      case 'kWh': return `${value.toLocaleString()} kWh`;
      case 'liters': return `${value.toLocaleString()} L`;
      case 'm³': return `${value.toLocaleString()} m³`;
      case 'tons': return `${value.toLocaleString()} t`;
      case 'units': return `${value.toLocaleString()} units`;
      case 'count': return Math.round(value).toLocaleString();
      default: return `${value.toLocaleString()} ${unit}`.trim();
    }
  };

  const formatUtil = (value: number, unit: string) =>
    `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`;

  const exportCsv = () => {
    const header = 'Metric,Category,Current,Previous,Target,Unit,Trend %,Status';
    const rows = data.metrics.map(m =>
      [m.name, m.category, m.value, m.previousValue ?? '', m.target, m.unit, m.trend ?? '', m.status]
        .map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sustainability-intelligence-${days}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredMetrics = selectedCategory === 'all'
    ? data.metrics
    : data.metrics.filter(m => m.category === selectedCategory);

  const categoriesWithData = useMemo(
    () => new Set(data.metrics.map(m => m.category)),
    [data.metrics],
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'on-track': return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400';
      case 'at-risk': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
      case 'off-track': return 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400';
    }
  };

  const trendColor = (trend: number | null, lowerIsBetter: boolean) => {
    if (trend === null) return 'text-gray-500 dark:text-gray-400';
    const good = lowerIsBetter ? trend <= 0 : trend >= 0;
    return good ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
  };

  const utilDelta = (cur: number, prev: number) => {
    if (!prev) return null;
    return Math.round(((cur - prev) / prev) * 100);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Sustainability Intelligence
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Environmental KPIs, carbon emissions, waste, and supplier ESG
            {generatedAt && (
              <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
                · Updated {new Date(generatedAt).toLocaleString()}
              </span>
            )}
            {data.roomNights > 0 && (
              <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
                · {data.roomNights.toLocaleString()} occupied room nights
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last year</option>
          </select>
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
            disabled={data.metrics.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* Loading / Error */}
      {loading && data.metrics.length === 0 && (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-6 h-6 animate-spin text-indigo-500" />
          <span className="ml-3 text-gray-500 dark:text-gray-400">Loading sustainability metrics…</span>
        </div>
      )}

      {error && (
        <div className="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
          <div>
            <p className="text-sm font-medium text-rose-800 dark:text-rose-300">{error}</p>
            <p className="text-xs text-rose-600 dark:text-rose-400">Check your connection and try refreshing.</p>
          </div>
        </div>
      )}

      {data.metrics.length > 0 && (
        <>
          {/* Categories */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
            {SUS_CATEGORIES.map(cat => {
              const Icon = cat.icon;
              const empty = cat.id !== 'all' && !categoriesWithData.has(cat.id as SusCategory);
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`p-4 rounded-lg border transition-all ${
                    selectedCategory === cat.id
                      ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500 dark:border-indigo-400'
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-600'
                  } ${empty ? 'opacity-50' : ''}`}
                >
                  <Icon className="w-6 h-6 mx-auto mb-2 text-indigo-600" />
                  <p className="text-sm font-medium text-gray-900 dark:text-white text-center">{cat.label}</p>
                </button>
              );
            })}
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredMetrics.map(metric => (
              <div
                key={metric.id}
                className="bg-white dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900 dark:text-white">{metric.name}</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 capitalize">{metric.category}</p>
                  </div>
                  {metric.target !== 0 && (
                    <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(metric.status)}`}>
                      <span className="capitalize">{metric.status.replace('-', ' ')}</span>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white">
                        {formatValue(metric.value, metric.unit)}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Current</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {metric.target !== 0 ? formatValue(metric.target, metric.unit) : '—'}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Target</p>
                    </div>
                  </div>

                  {metric.target !== 0 && (
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${
                          metric.status === 'on-track' ? 'bg-emerald-500' : metric.status === 'at-risk' ? 'bg-amber-500' : 'bg-rose-500'
                        }`}
                        style={{ width: `${Math.min(Math.abs(metric.value / metric.target) * 100, 100)}%` }}
                      />
                    </div>
                  )}

                  <div className={`flex items-center gap-1 text-xs ${trendColor(metric.trend, metric.lowerIsBetter)}`}>
                    {metric.trend === null ? (
                      <>
                        <Minus className="w-3 h-3" />
                        <span>No prior baseline</span>
                      </>
                    ) : (
                      <>
                        {metric.trend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        <span>{metric.trend >= 0 ? '+' : ''}{metric.trend}% vs previous period</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {filteredMetrics.length === 0 && (
              <div className="col-span-full text-center py-12 text-gray-500 dark:text-gray-400">
                <Database className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No metrics recorded in this category for the selected period.</p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Utility Breakdown */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Utility Consumption
              </h3>
              {data.utilityBreakdown.every(u => u.cur === 0 && u.prev === 0) ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                  No utility readings recorded in this period.
                </p>
              ) : (
                <div className="space-y-4">
                  {data.utilityBreakdown.map(u => {
                    const delta = utilDelta(u.cur, u.prev);
                    const Icon = u.utility === 'Solar' ? Sun : u.utility === 'Water' ? Droplets : u.utility === 'Electricity' ? Zap : Fuel;
                    return (
                      <div key={u.utility} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                        <div className="flex items-center gap-3">
                          <Icon className="w-4 h-4 text-indigo-500" />
                          <span className="font-medium text-gray-900 dark:text-white">{u.utility}</span>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-gray-900 dark:text-white">
                            {formatUtil(u.cur, u.unit)}
                          </p>
                          {delta !== null && (
                            <span className={`text-xs font-medium ${delta <= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                              {delta >= 0 ? '+' : ''}{delta}% vs prior
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Waste by Department */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Waste Cost by Department
              </h3>
              {data.wasteByDept.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                  No waste records in this period.
                </p>
              ) : (
                <div className="space-y-3">
                  {data.wasteByDept.map(w => (
                    <div key={w.department} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-900 dark:text-white">{w.department}</span>
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          {formatAmount(w.value)} · {w.sharePct}%
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                        <div
                          className="h-2 rounded-full bg-emerald-500"
                          style={{ width: `${w.sharePct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Energy Projects */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Green Projects
              </h3>
              {data.energyProjects.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                  No energy projects defined.
                </p>
              ) : (
                <div className="space-y-3">
                  {data.energyProjects.map(p => (
                    <div key={p.name} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 dark:text-white truncate">{p.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {p.type} · invest {formatAmount(p.investment)} · ROI {p.roi}%
                        </p>
                      </div>
                      <div className="flex items-center gap-3 ml-3">
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          saves {formatAmount(p.actSavings || p.estSavings)}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PROJ_STATUS[p.status] || PROJ_STATUS.Planned}`}>
                          {p.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Equipment Below Target + Sustainable Suppliers */}
            <div className="space-y-6">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  Equipment Below Efficiency Target
                </h3>
                {data.equipmentBelowTarget.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                    All monitored equipment is running at optimal efficiency.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {data.equipmentBelowTarget.map(e => (
                      <div key={e.name} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 dark:text-white truncate">{e.name}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {e.category} · {e.current}% vs {e.target}% target
                          </p>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ml-3 ${EFF_STATUS[e.status] || EFF_STATUS.Warning}`}>
                          {e.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  Sustainable Suppliers
                </h3>
                {data.topSuppliers.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                    No suppliers assessed for sustainability yet.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {data.topSuppliers.map(s => (
                      <div key={s.name} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 dark:text-white truncate">{s.name}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {[s.local && 'Local', s.cert].filter(Boolean).join(' · ') || 'Assessed'}
                          </p>
                        </div>
                        <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 ml-3">
                          {s.score}/100
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {!loading && !error && data.metrics.length === 0 && (
        <div className="text-center py-16 text-gray-500 dark:text-gray-400">
          <Database className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p className="font-medium">No sustainability data available for the selected period.</p>
          <p className="text-sm mt-1">Utility readings, waste records, and supplier assessments will appear here once recorded.</p>
        </div>
      )}
    </div>
  );
};

export default SustainabilityIntelligence;
