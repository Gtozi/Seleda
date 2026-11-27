/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Safety & Regulatory Compliance module — Engineering Portal
 * (/erp/maintenance/compliance).
 *
 * Tracks regulatory certificates, safety audits, inspections, licenses,
 * and permits across fire, electrical, elevator, water, and structural
 * systems.
 *
 * Flow: Scheduled → In Progress → Valid → (Overdue | Expired | Failed).
 * "Convert to Work Order" creates a real row in work_orders and links it
 * back via converted_work_order_id, integrating with the Work Order
 * Management console (/erp/maintenance/workorders).
 *
 * DB-integrated: fetches and persists via /api/eng-portal/compliance.
 * UI follows the Housekeeping portal design language (PageHeader,
 * SectionCard, StatCard, Badge, brandTheme tokens).
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ShieldCheck,
  Flame,
  Zap,
  ArrowUpDown,
  Droplets,
  Wind,
  Building2,
  Wrench,
  Leaf,
  ShieldAlert,
  FileText,
  Search,
  Plus,
  Calendar,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  ServerCrash,
  MoreVertical,
  Package,
  Trash2,
  ArrowRight,
  ChevronRight,
  Star,
  User,
  Hash,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchComplianceItems,
  createComplianceItem,
  updateComplianceItem,
  convertComplianceToWO,
  deleteComplianceItem,
  type ComplianceItem,
  type ComplianceCategory,
  type ComplianceType,
  type ComplianceStatus,
  type CompliancePriority,
} from '../../services/engineeringService';

// ── Static registries ────────────────────────────────────────────────────

const ALL_CATEGORIES: ComplianceCategory[] = [
  'Fire Safety', 'Electrical', 'Elevator', 'Water', 'Gas',
  'Structural', 'Mechanical', 'Environmental', 'General', 'Other',
];

const ALL_TYPES: ComplianceType[] = [
  'Certification', 'Inspection', 'Testing', 'Audit', 'License', 'Permit',
];

const ALL_PRIORITIES: CompliancePriority[] = ['Critical', 'High', 'Normal', 'Low'];

const STATUS_FLOW: ComplianceStatus[] = [
  'Scheduled', 'In Progress', 'Valid', 'Overdue', 'Expired', 'Failed',
];

const CATEGORY_ICON: Record<ComplianceCategory, LucideIcon> = {
  'Fire Safety': Flame,
  Electrical: Zap,
  Elevator: ArrowUpDown,
  Water: Droplets,
  Gas: Wind,
  Structural: Building2,
  Mechanical: Wrench,
  Environmental: Leaf,
  General: ShieldCheck,
  Other: FileText,
};

const STATUS_TONE: Record<ComplianceStatus, StatusTone> = {
  Valid: 'success',
  Scheduled: 'neutral',
  'In Progress': 'warning',
  Overdue: 'danger',
  Expired: 'danger',
  Failed: 'danger',
};

const PRIORITY_TONE: Record<CompliancePriority, StatusTone> = {
  Critical: 'danger',
  High: 'warning',
  Normal: 'info',
  Low: 'neutral',
};

// Next available status transitions for each status.
const NEXT_ACTIONS: Record<ComplianceStatus, ComplianceStatus[]> = {
  Scheduled: ['In Progress'],
  'In Progress': ['Valid', 'Failed'],
  Valid: [],
  Overdue: ['In Progress'],
  Expired: ['In Progress'],
  Failed: ['In Progress'],
};

const ACTION_LABELS: Record<ComplianceStatus, string> = {
  Scheduled: 'Start Inspection',
  'In Progress': 'Mark Valid',
  Valid: 'Valid',
  Overdue: 'Re-open',
  Expired: 'Re-open',
  Failed: 'Re-open',
};

