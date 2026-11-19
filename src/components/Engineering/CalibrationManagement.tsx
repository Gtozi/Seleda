import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Gauge,
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
  Thermometer,
  Zap,
  Droplets,
  Scale,
  Activity,
  Target,
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
  fetchCalibrations,
  createCalibration,
  updateCalibration,
  convertCalibrationToWO,
  deleteCalibration,
  type Calibration,
  type CalibrationStatus,
  type CalibrationInstrumentType,
  type CalibrationPriority,
} from '../../services/engineeringService';

// ── Static registries ────────────────────────────────────────────────────

const ALL_TYPES: CalibrationInstrumentType[] = [
  'Temperature Sensor', 'Pressure Gauge', 'Flow Meter', 'Electrical Meter',
  'Scale', 'Thermostat', 'Controller',
];

const ALL_PRIORITIES: CalibrationPriority[] = ['Critical', 'High', 'Normal', 'Low'];

const STATUS_FLOW: CalibrationStatus[] = ['Scheduled', 'In Progress', 'Completed', 'Failed', 'Overdue'];

const TYPE_ICON: Record<CalibrationInstrumentType, LucideIcon> = {
  'Temperature Sensor': Thermometer,
  'Pressure Gauge': Gauge,
  'Flow Meter': Droplets,
  'Electrical Meter': Zap,
  Scale: Scale,
  Thermostat: Thermometer,
  Controller: Activity,
};

const STATUS_TONE: Record<CalibrationStatus, StatusTone> = {
  Scheduled: 'neutral',
  'In Progress': 'warning',
  Completed: 'success',
  Failed: 'danger',
  Overdue: 'danger',
};

const PRIORITY_TONE: Record<CalibrationPriority, StatusTone> = {
  Critical: 'danger',
  High: 'warning',
  Normal: 'info',
  Low: 'neutral',
};

// Next available status transitions for each status.
const NEXT_ACTIONS: Record<CalibrationStatus, CalibrationStatus[]> = {
  Scheduled: ['In Progress'],
  'In Progress': ['Completed', 'Failed'],
  Completed: [],
  Failed: [],
  Overdue: ['In Progress'],
};

const ACTION_LABELS: Record<CalibrationStatus, string> = {
  Scheduled: 'Mark In Progress',
  'In Progress': 'Complete',
  Completed: 'Completed',
  Failed: 'Failed',
  Overdue: 'Mark In Progress',
};

