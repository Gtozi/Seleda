/**
 * Food & Beverage Intelligence Module
 *
 * Live data from GET /api/executive/fb-intelligence:
 * - Revenue/covers/avg check from orders + outlets (incl. minibar)
 * - Outlet performance from orders enriched with fb_outlet_analytics
 * - Menu engineering quadrants from fb_menu_engineering (Star/Plow Horse/Puzzle/Dog)
 * - Cost/waste from fb_cost_analytics
 * - Kitchen efficiency from fb_kitchen_analytics
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Utensils,
  TrendingUp,
  TrendingDown,
  DollarSign,
  BarChart3,
  PieChart,
  Activity,
  Download,
  RefreshCw,
  AlertTriangle,
  Trash2,
  Star,
  Database,
  Minus,
} from 'lucide-react';
import { useERP } from '../../../../context/ERPContext';
import {
  fetchFbIntelligence,
  FbMetric,
  FbCategory,
  FbOutletPerformance,
  FbMenuEngineering,
  FbTopMenuItem,
} from '../../../../services/executiveService';

const FB_CATEGORIES: { id: FbCategory | 'all'; label: string; icon: any }[] = [
  { id: 'all', label: 'All Analytics', icon: BarChart3 },
  { id: 'revenue', label: 'Revenue', icon: DollarSign },
  { id: 'outlet', label: 'Outlets', icon: BarChart3 },
  { id: 'menu', label: 'Menu', icon: Utensils },
  { id: 'cost', label: 'Cost', icon: PieChart },
  { id: 'waste', label: 'Waste', icon: Trash2 },
  { id: 'efficiency', label: 'Efficiency', icon: Activity },
];

const CLASS_STYLES: Record<string, { color: string; label: string }> = {
  'Star': { color: 'bg-emerald-500', label: 'Stars' },
  'Plow Horse': { color: 'bg-blue-500', label: 'Plow Horses' },
  'Puzzle': { color: 'bg-amber-500', label: 'Puzzles' },
  'Dog': { color: 'bg-rose-500', label: 'Dogs' },
};

const OUTLET_TYPE_COLORS: Record<string, string> = {
  Restaurant: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
  Bar: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  RoomService: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  Banquet: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  Minibar: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400',
};

const FoodBeverageIntelligence = () => {
  const { currentPropertyId, formatAmount } = useERP();
  const [data, setData] = useState<{
    metrics: FbMetric[];
    outletPerformance: FbOutletPerformance[];
    menuEngineering: FbMenuEngineering[];
    topMenuItems: FbTopMenuItem[];
    mealPeriodMix: { period: string; orders: number; revenue: number }[];
  }>({ metrics: [], outletPerformance: [], menuEngineering: [], topMenuItems: [], mealPeriodMix: [] });
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [selectedCategory, setSelectedCategory] = useState<FbCategory | 'all'>('all');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchFbIntelligence(currentPropertyId, days);
      setData({
        metrics: res.metrics,
        outletPerformance: res.outletPerformance,
        menuEngineering: res.menuEngineering,
        topMenuItems: res.topMenuItems,
        mealPeriodMix: res.mealPeriodMix,
      });
      setGeneratedAt(res.generatedAt);
    } catch (e: any) {
      setError(e?.message || 'Failed to load F&B intelligence');
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
      case 'x': return `${value.toFixed(2)}x`;
      case 'min': return `${value.toFixed(1)} min`;
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
    a.download = `fb-intelligence-${days}d.csv`;
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

  const totalMenuMargin = Math.max(1, data.menuEngineering.reduce((s, c) => s + c.margin, 0));
  const totalMealOrders = Math.max(1, data.mealPeriodMix.reduce((s, m) => s + m.orders, 0));

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Food &amp; Beverage Intelligence
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Restaurant performance, menu engineering, and cost analysis
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
          <span className="ml-3 text-gray-500 dark:text-gray-400">Loading F&amp;B metrics…</span>
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
          {/* F&B Categories */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
            {FB_CATEGORIES.map(cat => {
              const Icon = cat.icon;
              const empty = cat.id !== 'all' && !categoriesWithData.has(cat.id as FbCategory);
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

          {/* F&B Metrics Grid */}
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
            {/* Outlet Performance */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Outlet Performance
              </h3>
              {data.outletPerformance.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                  No outlet activity in this period.
                </p>
              ) : (
                <div className="space-y-4">
                  {data.outletPerformance.map(outlet => (
                    <div key={outlet.name} className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-gray-900 dark:text-white">{outlet.name}</p>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${OUTLET_TYPE_COLORS[outlet.type] || 'bg-gray-100 text-gray-800 dark:bg-gray-600 dark:text-gray-300'}`}>
                            {outlet.type === 'RoomService' ? 'Room Service' : outlet.type}
                          </span>
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {outlet.orders} orders{outlet.covers > 0 ? ` · ${outlet.covers.toLocaleString()} covers` : ''} · Avg check: {formatAmount(outlet.avgCheck)}
                          {outlet.turnover > 0 ? ` · ${outlet.turnover}x turnover` : ''}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-gray-900 dark:text-white">
                          {formatAmount(outlet.revenue)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Meal Period Mix */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <PieChart className="w-5 h-5 text-indigo-600" />
                Meal Period Mix
              </h3>
              {data.mealPeriodMix.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                  No meal-period-tagged orders in this period.
                </p>
              ) : (
                <div className="space-y-3">
                  {data.mealPeriodMix.map(m => (
                    <div key={m.period} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-900 dark:text-white">{m.period}</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {m.orders} orders · {formatAmount(m.revenue)} · {Math.round((m.orders / totalMealOrders) * 100)}%
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                        <div
                          className="h-2 rounded-full bg-indigo-500"
                          style={{ width: `${(m.orders / totalMealOrders) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Menu Engineering */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Menu Engineering Analysis
              </h3>
              {data.menuEngineering.every(c => c.count === 0) ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                  No menu engineering data yet — classifications are generated from sales mix.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  {data.menuEngineering.map(c => {
                    const style = CLASS_STYLES[c.classification] || { color: 'bg-gray-500', label: c.classification };
                    return (
                      <div key={c.classification} className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg text-center">
                        <div className={`w-3 h-3 rounded-full ${style.color} mx-auto mb-2`} />
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{style.label}</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{c.count}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {c.sold.toLocaleString()} sold · {Math.round((c.margin / totalMenuMargin) * 100)}% of margin
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Top Menu Items */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <Star className="w-5 h-5 text-amber-500" />
                Top Menu Items by Margin
              </h3>
              {data.topMenuItems.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                  No menu item performance data yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {data.topMenuItems.slice(0, 6).map((item, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 dark:text-white truncate">{item.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {item.category} · {item.sold} sold · {item.foodCostPct}% food cost
                        </p>
                      </div>
                      <div className="text-right ml-3">
                        <p className="font-bold text-gray-900 dark:text-white">{formatAmount(item.margin)}</p>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          item.classification === 'Star' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : item.classification === 'Dog' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                          : 'bg-gray-100 text-gray-700 dark:bg-gray-600 dark:text-gray-300'
                        }`}>
                          {item.classification}
                        </span>
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

export default FoodBeverageIntelligence;
