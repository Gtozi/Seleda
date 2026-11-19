/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Corrective Maintenance module — Engineering Portal
 * (/erp/maintenance/corrective-maintenance).
 *
 * Reactive repairs, emergency response, and equipment breakdown resolution.
 *
 * Flow: Reported → Diagnosed → In Progress → Parts Ordered → Completed → Verified.
 * "Convert to Work Order" creates a real row in work_orders and links it back
 * via converted_work_order_id, integrating with the Work Order Management
 * console (/erp/maintenance/workorders).
 *
 * DB-integrated: fetches and persists via /api/eng-portal/corrective-maintenance.
 * UI follows the Housekeeping portal design language (PageHeader, SectionCard,
 * StatCard, Badge, brandTheme tokens).
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  Wrench,
  Zap,
  Droplets,
  Flame,
  Thermometer,
  Hammer,
  Paintbrush,
  Armchair,
  Lock,
  Laptop,
  ChefHat,
  ArrowUpDown,
  Plus,
  Search,
  ArrowRight,
  CheckCircle2,
  Clock,
  Loader2,
  ServerCrash,
  MoreVertical,
  MapPin,
  User,
  DollarSign,
  Package,
  Trash2,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchCorrectiveTasks,
  createCorrectiveTask,
  updateCorrectiveTask,
  convertCorrectiveToWO,
  deleteCorrectiveTask,
  type CorrectiveTask,
  type CorrectiveTaskStatus,
  type CorrectiveTaskPriority,
  type CorrectiveCategory,
} from '../../services/engineeringService';

// ── Static registries ────────────────────────────────────────────────────
type RequestType =
  | 'Electrical' | 'Plumbing' | 'HVAC' | 'Carpentry' | 'Painting'
  | 'Furniture' | 'Lock & Door' | 'IT Infrastructure' | 'Kitchen Equipment'
  | 'Elevators' | 'Fire & Life Safety';

const TYPE_ICON: Record<RequestType, LucideIcon> = {
  Electrical: Zap,
  Plumbing: Droplets,
  HVAC: Thermometer,
  Carpentry: Hammer,
  Painting: Paintbrush,
  Furniture: Armchair,
  'Lock & Door': Lock,
  'IT Infrastructure': Laptop,
  'Kitchen Equipment': ChefHat,
  Elevators: ArrowUpDown,
  'Fire & Life Safety': Flame,
};

const ALL_TYPES = Object.keys(TYPE_ICON) as RequestType[];

const ALL_CATEGORIES: CorrectiveCategory[] = [
  'Reactive Repairs',
  'Emergency Repairs',
  'Guest Complaint Resolution',
  'Equipment Breakdown',
  'Infrastructure Repair',
  'Utility Failure Response',
];

const STATUS_FLOW: CorrectiveTaskStatus[] = [
  'Reported', 'Diagnosed', 'In Progress', 'Parts Ordered', 'Completed', 'Verified',
];

const STATUS_TONE: Record<CorrectiveTaskStatus, StatusTone> = {
  Reported: 'neutral',
  Diagnosed: 'info',
  'In Progress': 'warning',
  'Parts Ordered': 'warning',
  Completed: 'accent',
  Verified: 'success',
};

const PRIORITY_TONE: Record<CorrectiveTaskPriority, StatusTone> = {
  Emergency: 'danger',
  High: 'warning',
  Normal: 'info',
  Low: 'neutral',
};

// Next available status transitions for each status.
const NEXT_ACTIONS: Record<CorrectiveTaskStatus, CorrectiveTaskStatus[]> = {
  Reported: ['Diagnosed'],
  Diagnosed: ['In Progress'],
  'In Progress': ['Parts Ordered', 'Completed'],
  'Parts Ordered': ['Completed'],
  Completed: ['Verified'],
  Verified: [],
};

const ACTION_LABELS: Record<CorrectiveTaskStatus, string> = {
  Reported: 'Re-open',
  Diagnosed: 'Mark as Diagnosed',
  'In Progress': 'Start Work',
  'Parts Ordered': 'Mark Parts Ordered',
  Completed: 'Mark Completed',
  Verified: 'Mark Verified',
};

