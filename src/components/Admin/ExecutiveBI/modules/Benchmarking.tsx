/**
 * Benchmarking Module
 *
 * Live data from GET /api/executive/benchmarking:
 * - KPI values computed live (occupancy/ADR/RevPAR/costs/satisfaction/productivity)
 * - Baselines per metric: previous period, previous year (rms_bi_yoy_metrics),
 *   forecast (demand_forecasts), competitor set (competitor_rates),
 *   industry (fb_benchmarking_data quartiles)
 * - Panels: competitive set positioning, industry benchmarks, outlet benchmarks,
 *   YoY metrics, market trends, forecast accuracy
 */

import { useEffect, useMemo, useState } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Calendar,
  Building2,
  Globe,
  Download,
  RefreshCw,
  AlertTriangle,
  Minus,
  Database,
} from 'lucide-react';
import { useERP } from '../../../../context/ERPContext';
import {
  fetchBenchmarking,
  BenchMetric,
  BenchBasis,
} from '../../../../services/executiveService';

const COMPARISONS: { id: BenchBasis; label: string; icon: any }[] = [
  { id: 'prev_period', label: 'Previous Period', icon: Calendar },
  { id: 'prev_year', label: 'Previous Year', icon: Calendar },
  { id: 'forecast', label: 'Forecast', icon: TrendingUp },
  { id: 'competitor', label: 'Comp Set', icon: Building2 },
  { id: 'industry', label: 'Industry', icon: Globe },
];

const TREND_COLORS: Record<string, string> = {
  above_average: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  average: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  below_average: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400',
};

const IMPACT_COLORS: Record<string, string> = {
  positive: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  negative: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400',
};

