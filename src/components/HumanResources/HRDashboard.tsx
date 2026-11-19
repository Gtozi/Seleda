/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HR Executive Dashboard — real-time workforce KPIs from HR tables.
 */

import { useCallback, useEffect, useState, useMemo } from 'react';
import {
  Users,
  AlertCircle,
  DollarSign,
  Briefcase,
  Clock,
  GraduationCap,
  TrendingUp,
  UserCheck,
  Calendar,
  Star,
  Bell,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';

interface KpiData {
  metric_key: string;
  metric_label: string;
  metric_value: string;
  sub_label: string;
  color_tone: string;
}

interface AlertData {
  metric_key: string;
  metric_label: string;
  metric_value: string;
  color_tone: string;
}

interface RealtimeDashboard {
  kpis: KpiData[];
  alerts: AlertData[];
  deptDistribution: { name: string; value: number }[];
  attendanceTrend: { day: string; present: number; absent: number }[];
  recruitmentFunnel: { applications: number; shortlisted: number; interviews: number; offersSent: number };
  upcomingTrainings: { title: string; date: string; dept: string; attendees: number }[];
  pendingLeaves: { name: string; type: string; dates: string; dept: string }[];
}

const ICON_MAP: Record<string, any> = {
  'Total Employees': Users, 'Active Employees': UserCheck, 'Vacant Positions': Briefcase,
  'Employee Turnover': TrendingUp, 'Attendance Rate': Clock, 'Overtime Hours': Clock,
  'Leave Utilization': Calendar, 'Training Completion': GraduationCap,
  'Payroll Cost': DollarSign, 'Employee Satisfaction': Star,
};

const TONE_MAP: Record<string, any> = {
  indigo: 'accent', success: 'success', warning: 'warning', danger: 'danger',
  accent: 'accent', purple: 'info', cyan: 'info', pink: 'info', yellow: 'warning',
};

const PRESET_COLORS = ['#B5563C', '#5F7A4F', '#C18A3B', '#9C4A36', '#6B5C4D', '#6366f1', '#10b981', '#f43f5e'];

function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  headers['Content-Type'] = 'application/json';
  return headers;
}

