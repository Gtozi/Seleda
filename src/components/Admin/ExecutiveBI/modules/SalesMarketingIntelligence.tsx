/**
 * Sales & Marketing Intelligence Module
 *
 * Live data from GET /api/executive/sales-marketing-intelligence:
 * - Pipeline funnel from sales_leads (stage, opportunity_value)
 * - Conversion from lead stages + sales_proposals + sales_activities
 * - Corporate production from corporate_accounts, sales_contracts,
 *   and Corporate-channel reservations
 * - OTA performance from channel_performance + channel_connections
 *   (falls back to OTA-channel reservations)
 * - Campaign ROI from sales_campaigns (budget/spent/leads/conversions)
 * - Segment mix from guest_market_segments + market_segments
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Target,
  TrendingUp,
  TrendingDown,
  Funnel,
  Users,
  BarChart3,
  PieChart,
  Download,
  RefreshCw,
  AlertTriangle,
  Building2,
  Globe,
  Database,
  Minus,
} from 'lucide-react';
import { useERP } from '../../../../context/ERPContext';
import {
  fetchSalesIntelligence,
  SalesMetric,
  SalesCategory,
} from '../../../../services/executiveService';

const SALES_CATEGORIES: { id: SalesCategory | 'all'; label: string; icon: any }[] = [
  { id: 'all', label: 'All Analytics', icon: BarChart3 },
  { id: 'pipeline', label: 'Pipeline', icon: Funnel },
  { id: 'conversion', label: 'Conversion', icon: Target },
  { id: 'corporate', label: 'Corporate', icon: Building2 },
  { id: 'ota', label: 'OTA Performance', icon: Globe },
  { id: 'campaign', label: 'Campaign ROI', icon: BarChart3 },
  { id: 'segments', label: 'Segments', icon: PieChart },
  { id: 'acquisition', label: 'Acquisition', icon: Users },
];

const FUNNEL_COLORS = ['bg-indigo-500', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-green-500'];
const SEGMENT_COLORS = ['bg-indigo-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-blue-500', 'bg-purple-500'];

const SalesMarketingIntelligence = () => {
  const { currentPropertyId, formatAmount } = useERP();
  const [data, setData] = useState<{
    metrics: SalesMetric[];
    pipelineFunnel: { stage: string; count: number; value: number; sharePct: number }[];
    campaigns: { name: string; type: string; status: string; budget: number; spent: number; leads: number; conversions: number }[];
    segmentMix: { name: string; guests: number; sharePct: number }[];
  }>({ metrics: [], pipelineFunnel: [], campaigns: [], segmentMix: [] });
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [selectedCategory, setSelectedCategory] = useState<SalesCategory | 'all'>('all');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchSalesIntelligence(currentPropertyId, days);
      setData({
        metrics: res.metrics,
        pipelineFunnel: res.pipelineFunnel,
        campaigns: res.campaigns,
        segmentMix: res.segmentMix,
      });
      setGeneratedAt(res.generatedAt);
    } catch (e: any) {
      setError(e?.message || 'Failed to load sales intelligence');
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
      case 'x':
        return `${value.toFixed(2)}x`;
      case 'count':
        return Math.round(value).toLocaleString();
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
    a.download = `sales-marketing-intelligence-${days}d.csv`;
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

  const maxFunnelCount = Math.max(1, ...data.pipelineFunnel.map(s => s.count));

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

  const campaignStatusColor = (status: string) => {
    const s = status.toLowerCase();
    if (s === 'active' || s === 'running') return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
    if (s === 'completed') return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400';
    return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Sales &amp; Marketing Intelligence
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Pipeline, conversion, campaign ROI, and market segment analytics
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
          <span className="ml-3 text-gray-500 dark:text-gray-400">Loading sales metrics…</span>
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
          {/* Sales Categories */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
            {SALES_CATEGORIES.map(cat => {
              const Icon = cat.icon;
              const empty = cat.id !== 'all' && !categoriesWithData.has(cat.id as SalesCategory);
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

          {/* Sales Metrics Grid */}
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
                      {metric.category === 'ota' ? 'OTA' : metric.category}
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

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Pipeline Funnel */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Sales Pipeline Funnel
              </h3>
              {data.pipelineFunnel.every(s => s.count === 0) ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                  No leads in the pipeline yet.
                </p>
              ) : (
                <div className="space-y-4">
                  {data.pipelineFunnel.map((stage, index) => (
                    <div key={stage.stage} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-900 dark:text-white">{stage.stage}</span>
                        <div className="flex items-center gap-4">
                          <span className="text-sm text-gray-500 dark:text-gray-400">
                            {stage.count} leads · {formatAmount(stage.value)}
                          </span>
                          <span className="text-sm font-medium text-gray-900 dark:text-white">{stage.sharePct}%</span>
                        </div>
                      </div>
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                        <div
                          className={`h-3 rounded-full ${FUNNEL_COLORS[index % FUNNEL_COLORS.length]}`}
                          style={{ width: `${(stage.count / maxFunnelCount) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Market Segments */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <PieChart className="w-5 h-5 text-indigo-600" />
                Market Segments
              </h3>
              {data.segmentMix.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                  No guest segments assigned yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {data.segmentMix.map((seg, i) => (
                    <div key={seg.name} className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${SEGMENT_COLORS[i % SEGMENT_COLORS.length]}`} />
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-gray-900 dark:text-white">{seg.name}</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {seg.guests} guests · {seg.sharePct}%
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${SEGMENT_COLORS[i % SEGMENT_COLORS.length]}`}
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

          {/* Campaign Performance */}
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Campaign Performance
            </h3>
            {data.campaigns.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                No campaigns created yet.
              </p>
            ) : (
              <div className="space-y-4">
                {data.campaigns.map((campaign, index) => (
                  <div key={index} className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                    <div className="flex-1">
                      <p className="font-medium text-gray-900 dark:text-white">{campaign.name}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {campaign.type} · Spend: {formatAmount(campaign.spent)} / {formatAmount(campaign.budget)} · {campaign.leads} leads · {campaign.conversions} conversions
                      </p>
                    </div>
                    <div className="text-right mr-4">
                      <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">
                        {campaign.leads > 0 ? Math.round((campaign.conversions / campaign.leads) * 100) : 0}%
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Conv. rate</p>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${campaignStatusColor(campaign.status)}`}>
                      {campaign.status}
                    </span>
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

export default SalesMarketingIntelligence;
