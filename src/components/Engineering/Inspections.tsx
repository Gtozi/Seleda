import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ShieldCheck,
  Search,
  Plus,
  Calendar,
  Clock,
  CheckCircle2,
  AlertTriangle,
  FileText,
  MapPin,
  User,
  ChevronRight,
  Flame,
  Droplets,
  Zap,
  Thermometer,
  Building2,
  Factory,
  Loader2,
  ServerCrash,
  MoreVertical,
  Package,
  Trash2,
  ArrowRight,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchInspections,
  createInspection,
  updateInspection,
  convertInspectionToWO,
  deleteInspection,
  type Inspection,
  type InspectionStatus,
  type InspectionType,
  type InspectionCategory,
  type InspectionPriority,
} from '../../services/engineeringService';

// ── Static registries ────────────────────────────────────────────────────

const ALL_TYPES: InspectionType[] = [
  'Fire Safety', 'Elevator', 'Boiler', 'Electrical', 'Water System', 'HVAC', 'Structural', 'Environmental',
];

const ALL_CATEGORIES: InspectionCategory[] = ['Compliance', 'Safety', 'Preventive', 'Regulatory', 'Insurance'];

const ALL_PRIORITIES: InspectionPriority[] = ['Critical', 'High', 'Normal', 'Low'];

const STATUS_FLOW: InspectionStatus[] = ['Scheduled', 'In Progress', 'Completed', 'Failed', 'Overdue'];

const TYPE_ICON: Record<InspectionType, LucideIcon> = {
  'Fire Safety': Flame,
  Elevator: Building2,
  Boiler: Thermometer,
  Electrical: Zap,
  'Water System': Droplets,
  HVAC: Thermometer,
  Structural: Building2,
  Environmental: Factory,
};

const STATUS_TONE: Record<InspectionStatus, StatusTone> = {
  Scheduled: 'neutral',
  'In Progress': 'warning',
  Completed: 'success',
  Failed: 'danger',
  Overdue: 'danger',
};

const PRIORITY_TONE: Record<InspectionPriority, StatusTone> = {
  Critical: 'danger',
  High: 'warning',
  Normal: 'info',
  Low: 'neutral',
};

// Next available status transitions for each status.
const NEXT_ACTIONS: Record<InspectionStatus, InspectionStatus[]> = {
  Scheduled: ['In Progress'],
  'In Progress': ['Completed', 'Failed'],
  Completed: [],
  Failed: [],
  Overdue: ['In Progress'],
};

const ACTION_LABELS: Record<InspectionStatus, string> = {
  Scheduled: 'Mark In Progress',
  'In Progress': 'Complete',
  Completed: 'Completed',
  Failed: 'Failed',
  Overdue: 'Mark In Progress',
};