const AUTHORITY_OPTIONS = [
  'Civil Defense', 'Technical Authority', 'Health Dept', 'Internal Ops',
  'Municipality', 'Fire Department', 'Environmental Agency', 'Insurance Auditor',
  'Equipment Manufacturer', 'External Contractor',
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
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysUntil(s: string | null): number | null {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  const diff = d.getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// ── Component ────────────────────────────────────────────────────────────

const ComplianceModule: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [items, setItems] = useState<ComplianceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<'All' | ComplianceStatus>('All');
  const [categoryFilter, setCategoryFilter] = useState<'All' | ComplianceCategory>('All');
  const [typeFilter, setTypeFilter] = useState<'All' | ComplianceType>('All');
  const [search, setSearch] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<{
    title: string;
    category: ComplianceCategory;
    type: ComplianceType;
    authority: string;
    priority: CompliancePriority;
    certificateNumber: string;
    issueDate: string;
    expiryDate: string;
    nextInspectionDate: string;
    responsiblePerson: string;
    notes: string;
  }>({
    title: '',
    category: 'Fire Safety',
    type: 'Certification',
    authority: 'Civil Defense',
    priority: 'Normal',
    certificateNumber: '',
    issueDate: '',
    expiryDate: '',
    nextInspectionDate: '',
    responsiblePerson: '',
    notes: '',
  });

  const [detail, setDetail] = useState<ComplianceItem | null>(null);
  const [detailReadOnly, setDetailReadOnly] = useState(true);
  const [detailForm, setDetailForm] = useState<{
    certificateNumber: string;
    issueDate: string;
    expiryDate: string;
    lastInspectedDate: string;
    nextInspectionDate: string;
    responsiblePerson: string;
    result: string;
    notes: string;
  }>({
    certificateNumber: '', issueDate: '', expiryDate: '', lastInspectedDate: '',
    nextInspectionDate: '', responsiblePerson: '', result: '', notes: '',
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
      const data = await fetchComplianceItems({
        propertyId: currentPropertyId || undefined,
      });
      setItems(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load compliance items');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  // ── Derived list ───────────────────────────────────────────────────────
  const filtered = useMemo(
    () =>
      items.filter(it => {
        const matchesStatus = statusFilter === 'All' || it.status === statusFilter;
        const matchesCategory = categoryFilter === 'All' || it.category === categoryFilter;
        const matchesType = typeFilter === 'All' || it.type === typeFilter;
        const q = search.trim().toLowerCase();
        const matchesSearch =
          !q ||
          it.comp_number.toLowerCase().includes(q) ||
          it.title.toLowerCase().includes(q) ||
          it.authority.toLowerCase().includes(q) ||
          it.category.toLowerCase().includes(q) ||
          it.type.toLowerCase().includes(q) ||
          (it.certificate_number || '').toLowerCase().includes(q) ||
          (it.responsible_person || '').toLowerCase().includes(q);
        return matchesStatus && matchesCategory && matchesType && matchesSearch;
      }),
    [items, statusFilter, categoryFilter, typeFilter, search]
  );

  const counts = {
    valid: items.filter(i => i.status === 'Valid').length,
    scheduled: items.filter(i => i.status === 'Scheduled').length,
    inProgress: items.filter(i => i.status === 'In Progress').length,
    overdue: items.filter(i => i.status === 'Overdue' || i.status === 'Expired').length,
    failed: items.filter(i => i.status === 'Failed').length,
  };

  // General Health Score — derived from the live compliance posture.
  // Weighted: valid items contribute positively; overdue/expired/failed detract.
  const healthScore = useMemo(() => {
    const total = items.length;
    if (total === 0) return null;
    const score =
      10 -
      (counts.overdue * 1.5 + counts.failed * 1.0 + counts.inProgress * 0.1) -
      Math.min(2, counts.scheduled * 0.05);
    return Math.max(0, Math.min(10, Math.round(score * 10) / 10));
  }, [items, counts]);

  const healthLabel = healthScore === null
    ? '—'
    : healthScore >= 9 ? 'EXCELLENT'
    : healthScore >= 7 ? 'GOOD'
    : healthScore >= 5 ? 'FAIR'
    : 'NEEDS ATTENTION';
  const healthStars = healthScore === null ? 0 : Math.round((healthScore / 10) * 5);

  // Next major audit — the nearest upcoming Scheduled/Valid item expiry.
  const nextAudit = useMemo(() => {
    const upcoming = items
      .filter(i => i.expiry_date && (i.status === 'Scheduled' || i.status === 'Valid'))
      .sort((a, b) => new Date(a.expiry_date!).getTime() - new Date(b.expiry_date!).getTime());
    return upcoming[0] || null;
  }, [items]);
  const nextAuditDays = daysUntil(nextAudit?.expiry_date || null);

  // ── Actions ────────────────────────────────────────────────────────────
  const submitCreate = async () => {
    if (!form.title.trim() || !form.category || !form.type || !form.authority.trim()) return;
    setSubmitting(true);
    try {
      const created = await createComplianceItem({
        propertyId: currentPropertyId || undefined,
        title: form.title.trim(),
        category: form.category,
        type: form.type,
        authority: form.authority.trim(),
        priority: form.priority,
        certificateNumber: form.certificateNumber.trim() || undefined,
        issueDate: form.issueDate || undefined,
        expiryDate: form.expiryDate || undefined,
        nextInspectionDate: form.nextInspectionDate || undefined,
        responsiblePerson: form.responsiblePerson.trim() || undefined,
        notes: form.notes.trim() || undefined,
      });
      setItems(prev => [created, ...prev]);
      addNotification(`Compliance item ${created.comp_number} logged for ${created.title}.`, 'task', 'Maintenance');
      setShowForm(false);
      setForm({
        title: '', category: 'Fire Safety', type: 'Certification', authority: 'Civil Defense',
        priority: 'Normal', certificateNumber: '', issueDate: '', expiryDate: '',
        nextInspectionDate: '', responsiblePerson: '', notes: '',
      });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to log compliance item', 'warning', 'Maintenance');
    } finally {
      setSubmitting(false);
    }
  };

  const changeStatus = async (id: string, status: ComplianceStatus) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      const { item } = await updateComplianceItem(id, { status });
      setItems(prev => prev.map(i => (i.id === id ? item : i)));
      addNotification(`Compliance item ${item.comp_number} → ${status}.`, 'task', 'Maintenance');
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
      const { item } = await updateComplianceItem(detail.id, {
        certificateNumber: detailForm.certificateNumber.trim() || null,
        issueDate: detailForm.issueDate || null,
        expiryDate: detailForm.expiryDate || null,
        lastInspectedDate: detailForm.lastInspectedDate || null,
        nextInspectionDate: detailForm.nextInspectionDate || null,
        responsiblePerson: detailForm.responsiblePerson.trim() || null,
        result: detailForm.result.trim() || null,
        notes: detailForm.notes.trim() || null,
      });
      setItems(prev => prev.map(i => (i.id === detail.id ? item : i)));
      setDetail(item);
      setDetailReadOnly(true);
      addNotification(`Compliance item ${item.comp_number} details updated.`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update compliance details', 'warning', 'Maintenance');
    } finally {
      setSavingDetail(false);
    }
  };

  const doConvert = async () => {
    if (!convertId) return;
    setConverting(true);
    try {
      const { item, workOrder } = await convertComplianceToWO(convertId, {
        assignedTo: convertForm.assignedTo.trim() || undefined,
        scheduledDate: convertForm.scheduledDate || undefined,
        notes: convertForm.notes.trim() || undefined,
      });
      setItems(prev => prev.map(i => (i.id === convertId ? item : i)));
      addNotification(
        `Compliance item ${item.comp_number} converted to work order ${workOrder.wo_number}.`,
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
      await deleteComplianceItem(id);
      setItems(prev => prev.filter(i => i.id !== id));
      addNotification(`Compliance item ${id} deleted.`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete compliance item', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const openDetail = (it: ComplianceItem) => {
    setDetail(it);
    setDetailReadOnly(true);
    setDetailForm({
      certificateNumber: it.certificate_number || '',
      issueDate: it.issue_date ? it.issue_date.slice(0, 10) : '',
      expiryDate: it.expiry_date ? it.expiry_date.slice(0, 10) : '',
      lastInspectedDate: it.last_inspected_date ? it.last_inspected_date.slice(0, 10) : '',
      nextInspectionDate: it.next_inspection_date ? it.next_inspection_date.slice(0, 10) : '',
      responsiblePerson: it.responsible_person || '',
      result: it.result || '',
      notes: it.notes || '',
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Safety & Regulatory Compliance"
        subtitle="Tracking certifications, safety audits, inspections, and operational licenses."
        icon={ShieldCheck}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={() => setShowForm(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> New Compliance Item
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Valid" value={counts.valid} icon={CheckCircle2} tone="success" />
        <StatCard title="Scheduled" value={counts.scheduled} icon={Calendar} tone="info" />
        <StatCard title="In Progress" value={counts.inProgress} icon={Clock} tone="warning" />
        <StatCard title="Overdue / Expired" value={counts.overdue} icon={AlertTriangle} tone="danger" />
      </div>

      {/* General Health Score card (preserved from original design, now derived) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-slate-900 text-white p-6 rounded-2xl flex flex-col sm:flex-row gap-6 relative overflow-hidden">
          <div className="absolute -top-4 -right-4 text-white/5 rotate-12">
            <ShieldCheck size={120} />
          </div>
          <div className="flex-1 space-y-4 z-10">
            <div>
              <h3 className="text-base font-sans font-black flex items-center gap-2">
                <ShieldAlert size={20} className="text-indigo-400" /> General Health Score
              </h3>
              <p className="text-xs text-white/60 font-medium">Combined safety &amp; building compliance rating (live-derived)</p>
            </div>

            <div className="flex items-end gap-3">
              <span className="text-5xl font-black tracking-tighter">{healthScore === null ? '—' : healthScore.toFixed(1)}</span>
              <div className="space-y-1 mb-2">
                <span className="text-[10px] text-emerald-400 font-black uppercase tracking-widest block">{healthLabel}</span>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map(i => (
                    <Star
                      key={i}
                      size={10}
                      fill={i <= healthStars ? '#fbbf24' : 'none'}
                      className={i <= healthStars ? 'text-amber-400' : 'text-white/20'}
                    />
                  ))}
                </div>
              </div>
            </div>

            <p className="text-[10px] text-white/50 leading-relaxed max-w-sm">
              {counts.overdue > 0
                ? `${counts.overdue} compliance item${counts.overdue === 1 ? '' : 's'} overdue or expired. Prioritize renewal to restore the rating.`
                : 'The property maintains strong compliance across tracked systems. Keep upcoming inspections on schedule.'}
            </p>
          </div>
          <div className="sm:w-48 bg-white/5 backdrop-blur-md rounded-2xl p-4 space-y-4 z-10 border border-white/10">
            <div className="space-y-1">
              <span className="text-[8px] font-black text-indigo-400 uppercase tracking-widest">Next Major Audit</span>
              {nextAudit ? (
                <>
                  <span className="block text-sm font-black">
                    {nextAuditDays === null ? '—' : nextAuditDays < 0 ? 'Overdue' : `${nextAuditDays} Days`}
                  </span>
                  <span className="block text-[8px] text-white/50 font-bold uppercase tracking-tight">{nextAudit.title}</span>
                </>
              ) : (
                <span className="block text-sm font-black">—</span>
              )}
            </div>
            <button
              onClick={() => nextAudit && openDetail(nextAudit)}
              className="w-full py-2 bg-indigo-500 hover:bg-indigo-600 rounded-xl text-[9px] font-black uppercase tracking-widest transition"
            >
              Audit Readiness
            </button>
          </div>
        </div>

        {/* Category breakdown */}
        <SectionCard title="By Category" subtitle="Live distribution across systems" pad="md">
          <div className="space-y-2.5">
            {ALL_CATEGORIES.map(cat => {
              const Icon = CATEGORY_ICON[cat];
              const catItems = items.filter(i => i.category === cat);
              const overdue = catItems.filter(i => i.status === 'Overdue' || i.status === 'Expired').length;
              if (catItems.length === 0) return null;
              return (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(categoryFilter === cat ? 'All' : cat)}
                  className={[
                    'w-full flex items-center justify-between p-2.5 rounded-xl border smooth-transition text-left',
                    categoryFilter === cat
                      ? 'border-[var(--color-accent-operations)] ring-1 ring-[var(--color-accent-operations)]/30 bg-[var(--color-accent-operations)]/10'
                      : 'border-gray-200 dark:border-slate-700 hover:border-[var(--color-accent-operations)]/50',
                  ].join(' ')}
                >
                  <span className="flex items-center gap-2">
                    <Icon className="w-4 h-4 text-[var(--color-accent-operations)]" />
                    <span className="text-xs font-bold text-gray-700 dark:text-gray-300">{cat}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {overdue > 0 && <span className="text-[10px] font-black text-[var(--color-danger)]">{overdue} overdue</span>}
                    <span className="text-xs font-black text-gray-500">{catItems.length}</span>
                  </span>
                </button>
              );
            })}
            {items.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-4">No items yet.</p>
            )}
          </div>
        </SectionCard>
      </div>

      {/* Type quick filter */}
      <SectionCard title="Compliance Types" subtitle="Click to filter by type" pad="md">
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {(['All' as const, ...ALL_TYPES] as const).map(t => {
            const active = typeFilter === t;
            const count = t === 'All' ? items.length : items.filter(i => i.type === t).length;
            return (
              <button
                key={t}
                onClick={() => setTypeFilter(typeFilter === t ? 'All' : (t as ComplianceType | 'All'))}
                className={[
                  'p-2.5 rounded-xl border text-center smooth-transition',
                  active
                    ? 'border-[var(--color-accent-operations)] ring-1 ring-[var(--color-accent-operations)]/30 bg-[var(--color-accent-operations)]/10'
                    : 'border-gray-200 dark:border-slate-700 hover:border-[var(--color-accent-operations)]/50',
                ].join(' ')}
              >
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
              placeholder="Search title, number, authority…"
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

      {/* Compliance list */}
      <SectionCard
        title="Regulatory Certificate Tracker"
        subtitle={loading ? 'Loading…' : `${filtered.length} matching item${filtered.length === 1 ? '' : 's'}`}
        pad="none"
        bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
      >
        {loading && (
          <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading compliance items…
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-500">
            {items.length === 0 ? 'No compliance items logged yet.' : 'No compliance items match the filters.'}
          </div>
        )}

        {!loading && !error && filtered.map(it => {
          const CatIcon = CATEGORY_ICON[it.category];
          const statusIdx = STATUS_FLOW.indexOf(it.status);
          const tone = STATUS_TONE[it.status];
          const priorityTone = PRIORITY_TONE[it.priority];
          const actions = NEXT_ACTIONS[it.status] || [];
          const isMenuOpen = menuOpen === it.id;
          const dleft = daysUntil(it.expiry_date);

          return (
            <div
              key={it.id}
              className="p-4 flex flex-col md:flex-row md:items-center gap-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition"
              onClick={() => openDetail(it)}
            >
              {/* Identity */}
              <div className="flex items-center gap-3 md:w-64 shrink-0">
                <div className={`p-2 rounded-xl ${statusTone[tone].soft}`}>
                  <CatIcon className={`w-4 h-4 ${statusTone[tone].text}`} />
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-gray-900 dark:text-white truncate">{it.title}</h4>
                  <p className="text-xs text-gray-500 font-mono truncate">
                    {it.comp_number} · {it.authority}
                  </p>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200 line-clamp-2">{it.notes || it.type}</p>
                <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-gray-500">
                  <span className="inline-flex items-center gap-1">
                    <Hash className="w-3.5 h-3.5" /> {it.type}
                  </span>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" /> Due {fmtDay(it.expiry_date)}
                  </span>
                  {it.responsible_person && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <User className="w-3.5 h-3.5" /> {it.responsible_person}
                      </span>
                    </>
                  )}
                  {dleft !== null && dleft < 0 && (it.status === 'Valid' || it.status === 'Scheduled') && (
                    <span className="inline-flex items-center gap-1 text-[var(--color-danger)] font-bold">
                      · {Math.abs(dleft)}d overdue
                    </span>
                  )}
                </div>
              </div>

              {/* Status + priority */}
              <div className="md:w-48 shrink-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <Badge tone={tone}>{it.status}</Badge>
                  <Badge tone={priorityTone} variant="solid">{it.priority}</Badge>
                </div>
                <div className="flex gap-1">
                  {['Scheduled', 'In Progress', 'Valid'].map((s, idx) => (
                    <div
                      key={s}
                      className={[
                        'h-1.5 flex-1 rounded-full',
                        statusIdx >= 0 && statusIdx <= 2 && statusIdx >= idx
                          ? 'bg-[var(--color-accent-operations)]'
                          : 'bg-slate-100 dark:bg-slate-800',
                      ].join(' ')}
                    />
                  ))}
                </div>
                {it.converted_work_order_id && (
                  <div className="mt-1.5">
                    <Badge tone="success" icon={CheckCircle2}>Linked WO</Badge>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="md:w-36 shrink-0 flex justify-end items-center gap-1.5">
                <div className="relative" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => setMenuOpen(isMenuOpen ? null : it.id)}
                    disabled={actingOn === it.id}
                    className={button.ghost + ' disabled:opacity-50'}
                  >
                    {actingOn === it.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MoreVertical className="w-4 h-4" />}
                  </button>
                  {isMenuOpen && (
                    <div className="absolute right-0 top-full mt-2 w-52 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden">
                      {actions.map(a => (
                        <button
                          key={a}
                          onClick={() => changeStatus(it.id, a)}
                          className="w-full text-left px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                        >
                          {ACTION_LABELS[a]}
                        </button>
                      ))}
                      {!it.converted_work_order_id && (
                        <button
                          onClick={() => { setConvertId(it.id); setMenuOpen(null); }}
                          className="w-full text-left px-3 py-2 text-xs font-medium text-[var(--color-accent-operations)] hover:bg-slate-100 dark:hover:bg-slate-700 transition border-t border-gray-100 dark:border-slate-700"
                        >
                          <Package className="w-3.5 h-3.5 inline mr-1" /> Convert to Work Order
                        </button>
                      )}
                      <button
                        onClick={() => doDelete(it.id)}
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

      {/* New Compliance Item modal */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => (submitting ? undefined : setShowForm(false))}
        title="New Compliance Item"
        subtitle="Log a regulatory certificate, safety audit, inspection, license, or permit."
        variant="form"
        size="lg"
        loading={submitting}
        confirmLabel={submitting ? 'Saving…' : 'Log Compliance Item'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitCreate}
        showFooter
      >
        <div className="space-y-4">
          <Field label="Title">
            <input
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Fire Safety Audit, Elevator Safety Check"
              className={inputClass}
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Category">
              <select
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value as ComplianceCategory }))}
                className={inputClass}
              >
                {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Type">
              <select
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value as ComplianceType }))}
                className={inputClass}
              >
                {ALL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Authority / Department">
              <select
                value={form.authority}
                onChange={e => setForm(f => ({ ...f, authority: e.target.value }))}
                className={inputClass}
              >
                {AUTHORITY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select
                value={form.priority}
                onChange={e => setForm(f => ({ ...f, priority: e.target.value as CompliancePriority }))}
                className={inputClass}
              >
                {ALL_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Certificate Number">
              <input
                value={form.certificateNumber}
                onChange={e => setForm(f => ({ ...f, certificateNumber: e.target.value }))}
                placeholder="Optional"
                className={inputClass}
              />
            </Field>
            <Field label="Responsible Person">
              <input
                value={form.responsiblePerson}
                onChange={e => setForm(f => ({ ...f, responsiblePerson: e.target.value }))}
                placeholder="Optional"
                className={inputClass}
              />
            </Field>
            <Field label="Issue Date">
              <input
                type="date"
                value={form.issueDate}
                onChange={e => setForm(f => ({ ...f, issueDate: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Expiry Date">
              <input
                type="date"
                value={form.expiryDate}
                onChange={e => setForm(f => ({ ...f, expiryDate: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Next Inspection Date">
              <input
                type="date"
                value={form.nextInspectionDate}
                onChange={e => setForm(f => ({ ...f, nextInspectionDate: e.target.value }))}
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Scope, requirements, remarks…"
              rows={3}
              className={inputClass}
            />
          </Field>
        </div>
      </ModalSystem>

      {/* Compliance detail modal */}
      <ModalSystem
        isOpen={!!detail}
        onClose={() => { setDetail(null); setDetailReadOnly(true); }}
        title={detail ? detail.title : 'Compliance Item'}
        subtitle={detail ? `${detail.comp_number} · ${detail.category} · ${detail.authority}` : ''}
        variant="form"
        size="lg"
        loading={savingDetail}
        confirmLabel={detailReadOnly ? 'Edit' : (savingDetail ? 'Saving…' : 'Save Changes')}
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
              <Badge tone="neutral">{detail.type}</Badge>
              {detail.converted_work_order_id && <Badge tone="success" icon={CheckCircle2}>Linked WO</Badge>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Certificate Number">
                {detailReadOnly ? (
                  <p className="text-sm text-gray-900 dark:text-white">{detail.certificate_number || '—'}</p>
                ) : (
                  <input
                    value={detailForm.certificateNumber}
                    onChange={e => setDetailForm(f => ({ ...f, certificateNumber: e.target.value }))}
                    placeholder="Optional"
                    className={inputClass}
                  />
                )}
              </Field>
              <Field label="Responsible Person">
                {detailReadOnly ? (
                  <p className="text-sm text-gray-900 dark:text-white">{detail.responsible_person || '—'}</p>
                ) : (
                  <input
                    value={detailForm.responsiblePerson}
                    onChange={e => setDetailForm(f => ({ ...f, responsiblePerson: e.target.value }))}
                    placeholder="Optional"
                    className={inputClass}
                  />
                )}
              </Field>
              <Field label="Issue Date">
                {detailReadOnly ? (
                  <p className="text-sm text-gray-900 dark:text-white">{fmtDay(detail.issue_date)}</p>
                ) : (
                  <input
                    type="date"
                    value={detailForm.issueDate}
                    onChange={e => setDetailForm(f => ({ ...f, issueDate: e.target.value }))}
                    className={inputClass}
                  />
                )}
              </Field>
              <Field label="Expiry Date">
                {detailReadOnly ? (
                  <p className="text-sm text-gray-900 dark:text-white">{fmtDay(detail.expiry_date)}</p>
                ) : (
                  <input
                    type="date"
                    value={detailForm.expiryDate}
                    onChange={e => setDetailForm(f => ({ ...f, expiryDate: e.target.value }))}
                    className={inputClass}
                  />
                )}
              </Field>
              <Field label="Last Inspected">
                {detailReadOnly ? (
                  <p className="text-sm text-gray-900 dark:text-white">{fmtDay(detail.last_inspected_date)}</p>
                ) : (
                  <input
                    type="date"
                    value={detailForm.lastInspectedDate}
                    onChange={e => setDetailForm(f => ({ ...f, lastInspectedDate: e.target.value }))}
                    className={inputClass}
                  />
                )}
              </Field>
              <Field label="Next Inspection">
                {detailReadOnly ? (
                  <p className="text-sm text-gray-900 dark:text-white">{fmtDay(detail.next_inspection_date)}</p>
                ) : (
                  <input
                    type="date"
                    value={detailForm.nextInspectionDate}
                    onChange={e => setDetailForm(f => ({ ...f, nextInspectionDate: e.target.value }))}
                    className={inputClass}
                  />
                )}
              </Field>
              <Field label="Result">
                {detailReadOnly ? (
                  <p className="text-sm text-gray-900 dark:text-white">{detail.result || '—'}</p>
                ) : (
                  <input
                    value={detailForm.result}
                    onChange={e => setDetailForm(f => ({ ...f, result: e.target.value }))}
                    placeholder="e.g. Pass, Certified, 98%"
                    className={inputClass}
                  />
                )}
              </Field>
            </div>

            <Field label="Notes">
              {detailReadOnly ? (
                <p className="text-sm text-gray-900 dark:text-white whitespace-pre-wrap">{detail.notes || '—'}</p>
              ) : (
                <textarea
                  value={detailForm.notes}
                  onChange={e => setDetailForm(f => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  className={inputClass}
                />
              )}
            </Field>

            {/* Status actions inside detail */}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100 dark:border-slate-700">
              {NEXT_ACTIONS[detail.status].map(a => (
                <button
                  key={a}
                  onClick={() => changeStatus(detail.id, a)}
                  disabled={actingOn === detail.id}
                  className={button.secondary + ' disabled:opacity-50'}
                >
                  {actingOn === detail.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  {ACTION_LABELS[a]}
                </button>
              ))}
              {!detail.converted_work_order_id && (
                <button
                  onClick={() => { setConvertId(detail.id); setDetail(null); }}
                  className={button.secondary}
                >
                  <Package className="w-3.5 h-3.5" /> Convert to Work Order
                </button>
              )}
            </div>
          </div>
        )}
      </ModalSystem>

      {/* Convert to Work Order modal */}
      <ModalSystem
        isOpen={!!convertId}
        onClose={() => (converting ? undefined : setConvertId(null))}
        title="Convert to Work Order"
        subtitle="Create a remediation work order linked to this compliance item."
        variant="form"
        size="md"
        loading={converting}
        confirmLabel={converting ? 'Converting…' : 'Create Work Order'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={doConvert}
        showFooter
      >
        <div className="space-y-4">
          <Field label="Assign To">
            <input
              value={convertForm.assignedTo}
              onChange={e => setConvertForm(f => ({ ...f, assignedTo: e.target.value }))}
              placeholder="Technician / team (optional)"
              className={inputClass}
            />
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
              placeholder="Remediation scope / remarks…"
              rows={3}
              className={inputClass}
            />
          </Field>
        </div>
      </ModalSystem>
    </div>
  );
};

export default ComplianceModule;
