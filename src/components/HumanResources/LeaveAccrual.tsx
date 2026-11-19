/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HR Leave Accrual — accrual rules management + monthly accrual run.
 *
 * DB-integrated via /api/hr-portal/lifecycle/accrual/* routes.
 * Uses hr_leave_accrual_rules + hr_leave_accrual_log (migration 441).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  CalendarPlus,
  RefreshCw,
  Save,
  Plus,
  Play,
  Loader2,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';

interface AccrualRule {
  id: string;
  property_id: string;
  leave_type: string;
  employment_type: 'Full-time' | 'Part-time' | 'Contract' | 'All';
  monthly_accrual_days: number;
  max_carry_forward: number;
  encashable: boolean;
  is_active: boolean;
}

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const inputCls = 'px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 font-sans';

const LeaveAccrual = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [rules, setRules] = useState<AccrualRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [edits, setEdits] = useState<Record<string, Partial<AccrualRule>>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [newRule, setNewRule] = useState({
    leaveType: '',
    employmentType: 'Full-time' as AccrualRule['employment_type'],
    monthlyAccrualDays: '',
    maxCarryForward: '',
    encashable: false,
  });
  const [runPeriod, setRunPeriod] = useState(`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`);

  const notify = (message: string, type: 'success' | 'warning' = 'success') => {
    addNotification?.(message, type, 'HR');
  };

  const fetchRules = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/lifecycle/accrual/rules/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setRules(((await res.json()) as { rules: AccrualRule[] }).rules || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await fetchRules();
    setLoading(false);
  }, [fetchRules]);

  useEffect(() => {
    if (currentPropertyId) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId]);

  const saveRule = async (id: string) => {
    const patch = edits[id];
    if (!patch) return;
    try {
      const res = await fetch(`/api/hr-portal/lifecycle/accrual/rules/${id}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({
          monthlyAccrualDays: patch.monthly_accrual_days,
          maxCarryForward: patch.max_carry_forward,
          encashable: patch.encashable,
          isActive: patch.is_active,
        }),
      });
      if (res.ok) {
        notify('Rule updated');
        setEdits((e) => { const n = { ...e }; delete n[id]; return n; });
        refresh();
      } else {
        notify('Update failed', 'warning');
      }
    } catch {
      notify('Network error', 'warning');
    }
  };

  const runAccrual = async () => {
    setRunning(true);
    try {
      const res = await fetch('/api/hr-portal/lifecycle/accrual/run', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ propertyId: currentPropertyId, period: runPeriod }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        notify(`Accrual run for ${runPeriod}: ${data.processed} balances updated`);
      } else {
        notify(data.error || 'Run failed', 'warning');
      }
    } catch {
      notify('Network error', 'warning');
    } finally {
      setRunning(false);
    }
  };

  const createRule = async () => {
    if (!currentPropertyId || !newRule.leaveType || !newRule.employmentType) {
      notify('Leave type and employment type are required', 'warning');
      return;
    }
    try {
      const res = await fetch('/api/hr-portal/lifecycle/accrual/rules', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          propertyId: currentPropertyId,
          leaveType: newRule.leaveType,
          employmentType: newRule.employmentType,
          monthlyAccrualDays: Number(newRule.monthlyAccrualDays) || 0,
          maxCarryForward: Number(newRule.maxCarryForward) || 0,
          encashable: newRule.encashable,
        }),
      });
      if (res.ok) {
        notify('Accrual rule created');
        setNewRule({ leaveType: '', employmentType: 'Full-time', monthlyAccrualDays: '', maxCarryForward: '', encashable: false });
        setShowCreate(false);
        refresh();
      } else {
        const err = await res.json().catch(() => ({}));
        notify(err.error || 'Failed to create rule', 'warning');
      }
    } catch {
      notify('Network error', 'warning');
    }
  };

  const activeCount = rules.filter((r) => r.is_active).length;
  const totalMonthly = rules.filter((r) => r.is_active).reduce((s, r) => s + Number(r.monthly_accrual_days), 0);

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Leave Accrual"
        subtitle="Monthly leave accrual rules and run execution"
        icon={CalendarPlus}
        actions={
          <button onClick={refresh} className={button.secondary}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard label="Active Rules" value={activeCount} icon={CheckCircle2} tone="success" />
        <StatCard label="Total Monthly Accrual" value={`${totalMonthly.toFixed(2)} days`} icon={CalendarPlus} tone="info" />
        <StatCard label="Leave Types" value={new Set(rules.map((r) => r.leave_type)).size} icon={Clock} tone="warning" />
      </div>

      <SectionCard title="Monthly Accrual Run">
        <div className="flex items-end gap-3">
          <div>
            <label className="text-sm font-medium">Period (YYYY-MM)</label>
            <input
              type="month"
              className={`${inputCls} mt-1`}
              value={runPeriod}
              onChange={(e) => setRunPeriod(e.target.value)}
            />
          </div>
          <button onClick={runAccrual} disabled={running} className={button.primary}>
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Run Accrual
          </button>
          <p className="text-xs text-gray-500 pb-2">
            Idempotent — safe to re-run for the same period. Year-end (Dec) applies carry-forward caps.
          </p>
        </div>
      </SectionCard>

      <SectionCard
        title="Accrual Rules"
        actions={
          !showCreate && (
            <button onClick={() => setShowCreate(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> New Rule
            </button>
          )
        }
      >
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-indigo-500" /></div>
        ) : rules.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No accrual rules configured</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-gray-200 dark:border-slate-700">
                  <th className="py-2 px-3">Leave Type</th>
                  <th className="py-2 px-3">Employment Type</th>
                  <th className="py-2 px-3">Monthly Days</th>
                  <th className="py-2 px-3">Max Carry-Forward</th>
                  <th className="py-2 px-3">Encashable</th>
                  <th className="py-2 px-3">Active</th>
                  <th className="py-2 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => {
                  const edit = edits[r.id] || {};
                  const monthly = edit.monthly_accrual_days ?? r.monthly_accrual_days;
                  const carry = edit.max_carry_forward ?? r.max_carry_forward;
                  const encash = edit.encashable ?? r.encashable;
                  const active = edit.is_active ?? r.is_active;
                  return (
                    <tr key={r.id} className="border-b border-gray-100 dark:border-slate-800">
                      <td className="py-2 px-3 font-medium">{r.leave_type}</td>
                      <td className="py-2 px-3"><Badge tone="neutral">{r.employment_type}</Badge></td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          step="0.01"
                          className={`${inputCls} w-20`}
                          value={monthly}
                          onChange={(e) => setEdits({ ...edits, [r.id]: { ...edit, monthly_accrual_days: Number(e.target.value) } })}
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          step="0.01"
                          className={`${inputCls} w-20`}
                          value={carry}
                          onChange={(e) => setEdits({ ...edits, [r.id]: { ...edit, max_carry_forward: Number(e.target.value) } })}
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="checkbox"
                          checked={encash}
                          onChange={(e) => setEdits({ ...edits, [r.id]: { ...edit, encashable: e.target.checked } })}
                          className="w-4 h-4"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="checkbox"
                          checked={active}
                          onChange={(e) => setEdits({ ...edits, [r.id]: { ...edit, is_active: e.target.checked } })}
                          className="w-4 h-4"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <button onClick={() => saveRule(r.id)} disabled={!edits[r.id]} className={button.secondary}>
                          <Save className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && showCreate && (
          <div className="mt-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-gray-200 dark:border-slate-700">
            <h4 className="text-sm font-semibold mb-3">New Accrual Rule</h4>
            <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
              <div>
                <label className="text-xs font-medium text-gray-500">Leave Type</label>
                <input
                  type="text"
                  className={`${inputCls} w-full`}
                  value={newRule.leaveType}
                  onChange={(e) => setNewRule({ ...newRule, leaveType: e.target.value })}
                  placeholder="e.g. Annual Leave"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500">Employment</label>
                <select
                  className={`${inputCls} w-full`}
                  value={newRule.employmentType}
                  onChange={(e) => setNewRule({ ...newRule, employmentType: e.target.value as AccrualRule['employment_type'] })}
                >
                  {['Full-time', 'Part-time', 'Contract', 'All'].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500">Monthly Days</label>
                <input
                  type="number"
                  step="0.01"
                  className={`${inputCls} w-full`}
                  value={newRule.monthlyAccrualDays}
                  onChange={(e) => setNewRule({ ...newRule, monthlyAccrualDays: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500">Max Carry-Forward</label>
                <input
                  type="number"
                  step="0.01"
                  className={`${inputCls} w-full`}
                  value={newRule.maxCarryForward}
                  onChange={(e) => setNewRule({ ...newRule, maxCarryForward: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-2 pb-2">
                <input
                  id="encashable"
                  type="checkbox"
                  checked={newRule.encashable}
                  onChange={(e) => setNewRule({ ...newRule, encashable: e.target.checked })}
                  className="w-4 h-4"
                />
                <label htmlFor="encashable" className="text-sm">Encashable</label>
              </div>
              <div className="flex gap-2">
                <button onClick={createRule} className={button.primary}><Save className="w-4 h-4" /></button>
                <button onClick={() => { setShowCreate(false); setNewRule({ leaveType: '', employmentType: 'Full-time', monthlyAccrualDays: '', maxCarryForward: '', encashable: false }); }} className={button.secondary}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
};

export default LeaveAccrual;
