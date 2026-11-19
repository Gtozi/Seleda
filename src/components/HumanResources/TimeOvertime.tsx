/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HR Time & Overtime — manager-facing overtime, TOIL, history and cost analysis.
 *
 * DB-integrated via /api/hr-portal/overtime/* routes. Uses tables from
 * migration 421.
 *
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Clock,
  DollarSign,
  Calendar,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  TrendingUp,
  FileText,
  Download,
  Users,
  Loader2,
  Pencil,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge, Card } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';

type Tab = 'requests' | 'toil' | 'history' | 'analysis';

interface OvertimeRequest {
  id: string;
  employee_id: string;
  employee_name: string;
  department: string;
  type: string;
  overtime_date: string;
  start_time: string | null;
  end_time: string | null;
  hours: number;
  rate: string;
  reason: string | null;
  status: 'Pending' | 'Approved' | 'Rejected';
  reviewed_by: string | null;
  reviewed_at: string | null;
}

interface ToilRecord {
  id: string;
  employee_id: string;
  employee_name: string;
  department: string;
  hours_earned: number;
  hours_used: number;
  balance: number;
  expiry_date: string | null;
  status: 'Active' | 'Exhausted' | 'Expired';
}

interface OvertimeHistory {
  id: string;
  period: string;
  total_hours: number;
  total_cost: number;
  approvals: number;
  rejections: number;
}

interface LaborAnalysis {
  id: string;
  department: string;
  period: string;
  budget: number;
  actual: number;
  overtime_hours: number;
  overtime_cost: number;
}

interface Stats {
  pendingRequests: number;
  overtimeHoursMtd: string;
  overtimeCostMtd: string;
  toilBalance: string;
}

interface EmployeeOption {
  id: string;
  name: string;
  department: string;
  position: string;
  employee_number: string;
}

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'requests', label: 'Overtime Requests', icon: Clock },
  { id: 'toil', label: 'TOIL Management', icon: Calendar },
  { id: 'history', label: 'History', icon: FileText },
  { id: 'analysis', label: 'Cost Analysis', icon: TrendingUp },
];

const OT_TYPES = ['Regular Overtime', 'Weekend Work', 'Holiday Work', 'Night Shift', 'Emergency Coverage'];
const OT_RATES = ['1.0x', '1.25x', '1.5x', '2.0x'];
const TOIL_STATUSES = ['Active', 'Exhausted', 'Expired'];
const HISTORY_RANGES = ['All', '6months', '1year'];
const ANALYSIS_PERIODS = ['June 2024', 'May 2024', 'April 2024', 'March 2024'];
const STATUS_TONE: Record<string, statusTone.StatusTone> = { Pending: 'warning', Approved: 'success', Rejected: 'danger' };
const TOIL_TONE: Record<string, statusTone.StatusTone> = { Active: 'success', Exhausted: 'neutral', Expired: 'danger' };
const TYPE_TONE: Record<string, statusTone.StatusTone> = {
  'Holiday Work': 'danger',
  'Weekend Work': 'warning',
  'Night Shift': 'info',
  'Emergency Coverage': 'accent',
  'Regular Overtime': 'neutral',
};

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const inputCls = 'w-full px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 font-sans';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

const TimeOvertime = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [activeTab, setActiveTab] = useState<Tab>('requests');
  const [stats, setStats] = useState<Stats>({ pendingRequests: 0, overtimeHoursMtd: '0h', overtimeCostMtd: '$0', toilBalance: '0h' });
  const [requests, setRequests] = useState<OvertimeRequest[]>([]);
  const [toil, setToil] = useState<ToilRecord[]>([]);
  const [history, setHistory] = useState<OvertimeHistory[]>([]);
  const [analysis, setAnalysis] = useState<LaborAnalysis[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [historyRange, setHistoryRange] = useState('6months');
  const [analysisPeriod, setAnalysisPeriod] = useState('June 2024');

  const [otModal, setOtModal] = useState<{ mode: 'create' | 'edit'; r: OvertimeRequest | null } | null>(null);
  const [otForm, setOtForm] = useState({ employeeId: '', employeeName: '', department: 'Front Office', type: 'Regular Overtime', date: '', startTime: '', endTime: '', hours: 1, rate: '1.5x', reason: '' });

  const [toilModal, setToilModal] = useState<{ mode: 'create' | 'edit'; t: ToilRecord | null } | null>(null);
  const [toilForm, setToilForm] = useState({ employeeId: '', employeeName: '', department: 'Front Office', hoursEarned: 0, hoursUsed: 0, expiryDate: '', status: 'Active' });

  const fetchStats = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/overtime/statistics/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setStats(await res.json());
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchRequests = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'All') params.append('status', statusFilter);
      if (search.trim()) params.append('search', search.trim());
      const res = await fetch(`/api/hr-portal/overtime/requests/${currentPropertyId}?${params.toString()}`, { headers: authHeaders() });
      if (res.ok) setRequests(((await res.json()) as { requests: OvertimeRequest[] }).requests || []);
    } catch { /* non-fatal */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId, statusFilter, search]);

  const fetchToil = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/overtime/toil/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setToil(((await res.json()) as { toil: ToilRecord[] }).toil || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchHistory = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/overtime/history/${currentPropertyId}/${historyRange}`, { headers: authHeaders() });
      if (res.ok) setHistory(((await res.json()) as { history: OvertimeHistory[] }).history || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId, historyRange]);

  const fetchAnalysis = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/overtime/analysis/${currentPropertyId}/${encodeURIComponent(analysisPeriod)}`, { headers: authHeaders() });
      if (res.ok) setAnalysis(((await res.json()) as { analysis: LaborAnalysis[] }).analysis || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId, analysisPeriod]);

  const fetchEmployees = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/overtime/employees/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setEmployees(((await res.json()) as { employees: EmployeeOption[] }).employees || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchStats(), fetchRequests(), fetchToil(), fetchHistory(), fetchAnalysis(), fetchEmployees()]);
    setLoading(false);
  }, [fetchStats, fetchRequests, fetchToil, fetchHistory, fetchAnalysis, fetchEmployees]);

  useEffect(() => {
    if (currentPropertyId) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId]);

  useEffect(() => {
    if (currentPropertyId) { fetchRequests(); fetchStats(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, search]);

  useEffect(() => {
    if (currentPropertyId) fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyRange]);

  useEffect(() => {
    if (currentPropertyId) fetchAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisPeriod]);

  useEffect(() => {
    const emp = employees.find((e) => e.id === otForm.employeeId);
    if (emp) setOtForm((f) => ({ ...f, employeeName: emp.name, department: emp.department }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otForm.employeeId, employees]);

  useEffect(() => {
    const emp = employees.find((e) => e.id === toilForm.employeeId);
    if (emp) setToilForm((f) => ({ ...f, employeeName: emp.name, department: emp.department }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toilForm.employeeId, employees]);

  const openOtCreate = () => {
    const today = new Date().toISOString().slice(0, 10);
    setOtForm({ employeeId: '', employeeName: '', department: 'Front Office', type: 'Regular Overtime', date: today, startTime: '', endTime: '', hours: 1, rate: '1.5x', reason: '' });
    setOtModal({ mode: 'create', r: null });
  };

  const openOtEdit = (r: OvertimeRequest) => {
    setOtForm({
      employeeId: r.employee_id, employeeName: r.employee_name, department: r.department, type: r.type,
      date: r.overtime_date, startTime: r.start_time || '', endTime: r.end_time || '',
      hours: Number(r.hours), rate: r.rate, reason: r.reason || '',
    });
    setOtModal({ mode: 'edit', r });
  };

  const saveOt = async () => {
    if (!currentPropertyId || !otForm.employeeId || !otForm.date) return;
    setSaving(true);
    try {
      const body = {
        propertyId: currentPropertyId, employeeId: otForm.employeeId, employeeName: otForm.employeeName,
        department: otForm.department, type: otForm.type, date: otForm.date,
        startTime: otForm.startTime || null, endTime: otForm.endTime || null,
        hours: Number(otForm.hours), rate: otForm.rate, reason: otForm.reason.trim(),
      };
      const res = await fetch(otModal?.mode === 'create' ? '/api/hr-portal/overtime/requests' : `/api/hr-portal/overtime/requests/${otModal?.r?.id}`, {
        method: otModal?.mode === 'create' ? 'POST' : 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Overtime request saved', 'success', 'HR');
      setOtModal(null); refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const approveOt = async (r: OvertimeRequest, status: 'Approved' | 'Rejected') => {
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/overtime/requests/${r.id}/approve`, { method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ status }) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(`Overtime ${status.toLowerCase()}`, status === 'Approved' ? 'success' : 'danger', 'HR');
      refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const deleteOt = async (id: string) => {
    if (!confirm('Delete this overtime request?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/overtime/requests/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Overtime request deleted', 'success', 'HR');
      refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const openToilCreate = () => {
    const today = new Date().toISOString().slice(0, 10);
    setToilForm({ employeeId: '', employeeName: '', department: 'Front Office', hoursEarned: 0, hoursUsed: 0, expiryDate: '', status: 'Active' });
    setToilModal({ mode: 'create', t: null });
  };

  const openToilEdit = (t: ToilRecord) => {
    setToilForm({
      employeeId: t.employee_id, employeeName: t.employee_name, department: t.department,
      hoursEarned: Number(t.hours_earned), hoursUsed: Number(t.hours_used),
      expiryDate: t.expiry_date || '', status: t.status,
    });
    setToilModal({ mode: 'edit', t });
  };

  const saveToil = async () => {
    if (!currentPropertyId || !toilForm.employeeId) return;
    setSaving(true);
    try {
      const body = {
        propertyId: currentPropertyId, employeeId: toilForm.employeeId, employeeName: toilForm.employeeName,
        department: toilForm.department, hoursEarned: Number(toilForm.hoursEarned), hoursUsed: Number(toilForm.hoursUsed),
        expiryDate: toilForm.expiryDate || null, status: toilForm.status,
      };
      const res = await fetch(toilModal?.mode === 'create' ? '/api/hr-portal/overtime/toil' : `/api/hr-portal/overtime/toil/${toilModal?.t?.id}`, {
        method: toilModal?.mode === 'create' ? 'POST' : 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('TOIL record saved', 'success', 'HR');
      setToilModal(null); refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const deleteToil = async (id: string) => {
    if (!confirm('Delete this TOIL record?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/overtime/toil/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('TOIL record deleted', 'success', 'HR');
      refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const exportReport = () => {
    if (!currentPropertyId) return;
    window.open(`/api/hr-portal/overtime/export/${currentPropertyId}`, '_blank');
  };

  const totalVariance = useMemo(() => analysis.reduce((s, a) => s + (Number(a.actual) - Number(a.budget)), 0), [analysis]);

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Time & Overtime" subtitle="Manage overtime requests, TOIL, and labor cost analysis" icon={Clock} />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Clock className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">Select a property to view overtime data.</p>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Time & Overtime"
        subtitle="Manage overtime requests, TOIL, and labor cost analysis"
        icon={Clock}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refresh} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={exportReport} className={button.secondary}><Download className="w-4 h-4" /> Export</button>
            <button onClick={openOtCreate} className={button.primary}><Plus className="w-4 h-4" /> New Request</button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Pending Requests" value={stats.pendingRequests} icon={Clock} tone="warning" />
        <StatCard title="Overtime Hours (MTD)" value={stats.overtimeHoursMtd} icon={TrendingUp} tone="accent" />
        <StatCard title="Overtime Cost (MTD)" value={stats.overtimeCostMtd} icon={DollarSign} tone="success" />
        <StatCard title="TOIL Balance" value={stats.toilBalance} icon={Calendar} tone="info" />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${
              activeTab === tab.id ? 'bg-white dark:bg-slate-700 text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <tab.icon size={14} /> {tab.label}
          </button>
        ))}
      </div>

      {/* Overtime Requests */}
      {activeTab === 'requests' && (
        <SectionCard pad="none">
          <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex flex-col md:flex-row md:items-center gap-4 justify-between">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Overtime Requests</h3>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                <input
                  type="text"
                  placeholder="Search requests..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-48 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
                />
              </div>
              <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2">
                <Filter size={14} className="text-slate-400" />
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-transparent text-xs text-slate-700 dark:text-slate-300 outline-none">
                  {['All', 'Pending', 'Approved', 'Rejected'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
          ) : requests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Clock className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No overtime requests found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Employee</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Type</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Date</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Hours</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Rate</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Reason</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Status</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {requests.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4">
                        <div>
                          <span className="text-sm font-semibold text-slate-900 dark:text-white block">{r.employee_name}</span>
                          <span className="text-xs font-medium text-slate-500">{r.department}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4"><Badge tone={TYPE_TONE[r.type] ?? 'neutral'}>{r.type}</Badge></td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500">{r.overtime_date}</td>
                      <td className="px-6 py-4 text-center text-xs font-bold text-slate-900 dark:text-white">{r.hours}h</td>
                      <td className="px-6 py-4 text-center"><Badge tone="neutral">{r.rate}</Badge></td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500 max-w-xs truncate">{r.reason || '—'}</td>
                      <td className="px-6 py-4 text-center"><Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge></td>
                      <td className="px-6 py-4">
                        <div className="flex justify-center gap-2">
                          {r.status === 'Pending' && (
                            <>
                              <button onClick={() => approveOt(r, 'Approved')} disabled={saving} className="p-1.5 bg-emerald-500 text-white rounded-lg hover:shadow-md transition"><CheckCircle2 size={14} /></button>
                              <button onClick={() => approveOt(r, 'Rejected')} disabled={saving} className="p-1.5 bg-rose-500 text-white rounded-lg hover:shadow-md transition"><XCircle size={14} /></button>
                            </>
                          )}
                          <button onClick={() => openOtEdit(r)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                          <button onClick={() => deleteOt(r.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* TOIL Management */}
      {activeTab === 'toil' && (
        <SectionCard pad="none">
          <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Time-Off in Lieu (TOIL)</h3>
            <button onClick={openToilCreate} className={button.primary + ' text-xs'}><Plus size={14} /> Process TOIL</button>
          </div>
          {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : toil.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Calendar className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No TOIL records found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Employee</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Department</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Earned</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Used</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Balance</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Expiry Date</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Status</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {toil.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4 text-sm font-semibold text-slate-900 dark:text-white">{t.employee_name}</td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500">{t.department}</td>
                      <td className="px-6 py-4 text-center text-xs font-bold text-slate-900 dark:text-white">{t.hours_earned}h</td>
                      <td className="px-6 py-4 text-center text-xs font-bold text-slate-900 dark:text-white">{t.hours_used}h</td>
                      <td className="px-6 py-4 text-center"><Badge tone={t.balance > 0 ? 'success' : 'neutral'}>{t.balance}h</Badge></td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500">{t.expiry_date || '—'}</td>
                      <td className="px-6 py-4 text-center"><Badge tone={TOIL_TONE[t.status]}>{t.status}</Badge></td>
                      <td className="px-6 py-4">
                        <div className="flex justify-center gap-2">
                          <button onClick={() => openToilEdit(t)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                          <button onClick={() => deleteToil(t.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* History */}
      {activeTab === 'history' && (
        <SectionCard pad="none">
          <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Overtime History</h3>
            <select value={historyRange} onChange={(e) => setHistoryRange(e.target.value)} className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs outline-none">
              {HISTORY_RANGES.map((r) => <option key={r} value={r}>{r === '6months' ? 'Last 6 Months' : r === '1year' ? 'Last Year' : r}</option>)}
            </select>
          </div>
          {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <FileText className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No history records found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Period</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Total Hours</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-right">Total Cost</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Approvals</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Rejections</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {history.map((h) => (
                    <tr key={h.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4 text-sm font-semibold text-slate-900 dark:text-white">{h.period}</td>
                      <td className="px-6 py-4 text-center text-xs font-bold text-slate-900 dark:text-white">{h.total_hours}h</td>
                      <td className="px-6 py-4 text-right text-xs font-bold text-slate-900 dark:text-white">${Number(h.total_cost).toLocaleString()}</td>
                      <td className="px-6 py-4 text-center text-xs font-bold text-emerald-600">{h.approvals}</td>
                      <td className="px-6 py-4 text-center text-xs font-bold text-rose-600">{h.rejections}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* Cost Analysis */}
      {activeTab === 'analysis' && (
        <SectionCard pad="none">
          <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex flex-col md:flex-row md:items-center gap-4 justify-between">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Labor Cost Analysis</h3>
            <select value={analysisPeriod} onChange={(e) => setAnalysisPeriod(e.target.value)} className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs outline-none">
              {ANALYSIS_PERIODS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : analysis.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <TrendingUp className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No analysis data found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Department</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-right">Budget</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-right">Actual</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-right">Variance</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">OT Hours</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-right">OT Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {analysis.map((a) => {
                    const variance = Number(a.actual) - Number(a.budget);
                    return (
                      <tr key={a.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-indigo-50 dark:bg-indigo-500/20 rounded-lg flex items-center justify-center">
                              <Users className="text-indigo-600 dark:text-indigo-400" size={14} />
                            </div>
                            <span className="text-sm font-semibold text-slate-900 dark:text-white">{a.department}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right text-sm font-medium text-slate-500">${Number(a.budget).toLocaleString()}</td>
                        <td className="px-6 py-4 text-right text-xs font-bold text-slate-900 dark:text-white">${Number(a.actual).toLocaleString()}</td>
                        <td className="px-6 py-4 text-right">
                          <span className={`text-xs font-medium ${variance >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {variance >= 0 ? '+' : ''}${variance.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center text-xs font-bold text-slate-900 dark:text-white">{a.overtime_hours}h</td>
                        <td className="px-6 py-4 text-right text-xs font-bold text-slate-900 dark:text-white">${Number(a.overtime_cost).toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {analysis.length > 0 && (
            <div className="px-6 py-4 border-t border-slate-50 dark:border-slate-800 flex justify-end">
              <span className={`text-sm font-semibold ${totalVariance >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                Total Variance: {totalVariance >= 0 ? '+' : ''}${totalVariance.toLocaleString()}
              </span>
            </div>
          )}
        </SectionCard>
      )}

      {/* Overtime Request Modal */}
      <ModalSystem
        isOpen={!!otModal}
        onClose={() => setOtModal(null)}
        onConfirm={saveOt}
        title={otModal?.mode === 'create' ? 'New Overtime Request' : 'Edit Overtime Request'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Employee">
              <select className={inputCls} value={otForm.employeeId} onChange={(e) => setOtForm(f => ({ ...f, employeeId: e.target.value }))}>
                <option value="">Select employee</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.employee_number}) — {e.department}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Type">
            <select className={inputCls} value={otForm.type} onChange={(e) => setOtForm(f => ({ ...f, type: e.target.value }))}>
              {OT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Date"><input type="date" className={inputCls} value={otForm.date} onChange={(e) => setOtForm(f => ({ ...f, date: e.target.value }))} /></Field>
          <Field label="Start Time"><input type="time" className={inputCls} value={otForm.startTime} onChange={(e) => setOtForm(f => ({ ...f, startTime: e.target.value }))} /></Field>
          <Field label="End Time"><input type="time" className={inputCls} value={otForm.endTime} onChange={(e) => setOtForm(f => ({ ...f, endTime: e.target.value }))} /></Field>
          <Field label="Hours"><input type="number" step="0.5" min={0.5} className={inputCls} value={otForm.hours} onChange={(e) => setOtForm(f => ({ ...f, hours: Number(e.target.value) }))} /></Field>
          <Field label="Rate">
            <select className={inputCls} value={otForm.rate} onChange={(e) => setOtForm(f => ({ ...f, rate: e.target.value }))}>
              {OT_RATES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <div className="col-span-2"><Field label="Reason"><textarea className={inputCls} rows={3} value={otForm.reason} onChange={(e) => setOtForm(f => ({ ...f, reason: e.target.value }))} /></Field></div>
        </div>
      </ModalSystem>

      {/* TOIL Modal */}
      <ModalSystem
        isOpen={!!toilModal}
        onClose={() => setToilModal(null)}
        onConfirm={saveToil}
        title={toilModal?.mode === 'create' ? 'Process TOIL' : 'Edit TOIL'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Employee">
              <select className={inputCls} value={toilForm.employeeId} onChange={(e) => setToilForm(f => ({ ...f, employeeId: e.target.value }))}>
                <option value="">Select employee</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.employee_number}) — {e.department}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Hours Earned"><input type="number" step="0.5" min={0} className={inputCls} value={toilForm.hoursEarned} onChange={(e) => setToilForm(f => ({ ...f, hoursEarned: Number(e.target.value) }))} /></Field>
          <Field label="Hours Used"><input type="number" step="0.5" min={0} className={inputCls} value={toilForm.hoursUsed} onChange={(e) => setToilForm(f => ({ ...f, hoursUsed: Number(e.target.value) }))} /></Field>
          <Field label="Expiry Date"><input type="date" className={inputCls} value={toilForm.expiryDate} onChange={(e) => setToilForm(f => ({ ...f, expiryDate: e.target.value }))} /></Field>
          <Field label="Status">
            <select className={inputCls} value={toilForm.status} onChange={(e) => setToilForm(f => ({ ...f, status: e.target.value }))}>
              {TOIL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
      </ModalSystem>
    </div>
  );
};

export default TimeOvertime;
