/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HR Contract Expiry — employees with contracts expiring within N days.
 *
 * DB-integrated via /api/hr-portal/lifecycle/contract-expiry/* routes.
 * Uses employees.contract_end_date (migration 441).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  FileWarning,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';

interface ContractEmployee {
  id: string;
  name: string;
  department: string;
  position: string;
  employment_type: string;
  contract_end_date: string;
  email: string | null;
  phone: string | null;
}

function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

function daysUntil(dateStr: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

const ContractExpiry = () => {
  const { currentPropertyId } = useERP();
  const [employees, setEmployees] = useState<ContractEmployee[]>([]);
  const [loading, setLoading] = useState(false);
  const [daysWindow, setDaysWindow] = useState(30);

  const fetchExpiry = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/lifecycle/contract-expiry/${currentPropertyId}?days=${daysWindow}`, { headers: authHeaders() });
      if (res.ok) setEmployees(((await res.json()) as { employees: ContractEmployee[] }).employees || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId, daysWindow]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await fetchExpiry();
    setLoading(false);
  }, [fetchExpiry]);

  useEffect(() => {
    if (currentPropertyId) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId, daysWindow]);

  const expired = employees.filter((e) => daysUntil(e.contract_end_date) < 0);
  const imminent = employees.filter((e) => { const d = daysUntil(e.contract_end_date); return d >= 0 && d <= 7; });
  const upcoming = employees.filter((e) => daysUntil(e.contract_end_date) > 7);

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Contract Expiry Alerts"
        subtitle="Employees with contracts expiring within the alert window"
        icon={FileWarning}
        actions={
          <button onClick={refresh} className={button.secondary}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard label="Expired" value={expired.length} icon={AlertTriangle} tone="danger" />
        <StatCard label="≤ 7 Days" value={imminent.length} icon={Clock} tone="warning" />
        <StatCard label="8+ Days" value={upcoming.length} icon={FileWarning} tone="info" />
      </div>

      <SectionCard
        title="Expiring Contracts"
        actions={
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-500">Window:</label>
            <select
              className="px-3 py-1.5 bg-slate-50 dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-xl text-sm"
              value={daysWindow}
              onChange={(e) => setDaysWindow(Number(e.target.value))}
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
            </select>
          </div>
        }
      >
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-indigo-500" /></div>
        ) : employees.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No contracts expiring within {daysWindow} days
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-gray-200 dark:border-slate-700">
                  <th className="py-2 px-3">Employee</th>
                  <th className="py-2 px-3">Department</th>
                  <th className="py-2 px-3">Position</th>
                  <th className="py-2 px-3">Contract End</th>
                  <th className="py-2 px-3">Days Left</th>
                  <th className="py-2 px-3">Contact</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => {
                  const days = daysUntil(e.contract_end_date);
                  const tone = days < 0 ? 'danger' : days <= 7 ? 'warning' : 'info';
                  return (
                    <tr key={e.id} className="border-b border-gray-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-2 px-3 font-medium">{e.name}</td>
                      <td className="py-2 px-3">{e.department}</td>
                      <td className="py-2 px-3">{e.position}</td>
                      <td className="py-2 px-3">{e.contract_end_date}</td>
                      <td className="py-2 px-3">
                        <Badge tone={tone}>
                          {days < 0 ? `Expired ${Math.abs(days)}d ago` : `${days}d left`}
                        </Badge>
                      </td>
                      <td className="py-2 px-3 text-xs text-gray-500">
                        {e.email || e.phone || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
};

export default ContractExpiry;
