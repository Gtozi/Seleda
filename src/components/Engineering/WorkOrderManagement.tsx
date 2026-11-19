/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Work Order Management console — Engineering Portal
 * (/erp/maintenance/workorders).
 *
 * Full work-order lifecycle: Open → Assigned → In Progress → (Waiting for
 * Parts | Waiting for Vendor) → Completed → Verified → Closed.
 * Cancelled is a terminal side-branch.
 *
 * DB-integrated: fetches and persists via /api/eng-portal/work-orders.
 * UI follows the Housekeeping portal design language (PageHeader,
 * SectionCard, StatCard, Badge, brandTheme tokens).
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
  Plus,
  Search,
  ArrowRight,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Loader2,
  ServerCrash,
  MoreVertical,
  MapPin,
  User,
  Calendar,
  DollarSign,
  Timer,
  Eye,
  X,
  Package,
  ToolCase,
  ClipboardCheck,
  Trash2,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchWorkOrders,
  createWorkOrder,
  updateWorkOrder,
  deleteWorkOrder,
  fetchSpareParts,
  type WorkOrder,
  type SparePart,
} from '../../services/engineeringService';

// ── Static registries ────────────────────────────────────────────────────
type WorkOrderType =
  | 'Electrical' | 'Plumbing' | 'HVAC' | 'Carpentry' | 'Painting'
  | 'Furniture' | 'Lock & Door' | 'IT Infrastructure' | 'Kitchen Equipment'
  | 'Elevators' | 'Fire & Life Safety' | 'Corrective' | 'Preventive';

const TYPE_ICON: Record<string, LucideIcon> = {
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
  Corrective: Wrench,
  Preventive: Wrench,
};

const ALL_TYPES: WorkOrderType[] = [
  'Electrical', 'Plumbing', 'HVAC', 'Carpentry', 'Painting',
  'Furniture', 'Lock & Door', 'IT Infrastructure', 'Kitchen Equipment',
  'Elevators', 'Fire & Life Safety', 'Corrective', 'Preventive',
];

type WorkOrderStatus =
  | 'Open' | 'Assigned' | 'In Progress' | 'Waiting for Parts'
  | 'Waiting for Vendor' | 'Completed' | 'Verified' | 'Closed' | 'Cancelled';

const STATUS_FLOW: WorkOrderStatus[] = [
  'Open', 'Assigned', 'In Progress', 'Completed', 'Verified', 'Closed',
];

const STATUS_TONE: Record<WorkOrderStatus, StatusTone> = {
  Open: 'neutral',
  Assigned: 'info',
  'In Progress': 'warning',
  'Waiting for Parts': 'warning',
  'Waiting for Vendor': 'warning',
  Completed: 'accent',
  Verified: 'success',
  Closed: 'neutral',
  Cancelled: 'danger',
};

const PRIORITY_TONE: Record<string, StatusTone> = {
  Emergency: 'danger',
  Critical: 'danger',
  High: 'warning',
  Normal: 'info',
  Medium: 'info',
  Low: 'neutral',
};

// Next available actions for each status.
const NEXT_ACTIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  Open: ['Assigned', 'Cancelled'],
  Assigned: ['In Progress', 'Cancelled'],
  'In Progress': ['Waiting for Parts', 'Waiting for Vendor', 'Completed', 'Cancelled'],
  'Waiting for Parts': ['In Progress', 'Completed', 'Cancelled'],
  'Waiting for Vendor': ['In Progress', 'Completed', 'Cancelled'],
  Completed: ['Verified', 'Closed'],
  Verified: ['Closed'],
  Closed: [],
  Cancelled: ['Open'],
};

const ACTION_LABELS: Record<WorkOrderStatus, string> = {
  Open: 'Re-open',
  Assigned: 'Assign',
  'In Progress': 'Start Work',
  'Waiting for Parts': 'Waiting for Parts',
  'Waiting for Vendor': 'Waiting for Vendor',
  Completed: 'Mark Completed',
  Verified: 'Verify',
  Closed: 'Close',
  Cancelled: 'Cancel',
};

const ASSIGNEE_OPTIONS = [
  'Electrical Team',
  'Plumbing Team',
  'HVAC Team',
  'Carpentry Team',
  'Painting Team',
  'General Maintenance Team',
  'External Contractor',
] as const;

const PRIORITY_OPTIONS = ['Emergency', 'Critical', 'High', 'Normal', 'Medium', 'Low'] as const;

