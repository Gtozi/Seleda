/**
 * Operational Intelligence Module
 *
 * Consolidated operational analytics served by
 * GET /api/executive/operational-intelligence, which aggregates live
 * metrics from each portal's real tables:
 * - Front Office (reservations, guest requests, room readiness)
 * - Housekeeping (housekeeping_task_mgmt, rooms)
 * - Food & Beverage (orders)
 * - Kitchen (fb_kitchen_analytics)
 * - Engineering (work_orders, pm_schedules, fixed_assets)
 * - Security (sec_incidents)
 * - Laundry (hk_laundry_jobs)
 * - Transportation (transport_requests/trips/vehicles)
 * - Concierge (guest_requests)
 * - Banquet & Events (banquet_events)
 * - Staffing (staff_attendance, employees)
 * - Operations Command (ops_escalations, ops_command_alerts, ops_cross_dept_tasks)
 *
 * Departments without an operational data source (Spa & Wellness)
 * render an explicit "no live data" state rather than mock values.
 */

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  Activity,
  Bed,
  Utensils,
  Wrench,
  Shield,
  Truck,
  Sparkles,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Users,
  ChefHat,
  Calendar,
  Bell,
  Database,
  Minus,
} from 'lucide-react';
import { useERP } from '../../../../context/ERPContext';
import {
  fetchOperationalIntelligence,
  OpsDepartment,
  OpsMetric,
} from '../../../../services/executiveService';

const DEPARTMENT_ICONS: Record<string, any> = {
  'Front Office': Bed,
  'Housekeeping': Sparkles,
  'Food & Beverage': Utensils,
  'Kitchen': ChefHat,
  'Engineering': Wrench,
  'Security': Shield,
  'Laundry': Activity,
  'Transportation': Truck,
  'Concierge': Bell,
  'Banquet & Events': Calendar,
  'Staffing': Users,
  'Operations Command': Activity,
  'Spa & Wellness': Sparkles,
};

const STATUS_LABEL: Record<string, string> = {
  'on-track': 'good',
  'at-risk': 'warning',
  'off-track': 'critical',
};

