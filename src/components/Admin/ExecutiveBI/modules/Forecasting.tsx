/**
 * Forecasting Module
 *
 * Live data from GET /api/executive/forecasting:
 * - Rooms demand/occupancy from demand_forecasts + forecast_accuracy
 * - F&B sales/labor from fb_sales_forecasts + fb_labor_forecast
 * - Housekeeping demand from ops_housekeeping_demand_forecast
 * - Labor cost from ops_labor_cost_forecast
 * - Procurement demand from proc_demand_forecasts
 * - Cash/liquidity from treasury_cash_forecasts + treasury_liquidity_forecasts
 * - Finance BI forecasts from fin_bi_forecasts
 * - Demand events, heat map, RMS accuracy from demand_events + rms_bi_*
 */

import { useEffect, useMemo, useState } from 'react';
import {
  TrendingUp,
  DollarSign,
  Bed,
  Wallet,
  Users,
  ShoppingCart,
  Zap,
  Activity,
  Download,
  RefreshCw,
  AlertTriangle,
  BarChart3,
  Database,
  Calendar,
} from 'lucide-react';
import { useERP } from '../../../../context/ERPContext';
import {
  fetchForecasting,
  FcMetric,
  FcCategory,
} from '../../../../services/executiveService';

const FC_CATEGORIES: { id: FcCategory | 'all'; label: string; icon: any }[] = [
  { id: 'all', label: 'All Forecasts', icon: BarChart3 },
  { id: 'revenue', label: 'Revenue', icon: DollarSign },
  { id: 'occupancy', label: 'Occupancy', icon: Bed },
  { id: 'cashflow', label: 'Cash Flow', icon: Wallet },
  { id: 'payroll', label: 'Payroll', icon: Users },
  { id: 'purchase', label: 'Purchase', icon: ShoppingCart },
  { id: 'utility', label: 'Utility', icon: Zap },
  { id: 'labor', label: 'Labor', icon: Activity },
  { id: 'demand', label: 'Demand', icon: Calendar },
];

