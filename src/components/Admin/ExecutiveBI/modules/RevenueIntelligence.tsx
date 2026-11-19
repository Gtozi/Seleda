/**
 * Revenue Intelligence Module
 *
 * Live data from GET /api/executive/revenue-intelligence:
 * - Occupancy / ADR / RevPAR / TRevPAR / GOPPAR from reservations + rooms
 *   (TRevPAR adds F&B orders and banquet events; GOPPAR subtracts GL expenses)
 * - Booking pace, pickup, lead time, cancellations from reservation activity
 * - Channel mix from channel_performance (falls back to reservation channel)
 * - Demand forecasts from demand_forecasts (RMS)
 * - Market-segment mix from guest_market_segments + market_segments
 */

import { useEffect, useMemo, useState } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Bed,
  DollarSign,
  BarChart3,
  Calendar,
  PieChart,
  LineChart,
  Download,
  RefreshCw,
  AlertTriangle,
  Database,
  Minus,
  Users,
} from 'lucide-react';
import { useERP } from '../../../../context/ERPContext';
import {
  fetchRevenueIntelligence,
  RevMetric,
  RevCategory,
} from '../../../../services/executiveService';

const REVENUE_CATEGORIES: { id: RevCategory | 'all'; label: string; icon: any }[] = [
  { id: 'all', label: 'All Metrics', icon: BarChart3 },
  { id: 'occupancy', label: 'Occupancy', icon: Bed },
  { id: 'adr', label: 'ADR', icon: DollarSign },
  { id: 'revpar', label: 'RevPAR', icon: BarChart3 },
  { id: 'booking', label: 'Booking Pace', icon: Calendar },
  { id: 'forecast', label: 'Forecast', icon: LineChart },
  { id: 'channel', label: 'Channel Mix', icon: PieChart },
];

const CHANNEL_COLORS = [
  'bg-indigo-500', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500',
  'bg-rose-500', 'bg-purple-500', 'bg-teal-500', 'bg-cyan-500',
];

const RevenueIntelligence = () => {
  const { currentPropertyId, formatAmount } = useERP();
  const [data, setData] = useState<{
    metrics: RevMetric[];
    channelMix: { name: string; sharePct: number; revenue: number; bookings: number }[];
    demandForecast: { horizon: string; forecastOccupancy: number; confidence: number; forecastDemand: number }[];
    segmentMix: { name: string; guests: number; sharePct: number }[];
  }>({ metrics: [], channelMix: [], demandForecast: [], segmentMix: [] });
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [selectedCategory, setSelectedCategory] = useState<RevCategory | 'all'>('all');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchRevenueIntelligence(currentPropertyId, days);
      setData({
        metrics: res.metrics,
        channelMix: res.channelMix,
        demandForecast: res.demandForecast,
        segmentMix: res.segmentMix,
      });
      setGeneratedAt(res.generatedAt);
    } catch (e: any) {
      setError(e?.message || 'Failed to load revenue intelligence');
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
      case 'count':
        return Math.round(value).toLocaleString();
      case '/day':
        return `${value.toFixed(2)}/day`;
      default:
        return `${value.toLocaleString()} ${unit}`.trim();
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
    a.download = `revenue-intelligence-${days}d.csv`;
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

  const trendColor = (trend: number | null, lowerIsBetter: boolean) => {
    if (trend === null) return 'text-gray-500 dark:text-gray-400';
    const good = lowerIsBetter ? trend <= 0 : trend >= 0;
    return good ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Revenue Intelligence
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Occupancy, ADR, RevPAR, and yield management analytics
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
          <span className="ml-3 text-gray-500 dark:text-gray-400">Loading revenue metrics…</span>
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
          {/* Revenue Categories */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
            {REVENUE_CATEGORIES.map(cat => {
              const Icon = cat.icon;
              const empty = cat.id !== 'all' && !categoriesWithData.has(cat.id as RevCategory);
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

          {/* Revenue Metrics Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredMetrics.map(metric => (
              <div
                key={metric.id}
                className="bg-white dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900 dark:text-white">
                      {metric.name}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 capitalize">
                      {metric.category === 'adr' ? 'ADR' : metric.category === 'revpar' ? 'RevPAR' : metric.category}
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
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Current
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {metric.target !== 0 ? formatValue(metric.target, metric.unit) : '—'}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Target
                      </p>
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
                        {metric.trend >= 0 ? (
                          <TrendingUp className="w-3 h-3" />
                        ) : (
                          <TrendingDown className="w-3 h-3" />
                        )}
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

          {/* Channel Mix Breakdown */}
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Channel Mix Breakdown
            </h3>
            {data.channelMix.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                No channel bookings recorded for this period.
              </p>
            ) : (
              <div className="space-y-4">
                {data.channelMix.map((channel, i) => (
                  <div key={channel.name} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full ${CHANNEL_COLORS[i % CHANNEL_COLORS.length]}`} />
                        <span className="font-medium text-gray-900 dark:text-white">{channel.name}</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {channel.bookings} bookings
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-gray-900 dark:text-white">{channel.sharePct}%</span>
                        <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">
                          {formatAmount(channel.revenue)}
                        </span>
                      </div>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${CHANNEL_COLORS[i % CHANNEL_COLORS.length]}`}
                        style={{ width: `${channel.sharePct}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Demand Forecast */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Demand Forecast
              </h3>
              {data.demandForecast.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                  No RMS demand forecasts available — forecasts appear here once generated.
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-4">
                  {data.demandForecast.map(f => (
                    <div key={f.horizon} className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg text-center">
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">{f.horizon}</p>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
                        {f.forecastOccupancy}%
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                        Demand: {f.forecastDemand}
                      </p>
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                        {f.confidence}% confidence
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Market Segment Mix */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-600" />
                Market Segment Mix
              </h3>
              {data.segmentMix.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                  No guest segments assigned yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {data.segmentMix.map((seg, i) => (
                    <div key={seg.name} className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${CHANNEL_COLORS[i % CHANNEL_COLORS.length]}`} />
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-gray-900 dark:text-white">{seg.name}</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {seg.guests} guests · {seg.sharePct}%
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${CHANNEL_COLORS[i % CHANNEL_COLORS.length]}`}
                            style={{ width: `${seg.sharePct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default RevenueIntelligence;
