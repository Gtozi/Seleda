/**
 * Alerts & Exceptions Module — live data from /api/executive/alerts-exceptions
 *
 * Aggregates every alert stream in the system: ops_command_alerts,
 * eng/hk/sec dashboard alerts, eng_utility_alerts, ops_maintenance_alerts
 * (IoT), sec_fraud_alerts, sec_alarms, proc_alerts, spa_alerts,
 * rms_parity/restriction_alerts, alert_instances+rules, health_alerts,
 * transport_incidents, sec_compliance_items — plus computed threshold
 * exceptions (revenue drop, occupancy, labor/budget overrun, low stock,
 * energy spike, satisfaction, food cost, PM overdue, HK backlog).
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  TrendingDown,
  DollarSign,
  Bed,
  Users,
  Package,
  Shield,
  Zap,
  FileText,
  CheckCircle2,
  Clock,
  Download,
  Bell,
  RefreshCw,
  Loader2,
  AlertCircle,
  Filter,
  ArrowRight,
} from 'lucide-react';
import { useERP } from '../../../../context/ERPContext';
import { drillTargetFor } from '../../../../config/execDrilldown';
import {
  fetchAlertsExceptions,
  updateExecAlertStatus,
  type AlertsExceptionsResponse,
  type AlertCategory,
  type AlertSeverity,
  type AlertStatus,
  type ExecWindow,
} from '../../../../services/executiveService';

const CATEGORIES: { id: AlertCategory | 'all'; label: string; icon: typeof AlertTriangle }[] = [
  { id: 'all', label: 'All', icon: AlertTriangle },
  { id: 'revenue', label: 'Revenue', icon: DollarSign },
  { id: 'occupancy', label: 'Occupancy', icon: Bed },
  { id: 'cost', label: 'Cost', icon: TrendingDown },
  { id: 'budget', label: 'Budget', icon: FileText },
  { id: 'satisfaction', label: 'Satisfaction', icon: Users },
  { id: 'labor', label: 'Labor', icon: Users },
  { id: 'inventory', label: 'Inventory', icon: Package },
  { id: 'fraud', label: 'Fraud', icon: Shield },
  { id: 'energy', label: 'Energy', icon: Zap },
  { id: 'compliance', label: 'Compliance', icon: FileText },
];

const SEV_CLS: Record<AlertSeverity, string> = {
  critical: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400 border-rose-500',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 border-orange-500',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-500',
  low: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-500',
};

const STATUS_CLS: Record<AlertStatus, string> = {
  active: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400',
  acknowledged: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  resolved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
};

const AlertsExceptions = () => {
  const navigate = useNavigate();
  const { currentPropertyId, formatAmount } = useERP();
  const [data, setData] = useState<AlertsExceptionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<ExecWindow>(30);
  const [category, setCategory] = useState<AlertCategory | 'all'>('all');
  const [severity, setSeverity] = useState<AlertSeverity | 'all'>('all');
  const [status, setStatus] = useState<AlertStatus | 'all'>('all');
  const [actingOn, setActingOn] = useState<string | null>(null);

  const setAlertStatus = async (id: string, next: 'acknowledged' | 'resolved' | 'active') => {
    setActingOn(id);
    try {
      await updateExecAlertStatus(id, next, { propertyId: currentPropertyId });
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to update alert');
    } finally {
      setActingOn(null);
    }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchAlertsExceptions(currentPropertyId, days));
    } catch (e: any) {
      setError(e?.message || 'Failed to load alerts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [currentPropertyId, days]);

  const exportCsv = () => {
    if (!data) return;
    const rows: string[][] = [
      ['Title', 'Category', 'Severity', 'Status', 'Source', 'Department', 'Value', 'Threshold', 'Timestamp', 'Description'],
      ...data.alerts.map(a => [
        a.title, a.category, a.severity, a.status, a.source, a.department ?? '',
        a.value != null ? String(a.value) : '', a.threshold != null ? String(a.threshold) : '',
        a.timestamp ?? '', a.description,
      ]),
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `alerts-exceptions-${String(days)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const filtered = (data?.alerts ?? []).filter(a =>
    (category === 'all' || a.category === category) &&
    (severity === 'all' || a.severity === severity) &&
    (status === 'all' || a.status === status));

  const catCount = (c: AlertCategory) =>
    data?.summary.byCategory.find(x => x.category === c)?.count ?? 0;

  const fmtTs = (ts: string | null) => {
    if (!ts) return '';
    const d = new Date(ts);
    return isNaN(d.getTime()) ? ts : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <AlertCircle className="w-10 h-10 text-rose-500" />
        <p className="text-gray-600 dark:text-gray-400">{error}</p>
        <button onClick={load} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Alerts & Exceptions</h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Real-time alerts from every portal — revenue, occupancy, cost, fraud, energy & compliance
          </p>
          {data && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Updated {new Date(data.generatedAt).toLocaleTimeString()}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <select
            value={severity}
            onChange={e => setSeverity(e.target.value as AlertSeverity | 'all')}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          >
            <option value="all">All Severity</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select
            value={status}
            onChange={e => setStatus(e.target.value as AlertStatus | 'all')}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="resolved">Resolved</option>
          </select>
          <select
            value={String(days)}
            onChange={e => {
              const v = e.target.value;
              setDays(/^\d+$/.test(v) ? Number(v) : (v as ExecWindow));
            }}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          >
            <option value="today">Today</option>
            <option value="wtd">Week to date</option>
            <option value="mtd">Month to date</option>
            <option value="qtd">Quarter to date</option>
            <option value="ytd">Year to date</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={180}>Last 6 months</option>
          </select>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button onClick={exportCsv}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
            <Download className="w-4 h-4" />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-rose-50 dark:bg-rose-900/20 border border-rose-500 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Bell className="w-5 h-5 text-rose-600" />
            <span className="text-sm font-medium text-rose-900 dark:text-rose-400">Active Alerts</span>
          </div>
          <p className="text-2xl font-bold text-rose-900 dark:text-rose-400">{data?.summary.active ?? 0}</p>
        </div>
        <div className="bg-rose-100 dark:bg-rose-900/30 border border-rose-600 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-rose-700 dark:text-rose-500" />
            <span className="text-sm font-medium text-rose-900 dark:text-rose-400">Critical</span>
          </div>
          <p className="text-2xl font-bold text-rose-900 dark:text-rose-400">{data?.summary.critical ?? 0}</p>
        </div>
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-500 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-5 h-5 text-amber-600" />
            <span className="text-sm font-medium text-amber-900 dark:text-amber-400">Acknowledged</span>
          </div>
          <p className="text-2xl font-bold text-amber-900 dark:text-amber-400">{data?.summary.acknowledged ?? 0}</p>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-500 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <span className="text-sm font-medium text-emerald-900 dark:text-emerald-400">Resolved</span>
          </div>
          <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-400">{data?.summary.resolved ?? 0}</p>
        </div>
      </div>

      {/* Category chips */}
      <div className="grid grid-cols-2 md:grid-cols-6 lg:grid-cols-11 gap-2">
        {CATEGORIES.map(cat => {
          const Icon = cat.icon;
          const count = cat.id === 'all' ? (data?.summary.total ?? 0) : catCount(cat.id);
          return (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              disabled={count === 0 && cat.id !== 'all'}
              className={`p-2 rounded-lg border transition-all ${
                category === cat.id
                  ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500 dark:border-indigo-400'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-600'
              } ${count === 0 && cat.id !== 'all' ? 'opacity-50' : ''}`}
            >
              <Icon className="w-4 h-4 mx-auto mb-1 text-indigo-600" />
              <p className="text-xs font-medium text-gray-900 dark:text-white text-center">{cat.label}</p>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 text-center">{count}</p>
            </button>
          );
        })}
      </div>

      {/* Alert list */}
      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-10 text-center">
          <Filter className="w-8 h-8 mx-auto mb-2 text-gray-400" />
          <p className="text-gray-600 dark:text-gray-400">No alerts match the selected filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filtered.map(alert => (
            <div key={alert.id}
              className="bg-white dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <h3 className="font-semibold text-gray-900 dark:text-white">{alert.title}</h3>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium border ${SEV_CLS[alert.severity]}`}>
                      {alert.severity.toUpperCase()}
                    </span>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_CLS[alert.status]}`}>
                      {alert.status.toUpperCase()}
                    </span>
                    <span className="px-2 py-1 rounded-full text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                      {alert.source}
                    </span>
                    {alert.department && (
                      <span className="px-2 py-1 rounded-full text-xs bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300">
                        {alert.department}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{alert.description}</p>
                </div>
                <div className="text-right ml-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400">{fmtTs(alert.timestamp)}</p>
                </div>
              </div>

              {(alert.value !== null || alert.threshold !== null) && (
                <div className="flex items-center gap-4 mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                  {alert.value !== null && (
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Current Value</p>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {Math.abs(alert.value) >= 1000 ? formatAmount(alert.value) : alert.value.toLocaleString()}
                      </p>
                    </div>
                  )}
                  {alert.threshold !== null && (
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Threshold</p>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {Math.abs(alert.threshold) >= 1000 ? formatAmount(alert.threshold) : alert.threshold.toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Executive actions */}
              <div className="flex items-center gap-2 mt-4 pt-3 border-t border-gray-100 dark:border-gray-700/50">
                {alert.status === 'active' && (
                  <button
                    onClick={() => setAlertStatus(alert.id, 'acknowledged')}
                    disabled={actingOn === alert.id}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800 disabled:opacity-50"
                  >
                    Acknowledge
                  </button>
                )}
                {alert.status !== 'resolved' && (
                  <button
                    onClick={() => setAlertStatus(alert.id, 'resolved')}
                    disabled={actingOn === alert.id}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800 disabled:opacity-50"
                  >
                    Resolve
                  </button>
                )}
                {alert.status !== 'active' && (
                  <button
                    onClick={() => setAlertStatus(alert.id, 'active')}
                    disabled={actingOn === alert.id}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600 disabled:opacity-50"
                  >
                    Reopen
                  </button>
                )}
                {alert.note && (
                  <span className="text-xs text-gray-400 dark:text-gray-500 italic ml-2">Note: {alert.note}</span>
                )}
                {(() => {
                  const target = drillTargetFor(alert.department || alert.source);
                  return target ? (
                    <button
                      onClick={() => navigate(target.path)}
                      className="ml-auto flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300"
                    >
                      Open {target.label}
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  ) : null;
                })()}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Source breakdown */}
      {data && data.summary.bySource.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Alerts by Source System</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {data.summary.bySource.map(s => (
              <div key={s.source} className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg text-center">
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{s.count}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{s.source}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AlertsExceptions;
