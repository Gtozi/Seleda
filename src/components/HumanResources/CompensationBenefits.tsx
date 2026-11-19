/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HR Compensation & Benefits — manager-facing salary grades, benefit plans,
 * allowances, and additional benefits.
 *
 * DB-integrated via /api/hr-portal/compensation/* routes. Uses tables from
 * migration 423.
 *
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  DollarSign,
  Shield,
  Heart,
  Home,
  Utensils,
  Car,
  GraduationCap,
  Plus,
  Pencil,
  Search,
  Filter,
  TrendingUp,
  Users,
  FileText,
  Loader2,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge, Card } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';

type Tab = 'salary' | 'benefits' | 'insurance' | 'allowances';

interface SalaryGrade {
  id: string;
  grade: string;
  level: string;
  min_salary: number;
  max_salary: number;
  midpoint: number;
  positions: number;
  employees: number;
}

interface BenefitPlan {
  id: string;
  name: string;
  type: string;
  description: string | null;
  coverage: string | null;
  employer_contribution: number;
  employee_contribution: number;
  enrolled: number;
  eligible: number;
  status: string;
}

interface Allowance {
  id: string;
  name: string;
  type: string;
  amount: number;
  eligible_employees: number;
  description: string | null;
}

interface AdditionalBenefit {
  id: string;
  name: string;
  type: string;
  description: string | null;
  coverage: string | null;
  available: number | null;
  occupied: number | null;
  waiting_list: number | null;
  status: string;
}

interface Stats {
  totalPayroll: number;
  enrollmentRate: number;
  avgSalary: number;
  benefitsCost: number;
  gradeCount: number;
  benefitPlanCount: number;
  allowanceCount: number;
}

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'salary', label: 'Salary Structure', icon: DollarSign },
  { id: 'benefits', label: 'Benefit Plans', icon: Shield },
  { id: 'insurance', label: 'Additional Benefits', icon: Heart },
  { id: 'allowances', label: 'Allowances', icon: FileText },
];

const BENEFIT_TYPE_ICON: Record<string, any> = { Health: Heart, Life: Shield, Retirement: GraduationCap, Housing: Home, Food: Utensils, Transport: Car };
const BENEFIT_TYPE_TONE: Record<string, statusTone.StatusTone> = { Health: 'danger', Life: 'info', Retirement: 'accent', Housing: 'info', Food: 'warning', Transport: 'success' };
const STATUS_TONE: Record<string, statusTone.StatusTone> = { Active: 'success', Inactive: 'neutral', Pending: 'warning', Available: 'success', Full: 'danger' };
const ALLOWANCE_TYPE_TONE: Record<string, statusTone.StatusTone> = { Monthly: 'accent', Daily: 'warning', Annual: 'info' };

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const fmt = (n: number) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtMoney = (n: number) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const inputCls = 'w-full px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 font-sans';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

const CompensationBenefits = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [activeTab, setActiveTab] = useState<Tab>('salary');
  const [stats, setStats] = useState<Stats>({ totalPayroll: 0, enrollmentRate: 0, avgSalary: 0, benefitsCost: 0, gradeCount: 0, benefitPlanCount: 0, allowanceCount: 0 });
  const [grades, setGrades] = useState<SalaryGrade[]>([]);
  const [plans, setPlans] = useState<BenefitPlan[]>([]);
  const [allowances, setAllowances] = useState<Allowance[]>([]);
  const [additional, setAdditional] = useState<AdditionalBenefit[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const [modal, setModal] = useState<{ type: 'grade' | 'plan' | 'allowance' | 'additional'; mode: 'create' | 'edit'; id: string | null } | null>(null);
  const [gradeForm, setGradeForm] = useState({ grade: '', level: '', minSalary: 0, maxSalary: 0, midpoint: 0, positions: 0, employees: 0 });
  const [planForm, setPlanForm] = useState({ name: '', type: 'Health', description: '', coverage: '', employerContribution: 0, employeeContribution: 0, enrolled: 0, eligible: 0, status: 'Active' });
  const [allowanceForm, setAllowanceForm] = useState({ name: '', type: 'Monthly', amount: 0, eligibleEmployees: 0, description: '' });
  const [additionalForm, setAdditionalForm] = useState({ name: '', type: 'Housing', description: '', coverage: '', available: '', occupied: '', waitingList: '', status: 'Active' });

  const fetchStats = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/compensation/statistics/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setStats(await res.json());
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchGrades = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/compensation/salary-grades/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setGrades(((await res.json()) as { grades: SalaryGrade[] }).grades || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchPlans = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/compensation/benefit-plans/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setPlans(((await res.json()) as { plans: BenefitPlan[] }).plans || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchAllowances = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/compensation/allowances/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setAllowances(((await res.json()) as { allowances: Allowance[] }).allowances || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchAdditional = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/compensation/additional-benefits/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setAdditional(((await res.json()) as { benefits: AdditionalBenefit[] }).benefits || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchStats(), fetchGrades(), fetchPlans(), fetchAllowances(), fetchAdditional()]);
    setLoading(false);
  }, [fetchStats, fetchGrades, fetchPlans, fetchAllowances, fetchAdditional]);

  useEffect(() => {
    if (currentPropertyId) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId]);

  const filteredGrades = useMemo(() => {
    if (!search.trim()) return grades;
    const q = search.toLowerCase();
    return grades.filter((g) => g.grade.toLowerCase().includes(q) || g.level.toLowerCase().includes(q));
  }, [grades, search]);

  const filteredPlans = useMemo(() => {
    if (!search.trim()) return plans;
    const q = search.toLowerCase();
    return plans.filter((p) => p.name.toLowerCase().includes(q) || p.type.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q));
  }, [plans, search]);

  const filteredAllowances = useMemo(() => {
    if (!search.trim()) return allowances;
    const q = search.toLowerCase();
    return allowances.filter((a) => a.name.toLowerCase().includes(q) || a.type.toLowerCase().includes(q));
  }, [allowances, search]);

  const filteredAdditional = useMemo(() => {
    if (!search.trim()) return additional;
    const q = search.toLowerCase();
    return additional.filter((a) => a.name.toLowerCase().includes(q) || a.type.toLowerCase().includes(q));
  }, [additional, search]);

  const openCreate = (type: typeof modal['type']) => {
    setModal({ type, mode: 'create', id: null });
    if (type === 'grade') setGradeForm({ grade: '', level: '', minSalary: 0, maxSalary: 0, midpoint: 0, positions: 0, employees: 0 });
    if (type === 'plan') setPlanForm({ name: '', type: 'Health', description: '', coverage: '', employerContribution: 0, employeeContribution: 0, enrolled: 0, eligible: 0, status: 'Active' });
    if (type === 'allowance') setAllowanceForm({ name: '', type: 'Monthly', amount: 0, eligibleEmployees: 0, description: '' });
    if (type === 'additional') setAdditionalForm({ name: '', type: 'Housing', description: '', coverage: '', available: '', occupied: '', waitingList: '', status: 'Active' });
  };

  const openEdit = (type: typeof modal['type'], item: any) => {
    setModal({ type, mode: 'edit', id: item.id });
    if (type === 'grade') setGradeForm({ grade: item.grade, level: item.level, minSalary: Number(item.min_salary), maxSalary: Number(item.max_salary), midpoint: Number(item.midpoint), positions: Number(item.positions), employees: Number(item.employees) });
    if (type === 'plan') setPlanForm({ name: item.name, type: item.type, description: item.description || '', coverage: item.coverage || '', employerContribution: Number(item.employer_contribution), employeeContribution: Number(item.employee_contribution), enrolled: Number(item.enrolled), eligible: Number(item.eligible), status: item.status });
    if (type === 'allowance') setAllowanceForm({ name: item.name, type: item.type, amount: Number(item.amount), eligibleEmployees: Number(item.eligible_employees), description: item.description || '' });
    if (type === 'additional') setAdditionalForm({ name: item.name, type: item.type, description: item.description || '', coverage: item.coverage || '', available: item.available != null ? String(item.available) : '', occupied: item.occupied != null ? String(item.occupied) : '', waitingList: item.waiting_list != null ? String(item.waiting_list) : '', status: item.status });
  };

  const save = async () => {
    if (!currentPropertyId || !modal) return;
    setSaving(true);
    try {
      let endpoint = '';
      let body: any = { propertyId: currentPropertyId };
      let method: 'POST' | 'PUT' = 'POST';

      if (modal.type === 'grade') {
        endpoint = modal.mode === 'create' ? '/api/hr-portal/compensation/salary-grades' : `/api/hr-portal/compensation/salary-grades/${modal.id}`;
        method = modal.mode === 'create' ? 'POST' : 'PUT';
        body = { ...body, grade: gradeForm.grade, level: gradeForm.level, minSalary: gradeForm.minSalary, maxSalary: gradeForm.maxSalary, midpoint: gradeForm.midpoint, positions: gradeForm.positions, employees: gradeForm.employees };
      } else if (modal.type === 'plan') {
        endpoint = modal.mode === 'create' ? '/api/hr-portal/compensation/benefit-plans' : `/api/hr-portal/compensation/benefit-plans/${modal.id}`;
        method = modal.mode === 'create' ? 'POST' : 'PUT';
        body = { ...body, name: planForm.name, type: planForm.type, description: planForm.description, coverage: planForm.coverage, employerContribution: planForm.employerContribution, employeeContribution: planForm.employeeContribution, enrolled: planForm.enrolled, eligible: planForm.eligible, status: planForm.status };
      } else if (modal.type === 'allowance') {
        endpoint = modal.mode === 'create' ? '/api/hr-portal/compensation/allowances' : `/api/hr-portal/compensation/allowances/${modal.id}`;
        method = modal.mode === 'create' ? 'POST' : 'PUT';
        body = { ...body, name: allowanceForm.name, type: allowanceForm.type, amount: allowanceForm.amount, eligibleEmployees: allowanceForm.eligibleEmployees, description: allowanceForm.description };
      } else if (modal.type === 'additional') {
        endpoint = modal.mode === 'create' ? '/api/hr-portal/compensation/additional-benefits' : `/api/hr-portal/compensation/additional-benefits/${modal.id}`;
        method = modal.mode === 'create' ? 'POST' : 'PUT';
        body = { ...body, name: additionalForm.name, type: additionalForm.type, description: additionalForm.description, coverage: additionalForm.coverage, available: additionalForm.available, occupied: additionalForm.occupied, waitingList: additionalForm.waitingList, status: additionalForm.status };
      }

      const res = await fetch(endpoint, { method, headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Saved', 'success', 'HR');
      setModal(null); refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const deleteItem = async (type: typeof modal['type'], id: string) => {
    if (!confirm('Delete this record?')) return;
    setSaving(true);
    const endpoint = type === 'grade' ? `/api/hr-portal/compensation/salary-grades/${id}` : type === 'plan' ? `/api/hr-portal/compensation/benefit-plans/${id}` : type === 'allowance' ? `/api/hr-portal/compensation/allowances/${id}` : `/api/hr-portal/compensation/additional-benefits/${id}`;
    try {
      const res = await fetch(endpoint, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Deleted', 'success', 'HR');
      refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Compensation & Benefits" subtitle="Manage salary structures, benefit plans, and employee allowances" icon={DollarSign} />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <DollarSign className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">Select a property to view compensation data.</p>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Compensation & Benefits"
        subtitle="Manage salary structures, benefit plans, and employee allowances"
        icon={DollarSign}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refresh} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button
              onClick={() => openCreate(activeTab === 'salary' ? 'grade' : activeTab === 'benefits' ? 'plan' : activeTab === 'allowances' ? 'allowance' : 'additional')}
              className={button.primary}
            >
              <Plus className="w-4 h-4" />
              {activeTab === 'salary' ? 'Add Grade' : activeTab === 'benefits' ? 'Add Benefit Plan' : activeTab === 'allowances' ? 'Add Allowance' : 'Add Additional Benefit'}
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Payroll" value={fmtMoney(stats.totalPayroll)} caption="YTD midpoint sum" icon={DollarSign} tone="success" />
        <StatCard title="Benefit Enrollment" value={`${stats.enrollmentRate}%`} caption="Active plans" icon={Shield} tone="accent" />
        <StatCard title="Avg. Salary" value={fmtMoney(stats.avgSalary)} caption="Per employee" icon={TrendingUp} tone="info" />
        <StatCard title="Benefits Cost" value={fmtMoney(stats.benefitsCost)} caption="Employer contribution" icon={Heart} tone="danger" />
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

      {/* Search bar */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
        />
      </div>

      {/* Salary Structure */}
      {activeTab === 'salary' && (
        <SectionCard pad="none">
          <div className="p-6 border-b border-slate-50 dark:border-slate-800">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Salary Structure</h3>
          </div>
          {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filteredGrades.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <DollarSign className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No salary grades found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Grade</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Level</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-right">Min Salary</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-right">Midpoint</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-right">Max Salary</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Positions</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Employees</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {filteredGrades.map((g) => (
                    <tr key={g.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4 text-sm font-semibold text-slate-900 dark:text-white">{g.grade}</td>
                      <td className="px-6 py-4"><Badge tone="accent">{g.level}</Badge></td>
                      <td className="px-6 py-4 text-right text-sm font-medium text-slate-500">${fmt(g.min_salary)}</td>
                      <td className="px-6 py-4 text-right text-xs font-bold text-slate-900 dark:text-white">${fmt(g.midpoint)}</td>
                      <td className="px-6 py-4 text-right text-sm font-medium text-slate-500">${fmt(g.max_salary)}</td>
                      <td className="px-6 py-4 text-center text-xs font-bold text-slate-900 dark:text-white">{g.positions}</td>
                      <td className="px-6 py-4 text-center text-xs font-bold text-slate-900 dark:text-white">{g.employees}</td>
                      <td className="px-6 py-4">
                        <div className="flex justify-center gap-2">
                          <button onClick={() => openEdit('grade', g)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                          <button onClick={() => deleteItem('grade', g.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
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

      {/* Benefit Plans */}
      {activeTab === 'benefits' && (
        <SectionCard>
          <div className="mb-4">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Benefit Plans</h3>
          </div>
          {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filteredPlans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Shield className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No benefit plans found.</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredPlans.map((plan) => {
                const Icon = BENEFIT_TYPE_ICON[plan.type] || Shield;
                const pct = plan.eligible > 0 ? Math.round((plan.enrolled / plan.eligible) * 100) : 0;
                return (
                  <Card key={plan.id} pad="md">
                    <div className="flex items-center justify-between mb-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${statusTone[BENEFIT_TYPE_TONE[plan.type] ?? 'neutral'].soft}`}>
                        <Icon size={20} />
                      </div>
                      <Badge tone={STATUS_TONE[plan.status] ?? 'neutral'}>{plan.status}</Badge>
                    </div>
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">{plan.name}</h4>
                    <p className="text-xs font-medium text-slate-400 mb-3">{plan.description}</p>
                    <div className="space-y-2 mb-3">
                      <div className="flex justify-between text-xs"><span className="font-bold text-slate-400">Coverage</span><span className="font-semibold text-slate-900 dark:text-white">{plan.coverage || '—'}</span></div>
                      <div className="flex justify-between text-xs"><span className="font-bold text-slate-400">Employer</span><span className="font-semibold text-emerald-600">{plan.employer_contribution}%</span></div>
                      <div className="flex justify-between text-xs"><span className="font-bold text-slate-400">Employee</span><span className="font-semibold text-slate-900 dark:text-white">{plan.employee_contribution}%</span></div>
                    </div>
                    <div className="pt-3 border-t border-slate-100 dark:border-slate-700">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-medium text-slate-400">Enrollment</span>
                        <span className="text-sm font-semibold text-slate-900 dark:text-white">{plan.enrolled}/{plan.eligible}</span>
                      </div>
                      <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden mt-1">
                        <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 mt-4">
                      <button onClick={() => openEdit('plan', plan)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                      <button onClick={() => deleteItem('plan', plan.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </SectionCard>
      )}

      {/* Additional Benefits */}
      {activeTab === 'insurance' && (
        <SectionCard>
          <div className="mb-4">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Additional Benefits</h3>
          </div>
          {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filteredAdditional.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Home className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No additional benefits found.</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredAdditional.map((b) => {
                const Icon = BENEFIT_TYPE_ICON[b.type] || Shield;
                return (
                  <Card key={b.id} pad="md">
                    <div className="flex items-center justify-between mb-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${statusTone[BENEFIT_TYPE_TONE[b.type] ?? 'neutral'].soft}`}>
                        <Icon size={20} />
                      </div>
                      <Badge tone={STATUS_TONE[b.status] ?? 'neutral'}>{b.status}</Badge>
                    </div>
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">{b.name}</h4>
                    <p className="text-xs font-medium text-slate-400 mb-3">{b.description}</p>
                    {b.type === 'Housing' && b.available != null && b.occupied != null ? (
                      <div className="space-y-2 mb-3">
                        <div className="flex justify-between text-xs"><span className="font-bold text-slate-400">Available</span><span className="font-semibold text-slate-900 dark:text-white">{b.available}</span></div>
                        <div className="flex justify-between text-xs"><span className="font-bold text-slate-400">Occupied</span><span className="font-semibold text-slate-900 dark:text-white">{b.occupied}</span></div>
                        <div className="flex justify-between text-xs"><span className="font-bold text-slate-400">Waiting List</span><span className="font-semibold text-amber-600">{b.waiting_list ?? 0}</span></div>
                      </div>
                    ) : (
                      <div className="pt-3 border-t border-slate-100 dark:border-slate-700 mb-3">
                        <div className="flex justify-between text-xs"><span className="font-bold text-slate-400">Coverage</span><span className="font-semibold text-slate-900 dark:text-white">{b.coverage || '—'}</span></div>
                      </div>
                    )}
                    <div className="flex justify-end gap-2">
                      <button onClick={() => openEdit('additional', b)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                      <button onClick={() => deleteItem('additional', b.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </SectionCard>
      )}

      {/* Allowances */}
      {activeTab === 'allowances' && (
        <SectionCard pad="none">
          <div className="p-6 border-b border-slate-50 dark:border-slate-800">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Allowances</h3>
          </div>
          {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filteredAllowances.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <FileText className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No allowances found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Allowance</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Type</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-right">Amount</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Eligible Employees</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Description</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {filteredAllowances.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-indigo-50 dark:bg-indigo-500/20 rounded-lg flex items-center justify-center">
                            <FileText className="text-indigo-600 dark:text-indigo-400" size={14} />
                          </div>
                          <span className="text-sm font-semibold text-slate-900 dark:text-white">{a.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4"><Badge tone={ALLOWANCE_TYPE_TONE[a.type] ?? 'neutral'}>{a.type}</Badge></td>
                      <td className="px-6 py-4 text-right text-xs font-bold text-slate-900 dark:text-white">${fmt(a.amount)}</td>
                      <td className="px-6 py-4 text-center text-xs font-bold text-slate-900 dark:text-white">{a.eligible_employees}</td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500 max-w-xs truncate">{a.description || '—'}</td>
                      <td className="px-6 py-4">
                        <div className="flex justify-center gap-2">
                          <button onClick={() => openEdit('allowance', a)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                          <button onClick={() => deleteItem('allowance', a.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
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

      {/* Modal */}
      <ModalSystem
        isOpen={!!modal}
        onClose={() => setModal(null)}
        onConfirm={save}
        title={modal ? `${modal.mode === 'create' ? 'Add' : 'Edit'} ${modal.type === 'grade' ? 'Salary Grade' : modal.type === 'plan' ? 'Benefit Plan' : modal.type === 'allowance' ? 'Allowance' : 'Additional Benefit'}` : ''}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        {modal?.type === 'grade' && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Grade"><input className={inputCls} value={gradeForm.grade} onChange={(e) => setGradeForm(f => ({ ...f, grade: e.target.value }))} /></Field>
            <Field label="Level"><input className={inputCls} value={gradeForm.level} onChange={(e) => setGradeForm(f => ({ ...f, level: e.target.value }))} /></Field>
            <Field label="Min Salary"><input type="number" className={inputCls} value={gradeForm.minSalary} onChange={(e) => setGradeForm(f => ({ ...f, minSalary: Number(e.target.value) }))} /></Field>
            <Field label="Max Salary"><input type="number" className={inputCls} value={gradeForm.maxSalary} onChange={(e) => setGradeForm(f => ({ ...f, maxSalary: Number(e.target.value) }))} /></Field>
            <Field label="Midpoint"><input type="number" className={inputCls} value={gradeForm.midpoint} onChange={(e) => setGradeForm(f => ({ ...f, midpoint: Number(e.target.value) }))} /></Field>
            <Field label="Positions"><input type="number" className={inputCls} value={gradeForm.positions} onChange={(e) => setGradeForm(f => ({ ...f, positions: Number(e.target.value) }))} /></Field>
            <Field label="Employees"><input type="number" className={inputCls} value={gradeForm.employees} onChange={(e) => setGradeForm(f => ({ ...f, employees: Number(e.target.value) }))} /></Field>
          </div>
        )}
        {modal?.type === 'plan' && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name"><input className={inputCls} value={planForm.name} onChange={(e) => setPlanForm(f => ({ ...f, name: e.target.value }))} /></Field>
            <Field label="Type">
              <select className={inputCls} value={planForm.type} onChange={(e) => setPlanForm(f => ({ ...f, type: e.target.value }))}>
                {['Health', 'Life', 'Retirement'].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <div className="col-span-2"><Field label="Description"><textarea className={inputCls} rows={2} value={planForm.description} onChange={(e) => setPlanForm(f => ({ ...f, description: e.target.value }))} /></Field></div>
            <Field label="Coverage"><input className={inputCls} value={planForm.coverage} onChange={(e) => setPlanForm(f => ({ ...f, coverage: e.target.value }))} /></Field>
            <Field label="Status">
              <select className={inputCls} value={planForm.status} onChange={(e) => setPlanForm(f => ({ ...f, status: e.target.value }))}>
                {['Active', 'Inactive', 'Pending'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Employer Contribution (%)"><input type="number" className={inputCls} value={planForm.employerContribution} onChange={(e) => setPlanForm(f => ({ ...f, employerContribution: Number(e.target.value) }))} /></Field>
            <Field label="Employee Contribution (%)"><input type="number" className={inputCls} value={planForm.employeeContribution} onChange={(e) => setPlanForm(f => ({ ...f, employeeContribution: Number(e.target.value) }))} /></Field>
            <Field label="Enrolled"><input type="number" className={inputCls} value={planForm.enrolled} onChange={(e) => setPlanForm(f => ({ ...f, enrolled: Number(e.target.value) }))} /></Field>
            <Field label="Eligible"><input type="number" className={inputCls} value={planForm.eligible} onChange={(e) => setPlanForm(f => ({ ...f, eligible: Number(e.target.value) }))} /></Field>
          </div>
        )}
        {modal?.type === 'allowance' && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name"><input className={inputCls} value={allowanceForm.name} onChange={(e) => setAllowanceForm(f => ({ ...f, name: e.target.value }))} /></Field>
            <Field label="Type">
              <select className={inputCls} value={allowanceForm.type} onChange={(e) => setAllowanceForm(f => ({ ...f, type: e.target.value }))}>
                {['Monthly', 'Daily', 'Annual'].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Amount"><input type="number" className={inputCls} value={allowanceForm.amount} onChange={(e) => setAllowanceForm(f => ({ ...f, amount: Number(e.target.value) }))} /></Field>
            <Field label="Eligible Employees"><input type="number" className={inputCls} value={allowanceForm.eligibleEmployees} onChange={(e) => setAllowanceForm(f => ({ ...f, eligibleEmployees: Number(e.target.value) }))} /></Field>
            <div className="col-span-2"><Field label="Description"><textarea className={inputCls} rows={2} value={allowanceForm.description} onChange={(e) => setAllowanceForm(f => ({ ...f, description: e.target.value }))} /></Field></div>
          </div>
        )}
        {modal?.type === 'additional' && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name"><input className={inputCls} value={additionalForm.name} onChange={(e) => setAdditionalForm(f => ({ ...f, name: e.target.value }))} /></Field>
            <Field label="Type">
              <select className={inputCls} value={additionalForm.type} onChange={(e) => setAdditionalForm(f => ({ ...f, type: e.target.value }))}>
                {['Housing', 'Food', 'Transport'].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className={inputCls} value={additionalForm.status} onChange={(e) => setAdditionalForm(f => ({ ...f, status: e.target.value }))}>
                {['Active', 'Inactive', 'Available', 'Full'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Coverage"><input className={inputCls} value={additionalForm.coverage} onChange={(e) => setAdditionalForm(f => ({ ...f, coverage: e.target.value }))} /></Field>
            <Field label="Available"><input className={inputCls} value={additionalForm.available} onChange={(e) => setAdditionalForm(f => ({ ...f, available: e.target.value }))} /></Field>
            <Field label="Occupied"><input className={inputCls} value={additionalForm.occupied} onChange={(e) => setAdditionalForm(f => ({ ...f, occupied: e.target.value }))} /></Field>
            <Field label="Waiting List"><input className={inputCls} value={additionalForm.waitingList} onChange={(e) => setAdditionalForm(f => ({ ...f, waitingList: e.target.value }))} /></Field>
            <div className="col-span-2"><Field label="Description"><textarea className={inputCls} rows={2} value={additionalForm.description} onChange={(e) => setAdditionalForm(f => ({ ...f, description: e.target.value }))} /></Field></div>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default CompensationBenefits;