const LIQ_COLORS: Record<string, string> = {
  Surplus: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  Watch: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  Deficit: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const Forecasting = () => {
  const { currentPropertyId, formatAmount } = useERP();
  const [data, setData] = useState<{
    metrics: FcMetric[];
    accuracyBySource: { source: string; accuracy: number; variance: number }[];
    upcomingEvents: { name: string; type: string; start: string; end: string; impact: number; roomNights: number; attendees: number }[];
    heatMapByType: Record<string, Record<number, number>>;
    cashForecast: { period: string; inflows: number; outflows: number; net: number; closing: number }[];
    deptLabor: { department: string; projected: number; budget: number; variancePct: number; confidence: number }[];
    procForecast: { department: string; qty: number; items: number }[];
    liquidityWeeks: { week: string; closing: number; status: string }[];
  }>({
    metrics: [], accuracyBySource: [], upcomingEvents: [], heatMapByType: {},
    cashForecast: [], deptLabor: [], procForecast: [], liquidityWeeks: [],
  });
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [selectedCategory, setSelectedCategory] = useState<FcCategory | 'all'>('all');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchForecasting(currentPropertyId, days);
      setData({
        metrics: res.metrics,
        accuracyBySource: res.accuracyBySource,
        upcomingEvents: res.upcomingEvents,
        heatMapByType: res.heatMapByType,
        cashForecast: res.cashForecast,
        deptLabor: res.deptLabor,
        procForecast: res.procForecast,
        liquidityWeeks: res.liquidityWeeks,
      });
      setGeneratedAt(res.generatedAt);
    } catch (e: any) {
      setError(e?.message || 'Failed to load forecasting');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId, days]);

  const formatValue = (value: number | null, unit: string): string => {
    if (value === null) return '—';
    switch (unit) {
      case 'currency': return formatAmount(value);
      case '%': return `${value.toFixed(1)}%`;
      case 'hrs': return `${value.toLocaleString()} hrs`;
      case 'room-nights': return `${Math.round(value).toLocaleString()} rn`;
      case 'staff-days': return `${Math.round(value).toLocaleString()} sd`;
      case 'count': return Math.round(value).toLocaleString();
      case 'units': return `${value.toLocaleString()} units`;
      default: return `${value.toLocaleString()} ${unit}`.trim();
    }
  };

  const getAccuracyColor = (accuracy: number | null) => {
    if (accuracy === null) return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400';
    if (accuracy >= 95) return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400';
    if (accuracy >= 90) return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
    if (accuracy >= 85) return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
    return 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400';
  };

  const exportCsv = () => {
    const header = 'Metric,Category,Forecast,Actual,Accuracy %,Confidence %,Unit';
    const rows = data.metrics.map(m =>
      [m.name, m.category, m.forecast, m.actual ?? '', m.accuracy ?? '', m.confidence ?? '', m.unit]
        .map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `forecasting-${days}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredMetrics = selectedCategory === 'all'
    ? data.metrics
    : data.metrics.filter(m => m.category === selectedCategory);

  const categoriesWithData = useMemo(
    () => new Set(data.metrics.filter(m => m.forecast !== 0 || m.actual !== null).map(m => m.category)),
    [data.metrics],
  );

  const accSummary = useMemo(() => {
    const accs = data.metrics.map(m => m.accuracy).filter((a): a is number => a !== null);
    return {
      excellent: accs.filter(a => a >= 95).length,
      good: accs.filter(a => a >= 90 && a < 95).length,
      fair: accs.filter(a => a >= 85 && a < 90).length,
      poor: accs.filter(a => a < 85).length,
      total: accs.length,
    };
  }, [data.metrics]);

  const heatTypes = Object.keys(data.heatMapByType);
  const maxIntensity = Math.max(
    ...heatTypes.flatMap(t => Object.values(data.heatMapByType[t])),
    1,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Forecasting
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Demand, revenue, labor, and cash forecasts across all departments
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
            <option value={7}>Context: 7 days</option>
            <option value={30}>Context: 30 days</option>
            <option value={90}>Context: 90 days</option>
            <option value={365}>Context: 1 year</option>
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
          <span className="ml-3 text-gray-500 dark:text-gray-400">Loading forecasts…</span>
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
          {/* Forecast Types */}
          <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-3">
            {FC_CATEGORIES.map(type => {
              const Icon = type.icon;
              const empty = type.id !== 'all' && !categoriesWithData.has(type.id as FcCategory);
              return (
                <button
                  key={type.id}
                  onClick={() => setSelectedCategory(type.id)}
                  className={`p-3 rounded-lg border transition-all ${
                    selectedCategory === type.id
                      ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500 dark:border-indigo-400'
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-600'
                  } ${empty ? 'opacity-50' : ''}`}
                >
                  <Icon className="w-5 h-5 mx-auto mb-1 text-indigo-600" />
                  <p className="text-xs font-medium text-gray-900 dark:text-white text-center">{type.label}</p>
                </button>
              );
            })}
          </div>

          {/* Forecast Metrics */}
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
                  {metric.accuracy !== null && (
                    <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${getAccuracyColor(metric.accuracy)}`}>
                      <TrendingUp className="w-4 h-4" />
                      <span>{metric.accuracy}%</span>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white">
                        {formatValue(metric.forecast, metric.unit)}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Forecast</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {formatValue(metric.actual, metric.unit)}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Actual</p>
                    </div>
                  </div>

                  {metric.accuracy !== null && (
                    <>
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                        <div
                          className="bg-indigo-500 h-2 rounded-full"
                          style={{ width: `${Math.min(metric.accuracy, 100)}%` }}
                        />
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Forecast accuracy{metric.confidence !== null ? ` · ${metric.confidence}% confidence` : ''}
                      </p>
                    </>
                  )}
                  {metric.accuracy === null && metric.confidence !== null && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {metric.confidence}% model confidence
                    </p>
                  )}
                </div>
              </div>
            ))}
            {filteredMetrics.length === 0 && (
              <div className="col-span-full text-center py-12 text-gray-500 dark:text-gray-400">
                <Database className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No forecasts in this category yet.</p>
              </div>
            )}
          </div>

          {/* Accuracy Summary */}
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Forecast Accuracy Summary
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Excellent (95%+)', count: accSummary.excellent, color: 'bg-emerald-500' },
                { label: 'Good (90-94%)', count: accSummary.good, color: 'bg-blue-500' },
                { label: 'Fair (85-89%)', count: accSummary.fair, color: 'bg-amber-500' },
                { label: 'Poor (<85%)', count: accSummary.poor, color: 'bg-rose-500' },
              ].map(s => (
                <div key={s.label} className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg text-center">
                  <div className={`w-3 h-3 rounded-full ${s.color} mx-auto mb-2`} />
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{s.label}</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{s.count}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    of {accSummary.total} tracked forecasts
                  </p>
                </div>
              ))}
            </div>
            {data.accuracyBySource.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4">
                {data.accuracyBySource.map(a => (
                  <span key={a.source} className={`px-3 py-1 rounded-full text-xs font-medium ${getAccuracyColor(a.accuracy)}`}>
                    {a.source}: {a.accuracy}%
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Upcoming Demand Events */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Upcoming Demand Events
              </h3>
              {data.upcomingEvents.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                  No active demand events scheduled.
                </p>
              ) : (
                <div className="space-y-3">
                  {data.upcomingEvents.map(e => (
                    <div key={e.name} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 dark:text-white truncate">{e.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {e.type} · {new Date(e.start).toLocaleDateString()} → {new Date(e.end).toLocaleDateString()}
                          {e.attendees > 0 ? ` · ${e.attendees.toLocaleString()} attendees` : ''}
                        </p>
                      </div>
                      <div className="text-right ml-3">
                        <p className="text-sm font-bold text-indigo-600 dark:text-indigo-400">+{e.roomNights} rn</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">impact {e.impact}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Cash Forecast */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Cash Flow Forecast
              </h3>
              {data.cashForecast.length === 0 && data.liquidityWeeks.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                  No treasury forecasts recorded.
                </p>
              ) : (
                <>
                  <div className="space-y-3">
                    {data.cashForecast.map(c => (
                      <div key={c.period} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 dark:text-white truncate">{c.period}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            in {formatAmount(c.inflows)} · out {formatAmount(c.outflows)}
                          </p>
                        </div>
                        <div className="text-right ml-3">
                          <p className={`text-sm font-bold ${c.net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            {c.net >= 0 ? '+' : ''}{formatAmount(c.net)}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">close {formatAmount(c.closing)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  {data.liquidityWeeks.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-4">
                      {data.liquidityWeeks.map(l => (
                        <span key={l.week} className={`px-3 py-1 rounded-full text-xs font-medium ${LIQ_COLORS[l.status] || LIQ_COLORS.Watch}`}>
                          {l.week}: {formatAmount(l.closing)} ({l.status})
                        </span>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Department Labor Forecast */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Labor Cost Forecast by Department
              </h3>
              {data.deptLabor.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                  No labor forecasts generated.
                </p>
              ) : (
                <div className="space-y-3">
                  {data.deptLabor.map(l => (
                    <div key={l.department} className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                      <div className="flex items-center justify-between">
                        <p className="font-medium text-gray-900 dark:text-white">{l.department}</p>
                        <span className={`text-xs font-medium ${l.variancePct > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                          {l.variancePct >= 0 ? '+' : ''}{l.variancePct}% vs budget
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Projected {formatAmount(l.projected)} · Budget {formatAmount(l.budget)}
                        {l.confidence > 0 ? ` · ${Math.round(l.confidence * (l.confidence <= 1 ? 100 : 1))}% conf` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Procurement Forecast + Heat Map */}
            <div className="space-y-6">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  Procurement Demand by Department
                </h3>
                {data.procForecast.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                    No procurement demand forecasts.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {data.procForecast.map(p => (
                      <div key={p.department} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                        <p className="font-medium text-gray-900 dark:text-white truncate">{p.department}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400 ml-3">
                          {p.qty.toLocaleString()} units · {p.items} lines
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {heatTypes.length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                    Demand Heat Map by Room Type
                  </h3>
                  <div className="space-y-4">
                    {heatTypes.map(t => (
                      <div key={t}>
                        <p className="text-sm font-medium text-gray-900 dark:text-white mb-2">{t}</p>
                        <div className="grid grid-cols-12 gap-1">
                          {MONTHS.map((m, i) => {
                            const v = data.heatMapByType[t][i + 1] || 0;
                            const pct = v / maxIntensity;
                            return (
                              <div key={m} className="text-center" title={`${m}: ${v}`}>
                                <div
                                  className="h-6 rounded"
                                  style={{
                                    backgroundColor: pct > 0.66 ? '#e11d48' : pct > 0.33 ? '#f59e0b' : v > 0 ? '#10b981' : '#374151',
                                    opacity: v > 0 ? 0.4 + pct * 0.6 : 0.15,
                                  }}
                                />
                                <p className="text-[9px] text-gray-500 dark:text-gray-400 mt-0.5">{m}</p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {!loading && !error && data.metrics.length === 0 && (
        <div className="text-center py-16 text-gray-500 dark:text-gray-400">
          <Database className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p className="font-medium">No forecast data available.</p>
          <p className="text-sm mt-1">Forecasts appear once demand, labor, and treasury forecasts are generated.</p>
        </div>
      )}
    </div>
  );
};

export default Forecasting;
