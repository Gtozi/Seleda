import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Hammer,
  Search,
  Plus,
  Calendar,
  Clock,
  CheckCircle2,
  AlertTriangle,
  MapPin,
  User,
  ChevronRight,
  DollarSign,
  TrendingUp,
  Building2,
  Paintbrush,
  Wrench,
  Zap,
  Droplets,
  Loader2,
  ServerCrash,
  MoreVertical,
  Trash2,
  ArrowRight,
  Pause,
  Play,
  XCircle,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchProjects,
  createProject,
  updateProject,
  deleteProject,
  addProjectPhase,
  updateProjectPhase,
  deleteProjectPhase,
  type Project,
  type ProjectPhase,
  type ProjectType,
  type ProjectCategory,
  type ProjectStatus,
  type ProjectPriority,
  type ProjectPhaseStatus,
} from '../../services/engineeringService';

// ── Static registries ────────────────────────────────────────────────────

const ALL_TYPES: ProjectType[] = ['Renovation', 'Upgrade', 'New Construction', 'Refurbishment', 'Expansion'];
const ALL_CATEGORIES: ProjectCategory[] = ['Guest Rooms', 'Public Areas', 'Kitchen', 'Exterior', 'Infrastructure', 'Energy Efficiency'];
const ALL_PRIORITIES: ProjectPriority[] = ['Critical', 'High', 'Normal', 'Low'];
const STATUS_FLOW: ProjectStatus[] = ['Planning', 'Approved', 'In Progress', 'On Hold', 'Completed', 'Cancelled'];

const TYPE_ICON: Record<ProjectType, LucideIcon> = {
  Renovation: Paintbrush,
  Upgrade: TrendingUp,
  'New Construction': Building2,
  Refurbishment: Wrench,
  Expansion: Building2,
};

const CATEGORY_ICON: Record<ProjectCategory, LucideIcon> = {
  'Guest Rooms': Building2,
  'Public Areas': Building2,
  Kitchen: Wrench,
  Exterior: Building2,
  Infrastructure: Zap,
  'Energy Efficiency': Droplets,
};

const STATUS_TONE: Record<ProjectStatus, StatusTone> = {
  Planning: 'neutral',
  Approved: 'info',
  'In Progress': 'warning',
  'On Hold': 'warning',
  Completed: 'success',
  Cancelled: 'danger',
};

const PRIORITY_TONE: Record<ProjectPriority, StatusTone> = {
  Critical: 'danger',
  High: 'warning',
  Normal: 'info',
  Low: 'neutral',
};

const PHASE_STATUS_TONE: Record<ProjectPhaseStatus, StatusTone> = {
  Pending: 'neutral',
  'In Progress': 'warning',
  Completed: 'success',
  'On Hold': 'warning',
};

// Next available status transitions for each status.
const NEXT_ACTIONS: Record<ProjectStatus, ProjectStatus[]> = {
  Planning: ['Approved', 'Cancelled'],
  Approved: ['In Progress', 'Cancelled'],
  'In Progress': ['On Hold', 'Completed', 'Cancelled'],
  'On Hold': ['In Progress', 'Cancelled'],
  Completed: [],
  Cancelled: [],
};

const ACTION_LABELS: Record<ProjectStatus, string> = {
  Planning: 'Approve',
  Approved: 'Start',
  'In Progress': 'Complete',
  'On Hold': 'Resume',
  Completed: 'Completed',
  Cancelled: 'Cancelled',
};

const PROJECT_MANAGER_OPTIONS = [
  'John Project Manager',
  'Sarah Project Manager',
  'Michael Project Manager',
  'David Project Manager',
  'Lisa Project Manager',
  'General Maintenance Team',
  'External Contractor',
] as const;

// ── Field helper ─────────────────────────────────────────────────────────

