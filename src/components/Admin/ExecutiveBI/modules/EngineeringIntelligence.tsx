/**
 * Engineering Intelligence Module
 *
 * Live data from GET /api/executive/eng-intelligence:
 * - Assets from fixed_assets (availability, age, NBV, category mix)
 * - Maintenance/downtime from work_orders + corrective_maintenance_tasks + work_requests
 * - PM compliance from pm_schedules (next_due vs last_completed vs interval)
 * - Energy/utilities from energy_metrics (kWh, water, gas, diesel, solar, carbon)
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Wrench,
  TrendingUp,
  TrendingDown,
  Building2,
  Clock,
  AlertTriangle,
  BarChart3,
  Zap,
  Download,
  RefreshCw,
  CheckCircle2,
  Thermometer,
  Database,
  Minus,
} from 'lucide-react';
import { useERP } from '../../../../context/ERPContext';
import {
  fetchEngIntelligence,
  EngMetric,
  EngCategory,
} from '../../../../services/executiveService';

const ENG_CATEGORIES: { id: EngCategory | 'all'; label: string; icon: any }[] = [
  { id: 'all', label: 'All Analytics', icon: BarChart3 },
  { id: 'assets', label: 'Assets', icon: Building2 },
  { id: 'downtime', label: 'Downtime', icon: Clock },
  { id: 'maintenance', label: 'Maintenance', icon: Wrench },
  { id: 'pm', label: 'PM Compliance', icon: CheckCircle2 },
  { id: 'energy', label: 'Energy', icon: Zap },
  { id: 'utilities', label: 'Utilities', icon: Thermometer },
];

const WO_STATUS_COLORS: Record<string, string> = {
  'Open': 'bg-blue-500',
  'Assigned': 'bg-indigo-500',
  'In Progress': 'bg-amber-500',
  'Waiting for Parts': 'bg-purple-500',
  'Waiting for Vendor': 'bg-orange-500',
  'Completed': 'bg-emerald-500',
  'Verified': 'bg-teal-500',
  'Closed': 'bg-gray-500',
};

const ENERGY_COLORS = ['bg-amber-500', 'bg-blue-500', 'bg-orange-500', 'bg-rose-500', 'bg-emerald-500'];

const EngineeringIntelligence = () => {
  const { currentPropertyId, formatAmount } = useERP();
  const [data, setData] = useState<{
    metrics: EngMetric[];
    woStatusBoard: { status: string; count: number }[];
    energyBreakdown: { type: string; unit: string; usage: number; prevUsage: number }[];
    assetCategories: { category: string; count: number; nbv: number }[];
  }>({ metrics: [], woStatusBoard: [], energyBreakdown: [], assetCategories: [] });
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [selectedCategory, setSelectedCategory] = useState<EngCategory | 'all'>('all');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchEngIntelligence(currentPropertyId, days);
      setData({
        metrics: res.metrics,
        woStatusBoard: res.woStatusBoard,
        energyBreakdown: res.energyBreakdown,
        assetCategories: res.assetCategories,
      });
      setGeneratedAt(res.generatedAt);
    } catch (e: any) {
      setError(e?.message || 'Failed to load engineering intelligence');
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
      case 'hrs': return `${value.toFixed(1)} hrs`;
      case 'years': return `${value.toFixed(1)} yrs`;
      case 'tons': return `${value.toLocaleString()} t`;
      case 'count': return Math.round(value).toLocaleString();
      default: return `${value.toLocaleString()} ${unit}`.trim();
    }
  };

  const exportCsv = () => {
    const header = 'Metric,Category,Current,Previous,Target,Unit,Trend %,Status';
    const rows = data.metrics.map(m =>
      [m.name, m.category, m.value, m.previousValue ?? '', m.target, m.unit, m.trend ?? '', m.status]
        .map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `engineering-intelligence-${days}d.csv`;
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

  const maxAssetCat = Math.max(1, ...data.assetCategories.map(c => c.count));
  const maxEnergy = Math.max(1, ...data.energyBreakdown.map(e => e.usage));

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

  const usageTrend = (usage: number, prevUsage: number): number | null =>
    prevUsage > 0 ? Math.round(((usage - prevUsage) / prevUsage) * 100) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Engineering Intelligence
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Asset performance, maintenance, and energy analytics
            {generatedAt && (
              <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
                · Updated {new Date(generatedAt).toLocaleString()}
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
          <span className="ml-3 text-gray-500 dark:text-gray-400">Loading engineering metrics…</span>
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
            {ENG_CATEGORIES.map(cat => {
              const Icon = cat.icon;
              const empty = cat.id !== 'all' && !categoriesWithData.has(cat.id as EngCategory);
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
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 capitalize">
                      {metric.category === 'pm' ? 'PM Compliance' : metric.category}
                    </p>
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
            {/* Work Order Status */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Work Order Status
              </h3>
              {data.woStatusBoard.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                  No work orders recorded.
                </p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {data.woStatusBoard.map(order => (
                    <div key={order.status} className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg text-center">
                      <div className={`w-3 h-3 rounded-full ${WO_STATUS_COLORS[order.status] || 'bg-gray-500'} mx-auto mb-2`} />
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{order.status}</p>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{order.count}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">orders</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Asset Categories */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-indigo-600" />
                Asset Categories
              </h3>
              {data.assetCategories.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                  No assets registered yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {data.assetCategories.map(c => (
                    <div key={c.category} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-900 dark:text-white">{c.category}</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {c.count} assets · {formatAmount(c.nbv)} NBV
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                        <div
                          className="h-2 rounded-full bg-indigo-500"
                          style={{ width: `${(c.count / maxAssetCat) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Energy Consumption */}
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-500" />
              Energy &amp; Utility Consumption
            </h3>
            {data.energyBreakdown.every(e => e.usage === 0) ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                No energy meter readings recorded in this period.
              </p>
            ) : (
              <div className="space-y-4">
                {data.energyBreakdown.filter(e => e.usage > 0 || e.prevUsage > 0).map((energy, i) => {
                  const trend = usageTrend(energy.usage, energy.prevUsage);
                  return (
                    <div key={energy.type} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-3 h-3 rounded-full ${ENERGY_COLORS[i % ENERGY_COLORS.length]}`} />
                          <div>
                            <p className="font-medium text-gray-900 dark:text-white">{energy.type}</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                              {energy.usage.toLocaleString()} {energy.unit}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          {trend !== null ? (
                            <span className={`text-sm font-medium ${trend <= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                              {trend >= 0 ? '+' : ''}{trend}% vs prior
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400 dark:text-gray-500">No prior baseline</span>
                          )}
                        </div>
                      </div>
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${ENERGY_COLORS[i % ENERGY_COLORS.length]}`}
                          style={{ width: `${(energy.usage / maxEnergy) * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default EngineeringIntelligence;