const HRDashboard = () => {
  const { currentPropertyId, formatAmount } = useERP();
  const [data, setData] = useState<RealtimeDashboard | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchDashboard = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/hr-portal/dashboard/realtime/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setData(await res.json());
    } catch { /* non-fatal */ }
    setLoading(false);
  }, [currentPropertyId]);

  useEffect(() => { if (currentPropertyId) fetchDashboard(); }, [currentPropertyId, fetchDashboard]);

  const kpis = useMemo(() => data?.kpis || [], [data]);
  const alerts = useMemo(() => data?.alerts || [], [data]);
  const deptDistribution = useMemo(() => data?.deptDistribution || [], [data]);
  const attendanceTrend = useMemo(() => data?.attendanceTrend || [], [data]);
  const funnel = useMemo(() => data?.recruitmentFunnel || { applications: 1, shortlisted: 0, interviews: 0, offersSent: 0 }, [data]);
  const trainings = useMemo(() => data?.upcomingTrainings || [], [data]);
  const pendingLeaves = useMemo(() => data?.pendingLeaves || [], [data]);

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Executive Dashboard" subtitle="Centralized workforce management view" icon={Users} />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Users className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">Select a property to view the dashboard.</p>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Executive Dashboard"
        subtitle="Centralized real-time workforce management view"
        icon={Users}
        actions={
          <button onClick={fetchDashboard} disabled={loading} className={button.ghost}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </button>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        {kpis.map((k) => {
          const Icon = ICON_MAP[k.metric_label] || Users;
          const value = k.metric_label === 'Payroll Cost' ? formatAmount(Number(k.metric_value) || 0) : k.metric_value;
          return (
            <StatCard
              key={k.metric_key}
              title={k.metric_label}
              value={value}
              caption={k.sub_label}
              icon={Icon}
              tone={TONE_MAP[k.color_tone] || 'accent'}
            />
          );
        })}
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <SectionCard title="HR Alerts" icon={Bell} tone="danger">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-6">
            {alerts.map((a) => (
              <div key={a.metric_key} className="bg-white dark:bg-slate-900 rounded-lg p-3 border border-rose-100 dark:border-rose-500/20">
                <p className="text-[9px] font-bold text-slate-400 uppercase">{a.metric_label}</p>
                <p className={`text-lg font-bold text-${a.color_tone}-600 dark:text-${a.color_tone}-400`}>{a.metric_value}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <div className="grid lg:grid-cols-12 gap-6">
        {/* Attendance Analysis */}
        <SectionCard title="Attendance Analysis" subtitle="Last 7 days present / absent" icon={Clock} tone="accent" className="lg:col-span-8">
          <div className="flex gap-4 mb-4 px-6">
            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-indigo-500" /><span className="text-xs font-medium text-slate-600 dark:text-slate-400">Present</span></div>
            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-rose-500" /><span className="text-xs font-medium text-slate-600 dark:text-slate-400">Absent</span></div>
          </div>
          <div className="h-72 w-full px-6 pb-6">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={attendanceTrend}>
                <XAxis dataKey="day" axisLine={false} tickLine={false} fontSize={12} fontWeight={500} tick={{ fill: '#64748b' }} />
                <YAxis axisLine={false} tickLine={false} fontSize={12} fontWeight={500} tick={{ fill: '#64748b' }} />
                <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', fontSize: '12px' }} />
                <Bar dataKey="present" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={24} />
                <Bar dataKey="absent" fill="#f43f5e" radius={[4, 4, 0, 0]} barSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        {/* Staff by Department */}
        <SectionCard title="Staff by Department" subtitle="Department distribution" icon={Users} tone="accent" className="lg:col-span-4">
          <div className="h-64 w-full px-6 pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={deptDistribution} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                  {deptDistribution.map((_, index) => <Cell key={index} fill={PRESET_COLORS[index % PRESET_COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-2.5 mt-4 px-6 pb-6">
            {deptDistribution.map((dept, i) => (
              <div key={dept.name} className="flex justify-between items-center text-sm">
                <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full" style={{ backgroundColor: PRESET_COLORS[i % PRESET_COLORS.length] }} /><span className="text-slate-600 dark:text-slate-400">{dept.name}</span></div>
                <span className="font-semibold text-slate-900 dark:text-white">{dept.value} staff</span>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Recruitment Funnel */}
        <SectionCard title="Recruitment Funnel" icon={Briefcase} tone="accent" className="lg:col-span-4">
          <div className="space-y-5 p-6">
            {[
              { label: 'Applications', count: funnel.applications, color: 'bg-slate-200 dark:bg-slate-700' },
              { label: 'Shortlisted', count: funnel.shortlisted, color: 'bg-indigo-500' },
              { label: 'Interviews', count: funnel.interviews, color: 'bg-blue-500' },
              { label: 'Offers Sent', count: funnel.offersSent, color: 'bg-emerald-500' },
            ].map((step) => (
              <div key={step.label} className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400 uppercase">{step.label}</span>
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">{step.count}</span>
                </div>
                <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div className={`h-full ${step.color}`} style={{ width: `${Math.min((step.count / Math.max(funnel.applications, 1)) * 100, 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Upcoming Trainings & Leaves */}
        <SectionCard title="Upcoming & Pending" icon={Calendar} tone="accent" className="lg:col-span-8">
          <div className="grid md:grid-cols-2 gap-8 p-6">
            <div>
              <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-4">Training Schedule</h4>
              <div className="space-y-3">
                {trainings.map((t, i) => (
                  <div key={i} className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700 flex justify-between items-center">
                    <div>
                      <span className="text-xs font-semibold text-indigo-600 block leading-none mb-1">{t.date}</span>
                      <h5 className="text-sm font-semibold text-slate-900 dark:text-white">{t.title}</h5>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-400 uppercase block">{t.dept}</span>
                      <span className="text-xs font-semibold text-slate-500">{t.attendees} staff</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-4">Leave Approvals Pending</h4>
              <div className="space-y-3">
                {pendingLeaves.map((l, i) => (
                  <div key={i} className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700 flex justify-between items-center group cursor-pointer hover:border-indigo-300 transition-all">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-slate-200 dark:bg-slate-700 rounded-full flex items-center justify-center text-xs font-semibold text-slate-700 dark:text-slate-300">{l.name.split(' ').map((n) => n[0]).join('')}</div>
                      <div>
                        <h5 className="text-sm font-semibold text-slate-900 dark:text-white">{l.name}</h5>
                        <span className="text-xs text-slate-500">{l.dates}</span>
                      </div>
                    </div>
                    <div className="text-right flex flex-col items-end gap-1">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${l.type === 'Annual' ? 'bg-indigo-100 text-indigo-700' : 'bg-rose-100 text-rose-700'}`}>{l.type}</span>
                      <span className="text-[10px] font-medium text-slate-500 uppercase">{l.dept}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
};

export default HRDashboard;
