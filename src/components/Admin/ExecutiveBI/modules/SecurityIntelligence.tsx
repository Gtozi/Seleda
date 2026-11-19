/**
 * Security Intelligence Module
 *
 * Live data from GET /api/executive/security-intelligence:
 * - Incident trends and resolution from sec_incidents
 * - Risk register from sec_risks
 * - Fraud analytics from sec_fraud_cases + sec_investigations
 * - Access control from sec_access_events, sec_keys, sec_visitors, sec_patrols
 * - Emergency response from sec_emergency_notifications/responses, sec_alarms, sec_cctv_*
 * - Compliance from sec_compliance_audits/items + sec_safety_inspections
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Shield,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Map,
  Lock,
  Activity,
  Download,
  RefreshCw,
  FileText,
  Minus,
  BarChart3,
  Database,
  Clock,
} from 'lucide-react';
import { useERP } from '../../../../context/ERPContext';
import {
  fetchSecurityIntelligence,
  SecMetric,
  SecCategory,
} from '../../../../services/executiveService';

const SEC_CATEGORIES: { id: SecCategory | 'all'; label: string; icon: any }[] = [
  { id: 'all', label: 'All Analytics', icon: BarChart3 },
  { id: 'incidents', label: 'Incidents', icon: AlertTriangle },
  { id: 'risk', label: 'Risk', icon: Map },
  { id: 'fraud', label: 'Fraud', icon: Shield },
  { id: 'access', label: 'Access', icon: Lock },
  { id: 'emergency', label: 'Emergency', icon: Activity },
  { id: 'compliance', label: 'Compliance', icon: FileText },
];

const TYPE_COLORS = ['bg-rose-500', 'bg-amber-500', 'bg-blue-500', 'bg-purple-500', 'bg-teal-500', 'bg-gray-500'];

const LEVEL_COLORS: Record<string, string> = {
  Critical: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400',
  High: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  Medium: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  Low: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
};

const SecurityIntelligence = () => {
  const { currentPropertyId, formatAmount } = useERP();
  const [data, setData] = useState<{
    metrics: SecMetric[];
    incidentByType: { type: string; count: number }[];
    locationHotspots: { location: string; score: number }[];
    riskRegister: { title: string; category: string; level: string; score: number; status: string }[];
    recentIncidents: { type: string; location: string; priority: string; status: string; at: string }[];
    patrolSummary: { total: number; completed: number; inProgress: number; checkpointsScanned: number };
  }>({
    metrics: [], incidentByType: [], locationHotspots: [], riskRegister: [],
    recentIncidents: [], patrolSummary: { total: 0, completed: 0, inProgress: 0, checkpointsScanned: 0 },
  });
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [selectedCategory, setSelectedCategory] = useState<SecCategory | 'all'>('all');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchSecurityIntelligence(currentPropertyId, days);
      setData({
        metrics: res.metrics,
        incidentByType: res.incidentByType,
        locationHotspots: res.locationHotspots,
        riskRegister: res.riskRegister,
        recentIncidents: res.recentIncidents,
        patrolSummary: res.patrolSummary,
      });
      setGeneratedAt(res.generatedAt);
    } catch (e: any) {
      setError(e?.message || 'Failed to load security intelligence');
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
      case '/day': return `${value.toFixed(2)}/day`;
      case '/25': return `${value.toFixed(1)}/25`;
      case 'hrs': return `${value.toFixed(1)} hrs`;
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
    a.download = `security-intelligence-${days}d.csv`;
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

  const totalTypeCount = data.incidentByType.reduce((s, t) => s + t.count, 0);
  const maxHotspot = Math.max(...data.locationHotspots.map(h => h.score), 1);

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
            Security Intelligence
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Incident trends, risk register, and compliance metrics
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
          <span className="ml-3 text-gray-500 dark:text-gray-400">Loading security metrics…</span>
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
            {SEC_CATEGORIES.map(cat => {
              const Icon = cat.icon;
              const empty = cat.id !== 'all' && !categoriesWithData.has(cat.id as SecCategory);
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
            {/* Incident Breakdown */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Incident Breakdown by Type
              </h3>
              {data.incidentByType.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                  No incidents recorded in this period.
                </p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {data.incidentByType.map((inc, i) => (
                    <div key={inc.type} className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg text-center">
                      <div className={`w-3 h-3 rounded-full ${TYPE_COLORS[i % TYPE_COLORS.length]} mx-auto mb-2`} />
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{inc.type}</p>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{inc.count}</p>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {totalTypeCount ? Math.round((inc.count / totalTypeCount) * 100) : 0}% of total
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Location Hotspots */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Location Hotspots
              </h3>
              {data.locationHotspots.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                  No incident or alarm locations recorded in this period.
                </p>
              ) : (
                <div className="space-y-3">
                  {data.locationHotspots.map(h => (
                    <div key={h.location} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{h.location}</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">score {h.score}</span>
                      </div>
                      <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${h.score >= maxHotspot * 0.6 ? 'bg-rose-500' : h.score >= maxHotspot * 0.3 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                          style={{ width: `${(h.score / maxHotspot) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Risk Register */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Top Open Risks
              </h3>
              {data.riskRegister.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                  No open risks in the register.
                </p>
              ) : (
                <div className="space-y-3">
                  {data.riskRegister.map(r => (
                    <div key={r.title} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 dark:text-white truncate">{r.title}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{r.category} · {r.status}</p>
                      </div>
                      <div className="flex items-center gap-2 ml-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${LEVEL_COLORS[r.level] || LEVEL_COLORS.Low}`}>
                          {r.level}
                        </span>
                        <span className="text-sm font-bold text-gray-900 dark:text-white w-10 text-right">
                          {r.score}/25
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Incidents */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Recent Incidents
              </h3>
              {data.recentIncidents.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                  No incidents reported in this period.
                </p>
              ) : (
                <div className="space-y-3">
                  {data.recentIncidents.map((i, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 dark:text-white truncate">{i.type}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {i.location} · {new Date(i.at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 ml-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${LEVEL_COLORS[i.priority] || LEVEL_COLORS.Medium}`}>
                          {i.priority}
                        </span>
                        <span className={`text-xs font-medium ${i.status === 'Resolved' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                          {i.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Patrol Activity */}
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Patrol Activity
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Patrols Scheduled', value: data.patrolSummary.total },
                { label: 'Completed', value: data.patrolSummary.completed },
                { label: 'In Progress', value: data.patrolSummary.inProgress },
                { label: 'Checkpoints Scanned', value: data.patrolSummary.checkpointsScanned },
              ].map(item => (
                <div key={item.label} className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg text-center">
                  <Clock className="w-5 h-5 mx-auto mb-2 text-indigo-500" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">{item.label}</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                    {item.value.toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {!loading && !error && data.metrics.length === 0 && (
        <div className="text-center py-16 text-gray-500 dark:text-gray-400">
          <Database className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p className="font-medium">No security data available for the selected period.</p>
          <p className="text-sm mt-1">Incidents, risks, patrols, and audits will appear here once recorded.</p>
        </div>
      )}
    </div>
  );
};

export default SecurityIntelligence;
