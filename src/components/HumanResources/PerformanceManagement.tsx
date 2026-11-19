/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HR Performance Management — workforce appraisals, KPI tracking and leaderboard.
 *
 * DB-integrated via /api/hr-portal/performance/* routes. Uses hr_performance_reviews
 * table (migration 424 adds score/kpi_metric and seeds data).
 *
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Target,
  TrendingUp,
  Award,
  AlertCircle,
  Search,
  Plus,
  Pencil,
  Trash2,
  ChevronRight,
  Star,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';

interface Review {
  id: string;
  employee_id: string;
  employee_name: string;
  period: string;
  due_date: string;
  status: 'Pending' | 'In Progress' | 'Completed';
  goals: number;
  completed: number;
  reviewer: string | null;
  score: number | null;
  kpi_metric: string | null;
  conduct_score: number | null;
  disciplinary_summary: string | null;
  linked_disciplinary_ids: string[];
  employees?: { department: string; position: string };
}

interface DisciplinaryAction {
  id: string;
  employee: string;
  employee_id: string | null;
  action_type: string;
  category: string | null;
  action_date: string | null;
  issued_by: string | null;
  description: string | null;
  status: string;
  expiry_date: string | null;
  score_impact: number;
  created_at: string;
}

interface Leader {
  name: string;
  score: number;
  dept: string;
}

interface Employee {
  id: string;
  name: string;
  department: string;
  position: string;
}

interface Stats {
  avgKpi: number;
  avgScoreLabel: string;
  avgScore: number;
  reviewsDue: number;
  performanceWarnings: number;
  completionRate: number;
  skillGrowth: string;
  reviewCount: number;
  totalActive: number;
}

const STATUS_TONE: Record<string, statusTone.StatusTone> = {
  Completed: 'success',
  'In Progress': 'warning',
  Pending: 'neutral',
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

const PerformanceManagement = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [stats, setStats] = useState<Stats>({ avgKpi: 0, avgScoreLabel: '0.0/5', avgScore: 0, reviewsDue: 0, performanceWarnings: 0, completionRate: 0, skillGrowth: '+12.4%', reviewCount: 0, totalActive: 0 });
  const [reviews, setReviews] = useState<Review[]>([]);
  const [leaderboard, setLeaderboard] = useState<Leader[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [disciplinaryActions, setDisciplinaryActions] = useState<DisciplinaryAction[]>([]);
  const [disciplinaryLoading, setDisciplinaryLoading] = useState(false);
  const [linkedIds, setLinkedIds] = useState<string[]>([]);
  const [form, setForm] = useState({
    employeeId: '',
    employeeName: '',
    period: 'Q2 2024',
    dueDate: '',
    status: 'Pending' as Review['status'],
    goals: 5,
    completed: 0,
    reviewer: '',
    score: '',
    kpiMetric: '',
    conductScore: '',
    disciplinarySummary: '',
  });

  const fetchStats = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/performance/statistics/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setStats(await res.json());
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchReviews = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'All') params.append('status', statusFilter);
      const res = await fetch(`/api/hr-portal/performance/reviews/${currentPropertyId}?${params.toString()}`, { headers: authHeaders() });
      if (res.ok) setReviews(((await res.json()) as { reviews: Review[] }).reviews || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId, statusFilter]);

  const fetchLeaderboard = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/performance/leaderboard/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setLeaderboard(((await res.json()) as { leaderboard: Leader[] }).leaderboard || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchEmployees = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/performance/employees/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setEmployees(((await res.json()) as { employees: Employee[] }).employees || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchDisciplinary = useCallback(async (employeeId: string) => {
    if (!employeeId) { setDisciplinaryActions([]); return; }
    setDisciplinaryLoading(true);
    try {
      const res = await fetch(`/api/hr-portal/performance/disciplinary/${employeeId}`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setDisciplinaryActions(data.actions || []);
      } else {
        setDisciplinaryActions([]);
      }
    } catch { setDisciplinaryActions([]); } finally { setDisciplinaryLoading(false); }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchStats(), fetchReviews(), fetchLeaderboard(), fetchEmployees()]);
    setLoading(false);
  }, [fetchStats, fetchReviews, fetchLeaderboard, fetchEmployees]);

  useEffect(() => { if (currentPropertyId) refresh(); }, [currentPropertyId]);
  useEffect(() => { if (currentPropertyId) { fetchReviews(); fetchStats(); } }, [statusFilter]);

  const filteredReviews = useMemo(() => {
    if (!search.trim()) return reviews;
    const q = search.toLowerCase();
    return reviews.filter((r) =>
      r.employee_name.toLowerCase().includes(q) ||
      (r.employees?.department || '').toLowerCase().includes(q) ||
      (r.kpi_metric || '').toLowerCase().includes(q) ||
      r.status.toLowerCase().includes(q)
    );
  }, [reviews, search]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ employeeId: '', employeeName: '', period: 'Q2 2024', dueDate: new Date().toISOString().slice(0, 10), status: 'Pending', goals: 5, completed: 0, reviewer: '', score: '', kpiMetric: '', conductScore: '', disciplinarySummary: '' });
    setDisciplinaryActions([]);
    setLinkedIds([]);
    setShowModal(true);
  };

  const openEdit = (r: Review) => {
    setEditingId(r.id);
    setForm({
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      period: r.period,
      dueDate: r.due_date,
      status: r.status,
      goals: r.goals,
      completed: r.completed,
      reviewer: r.reviewer || '',
      score: r.score != null ? String(r.score) : '',
      kpiMetric: r.kpi_metric || '',
      conductScore: r.conduct_score != null ? String(r.conduct_score) : '',
      disciplinarySummary: r.disciplinary_summary || '',
    });
    setLinkedIds(r.linked_disciplinary_ids || []);
    fetchDisciplinary(r.employee_id);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!currentPropertyId || !form.employeeId || !form.employeeName || !form.dueDate) return;
    setSaving(true);
    try {
      const body = {
        propertyId: currentPropertyId,
        employeeId: form.employeeId,
        employeeName: form.employeeName,
        period: form.period,
        dueDate: form.dueDate,
        status: form.status,
        goals: Number(form.goals) || 5,
        completed: Number(form.completed) || 0,
        reviewer: form.reviewer || null,
        score: form.score ? Number(form.score) : null,
        kpiMetric: form.kpiMetric || null,
        conductScore: form.conductScore ? Number(form.conductScore) : null,
        disciplinarySummary: form.disciplinarySummary || null,
        linkedDisciplinaryIds: linkedIds,
      };
      const endpoint = editingId ? `/api/hr-portal/performance/reviews/${editingId}` : '/api/hr-portal/performance/reviews';
      const method = editingId ? 'PUT' : 'POST';
      const res = await fetch(endpoint, { method, headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Review saved', 'success', 'HR');
      setShowModal(false); refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this review?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/performance/reviews/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Deleted', 'success', 'HR');
      refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const onSelectEmployee = (empId: string) => {
    const emp = employees.find((e) => e.id === empId);
    setForm((f) => ({ ...f, employeeId: empId, employeeName: emp?.name || '' }));
    setLinkedIds([]);
    fetchDisciplinary(empId);
  };

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Performance Management" subtitle="Track employee appraisals, KPIs and leaderboard" icon={Target} />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Target className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">Select a property to view performance data.</p>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Performance Management"
        subtitle="Track employee appraisals, KPIs and leaderboard"
        icon={Target}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refresh} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={openCreate} className={button.primary}><Plus className="w-4 h-4" /> Add Review</button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Avg Hotel KPI" value={`${stats.avgKpi}%`} caption={`Target: 90% · ${stats.avgScoreLabel}`} icon={Target} tone="accent" />
        <StatCard title="Reviews Due" value={String(stats.reviewsDue)} caption="This month" icon={Award} tone="success" />
        <StatCard title="Performance Warnings" value={String(stats.performanceWarnings)} caption="Score below 3" icon={AlertCircle} tone="danger" />
        <StatCard title="Skill Growth" value={stats.skillGrowth} caption="Last quarter" icon={TrendingUp} tone="info" />
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        {/* Appraisal Hub */}
        <SectionCard className="lg:col-span-8" pad="none">
          <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex flex-col md:flex-row md:items-center gap-4 justify-between">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Workforce Appraisal Hub</h3>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                <input type="text" placeholder="Search employee, dept, status..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-56 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans" />
              </div>
              <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2">
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-transparent text-xs text-slate-700 dark:text-slate-300 outline-none">
                  {['All', 'Pending', 'In Progress', 'Completed'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
          ) : filteredReviews.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Target className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No reviews found. Add the first one.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Employee</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">KPI Metric</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Review Score</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Conduct</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Status</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {filteredReviews.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold text-slate-900 dark:text-white block leading-none mb-1">{r.employee_name}</span>
                          <span className="text-xs font-medium text-slate-500 uppercase">{r.employees?.department || '—'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="text-xs font-medium text-indigo-600 uppercase">{r.kpi_metric || 'PENDING'}</span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="text-sm font-medium text-slate-900 dark:text-white">{r.score != null ? `${r.score.toFixed(1)}/5` : '---'}</span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        {r.conduct_score != null ? (
                          <span className={`text-sm font-medium ${Number(r.conduct_score) < 3 ? 'text-rose-500' : Number(r.conduct_score) < 4 ? 'text-amber-500' : 'text-emerald-500'}`}>{Number(r.conduct_score).toFixed(1)}/5</span>
                        ) : (r.linked_disciplinary_ids && r.linked_disciplinary_ids.length > 0 ? (
                          <Badge tone="warning">{r.linked_disciplinary_ids.length} linked</Badge>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        ))}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status}</Badge>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex justify-center gap-2">
                          <button onClick={() => openEdit(r)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                          <button onClick={() => handleDelete(r.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        {/* Leaderboard */}
        <SectionCard className="lg:col-span-4" pad="md">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-6">Performance Leaderboard</h3>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
          ) : leaderboard.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Star className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No completed reviews yet.</p>
            </div>
          ) : (
            <div className="space-y-5">
              {leaderboard.map((l, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex justify-between items-center text-sm font-medium tracking-tight">
                    <span className="text-slate-900 dark:text-white uppercase">{l.name}</span>
                    <div className="flex items-center gap-1">
                      <Star size={10} className="text-amber-500 fill-amber-500" />
                      <span className="text-slate-500">{Math.round(l.score)}%</span>
                    </div>
                  </div>
                  <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.min(l.score, 100)}%` }} />
                  </div>
                  <p className="text-xs font-medium text-slate-400 uppercase">{l.dept} Star Performance</p>
                </div>
              ))}
              <button className="w-full mt-4 py-3 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition shadow-sm">Appraisal Policy</button>
            </div>
          )}
        </SectionCard>
      </div>

      {/* Modal */}
      <ModalSystem
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onConfirm={handleSave}
        title={editingId ? 'Edit Performance Review' : 'New Performance Review'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Employee">
              <select className={inputCls} value={form.employeeId} onChange={(e) => onSelectEmployee(e.target.value)}>
                <option value="">Select employee</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name} — {e.department}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Employee Name"><input className={inputCls} value={form.employeeName} onChange={(e) => setForm(f => ({ ...f, employeeName: e.target.value }))} /></Field>
          <Field label="Review Period"><input className={inputCls} value={form.period} onChange={(e) => setForm(f => ({ ...f, period: e.target.value }))} /></Field>
          <Field label="Due Date"><input type="date" className={inputCls} value={form.dueDate} onChange={(e) => setForm(f => ({ ...f, dueDate: e.target.value }))} /></Field>
          <Field label="Status">
            <select className={inputCls} value={form.status} onChange={(e) => setForm(f => ({ ...f, status: e.target.value as Review['status'] }))}>
              {['Pending', 'In Progress', 'Completed'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Goals"><input type="number" className={inputCls} value={form.goals} onChange={(e) => setForm(f => ({ ...f, goals: Number(e.target.value) }))} /></Field>
          <Field label="Completed Goals"><input type="number" className={inputCls} value={form.completed} onChange={(e) => setForm(f => ({ ...f, completed: Number(e.target.value) }))} /></Field>
          <Field label="Score (0-5)"><input type="number" step="0.1" max={5} min={0} className={inputCls} value={form.score} onChange={(e) => setForm(f => ({ ...f, score: e.target.value }))} /></Field>
          <Field label="Reviewer"><input className={inputCls} value={form.reviewer} onChange={(e) => setForm(f => ({ ...f, reviewer: e.target.value }))} /></Field>
          <div className="col-span-2"><Field label="KPI Metric"><input className={inputCls} value={form.kpiMetric} onChange={(e) => setForm(f => ({ ...f, kpiMetric: e.target.value }))} /></Field></div>
        </div>

        {/* Disciplinary History */}
        {form.employeeId && (
          <div className="mt-6 border-t border-slate-200 dark:border-slate-700 pt-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="w-4 h-4 text-amber-500" />
              <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide">Disciplinary History</h4>
            </div>
            {disciplinaryLoading ? (
              <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</div>
            ) : disciplinaryActions.length === 0 ? (
              <p className="text-xs text-slate-400">No disciplinary actions on record for this employee.</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {disciplinaryActions.map((a) => (
                  <div key={a.id} className={`flex items-start gap-3 p-3 rounded-xl border ${a.status === 'Active' ? 'border-amber-200 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/5' : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-850'}`}>
                    <input
                      type="checkbox"
                      checked={linkedIds.includes(a.id)}
                      onChange={(e) => {
                        if (e.target.checked) setLinkedIds([...linkedIds, a.id]);
                        else setLinkedIds(linkedIds.filter((id) => id !== a.id));
                      }}
                      className="w-4 h-4 mt-0.5 rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-slate-900 dark:text-white">{a.action_type}</span>
                        {a.category && <span className="text-xs text-slate-500">· {a.category}</span>}
                        <Badge tone={a.status === 'Active' ? 'warning' : 'neutral'}>{a.status}</Badge>
                        {Number(a.score_impact) !== 0 && <span className="text-xs font-mono text-rose-500">Impact: {Number(a.score_impact).toFixed(1)}</span>}
                      </div>
                      {a.description && <p className="text-xs text-slate-500 mt-1">{a.description}</p>}
                      <p className="text-xs text-slate-400 mt-1">{a.action_date || '—'} · Issued by {a.issued_by || '—'}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {linkedIds.length > 0 && (
              <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                {linkedIds.length} disciplinary action(s) linked to this review
              </div>
            )}
          </div>
        )}

        {/* Conduct Score + Summary */}
        <div className="mt-4 grid grid-cols-2 gap-4">
          <Field label="Conduct Score (0-5)"><input type="number" step="0.1" max={5} min={0} className={inputCls} value={form.conductScore} onChange={(e) => setForm(f => ({ ...f, conductScore: e.target.value }))} placeholder="Adjusted for conduct" /></Field>
          <div className="col-span-2"><Field label="Disciplinary Summary"><textarea className={inputCls} rows={2} value={form.disciplinarySummary} onChange={(e) => setForm(f => ({ ...f, disciplinarySummary: e.target.value }))} placeholder="Summary of conduct issues factored into this review" /></Field></div>
        </div>
      </ModalSystem>
    </div>
  );
};

export default PerformanceManagement;
