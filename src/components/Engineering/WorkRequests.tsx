/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Work Requests module — Engineering Portal (/erp/maintenance/work-requests).
 * Incoming maintenance requests from all departments.
 *
 * Flow: Pending → Reviewed → Approved → (Converted to WO | Rejected).
 * "Converted to WO" creates a real row in `work_orders` and links it back
 * via `converted_work_order_id`, integrating with the Work Order Management
 * console (/erp/maintenance/workorders).
 *
 * DB-integrated: fetches and persists via /api/eng-portal/work-requests.
 * UI follows the Housekeeping portal design language (PageHeader, SectionCard,
 * StatCard, Badge, brandTheme tokens).
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Wrench,
  Droplets,
  Zap,
  Thermometer,
  Hammer,
  Paintbrush,
  Armchair,
  Lock,
  Laptop,
  ChefHat,
  ArrowUpDown,
  Flame,
  Building2,
  Utensils,
  Shield,
  Sparkles,
  Coffee,
  Car,
  Smartphone,
  Calendar,
  User,
  Plus,
  Search,
  ArrowRight,
  CheckCircle2,
  Eye,
  Clock,
  AlertTriangle,
  Loader2,
  ServerCrash,
  MoreVertical,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchWorkRequests,
  createWorkRequest,
  updateWorkRequest,
  convertWorkRequestToWO,
  type WorkRequest,
  type WorkRequestStatus,
  type WorkRequestPriority,
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

type RequestSource =
  | 'Front Office' | 'Housekeeping' | 'Food & Beverage' | 'Security'
  | 'Spa' | 'Laundry' | 'Administration' | 'IoT Sensors' | 'Scheduled Inspections';

const SOURCE_ICON: Record<RequestSource, LucideIcon> = {
  'Front Office': Building2,
  Housekeeping: Sparkles,
  'Food & Beverage': Utensils,
  Security: Shield,
  Spa: Coffee,
  Laundry: Car,
  Administration: User,
  'IoT Sensors': Smartphone,
  'Scheduled Inspections': Calendar,
};

const ALL_SOURCES = Object.keys(SOURCE_ICON) as RequestSource[];

const STATUS_FLOW: WorkRequestStatus[] = [
  'Pending', 'Reviewed', 'Approved', 'Converted to WO',
];

const STATUS_TONE: Record<WorkRequestStatus, StatusTone> = {
  Pending: 'warning',
  Reviewed: 'info',
  Approved: 'accent',
  Rejected: 'danger',
  'Converted to WO': 'success',
};

const PRIORITY_TONE: Record<WorkRequestPriority, StatusTone> = {
  Emergency: 'danger',
  High: 'warning',
  Normal: 'info',
  Low: 'neutral',
};

// Next available actions for each status.
const NEXT_ACTIONS: Record<WorkRequestStatus, WorkRequestStatus[]> = {
  Pending: ['Reviewed', 'Approved', 'Rejected'],
  Reviewed: ['Approved', 'Rejected'],
  Approved: ['Converted to WO'],
  Rejected: ['Pending'],
  'Converted to WO': [],
};

const ACTION_LABELS: Record<WorkRequestStatus, string> = {
  Pending: 'Re-open',
  Reviewed: 'Mark as Reviewed',
  Approved: 'Approve',
  Rejected: 'Reject',
  'Converted to WO': 'Convert to Work Order',
};

// Engineering teams / technician roles for the Assign To dropdown.
// Sourced from the Engineering portal's staff & team naming conventions.
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

