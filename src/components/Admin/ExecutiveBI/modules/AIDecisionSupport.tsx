/**
 * AI Decision Support Module
 *
 * Live data from GET /api/executive/ai-decision-support:
 * - rms_ai_recommendations + pricing engines (revenue)
 * - alert_instances + dept alert feeds (ops/eng/sec/hk/proc/spa) (risk/maintenance/staffing)
 * - sec_fraud_alerts, rms_parity_alerts, rms_restriction_alerts
 * - energy_projects (energy savings opportunities)
 * - Rule-engine recommendations from live uinv/energy/PM/labor KPIs
 * - rms_ai_insights headline insights
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Brain,
  DollarSign,
  Scissors,
  Users,
  ShoppingCart,
  Zap,
  ArrowUp,
  ArrowRight,
  Heart,
  Wrench,
  AlertTriangle,
  Download,
  RefreshCw,
  Lightbulb,
  Database,
  TrendingUp,
} from 'lucide-react';
import { useERP } from '../../../../context/ERPContext';
import { useNavigate } from 'react-router-dom';
import { drillTargetFor } from '../../../../config/execDrilldown';
import {
  fetchAiDecisionSupport,
  updateExecRecommendationStatus,
  AiRecommendation,
  AiCategory,
  AiStatus,
  type ExecWindow,
} from '../../../../services/executiveService';

const AI_CATEGORIES: { id: AiCategory | 'all'; label: string; icon: any }[] = [
  { id: 'all', label: 'All', icon: Brain },
  { id: 'revenue', label: 'Revenue', icon: DollarSign },
  { id: 'cost', label: 'Cost', icon: Scissors },
  { id: 'staffing', label: 'Staffing', icon: Users },
  { id: 'purchasing', label: 'Purchasing', icon: ShoppingCart },
  { id: 'energy', label: 'Energy', icon: Zap },
  { id: 'upselling', label: 'Upselling', icon: ArrowUp },
  { id: 'crossselling', label: 'Cross-sell', icon: ArrowRight },
  { id: 'retention', label: 'Retention', icon: Heart },
  { id: 'maintenance', label: 'Maintenance', icon: Wrench },
  { id: 'risk', label: 'Risk', icon: AlertTriangle },
];

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
  in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  implemented: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  dismissed: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400',
};

const INSIGHT_COLORS: Record<string, string> = {
  green: 'text-emerald-500', amber: 'text-amber-500',
  blue: 'text-blue-500', purple: 'text-purple-500',
};

const AIDecisionSupport = () => {
  const navigate = useNavigate();
  const { currentPropertyId, formatAmount } = useERP();
  const [data, setData] = useState<{
    recommendations: AiRecommendation[];
    insights: { title: string; description: string | null; icon: string; color: string }[];
    summary: {
      totalImpact: number; pending: number; inProgress: number;
      implemented: number; dismissed: number;
      bySource: { source: string; count: number }[];
    };
  }>({
    recommendations: [], insights: [],
    summary: { totalImpact: 0, pending: 0, inProgress: 0, implemented: 0, dismissed: 0, bySource: [] },
  });
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<ExecWindow>(30);
  const [selectedCategory, setSelectedCategory] = useState<AiCategory | 'all'>('all');
  const [selectedStatus, setSelectedStatus] = useState<'all' | AiStatus>('all');
  const [actingOn, setActingOn] = useState<string | null>(null);

  const setRecStatus = async (id: string, next: AiStatus) => {
    setActingOn(id);
    try {
      await updateExecRecommendationStatus(id, next, { propertyId: currentPropertyId });
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to update recommendation');
    } finally {
      setActingOn(null);
    }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAiDecisionSupport(currentPropertyId, days);
      setData({
        recommendations: res.recommendations,
        insights: res.insights,
        summary: res.summary,
      });
      setGeneratedAt(res.generatedAt);
    } catch (e: any) {
      setError(e?.message || 'Failed to load AI decision support');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId, days]);

  const filteredRecommendations = data.recommendations.filter(rec => {
    const categoryMatch = selectedCategory === 'all' || rec.category === selectedCategory;
    const statusMatch = selectedStatus === 'all' || rec.status === selectedStatus;
    return categoryMatch && statusMatch;
  });

  const categoriesWithData = useMemo(
    () => new Set(data.recommendations.map(r => r.category)),
    [data.recommendations],
  );

  const getImpactColor = (impact: number | null) => {
    if (impact === null) return 'text-gray-600 dark:text-gray-400';
    if (impact > 0) return 'text-emerald-600 dark:text-emerald-400';
    if (impact < 0) return 'text-rose-600 dark:text-rose-400';
    return 'text-gray-600 dark:text-gray-400';
  };

  const formatImpact = (rec: AiRecommendation) =>
    rec.impact === null
      ? '—'
      : `${rec.impact >= 0 ? '+' : ''}${formatAmount(rec.impact)}${rec.impactEstimated ? ' est.' : ''}`;

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 90) return 'bg-emerald-500';
    if (confidence >= 80) return 'bg-blue-500';
    if (confidence >= 70) return 'bg-amber-500';
    return 'bg-rose-500';
  };

  const exportCsv = () => {
    const header = 'Title,Category,Source,Department,Impact,Confidence,Status';
    const rows = data.recommendations.map(r =>
      [r.title, r.category, r.source, r.department ?? '', r.impact === null ? '' : `${r.impact}${r.impactEstimated ? ' (est)' : ''}`, r.confidence, r.status]
        .map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-decision-support-${String(days)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openImpact = data.recommendations
    .filter(r => r.status === 'pending' || r.status === 'in_progress')
    .reduce((s, r) => s + (r.impact ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            AI Decision Support
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Recommendations and alerts aggregated from all department systems
            {generatedAt && (
              <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
                · Updated {new Date(generatedAt).toLocaleString()}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={String(days)}
            onChange={(e) => {
              const v = e.target.value;
              setDays(/^\d+$/.test(v) ? Number(v) : (v as ExecWindow));
            }}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          >
            <option value="today">Today</option>
            <option value="wtd">Week to date</option>
            <option value="mtd">Month to date</option>
            <option value="qtd">Quarter to date</option>
            <option value="ytd">Year to date</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last year</option>
          </select>
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value as any)}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="implemented">Implemented</option>
            <option value="dismissed">Dismissed</option>
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
            disabled={data.recommendations.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* Loading / Error */}
      {loading && data.recommendations.length === 0 && (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-6 h-6 animate-spin text-indigo-500" />
          <span className="ml-3 text-gray-500 dark:text-gray-400">Loading recommendations…</span>
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

      {/* AI Insights */}
      {data.insights.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {data.insights.map((ins, i) => (
            <div key={i} className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2 mb-2">
                <Lightbulb className={`w-4 h-4 ${INSIGHT_COLORS[ins.color] || 'text-blue-500'}`} />
                <p className="text-sm font-semibold text-gray-900 dark:text-white">{ins.title}</p>
              </div>
              {ins.description && (
                <p className="text-xs text-gray-500 dark:text-gray-400">{ins.description}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Categories */}
      <div className="grid grid-cols-3 md:grid-cols-6 lg:grid-cols-11 gap-2">
        {AI_CATEGORIES.map(cat => {
          const Icon = cat.icon;
          const empty = cat.id !== 'all' && !categoriesWithData.has(cat.id as AiCategory);
          return (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`p-2 rounded-lg border transition-all ${
                selectedCategory === cat.id
                  ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500 dark:border-indigo-400'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-600'
              } ${empty ? 'opacity-50' : ''}`}
            >
              <Icon className="w-4 h-4 mx-auto mb-1 text-indigo-600" />
              <p className="text-xs font-medium text-gray-900 dark:text-white text-center">{cat.label}</p>
            </button>
          );
        })}
      </div>

      {/* Recommendations */}
      <div className="grid grid-cols-1 gap-4">
        {filteredRecommendations.map(rec => (
          <div
            key={rec.id}
            className="bg-white dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <h3 className="font-semibold text-gray-900 dark:text-white">{rec.title}</h3>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[rec.status] || STATUS_STYLES.pending}`}>
                    {rec.status.replace('_', ' ')}
                  </span>
                  <span className="px-2 py-1 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                    {rec.source}
                  </span>
                  {rec.department && (
                    <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                      {rec.department}
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400">{rec.description}</p>
              </div>
              <div className="flex items-center gap-4 ml-4 shrink-0">
                <div className="text-right">
                  <p className={`text-lg font-bold ${getImpactColor(rec.impact)}`}>
                    {formatImpact(rec)}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {rec.impact === null ? 'Impact (not priced)' : 'Impact'}
                  </p>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-1">
                    <div className={`w-2 h-2 rounded-full ${getConfidenceColor(rec.confidence)}`} />
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{rec.confidence}%</p>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Confidence</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <span className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                {rec.category} · {rec.createdAt ? new Date(rec.createdAt).toLocaleDateString() : 'current period'}
                {rec.note ? ` · ${rec.note}` : ''}
              </span>
              <div className="flex items-center gap-2">
                {(() => {
                  const target = drillTargetFor(rec.department || rec.source);
                  return target ? (
                    <button
                      onClick={() => navigate(target.path)}
                      className="flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 mr-1"
                    >
                      {target.label}
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  ) : null;
                })()}
                {rec.status === 'pending' && (
                  <button
                    onClick={() => setRecStatus(rec.id, 'in_progress')}
                    disabled={actingOn === rec.id}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800 disabled:opacity-50"
                  >
                    Start
                  </button>
                )}
                {(rec.status === 'pending' || rec.status === 'in_progress') && (
                  <button
                    onClick={() => setRecStatus(rec.id, 'implemented')}
                    disabled={actingOn === rec.id}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800 disabled:opacity-50"
                  >
                    Mark Implemented
                  </button>
                )}
                {rec.status !== 'dismissed' && rec.status !== 'implemented' && (
                  <button
                    onClick={() => setRecStatus(rec.id, 'dismissed')}
                    disabled={actingOn === rec.id}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 dark:bg-rose-900/20 dark:text-rose-400 dark:border-rose-800 disabled:opacity-50"
                  >
                    Dismiss
                  </button>
                )}
                {(rec.status === 'dismissed' || rec.status === 'implemented' || rec.status === 'in_progress') && (
                  <button
                    onClick={() => setRecStatus(rec.id, 'pending')}
                    disabled={actingOn === rec.id}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600 disabled:opacity-50"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        {filteredRecommendations.length === 0 && !loading && (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            <Database className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No recommendations match the selected filters.</p>
          </div>
        )}
      </div>

      {/* Impact Summary */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Recommendation Pipeline
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: 'Net Open Impact', value: formatAmount(openImpact), color: 'text-emerald-600 dark:text-emerald-400' },
            { label: 'Pending', value: String(data.summary.pending), color: 'text-gray-600 dark:text-gray-300' },
            { label: 'In Progress', value: String(data.summary.inProgress), color: 'text-blue-600 dark:text-blue-400' },
            { label: 'Implemented', value: String(data.summary.implemented), color: 'text-emerald-600 dark:text-emerald-400' },
            { label: 'Dismissed', value: String(data.summary.dismissed), color: 'text-rose-600 dark:text-rose-400' },
          ].map(item => (
            <div key={item.label} className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">{item.label}</p>
              <p className={`text-2xl font-bold ${item.color}`}>{item.value}</p>
            </div>
          ))}
        </div>
        {data.summary.bySource.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {data.summary.bySource.map(s => (
              <span key={s.source} className="px-3 py-1 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 rounded-full text-xs font-medium flex items-center gap-1">
                <TrendingUp className="w-3 h-3" />
                {s.source}: {s.count}
              </span>
            ))}
          </div>
        )}
      </div>

      {!loading && !error && data.recommendations.length === 0 && (
        <div className="text-center py-16 text-gray-500 dark:text-gray-400">
          <Database className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p className="font-medium">No recommendations available for the selected period.</p>
          <p className="text-sm mt-1">Recommendations appear as alerts, forecasts, and rule-engine signals are generated.</p>
        </div>
      )}
    </div>
  );
};

export default AIDecisionSupport;