// Engineering teams / technician roles for the Assign To dropdown.
const ASSIGNEE_OPTIONS = [
  'Electrical Team',
  'Plumbing Team',
  'HVAC Team',
  'Carpentry Team',
  'Painting Team',
  'General Maintenance Team',
  'External Contractor',
] as const;

// ── Field helper (matches HK modules) ────────────────────────────────────
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

function fmtDate(s: string | null): string {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  return Number(n).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

// ── Component ────────────────────────────────────────────────────────────
const CorrectiveMaintenance: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [tasks, setTasks] = useState<CorrectiveTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<'All' | CorrectiveTaskStatus>('All');
  const [categoryFilter, setCategoryFilter] = useState<'All' | CorrectiveCategory>('All');
  const [typeFilter, setTypeFilter] = useState<'All' | RequestType>('All');
  const [search, setSearch] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<{
    type: RequestType;
    category: CorrectiveCategory;
    location: string;
    roomNumber: string;
    priority: CorrectiveTaskPriority;
    description: string;
    assignedTechnician: string;
    estimatedCost: string;
    downtime: string;
  }>({
    type: 'Electrical',
    category: 'Reactive Repairs',
    location: '',
    roomNumber: '',
    priority: 'Normal',
    description: '',
    assignedTechnician: '',
    estimatedCost: '',
    downtime: '',
  });

  const [convertId, setConvertId] = useState<string | null>(null);
  const [convertForm, setConvertForm] = useState({ assignedTo: '', scheduledDate: '', notes: '' });
  const [converting, setConverting] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCorrectiveTasks({
        propertyId: currentPropertyId || undefined,
      });
      setTasks(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load corrective tasks');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  // ── Derived list ──────────────────────────────────────────────────────
  const filtered = useMemo(
    () =>
      tasks.filter(t => {
        const matchesStatus = statusFilter === 'All' || t.status === statusFilter;
        const matchesCategory = categoryFilter === 'All' || t.category === categoryFilter;
        const matchesType = typeFilter === 'All' || (t.type as RequestType) === typeFilter;
        const q = search.trim().toLowerCase();
        const matchesSearch =
          !q ||
          t.cm_number.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.location.toLowerCase().includes(q) ||
          t.type.toLowerCase().includes(q) ||
          (t.assigned_technician || '').toLowerCase().includes(q);
        return matchesStatus && matchesCategory && matchesType && matchesSearch;
      }),
    [tasks, statusFilter, categoryFilter, typeFilter, search]
  );

  const counts = {
    emergency: tasks.filter(t => t.priority === 'Emergency').length,
    inProgress: tasks.filter(t => t.status === 'In Progress').length,
    partsOrdered: tasks.filter(t => t.status === 'Parts Ordered').length,
    resolved: tasks.filter(t => t.status === 'Completed' || t.status === 'Verified').length,
  };

  // ── Actions ───────────────────────────────────────────────────────────
  const submitCreate = async () => {
    if (!form.location.trim() || !form.description.trim()) return;
    setSubmitting(true);
    try {
      const created = await createCorrectiveTask({
        propertyId: currentPropertyId || undefined,
        type: form.type,
        category: form.category,
        location: form.location.trim(),
        roomNumber: form.roomNumber.trim() || undefined,
        priority: form.priority,
        description: form.description.trim(),
        assignedTechnician: form.assignedTechnician.trim() || undefined,
        estimatedCost: form.estimatedCost ? Number(form.estimatedCost) : undefined,
        downtime: form.downtime.trim() || undefined,
      });
      setTasks(prev => [created, ...prev]);
      addNotification(`Corrective task ${created.cm_number} logged for ${created.location}.`, 'task', 'Maintenance');
      setShowForm(false);
      setForm({
        type: 'Electrical', category: 'Reactive Repairs', location: '', roomNumber: '',
        priority: 'Normal', description: '', assignedTechnician: '', estimatedCost: '', downtime: '',
      });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to log corrective task', 'warning', 'Maintenance');
    } finally {
      setSubmitting(false);
    }
  };

  const changeStatus = async (id: string, status: CorrectiveTaskStatus) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      const { task } = await updateCorrectiveTask(id, { status });
      setTasks(prev => prev.map(t => (t.id === id ? task : t)));
      addNotification(`Corrective task ${id} → ${status}.`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || `Failed to update status to ${status}`, 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const doConvert = async () => {
    if (!convertId) return;
    setConverting(true);
    try {
      const { task, workOrder } = await convertCorrectiveToWO(convertId, {
        assignedTo: convertForm.assignedTo.trim() || undefined,
        scheduledDate: convertForm.scheduledDate || undefined,
        notes: convertForm.notes.trim() || undefined,
      });
      setTasks(prev => prev.map(t => (t.id === convertId ? task : t)));
      addNotification(
        `Corrective task ${task.cm_number} converted to work order ${workOrder.wo_number}.`,
        'task', 'Maintenance'
      );
      setConvertId(null);
      setConvertForm({ assignedTo: '', scheduledDate: '', notes: '' });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to convert to work order', 'warning', 'Maintenance');
    } finally {
      setConverting(false);
    }
  };

  const doDelete = async (id: string) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      await deleteCorrectiveTask(id);
      setTasks(prev => prev.filter(t => t.id !== id));
      addNotification(`Corrective task ${id} deleted.`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete corrective task', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Corrective Maintenance"
        subtitle="Reactive repairs, emergency response, and equipment breakdown resolution."
        icon={Wrench}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={() => setShowForm(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> New Corrective Task
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Emergency" value={counts.emergency} icon={AlertTriangle} tone="danger" />
        <StatCard title="In Progress" value={counts.inProgress} icon={Wrench} tone="warning" />
        <StatCard title="Awaiting Parts" value={counts.partsOrdered} icon={Clock} tone="warning" />
        <StatCard title="Resolved" value={counts.resolved} icon={CheckCircle2} tone="success" />
      </div>

      {/* Category quick filter */}
      <SectionCard title="Categories" subtitle="Click to filter by corrective category" pad="md">
        <div className="flex flex-wrap gap-2">
          {(['All', ...ALL_CATEGORIES] as const).map(c => {
            const active = categoryFilter === c;
            return (
              <button
                key={c}
                onClick={() => setCategoryFilter(active ? 'All' : (c as CorrectiveCategory | 'All'))}
                className={[
                  'px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wide smooth-transition',
                  active
                    ? 'bg-[var(--color-accent-operations)] text-white'
                    : 'bg-slate-100 dark:bg-slate-900/40 text-gray-600 dark:text-gray-300 hover:bg-slate-200 dark:hover:bg-slate-700',
                ].join(' ')}
              >
                {c}
              </button>
            );
          })}
        </div>
      </SectionCard>

      {/* Type quick filter */}
      <SectionCard title="Request Types" subtitle="Click to filter by maintenance type" pad="md">
        <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-11 gap-2">
          {ALL_TYPES.map(t => {
            const Icon = TYPE_ICON[t];
            const active = typeFilter === t;
            const count = tasks.filter(r => r.type === t).length;
            return (
              <button
                key={t}
                onClick={() => setTypeFilter(typeFilter === t ? 'All' : t)}
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
              placeholder="Search number, location, type…"
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

      {/* Task list */}
      <SectionCard pad="none" bodyClassName="divide-y divide-gray-100 dark:divide-slate-700">
        {loading && (
          <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading corrective tasks…
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-500">
            {tasks.length === 0 ? 'No corrective tasks logged yet.' : 'No corrective tasks match the filters.'}
          </div>
        )}

        {!loading && !error && filtered.map(t => {
          const TypeIcon = TYPE_ICON[t.type as RequestType] ?? Wrench;
          const statusIdx = STATUS_FLOW.indexOf(t.status);
          const tone = STATUS_TONE[t.status];
          const priorityTone = PRIORITY_TONE[t.priority];
          const actions = NEXT_ACTIONS[t.status] || [];
          const isMenuOpen = menuOpen === t.id;

          return (
            <div key={t.id} className="p-4 flex flex-col md:flex-row md:items-center gap-4">
              {/* Identity */}
              <div className="flex items-center gap-3 md:w-64 shrink-0">
                <div className={`p-2 rounded-xl ${statusTone[tone].soft}`}>
                  <TypeIcon className={`w-4 h-4 ${statusTone[tone].text}`} />
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-gray-900 dark:text-white uppercase truncate">{t.type}</h4>
                  <p className="text-xs text-gray-500 font-mono truncate">
                    {t.cm_number} · {t.location}{t.room_number ? ` · Room ${t.room_number}` : ''}
                  </p>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200 line-clamp-2">{t.description}</p>
                <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-gray-500">
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" /> {t.location}
                  </span>
                  <span>·</span>
                  <span>{fmtDate(t.reported_date)}</span>
                  {t.assigned_technician && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <User className="w-3.5 h-3.5" /> {t.assigned_technician}
                      </span>
                    </>
                  )}
                  {t.downtime && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1 text-[var(--color-danger)]">
                        <Clock className="w-3.5 h-3.5" /> {t.downtime} downtime
                      </span>
                    </>
                  )}
                </div>

                {/* Costs */}
                <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs">
                  {Number(t.estimated_cost) > 0 && (
                    <span className="inline-flex items-center gap-1 text-gray-500">
                      <DollarSign className="w-3.5 h-3.5" /> Est. {fmtMoney(t.estimated_cost)}
                    </span>
                  )}
                  {Number(t.actual_cost) > 0 && (
                    <span className="inline-flex items-center gap-1 text-[var(--color-success)]">
                      <DollarSign className="w-3.5 h-3.5" /> Actual {fmtMoney(t.actual_cost)}
                    </span>
                  )}
                </div>

                {t.resolution && (
                  <div className="mt-2 p-2.5 rounded-xl bg-[var(--color-success)]/10 border border-[var(--color-success)]/20">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-[var(--color-success)]" />
                      <span className="text-[10px] font-bold text-[var(--color-success)] uppercase tracking-wide">Resolution</span>
                    </div>
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{t.resolution}</p>
                  </div>
                )}
              </div>

              {/* Status + workflow */}
              <div className="md:w-56 shrink-0">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <Badge tone={tone}>{t.status}</Badge>
                  <Badge tone={priorityTone} variant="solid">{t.priority}</Badge>
                </div>
                <div className="flex gap-1">
                  {STATUS_FLOW.map((s, idx) => (
                    <div
                      key={s}
                      className={[
                        'h-1.5 flex-1 rounded-full',
                        idx <= statusIdx ? 'bg-[var(--color-accent-operations)]' : 'bg-slate-100 dark:bg-slate-800',
                      ].join(' ')}
                    />
                  ))}
                </div>
                {t.converted_work_order_id && (
                  <div className="mt-1.5">
                    <Badge tone="success" icon={CheckCircle2}>Linked WO</Badge>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="md:w-36 shrink-0 flex justify-end items-center gap-1.5">
                <div className="relative">
                  <button
                    onClick={() => setMenuOpen(isMenuOpen ? null : t.id)}
                    disabled={actingOn === t.id}
                    className={button.ghost + ' disabled:opacity-50'}
                  >
                    {actingOn === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MoreVertical className="w-4 h-4" />}
                  </button>
                  {isMenuOpen && (
                    <div className="absolute right-0 top-full mt-2 w-52 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden">
                      {actions.map(a => (
                        <button
                          key={a}
                          onClick={() => changeStatus(t.id, a)}
                          className="w-full text-left px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                        >
                          {ACTION_LABELS[a]}
                        </button>
                      ))}
                      {!t.converted_work_order_id && (
                        <button
                          onClick={() => { setConvertId(t.id); setMenuOpen(null); }}
                          className="w-full text-left px-3 py-2 text-xs font-medium text-[var(--color-accent-operations)] hover:bg-slate-100 dark:hover:bg-slate-700 transition border-t border-gray-100 dark:border-slate-700"
                        >
                          <Package className="w-3.5 h-3.5 inline mr-1" /> Convert to Work Order
                        </button>
                      )}
                      <button
                        onClick={() => doDelete(t.id)}
                        className="w-full text-left px-3 py-2 text-xs font-medium text-[var(--color-danger)] hover:bg-red-50 dark:hover:bg-red-900/20 transition border-t border-gray-100 dark:border-slate-700"
                      >
                        <Trash2 className="w-3.5 h-3.5 inline mr-1" /> Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </SectionCard>

      {/* New Corrective Task modal */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => (submitting ? undefined : setShowForm(false))}
        title="New Corrective Task"
        subtitle="Log a reactive repair, emergency response, or equipment breakdown."
        variant="form"
        size="lg"
        loading={submitting}
        confirmLabel={submitting ? 'Submitting…' : 'Create Task'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitCreate}
        showFooter
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Request Type">
              <select
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value as RequestType }))}
                className={inputClass}
              >
                {ALL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Category">
              <select
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value as CorrectiveCategory }))}
                className={inputClass}
              >
                {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Location">
              <input
                value={form.location}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                placeholder="e.g. Room 205, Lobby, Boiler Room"
                className={inputClass}
              />
            </Field>
            <Field label="Room Number">
              <input
                value={form.roomNumber}
                onChange={e => setForm(f => ({ ...f, roomNumber: e.target.value }))}
                placeholder="Optional"
                className={inputClass}
              />
            </Field>
            <Field label="Priority">
              <select
                value={form.priority}
                onChange={e => setForm(f => ({ ...f, priority: e.target.value as CorrectiveTaskPriority }))}
                className={inputClass}
              >
                <option value="Emergency">Emergency</option>
                <option value="High">High</option>
                <option value="Normal">Normal</option>
                <option value="Low">Low</option>
              </select>
            </Field>
            <Field label="Assigned Technician">
              <select
                value={form.assignedTechnician}
                onChange={e => setForm(f => ({ ...f, assignedTechnician: e.target.value }))}
                className={inputClass}
              >
                <option value="">— Unassigned —</option>
                {ASSIGNEE_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
            <Field label="Estimated Cost ($)">
              <input
                type="number"
                min="0"
                value={form.estimatedCost}
                onChange={e => setForm(f => ({ ...f, estimatedCost: e.target.value }))}
                placeholder="Optional"
                className={inputClass}
              />
            </Field>
            <Field label="Estimated Downtime">
              <input
                value={form.downtime}
                onChange={e => setForm(f => ({ ...f, downtime: e.target.value }))}
                placeholder="e.g. 2 hours"
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Description">
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Describe the issue in detail…"
              rows={3}
              className={inputClass}
            />
          </Field>
        </div>
      </ModalSystem>

      {/* Convert to Work Order modal */}
      <ModalSystem
        isOpen={!!convertId}
        onClose={() => { if (!converting) { setConvertId(null); setConvertForm({ assignedTo: '', scheduledDate: '', notes: '' }); } }}
        title="Convert to Work Order"
        subtitle="Create a real work order from this corrective task."
        variant="form"
        size="md"
        loading={converting}
        confirmLabel={converting ? 'Converting…' : 'Convert to WO'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={doConvert}
        showFooter
      >
        <div className="space-y-4">
          <Field label="Assign To (optional)">
            <select
              value={convertForm.assignedTo}
              onChange={e => setConvertForm(f => ({ ...f, assignedTo: e.target.value }))}
              className={inputClass}
            >
              <option value="">— Unassigned —</option>
              {ASSIGNEE_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </Field>
          <Field label="Scheduled Date">
            <input
              type="date"
              value={convertForm.scheduledDate}
              onChange={e => setConvertForm(f => ({ ...f, scheduledDate: e.target.value }))}
              className={inputClass}
            />
          </Field>
          <Field label="Notes">
            <textarea
              value={convertForm.notes}
              onChange={e => setConvertForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Optional work order notes…"
              rows={2}
              className={inputClass}
            />
          </Field>
        </div>
      </ModalSystem>
    </div>
  );
};

export default CorrectiveMaintenance;