const INSPECTOR_OPTIONS = [
  'Fire Safety Inspector',
  'Elevator Inspector',
  'Health Inspector',
  'HVAC Technician',
  'Electrical Inspector',
  'Boiler Inspector',
  'Structural Engineer',
  'Environmental Inspector',
  'General Maintenance Team',
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

function fmtDate(s: string | null): string {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtDay(s: string | null): string {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Component ────────────────────────────────────────────────────────────

const Inspections: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<'All' | InspectionStatus>('All');
  const [typeFilter, setTypeFilter] = useState<'All' | InspectionType>('All');
  const [categoryFilter, setCategoryFilter] = useState<'All' | InspectionCategory>('All');
  const [priorityFilter, setPriorityFilter] = useState<'All' | InspectionPriority>('All');
  const [search, setSearch] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<{
    type: InspectionType;
    category: InspectionCategory;
    location: string;
    roomNumber: string;
    description: string;
    priority: InspectionPriority;
    scheduledDate: string;
    inspector: string;
    nextDueDate: string;
  }>({
    type: 'Fire Safety',
    category: 'Compliance',
    location: '',
    roomNumber: '',
    description: '',
    priority: 'Normal',
    scheduledDate: '',
    inspector: '',
    nextDueDate: '',
  });

  const [detail, setDetail] = useState<Inspection | null>(null);
  const [detailReadOnly, setDetailReadOnly] = useState(true);
  const [detailForm, setDetailForm] = useState<{
    inspector: string;
    findings: string;
    nextDueDate: string;
    completedDate: string;
  }>({ inspector: '', findings: '', nextDueDate: '', completedDate: '' });
  const [savingDetail, setSavingDetail] = useState(false);

  const [convertId, setConvertId] = useState<string | null>(null);
  const [convertForm, setConvertForm] = useState({ assignedTo: '', scheduledDate: '', notes: '' });
  const [converting, setConverting] = useState(false);

  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  // ── Load ────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchInspections({
        propertyId: currentPropertyId || undefined,
      });
      setInspections(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load inspections');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  // ── Derived list ───────────────────────────────────────────────────────
  const filtered = useMemo(
    () =>
      inspections.filter(i => {
        const matchesStatus = statusFilter === 'All' || i.status === statusFilter;
        const matchesType = typeFilter === 'All' || i.type === typeFilter;
        const matchesCategory = categoryFilter === 'All' || i.category === categoryFilter;
        const matchesPriority = priorityFilter === 'All' || i.priority === priorityFilter;
        const q = search.trim().toLowerCase();
        const matchesSearch =
          !q ||
          i.ins_number.toLowerCase().includes(q) ||
          i.description.toLowerCase().includes(q) ||
          i.location.toLowerCase().includes(q) ||
          i.type.toLowerCase().includes(q) ||
          (i.inspector || '').toLowerCase().includes(q);
        return matchesStatus && matchesType && matchesCategory && matchesPriority && matchesSearch;
      }),
    [inspections, statusFilter, typeFilter, categoryFilter, priorityFilter, search]
  );

  const counts = {
    scheduled: inspections.filter(i => i.status === 'Scheduled').length,
    inProgress: inspections.filter(i => i.status === 'In Progress').length,
    overdue: inspections.filter(i => i.status === 'Overdue').length,
    completed: inspections.filter(i => i.status === 'Completed').length,
    failed: inspections.filter(i => i.status === 'Failed').length,
  };

  // ── Actions ────────────────────────────────────────────────────────────
  const submitCreate = async () => {
    if (!form.type || !form.category || !form.location.trim() || !form.description.trim() || !form.scheduledDate) return;
    setSubmitting(true);
    try {
      const created = await createInspection({
        propertyId: currentPropertyId || undefined,
        type: form.type,
        category: form.category,
        location: form.location.trim(),
        roomNumber: form.roomNumber.trim() || undefined,
        description: form.description.trim(),
        priority: form.priority,
        scheduledDate: form.scheduledDate,
        inspector: form.inspector.trim() || undefined,
        nextDueDate: form.nextDueDate || undefined,
      });
      setInspections(prev => [created, ...prev]);
      addNotification(`Inspection ${created.ins_number} scheduled for ${created.location}.`, 'task', 'Maintenance');
      setShowForm(false);
      setForm({
        type: 'Fire Safety', category: 'Compliance', location: '', roomNumber: '',
        description: '', priority: 'Normal', scheduledDate: '', inspector: '', nextDueDate: '',
      });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to schedule inspection', 'warning', 'Maintenance');
    } finally {
      setSubmitting(false);
    }
  };

  const changeStatus = async (id: string, status: InspectionStatus) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      const { inspection } = await updateInspection(id, { status });
      setInspections(prev => prev.map(i => (i.id === id ? inspection : i)));
      addNotification(`Inspection ${inspection.ins_number} → ${status}.`, 'task', 'Maintenance');
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
      const { inspection } = await updateInspection(detail.id, {
        inspector: detailForm.inspector.trim() || null,
        findings: detailForm.findings.trim() || null,
        nextDueDate: detailForm.nextDueDate || null,
        completedDate: detailForm.completedDate || null,
      });
      setInspections(prev => prev.map(i => (i.id === detail.id ? inspection : i)));
      setDetail(inspection);
      setDetailReadOnly(true);
      addNotification(`Inspection ${inspection.ins_number} details updated.`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update inspection details', 'warning', 'Maintenance');
    } finally {
      setSavingDetail(false);
    }
  };

  const doConvert = async () => {
    if (!convertId) return;
    setConverting(true);
    try {
      const { inspection, workOrder } = await convertInspectionToWO(convertId, {
        assignedTo: convertForm.assignedTo.trim() || undefined,
        scheduledDate: convertForm.scheduledDate || undefined,
        notes: convertForm.notes.trim() || undefined,
      });
      setInspections(prev => prev.map(i => (i.id === convertId ? inspection : i)));
      addNotification(
        `Inspection ${inspection.ins_number} converted to work order ${workOrder.wo_number}.`,
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
      await deleteInspection(id);
      setInspections(prev => prev.filter(i => i.id !== id));
      addNotification(`Inspection ${id} deleted.`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete inspection', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const openDetail = (i: Inspection) => {
    setDetail(i);
    setDetailReadOnly(true);
    setDetailForm({
      inspector: i.inspector || '',
      findings: i.findings || '',
      nextDueDate: i.next_due_date ? i.next_due_date.slice(0, 10) : '',
      completedDate: i.completed_date ? i.completed_date.slice(0, 10) : '',
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Inspections"
        subtitle="Compliance, safety, regulatory, and preventive inspections."
        icon={ShieldCheck}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={() => setShowForm(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> Schedule Inspection
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Scheduled" value={counts.scheduled} icon={Calendar} tone="info" />
        <StatCard title="In Progress" value={counts.inProgress} icon={Clock} tone="warning" />
        <StatCard title="Overdue" value={counts.overdue} icon={AlertTriangle} tone="danger" />
        <StatCard title="Completed" value={counts.completed} icon={CheckCircle2} tone="success" />
      </div>

      {/* Type quick filter */}
      <SectionCard title="Inspection Types" subtitle="Click to filter by inspection type" pad="md">
        <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
          {(['All' as const, ...ALL_TYPES] as const).map(t => {
            const Icon = t === 'All' ? ShieldCheck : TYPE_ICON[t];
            const active = typeFilter === t;
            const count = t === 'All' ? inspections.length : inspections.filter(i => i.type === t).length;
            return (
              <button
                key={t}
                onClick={() => setTypeFilter(typeFilter === t ? 'All' : (t as InspectionType | 'All'))}
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

      {/* Inspections list */}
      <SectionCard
        title="Inspections"
        subtitle={loading ? 'Loading…' : `${filtered.length} matching inspection${filtered.length === 1 ? '' : 's'}`}
        pad="none"
        bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
      >
        {loading && (
          <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading inspections…
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-500">
            {inspections.length === 0 ? 'No inspections scheduled yet.' : 'No inspections match the filters.'}
          </div>
        )}

        {!loading && !error && filtered.map(i => {
          const TypeIcon = TYPE_ICON[i.type];
          const statusIdx = STATUS_FLOW.indexOf(i.status);
          const tone = STATUS_TONE[i.status];
          const priorityTone = PRIORITY_TONE[i.priority];
          const actions = NEXT_ACTIONS[i.status] || [];
          const isMenuOpen = menuOpen === i.id;

          return (
            <div
              key={i.id}
              className="p-4 flex flex-col md:flex-row md:items-center gap-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition"
              onClick={() => openDetail(i)}
            >
              {/* Identity */}
              <div className="flex items-center gap-3 md:w-64 shrink-0">
                <div className={`p-2 rounded-xl ${statusTone[tone].soft}`}>
                  <TypeIcon className={`w-4 h-4 ${statusTone[tone].text}`} />
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-gray-900 dark:text-white uppercase truncate">{i.type}</h4>
                  <p className="text-xs text-gray-500 font-mono truncate">
                    {i.ins_number} · {i.location}{i.room_number ? ` · Room ${i.room_number}` : ''}
                  </p>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200 line-clamp-2">{i.description}</p>
                <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-gray-500">
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" /> {i.location}
                  </span>
                  <span>·</span>
                  <span>{fmtDate(i.scheduled_date)}</span>
                  {i.inspector && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <User className="w-3.5 h-3.5" /> {i.inspector}
                      </span>
                    </>
                  )}
                </div>

                {i.findings && (
                  <div className="mt-2 p-2.5 rounded-xl bg-[var(--color-success)]/10 border border-[var(--color-success)]/20">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <FileText className="w-3.5 h-3.5 text-[var(--color-success)]" />
                      <span className="text-[10px] font-bold text-[var(--color-success)] uppercase tracking-wide">Findings</span>
                    </div>
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300 line-clamp-2">{i.findings}</p>
                  </div>
                )}
              </div>

              {/* Status + priority */}
              <div className="md:w-48 shrink-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <Badge tone={tone}>{i.status}</Badge>
                  <Badge tone={priorityTone} variant="solid">{i.priority}</Badge>
                </div>
                <div className="flex gap-1">
                  {['Scheduled', 'In Progress', 'Completed', 'Failed'].map((s, idx) => (
                    <div
                      key={s}
                      className={[
                        'h-1.5 flex-1 rounded-full',
                        (statusIdx === 4 ? 0 : statusIdx) >= idx ? 'bg-[var(--color-accent-operations)]' : 'bg-slate-100 dark:bg-slate-800',
                      ].join(' ')}
                    />
                  ))}
                </div>
                {i.converted_work_order_id && (
                  <div className="mt-1.5">
                    <Badge tone="success" icon={CheckCircle2}>Linked WO</Badge>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="md:w-36 shrink-0 flex justify-end items-center gap-1.5">
                <div className="relative" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => setMenuOpen(isMenuOpen ? null : i.id)}
                    disabled={actingOn === i.id}
                    className={button.ghost + ' disabled:opacity-50'}
                  >
                    {actingOn === i.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MoreVertical className="w-4 h-4" />}
                  </button>
                  {isMenuOpen && (
                    <div className="absolute right-0 top-full mt-2 w-52 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden">
                      {actions.map(a => (
                        <button
                          key={a}
                          onClick={() => changeStatus(i.id, a)}
                          className="w-full text-left px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                        >
                          {ACTION_LABELS[a]}
                        </button>
                      ))}
                      {!i.converted_work_order_id && (
                        <button
                          onClick={() => { setConvertId(i.id); setMenuOpen(null); }}
                          className="w-full text-left px-3 py-2 text-xs font-medium text-[var(--color-accent-operations)] hover:bg-slate-100 dark:hover:bg-slate-700 transition border-t border-gray-100 dark:border-slate-700"
                        >
                          <Package className="w-3.5 h-3.5 inline mr-1" /> Convert to Work Order
                        </button>
                      )}
                      <button
                        onClick={() => doDelete(i.id)}
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

      {/* New Inspection modal */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => (submitting ? undefined : setShowForm(false))}
        title="Schedule Inspection"
        subtitle="Create a compliance, safety, regulatory, or preventive inspection."
        variant="form"
        size="lg"
        loading={submitting}
        confirmLabel={submitting ? 'Scheduling…' : 'Schedule Inspection'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitCreate}
        showFooter
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Inspection Type">
              <select
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value as InspectionType }))}
                className={inputClass}
              >
                {ALL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Category">
              <select
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value as InspectionCategory }))}
                className={inputClass}
              >
                {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Location">
              <input
                value={form.location}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                placeholder="e.g. All Floors, Boiler Room, Rooftop"
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
                onChange={e => setForm(f => ({ ...f, priority: e.target.value as InspectionPriority }))}
                className={inputClass}
              >
                {ALL_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Scheduled Date">
              <input
                type="date"
                value={form.scheduledDate}
                onChange={e => setForm(f => ({ ...f, scheduledDate: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Inspector">
              <select
                value={form.inspector}
                onChange={e => setForm(f => ({ ...f, inspector: e.target.value }))}
                className={inputClass}
              >
                <option value="">— Unassigned —</option>
                {INSPECTOR_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Next Due Date">
              <input
                type="date"
                value={form.nextDueDate}
                onChange={e => setForm(f => ({ ...f, nextDueDate: e.target.value }))}
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Description">
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Describe the scope of the inspection…"
              rows={3}
              className={inputClass}
            />
          </Field>
        </div>
      </ModalSystem>

      {/* Inspection detail modal */}
      <ModalSystem
        isOpen={!!detail}
        onClose={() => { setDetail(null); setDetailReadOnly(true); }}
        title={detail ? `${detail.type} Inspection` : 'Inspection'}
        subtitle={detail ? `${detail.ins_number} · ${detail.location}` : ''}
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
              <Field label="Inspector">
                {detailReadOnly ? (
                  <p className="text-sm text-gray-900 dark:text-white">{detail.inspector || '—'}</p>
                ) : (
                  <select
                    value={detailForm.inspector}
                    onChange={e => setDetailForm(f => ({ ...f, inspector: e.target.value }))}
                    className={inputClass}
                  >
                    <option value="">— Unassigned —</option>
                    {INSPECTOR_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                )}
              </Field>
              <Field label="Completed Date">
                {detailReadOnly ? (
                  <p className="text-sm text-gray-900 dark:text-white">{fmtDay(detail.completed_date)}</p>
                ) : (
                  <input
                    type="date"
                    value={detailForm.completedDate}
                    onChange={e => setDetailForm(f => ({ ...f, completedDate: e.target.value }))}
                    className={inputClass}
                  />
                )}
              </Field>
              <Field label="Next Due Date">
                {detailReadOnly ? (
                  <p className="text-sm text-gray-900 dark:text-white">{fmtDay(detail.next_due_date)}</p>
                ) : (
                  <input
                    type="date"
                    value={detailForm.nextDueDate}
                    onChange={e => setDetailForm(f => ({ ...f, nextDueDate: e.target.value }))}
                    className={inputClass}
                  />
                )}
              </Field>
              <Field label="Scheduled">
                <p className="text-sm text-gray-900 dark:text-white">{fmtDay(detail.scheduled_date)}</p>
              </Field>
            </div>

            <Field label="Findings">
              {detailReadOnly ? (
                <p className="text-sm text-gray-700 dark:text-gray-300 bg-slate-50 dark:bg-slate-900/40 p-3 rounded-xl">{detail.findings || 'No findings recorded.'}</p>
              ) : (
                <textarea
                  value={detailForm.findings}
                  onChange={e => setDetailForm(f => ({ ...f, findings: e.target.value }))}
                  placeholder="Record inspection findings…"
                  rows={3}
                  className={inputClass}
                />
              )}
            </Field>

            {detail.converted_work_order_id && (
              <div className="p-3 rounded-xl bg-[var(--color-success)]/10 border border-[var(--color-success)]/20 text-sm text-[var(--color-success)]">
                Converted to work order. ID: {detail.converted_work_order_id}
              </div>
            )}
          </div>
        )}
      </ModalSystem>

      {/* Convert to Work Order modal */}
      <ModalSystem
        isOpen={!!convertId}
        onClose={() => { if (!converting) { setConvertId(null); setConvertForm({ assignedTo: '', scheduledDate: '', notes: '' }); } }}
        title="Convert to Work Order"
        subtitle="Create a real work order from this inspection. Typically used when an inspection fails and a repair is required."
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
              {INSPECTOR_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
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

export default Inspections;
