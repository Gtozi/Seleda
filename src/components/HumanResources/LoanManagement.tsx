/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HR Loan Management — employee loans and salary advances, with installment
 * tracking and balance remaining. Loans are deducted automatically during
 * payroll runs (see hrPayroll.routes.ts).
 *
 * DB-integrated via /api/hr-portal/payroll/loans/* routes.
 * Uses hr_employee_loans table (migration 439).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Banknote,
  RefreshCw,
  Plus,
  Save,
  Eye,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout } from '../FrontOffice/brandTheme';

interface Loan {
  id: string;
  property_id: string;
  employee_id: string;
  employee_name: string;
  type: 'Loan' | 'Salary Advance';
  principal: number;
  monthly_installment: number;
  balance_remaining: number;
  start_date: string;
  status: 'Active' | 'Completed' | 'Suspended';
  notes: string | null;
  created_at: string;
}

interface Employee {
  id: string;
  name: string;
  department: string;
  position: string;
}

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const inputCls = 'px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 font-sans';

const LoanManagement = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [loans, setLoans] = useState<Loan[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState<Loan | null>(null);
  const [filter, setFilter] = useState<'All' | 'Active' | 'Completed'>('All');
  const [newLoan, setNewLoan] = useState({
    employeeId: '',
    type: 'Loan' as 'Loan' | 'Salary Advance',
    principal: 0,
    monthlyInstallment: 0,
    startDate: new Date().toISOString().slice(0, 10),
    notes: '',
  });
  const [editLoan, setEditLoan] = useState<Partial<Loan>>({});

  const notify = (message: string, type: 'success' | 'warning' = 'success') => {
    addNotification?.(message, type, 'HR');
  };

  const fetchLoans = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/payroll/loans/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setLoans(((await res.json()) as { loans: Loan[] }).loans || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchEmployees = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/leave/employees/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setEmployees(((await res.json()) as { employees: Employee[] }).employees || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchLoans(), fetchEmployees()]);
    setLoading(false);
  }, [fetchLoans, fetchEmployees]);

  useEffect(() => {
    if (currentPropertyId) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId]);

  const handleCreate = async () => {
    if (!newLoan.employeeId || !newLoan.principal || !newLoan.monthlyInstallment) {
      notify('Employee, principal, and monthly installment are required', 'warning');
      return;
    }
    const emp = employees.find((e) => e.id === newLoan.employeeId);
    try {
      const res = await fetch('/api/hr-portal/payroll/loans', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          propertyId: currentPropertyId,
          employeeId: newLoan.employeeId,
          employeeName: emp?.name,
          type: newLoan.type,
          principal: newLoan.principal,
          monthlyInstallment: newLoan.monthlyInstallment,
          startDate: newLoan.startDate,
          notes: newLoan.notes,
        }),
      });
      if (res.ok) {
        notify('Loan created');
        setShowCreate(false);
        setNewLoan({ employeeId: '', type: 'Loan', principal: 0, monthlyInstallment: 0, startDate: new Date().toISOString().slice(0, 10), notes: '' });
        refresh();
      } else {
        const err = await res.json().catch(() => ({}));
        notify(err.error || 'Failed to create loan', 'warning');
      }
    } catch {
      notify('Network error', 'warning');
    }
  };

  const handleSaveEdit = async () => {
    if (!selectedLoan || !editLoan) return;
    try {
      const res = await fetch(`/api/hr-portal/payroll/loans/${selectedLoan.id}`, {
        method: 'PATCH',
        headers: authHeaders(true),
        body: JSON.stringify({
          monthlyInstallment: editLoan.monthly_installment,
          balanceRemaining: editLoan.balance_remaining,
          status: editLoan.status,
          notes: editLoan.notes,
        }),
      });
      if (res.ok) {
        const updated = (await res.json()).loan as Loan;
        setSelectedLoan(updated);
        notify('Loan updated');
        setEditLoan({});
        refresh();
      } else {
        notify('Update failed', 'warning');
      }
    } catch {
      notify('Network error', 'warning');
    }
  };

  const filtered = loans.filter((l) => filter === 'All' || l.status === filter);
  const activeLoans = loans.filter((l) => l.status === 'Active');
  const totalOutstanding = activeLoans.reduce((s, l) => s + Number(l.balance_remaining), 0);
  const totalMonthly = activeLoans.reduce((s, l) => s + Number(l.monthly_installment), 0);

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Loan Management"
        subtitle="Employee loans and salary advances with installment tracking"
        icon={Banknote}
        actions={
          <button onClick={refresh} className={button.secondary}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard label="Active Loans" value={activeLoans.length} icon={AlertCircle} tone="warning" />
        <StatCard label="Outstanding Balance" value={`ETB ${totalOutstanding.toLocaleString()}`} icon={Banknote} tone="info" />
        <StatCard label="Monthly Installments" value={`ETB ${totalMonthly.toLocaleString()}`} icon={CheckCircle2} tone="success" />
      </div>

      <SectionCard
        title="Employee Loans"
        actions={
          <div className="flex items-center gap-2">
            {(['All', 'Active', 'Completed'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={filter === f ? button.primary : button.secondary}>
                {f}
              </button>
            ))}
            <button onClick={() => setShowCreate(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> New Loan
            </button>
          </div>
        }
      >
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-indigo-500" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No loans found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-gray-200 dark:border-slate-700">
                  <th className="py-2 px-3">Employee</th>
                  <th className="py-2 px-3">Type</th>
                  <th className="py-2 px-3">Principal</th>
                  <th className="py-2 px-3">Monthly Installment</th>
                  <th className="py-2 px-3">Balance Remaining</th>
                  <th className="py-2 px-3">Progress</th>
                  <th className="py-2 px-3">Start Date</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => {
                  const paid = Number(l.principal) - Number(l.balance_remaining);
                  const pct = Number(l.principal) > 0 ? Math.round((paid / Number(l.principal)) * 100) : 0;
                  return (
                    <tr key={l.id} className="border-b border-gray-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-2 px-3 font-medium">{l.employee_name}</td>
                      <td className="py-2 px-3"><Badge tone={l.type === 'Salary Advance' ? 'info' : 'neutral'}>{l.type}</Badge></td>
                      <td className="py-2 px-3 font-mono">ETB {Number(l.principal).toLocaleString()}</td>
                      <td className="py-2 px-3 font-mono">ETB {Number(l.monthly_installment).toLocaleString()}</td>
                      <td className="py-2 px-3 font-mono font-semibold">ETB {Number(l.balance_remaining).toLocaleString()}</td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-gray-500">{pct}%</span>
                        </div>
                      </td>
                      <td className="py-2 px-3">{l.start_date}</td>
                      <td className="py-2 px-3">
                        <Badge tone={l.status === 'Active' ? 'success' : l.status === 'Completed' ? 'info' : 'neutral'}>{l.status}</Badge>
                      </td>
                      <td className="py-2 px-3">
                        <button onClick={() => { setSelectedLoan(l); setEditLoan({}); }} className={button.secondary}>
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Create modal */}
      <ModalSystem isOpen={showCreate} onClose={() => setShowCreate(false)} title="New Loan / Salary Advance" size="lg">
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Employee</label>
            <select className={`${inputCls} w-full mt-1`} value={newLoan.employeeId} onChange={(e) => setNewLoan({ ...newLoan, employeeId: e.target.value })}>
              <option value="">Select employee…</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name} — {e.department}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Type</label>
              <select className={`${inputCls} w-full mt-1`} value={newLoan.type} onChange={(e) => setNewLoan({ ...newLoan, type: e.target.value as 'Loan' | 'Salary Advance' })}>
                <option value="Loan">Loan</option>
                <option value="Salary Advance">Salary Advance</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Start Date</label>
              <input type="date" className={`${inputCls} w-full mt-1`} value={newLoan.startDate} onChange={(e) => setNewLoan({ ...newLoan, startDate: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Principal Amount (ETB)</label>
              <input type="number" className={`${inputCls} w-full mt-1`} value={newLoan.principal} onChange={(e) => setNewLoan({ ...newLoan, principal: Number(e.target.value) })} />
            </div>
            <div>
              <label className="text-sm font-medium">Monthly Installment (ETB)</label>
              <input type="number" className={`${inputCls} w-full mt-1`} value={newLoan.monthlyInstallment} onChange={(e) => setNewLoan({ ...newLoan, monthlyInstallment: Number(e.target.value) })} />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Notes</label>
            <textarea className={`${inputCls} w-full mt-1`} rows={2} value={newLoan.notes} onChange={(e) => setNewLoan({ ...newLoan, notes: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowCreate(false)} className={button.secondary}>Cancel</button>
            <button onClick={handleCreate} className={button.primary}><Save className="w-4 h-4" /> Create Loan</button>
          </div>
        </div>
      </ModalSystem>

      {/* Edit modal */}
      <ModalSystem isOpen={!!selectedLoan} onClose={() => setSelectedLoan(null)} title={selectedLoan ? `Loan — ${selectedLoan.employee_name}` : ''} size="lg">
        {selectedLoan && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">Type:</span> {selectedLoan.type}</div>
              <div><span className="text-gray-500">Start Date:</span> {selectedLoan.start_date}</div>
              <div><span className="text-gray-500">Principal:</span> ETB {Number(selectedLoan.principal).toLocaleString()}</div>
              <div><span className="text-gray-500">Paid So Far:</span> ETB {(Number(selectedLoan.principal) - Number(selectedLoan.balance_remaining)).toLocaleString()}</div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Monthly Installment (ETB)</label>
                <input
                  type="number"
                  className={`${inputCls} w-full mt-1`}
                  value={editLoan.monthly_installment ?? selectedLoan.monthly_installment}
                  onChange={(e) => setEditLoan({ ...editLoan, monthly_installment: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Balance Remaining (ETB)</label>
                <input
                  type="number"
                  className={`${inputCls} w-full mt-1`}
                  value={editLoan.balance_remaining ?? selectedLoan.balance_remaining}
                  onChange={(e) => setEditLoan({ ...editLoan, balance_remaining: Number(e.target.value) })}
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Status</label>
              <select
                className={`${inputCls} w-full mt-1`}
                value={editLoan.status ?? selectedLoan.status}
                onChange={(e) => setEditLoan({ ...editLoan, status: e.target.value as Loan['status'] })}
              >
                <option value="Active">Active</option>
                <option value="Completed">Completed</option>
                <option value="Suspended">Suspended</option>
              </select>
            </div>

            <div>
              <label className="text-sm font-medium">Notes</label>
              <textarea
                className={`${inputCls} w-full mt-1`}
                rows={2}
                value={editLoan.notes ?? selectedLoan.notes ?? ''}
                onChange={(e) => setEditLoan({ ...editLoan, notes: e.target.value })}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setSelectedLoan(null)} className={button.secondary}>Close</button>
              <button onClick={handleSaveEdit} className={button.primary}><Save className="w-4 h-4" /> Save Changes</button>
            </div>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default LoanManagement;