const CALIBRATED_BY_OPTIONS = [
  'Metrology Lab',
  'In-house Technician',
  'External Calibration Service',
  'Equipment Manufacturer',
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

const CalibrationManagement: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [calibrations, setCalibrations] = useState<Calibration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<'All' | CalibrationStatus>('All');
  const [typeFilter, setTypeFilter] = useState<'All' | CalibrationInstrumentType>('All');
  const [priorityFilter, setPriorityFilter] = useState<'All' | CalibrationPriority>('All');
  const [search, setSearch] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<{
    equipmentId: string;
    equipmentName: string;
    instrumentType: CalibrationInstrumentType;
    location: string;
    roomNumber: string;
    description: string;
    priority: CalibrationPriority;
    scheduledDate: string;
    calibratedBy: string;
    nextDueDate: string;
  }>({
    equipmentId: '',
    equipmentName: '',
    instrumentType: 'Temperature Sensor',
    location: '',
    roomNumber: '',
    description: '',
    priority: 'Normal',
    scheduledDate: '',
    calibratedBy: '',
    nextDueDate: '',
  });

  const [detail, setDetail] = useState<Calibration | null>(null);
  const [detailReadOnly, setDetailReadOnly] = useState(true);
  const [detailForm, setDetailForm] = useState<{
    calibratedBy: string;
    previousReading: string;
    currentReading: string;
    tolerance: string;
    deviation: string;
    nextDueDate: string;
    completedDate: string;
  }>({
    calibratedBy: '', previousReading: '', currentReading: '', tolerance: '',
    deviation: '', nextDueDate: '', completedDate: '',
  });
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
      const data = await fetchCalibrations({
        propertyId: currentPropertyId || undefined,
      });
      setCalibrations(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load calibrations');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  // ── Derived list ───────────────────────────────────────────────────────
  const filtered = useMemo(
    () =>
      calibrations.filter(c => {
        const matchesStatus = statusFilter === 'All' || c.status === statusFilter;
        const matchesType = typeFilter === 'All' || c.instrument_type === typeFilter;
        const matchesPriority = priorityFilter === 'All' || c.priority === priorityFilter;
        const q = search.trim().toLowerCase();
        const matchesSearch =
          !q ||
          c.cal_number.toLowerCase().includes(q) ||
          c.equipment_name.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q) ||
          c.location.toLowerCase().includes(q) ||
          c.instrument_type.toLowerCase().includes(q) ||
          (c.calibrated_by || '').toLowerCase().includes(q);
        return matchesStatus && matchesType && matchesPriority && matchesSearch;
      }),
    [calibrations, statusFilter, typeFilter, priorityFilter, search]
  );

  const counts = {
    scheduled: calibrations.filter(c => c.status === 'Scheduled').length,
    inProgress: calibrations.filter(c => c.status === 'In Progress').length,
    overdue: calibrations.filter(c => c.status === 'Overdue').length,
    completed: calibrations.filter(c => c.status === 'Completed').length,
    failed: calibrations.filter(c => c.status === 'Failed').length,
  };

  // ── Actions ────────────────────────────────────────────────────────────
  const submitCreate = async () => {
    if (!form.equipmentName.trim() || !form.instrumentType || !form.location.trim() || !form.description.trim() || !form.scheduledDate) return;
    setSubmitting(true);
    try {
      const created = await createCalibration({
        propertyId: currentPropertyId || undefined,
        equipmentId: form.equipmentId.trim() || undefined,
        equipmentName: form.equipmentName.trim(),
        instrumentType: form.instrumentType,
        location: form.location.trim(),
        roomNumber: form.roomNumber.trim() || undefined,
        description: form.description.trim(),
        priority: form.priority,
        scheduledDate: form.scheduledDate,
        calibratedBy: form.calibratedBy.trim() || undefined,
        nextDueDate: form.nextDueDate || undefined,
      });
      setCalibrations(prev => [created, ...prev]);
      addNotification(`Calibration ${created.cal_number} scheduled for ${created.equipment_name}.`, 'task', 'Maintenance');
      setShowForm(false);
      setForm({
        equipmentId: '', equipmentName: '', instrumentType: 'Temperature Sensor', location: '',
        roomNumber: '', description: '', priority: 'Normal', scheduledDate: '', calibratedBy: '', nextDueDate: '',
      });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to schedule calibration', 'warning', 'Maintenance');
    } finally {
      setSubmitting(false);
    }
  };

  const changeStatus = async (id: string, status: CalibrationStatus) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      const { calibration } = await updateCalibration(id, { status });
      setCalibrations(prev => prev.map(c => (c.id === id ? calibration : c)));
      addNotification(`Calibration ${calibration.cal_number} → ${status}.`, 'task', 'Maintenance');
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
      const { calibration } = await updateCalibration(detail.id, {
        calibratedBy: detailForm.calibratedBy.trim() || null,
        previousReading: detailForm.previousReading.trim() || null,
        currentReading: detailForm.currentReading.trim() || null,
        tolerance: detailForm.tolerance.trim() || null,
        deviation: detailForm.deviation.trim() || null,
        nextDueDate: detailForm.nextDueDate || null,
        completedDate: detailForm.completedDate || null,
      });
      setCalibrations(prev => prev.map(c => (c.id === detail.id ? calibration : c)));
      setDetail(calibration);
      setDetailReadOnly(true);
      addNotification(`Calibration ${calibration.cal_number} details updated.`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update calibration details', 'warning', 'Maintenance');
    } finally {
      setSavingDetail(false);
    }
  };

  const doConvert = async () => {
    if (!convertId) return;
    setConverting(true);
    try {
      const { calibration, workOrder } = await convertCalibrationToWO(convertId, {
        assignedTo: convertForm.assignedTo.trim() || undefined,
        scheduledDate: convertForm.scheduledDate || undefined,
        notes: convertForm.notes.trim() || undefined,
      });
      setCalibrations(prev => prev.map(c => (c.id === convertId ? calibration : c)));
      addNotification(
        `Calibration ${calibration.cal_number} converted to work order ${workOrder.wo_number}.`,
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
      await deleteCalibration(id);
      setCalibrations(prev => prev.filter(c => c.id !== id));
      addNotification(`Calibration ${id} deleted.`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete calibration', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const openDetail = (c: Calibration) => {
    setDetail(c);
    setDetailReadOnly(true);
    setDetailForm({
      calibratedBy: c.calibrated_by || '',
      previousReading: c.previous_reading || '',
      currentReading: c.current_reading || '',
      tolerance: c.tolerance || '',
      deviation: c.deviation || '',
      nextDueDate: c.next_due_date ? c.next_due_date.slice(0, 10) : '',
      completedDate: c.completed_date ? c.completed_date.slice(0, 10) : '',
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Calibration Management"
        subtitle="Instrument calibration, measurement accuracy, and compliance."
        icon={Gauge}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={() => setShowForm(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> Schedule Calibration
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

      {/* Instrument type quick filter */}
      <SectionCard title="Instrument Types" subtitle="Click to filter by instrument type" pad="md">
        <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
          {(['All' as const, ...ALL_TYPES] as const).map(t => {
            const Icon = t === 'All' ? Target : TYPE_ICON[t];
            const active = typeFilter === t;
            const count = t === 'All' ? calibrations.length : calibrations.filter(c => c.instrument_type === t).length;
            return (
              <button
                key={t}
                onClick={() => setTypeFilter(typeFilter === t ? 'All' : (t as CalibrationInstrumentType | 'All'))}
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
              placeholder="Search number, equipment, location…"
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

      {/* Calibrations list */}
      <SectionCard
        title="Calibrations"
        subtitle={loading ? 'Loading…' : `${filtered.length} matching calibration${filtered.length === 1 ? '' : 's'}`}
        pad="none"
        bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
      >
        {loading && (
          <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading calibrations…
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-500">
            {calibrations.length === 0 ? 'No calibrations scheduled yet.' : 'No calibrations match the filters.'}
          </div>
        )}

        {!loading && !error && filtered.map(c => {
          const TypeIcon = TYPE_ICON[c.instrument_type];
          const statusIdx = STATUS_FLOW.indexOf(c.status);
          const tone = STATUS_TONE[c.status];
          const priorityTone = PRIORITY_TONE[c.priority];
          const actions = NEXT_ACTIONS[c.status] || [];
          const isMenuOpen = menuOpen === c.id;
          const withinTolerance = c.deviation === 'Within tolerance';

          return (
            <div
              key={c.id}
              className="p-4 flex flex-col md:flex-row md:items-center gap-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition"
              onClick={() => openDetail(c)}
            >
              {/* Identity */}
              <div className="flex items-center gap-3 md:w-64 shrink-0">
                <div className={`p-2 rounded-xl ${statusTone[tone].soft}`}>
                  <TypeIcon className={`w-4 h-4 ${statusTone[tone].text}`} />
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-gray-900 dark:text-white uppercase truncate">{c.equipment_name}</h4>
                  <p className="text-xs text-gray-500 font-mono truncate">
                    {c.cal_number} · {c.instrument_type}
                  </p>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200 line-clamp-2">{c.description}</p>
                <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-gray-500">
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" /> {c.location}
                  </span>
                  <span>·</span>
                  <span>{fmtDate(c.scheduled_date)}</span>
                  {c.calibrated_by && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <User className="w-3.5 h-3.5" /> {c.calibrated_by}
                      </span>
                    </>
                  )}
                </div>

                {c.current_reading && (
                  <div className="mt-2 grid grid-cols-4 gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/40">
                    <div>
                      <span className="text-[9px] font-bold text-gray-400 uppercase block">Previous</span>
                      <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300">{c.previous_reading || '—'}</span>
                    </div>
                    <div>
                      <span className="text-[9px] font-bold text-gray-400 uppercase block">Current</span>
                      <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300">{c.current_reading}</span>
                    </div>
                    <div>
                      <span className="text-[9px] font-bold text-gray-400 uppercase block">Tolerance</span>
                      <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300">{c.tolerance || '—'}</span>
                    </div>
                    <div>
                      <span className="text-[9px] font-bold text-gray-400 uppercase block">Deviation</span>
                      <span className={`text-[11px] font-bold ${c.deviation ? (withinTolerance ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]') : 'text-gray-500'}`}>
                        {c.deviation || '—'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Status + priority */}
              <div className="md:w-48 shrink-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <Badge tone={tone}>{c.status}</Badge>
                  <Badge tone={priorityTone} variant="solid">{c.priority}</Badge>
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
                {c.converted_work_order_id && (
                  <div className="mt-1.5">
                    <Badge tone="success" icon={CheckCircle2}>Linked WO</Badge>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="md:w-36 shrink-0 flex justify-end items-center gap-1.5">
                <div className="relative" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => setMenuOpen(isMenuOpen ? null : c.id)}
                    disabled={actingOn === c.id}
                    className={button.ghost + ' disabled:opacity-50'}
                  >
                    {actingOn === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MoreVertical className="w-4 h-4" />}
                  </button>
                  {isMenuOpen && (
                    <div className="absolute right-0 top-full mt-2 w-52 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden">
                      {actions.map(a => (
                        <button
                          key={a}
                          onClick={() => changeStatus(c.id, a)}
                          className="w-full text-left px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                        >
                          {ACTION_LABELS[a]}
                        </button>
                      ))}
                      {!c.converted_work_order_id && (
                        <button
                          onClick={() => { setConvertId(c.id); setMenuOpen(null); }}
                          className="w-full text-left px-3 py-2 text-xs font-medium text-[var(--color-accent-operations)] hover:bg-slate-100 dark:hover:bg-slate-700 transition border-t border-gray-100 dark:border-slate-700"
                        >
                          <Package className="w-3.5 h-3.5 inline mr-1" /> Convert to Work Order
                        </button>
                      )}
                      <button
                        onClick={() => doDelete(c.id)}
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

      {/* New Calibration modal */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => (submitting ? undefined : setShowForm(false))}
        title="Schedule Calibration"
        subtitle="Create an instrument calibration for accuracy, compliance, and traceability."
        variant="form"
        size="lg"
        loading={submitting}
        confirmLabel={submitting ? 'Scheduling…' : 'Schedule Calibration'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitCreate}
        showFooter
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Equipment Name">
              <input
                value={form.equipmentName}
                onChange={e => setForm(f => ({ ...f, equipmentName: e.target.value }))}
                placeholder="e.g. Boiler Temperature Sensor"
                className={inputClass}
              />
            </Field>
            <Field label="Equipment ID">
              <input
                value={form.equipmentId}
                onChange={e => setForm(f => ({ ...f, equipmentId: e.target.value }))}
                placeholder="e.g. TEMP-01 (optional)"
                className={inputClass}
              />
            </Field>
            <Field label="Instrument Type">
              <select
                value={form.instrumentType}
                onChange={e => setForm(f => ({ ...f, instrumentType: e.target.value as CalibrationInstrumentType }))}
                className={inputClass}
              >
                {ALL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Location">
              <input
                value={form.location}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                placeholder="e.g. Boiler Room, Pump Room"
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
                onChange={e => setForm(f => ({ ...f, priority: e.target.value as CalibrationPriority }))}
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
            <Field label="Next Due Date">
              <input
                type="date"
                value={form.nextDueDate}
                onChange={e => setForm(f => ({ ...f, nextDueDate: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Calibrated By">
              <select
                value={form.calibratedBy}
                onChange={e => setForm(f => ({ ...f, calibratedBy: e.target.value }))}
                className={inputClass}
              >
                <option value="">— Unassigned —</option>
                {CALIBRATED_BY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Description">
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Describe the scope of the calibration…"
              rows={3}
              className={inputClass}
            />
          </Field>
        </div>
      </ModalSystem>

      {/* Calibration detail modal */}
      <ModalSystem
        isOpen={!!detail}
        onClose={() => { setDetail(null); setDetailReadOnly(true); }}
        title={detail ? `${detail.equipment_name}` : 'Calibration'}
        subtitle={detail ? `${detail.cal_number} · ${detail.instrument_type} · ${detail.location}` : ''}
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
              <Badge tone="neutral">{detail.instrument_type}</Badge>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Calibrated By">
                {detailReadOnly ? (
                  <p className="text-sm text-gray-900 dark:text-white">{detail.calibrated_by || '—'}</p>
                ) : (
                  <select
                    value={detailForm.calibratedBy}
                    onChange={e => setDetailForm(f => ({ ...f, calibratedBy: e.target.value }))}
                    className={inputClass}
                  >
                    <option value="">— Unassigned —</option>
                    {CALIBRATED_BY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
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

            {/* Readings grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40">
              <Field label="Previous Reading">
                {detailReadOnly ? (
                  <p className="text-sm text-gray-900 dark:text-white">{detail.previous_reading || '—'}</p>
                ) : (
                  <input
                    value={detailForm.previousReading}
                    onChange={e => setDetailForm(f => ({ ...f, previousReading: e.target.value }))}
                    placeholder="e.g. ±2.5°C"
                    className={inputClass}
                  />
                )}
              </Field>
              <Field label="Current Reading">
                {detailReadOnly ? (
                  <p className="text-sm text-gray-900 dark:text-white">{detail.current_reading || '—'}</p>
                ) : (
                  <input
                    value={detailForm.currentReading}
                    onChange={e => setDetailForm(f => ({ ...f, currentReading: e.target.value }))}
                    placeholder="e.g. ±0.5°C"
                    className={inputClass}
                  />
                )}
              </Field>
              <Field label="Tolerance">
                {detailReadOnly ? (
                  <p className="text-sm text-gray-900 dark:text-white">{detail.tolerance || '—'}</p>
                ) : (
                  <input
                    value={detailForm.tolerance}
                    onChange={e => setDetailForm(f => ({ ...f, tolerance: e.target.value }))}
                    placeholder="e.g. ±1.0°C"
                    className={inputClass}
                  />
                )}
              </Field>
              <Field label="Deviation">
                {detailReadOnly ? (
                  <p className={`text-sm font-bold ${detail.deviation ? (detail.deviation === 'Within tolerance' ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]') : 'text-gray-900 dark:text-white'}`}>
                    {detail.deviation || '—'}
                  </p>
                ) : (
                  <select
                    value={detailForm.deviation}
                    onChange={e => setDetailForm(f => ({ ...f, deviation: e.target.value }))}
                    className={inputClass}
                  >
                    <option value="">— Not set —</option>
                    <option value="Within tolerance">Within tolerance</option>
                    <option value="Out of tolerance">Out of tolerance</option>
                    <option value="Adjusted">Adjusted</option>
                    <option value="Replaced">Replaced</option>
                  </select>
                )}
              </Field>
            </div>

            <Field label="Description">
              <p className="text-sm text-gray-700 dark:text-gray-300 bg-slate-50 dark:bg-slate-900/40 p-3 rounded-xl">{detail.description}</p>
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
        subtitle="Create a real work order from this calibration. Typically used when a calibration fails and a repair or replacement is required."
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
              {CALIBRATED_BY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
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

export default CalibrationManagement;