const Benchmarking = () => {
  const { currentPropertyId, formatAmount } = useERP();
  const [data, setData] = useState<{
    metrics: BenchMetric[];
    compSet: { ourAdr: number; avgCompRate: number; position: number; total: number; members: { name: string; starRating: number | null; proximityKm: number | null; type: string; latestRate: number | null; rateDate: string | null; available: boolean | null }[] };
    industryBenchmarks: { metric: string; category: string; region: string | null; year: number | null; industryAvg: number; topQuartile: number; bottomQuartile: number; ourValue: number | null }[];
    outletBenchmarks: { outlet: string; metric: string; actual: number; benchmark: number; variancePct: number; percentile: number | null; trend: string | null }[];
    yoyMetrics: { metric: string; current: number; previous: number; growth: number }[];
    marketTrends: { trend: string; impact: string; confidence: number }[];
    forecastAccuracy: { period: string; accuracy: number; variance: number }[];
  }>({
    metrics: [],
    compSet: { ourAdr: 0, avgCompRate: 0, position: 0, total: 0, members: [] },
    industryBenchmarks: [], outletBenchmarks: [], yoyMetrics: [], marketTrends: [], forecastAccuracy: [],
  });
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [basis, setBasis] = useState<BenchBasis>('prev_period');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchBenchmarking(currentPropertyId, days);
      setData({
        metrics: res.metrics,
        compSet: res.compSet,
        industryBenchmarks: res.industryBenchmarks,
        outletBenchmarks: res.outletBenchmarks,
        yoyMetrics: res.yoyMetrics,
        marketTrends: res.marketTrends,
        forecastAccuracy: res.forecastAccuracy,
      });
      setGeneratedAt(res.generatedAt);
    } catch (e: any) {
      setError(e?.message || 'Failed to load benchmarking');
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
      case '%': return `${value.toFixed(1)}%`;
      case '/5': return `${value.toFixed(2)}/5`;
      case 'ratio': return value.toFixed(2);
      case 'score': return Math.round(value).toString();
      case 'count': return Math.round(value).toLocaleString();
      default: return `${value.toLocaleString()} ${unit}`.trim();
    }
  };

  // Baselines that have at least one real comparison value
  const availableBases = useMemo(
    () => new Set(data.metrics.flatMap(m => Object.keys(m.comparisons))),
    [data.metrics],
  );

  // Fall back to first available basis if the selected one has no data
  const activeBasis: BenchBasis = availableBases.has(basis)
    ? basis
    : (availableBases.has('prev_period') ? 'prev_period' : (Array.from(availableBases)[0] as BenchBasis) || 'prev_period');

  const basisLabel = COMPARISONS.find(c => c.id === activeBasis)?.label || 'Baseline';

  const variance = (m: BenchMetric): number | null => {
    const cmp = m.comparisons[activeBasis];
    if (cmp === undefined || cmp === null || cmp === 0) return null;
    return ((m.value - cmp) / Math.abs(cmp)) * 100;
  };

  const exportCsv = () => {
    const header = 'Metric,Category,Current,Baseline,Baseline Type,Variance %,Unit';
    const rows = data.metrics.map(m => {
      const cmp = m.comparisons[activeBasis];
      const v = variance(m);
      return [m.name, m.category, m.value, cmp ?? '', basisLabel, v === null ? '' : v.toFixed(1), m.unit]
        .map(x => `"${String(x).replace(/"/g, '""')}"`).join(',');
    });
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `benchmarking-${activeBasis}-${days}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const summary = useMemo(() => {
    let out = 0, onT = 0, under = 0;
    data.metrics.forEach(m => {
      const v = variance(m);
      if (v === null) return;
      const good = m.lowerIsBetter ? v <= 0 : v >= 0;
      const mag = Math.abs(v);
      if (good && mag <= 5) onT++;
      else if (good) out++;
      else under++;
    });
    return { out, onT, under };
  }, [data.metrics, activeBasis]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Benchmarking
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Performance comparison against {basisLabel}
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
          <span className="ml-3 text-gray-500 dark:text-gray-400">Loading benchmarks…</span>
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
          {/* Comparison Baselines */}
          <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
            {COMPARISONS.map(comp => {
              const Icon = comp.icon;
              const hasData = availableBases.has(comp.id);
              return (
                <button
                  key={comp.id}
                  onClick={() => hasData && setBasis(comp.id)}
                  disabled={!hasData}
                  className={`p-3 rounded-lg border transition-all ${
                    activeBasis === comp.id
                      ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500 dark:border-indigo-400'
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-600'
                  } ${!hasData ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  <Icon className="w-5 h-5 mx-auto mb-1 text-indigo-600" />
                  <p className="text-xs font-medium text-gray-900 dark:text-white text-center">{comp.label}</p>
                  {!hasData && <p className="text-[10px] text-gray-400 text-center mt-0.5">no data</p>}
                </button>
              );
            })}
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.metrics.map(metric => {
              const cmp = metric.comparisons[activeBasis];
              const v = variance(metric);
              const good = v === null ? null : (metric.lowerIsBetter ? v <= 0 : v >= 0);
              return (
                <div
                  key={metric.id}
                  className="bg-white dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900 dark:text-white">{metric.name}</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 capitalize">{metric.category}</p>
                    </div>
                    {v !== null && (
                      <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                        good ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'
                             : 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400'
                      }`}>
                        {v >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                        <span>{v >= 0 ? '+' : ''}{v.toFixed(1)}%</span>
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
                          {cmp !== undefined && cmp !== null ? formatValue(cmp, metric.unit) : '—'}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{basisLabel}</p>
                      </div>
                    </div>

                    {cmp !== undefined && cmp !== null && cmp !== 0 && (
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all ${good ? 'bg-emerald-500' : 'bg-rose-500'}`}
                          style={{ width: `${Math.min(Math.abs(metric.value / cmp) * 100, 100)}%` }}
                        />
                      </div>
                    )}

                    {v === null && (
                      <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                        <Minus className="w-3 h-3" />
                        <span>No {basisLabel.toLowerCase()} baseline</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Performance Summary */}
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Performance Summary vs {basisLabel}
            </h3>
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: 'Outperforming', count: summary.out, color: 'bg-emerald-500' },
                { label: 'On Target', count: summary.onT, color: 'bg-blue-500' },
                { label: 'Underperforming', count: summary.under, color: 'bg-rose-500' },
              ].map(s => (
                <div key={s.label} className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg text-center">
                  <div className={`w-3 h-3 rounded-full ${s.color} mx-auto mb-2`} />
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{s.label}</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{s.count}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">metrics</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Competitive Set */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Competitive Set Positioning
              </h3>
              {data.compSet.members.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                  No competitors configured. Add competitors and rate shops to enable comp-set benchmarking.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg text-center">
                      <p className="text-xs text-gray-500 dark:text-gray-400">Our ADR</p>
                      <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{formatAmount(data.compSet.ourAdr)}</p>
                    </div>
                    <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg text-center">
                      <p className="text-xs text-gray-500 dark:text-gray-400">Comp Set Avg</p>
                      <p className="text-lg font-bold text-gray-900 dark:text-white">{formatAmount(data.compSet.avgCompRate)}</p>
                    </div>
                    <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg text-center">
                      <p className="text-xs text-gray-500 dark:text-gray-400">Position</p>
                      <p className="text-lg font-bold text-gray-900 dark:text-white">
                        {data.compSet.position > 0 ? `#${data.compSet.position} / ${data.compSet.total}` : '—'}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {data.compSet.members.map(m => (
                      <div key={m.name} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 dark:text-white truncate">{m.name}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {m.starRating ? `${m.starRating}★` : ''}
                            {m.proximityKm !== null ? ` · ${m.proximityKm}km` : ''}
                            {m.rateDate ? ` · rate ${m.rateDate}` : ''}
                          </p>
                        </div>
                        <span className="text-sm font-bold text-gray-900 dark:text-white ml-3">
                          {m.latestRate !== null ? formatAmount(m.latestRate) : 'no rate'}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Industry Benchmarks */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Industry Benchmarks
              </h3>
              {data.industryBenchmarks.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                  No industry benchmark data loaded.
                </p>
              ) : (
                <div className="space-y-3">
                  {data.industryBenchmarks.slice(0, 8).map(b => {
                    const beat = b.ourValue !== null ? b.ourValue <= b.topQuartile && b.ourValue >= b.bottomQuartile : null;
                    return (
                      <div key={b.metric} className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                        <div className="flex items-center justify-between">
                          <p className="font-medium text-gray-900 dark:text-white truncate">{b.metric}</p>
                          {b.ourValue !== null && (
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              beat ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
                                   : 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400'
                            }`}>
                              {beat ? 'within range' : 'outside range'}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {b.ourValue !== null ? `Ours: ${b.ourValue} · ` : ''}
                          Industry avg {b.industryAvg} · Top quartile {b.topQuartile} · Bottom {b.bottomQuartile}
                          {b.region ? ` · ${b.region}` : ''}{b.year ? ` · ${b.year}` : ''}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Outlet Benchmarks */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                F&B Outlet Benchmarks
              </h3>
              {data.outletBenchmarks.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                  No outlet benchmarks recorded.
                </p>
              ) : (
                <div className="space-y-3">
                  {data.outletBenchmarks.map((b, i) => (
                    <div key={`${b.outlet}-${b.metric}-${i}`} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 dark:text-white truncate">{b.outlet}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {b.metric}: {b.actual} vs {b.benchmark} ({b.variancePct >= 0 ? '+' : ''}{b.variancePct}%)
                          {b.percentile !== null ? ` · ${Math.round(b.percentile * 100)}th pctl` : ''}
                        </p>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ml-3 ${TREND_COLORS[b.trend || 'average'] || TREND_COLORS.average}`}>
                        {(b.trend || 'average').replace('_', ' ')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* YoY + Trends + Forecast Accuracy */}
            <div className="space-y-6">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  Year-over-Year
                </h3>
                {data.yoyMetrics.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                    No YoY metrics recorded.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {data.yoyMetrics.map(y => (
                      <div key={y.metric} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 dark:text-white truncate">{y.metric}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {y.current.toLocaleString()} vs {y.previous.toLocaleString()}
                          </p>
                        </div>
                        <span className={`text-sm font-bold ml-3 ${y.growth >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {y.growth >= 0 ? '+' : ''}{y.growth}%
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {(data.marketTrends.length > 0 || data.forecastAccuracy.length > 0) && (
                <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                    Market Trends & Forecast Accuracy
                  </h3>
                  {data.forecastAccuracy.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-4">
                      {data.forecastAccuracy.map(f => (
                        <span key={f.period} className="px-3 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300 rounded-full text-xs font-medium">
                          {f.period}: {f.accuracy}% acc{f.variance ? ` (${f.variance > 0 ? '+' : ''}${f.variance}% var)` : ''}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="space-y-2">
                    {data.marketTrends.map(t => (
                      <div key={t.trend} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                        <p className="text-sm font-medium text-gray-900 dark:text-white flex-1 min-w-0 truncate">{t.trend}</p>
                        <div className="flex items-center gap-2 ml-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${IMPACT_COLORS[t.impact] || IMPACT_COLORS.positive}`}>
                            {t.impact}
                          </span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">{t.confidence}% conf</span>
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
          <p className="font-medium">No benchmarking data available for the selected period.</p>
          <p className="text-sm mt-1">Reservation, competitor, and industry data will appear here once recorded.</p>
        </div>
      )}
    </div>
  );
};

export default Benchmarking;