// Common engineering tools that can be required for a work order.
const TOOL_OPTIONS = [
  'Multimeter',
  'Pipe Wrench',
  'Voltage Tester',
  'Cordless Drill',
  'Pipe Threader',
  'Manifold Gauge Set',
  'Refrigerant Recovery Unit',
  'Ladder',
  'Soldering Iron',
  'Heat Gun',
  'Torque Wrench',
  'Insulation Tester',
  'Drain Snake',
  'Pressure Gauge',
  'Bosch Hammer Drill',
] as const;

// Pre-built checklist templates per work order type.
const CHECKLIST_TEMPLATES: Record<string, string[]> = {
  Electrical: [
    'Isolate power supply at breaker',
    'Verify zero voltage with multimeter',
    'Inspect wiring for damage',
    'Replace faulty component',
    'Restore power and test',
    'Tag panel with completion sticker',
  ],
  Plumbing: [
    'Shut off water supply valve',
    'Drain affected pipe section',
    'Replace damaged fitting/pipe',
    'Restore water supply',
    'Check for leaks',
    'Clean work area',
  ],
  HVAC: [
    'Power off unit at disconnect',
    'Inspect filter and coil condition',
    'Check refrigerant pressure',
    'Replace/repair faulty component',
    'Restore power and verify cooling/heating',
    'Record operating pressures',
  ],
  Carpentry: [
    'Assess structural integrity',
    'Measure and cut replacement material',
    'Install/repair component',
    'Sand and finish surface',
    'Clean work area',
  ],
  Painting: [
    'Protect surrounding surfaces',
    'Sand and prime area',
    'Apply first coat',
    'Apply finish coat',
    'Inspect coverage and touch up',
    'Remove protective covering',
  ],
  'Kitchen Equipment': [
    'Disconnect equipment from power/gas',
    'Disassemble affected components',
    'Replace worn parts',
    'Reassemble and reconnect',
    'Test operation under load',
    'Verify temperature/pressure specs',
  ],
  'Lock & Door': [
    'Inspect lock mechanism and frame',
    'Remove old lock/hardware',
    'Install new lock/hardware',
    'Test key operation and latch alignment',
    'Adjust door closer if needed',
  ],
  'Fire & Life Safety': [
    'Notify monitoring company of test',
    'Isolate affected device circuit',
    'Replace/repair device',
    'Restore circuit and verify signal',
    'Confirm with monitoring company',
    'Document test results',
  ],
  Default: [
    'Assess scope of work',
    'Gather required tools and parts',
    'Perform repair/replacement',
    'Test functionality',
    'Clean work area',
    'Document completion',
  ],
};