const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function fmtDay(s: string | null): string {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  return Number(n).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

// ── Component ────────────────────────────────────────────────────────────

const ProjectsRenovations: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<'All' | ProjectStatus>('All');
  const [typeFilter, setTypeFilter] = useState<'All' | ProjectType>('All');
  const [categoryFilter, setCategoryFilter] = useState<'All' | ProjectCategory>('All');
  const [priorityFilter, setPriorityFilter] = useState<'All' | ProjectPriority>('All');
  const [search, setSearch] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<{
    name: string;
    type: ProjectType;
    category: ProjectCategory;
    location: string;
    description: string;
    priority: ProjectPriority;
    startDate: string;
    targetCompletionDate: string;
    projectManager: string;
    budget: string;
    spent: string;
    progress: string;
    phases: Array<{ name: string }>;
  }>({
    name: '', type: 'Renovation', category: 'Guest Rooms', location: '', description: '',
    priority: 'Normal', startDate: '', targetCompletionDate: '', projectManager: '',
    budget: '', spent: '', progress: '', phases: [],
  });

  const [detail, setDetail] = useState<Project | null>(null);
  const [detailReadOnly, setDetailReadOnly] = useState(true);
  const [detailForm, setDetailForm] = useState<{
    projectManager: string;
    budget: string;
    spent: string;
    progress: string;
    startDate: string;
    targetCompletionDate: string;
    actualCompletionDate: string;
  }>({
    projectManager: '', budget: '', spent: '', progress: '',
    startDate: '', targetCompletionDate: '', actualCompletionDate: '',
  });
  const [savingDetail, setSavingDetail] = useState(false);
  const [newPhaseName, setNewPhaseName] = useState('');
  const [phaseActingOn, setPhaseActingOn] = useState<string | null>(null);

  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  // ── Load ────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchProjects({
        propertyId: currentPropertyId || undefined,
      });
      setProjects(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  // ── Derived list ───────────────────────────────────────────────────────
  const filtered = useMemo(
    () =>
      projects.filter(p => {
        const matchesStatus = statusFilter === 'All' || p.status === statusFilter;
        const matchesType = typeFilter === 'All' || p.type === typeFilter;
        const matchesCategory = categoryFilter === 'All' || p.category === categoryFilter;
        const matchesPriority = priorityFilter === 'All' || p.priority === priorityFilter;
        const q = search.trim().toLowerCase();
        const matchesSearch =
          !q ||
          p.prj_number.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.location.toLowerCase().includes(q) ||
          (p.project_manager || '').toLowerCase().includes(q);
        return matchesStatus && matchesType && matchesCategory && matchesPriority && matchesSearch;
      }),
    [projects, statusFilter, typeFilter, categoryFilter, priorityFilter, search]
  );

  const totals = {
    count: projects.length,
    inProgress: projects.filter(p => p.status === 'In Progress').length,
    completed: projects.filter(p => p.status === 'Completed').length,
    budget: projects.reduce((acc, p) => acc + Number(p.budget || 0), 0),
    spent: projects.reduce((acc, p) => acc + Number(p.spent || 0), 0),
  };

  // ── Actions ────────────────────────────────────────────────────────────
  const submitCreate = async () => {
    if (!form.name.trim() || !form.type || !form.category || !form.location.trim() || !form.description.trim()) return;
    setSubmitting(true);
    try {
      const created = await createProject({
        propertyId: currentPropertyId || undefined,
        name: form.name.trim(),
        type: form.type,
        category: form.category,
        location: form.location.trim(),
        description: form.description.trim(),
        priority: form.priority,
        startDate: form.startDate || undefined,
        targetCompletionDate: form.targetCompletionDate || undefined,
        projectManager: form.projectManager.trim() || undefined,
        budget: form.budget ? Number(form.budget) : 0,
        spent: form.spent ? Number(form.spent) : 0,
        progress: form.progress ? Number(form.progress) : 0,
        phases: form.phases.filter(p => p.name.trim()).map(p => ({ name: p.name.trim() })),
      });
      setProjects(prev => [created, ...prev]);
      addNotification(`Project ${created.prj_number} created for ${created.name}.`, 'task', 'Maintenance');
      setShowForm(false);
      setForm({
        name: '', type: 'Renovation', category: 'Guest Rooms', location: '', description: '',
        priority: 'Normal', startDate: '', targetCompletionDate: '', projectManager: '',
        budget: '', spent: '', progress: '', phases: [],
      });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create project', 'warning', 'Maintenance');
    } finally {
      setSubmitting(false);
    }
  };

  const changeStatus = async (id: string, status: ProjectStatus) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      const { project } = await updateProject(id, { status });
      setProjects(prev => prev.map(p => (p.id === id ? { ...p, ...project, phases: p.phases } : p)));
      addNotification(`Project ${project.prj_number} → ${status}.`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || `Failed to update status to ${status}`, 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const saveDetail = async () => {
    if (!detail) return;
    setSavingDetail(true);
    try {
      const { project } = await updateProject(detail.id, {
        projectManager: detailForm.projectManager.trim() || null,
        budget: detailForm.budget ? Number(detailForm.budget) : 0,
        spent: detailForm.spent ? Number(detailForm.spent) : 0,
        progress: detailForm.progress ? Number(detailForm.progress) : 0,
        startDate: detailForm.startDate || null,
        targetCompletionDate: detailForm.targetCompletionDate || null,
        actualCompletionDate: detailForm.actualCompletionDate || null,
      });
      setProjects(prev => prev.map(p => (p.id === detail.id ? { ...p, ...project, phases: p.phases } : p)));
      setDetail({ ...detail, ...project, phases: detail.phases });
      setDetailReadOnly(true);
      addNotification(`Project ${project.prj_number} details updated.`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update project details', 'warning', 'Maintenance');
    } finally {
      setSavingDetail(false);
    }
  };

  const doDelete = async (id: string) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      await deleteProject(id);
      setProjects(prev => prev.filter(p => p.id !== id));
      addNotification(`Project ${id} deleted.`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete project', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const openDetail = (p: Project) => {
    setDetail(p);
    setDetailReadOnly(true);
    setDetailForm({
      projectManager: p.project_manager || '',
      budget: p.budget != null ? String(p.budget) : '',
      spent: p.spent != null ? String(p.spent) : '',
      progress: p.progress != null ? String(p.progress) : '',
      startDate: p.start_date ? p.start_date.slice(0, 10) : '',
      targetCompletionDate: p.target_completion_date ? p.target_completion_date.slice(0, 10) : '',
      actualCompletionDate: p.actual_completion_date ? p.actual_completion_date.slice(0, 10) : '',
    });
  };

  // ── Phase actions ──────────────────────────────────────────────────────
  const addPhase = async () => {
    if (!detail || !newPhaseName.trim()) return;
    setPhaseActingOn('new');
    try {
      const phase = await addProjectPhase(detail.id, { name: newPhaseName.trim() });
      const updatedPhases = [...(detail.phases || []), phase];
      setDetail({ ...detail, phases: updatedPhases });
      setProjects(prev => prev.map(p => (p.id === detail.id ? { ...p, phases: updatedPhases } : p)));
      setNewPhaseName('');
      addNotification(`Phase "${phase.name}" added to ${detail.prj_number}.`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to add phase', 'warning', 'Maintenance');
    } finally {
      setPhaseActingOn(null);
    }
  };

  const cyclePhaseStatus = async (phase: ProjectPhase) => {
    if (!detail) return;
    const next: ProjectPhaseStatus =
      phase.status === 'Pending' ? 'In Progress' :
      phase.status === 'In Progress' ? 'Completed' :
      phase.status === 'Completed' ? 'Pending' : 'Pending';
    setPhaseActingOn(phase.id);
    try {
      const { phase: updated } = await updateProjectPhase(detail.id, phase.id, { status: next });
      const updatedPhases = (detail.phases || []).map(ph => (ph.id === phase.id ? updated : ph));
      setDetail({ ...detail, phases: updatedPhases });
      setProjects(prev => prev.map(p => (p.id === detail.id ? { ...p, phases: updatedPhases } : p)));
      addNotification(`Phase "${phase.name}" → ${next}.`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update phase', 'warning', 'Maintenance');
    } finally {
      setPhaseActingOn(null);
    }
  };

  const removePhase = async (phase: ProjectPhase) => {
    if (!detail) return;
    setPhaseActingOn(phase.id);
    try {
      await deleteProjectPhase(detail.id, phase.id);
      const updatedPhases = (detail.phases || []).filter(ph => ph.id !== phase.id);
      setDetail({ ...detail, phases: updatedPhases });
      setProjects(prev => prev.map(p => (p.id === detail.id ? { ...p, phases: updatedPhases } : p)));
      addNotification(`Phase "${phase.name}" removed.`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to remove phase', 'warning', 'Maintenance');
    } finally {
      setPhaseActingOn(null);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Projects & Renovations"
        subtitle="Capital projects, renovations, and construction management."
        icon={Hammer}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={() => setShowForm(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> New Project
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Projects" value={totals.count} icon={Hammer} tone="accent" />
        <StatCard title="In Progress" value={totals.inProgress} icon={Clock} tone="warning" />
        <StatCard title="Completed" value={totals.completed} icon={CheckCircle2} tone="success" />
        <StatCard title="Total Budget" value={fmtMoney(totals.budget)} icon={DollarSign} tone="info" />
      </div>

      {/* Type quick filter */}
      <SectionCard title="Project Types" subtitle="Click to filter by project type" pad="md">
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-2">
          {(['All' as const, ...ALL_TYPES] as const).map(t => {
            const Icon = t === 'All' ? Hammer : TYPE_ICON[t];
            const active = typeFilter === t;
            const count = t === 'All' ? projects.length : projects.filter(p => p.type === t).length;
            return (
              <button
                key={t}
                onClick={() => setTypeFilter(typeFilter === t ? 'All' : (t as ProjectType | 'All'))}
                className={[
                  'p-2.5 rounded-xl border text-center smooth-transition',
                  active
                    ? 'border-[var(--color-accent-operations)] ring-1 ring-[var(--color-accent-operations)]/30 bg-[var(--color-accent-operations)]/10'
                    : 'border-gray-200 dark:border-slate-700 hover:border-[var(--color-accent-operations)]/50',
                ].join(' ')}
              >
                <Icon className="w-4 h-4 mx-auto text-[var(--color-accent-operations)] mb-1" />
                <p className="text-[9px] font-bold uppercase leading-tight text-gray-700 dark:text-gray-300">{t}</p>
                {count > 0 && <span className="block text-[10px] font-bold text-gray-500 mt-1">{count}</span>}
              </button>
            );
          })}
        </div>
      </SectionCard>

      {/* Status filter + search */}
      <SectionCard pad="md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap">
            {(['All', ...STATUS_FLOW] as const).map(f => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={[
                  'px-4 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap',
                  statusFilter === f
                    ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-700',
                ].join(' ')}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              placeholder="Search number, name, location…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
            />
          </div>
        </div>
      </SectionCard>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {/* Projects list */}
      <SectionCard
        title="Projects"
        subtitle={loading ? 'Loading…' : `${filtered.length} matching project${filtered.length === 1 ? '' : 's'}`}
        pad="none"
        bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
      >
        {loading && (
          <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading projects…
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-500">
            {projects.length === 0 ? 'No projects created yet.' : 'No projects match the filters.'}
          </div>
        )}

        {!loading && !error && filtered.map(p => {
          const TypeIcon = TYPE_ICON[p.type];
          const CategoryIcon = CATEGORY_ICON[p.category];
          const tone = STATUS_TONE[p.status];
          const priorityTone = PRIORITY_TONE[p.priority];
          const actions = NEXT_ACTIONS[p.status] || [];
          const isMenuOpen = menuOpen === p.id;
          const budgetNum = Number(p.budget || 0);
          const spentNum = Number(p.spent || 0);
          const remaining = budgetNum - spentNum;
          const overBudget = spentNum > budgetNum && budgetNum > 0;

          return (
            <div
              key={p.id}
              className="p-4 flex flex-col md:flex-row md:items-center gap-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition"
              onClick={() => openDetail(p)}
            >
              {/* Identity */}
              <div className="flex items-center gap-3 md:w-64 shrink-0">
                <div className={`p-2 rounded-xl ${statusTone[tone].soft}`}>
                  <TypeIcon className={`w-4 h-4 ${statusTone[tone].text}`} />
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-gray-900 dark:text-white truncate">{p.name}</h4>
                  <p className="text-xs text-gray-500 font-mono truncate">
                    {p.prj_number} · {p.type}
                  </p>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200 line-clamp-2">{p.description}</p>
                <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-gray-500">
                  <span className="inline-flex items-center gap-1">
                    <CategoryIcon className="w-3.5 h-3.5" /> {p.category}
                  </span>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" /> {p.location}
                  </span>
                  {p.project_manager && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <User className="w-3.5 h-3.5" /> {p.project_manager}
                      </span>
                    </>
                  )}
                </div>

                {/* Progress + budget */}
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/40">
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-[9px] font-bold text-gray-400 uppercase">Progress</span>
                      <span className="text-[11px] font-bold text-gray-900 dark:text-white">{p.progress}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          p.progress === 100 ? 'bg-[var(--color-success)]' : p.progress >= 50 ? 'bg-[var(--color-accent-operations)]' : 'bg-[var(--color-warning)]'
                        }`}
                        style={{ width: `${p.progress}%` }}
                      />
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/40 grid grid-cols-3 gap-2">
                    <div>
                      <span className="text-[9px] font-bold text-gray-400 uppercase block">Budget</span>
                      <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300">{fmtMoney(budgetNum)}</span>
                    </div>
                    <div>
                      <span className="text-[9px] font-bold text-gray-400 uppercase block">Spent</span>
                      <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300">{fmtMoney(spentNum)}</span>
                    </div>
                    <div>
                      <span className="text-[9px] font-bold text-gray-400 uppercase block">Remaining</span>
                      <span className={`text-[11px] font-bold ${overBudget ? 'text-[var(--color-danger)]' : 'text-[var(--color-success)]'}`}>{fmtMoney(remaining)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Status + priority */}
              <div className="md:w-48 shrink-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <Badge tone={tone}>{p.status}</Badge>
                  <Badge tone={priorityTone} variant="solid">{p.priority}</Badge>
                </div>
                <div className="text-xs text-gray-500">
                  <span className="block">Target: {fmtDay(p.target_completion_date) || '—'}</span>
                  {p.actual_completion_date && <span className="block text-[var(--color-success)]">Completed: {fmtDay(p.actual_completion_date)}</span>}
                </div>
              </div>

              {/* Actions */}
              <div className="md:w-36 shrink-0 flex justify-end items-center gap-1.5">
                <div className="relative" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => setMenuOpen(isMenuOpen ? null : p.id)}
                    disabled={actingOn === p.id}
                    className={button.ghost + ' disabled:opacity-50'}
                  >
                    {actingOn === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MoreVertical className="w-4 h-4" />}
                  </button>
                  {isMenuOpen && (
                    <div className="absolute right-0 top-full mt-2 w-52 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden">
                      {actions.map(a => (
                        <button
                          key={a}
                          onClick={() => changeStatus(p.id, a)}
                          className="w-full text-left px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                        >
                          {ACTION_LABELS[a]}
                        </button>
                      ))}
                      <button
                        onClick={() => doDelete(p.id)}
                        className="w-full text-left px-3 py-2 text-xs font-medium text-[var(--color-danger)] hover:bg-red-50 dark:hover:bg-red-900/20 transition border-t border-gray-100 dark:border-slate-700"
                      >
                        <Trash2 className="w-3.5 h-3.5 inline mr-1" /> Delete
                      </button>
                    </div>
                  )}
                </div>
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </div>
            </div>
          );
        })}
      </SectionCard>

      {/* New Project modal */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => (submitting ? undefined : setShowForm(false))}
        title="New Project"
        subtitle="Create a capital project, renovation, or construction initiative."
        variant="form"
        size="lg"
        loading={submitting}
        confirmLabel={submitting ? 'Creating…' : 'Create Project'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitCreate}
        showFooter
      >
        <div className="space-y-4">
          <Field label="Project Name">
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Guest Room Renovation - Floor 3"
              className={inputClass}
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Type">
              <select
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value as ProjectType }))}
                className={inputClass}
              >
                {ALL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Category">
              <select
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value as ProjectCategory }))}
                className={inputClass}
              >
                {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Location">
              <input
                value={form.location}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                placeholder="e.g. Floor 3, Main Lobby, Rooftop"
                className={inputClass}
              />
            </Field>
            <Field label="Priority">
              <select
                value={form.priority}
                onChange={e => setForm(f => ({ ...f, priority: e.target.value as ProjectPriority }))}
                className={inputClass}
              >
                {ALL_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Start Date">
              <input
                type="date"
                value={form.startDate}
                onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Target Completion Date">
              <input
                type="date"
                value={form.targetCompletionDate}
                onChange={e => setForm(f => ({ ...f, targetCompletionDate: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Project Manager">
              <select
                value={form.projectManager}
                onChange={e => setForm(f => ({ ...f, projectManager: e.target.value }))}
                className={inputClass}
              >
                <option value="">— Unassigned —</option>
                {PROJECT_MANAGER_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Budget ($)">
              <input
                type="number"
                min="0"
                value={form.budget}
                onChange={e => setForm(f => ({ ...f, budget: e.target.value }))}
                placeholder="0"
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Description">
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Describe the scope of the project…"
              rows={3}
              className={inputClass}
            />
          </Field>

          {/* Phases builder */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Phases (optional)</span>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, phases: [...f.phases, { name: '' }] }))}
                className={button.ghost + ' !px-2 !py-1'}
              >
                <Plus className="w-3.5 h-3.5" /> Add Phase
              </button>
            </div>
            <div className="space-y-2">
              {form.phases.map((ph, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    value={ph.name}
                    onChange={e => setForm(f => ({
                      ...f,
                      phases: f.phases.map((p, i) => i === idx ? { ...p, name: e.target.value } : p),
                    }))}
                    placeholder={`Phase ${idx + 1} name`}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, phases: f.phases.filter((_, i) => i !== idx) }))}
                    className={button.ghost + ' !px-2 !py-2 text-[var(--color-danger)]'}
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {form.phases.length === 0 && (
                <p className="text-xs text-gray-400 italic">No phases added. You can add them later from the project detail.</p>
              )}
            </div>
          </div>
        </div>
      </ModalSystem>

      {/* Project detail modal */}
      <ModalSystem
        isOpen={!!detail}
        onClose={() => { setDetail(null); setDetailReadOnly(true); setNewPhaseName(''); }}
        title={detail ? detail.name : 'Project'}
        subtitle={detail ? `${detail.prj_number} · ${detail.type} · ${detail.location}` : ''}
        variant="form"
        size="lg"
        loading={savingDetail}
        confirmLabel={detailReadOnly ? (savingDetail ? 'Saving…' : 'Edit') : (savingDetail ? 'Saving…' : 'Save Changes')}
        cancelLabel="Close"
        confirmColor="indigo"
        onConfirm={() => {
          if (detailReadOnly) setDetailReadOnly(false);
          else saveDetail();
        }}
        showFooter
      >
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[detail.status]}>{detail.status}</Badge>
              <Badge tone={PRIORITY_TONE[detail.priority]} variant="solid">{detail.priority}</Badge>
              <Badge tone="neutral">{detail.category}</Badge>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Project Manager">
                {detailReadOnly ? (
                  <p className="text-sm text-gray-900 dark:text-white">{detail.project_manager || '—'}</p>
                ) : (
                  <select
                    value={detailForm.projectManager}
                    onChange={e => setDetailForm(f => ({ ...f, projectManager: e.target.value }))}
                    className={inputClass}
                  >
                    <option value="">— Unassigned —</option>
                    {PROJECT_MANAGER_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                )}
              </Field>
              <Field label="Budget ($)">
                {detailReadOnly ? (
                  <p className="text-sm text-gray-900 dark:text-white">{fmtMoney(detail.budget)}</p>
                ) : (
                  <input
                    type="number"
                    min="0"
                    value={detailForm.budget}
                    onChange={e => setDetailForm(f => ({ ...f, budget: e.target.value }))}
                    className={inputClass}
                  />
                )}
              </Field>
              <Field label="Spent ($)">
                {detailReadOnly ? (
                  <p className="text-sm text-gray-900 dark:text-white">{fmtMoney(detail.spent)}</p>
                ) : (
                  <input
                    type="number"
                    min="0"
                    value={detailForm.spent}
                    onChange={e => setDetailForm(f => ({ ...f, spent: e.target.value }))}
                    className={inputClass}
                  />
                )}
              </Field>
              <Field label="Progress (%)">
                {detailReadOnly ? (
                  <p className="text-sm text-gray-900 dark:text-white">{detail.progress}%</p>
                ) : (
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={detailForm.progress}
                    onChange={e => setDetailForm(f => ({ ...f, progress: e.target.value }))}
                    className={inputClass}
                  />
                )}
              </Field>
              <Field label="Start Date">
                {detailReadOnly ? (
                  <p className="text-sm text-gray-900 dark:text-white">{fmtDay(detail.start_date)}</p>
                ) : (
                  <input
                    type="date"
                    value={detailForm.startDate}
                    onChange={e => setDetailForm(f => ({ ...f, startDate: e.target.value }))}
                    className={inputClass}
                  />
                )}
              </Field>
              <Field label="Target Completion">
                {detailReadOnly ? (
                  <p className="text-sm text-gray-900 dark:text-white">{fmtDay(detail.target_completion_date)}</p>
                ) : (
                  <input
                    type="date"
                    value={detailForm.targetCompletionDate}
                    onChange={e => setDetailForm(f => ({ ...f, targetCompletionDate: e.target.value }))}
                    className={inputClass}
                  />
                )}
              </Field>
              <Field label="Actual Completion">
                {detailReadOnly ? (
                  <p className="text-sm text-gray-900 dark:text-white">{fmtDay(detail.actual_completion_date)}</p>
                ) : (
                  <input
                    type="date"
                    value={detailForm.actualCompletionDate}
                    onChange={e => setDetailForm(f => ({ ...f, actualCompletionDate: e.target.value }))}
                    className={inputClass}
                  />
                )}
              </Field>
            </div>

            <Field label="Description">
              <p className="text-sm text-gray-700 dark:text-gray-300 bg-slate-50 dark:bg-slate-900/40 p-3 rounded-xl">{detail.description}</p>
            </Field>

            {/* Phases */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Phases</span>
              </div>
              <div className="space-y-2">
                {(detail.phases || []).map(ph => {
                  const phTone = PHASE_STATUS_TONE[ph.status];
                  return (
                    <div key={ph.id} className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/40">
                      <div className={`p-1.5 rounded-lg ${statusTone[phTone].soft}`}>
                        {ph.status === 'Completed' ? <CheckCircle2 className={`w-3.5 h-3.5 ${statusTone[phTone].text}`} /> :
                         ph.status === 'In Progress' ? <Play className={`w-3.5 h-3.5 ${statusTone[phTone].text}`} /> :
                         ph.status === 'On Hold' ? <Pause className={`w-3.5 h-3.5 ${statusTone[phTone].text}`} /> :
                         <Clock className={`w-3.5 h-3.5 ${statusTone[phTone].text}`} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{ph.name}</p>
                        {ph.completed_date && <p className="text-[10px] text-gray-500">Completed: {fmtDay(ph.completed_date)}</p>}
                      </div>
                      <Badge tone={phTone}>{ph.status}</Badge>
                      <button
                        onClick={() => cyclePhaseStatus(ph)}
                        disabled={phaseActingOn === ph.id}
                        className={button.ghost + ' !px-2 !py-1.5 disabled:opacity-50'}
                        title="Cycle status"
                      >
                        {phaseActingOn === ph.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => removePhase(ph)}
                        disabled={phaseActingOn === ph.id}
                        className={button.ghost + ' !px-2 !py-1.5 text-[var(--color-danger)] disabled:opacity-50'}
                        title="Remove phase"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
                {(detail.phases || []).length === 0 && (
                  <p className="text-xs text-gray-400 italic">No phases defined for this project.</p>
                )}
              </div>

              {/* Add phase */}
              <div className="flex items-center gap-2 mt-3">
                <input
                  value={newPhaseName}
                  onChange={e => setNewPhaseName(e.target.value)}
                  placeholder="New phase name…"
                  className={inputClass}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addPhase(); } }}
                />
                <button
                  onClick={addPhase}
                  disabled={!newPhaseName.trim() || phaseActingOn === 'new'}
                  className={button.secondary + ' disabled:opacity-50'}
                >
                  {phaseActingOn === 'new' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Add
                </button>
              </div>
            </div>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default ProjectsRenovations;
