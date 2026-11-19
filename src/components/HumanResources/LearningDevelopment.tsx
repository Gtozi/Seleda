/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HR Learning & Development — learning plans, mandatory training, leadership
 * programs, and learning history.
 *
 * DB-integrated via /api/hr-portal/learning/* routes. Uses tables from
 * migration 425.
 *
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  BookOpen,
  Target,
  Award,
  CheckCircle2,
  Clock,
  Plus,
  Search,
  Filter,
  TrendingUp,
  Users,
  XCircle,
  Pencil,
  Trash2,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge, Card } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';

type Tab = 'plans' | 'mandatory' | 'leadership' | 'history';

interface LearningPlan {
  id: string;
  employee: string;
  position: string | null;
  department: string | null;
  plan_name: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  progress: number;
  total_courses: number;
  completed_courses: number;
  assigned_by: string | null;
}

interface MandatoryTraining {
  id: string;
  name: string;
  category: string;
  duration: string | null;
  frequency: string | null;
  due_date: string | null;
  status: string;
  completion_rate: number;
  total_employees: number;
  completed_employees: number;
}

interface LeadershipProgram {
  id: string;
  name: string;
  description: string | null;
  duration: string | null;
  participants: number;
  status: string;
  start_date: string | null;
  end_date: string | null;
  modules: number;
}

interface LearningHistory {
  id: string;
  employee: string;
  course: string;
  category: string | null;
  completion_date: string | null;
  status: string;
  score: number;
  certificate: boolean;
}

interface Stats {
  activePlans: number;
  mandatoryCount: number;
  leadershipCount: number;
  completionRate: number;
  avgScore: number;
  historyCount: number;
}

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'plans', label: 'Learning Plans', icon: BookOpen },
  { id: 'mandatory', label: 'Mandatory Training', icon: Target },
  { id: 'leadership', label: 'Leadership Development', icon: Award },
  { id: 'history', label: 'Learning History', icon: Clock },
];

const PLAN_STATUS_TONE: Record<string, statusTone.StatusTone> = {
  Completed: 'success',
  'In Progress': 'accent',
  Pending: 'warning',
  Overdue: 'danger',
};

const TRAINING_STATUS_TONE: Record<string, statusTone.StatusTone> = { Active: 'success', Inactive: 'neutral', Completed: 'accent' };
const LEADERSHIP_STATUS_TONE: Record<string, statusTone.StatusTone> = { Active: 'success', Inactive: 'neutral', Completed: 'accent' };
const HISTORY_STATUS_TONE: Record<string, statusTone.StatusTone> = { Completed: 'success', 'In Progress': 'warning', Failed: 'danger' };

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

const LearningDevelopment = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [activeTab, setActiveTab] = useState<Tab>('plans');
  const [stats, setStats] = useState<Stats>({ activePlans: 0, mandatoryCount: 0, leadershipCount: 0, completionRate: 0, avgScore: 0, historyCount: 0 });
  const [plans, setPlans] = useState<LearningPlan[]>([]);
  const [training, setTraining] = useState<MandatoryTraining[]>([]);
  const [programs, setPrograms] = useState<LeadershipProgram[]>([]);
  const [history, setHistory] = useState<LearningHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<Tab>('plans');
  const [editingId, setEditingId] = useState<string | null>(null);

  const [planForm, setPlanForm] = useState({ employee: '', position: '', department: '', planName: '', startDate: '', endDate: '', status: 'In Progress', progress: 0, totalCourses: 8, completedCourses: 0, assignedBy: '' });
  const [trainingForm, setTrainingForm] = useState({ name: '', category: 'Safety', duration: '', frequency: 'Annual', dueDate: '', status: 'Active', completionRate: 0, totalEmployees: 0, completedEmployees: 0 });
  const [programForm, setProgramForm] = useState({ name: '', description: '', duration: '', participants: 0, status: 'Active', startDate: '', endDate: '', modules: 0 });
  const [historyForm, setHistoryForm] = useState({ employee: '', course: '', category: '', completionDate: '', status: 'Completed', score: 0, certificate: false });

  const fetchStats = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/learning/statistics/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setStats(await res.json());
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchPlans = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/learning/plans/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setPlans(((await res.json()) as { plans: LearningPlan[] }).plans || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchTraining = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/learning/mandatory/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setTraining(((await res.json()) as { training: MandatoryTraining[] }).training || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchPrograms = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/learning/leadership/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setPrograms(((await res.json()) as { programs: LeadershipProgram[] }).programs || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchHistory = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/learning/history/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setHistory(((await res.json()) as { history: LearningHistory[] }).history || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchStats(), fetchPlans(), fetchTraining(), fetchPrograms(), fetchHistory()]);
    setLoading(false);
  }, [fetchStats, fetchPlans, fetchTraining, fetchPrograms, fetchHistory]);

  useEffect(() => { if (currentPropertyId) refresh(); }, [currentPropertyId]);

  const filteredPlans = useMemo(() => {
    if (!search.trim()) return plans;
    const q = search.toLowerCase();
    return plans.filter((p) => (p.employee || '').toLowerCase().includes(q) || (p.plan_name || '').toLowerCase().includes(q) || (p.department || '').toLowerCase().includes(q));
  }, [plans, search]);

  const filteredTraining = useMemo(() => {
    if (!search.trim()) return training;
    const q = search.toLowerCase();
    return training.filter((t) => t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q));
  }, [training, search]);

  const filteredPrograms = useMemo(() => {
    if (!search.trim()) return programs;
    const q = search.toLowerCase();
    return programs.filter((p) => p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q));
  }, [programs, search]);

  const filteredHistory = useMemo(() => {
    if (!search.trim()) return history;
    const q = search.toLowerCase();
    return history.filter((h) => h.employee.toLowerCase().includes(q) || h.course.toLowerCase().includes(q) || (h.category || '').toLowerCase().includes(q));
  }, [history, search]);

  const openCreate = (type: Tab) => {
    setModalType(type); setEditingId(null);
    if (type === 'plans') setPlanForm({ employee: '', position: '', department: '', planName: '', startDate: '', endDate: '', status: 'In Progress', progress: 0, totalCourses: 8, completedCourses: 0, assignedBy: '' });
    if (type === 'mandatory') setTrainingForm({ name: '', category: 'Safety', duration: '', frequency: 'Annual', dueDate: '', status: 'Active', completionRate: 0, totalEmployees: 0, completedEmployees: 0 });
    if (type === 'leadership') setProgramForm({ name: '', description: '', duration: '', participants: 0, status: 'Active', startDate: '', endDate: '', modules: 0 });
    if (type === 'history') setHistoryForm({ employee: '', course: '', category: '', completionDate: '', status: 'Completed', score: 0, certificate: false });
    setShowModal(true);
  };

  const openEdit = (type: Tab, item: any) => {
    setModalType(type); setEditingId(item.id);
    if (type === 'plans') setPlanForm({ employee: item.employee, position: item.position || '', department: item.department || '', planName: item.plan_name, startDate: item.start_date || '', endDate: item.end_date || '', status: item.status, progress: Number(item.progress), totalCourses: Number(item.total_courses), completedCourses: Number(item.completed_courses), assignedBy: item.assigned_by || '' });
    if (type === 'mandatory') setTrainingForm({ name: item.name, category: item.category, duration: item.duration || '', frequency: item.frequency || '', dueDate: item.due_date || '', status: item.status, completionRate: Number(item.completion_rate), totalEmployees: Number(item.total_employees), completedEmployees: Number(item.completed_employees) });
    if (type === 'leadership') setProgramForm({ name: item.name, description: item.description || '', duration: item.duration || '', participants: Number(item.participants), status: item.status, startDate: item.start_date || '', endDate: item.end_date || '', modules: Number(item.modules) });
    if (type === 'history') setHistoryForm({ employee: item.employee, course: item.course, category: item.category || '', completionDate: item.completion_date || '', status: item.status, score: Number(item.score), certificate: Boolean(item.certificate) });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!currentPropertyId || !modalType) return;
    setSaving(true);
    try {
      let endpoint = '';
      let method: 'POST' | 'PUT' = 'POST';
      let body: any = { propertyId: currentPropertyId };

      if (modalType === 'plans') {
        endpoint = editingId ? `/api/hr-portal/learning/plans/${editingId}` : '/api/hr-portal/learning/plans';
        method = editingId ? 'PUT' : 'POST';
        body = { ...body, employee: planForm.employee, position: planForm.position, department: planForm.department, planName: planForm.planName, startDate: planForm.startDate, endDate: planForm.endDate, status: planForm.status, progress: planForm.progress, totalCourses: planForm.totalCourses, completedCourses: planForm.completedCourses, assignedBy: planForm.assignedBy };
      } else if (modalType === 'mandatory') {
        endpoint = editingId ? `/api/hr-portal/learning/mandatory/${editingId}` : '/api/hr-portal/learning/mandatory';
        method = editingId ? 'PUT' : 'POST';
        body = { ...body, name: trainingForm.name, category: trainingForm.category, duration: trainingForm.duration, frequency: trainingForm.frequency, dueDate: trainingForm.dueDate, status: trainingForm.status, completionRate: trainingForm.completionRate, totalEmployees: trainingForm.totalEmployees, completedEmployees: trainingForm.completedEmployees };
      } else if (modalType === 'leadership') {
        endpoint = editingId ? `/api/hr-portal/learning/leadership/${editingId}` : '/api/hr-portal/learning/leadership';
        method = editingId ? 'PUT' : 'POST';
        body = { ...body, name: programForm.name, description: programForm.description, duration: programForm.duration, participants: programForm.participants, status: programForm.status, startDate: programForm.startDate, endDate: programForm.endDate, modules: programForm.modules };
      } else if (modalType === 'history') {
        endpoint = editingId ? `/api/hr-portal/learning/history/${editingId}` : '/api/hr-portal/learning/history';
        method = editingId ? 'PUT' : 'POST';
        body = { ...body, employee: historyForm.employee, course: historyForm.course, category: historyForm.category, completionDate: historyForm.completionDate, status: historyForm.status, score: historyForm.score, certificate: historyForm.certificate };
      }

      const res = await fetch(endpoint, { method, headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Saved', 'success', 'HR');
      setShowModal(false); refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const handleDelete = async (type: Tab, id: string) => {
    if (!confirm('Delete this record?')) return;
    setSaving(true);
    const endpoint = type === 'plans' ? `/api/hr-portal/learning/plans/${id}` : type === 'mandatory' ? `/api/hr-portal/learning/mandatory/${id}` : type === 'leadership' ? `/api/hr-portal/learning/leadership/${id}` : `/api/hr-portal/learning/history/${id}`;
    try {
      const res = await fetch(endpoint, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Deleted', 'success', 'HR');
      refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const tabLabel = activeTab === 'plans' ? 'Add Plan' : activeTab === 'mandatory' ? 'Add Training' : activeTab === 'leadership' ? 'Add Program' : 'Add Record';

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Learning & Development" subtitle="Manage learning plans, mandatory training, and leadership development" icon={BookOpen} />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <BookOpen className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">Select a property to view learning data.</p>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Learning & Development"
        subtitle="Manage learning plans, mandatory training, and leadership development"
        icon={BookOpen}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refresh} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={() => openCreate(activeTab)} className={button.primary}><Plus className="w-4 h-4" /> {tabLabel}</button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Active Plans" value={String(stats.activePlans)} caption="In progress / pending" icon={BookOpen} tone="accent" />
        <StatCard title="Mandatory Training" value={String(stats.mandatoryCount)} caption="Active requirements" icon={Target} tone="danger" />
        <StatCard title="Leadership Programs" value={String(stats.leadershipCount)} caption="Running programs" icon={Award} tone="warning" />
        <StatCard title="Completion Rate" value={`${stats.completionRate}%`} caption={`Avg score ${stats.avgScore}%`} icon={TrendingUp} tone="success" />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto">
        {TABS.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${activeTab === tab.id ? 'bg-white dark:bg-slate-700 text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
            <tab.icon size={14} /> {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
        <input type="text" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans" />
      </div>

      {/* Learning Plans */}
      {activeTab === 'plans' && (
        <SectionCard>
          <div className="mb-4"><h3 className="text-base font-semibold text-slate-900 dark:text-white">Learning Plans</h3></div>
          {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filteredPlans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <BookOpen className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No learning plans found.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredPlans.map((p) => (
                <Card key={p.id} pad="md">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-500/20 rounded-xl flex items-center justify-center">
                        <BookOpen className="text-indigo-600 dark:text-indigo-400" size={20} />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{p.plan_name}</h4>
                        <p className="text-xs font-medium text-slate-400">{p.employee} · {p.position || '—'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={PLAN_STATUS_TONE[p.status] ?? 'neutral'}>{p.status}</Badge>
                      <button onClick={() => openEdit('plans', p)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                      <button onClick={() => handleDelete('plans', p.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                    </div>
                  </div>
                  <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden mb-3">
                    <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${p.progress}%` }} />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div><span className="font-bold text-slate-400 block">Progress</span><span className="font-semibold text-slate-900 dark:text-white">{p.progress}%</span></div>
                    <div><span className="font-bold text-slate-400 block">Courses</span><span className="font-semibold text-slate-900 dark:text-white">{p.completed_courses}/{p.total_courses}</span></div>
                    <div><span className="font-bold text-slate-400 block">End Date</span><span className="font-semibold text-slate-900 dark:text-white">{p.end_date || '—'}</span></div>
                    <div><span className="font-bold text-slate-400 block">Assigned By</span><span className="font-semibold text-slate-900 dark:text-white">{p.assigned_by || '—'}</span></div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* Mandatory Training */}
      {activeTab === 'mandatory' && (
        <SectionCard>
          <div className="mb-4"><h3 className="text-base font-semibold text-slate-900 dark:text-white">Mandatory Training</h3></div>
          {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filteredTraining.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Target className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No mandatory training found.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredTraining.map((t) => (
                <Card key={t.id} pad="md">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-rose-100 dark:bg-rose-500/20 rounded-xl flex items-center justify-center">
                        <Target className="text-rose-600 dark:text-rose-400" size={20} />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{t.name}</h4>
                        <p className="text-xs font-medium text-slate-400">{t.category} · {t.duration || '—'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={TRAINING_STATUS_TONE[t.status] ?? 'neutral'}>{t.status}</Badge>
                      <button onClick={() => openEdit('mandatory', t)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                      <button onClick={() => handleDelete('mandatory', t.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-32 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${t.completion_rate}%` }} />
                      </div>
                      <span className="text-sm font-semibold text-slate-900 dark:text-white">{t.completion_rate}%</span>
                    </div>
                    <span className="text-xs font-bold text-slate-400">{t.completed_employees}/{t.total_employees} completed</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><span className="font-bold text-slate-400 block">Frequency</span><span className="font-semibold text-slate-900 dark:text-white">{t.frequency || '—'}</span></div>
                    <div><span className="font-bold text-slate-400 block">Due Date</span><span className="font-semibold text-slate-900 dark:text-white">{t.due_date || '—'}</span></div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* Leadership Programs */}
      {activeTab === 'leadership' && (
        <SectionCard>
          <div className="mb-4"><h3 className="text-base font-semibold text-slate-900 dark:text-white">Leadership Programs</h3></div>
          {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filteredPrograms.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Award className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No leadership programs found.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredPrograms.map((p) => (
                <Card key={p.id} pad="md">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-amber-100 dark:bg-amber-500/20 rounded-xl flex items-center justify-center">
                        <Award className="text-amber-600 dark:text-amber-400" size={20} />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{p.name}</h4>
                        <p className="text-xs font-medium text-slate-400">{p.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={LEADERSHIP_STATUS_TONE[p.status] ?? 'neutral'}>{p.status}</Badge>
                      <button onClick={() => openEdit('leadership', p)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                      <button onClick={() => handleDelete('leadership', p.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div><span className="font-bold text-slate-400 block">Duration</span><span className="font-semibold text-slate-900 dark:text-white">{p.duration || '—'}</span></div>
                    <div><span className="font-bold text-slate-400 block">Participants</span><span className="font-semibold text-slate-900 dark:text-white">{p.participants}</span></div>
                    <div><span className="font-bold text-slate-400 block">Modules</span><span className="font-semibold text-slate-900 dark:text-white">{p.modules}</span></div>
                    <div><span className="font-bold text-slate-400 block">End Date</span><span className="font-semibold text-slate-900 dark:text-white">{p.end_date || '—'}</span></div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* Learning History */}
      {activeTab === 'history' && (
        <SectionCard pad="none">
          <div className="p-6 border-b border-slate-50 dark:border-slate-800">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Learning History</h3>
          </div>
          {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filteredHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Clock className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No learning history found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Employee</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Course</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Category</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Completion Date</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Score</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Certificate</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {filteredHistory.map((h) => (
                    <tr key={h.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4 text-sm font-semibold text-slate-900 dark:text-white">{h.employee}</td>
                      <td className="px-6 py-4 text-xs font-bold text-slate-900 dark:text-white">{h.course}</td>
                      <td className="px-6 py-4"><Badge tone="neutral">{h.category || '—'}</Badge></td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500">{h.completion_date || '—'}</td>
                      <td className="px-6 py-4 text-center text-sm font-semibold text-slate-900 dark:text-white">{h.score}%</td>
                      <td className="px-6 py-4 text-center">{h.certificate ? <CheckCircle2 className="text-emerald-500 mx-auto" size={16} /> : <XCircle className="text-slate-300 mx-auto" size={16} />}</td>
                      <td className="px-6 py-4">
                        <div className="flex justify-center gap-2">
                          <button onClick={() => openEdit('history', h)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                          <button onClick={() => handleDelete('history', h.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
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
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onConfirm={handleSave}
        title={editingId ? `Edit ${modalType === 'plans' ? 'Learning Plan' : modalType === 'mandatory' ? 'Mandatory Training' : modalType === 'leadership' ? 'Leadership Program' : 'History Record'}` : `Add ${modalType === 'plans' ? 'Learning Plan' : modalType === 'mandatory' ? 'Mandatory Training' : modalType === 'leadership' ? 'Leadership Program' : 'History Record'}`}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        {modalType === 'plans' && (
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2"><Field label="Plan Name"><input className={inputCls} value={planForm.planName} onChange={(e) => setPlanForm(f => ({ ...f, planName: e.target.value }))} /></Field></div>
            <Field label="Employee"><input className={inputCls} value={planForm.employee} onChange={(e) => setPlanForm(f => ({ ...f, employee: e.target.value }))} /></Field>
            <Field label="Position"><input className={inputCls} value={planForm.position} onChange={(e) => setPlanForm(f => ({ ...f, position: e.target.value }))} /></Field>
            <Field label="Department"><input className={inputCls} value={planForm.department} onChange={(e) => setPlanForm(f => ({ ...f, department: e.target.value }))} /></Field>
            <Field label="Status">
              <select className={inputCls} value={planForm.status} onChange={(e) => setPlanForm(f => ({ ...f, status: e.target.value }))}>
                {['Pending', 'In Progress', 'Completed', 'Overdue'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Start Date"><input type="date" className={inputCls} value={planForm.startDate} onChange={(e) => setPlanForm(f => ({ ...f, startDate: e.target.value }))} /></Field>
            <Field label="End Date"><input type="date" className={inputCls} value={planForm.endDate} onChange={(e) => setPlanForm(f => ({ ...f, endDate: e.target.value }))} /></Field>
            <Field label="Total Courses"><input type="number" className={inputCls} value={planForm.totalCourses} onChange={(e) => setPlanForm(f => ({ ...f, totalCourses: Number(e.target.value) }))} /></Field>
            <Field label="Completed Courses"><input type="number" className={inputCls} value={planForm.completedCourses} onChange={(e) => setPlanForm(f => ({ ...f, completedCourses: Number(e.target.value) }))} /></Field>
            <Field label="Progress (%)"><input type="number" className={inputCls} value={planForm.progress} onChange={(e) => setPlanForm(f => ({ ...f, progress: Number(e.target.value) }))} /></Field>
            <Field label="Assigned By"><input className={inputCls} value={planForm.assignedBy} onChange={(e) => setPlanForm(f => ({ ...f, assignedBy: e.target.value }))} /></Field>
          </div>
        )}
        {modalType === 'mandatory' && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name"><input className={inputCls} value={trainingForm.name} onChange={(e) => setTrainingForm(f => ({ ...f, name: e.target.value }))} /></Field>
            <Field label="Category"><input className={inputCls} value={trainingForm.category} onChange={(e) => setTrainingForm(f => ({ ...f, category: e.target.value }))} /></Field>
            <Field label="Duration"><input className={inputCls} value={trainingForm.duration} onChange={(e) => setTrainingForm(f => ({ ...f, duration: e.target.value }))} /></Field>
            <Field label="Frequency"><input className={inputCls} value={trainingForm.frequency} onChange={(e) => setTrainingForm(f => ({ ...f, frequency: e.target.value }))} /></Field>
            <Field label="Due Date"><input type="date" className={inputCls} value={trainingForm.dueDate} onChange={(e) => setTrainingForm(f => ({ ...f, dueDate: e.target.value }))} /></Field>
            <Field label="Status">
              <select className={inputCls} value={trainingForm.status} onChange={(e) => setTrainingForm(f => ({ ...f, status: e.target.value }))}>
                {['Active', 'Inactive', 'Completed'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Total Employees"><input type="number" className={inputCls} value={trainingForm.totalEmployees} onChange={(e) => setTrainingForm(f => ({ ...f, totalEmployees: Number(e.target.value) }))} /></Field>
            <Field label="Completed Employees"><input type="number" className={inputCls} value={trainingForm.completedEmployees} onChange={(e) => setTrainingForm(f => ({ ...f, completedEmployees: Number(e.target.value) }))} /></Field>
            <Field label="Completion Rate (%)"><input type="number" className={inputCls} value={trainingForm.completionRate} onChange={(e) => setTrainingForm(f => ({ ...f, completionRate: Number(e.target.value) }))} /></Field>
          </div>
        )}
        {modalType === 'leadership' && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name"><input className={inputCls} value={programForm.name} onChange={(e) => setProgramForm(f => ({ ...f, name: e.target.value }))} /></Field>
            <Field label="Duration"><input className={inputCls} value={programForm.duration} onChange={(e) => setProgramForm(f => ({ ...f, duration: e.target.value }))} /></Field>
            <Field label="Participants"><input type="number" className={inputCls} value={programForm.participants} onChange={(e) => setProgramForm(f => ({ ...f, participants: Number(e.target.value) }))} /></Field>
            <Field label="Modules"><input type="number" className={inputCls} value={programForm.modules} onChange={(e) => setProgramForm(f => ({ ...f, modules: Number(e.target.value) }))} /></Field>
            <Field label="Start Date"><input type="date" className={inputCls} value={programForm.startDate} onChange={(e) => setProgramForm(f => ({ ...f, startDate: e.target.value }))} /></Field>
            <Field label="End Date"><input type="date" className={inputCls} value={programForm.endDate} onChange={(e) => setProgramForm(f => ({ ...f, endDate: e.target.value }))} /></Field>
            <Field label="Status">
              <select className={inputCls} value={programForm.status} onChange={(e) => setProgramForm(f => ({ ...f, status: e.target.value }))}>
                {['Active', 'Inactive', 'Completed'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <div className="col-span-2"><Field label="Description"><textarea className={inputCls} rows={2} value={programForm.description} onChange={(e) => setProgramForm(f => ({ ...f, description: e.target.value }))} /></Field></div>
          </div>
        )}
        {modalType === 'history' && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Employee"><input className={inputCls} value={historyForm.employee} onChange={(e) => setHistoryForm(f => ({ ...f, employee: e.target.value }))} /></Field>
            <Field label="Course"><input className={inputCls} value={historyForm.course} onChange={(e) => setHistoryForm(f => ({ ...f, course: e.target.value }))} /></Field>
            <Field label="Category"><input className={inputCls} value={historyForm.category} onChange={(e) => setHistoryForm(f => ({ ...f, category: e.target.value }))} /></Field>
            <Field label="Completion Date"><input type="date" className={inputCls} value={historyForm.completionDate} onChange={(e) => setHistoryForm(f => ({ ...f, completionDate: e.target.value }))} /></Field>
            <Field label="Status">
              <select className={inputCls} value={historyForm.status} onChange={(e) => setHistoryForm(f => ({ ...f, status: e.target.value }))}>
                {['Completed', 'In Progress', 'Failed'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Score (%) 0-100"><input type="number" className={inputCls} value={historyForm.score} onChange={(e) => setHistoryForm(f => ({ ...f, score: Number(e.target.value) }))} /></Field>
            <div className="col-span-2 flex items-center gap-2">
              <input type="checkbox" checked={historyForm.certificate} onChange={(e) => setHistoryForm(f => ({ ...f, certificate: e.target.checked }))} className="rounded text-indigo-600" />
              <span className="text-sm text-slate-700 dark:text-slate-300">Certificate issued</span>
            </div>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default LearningDevelopment;
