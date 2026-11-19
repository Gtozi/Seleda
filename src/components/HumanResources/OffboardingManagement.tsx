/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HR Offboarding — exit clearance workflow, final settlement, exit interviews.
 *
 * DB-integrated via /api/hr-portal/lifecycle/offboarding/* routes.
 * Uses hr_offboarding_cases table (migration 441).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  UserMinus,
  RefreshCw,
  Plus,
  Eye,
  Save,
  CheckCircle2,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout } from '../FrontOffice/brandTheme';

interface OffboardingCase {
  id: string;
  property_id: string;
  employee_id: string;
  employee_name: string;
  department: string | null;
  position: string | null;
  termination_date: string;
  reason: string;
  clearance_status: 'Pending' | 'In Progress' | 'Completed';
  final_settlement: number;
  settlement_paid: boolean;
  exit_interview: boolean;
  exit_interview_notes: string | null;
  checklist: Record<string, boolean>;
  status: 'Open' | 'Completed' | 'Cancelled';
  created_at: string;
}

interface Employee {
  id: string;
  name: string;
  department: string;
  position: string;
}

const REASONS = ['Resignation', 'Termination', 'Retirement', 'Contract End', 'Dismissal', 'Other'];
const CLEARANCE_STEPS = [
  'Equipment returned',
  'Access cards returned',
  'System accounts deactivated',
  'Final timesheet approved',
  'Exit interview completed',
  'Final settlement calculated',
];

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const inputCls = 'px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 font-sans';

const OffboardingManagement = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [cases, setCases] = useState<OffboardingCase[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedCase, setSelectedCase] = useState<OffboardingCase | null>(null);
  const [filter, setFilter] = useState<'All' | 'Open' | 'Completed'>('All');
  const [newCase, setNewCase] = useState({
    employeeId: '',
    terminationDate: new Date().toISOString().slice(0, 10),
    reason: 'Resignation',
    finalSettlement: 0,
    exitInterviewNotes: '',
  });

  const notify = (message: string, type: 'success' | 'warning' = 'success') => {
    addNotification?.(message, type, 'HR');
  };

  const fetchCases = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/lifecycle/offboarding/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setCases(((await res.json()) as { cases: OffboardingCase[] }).cases || []);
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
    await Promise.all([fetchCases(), fetchEmployees()]);
    setLoading(false);
  }, [fetchCases, fetchEmployees]);

  useEffect(() => {
    if (currentPropertyId) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId]);

  const handleCreate = async () => {
    if (!newCase.employeeId) {
      notify('Please select an employee', 'warning');
      return;
    }
    const emp = employees.find((e) => e.id === newCase.employeeId);
    try {
      const res = await fetch('/api/hr-portal/lifecycle/offboarding', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          propertyId: currentPropertyId,
          employeeId: newCase.employeeId,
          employeeName: emp?.name,
          department: emp?.department,
          position: emp?.position,
          terminationDate: newCase.terminationDate,
          reason: newCase.reason,
          finalSettlement: newCase.finalSettlement,
          exitInterviewNotes: newCase.exitInterviewNotes,
        }),
      });
      if (res.ok) {
        notify('Offboarding case created');
        setShowCreate(false);
        setNewCase({ employeeId: '', terminationDate: new Date().toISOString().slice(0, 10), reason: 'Resignation', finalSettlement: 0, exitInterviewNotes: '' });
        refresh();
      } else {
        const err = await res.json().catch(() => ({}));
        notify(err.error || 'Failed to create case', 'warning');
      }
    } catch {
      notify('Network error', 'warning');
    }
  };

  const updateCase = async (patch: Partial<OffboardingCase>) => {
    if (!selectedCase) return;
    try {
      const res = await fetch(`/api/hr-portal/lifecycle/offboarding/${selectedCase.id}`, {
        method: 'PATCH',
        headers: authHeaders(true),
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const updated = (await res.json()).case as OffboardingCase;
        setSelectedCase(updated);
        notify('Case updated');
        refresh();
      } else {
        notify('Update failed', 'warning');
      }
    } catch {
      notify('Network error', 'warning');
    }
  };

  const toggleChecklist = async (step: string) => {
    if (!selectedCase) return;
    const checklist = { ...(selectedCase.checklist || {}), [step]: !selectedCase.checklist?.[step] };
    const allDone = CLEARANCE_STEPS.every((s) => checklist[s]);
    await updateCase({ checklist, clearance_status: allDone ? 'Completed' : 'In Progress' });
  };

  const filtered = cases.filter((c) => filter === 'All' || c.status === filter);
  const openCount = cases.filter((c) => c.status === 'Open').length;
  const completedCount = cases.filter((c) => c.status === 'Completed').length;
  const pendingSettlement = cases.filter((c) => c.status === 'Open' && !c.settlement_paid).length;

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Offboarding Management"
        subtitle="Exit clearance, final settlement, and exit interviews"
        icon={UserMinus}
        actions={
          <button onClick={refresh} className={button.secondary}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard label="Open Cases" value={openCount} icon={AlertTriangle} tone="warning" />
        <StatCard label="Completed" value={completedCount} icon={CheckCircle2} tone="success" />
        <StatCard label="Pending Settlement" value={pendingSettlement} icon={UserMinus} tone="info" />
      </div>

      <SectionCard
        title="Offboarding Cases"
        actions={
          <div className="flex items-center gap-2">
            {(['All', 'Open', 'Completed'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={filter === f ? button.primary : button.secondary}>
                {f}
              </button>
            ))}
            <button onClick={() => setShowCreate(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> New Case
            </button>
          </div>
        }
      >
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-indigo-500" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No offboarding cases found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-gray-200 dark:border-slate-700">
                  <th className="py-2 px-3">Employee</th>
                  <th className="py-2 px-3">Department</th>
                  <th className="py-2 px-3">Termination Date</th>
                  <th className="py-2 px-3">Reason</th>
                  <th className="py-2 px-3">Clearance</th>
                  <th className="py-2 px-3">Settlement</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="border-b border-gray-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-2 px-3 font-medium">{c.employee_name}</td>
                    <td className="py-2 px-3">{c.department || '—'}</td>
                    <td className="py-2 px-3">{c.termination_date}</td>
                    <td className="py-2 px-3">{c.reason}</td>
                    <td className="py-2 px-3">
                      <Badge tone={c.clearance_status === 'Completed' ? 'success' : c.clearance_status === 'In Progress' ? 'warning' : 'neutral'}>
                        {c.clearance_status}
                      </Badge>
                    </td>
                    <td className="py-2 px-3">
                      ETB {Number(c.final_settlement).toLocaleString()}
                      {c.settlement_paid && <span className="ml-1 text-green-600">✓</span>}
                    </td>
                    <td className="py-2 px-3">
                      <Badge tone={c.status === 'Completed' ? 'success' : c.status === 'Cancelled' ? 'danger' : 'info'}>{c.status}</Badge>
                    </td>
                    <td className="py-2 px-3">
                      <button onClick={() => setSelectedCase(c)} className={button.secondary}>
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Create modal */}
      <ModalSystem isOpen={showCreate} onClose={() => setShowCreate(false)} title="New Offboarding Case" size="lg">
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Employee</label>
            <select className={`${inputCls} w-full mt-1`} value={newCase.employeeId} onChange={(e) => setNewCase({ ...newCase, employeeId: e.target.value })}>
              <option value="">Select employee…</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name} — {e.department}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Termination Date</label>
              <input type="date" className={`${inputCls} w-full mt-1`} value={newCase.terminationDate} onChange={(e) => setNewCase({ ...newCase, terminationDate: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-medium">Reason</label>
              <select className={`${inputCls} w-full mt-1`} value={newCase.reason} onChange={(e) => setNewCase({ ...newCase, reason: e.target.value })}>
                {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Final Settlement (ETB)</label>
            <input type="number" className={`${inputCls} w-full mt-1`} value={newCase.finalSettlement} onChange={(e) => setNewCase({ ...newCase, finalSettlement: Number(e.target.value) })} />
          </div>
          <div>
            <label className="text-sm font-medium">Exit Interview Notes</label>
            <textarea className={`${inputCls} w-full mt-1`} rows={3} value={newCase.exitInterviewNotes} onChange={(e) => setNewCase({ ...newCase, exitInterviewNotes: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowCreate(false)} className={button.secondary}>Cancel</button>
            <button onClick={handleCreate} className={button.primary}><Save className="w-4 h-4" /> Create Case</button>
          </div>
        </div>
      </ModalSystem>

      {/* Detail / checklist modal */}
      <ModalSystem isOpen={!!selectedCase} onClose={() => setSelectedCase(null)} title={selectedCase ? `Offboarding — ${selectedCase.employee_name}` : ''} size="lg">
        {selectedCase && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">Department:</span> {selectedCase.department || '—'}</div>
              <div><span className="text-gray-500">Position:</span> {selectedCase.position || '—'}</div>
              <div><span className="text-gray-500">Termination:</span> {selectedCase.termination_date}</div>
              <div><span className="text-gray-500">Reason:</span> {selectedCase.reason}</div>
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-2">Clearance Checklist</h4>
              <div className="space-y-2">
                {CLEARANCE_STEPS.map((step) => (
                  <label key={step} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!selectedCase.checklist?.[step]}
                      onChange={() => toggleChecklist(step)}
                      className="w-4 h-4 rounded"
                    />
                    <span className={selectedCase.checklist?.[step] ? 'line-through text-gray-400' : ''}>{step}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Final Settlement (ETB)</label>
                <input
                  type="number"
                  className={`${inputCls} w-full mt-1`}
                  value={selectedCase.final_settlement}
                  onChange={(e) => setSelectedCase({ ...selectedCase, final_settlement: Number(e.target.value) })}
                />
              </div>
              <div className="flex items-end gap-2">
                <button
                  onClick={() => updateCase({ final_settlement: selectedCase.final_settlement, settlement_paid: !selectedCase.settlement_paid })}
                  className={selectedCase.settlement_paid ? button.primary : button.secondary}
                >
                  {selectedCase.settlement_paid ? '✓ Settlement Paid' : 'Mark Settlement Paid'}
                </button>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Exit Interview Notes</label>
              <textarea
                className={`${inputCls} w-full mt-1`}
                rows={3}
                value={selectedCase.exit_interview_notes || ''}
                onChange={(e) => setSelectedCase({ ...selectedCase, exit_interview_notes: e.target.value })}
              />
            </div>

            <div className="flex justify-between pt-2">
              <button
                onClick={() => updateCase({ exit_interview: !selectedCase.exit_interview, exit_interview_notes: selectedCase.exit_interview_notes })}
                className={selectedCase.exit_interview ? button.primary : button.secondary}
              >
                {selectedCase.exit_interview ? '✓ Exit Interview Done' : 'Mark Exit Interview'}
              </button>
              <div className="flex gap-2">
                <button onClick={() => setSelectedCase(null)} className={button.secondary}>Close</button>
                <button
                  onClick={() => {
                    if (CLEARANCE_STEPS.every((s) => selectedCase.checklist?.[s])) {
                      updateCase({ status: 'Completed', clearance_status: 'Completed' });
                    } else {
                      notify('All clearance steps must be completed before closing the case', 'warning');
                    }
                  }}
                  className={button.primary}
                  disabled={selectedCase.status === 'Completed'}
                >
                  <CheckCircle2 className="w-4 h-4" /> Complete Case
                </button>
              </div>
            </div>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default OffboardingManagement;