function getChecklistTemplate(type: string): string[] {
  return CHECKLIST_TEMPLATES[type] || CHECKLIST_TEMPLATES.Default;
}

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
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtCost(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return '—';
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (isNaN(num)) return '—';
  return `$${num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

// ── Component ────────────────────────────────────────────────────────────
const WorkOrderManagement: React.FC = () => {
  const { addNotification } = useERP();

  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<'All' | WorkOrderStatus>('All');
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [spareParts, setSpareParts] = useState<SparePart[]>([]);
  const [sparePartsLoading, setSparePartsLoading] = useState(false);
  const [form, setForm] = useState<{
    title: string;
    description: string;
    type: WorkOrderType;
    priority: string;
    assignedTo: string;
    roomNumber: string;
    scheduledDate: string;
    estimatedCost: string;
    sparePartsRequired: { partId: string; partName: string; quantity: number; unitCost: number }[];
    toolsRequired: string[];
    checklist: string[];
  }>({
    title: '', description: '', type: 'Corrective', priority: 'Normal',
    assignedTo: '', roomNumber: '', scheduledDate: '', estimatedCost: '',
    sparePartsRequired: [], toolsRequired: [], checklist: [],
  });

  const [detailId, setDetailId] = useState<string | null>(null);
  const detailWO = workOrders.find(w => w.id === detailId) || null;

  // ── Load ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchWorkOrders();
      setWorkOrders(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load work orders');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSpareParts = useCallback(async () => {
    setSparePartsLoading(true);
    try {
      const data = await fetchSpareParts();
      setSpareParts(data);
    } catch {
      // Silent — spare parts picker just won't show options
    } finally {
      setSparePartsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Load spare parts when the create or detail modal opens
  useEffect(() => {
    if ((showCreate || !!detailId) && spareParts.length === 0 && !sparePartsLoading) {
      loadSpareParts();
    }
  }, [showCreate, detailId, spareParts.length, sparePartsLoading, loadSpareParts]);

  // Auto-populate checklist when type changes
  useEffect(() => {
    setForm(f => ({ ...f, checklist: getChecklistTemplate(f.type) }));
  }, [form.type]);

  // ── Derived list ──────────────────────────────────────────────────────
  const filtered = useMemo(
    () =>
      workOrders.filter(w => {
        const matchesStatus = statusFilter === 'All' || w.status === statusFilter;
        const q = search.trim().toLowerCase();
        const matchesSearch =
          !q ||
          (w.wo_number || '').toLowerCase().includes(q) ||
          (w.title || '').toLowerCase().includes(q) ||
          (w.description || '').toLowerCase().includes(q) ||
          (w.room_number || '').toLowerCase().includes(q) ||
          (w.assigned_to || '').toLowerCase().includes(q) ||
          (w.type || '').toLowerCase().includes(q);
        return matchesStatus && matchesSearch;
      }),
    [workOrders, statusFilter, search]
  );

  const counts = {
    open: workOrders.filter(w => w.status === 'Open' || w.status === 'Assigned').length,
    inProgress: workOrders.filter(w => w.status === 'In Progress' || w.status === 'Waiting for Parts' || w.status === 'Waiting for Vendor').length,
    completed: workOrders.filter(w => w.status === 'Completed' || w.status === 'Verified').length,
    emergency: workOrders.filter(w => w.priority === 'Emergency' || w.priority === 'Critical').length,
  };

  // ── Actions ───────────────────────────────────────────────────────────
  const submitCreate = async () => {
    if (!form.title.trim()) return;
    setSubmitting(true);
    try {
      const { workOrder } = await createWorkOrder({
        title: form.title.trim(),
        description: form.description.trim(),
        type: form.type,
        priority: form.priority,
        assignedTo: form.assignedTo || undefined,
        roomNumber: form.roomNumber.trim() || undefined,
        scheduledDate: form.scheduledDate || undefined,
        estimatedCost: form.estimatedCost ? parseFloat(form.estimatedCost) : undefined,
        sparePartsRequired: form.sparePartsRequired,
        toolsRequired: form.toolsRequired,
        checklist: form.checklist,
      });
      setWorkOrders(prev => [workOrder, ...prev]);
      addNotification(`Work order ${workOrder.wo_number} created.`, 'task', 'Maintenance');
      setShowCreate(false);
      setForm({
        title: '', description: '', type: 'Corrective', priority: 'Normal',
        assignedTo: '', roomNumber: '', scheduledDate: '', estimatedCost: '',
        sparePartsRequired: [], toolsRequired: [], checklist: [],
      });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create work order', 'error', 'Maintenance');
    } finally {
      setSubmitting(false);
    }
  };

  // Spare parts helpers
  const addSparePart = (partId: string) => {
    const part = spareParts.find(p => p.id === partId);
    if (!part) return;
    if (form.sparePartsRequired.some(sp => sp.partId === partId)) return;
    setForm(f => ({
      ...f,
      sparePartsRequired: [...f.sparePartsRequired, {
        partId: part.id,
        partName: part.part_name,
        quantity: 1,
        unitCost: Number(part.unit_cost) || 0,
      }],
    }));
  };

  const updateSparePartQty = (partId: string, quantity: number) => {
    setForm(f => ({
      ...f,
      sparePartsRequired: f.sparePartsRequired.map(sp =>
        sp.partId === partId ? { ...sp, quantity: Math.max(1, quantity) } : sp
      ),
    }));
  };

  const removeSparePart = (partId: string) => {
    setForm(f => ({ ...f, sparePartsRequired: f.sparePartsRequired.filter(sp => sp.partId !== partId) }));
  };

  // Tools helpers
  const toggleTool = (tool: string) => {
    setForm(f => ({
      ...f,
      toolsRequired: f.toolsRequired.includes(tool)
        ? f.toolsRequired.filter(t => t !== tool)
        : [...f.toolsRequired, tool],
    }));
  };

  // Checklist helpers
  const updateChecklistItem = (idx: number, value: string) => {
    setForm(f => ({ ...f, checklist: f.checklist.map((c, i) => i === idx ? value : c) }));
  };
  const addChecklistItem = () => {
    setForm(f => ({ ...f, checklist: [...f.checklist, ''] }));
  };
  const removeChecklistItem = (idx: number) => {
    setForm(f => ({ ...f, checklist: f.checklist.filter((_, i) => i !== idx) }));
  };

  const sparePartsTotal = form.sparePartsRequired.reduce((sum, sp) => sum + sp.quantity * sp.unitCost, 0);

  const changeStatus = async (id: string, status: WorkOrderStatus) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      const { workOrder } = await updateWorkOrder(id, { status });
      setWorkOrders(prev => prev.map(w => (w.id === id ? workOrder : w)));
      addNotification(`Work order ${id} → ${status}.`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || `Failed to update status to ${status}`, 'error', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const saveDetail = async (patch: any) => {
    if (!detailWO) return;
    setActingOn(detailWO.id);
    try {
      const { workOrder } = await updateWorkOrder(detailWO.id, patch);
      setWorkOrders(prev => prev.map(w => (w.id === workOrder.id ? workOrder : w)));
      addNotification(`Work order ${workOrder.wo_number} updated.`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update work order', 'error', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const removeWO = async (id: string) => {
    setActingOn(id);
    try {
      await deleteWorkOrder(id);
      setWorkOrders(prev => prev.filter(w => w.id !== id));
      addNotification(`Work order ${id} deleted.`, 'task', 'Maintenance');
      setDetailId(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete work order', 'error', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────
  const statusFilters: ('All' | WorkOrderStatus)[] = [
    'All', 'Open', 'Assigned', 'In Progress', 'Waiting for Parts',
    'Waiting for Vendor', 'Completed', 'Verified', 'Closed', 'Cancelled',
  ];

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Work Order Management"
        subtitle="Enterprise asset management & maintenance flow."
        icon={Wrench}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={() => setShowCreate(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> New Work Order
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Open / Assigned" value={counts.open} icon={Clock} tone="warning" />
        <StatCard title="In Progress" value={counts.inProgress} icon={Wrench} tone="info" />
        <StatCard title="Completed" value={counts.completed} icon={CheckCircle2} tone="success" />
        <StatCard title="Emergency / Critical" value={counts.emergency} icon={AlertTriangle} tone="danger" />
      </div>

      {/* Status filter + search */}
      <SectionCard pad="md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap">
            {statusFilters.map(f => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={[
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap',
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
              placeholder="Search number, title, room, type…"
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

      {/* Work order list */}
      <SectionCard pad="none" bodyClassName="divide-y divide-gray-100 dark:divide-slate-700">
        {loading && (
          <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading work orders…
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-500">
            {workOrders.length === 0 ? 'No work orders created yet.' : 'No work orders match the filters.'}
          </div>
        )}

        {!loading && !error && filtered.map(w => {
          const TypeIcon = TYPE_ICON[w.type] ?? Wrench;
          const tone = STATUS_TONE[w.status as WorkOrderStatus] ?? 'neutral';
          const priorityTone = PRIORITY_TONE[w.priority] ?? 'neutral';
          const statusIdx = STATUS_FLOW.indexOf(w.status as WorkOrderStatus);
          const actions = NEXT_ACTIONS[w.status as WorkOrderStatus] || [];
          const isMenuOpen = menuOpen === w.id;

          return (
            <div key={w.id} className="p-4 flex flex-col md:flex-row md:items-center gap-4">
              {/* Identity */}
              <div className="flex items-center gap-3 md:w-64 shrink-0">
                <div className={`p-2 rounded-xl ${statusTone[tone].soft}`}>
                  <TypeIcon className={`w-4 h-4 ${statusTone[tone].text}`} />
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-gray-900 dark:text-white truncate">{w.title}</h4>
                  <p className="text-xs text-gray-500 font-mono truncate">
                    {w.wo_number || '—'} · {w.type}{w.room_number ? ` · Room ${w.room_number}` : ''}
                  </p>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200 line-clamp-2">{w.description || '—'}</p>
                <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-gray-500">
                  {w.assigned_to && (
                    <span className="inline-flex items-center gap-1">
                      <User className="w-3.5 h-3.5" /> {w.assigned_to}
                    </span>
                  )}
                  {w.scheduled_date && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" /> {w.scheduled_date}
                      </span>
                    </>
                  )}
                  {Number(w.labor_hours) > 0 && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <Timer className="w-3.5 h-3.5" /> {w.labor_hours}h
                      </span>
                    </>
                  )}
                  {Number(w.actual_cost) > 0 && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <DollarSign className="w-3.5 h-3.5" /> {fmtCost(w.actual_cost)}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Status + workflow */}
              <div className="md:w-56 shrink-0">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <Badge tone={tone}>{w.status}</Badge>
                  <Badge tone={priorityTone} variant="solid">{w.priority}</Badge>
                </div>
                {statusIdx >= 0 && (
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
                <button
                  onClick={() => setDetailId(w.id)}
                  className={button.ghost}
                  title="View details"
                >
                  <Eye className="w-4 h-4" />
                </button>
                {actions.length > 0 && (
                  <div className="relative">
                    <button
                      onClick={() => setMenuOpen(isMenuOpen ? null : w.id)}
                      disabled={actingOn === w.id}
                      className={button.ghost + ' disabled:opacity-50'}
                    >
                      {actingOn === w.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoreVertical className="w-4 h-4" />}
                    </button>
                    {isMenuOpen && (
                      <div className="absolute right-0 top-full mt-2 w-52 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden">
                        {actions.map(a => (
                          <button
                            key={a}
                            onClick={() => changeStatus(w.id, a)}
                            className="w-full text-left px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                          >
                            {ACTION_LABELS[a]}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </SectionCard>

      {/* Create modal */}
      <ModalSystem
        isOpen={showCreate}
        onClose={() => (submitting ? undefined : setShowCreate(false))}
        title="New Work Order"
        subtitle="Create a maintenance work order."
        variant="form"
        size="lg"
        loading={submitting}
        confirmLabel={submitting ? 'Submitting…' : 'Create Work Order'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitCreate}
        showFooter
      >
        <div className="space-y-5">
          <Field label="Title">
            <input
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Fix AC unit in Room 205"
              className={inputClass}
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Type">
              <select
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value as WorkOrderType }))}
                className={inputClass}
              >
                {ALL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select
                value={form.priority}
                onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                className={inputClass}
              >
                {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Assign To (optional)">
              <select
                value={form.assignedTo}
                onChange={e => setForm(f => ({ ...f, assignedTo: e.target.value }))}
                className={inputClass}
              >
                <option value="">— Unassigned —</option>
                {ASSIGNEE_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
            <Field label="Room Number (optional)">
              <input
                value={form.roomNumber}
                onChange={e => setForm(f => ({ ...f, roomNumber: e.target.value }))}
                placeholder="e.g. 205"
                className={inputClass}
              />
            </Field>
            <Field label="Scheduled Date (optional)">
              <input
                type="date"
                value={form.scheduledDate}
                onChange={e => setForm(f => ({ ...f, scheduledDate: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Estimated Cost (optional)">
              <input
                type="number"
                step="0.01"
                value={form.estimatedCost}
                onChange={e => setForm(f => ({ ...f, estimatedCost: e.target.value }))}
                placeholder="0.00"
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Description">
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Describe the work to be done…"
              rows={3}
              className={inputClass}
            />
          </Field>

          {/* Spare Parts Required */}
          <div className="border border-gray-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-[var(--color-accent-operations)]" />
                <span className="text-xs font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wide">Spare Parts Required</span>
              </div>
              {sparePartsTotal > 0 && (
                <span className="text-xs font-bold text-gray-500">Total: ${sparePartsTotal.toFixed(2)}</span>
              )}
            </div>

            {sparePartsLoading && (
              <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading parts inventory…
              </div>
            )}

            {!sparePartsLoading && spareParts.length > 0 && (
              <select
                value=""
                onChange={e => { if (e.target.value) addSparePart(e.target.value); e.target.value = ''; }}
                className={inputClass}
              >
                <option value="">+ Add a spare part…</option>
                {spareParts
                  .filter(p => !form.sparePartsRequired.some(sp => sp.partId === p.id))
                  .map(p => (
                    <option key={p.id} value={p.id}>
                      {p.part_name} ({p.part_number}) — {p.current_stock} in stock · ${p.unit_cost}
                    </option>
                  ))}
              </select>
            )}

            {form.sparePartsRequired.length > 0 && (
              <div className="space-y-2">
                {form.sparePartsRequired.map(sp => (
                  <div key={sp.partId} className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900/40 rounded-lg p-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{sp.partName}</p>
                      <p className="text-xs text-gray-500">${sp.unitCost.toFixed(2)} each</p>
                    </div>
                    <input
                      type="number"
                      min="1"
                      value={sp.quantity}
                      onChange={e => updateSparePartQty(sp.partId, parseInt(e.target.value) || 1)}
                      className="w-16 px-2 py-1 text-sm text-center border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                    <span className="text-xs font-bold text-gray-500 w-16 text-right">${(sp.quantity * sp.unitCost).toFixed(2)}</span>
                    <button
                      onClick={() => removeSparePart(sp.partId)}
                      className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {form.sparePartsRequired.length === 0 && !sparePartsLoading && (
              <p className="text-xs text-gray-400 italic">No spare parts added. Select from the dropdown above.</p>
            )}
          </div>

          {/* Tools Required */}
          <div className="border border-gray-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ToolCase className="w-4 h-4 text-[var(--color-accent-operations)]" />
              <span className="text-xs font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wide">Tools Required</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {TOOL_OPTIONS.map(tool => {
                const selected = form.toolsRequired.includes(tool);
                return (
                  <button
                    key={tool}
                    onClick={() => toggleTool(tool)}
                    className={[
                      'px-3 py-1.5 rounded-lg text-xs font-medium transition border',
                      selected
                        ? 'border-[var(--color-accent-operations)] bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]'
                        : 'border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-400 hover:border-[var(--color-accent-operations)]/50',
                    ].join(' ')}
                  >
                    {selected && <CheckCircle2 className="w-3 h-3 inline mr-1" />}
                    {tool}
                  </button>
                );
              })}
            </div>
            {form.toolsRequired.length === 0 && (
              <p className="text-xs text-gray-400 italic">No tools selected. Click tools above to add them.</p>
            )}
          </div>

          {/* Checklist */}
          <div className="border border-gray-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="w-4 h-4 text-[var(--color-accent-operations)]" />
                <span className="text-xs font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wide">Task Checklist</span>
              </div>
              <span className="text-[10px] text-gray-400">Auto-filled from type — edit as needed</span>
            </div>
            <div className="space-y-2">
              {form.checklist.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-400 w-5 shrink-0">{idx + 1}.</span>
                  <input
                    value={item}
                    onChange={e => updateChecklistItem(idx, e.target.value)}
                    className={inputClass}
                    placeholder="Checklist step…"
                  />
                  <button
                    onClick={() => removeChecklistItem(idx)}
                    className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={addChecklistItem}
              className={button.ghost + ' text-xs'}
            >
              <Plus className="w-3.5 h-3.5" /> Add Step
            </button>
          </div>
        </div>
      </ModalSystem>

      {/* Detail modal */}
      <ModalSystem
        isOpen={!!detailId}
        onClose={() => setDetailId(null)}
        title={detailWO?.title || 'Work Order'}
        subtitle={detailWO?.wo_number}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {detailWO && (
          <div className="space-y-5">
            {/* Status + priority + type */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[detailWO.status as WorkOrderStatus] ?? 'neutral'}>{detailWO.status}</Badge>
              <Badge tone={PRIORITY_TONE[detailWO.priority] ?? 'neutral'} variant="solid">{detailWO.priority}</Badge>
              <Badge tone="neutral">{detailWO.type}</Badge>
              {detailWO.fixed_assets && (
                <Badge tone="info">Asset: {detailWO.fixed_assets.asset_name}</Badge>
              )}
            </div>

            {/* Description */}
            {detailWO.description && (
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Description</p>
                <p className="text-sm text-gray-700 dark:text-gray-200">{detailWO.description}</p>
              </div>
            )}

            {/* Metadata grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Assigned To</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{detailWO.assigned_to || '—'}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Room</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{detailWO.room_number || '—'}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Scheduled</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{detailWO.scheduled_date || '—'}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Created</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{fmtDate(detailWO.created_date)}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Started</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{fmtDate(detailWO.started_at)}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Completed</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{fmtDate(detailWO.completed_at)}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Labor Hours</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{detailWO.labor_hours || 0}h</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Est. / Actual Cost</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{fmtCost(detailWO.cost_estimate)} / {fmtCost(detailWO.actual_cost)}</p>
              </div>
            </div>

            {/* Spare Parts — always visible, editable */}
            <div className="border border-gray-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-[var(--color-accent-operations)]" />
                  <span className="text-xs font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wide">Spare Parts</span>
                </div>
                {Array.isArray(detailWO.spare_parts_used) && detailWO.spare_parts_used.length > 0 && (
                  <span className="text-xs font-bold text-gray-500">
                    Total: {fmtCost(detailWO.spare_parts_used.reduce((sum: number, sp: any) => sum + (sp.quantity || 1) * (sp.unitCost || sp.unit_cost || 0), 0))}
                  </span>
                )}
              </div>

              {Array.isArray(detailWO.spare_parts_used) && detailWO.spare_parts_used.length > 0 && (
                <div className="space-y-1.5">
                  {detailWO.spare_parts_used.map((sp: any, idx: number) => (
                    <div key={idx} className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900/40 rounded-lg p-2 text-sm">
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-gray-900 dark:text-white">
                          {sp.partName || sp.part_name || sp.name || `Part ${idx + 1}`}
                        </span>
                      </div>
                      <span className="text-xs text-gray-500 whitespace-nowrap">
                        {sp.quantity || 1} × {fmtCost(sp.unitCost || sp.unit_cost || 0)}
                      </span>
                      <span className="text-xs font-bold text-gray-700 dark:text-gray-300 w-16 text-right">
                        {fmtCost((sp.quantity || 1) * (sp.unitCost || sp.unit_cost || 0))}
                      </span>
                      <button
                        onClick={() => {
                          const parts = Array.isArray(detailWO.spare_parts_used) ? [...detailWO.spare_parts_used] : [];
                          parts.splice(idx, 1);
                          saveDetail({ sparePartsUsed: parts });
                        }}
                        className="p-1 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add spare part from inventory */}
              {spareParts.length > 0 && (
                <select
                  value=""
                  onChange={e => {
                    if (!e.target.value) return;
                    const part = spareParts.find(p => p.id === e.target.value);
                    if (!part) return;
                    const parts = Array.isArray(detailWO.spare_parts_used) ? [...detailWO.spare_parts_used] : [];
                    parts.push({ partId: part.id, partName: part.part_name, quantity: 1, unitCost: Number(part.unit_cost) || 0 });
                    saveDetail({ sparePartsUsed: parts });
                    e.target.value = '';
                  }}
                  className={inputClass}
                >
                  <option value="">+ Add a spare part from inventory…</option>
                  {spareParts
                    .filter(p => !(Array.isArray(detailWO.spare_parts_used) && detailWO.spare_parts_used.some((sp: any) => sp.partId === p.id)))
                    .map(p => (
                      <option key={p.id} value={p.id}>
                        {p.part_name} ({p.part_number}) — {p.current_stock} in stock · ${p.unit_cost}
                      </option>
                    ))}
                </select>
              )}

              {spareParts.length === 0 && (
                <p className="text-xs text-gray-400 italic">No spare parts in inventory. Add parts via the Spare Parts tab.</p>
              )}
            </div>

            {/* Tools Required — always visible, editable */}
            <div className="border border-gray-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <ToolCase className="w-4 h-4 text-[var(--color-accent-operations)]" />
                <span className="text-xs font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wide">Tools Required</span>
              </div>
              {(() => {
                const notesStr = detailWO.notes || '';
                const toolsMatch = notesStr.match(/Tools required:\s*(.+)/);
                const currentTools = toolsMatch ? toolsMatch[1].split(', ').filter(Boolean) : [];
                return (
                  <div className="flex flex-wrap gap-2">
                    {TOOL_OPTIONS.map(tool => {
                      const selected = currentTools.includes(tool);
                      return (
                        <button
                          key={tool}
                          onClick={() => {
                            const notesStr2 = detailWO.notes || '';
                            const toolsMatch2 = notesStr2.match(/Tools required:\s*(.+)/);
                            let tools2 = toolsMatch2 ? toolsMatch2[1].split(', ').filter(Boolean) : [];
                            if (tools2.includes(tool)) {
                              tools2 = tools2.filter(t => t !== tool);
                            } else {
                              tools2 = [...tools2, tool];
                            }
                            const cleanNotes = notesStr2.replace(/Tools required:\s*.+/, '').trim();
                            const newNotes = [cleanNotes, tools2.length > 0 ? `Tools required: ${tools2.join(', ')}` : ''].filter(Boolean).join('\n');
                            saveDetail({ notes: newNotes });
                          }}
                          className={[
                            'px-3 py-1.5 rounded-lg text-xs font-medium transition border',
                            selected
                              ? 'border-[var(--color-accent-operations)] bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]'
                              : 'border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-400 hover:border-[var(--color-accent-operations)]/50',
                          ].join(' ')}
                        >
                          {selected && <CheckCircle2 className="w-3 h-3 inline mr-1" />}
                          {tool}
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* Notes (without tools line) */}
            {(() => {
              const notesStr = detailWO.notes || '';
              const cleanNotes = notesStr.replace(/Tools required:\s*.+/, '').trim();
              return cleanNotes ? (
                <div>
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Notes</p>
                  <p className="text-sm text-gray-700 dark:text-gray-200 bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3 whitespace-pre-wrap">{cleanNotes}</p>
                </div>
              ) : null;
            })()}

            {/* Checklist — always visible, editable, with completion tracking */}
            <div className="border border-gray-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="w-4 h-4 text-[var(--color-accent-operations)]" />
                  <span className="text-xs font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wide">Task Checklist</span>
                </div>
                <div className="flex items-center gap-2">
                  {Array.isArray(detailWO.checklist) && detailWO.checklist.length > 0 && (
                    <span className="text-xs text-gray-500">
                      {Array.isArray(detailWO.completed_checklist) ? detailWO.completed_checklist.length : 0} / {detailWO.checklist.length} done
                    </span>
                  )}
                  <button
                    onClick={() => {
                      const checklist = Array.isArray(detailWO.checklist) ? [...detailWO.checklist] : [];
                      checklist.push('New step');
                      saveDetail({ checklist });
                    }}
                    className={button.ghost + ' text-xs'}
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Step
                  </button>
                </div>
              </div>

              {Array.isArray(detailWO.checklist) && detailWO.checklist.length > 0 ? (
                <div className="space-y-1.5">
                  {detailWO.checklist.map((item: any, idx: number) => {
                    const done = Array.isArray(detailWO.completed_checklist) && detailWO.completed_checklist.some((c: any) => (c.idx === idx || c.index === idx || c.step === idx));
                    const itemText = typeof item === 'string' ? item : (item.text || item.label || item.step || `Step ${idx + 1}`);
                    return (
                      <div key={idx} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/40">
                        <input
                          type="checkbox"
                          checked={done || false}
                          onChange={() => {
                            const completed = Array.isArray(detailWO.completed_checklist) ? [...detailWO.completed_checklist] : [];
                            const exists = completed.some((c: any) => c.idx === idx || c.index === idx || c.step === idx);
                            if (exists) {
                              saveDetail({ completedChecklist: completed.filter((c: any) => !(c.idx === idx || c.index === idx || c.step === idx)) });
                            } else {
                              saveDetail({ completedChecklist: [...completed, { idx, text: itemText, completedAt: new Date().toISOString() }] });
                            }
                          }}
                          className="w-4 h-4 rounded border-gray-300 dark:border-slate-600 text-[var(--color-accent-operations)] focus:ring-[var(--color-accent-operations)] shrink-0"
                        />
                        <input
                          defaultValue={itemText}
                          onBlur={(e) => {
                            const checklist = Array.isArray(detailWO.checklist) ? [...detailWO.checklist] : [];
                            checklist[idx] = e.target.value;
                            saveDetail({ checklist });
                          }}
                          className={`flex-1 text-sm bg-transparent border-none outline-none ${done ? 'line-through text-gray-400' : 'text-gray-700 dark:text-gray-200'}`}
                        />
                        <button
                          onClick={() => {
                            const checklist = Array.isArray(detailWO.checklist) ? [...detailWO.checklist] : [];
                            checklist.splice(idx, 1);
                            saveDetail({ checklist });
                          }}
                          className="p-1 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 shrink-0"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic">No checklist steps. Click "Add Step" to create one, or the checklist will auto-fill from the work order type when created via the New Work Order form.</p>
              )}
            </div>

            {/* Editable fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-gray-100 dark:border-slate-700">
              <Field label="Assign To">
                <select
                  value={detailWO.assigned_to || ''}
                  onChange={e => saveDetail({ assignedTo: e.target.value || null })}
                  className={inputClass}
                  disabled={actingOn === detailWO.id}
                >
                  <option value="">— Unassigned —</option>
                  {ASSIGNEE_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </Field>
              <Field label="Priority">
                <select
                  value={detailWO.priority}
                  onChange={e => saveDetail({ priority: e.target.value })}
                  className={inputClass}
                  disabled={actingOn === detailWO.id}
                >
                  {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Labor Hours">
                <input
                  type="number"
                  step="0.5"
                  defaultValue={detailWO.labor_hours || 0}
                  onBlur={e => saveDetail({ laborHours: parseFloat(e.target.value) || 0 })}
                  className={inputClass}
                  disabled={actingOn === detailWO.id}
                />
              </Field>
              <Field label="Actual Cost">
                <input
                  type="number"
                  step="0.01"
                  defaultValue={detailWO.actual_cost || 0}
                  onBlur={e => saveDetail({ actualCost: parseFloat(e.target.value) || 0 })}
                  className={inputClass}
                  disabled={actingOn === detailWO.id}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Notes">
                  <textarea
                    defaultValue={detailWO.notes || ''}
                    onBlur={e => saveDetail({ notes: e.target.value })}
                    rows={2}
                    className={inputClass}
                    disabled={actingOn === detailWO.id}
                  />
                </Field>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100 dark:border-slate-700">
              {(NEXT_ACTIONS[detailWO.status as WorkOrderStatus] || []).map(a => (
                <button
                  key={a}
                  onClick={() => { changeStatus(detailWO.id, a); }}
                  disabled={actingOn === detailWO.id}
                  className={button.primary + ' disabled:opacity-50'}
                >
                  {actingOn === detailWO.id && <Loader2 className="w-4 h-4 animate-spin" />}
                  {ACTION_LABELS[a]}
                </button>
              ))}
              <button
                onClick={() => removeWO(detailWO.id)}
                disabled={actingOn === detailWO.id}
                className={button.ghost + ' text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 ml-auto disabled:opacity-50'}
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default WorkOrderManagement;
