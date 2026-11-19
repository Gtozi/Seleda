/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HR Payroll Engine — manager-facing payroll runs, payslips, and statistics.
 *
 * DB-integrated via /api/hr-portal/payroll/* routes. Uses payroll_runs and
 * payslips tables (migration 422 seeds data).
 *
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw,
  Plus,
  Eye,
  Calculator,
  CheckCircle2,
  DollarSign,
  Users,
  TrendingDown,
  Loader2,
  ArrowLeft,
  Printer,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';
import PayslipViewer from './PayslipViewer';

interface PayrollRun {
  id: string;
  period: string;
  run_date: string;
  status: 'Draft' | 'Calculated' | 'Approved' | 'Posted' | 'Reversed';
  total_gross: number;
  total_tax: number;
  total_pension_employee: number;
  total_pension_employer: number;
  total_deductions: number;
  total_net: number;
  employee_count: number;
  approved_by: string | null;
  approved_at: string | null;
  posted_by: string | null;
  posted_at: string | null;
  created_at: string;
}

interface Payslip {
  id: string;
  payroll_run_id: string;
  employee_id: string;
  period: string;
  basic_salary: number;
  allowances: number;
  overtime: number;
  gross_pay: number;
  income_tax: number;
  pension_employee: number;
  pension_employer: number;
  loan_deduction: number;
  other_deductions: number;
  total_deductions: number;
  net_pay: number;
  ytd_gross: number;
  ytd_tax: number;
  ytd_pension: number;
  ytd_net: number;
  status: string;
  paid_at: string | null;
  employees?: { name: string; email: string; phone: string; department: string; position: string; bank_account: string; pension_number: string };
  payroll_runs?: { period: string; status: string };
}

interface Employee {
  id: string;
  name: string;
  email: string;
  phone: string;
  department: string;
  position: string;
  status: string;
  hire_date: string;
  salary: number;
  basic_salary: number;
  allowance_amount: number;
  overtime_rate: number;
  bank_account: string;
  pension_number: string;
}

interface Stats {
  ytdGross: number;
  ytdNet: number;
  ytdTax: number;
  ytdPension: number;
  runCount: number;
  pendingRuns: number;
  latestPeriod: string;
  latestStatus: string;
  latestNet: number;
  latestGross: number;
  latestEmployeeCount: number;
}

const RUN_STATUS_TONE: Record<string, statusTone.StatusTone> = {
  Draft: 'neutral',
  Calculated: 'warning',
  Approved: 'accent',
  Posted: 'success',
  Reversed: 'danger',
};

const PAYSLIP_STATUS_TONE: Record<string, statusTone.StatusTone> = {
  Calculated: 'warning',
  Approved: 'accent',
  Paid: 'success',
  Pending: 'warning',
};

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const fmt = (n: number) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const inputCls = 'w-full px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 font-sans';

const PayrollEngine = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [stats, setStats] = useState<Stats>({ ytdGross: 0, ytdNet: 0, ytdTax: 0, ytdPension: 0, runCount: 0, pendingRuns: 0, latestPeriod: '—', latestStatus: '—', latestNet: 0, latestGross: 0, latestEmployeeCount: 0 });
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [payslipsLoading, setPayslipsLoading] = useState(false);
  const [selectedRun, setSelectedRun] = useState<PayrollRun | null>(null);
  const [selectedPayslip, setSelectedPayslip] = useState<Payslip | null>(null);
  const [showNewRun, setShowNewRun] = useState(false);
  const [statusFilter, setStatusFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [newRun, setNewRun] = useState({
    period: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
    selectedEmployees: [] as string[],
  });

  const fetchStats = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/payroll/statistics/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setStats(await res.json());
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchRuns = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'All') params.append('status', statusFilter);
      const res = await fetch(`/api/hr-portal/payroll/runs/${currentPropertyId}?${params.toString()}`, { headers: authHeaders() });
      if (res.ok) setRuns(((await res.json()) as { runs: PayrollRun[] }).runs || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId, statusFilter]);

  const fetchEmployees = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/payroll/employees/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setEmployees(((await res.json()) as { employees: Employee[] }).employees || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchPayslips = useCallback(async (runId: string) => {
    setPayslipsLoading(true);
    try {
      const res = await fetch(`/api/hr-portal/payroll/runs/${runId}/payslips`, { headers: authHeaders() });
      if (res.ok) setPayslips(((await res.json()) as { payslips: Payslip[] }).payslips || []);
    } catch { /* non-fatal */ } finally { setPayslipsLoading(false); }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchStats(), fetchRuns(), fetchEmployees()]);
    setLoading(false);
  }, [fetchStats, fetchRuns, fetchEmployees]);

  useEffect(() => {
    if (currentPropertyId) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId]);

  useEffect(() => {
    if (currentPropertyId) { fetchRuns(); fetchStats(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const filteredRuns = useMemo(() => {
    if (!search.trim()) return runs;
    const q = search.toLowerCase();
    return runs.filter((r) => r.period.toLowerCase().includes(q) || r.status.toLowerCase().includes(q));
  }, [runs, search]);

  const filteredPayslips = useMemo(() => {
    if (!search.trim()) return payslips;
    const q = search.toLowerCase();
    return payslips.filter((p) =>
      (p.employees?.name || '').toLowerCase().includes(q) ||
      (p.employees?.department || '').toLowerCase().includes(q) ||
      p.period.toLowerCase().includes(q) ||
      p.status.toLowerCase().includes(q)
    );
  }, [payslips, search]);

  const handleViewRun = async (run: PayrollRun) => {
    setSelectedRun(run);
    await fetchPayslips(run.id);
  };

  const handleBackToRuns = () => {
    setSelectedRun(null);
    setPayslips([]);
    setSearch('');
  };

  const handleCreateRun = async () => {
    if (!currentPropertyId || !newRun.period) return;
    setSaving(true);
    try {
      const body = {
        propertyId: currentPropertyId,
        period: newRun.period,
        employeeIds: newRun.selectedEmployees.length > 0 ? newRun.selectedEmployees : undefined,
      };
      const res = await fetch('/api/hr-portal/payroll/runs', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      const result = await res.json();
      addNotification(`Payroll run created: ${result.employeeCount} employees, $${fmt(result.totalNet)} net`, 'success', 'HR');
      setShowNewRun(false);
      setNewRun({ period: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`, selectedEmployees: [] });
      refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const handlePostToFinance = async (run: PayrollRun) => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/finance/post-payroll/${run.id}`, { method: 'POST', headers: authHeaders(true) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      const result = await res.json();
      addNotification(`Posted to finance: JE ${result.journalEntryId}`, 'success', 'HR');
      refresh();
      if (selectedRun?.id === run.id) setSelectedRun({ ...run, status: 'Posted' });
    } catch (e: any) { addNotification(e?.message || 'Post failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const handleReverseFinance = async (run: PayrollRun) => {
    if (!confirm(`Reverse the journal entry for payroll run ${run.period}? This will un-post the run back to Approved.`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/finance/reverse-payroll/${run.id}`, { method: 'POST', headers: authHeaders(true) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      const result = await res.json();
      addNotification(`Journal reversed: ${result.reversedEntryId}`, 'success', 'HR');
      refresh();
      if (selectedRun?.id === run.id) setSelectedRun({ ...run, status: 'Approved' });
    } catch (e: any) { addNotification(e?.message || 'Reverse failed', 'warning', 'HR'); } finally { setSaving(false); }
  };

  const handleStatusUpdate = async (run: PayrollRun, status: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/payroll/runs/${run.id}`, {
        method: 'PATCH',
        headers: authHeaders(true),
        body: JSON.stringify({ status }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(`Payroll run ${status.toLowerCase()}`, 'success', 'HR');
      refresh();
      if (selectedRun?.id === run.id) {
        setSelectedRun({ ...run, status: status as PayrollRun['status'] });
      }
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const toggleEmployee = (empId: string) => {
    setNewRun((prev) => ({
      ...prev,
      selectedEmployees: prev.selectedEmployees.includes(empId)
        ? prev.selectedEmployees.filter((id) => id !== empId)
        : [...prev.selectedEmployees, empId],
    }));
  };

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Payroll Engine" subtitle="Run payroll, review payslips, and post to GL" icon={DollarSign} />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <DollarSign className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">Select a property to view payroll data.</p>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Payroll Engine"
        subtitle="Run payroll, review payslips, and post to GL"
        icon={DollarSign}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refresh} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            {selectedRun && (
              <button onClick={handleBackToRuns} className={button.ghost}><ArrowLeft className="w-4 h-4" /> Back to Runs</button>
            )}
            {!selectedRun && (
              <button onClick={() => setShowNewRun(true)} className={button.primary}><Plus className="w-4 h-4" /> New Payroll Run</button>
            )}
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="YTD Gross" value={`$${fmt(stats.ytdGross)}`} caption={`${stats.runCount} runs`} icon={DollarSign} tone="accent" />
        <StatCard title="YTD Net Pay" value={`$${fmt(stats.ytdNet)}`} caption="Total disbursed" icon={CheckCircle2} tone="success" />
        <StatCard title="YTD Tax" value={`$${fmt(stats.ytdTax)}`} caption="Income tax withheld" icon={TrendingDown} tone="warning" />
        <StatCard title="Pending Runs" value={stats.pendingRuns} caption="Awaiting approval" icon={Calculator} tone="danger" />
      </div>

      {/* Selected Run Summary */}
      {selectedRun && (
        <div className={layout.kpiGrid}>
          <StatCard title="Run Gross" value={`$${fmt(Number(selectedRun.total_gross) || 0)}`} caption={selectedRun.period} icon={DollarSign} tone="accent" />
          <StatCard title="Run Tax" value={`$${fmt(Number(selectedRun.total_tax) || 0)}`} icon={TrendingDown} tone="warning" />
          <StatCard title="Run Pension" value={`$${fmt(Number(selectedRun.total_pension_employee) || 0)}`} caption="Employee share" icon={Users} tone="danger" />
          <StatCard title="Run Net Pay" value={`$${fmt(Number(selectedRun.total_net) || 0)}`} caption={`${selectedRun.employee_count} employees`} icon={CheckCircle2} tone="success" />
        </div>
      )}

      {/* Runs Table */}
      {!selectedRun && (
        <SectionCard pad="none">
          <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex flex-col md:flex-row md:items-center gap-4 justify-between">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Payroll Runs</h3>
            <div className="flex items-center gap-2">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search period or status..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-4 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-48 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
                />
              </div>
              <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2">
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-transparent text-xs text-slate-700 dark:text-slate-300 outline-none">
                  {['All', 'Draft', 'Calculated', 'Approved', 'Posted', 'Reversed'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
          ) : filteredRuns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <DollarSign className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No payroll runs found. Click New Payroll Run to create one.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Period</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Employees</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-right">Gross</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-right">Tax</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-right">Pension (Emp)</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-right">Net Pay</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Status</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {filteredRuns.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4 text-sm font-semibold text-slate-900 dark:text-white">{r.period}</td>
                      <td className="px-6 py-4 text-center text-xs font-medium text-slate-500">{r.employee_count}</td>
                      <td className="px-6 py-4 text-right text-xs font-mono text-slate-900 dark:text-white">${fmt(Number(r.total_gross) || 0)}</td>
                      <td className="px-6 py-4 text-right text-xs font-mono text-amber-600">${fmt(Number(r.total_tax) || 0)}</td>
                      <td className="px-6 py-4 text-right text-xs font-mono text-rose-600">${fmt(Number(r.total_pension_employee) || 0)}</td>
                      <td className="px-6 py-4 text-right text-xs font-medium font-mono text-emerald-600">${fmt(Number(r.total_net) || 0)}</td>
                      <td className="px-6 py-4 text-center"><Badge tone={RUN_STATUS_TONE[r.status] ?? 'neutral'}>{r.status}</Badge></td>
                      <td className="px-6 py-4">
                        <div className="flex justify-center gap-2">
                          <button onClick={() => handleViewRun(r)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition" title="View Payslips"><Eye size={14} className="text-slate-400" /></button>
                          {r.status === 'Calculated' && (
                            <button onClick={() => handleStatusUpdate(r, 'Approved')} disabled={saving} className="p-1.5 bg-indigo-500 text-white rounded-lg hover:shadow-md transition" title="Approve"><CheckCircle2 size={14} /></button>
                          )}
                          {r.status === 'Approved' && (
                            <button onClick={() => handlePostToFinance(r)} disabled={saving} className="p-1.5 bg-emerald-500 text-white rounded-lg hover:shadow-md transition" title="Post to GL"><DollarSign size={14} /></button>
                          )}
                          {r.status === 'Posted' && (
                            <button onClick={() => handleReverseFinance(r)} disabled={saving} className="p-1.5 bg-rose-500 text-white rounded-lg hover:shadow-md transition" title="Reverse Journal"><RefreshCw size={14} /></button>
                          )}
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

      {/* Payslips Table */}
      {selectedRun && (
        <SectionCard pad="none">
          <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex flex-col md:flex-row md:items-center gap-4 justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">Payslips — {selectedRun.period}</h3>
              <p className="text-xs text-slate-500 mt-1">{selectedRun.employee_count} employees · <Badge tone={RUN_STATUS_TONE[selectedRun.status] ?? 'neutral'}>{selectedRun.status}</Badge></p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search employee..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-4 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-48 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
                />
              </div>
              {selectedRun.status === 'Calculated' && (
                <button onClick={() => handleStatusUpdate(selectedRun, 'Approved')} disabled={saving} className={button.primary + ' text-xs'}><CheckCircle2 size={14} /> Approve Run</button>
              )}
              {selectedRun.status === 'Approved' && (
                <button onClick={() => handleStatusUpdate(selectedRun, 'Posted')} disabled={saving} className={button.primary + ' text-xs bg-emerald-600 hover:bg-emerald-700'}><DollarSign size={14} /> Post to GL</button>
              )}
            </div>
          </div>

          {payslipsLoading ? (
            <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading payslips…</div>
          ) : filteredPayslips.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Eye className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No payslips found for this run.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Employee</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-right">Basic</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-right">Allowances</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-right">Gross</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-right">Tax</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-right">Pension</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-right">Net Pay</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Status</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {filteredPayslips.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4">
                        <div>
                          <span className="text-sm font-semibold text-slate-900 dark:text-white block">{p.employees?.name || '—'}</span>
                          <span className="text-xs font-medium text-slate-500">{p.employees?.department || '—'} · {p.employees?.position || '—'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right text-xs font-mono text-slate-700 dark:text-slate-300">${fmt(Number(p.basic_salary) || 0)}</td>
                      <td className="px-6 py-4 text-right text-xs font-mono text-slate-700 dark:text-slate-300">${fmt(Number(p.allowances) || 0)}</td>
                      <td className="px-6 py-4 text-right text-xs font-mono text-slate-900 dark:text-white">${fmt(Number(p.gross_pay) || 0)}</td>
                      <td className="px-6 py-4 text-right text-xs font-mono text-amber-600">${fmt(Number(p.income_tax) || 0)}</td>
                      <td className="px-6 py-4 text-right text-xs font-mono text-rose-600">${fmt(Number(p.pension_employee) || 0)}</td>
                      <td className="px-6 py-4 text-right text-xs font-medium font-mono text-emerald-600">${fmt(Number(p.net_pay) || 0)}</td>
                      <td className="px-6 py-4 text-center"><Badge tone={PAYSLIP_STATUS_TONE[p.status] ?? 'neutral'}>{p.status}</Badge></td>
                      <td className="px-6 py-4">
                        <div className="flex justify-center">
                          <button onClick={() => setSelectedPayslip(p)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition" title="View Payslip"><Eye size={14} className="text-slate-400" /></button>
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

      {/* New Payroll Run Modal */}
      <ModalSystem
        isOpen={showNewRun}
        onClose={() => setShowNewRun(false)}
        onConfirm={handleCreateRun}
        title="New Payroll Run"
        subtitle="Select period and employees to calculate payroll"
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Calculating…' : 'Calculate Payroll'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="space-y-4">
          <label className="block">
            <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Pay Period (YYYY-MM)</span>
            <input type="month" value={newRun.period} onChange={(e) => setNewRun({ ...newRun, period: e.target.value })} className={inputCls} />
          </label>

          <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Select Employees</h4>
              <div className="flex gap-2">
                <button onClick={() => setNewRun({ ...newRun, selectedEmployees: employees.map((e) => e.id) })} className="px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-xl text-xs font-medium uppercase hover:bg-indigo-100 transition">Select All</button>
                <button onClick={() => setNewRun({ ...newRun, selectedEmployees: [] })} className="px-3 py-1.5 bg-slate-50 text-slate-500 rounded-xl text-xs font-medium uppercase hover:bg-slate-100 transition">Clear</button>
              </div>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto">
              {employees.length === 0 ? (
                <div className="p-6 text-center text-slate-500 text-xs font-bold">No active employees found.</div>
              ) : employees.map((emp) => (
                <label key={emp.id} className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-950 rounded-xl cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-900 transition">
                  <input type="checkbox" checked={newRun.selectedEmployees.includes(emp.id)} onChange={() => toggleEmployee(emp.id)} className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500" />
                  <div className="flex-1">
                    <p className="text-xs font-medium text-slate-900 dark:text-white">{emp.name}</p>
                    <p className="text-xs font-medium text-slate-400">{emp.department} · {emp.position}</p>
                  </div>
                  <span className="text-xs font-mono font-medium text-slate-700 dark:text-slate-300">${fmt(Number(emp.basic_salary || emp.salary) || 0)}</span>
                </label>
              ))}
            </div>
            <p className="text-xs font-medium text-slate-400 mt-2">
              {newRun.selectedEmployees.length === 0 ? 'All active employees will be included.' : `${newRun.selectedEmployees.length} employee(s) selected.`}
            </p>
          </div>
        </div>
      </ModalSystem>

      {/* Payslip Viewer Modal */}
      {selectedPayslip && (
        <PayslipViewer payslip={selectedPayslip} onClose={() => setSelectedPayslip(null)} />
      )}
    </div>
  );
};

export default PayrollEngine;