const OperationalIntelligence = () => {
  const { currentPropertyId, formatAmount } = useERP();
  const [departments, setDepartments] = useState<OpsDepartment[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchOperationalIntelligence(currentPropertyId, days);
      setDepartments(res.departments);
      setGeneratedAt(res.generatedAt);
    } catch (e: any) {
      setError(e?.message || 'Failed to load operational intelligence');
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

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'on-track':
        return <CheckCircle2 className="w-4 h-4" />;
      case 'at-risk':
      case 'off-track':
        return <AlertTriangle className="w-4 h-4" />;
      default:
        return null;
    }
  };

  const allMetrics = useMemo(
    () => departments.flatMap(d => d.metrics),
    [departments],
  );

  const departmentStats = useMemo(() => {
    const acc: Record<string, { total: number; good: number; warning: number; critical: number; avgTrend: number | null }> = {};
    for (const dept of departments) {
      const good = dept.metrics.filter(m => m.status === 'on-track').length;
      const warning = dept.metrics.filter(m => m.status === 'at-risk').length;
      const critical = dept.metrics.filter(m => m.status === 'off-track').length;
      const trends = dept.metrics.map(m => m.trend).filter((t): t is number => t !== null);
      acc[dept.name] = {
        total: dept.metrics.length,
        good,
        warning,
        critical,
        avgTrend: trends.length > 0 ? trends.reduce((s, t) => s + t, 0) / trends.length : null,
      };
    }
    return acc;
  }, [departments]);

  const filteredDepartments = selectedDepartment === 'all'
    ? departments
    : departments.filter(d => d.name === selectedDepartment);

  const counts = {
    good: allMetrics.filter(m => m.status === 'on-track').length,
    warning: allMetrics.filter(m => m.status === 'at-risk').length,
    critical: allMetrics.filter(m => m.status === 'off-track').length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Operational Intelligence
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Consolidated operational analytics across all departments
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
        </div>
      </div>

      {/* Loading / Error */}
      {loading && departments.length === 0 && (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-6 h-6 animate-spin text-indigo-500" />
          <span className="ml-3 text-gray-500 dark:text-gray-400">Loading operational metrics…</span>
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

      {!loading && !error && departments.length > 0 && (
        <>
          {/* Department Overview */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {departments.map(dept => {
              const stats = departmentStats[dept.name];
              const Icon = DEPARTMENT_ICONS[dept.name] || Activity;
              const goodPercent = stats.total > 0 ? (stats.good / stats.total) * 100 : 0;

              return (
                <div
                  key={dept.name}
                  onClick={() => setSelectedDepartment(dept.name === selectedDepartment ? 'all' : dept.name)}
                  className={`p-4 rounded-lg border cursor-pointer transition-all ${
                    selectedDepartment === dept.name
                      ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500 dark:border-indigo-400'
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-600'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className="w-5 h-5 text-indigo-600" />
                    <h3 className="font-semibold text-gray-900 dark:text-white text-sm">
                      {dept.name}
                    </h3>
                  </div>
                  {dept.hasData ? (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-emerald-600 dark:text-emerald-400">Good: {stats.good}</span>
                        <span className="text-rose-600 dark:text-rose-400">Critical: {stats.critical}</span>
                      </div>
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                        <div
                          className="bg-emerald-500 h-2 rounded-full transition-all"
                          style={{ width: `${goodPercent}%` }}
                        />
                      </div>
                      <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                        {stats.avgTrend === null ? (
                          <>
                            <Minus className="w-3 h-3" />
                            <span>No prior baseline</span>
                          </>
                        ) : (
                          <>
                            {stats.avgTrend >= 0 ? (
                              <TrendingUp className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <TrendingDown className="w-3 h-3 text-rose-600" />
                            )}
                            <span>{stats.avgTrend >= 0 ? '+' : ''}{stats.avgTrend.toFixed(1)}% avg trend</span>
                          </>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500 py-2">
                      <Database className="w-3.5 h-3.5" />
                      <span>No live data source yet</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Department Filter */}
          <div className="flex items-center gap-4">
            <select
              value={selectedDepartment}
              onChange={(e) => setSelectedDepartment(e.target.value)}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="all">All Departments</option>
              {departments.map(dept => (
                <option key={dept.name} value={dept.name}>{dept.name}</option>
              ))}
            </select>
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredDepartments.flatMap(dept =>
              dept.metrics.map((m, index) => (
                <MetricCard
                  key={`${dept.name}-${m.metric}-${index}`}
                  department={dept.name}
                  metric={m}
                  formatValue={formatValue}
                  getStatusColor={getStatusColor}
                  getStatusIcon={getStatusIcon}
                />
              )),
            )}
            {filteredDepartments.every(d => d.metrics.length === 0) && (
              <div className="col-span-full text-center py-12 text-gray-500 dark:text-gray-400">
                <Database className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No operational metrics recorded for this selection.</p>
              </div>
            )}
          </div>

          {/* Operational Summary */}
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Operational Summary
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
                  {counts.good}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Good Performance
                </p>
              </div>
              <div className="text-center p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <p className="text-3xl font-bold text-amber-600 dark:text-amber-400">
                  {counts.warning}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Needs Attention
                </p>
              </div>
              <div className="text-center p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <p className="text-3xl font-bold text-rose-600 dark:text-rose-400">
                  {counts.critical}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Critical Issues
                </p>
              </div>
              <div className="text-center p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <p className="text-3xl font-bold text-indigo-600 dark:text-indigo-400">
                  {allMetrics.length}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Total Metrics
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const MetricCard = ({
  department,
  metric,
  formatValue,
  getStatusColor,
  getStatusIcon,
}: {
  department: string;
  metric: OpsMetric;
  formatValue: (v: number, u: string) => string;
  getStatusColor: (s: string) => string;
  getStatusIcon: (s: string) => ReactElement | null;
}) => (
  <div className="bg-white dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow">
    <div className="flex items-start justify-between mb-3">
      <div className="flex-1">
        <h3 className="font-semibold text-gray-900 dark:text-white">
          {metric.metric}
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {department}
        </p>
      </div>
      <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(metric.status)}`}>
        {getStatusIcon(metric.status)}
        <span className="capitalize">{STATUS_LABEL[metric.status] || metric.status}</span>
      </div>
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

      <div className="flex items-center gap-1 text-xs">
        {metric.trend === null ? (
          <span className="text-gray-500 dark:text-gray-400">No prior baseline</span>
        ) : (
          <>
            {metric.trend >= 0 ? (
              <TrendingUp className="w-3 h-3 text-emerald-600" />
            ) : (
              <TrendingDown className="w-3 h-3 text-rose-600" />
            )}
            <span className={metric.trend >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
              {metric.trend >= 0 ? '+' : ''}{metric.trend}%
            </span>
            <span className="text-gray-500 dark:text-gray-400">vs previous period</span>
          </>
        )}
      </div>
    </div>
  </div>
);

export default OperationalIntelligence;