// ── Component ────────────────────────────────────────────────────────────
const WorkRequests: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [requests, setRequests] = useState<WorkRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<'All' | WorkRequestStatus>('All');
  const [sourceFilter, setSourceFilter] = useState<'All' | RequestSource>('All');
  const [typeFilter, setTypeFilter] = useState<'All' | RequestType>('All');
  const [search, setSearch] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<{
    source: RequestSource;
    location: string;
    roomNumber: string;
    priority: WorkRequestPriority;
    type: RequestType;
    description: string;
    requestedBy: string;
  }>({
    source: 'Front Office',
    location: '',
    roomNumber: '',
    priority: 'Normal',
    type: 'Electrical',
    description: '',
    requestedBy: '',
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
      const data = await fetchWorkRequests({
        propertyId: currentPropertyId || undefined,
      });
      setRequests(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load work requests');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  // ── Derived list ──────────────────────────────────────────────────────
  const filtered = useMemo(
    () =>
      requests.filter(r => {
        const matchesStatus = statusFilter === 'All' || r.status === statusFilter;
        const matchesSource = sourceFilter === 'All' || r.source === sourceFilter;
        const matchesType = typeFilter === 'All' || (r.type as RequestType) === typeFilter;
        const q = search.trim().toLowerCase();
        const matchesSearch =
          !q ||
          r.wr_number.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q) ||
          r.location.toLowerCase().includes(q) ||
          r.type.toLowerCase().includes(q) ||
          r.requested_by.toLowerCase().includes(q);
        return matchesStatus && matchesSource && matchesType && matchesSearch;
      }),
    [requests, statusFilter, sourceFilter, typeFilter, search]
  );

  const counts = {
    pending: requests.filter(r => r.status === 'Pending').length,
    approved: requests.filter(r => r.status === 'Approved').length,
    emergency: requests.filter(r => r.priority === 'Emergency').length,
    converted: requests.filter(r => r.status === 'Converted to WO').length,
  };

  // ── Actions ───────────────────────────────────────────────────────────
  const submitCreate = async () => {
    if (!form.location.trim() || !form.description.trim()) return;
    setSubmitting(true);
    try {
      const created = await createWorkRequest({
        propertyId: currentPropertyId || undefined,
        source: form.source,
        sourceType: form.source,
        location: form.location.trim(),
        roomNumber: form.roomNumber.trim() || undefined,
        priority: form.priority,
        type: form.type,
        description: form.description.trim(),
        requestedBy: form.requestedBy.trim() || undefined,
      });
      setRequests(prev => [created, ...prev]);
      addNotification(`Work request ${created.wr_number} logged for ${created.location}.`, 'task', 'Maintenance');
      setShowForm(false);
      setForm({
        source: 'Front Office', location: '', roomNumber: '',
        priority: 'Normal', type: 'Electrical', description: '', requestedBy: '',
      });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to log work request', 'error', 'Maintenance');
    } finally {
      setSubmitting(false);
    }
  };

  const changeStatus = async (id: string, status: WorkRequestStatus) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      const { workRequest } = await updateWorkRequest(id, { status });
      setRequests(prev => prev.map(r => (r.id === id ? workRequest : r)));
      addNotification(`Work request ${id} → ${status}.`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || `Failed to update status to ${status}`, 'error', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const doConvert = async () => {
    if (!convertId) return;
    setConverting(true);
    try {
      const { workRequest, workOrder } = await convertWorkRequestToWO(convertId, {
        assignedTo: convertForm.assignedTo.trim() || undefined,
        scheduledDate: convertForm.scheduledDate || undefined,
        notes: convertForm.notes.trim() || undefined,
      });
      setRequests(prev => prev.map(r => (r.id === convertId ? workRequest : r)));
      addNotification(
        `Work request ${workRequest.wr_number} converted to work order ${workOrder.wo_number}.`,
        'task', 'Maintenance'
      );
      setConvertId(null);
      setConvertForm({ assignedTo: '', scheduledDate: '', notes: '' });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to convert to work order', 'error', 'Maintenance');
    } finally {
      setConverting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Work Requests"
        subtitle="Incoming maintenance requests from all departments."
        icon={Wrench}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={() => setShowForm(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> New Request
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Pending Review" value={counts.pending} icon={Clock} tone="warning" />
        <StatCard title="Approved" value={counts.approved} icon={CheckCircle2} tone="accent" />
        <StatCard title="Emergency" value={counts.emergency} icon={AlertTriangle} tone="danger" />
        <StatCard title="Converted to WO" value={counts.converted} icon={Wrench} tone="success" />
      </div>

      {/* Source quick filter */}
      <SectionCard title="Request Sources" subtitle="Click to filter by source department" pad="md">
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
          {ALL_SOURCES.map(s => {
            const Icon = SOURCE_ICON[s];
            const active = sourceFilter === s;
            const count = requests.filter(r => r.source === s).length;
            return (
              <button
                key={s}
                onClick={() => setSourceFilter(sourceFilter === s ? 'All' : s)}
                className={[
                  'p-2.5 rounded-xl border text-center smooth-transition',
                  active
                    ? 'border-[var(--color-accent-operations)] ring-1 ring-[var(--color-accent-operations)]/30 bg-[var(--color-accent-operations)]/10'
                    : 'border-gray-200 dark:border-slate-700 hover:border-[var(--color-accent-operations)]/50',
                ].join(' ')}
              >
                <Icon className="w-4 h-4 mx-auto text-[var(--color-accent-operations)] mb-1" />
                <p className="text-[10px] font-bold uppercase leading-tight text-gray-700 dark:text-gray-300">{s}</p>
                {count > 0 && <span className="block text-[10px] font-bold text-gray-500 mt-1">{count}</span>}
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
            const count = requests.filter(r => r.type === t).length;
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
            {(['All', 'Pending', 'Reviewed', 'Approved', 'Rejected', 'Converted to WO'] as const).map(f => (
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

      {/* Request list */}
      <SectionCard pad="none" bodyClassName="divide-y divide-gray-100 dark:divide-slate-700">
        {loading && (
          <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading work requests…
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-500">
            {requests.length === 0 ? 'No work requests logged yet.' : 'No work requests match the filters.'}
          </div>
        )}

        {!loading && !error && filtered.map(r => {
          const TypeIcon = TYPE_ICON[r.type as RequestType] ?? Wrench;
          const SourceIcon = SOURCE_ICON[r.source as RequestSource] ?? Building2;
          const statusIdx = STATUS_FLOW.indexOf(r.status);
          const tone = STATUS_TONE[r.status];
          const priorityTone = PRIORITY_TONE[r.priority];
          const actions = NEXT_ACTIONS[r.status] || [];
          const isMenuOpen = menuOpen === r.id;
          const requestedTime = (() => {
            const d = new Date(r.request_date);
            return isNaN(d.getTime())
              ? r.request_date
              : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          })();

          return (
            <div key={r.id} className="p-4 flex flex-col md:flex-row md:items-center gap-4">
              {/* Identity */}
              <div className="flex items-center gap-3 md:w-64 shrink-0">
                <div className={`p-2 rounded-xl ${statusTone[tone].soft}`}>
                  <TypeIcon className={`w-4 h-4 ${statusTone[tone].text}`} />
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-gray-900 dark:text-white uppercase truncate">{r.type}</h4>
                  <p className="text-xs text-gray-500 font-mono truncate">{r.wr_number} · {r.location}{r.room_number ? ` · Room ${r.room_number}` : ''}</p>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200 line-clamp-2">{r.description}</p>
                <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-gray-500">
                  <span className="inline-flex items-center gap-1">
                    <SourceIcon className="w-3.5 h-3.5" /> {r.source}
                  </span>
                  <span>·</span>
                  <span>by {r.requested_by}</span>
                  <span>·</span>
                  <span>{requestedTime}</span>
                  {r.attachments > 0 && (
                    <>
                      <span>·</span>
                      <span>📎 {r.attachments}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Status + workflow */}
              <div className="md:w-56 shrink-0">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <Badge tone={tone}>{r.status}</Badge>
                  <Badge tone={priorityTone} variant="solid">{r.priority}</Badge>
                </div>
                {r.status !== 'Rejected' && (
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
                )}
              </div>

              {/* Actions */}
              <div className="md:w-36 shrink-0 flex justify-end items-center gap-1.5">
                {actions.length > 0 && (
                  <div className="relative">
                    <button
                      onClick={() => setMenuOpen(isMenuOpen ? null : r.id)}
                      disabled={actingOn === r.id}
                      className={button.ghost + ' disabled:opacity-50'}
                    >
                      {actingOn === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MoreVertical className="w-4 h-4" />}
                    </button>
                    {isMenuOpen && (
                      <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden">
                        {actions.map(a => (
                          <button
                            key={a}
                            onClick={() => {
                              if (a === 'Converted to WO') {
                                setConvertId(r.id);
                                setMenuOpen(null);
                              } else {
                                changeStatus(r.id, a);
                              }
                            }}
                            className="w-full text-left px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                          >
                            {ACTION_LABELS[a]}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {r.status === 'Converted to WO' && (
                  <Badge tone="success" icon={CheckCircle2}>WO</Badge>
                )}
              </div>
            </div>
          );
        })}
      </SectionCard>

      {/* New Request modal */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => (submitting ? undefined : setShowForm(false))}
        title="New Work Request"
        subtitle="Log an incoming maintenance request from any department."
        variant="form"
        size="lg"
        loading={submitting}
        confirmLabel={submitting ? 'Submitting…' : 'Create Request'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitCreate}
        showFooter
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Source Department">
              <select
                value={form.source}
                onChange={e => setForm(f => ({ ...f, source: e.target.value as RequestSource }))}
                className={inputClass}
              >
                {ALL_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Request Type">
              <select
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value as RequestType }))}
                className={inputClass}
              >
                {ALL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
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
                onChange={e => setForm(f => ({ ...f, priority: e.target.value as WorkRequestPriority }))}
                className={inputClass}
              >
                <option value="Emergency">Emergency</option>
                <option value="High">High</option>
                <option value="Normal">Normal</option>
                <option value="Low">Low</option>
              </select>
            </Field>
            <Field label="Requested By">
              <input
                value={form.requestedBy}
                onChange={e => setForm(f => ({ ...f, requestedBy: e.target.value }))}
                placeholder="Optional"
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
        subtitle="Create a real work order from this approved work request."
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

export default WorkRequests;
