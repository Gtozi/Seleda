/**
 * Inventory Intelligence Module
 *
 * Live data from GET /api/executive/inventory-intelligence:
 * - Stock value/damaged/expired from uinv_stock_balances × unit_cost
 * - Turnover/COGS from uinv_stock_ledger movements
 * - Fast/slow/dead classification from uinv_consumption_stats velocity
 * - Variance/accuracy from uinv_counts, expiry risk from uinv_batches
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Package,
  TrendingUp,
  TrendingDown,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  Download,
  RefreshCw,
  Activity,
  BarChart3,
  Database,
  Minus,
  Warehouse,
  Timer,
} from 'lucide-react';
import { useERP } from '../../../../context/ERPContext';
import {
  fetchInventoryIntelligence,
  InvMetric,
  InvCategory,
} from '../../../../services/executiveService';

const INV_CATEGORIES: { id: InvCategory | 'all'; label: string; icon: any }[] = [
  { id: 'all', label: 'All Analytics', icon: Package },
  { id: 'value', label: 'Stock Value', icon: DollarSign },
  { id: 'turnover', label: 'Turnover', icon: RefreshCw },
  { id: 'deadstock', label: 'Dead Stock', icon: AlertTriangle },
  { id: 'slowmoving', label: 'Slow Moving', icon: Activity },
  { id: 'fastmoving', label: 'Fast Moving', icon: BarChart3 },
  { id: 'variance', label: 'Variance', icon: TrendingDown },
  { id: 'accuracy', label: 'Accuracy', icon: CheckCircle2 },
];

const MOVEMENT_COLORS: Record<string, string> = {
  'Fast Moving': 'bg-emerald-500',
  'Slow Moving': 'bg-amber-500',
  'Dead Stock': 'bg-rose-500',
};

const InventoryIntelligence = () => {
  const { currentPropertyId, formatAmount } = useERP();
  const [data, setData] = useState<{
    metrics: InvMetric[];
    stockByStore: { store: string; value: number; sharePct: number }[];
    stockByCategory: { category: string; value: number; sharePct: number }[];
    topMovers: { name: string; category: string; consumed: number; dailyRate: number; stockValue: number }[];
    expiringBatches: { item: string; batch: string; expiryDate: string; quantity: number; value: number }[];
    movementSplit: { type: string; value: number; items: number }[];
  }>({ metrics: [], stockByStore: [], stockByCategory: [], topMovers: [], expiringBatches: [], movementSplit: [] });
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [selectedCategory, setSelectedCategory] = useState<InvCategory | 'all'>('all');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchInventoryIntelligence(currentPropertyId, days);
      setData({
        metrics: res.metrics,
        stockByStore: res.stockByStore,
        stockByCategory: res.stockByCategory,
        topMovers: res.topMovers,
        expiringBatches: res.expiringBatches,
        movementSplit: res.movementSplit,
      });
      setGeneratedAt(res.generatedAt);
    } catch (e: any) {
      setError(e?.message || 'Failed to load inventory intelligence');
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
      case 'days': return `${value.toFixed(1)} days`;
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
    a.download = `inventory-intelligence-${days}d.csv`;
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

  const totalMovementVal = Math.max(1, data.movementSplit.reduce((s, m) => s + m.value, 0));

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
            Inventory Intelligence
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Stock value, turnover, and inventory accuracy analytics
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
          <span className="ml-3 text-gray-500 dark:text-gray-400">Loading inventory metrics…</span>
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
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            {INV_CATEGORIES.map(cat => {
              const Icon = cat.icon;
              const empty = cat.id !== 'all' && !categoriesWithData.has(cat.id as InvCategory);
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`p-3 rounded-lg border transition-all ${
                    selectedCategory === cat.id
                      ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500 dark:border-indigo-400'
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-600'
                  } ${empty ? 'opacity-50' : ''}`}
                >
                  <Icon className="w-5 h-5 mx-auto mb-1.5 text-indigo-600" />
                  <p className="text-xs font-medium text-gray-900 dark:text-white text-center">{cat.label}</p>
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
                      {metric.category.replace('moving', ' moving')}
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
            {/* Movement Analysis */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Inventory Movement Analysis
              </h3>
              <div className="grid grid-cols-3 gap-4">
                {data.movementSplit.map(item => (
                  <div key={item.type} className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg text-center">
                    <div className={`w-3 h-3 rounded-full ${MOVEMENT_COLORS[item.type] || 'bg-gray-500'} mx-auto mb-2`} />
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{item.type}</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                      {formatAmount(item.value)}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {Math.round((item.value / totalMovementVal) * 100)}% · {item.items} items
                    </p>
                  </div>
                ))}
              </div>
              {data.movementSplit.every(m => m.value === 0) && (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center pt-4">
                  No stock on hand yet.
                </p>
              )}
            </div>

            {/* Stock by Store */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <Warehouse className="w-5 h-5 text-indigo-600" />
                Stock by Store
              </h3>
              {data.stockByStore.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                  No stock balances recorded.
                </p>
              ) : (
                <div className="space-y-3">
                  {data.stockByStore.map(s => (
                    <div key={s.store} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-900 dark:text-white">{s.store}</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {formatAmount(s.value)} · {s.sharePct}%
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                        <div className="h-2 rounded-full bg-indigo-500" style={{ width: `${s.sharePct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Stock by Category */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Stock by Category
              </h3>
              {data.stockByCategory.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                  No stock balances recorded.
                </p>
              ) : (
                <div className="space-y-3">
                  {data.stockByCategory.map(c => (
                    <div key={c.category} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                      <p className="font-medium text-gray-900 dark:text-white">{c.category}</p>
                      <div className="text-right">
                        <p className="font-bold text-gray-900 dark:text-white">{formatAmount(c.value)}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{c.sharePct}% of stock</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Top Movers */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <Activity className="w-5 h-5 text-emerald-600" />
                Top Moving Items
              </h3>
              {data.topMovers.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                  No consumption stats recorded yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {data.topMovers.map(item => (
                    <div key={item.name} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 dark:text-white truncate">{item.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {item.category} · {item.dailyRate}/day avg
                        </p>
                      </div>
                      <div className="text-right ml-3">
                        <p className="font-bold text-gray-900 dark:text-white">{item.consumed.toLocaleString()}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">consumed</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Expiring Batches */}
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <Timer className="w-5 h-5 text-amber-500" />
              Batches Expiring Within 30 Days
            </h3>
            {data.expiringBatches.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                No batches expiring soon.
              </p>
            ) : (
              <div className="space-y-3">
                {data.expiringBatches.map(b => (
                  <div key={`${b.item}-${b.batch}`} className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                    <div className="flex-1">
                      <p className="font-medium text-gray-900 dark:text-white">{b.item}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Batch {b.batch} · {b.quantity.toLocaleString()} units · Expires {new Date(b.expiryDate).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-gray-900 dark:text-white">{formatAmount(b.value)}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">at risk</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default InventoryIntelligence;
