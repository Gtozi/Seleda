/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HR Leave Management — manager-facing leave requests and balance monitoring.
 *
 * DB-integrated via /api/hr-portal/leave/* routes. Reuses hr_leave_requests
 * and hr_leave_balances tables from migration 420.
 *
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, UserCheck, Clock, CheckCircle2, XCircle, Search, Filter, History, Target, Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge, Card } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';

interface LeaveRequest {
  id: string;
  employee_id: string;
  employee_name: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
  status: 'Pending' | 'Approved' | 'Rejected';
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface LeaveBalance {
  employee_id: string;
  employee_name: string;
  department: string;
  leave_type: string;
  total_days: number;
  used_days: number;
}

interface Stats {
  activeOnLeave: number;
  pendingApplications: number;
  sickLeaves: number;
  leaveUtilization: number;
}

interface EmployeeOption {
  id: string;
  name: string;
  department: string;
  position: string;
  employee_number: string;
}

const LEAVE_TYPES = ['Annual', 'Sick', 'Emergency', 'Paternity', 'Maternity', 'Compensatory', 'Unpaid'];
const STATUS_OPTIONS = ['All', 'Pending', 'Approved', 'Rejected'];
const DEPARTMENTS = ['All', 'Front Office', 'Housekeeping', 'Food & Beverage', 'Engineering', 'Security'];

const STATUS_TONE: Record<string, statusTone.StatusTone> = { Pending: 'warning', Approved: 'success', Rejected: 'danger' };

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const inputCls = 'w-full px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 font-sans';

function formatRange(start: string, end: string) {
  return start === end ? start : `${start} - ${end}`;
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffDays(start: string, end: string): number {
  const a = new Date(start + 'T00:00:00');
  const b = new Date(end + 'T00:00:00');
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

function initials(name: string) {
  return name?.split(' ').filter(Boolean).map((n) => n[0]).join('').slice(0, 2).toUpperCase() || '—';
}

function timeAgo(iso: string) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

const LeaveManagement = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [stats, setStats] = useState<Stats>({ activeOnLeave: 0, pendingApplications: 0, sickLeaves: 0, leaveUtilization: 0 });
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('All');

  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; r: LeaveRequest | null } | null>(null);
  const [form, setForm] = useState({
    employeeId: '', employeeName: '', leaveType: 'Annual', startDate: '', endDate: '', days: 1, reason: '',
  });

  const fetchStats = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/leave/statistics/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setStats(await res.json());
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchRequests = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'All') params.append('status', statusFilter);
      if (search.trim()) params.append('search', search.trim());
      const res = await fetch(`/api/hr-portal/leave/requests/${currentPropertyId}?${params.toString()}`, { headers: authHeaders() });
      if (res.ok) setRequests(((await res.json()) as { requests: LeaveRequest[] }).requests || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId, statusFilter, search]);

  const fetchBalances = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const dept = departmentFilter !== 'All' ? `/${encodeURIComponent(departmentFilter)}` : '';
      const res = await fetch(`/api/hr-portal/leave/balances/${currentPropertyId}${dept}`, { headers: authHeaders() });
      if (res.ok) setBalances(((await res.json()) as { balances: LeaveBalance[] }).balances || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId, departmentFilter]);

  const fetchEmployees = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/leave/employees/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setEmployees(((await res.json()) as { employees: EmployeeOption[] }).employees || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchStats(), fetchRequests(), fetchBalances(), fetchEmployees()]);
    setLoading(false);
  }, [fetchStats, fetchRequests, fetchBalances, fetchEmployees]);

  useEffect(() => {
    if (currentPropertyId) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId]);

  useEffect(() => {
    if (currentPropertyId) { fetchRequests(); fetchStats(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, search]);

  useEffect(() => {
    if (currentPropertyId) fetchBalances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentFilter]);

  useEffect(() => {
    const emp = employees.find((e) => e.id === form.employeeId);
    if (emp) setForm((f) => ({ ...f, employeeName: emp.name }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.employeeId, employees]);

  useEffect(() => {
    if (form.startDate && form.endDate) {
      setForm((f) => ({ ...f, days: diffDays(f.startDate, f.endDate) }));
    }
  }, [form.startDate, form.endDate]);

  const openCreate = () => {
    const today = new Date().toISOString().slice(0, 10);
    setForm({ employeeId: '', employeeName: '', leaveType: 'Annual', startDate: today, endDate: today, days: 1, reason: '' });
    setModal({ mode: 'create', r: null });
  };

  const openEdit = (r: LeaveRequest) => {
    setForm({
      employeeId: r.employee_id, employeeName: r.employee_name, leaveType: r.leave_type,
      startDate: r.start_date, endDate: r.end_date, days: Number(r.days), reason: r.reason || '',
    });
    setModal({ mode: 'edit', r });
  };

  const save = async () => {
    if (!currentPropertyId || !form.employeeId || !form.startDate || !form.endDate) return;
    setSaving(true);
    try {
      const body = {
        propertyId: currentPropertyId,
        employeeId: form.employeeId,
        employeeName: form.employeeName,
        leaveType: form.leaveType,
        startDate: form.startDate,
        endDate: form.endDate,
        days: Number(form.days),
        reason: form.reason.trim(),
      };
      const res = await fetch(modal?.mode === 'create' ? '/api/hr-portal/leave/requests' : `/api/hr-portal/leave/requests/${modal?.r?.id}`, {
        method: modal?.mode === 'create' ? 'POST' : 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Leave request saved', 'success', 'HR');
      setModal(null); refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const approve = async (r: LeaveRequest, status: 'Approved' | 'Rejected') => {
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/leave/requests/${r.id}/approve`, { method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ status }) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(`Leave ${status.toLowerCase()}`, status === 'Approved' ? 'success' : 'danger', 'HR');
      refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const deleteRequest = async (id: string) => {
    if (!confirm('Delete this leave request?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/leave/requests/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Leave request deleted', 'success', 'HR');
      refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  // Department accrual aggregation from balances
  const accruals = useMemo(() => {
    const map: Record<string, { current: number; max: number }> = {};
    balances.forEach((b) => {
      if (!map[b.department]) map[b.department] = { current: 0, max: 0 };
      map[b.department].max += Number(b.total_days) || 0;
      map[b.department].current += Number(b.used_days) || 0;
    });
    return Object.entries(map).map(([dept, v]) => ({ dept, ...v })).sort((a, b) => b.current - a.current);
  }, [balances]);

  // Recent audit-ish events: approved/rejected requests sorted by updated_at
  const history = useMemo(() => {
    return [...requests]
      .filter((r) => r.status !== 'Pending' || r.updated_at !== r.created_at)
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 8);
  }, [requests]);

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Leave Management" subtitle="Track and approve staff leave requests" icon={Calendar} />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Calendar className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">Select a property to view leave data.</p>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Leave Management"
        subtitle="Track and approve staff leave requests"
        icon={Calendar}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refresh} className={button.ghost}><Calendar className="w-4 h-4" /> Refresh</button>
            <button onClick={openCreate} className={button.primary}><Plus className="w-4 h-4" /> New Request</button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Active on Leave" value={stats.activeOnLeave} caption="Today" icon={UserCheck} tone="accent" />
        <StatCard title="Pending Apps" value={stats.pendingApplications} caption="Needs Review" icon={Clock} tone="warning" />
        <StatCard title="Sick Leaves" value={stats.sickLeaves} caption="Last 30 days" icon={Calendar} tone="danger" />
        <StatCard title="Leave Utilization" value={`${stats.leaveUtilization}%`} caption="Avg per Dept" icon={Target} tone="success" />
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        {/* Leave Registry */}
        <div className="lg:col-span-8">
          <SectionCard pad="none">
            <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex flex-col md:flex-row md:items-center gap-4 justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">Personnel Leave Registry</h3>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                  <input
                    type="text"
                    placeholder="Search employee..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-40 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
                  />
                </div>
                <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2">
                  <Filter size={14} className="text-slate-400" />
                  <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-transparent text-xs text-slate-700 dark:text-slate-300 outline-none">
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
            ) : requests.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <Calendar className="w-8 h-8 mb-2 opacity-40" />
                <p className="text-sm">No leave requests found.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                      <th className="px-6 py-4 text-xs font-medium text-slate-500">Employee</th>
                      <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Leave Period</th>
                      <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Days</th>
                      <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Status</th>
                      <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                    {requests.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-xs font-medium text-slate-600 dark:text-slate-300">
                              {initials(r.employee_name)}
                            </div>
                            <div>
                              <span className="text-sm font-semibold text-slate-900 dark:text-white block leading-none mb-1">{r.employee_name}</span>
                              <span className="text-xs font-medium text-slate-500">{r.leave_type}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center text-sm font-medium text-slate-600 dark:text-slate-300">{formatRange(r.start_date, r.end_date)}</td>
                        <td className="px-6 py-4 text-center">
                          <div className="flex flex-col items-center">
                            <span className="text-sm font-medium text-slate-900 dark:text-white">{r.days}</span>
                            <span className="text-xs font-medium text-slate-400">days</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center"><Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge></td>
                        <td className="px-6 py-4">
                          <div className="flex justify-center gap-2">
                            {r.status === 'Pending' && (
                              <>
                                <button onClick={() => approve(r, 'Approved')} disabled={saving} className="p-1.5 bg-emerald-500 text-white rounded-lg hover:shadow-md transition"><CheckCircle2 size={14} /></button>
                                <button onClick={() => approve(r, 'Rejected')} disabled={saving} className="p-1.5 bg-rose-500 text-white rounded-lg hover:shadow-md transition"><XCircle size={14} /></button>
                              </>
                            )}
                            <button onClick={() => openEdit(r)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                            <button onClick={() => deleteRequest(r.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>

        {/* Sidebar */}
        <div className="lg:col-span-4 space-y-6">
          {/* Accrual card */}
          <Card pad="md" className="bg-indigo-600 border-indigo-600 text-white">
            <h4 className="text-sm font-medium mb-4 opacity-80">Quick Accrual Check</h4>
            <div className="space-y-5">
              {accruals.slice(0, 5).map((d) => {
                const pct = d.max > 0 ? Math.round((d.current / d.max) * 100) : 0;
                return (
                  <div key={d.dept}>
                    <div className="flex justify-between text-sm font-medium mb-1.5">
                      <span>{d.dept}</span>
                      <span className="opacity-90">{d.current} / {d.max} <span className="text-xs opacity-70">({pct}%)</span></span>
                    </div>
                    <div className="h-2 w-full bg-white/20 rounded-full overflow-hidden">
                      <div className="h-full bg-white rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              {accruals.length === 0 && <p className="text-sm opacity-80">No balance data.</p>}
            </div>
          </Card>

          {/* Leave Balances */}
          <Card pad="md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">Leave Balances</h3>
              <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} className="px-2 py-1.5 bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-lg text-xs outline-none">
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            {balances.length === 0 ? (
              <p className="text-sm text-slate-400">No balances found.</p>
            ) : (
              <div className="space-y-5">
                {balances.map((b) => {
                  const remaining = Math.max(0, Number(b.total_days) - Number(b.used_days));
                  const pct = b.total_days > 0 ? (remaining / b.total_days) * 100 : 0;
                  return (
                    <div key={`${b.employee_id}-${b.leave_type}`} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">{b.employee_name}</p>
                          <p className="text-xs text-slate-500">{b.leave_type}</p>
                        </div>
                        <span className="text-xs font-semibold tabular-nums">
                          <span className={remaining < 3 ? 'text-rose-500' : 'text-emerald-500'}>{remaining}</span>
                          <span className="text-slate-400"> / {b.total_days} left</span>
                        </span>
                      </div>
                      <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${remaining < 3 ? 'bg-rose-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Leave History Audit */}
          <Card pad="md">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4">Leave History Audit</h3>
            <div className="space-y-4">
              {history.length === 0 ? (
                <p className="text-sm text-slate-400">No recent activity.</p>
              ) : (
                history.map((h) => (
                  <div key={h.id} className="flex justify-between items-start gap-3 group">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-8 h-8 bg-slate-50 dark:bg-slate-800 rounded-xl flex items-center justify-center text-slate-400 shrink-0">
                        <History size={14} />
                      </div>
                      <div className="min-w-0">
                        <span className="text-sm font-semibold text-slate-900 dark:text-white block leading-tight truncate">{h.employee_name}</span>
                        <span className="text-xs text-slate-500 block truncate">
                          {h.reviewed_by ? `${h.status} by ${h.reviewed_by}` : h.status}
                          {' • '}{timeAgo(h.updated_at)}
                        </span>
                      </div>
                    </div>
                    <Badge tone={STATUS_TONE[h.status]} className="shrink-0">{h.status}</Badge>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Modal */}
      <ModalSystem
        isOpen={!!modal}
        onClose={() => setModal(null)}
        onConfirm={save}
        title={modal?.mode === 'create' ? 'New Leave Request' : 'Edit Leave Request'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block">
              <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Employee</span>
              <select className={inputCls} value={form.employeeId} onChange={(e) => setForm(f => ({ ...f, employeeId: e.target.value }))}>
                <option value="">Select employee</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.employee_number}) — {e.department}</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Leave Type</span>
            <select className={inputCls} value={form.leaveType} onChange={(e) => setForm(f => ({ ...f, leaveType: e.target.value }))}>
              {LEAVE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Days</span>
            <input type="number" min={1} className={inputCls} value={form.days} onChange={(e) => setForm(f => ({ ...f, days: Number(e.target.value) }))} />
          </label>
          <label className="block">
            <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Start Date</span>
            <input type="date" className={inputCls} value={form.startDate} onChange={(e) => setForm(f => ({ ...f, startDate: e.target.value }))} />
          </label>
          <label className="block">
            <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">End Date</span>
            <input type="date" className={inputCls} value={form.endDate} onChange={(e) => setForm(f => ({ ...f, endDate: e.target.value }))} />
          </label>
          <label className="col-span-2 block">
            <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Reason</span>
            <textarea className={inputCls} rows={3} value={form.reason} onChange={(e) => setForm(f => ({ ...f, reason: e.target.value }))} />
          </label>
        </div>
      </ModalSystem>
    </div>
  );
};

export default LeaveManagement;
