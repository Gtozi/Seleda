/**
 * Lost & Found Oversight — /erp/security/lost-found.
 *
 * DB-integrated via /api/sec-portal/lostfound routes (migration 608).
 * `sec_lostfound_cases` is the case register; `sec_lostfound_custody` is a
 * real chain-of-custody log — lifecycle transitions auto-log custody
 * entries server-side, and staff can add manual custody/note entries.
 *
 * UI follows the HK StaffManagementModule / F&B StaffOperations pattern:
 * PageHeader, StatCard KPIs, SectionCard + DataTable, Badge status pills,
 * ModalSystem forms, ERP notifications on mutations.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Package, Plus, Search, CheckCircle2, Eye, Pencil, Trash2, RefreshCw,
  Loader2, ServerCrash, Filter, Clock, History, MapPin, User, Tag,
  Smartphone, Gem, FileText, Shirt, Luggage, Key, Archive, Handshake,
  ShieldCheck, Banknote, Boxes, Phone,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import {
  fetchSecLostFound, fetchSecLostFoundCase, createSecLostFoundCase,
  updateSecLostFoundCase, deleteSecLostFoundCase, addSecCustodyEntry,
  type SecLostFoundCase, type SecLostFoundDetail, type SecLostFoundStatus,
  type SecLostFoundCategory, type SecCustodyAction,
} from '../../services/securityService';

// ── Static registries ────────────────────────────────────────────────────

const CASE_STATUSES: SecLostFoundStatus[] = [
  'Reported', 'Found', 'In Storage', 'Claim Pending', 'Returned', 'Disposed',
];

const CATEGORIES: SecLostFoundCategory[] = [
  'Electronics', 'Jewelry & Watches', 'Documents', 'Clothing',
  'Bag & Luggage', 'Keys', 'Personal Items', 'Other',
];

const CATEGORY_ICON: Record<SecLostFoundCategory, typeof Package> = {
  Electronics: Smartphone,
  'Jewelry & Watches': Gem,
  Documents: FileText,
  Clothing: Shirt,
  'Bag & Luggage': Luggage,
  Keys: Key,
  'Personal Items': User,
  Other: Package,
};

const STATUS_TONE: Record<SecLostFoundStatus, StatusTone> = {
  Reported: 'warning',
  Found: 'info',
  'In Storage': 'accent',
  'Claim Pending': 'warning',
  Returned: 'success',
  Disposed: 'neutral',
};

const CUSTODY_DOT: Record<SecCustodyAction, string> = {
  Registered: 'bg-blue-500',
  'Item Found': 'bg-emerald-500',
  'Placed in Storage': 'bg-indigo-500',
  'Claim Submitted': 'bg-amber-500',
  'Claim Verified': 'bg-amber-600',
  'Released to Owner': 'bg-emerald-600',
  Disposed: 'bg-slate-400',
  Transferred: 'bg-purple-500',
  Edited: 'bg-slate-400',
  Note: 'bg-slate-400',
};

const CUSTODY_ACTIONS: SecCustodyAction[] = [
  'Note', 'Transferred', 'Claim Verified', 'Item Found', 'Placed in Storage',
];

// ── UI helpers ───────────────────────────────────────────────────────────

const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

const filterSelect =
  'bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-1.5 text-[10px] font-black uppercase text-slate-600 dark:text-slate-300 outline-none cursor-pointer';

const inlineStatusSelect =
  'bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-lg px-2 py-1 text-[9px] font-bold text-slate-600 dark:text-slate-300 outline-none cursor-pointer disabled:opacity-50';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtValue(v: number | null | undefined): string {
  if (v == null) return '—';
  return `$${Number(v).toFixed(0)}`;
}

function DataTable({ headers, rows, empty, emptyColSpan }: {
  headers: string[];
  rows: ReactNode[][];
  empty: boolean;
  emptyColSpan: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
          <tr>{headers.map((h, i) => <th key={i} className="px-6 py-3 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
          {rows.map((row, ri) => (
            <tr key={ri} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
              {row.map((cell, ci) => <td key={ci} className="px-6 py-3 text-slate-600 dark:text-slate-400">{cell}</td>)}
            </tr>
          ))}
          {empty && (
            <tr><td colSpan={emptyColSpan} className="px-6 py-8 text-center text-slate-400">No cases found.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function LoadingRow() {
  return (
    <div className="flex items-center justify-center py-10 text-slate-400">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────

const LostFoundOversight: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [cases, setCases] = useState<SecLostFoundCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | SecLostFoundStatus>('all');
  const [filterCategory, setFilterCategory] = useState<'all' | SecLostFoundCategory>('all');

  // Modals
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SecLostFoundCase | null>(null);
  const [detail, setDetail] = useState<SecLostFoundDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SecLostFoundCase | null>(null);

  // Custody note form (in detail modal)
  const [custodyAction, setCustodyAction] = useState<SecCustodyAction>('Note');
  const [custodyNote, setCustodyNote] = useState('');
  const [custodyLocation, setCustodyLocation] = useState('');

  const emptyForm = {
    itemName: '', description: '', category: 'Other' as SecLostFoundCategory,
    locationLost: '', locationFound: '', storageLocation: '',
    reportedBy: '', reporterContact: '', finderName: '',
    estimatedValue: '' as string,
  };
  const [form, setForm] = useState({ ...emptyForm });

  // ── Data loading ───────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCases(await fetchSecLostFound(currentPropertyId));
    } catch (e: any) {
      setError(e?.message || 'Failed to load cases');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      setDetail(await fetchSecLostFoundCase(id));
    } catch (e: any) {
      addNotification(e?.message || 'Failed to load case detail', 'warning', 'Security');
    } finally {
      setDetailLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { load(); }, [load]);

  const openDetail = (c: SecLostFoundCase) => {
    setDetail(null);
    setCustodyAction('Note');
    setCustodyNote('');
    setCustodyLocation('');
    loadDetail(c.id);
  };

  const refreshAll = async () => {
    await load();
    if (detail) await loadDetail(detail.case.id);
    addNotification('Lost & found register refreshed', 'task', 'Security');
  };

  // ── Derived data ───────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const open = cases.filter(c => !['Returned', 'Disposed'].includes(c.status));
    return {
      open: open.length,
      inStorage: cases.filter(c => c.status === 'In Storage').length,
      claims: cases.filter(c => c.status === 'Claim Pending').length,
      returned: cases.filter(c => c.status === 'Returned').length,
    };
  }, [cases]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return cases.filter(c => {
      const matchesStatus = filterStatus === 'all' || c.status === filterStatus;
      const matchesCategory = filterCategory === 'all' || c.category === filterCategory;
      const matchesSearch = !q ||
        c.id.toLowerCase().includes(q) ||
        c.item_name.toLowerCase().includes(q) ||
        (c.description?.toLowerCase().includes(q) ?? false) ||
        (c.reported_by?.toLowerCase().includes(q) ?? false) ||
        (c.finder_name?.toLowerCase().includes(q) ?? false);
      return matchesStatus && matchesCategory && matchesSearch;
    });
  }, [cases, filterStatus, filterCategory, search]);

  // ── Mutations ──────────────────────────────────────────────────────────

  const openNew = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  };

  const openEdit = (c: SecLostFoundCase) => {
    setEditing(c);
    setForm({
      itemName: c.item_name,
      description: c.description || '',
      category: c.category,
      locationLost: c.location_lost || '',
      locationFound: c.location_found || '',
      storageLocation: c.storage_location || '',
      reportedBy: c.reported_by || '',
      reporterContact: c.reporter_contact || '',
      finderName: c.finder_name || '',
      estimatedValue: c.estimated_value != null ? String(c.estimated_value) : '',
    });
    setShowForm(true);
  };

  const saveCase = async () => {
    if (!form.itemName.trim()) {
      addNotification('Item name is required', 'warning', 'Security');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        itemName: form.itemName.trim(),
        description: form.description || null,
        category: form.category,
        locationLost: form.locationLost || null,
        locationFound: form.locationFound || null,
        storageLocation: form.storageLocation || null,
        reportedBy: form.reportedBy || null,
        reporterContact: form.reporterContact || null,
        finderName: form.finderName || null,
        estimatedValue: form.estimatedValue ? parseFloat(form.estimatedValue) : null,
      };
      if (editing) {
        const res = await updateSecLostFoundCase(editing.id, payload);
        setCases(prev => prev.map(c => (c.id === editing.id ? res.case : c)));
        if (detail?.case.id === editing.id) loadDetail(editing.id);
        addNotification(`Case ${editing.id} updated`, 'task', 'Security');
      } else {
        const created = await createSecLostFoundCase({ propertyId: currentPropertyId, ...payload });
        setCases(prev => [created, ...prev]);
        addNotification(`Case ${created.id} opened for "${created.item_name}"`, 'task', 'Security');
      }
      setShowForm(false);
      setEditing(null);
      setForm({ ...emptyForm });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save case', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const patchCase = async (c: SecLostFoundCase, patch: Parameters<typeof updateSecLostFoundCase>[1], toast?: string) => {
    setActingOn(c.id);
    try {
      const res = await updateSecLostFoundCase(c.id, patch);
      setCases(prev => prev.map(x => (x.id === c.id ? res.case : x)));
      if (detail?.case.id === c.id) loadDetail(c.id);
      addNotification(toast || `Case ${c.id} updated`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Update failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const submitCustody = async () => {
    if (!detail) return;
    if (!custodyNote.trim() && custodyAction === 'Note') {
      addNotification('Enter a note for the custody log', 'warning', 'Security');
      return;
    }
    setActingOn(detail.case.id);
    try {
      await addSecCustodyEntry(detail.case.id, {
        action: custodyAction,
        location: custodyLocation || null,
        note: custodyNote || null,
      });
      await loadDetail(detail.case.id);
      setCustodyNote('');
      setCustodyLocation('');
      addNotification('Custody entry logged', 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Custody log failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const removeCase = async () => {
    if (!deleteTarget) return;
    setActingOn(deleteTarget.id);
    try {
      await deleteSecLostFoundCase(deleteTarget.id);
      setCases(prev => prev.filter(c => c.id !== deleteTarget.id));
      if (detail?.case.id === deleteTarget.id) setDetail(null);
      addNotification(`Case ${deleteTarget.id} removed`, 'task', 'Security');
      setDeleteTarget(null);
    } catch (e: any) {
      addNotification(e?.message || 'Delete failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Lost & Found Oversight"
        subtitle="Monitor lost and found cases with chain of custody tracking"
        icon={Package}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={openNew} className={button.primary}>
              <Plus className="w-4 h-4" /> New Case
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Open Cases" value={stats.open} icon={Package} tone="accent" />
        <StatCard title="In Storage" value={stats.inStorage} icon={Archive} tone="info" />
        <StatCard title="Claims Pending" value={stats.claims} icon={Clock} tone="warning" />
        <StatCard title="Returned" value={stats.returned} icon={Handshake} tone="success" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {/* Filters */}
      <SectionCard pad="md">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search item, ID, reporter, finder…"
              className={inputClass + ' pl-9'}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Filter size={12} className="text-slate-400" />
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} className={filterSelect}>
              <option value="all">All Status</option>
              {CASE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <Tag size={12} className="text-slate-400" />
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value as any)} className={filterSelect}>
              <option value="all">All Categories</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </SectionCard>

      {/* Case register */}
      <SectionCard title="Case Register" subtitle="Item · Category · Location · Status · Custody" icon={Package} tone="accent" pad="none">
        {loading ? <LoadingRow /> : (
          <DataTable
            headers={['Item', 'Category', 'Location', 'Reported By', 'Status', 'Value', 'Opened', '']}
            rows={filtered.map(c => {
              const Icon = CATEGORY_ICON[c.category] || Package;
              return [
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-[var(--color-accent-operations)]/10 shrink-0">
                    <Icon className="w-4 h-4 text-[var(--color-accent-operations)]" />
                  </div>
                  <div className="min-w-0">
                    <button onClick={() => openDetail(c)} className="font-medium text-slate-900 dark:text-white hover:text-[var(--color-accent-operations)]">{c.item_name}</button>
                    <div className="text-[10px] text-slate-400 font-mono">{c.id}</div>
                  </div>
                </div>,
                <Badge tone="neutral">{c.category}</Badge>,
                <span className="flex items-center gap-1 text-xs"><MapPin size={11} className="text-slate-400" />{c.location_found || c.location_lost || '—'}</span>,
                <span className="text-xs">{c.reported_by || c.finder_name || '—'}</span>,
                <select
                  value={c.status}
                  onChange={e => patchCase(c, { status: e.target.value as SecLostFoundStatus }, `Case ${c.id} → ${e.target.value}`)}
                  disabled={actingOn === c.id}
                  className={inlineStatusSelect}
                >
                  {CASE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>,
                <span className="text-xs font-semibold">{fmtValue(c.estimated_value)}</span>,
                <span className="text-xs text-slate-500">{fmtDateTime(c.reported_at)}</span>,
                <div className="inline-flex gap-2">
                  <button onClick={() => openDetail(c)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="View"><Eye className="w-4 h-4" /></button>
                  <button onClick={() => openEdit(c)} disabled={actingOn === c.id} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => setDeleteTarget(c)} disabled={actingOn === c.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete">
                    {actingOn === c.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>,
              ];
            })}
            empty={filtered.length === 0}
            emptyColSpan={8}
          />
        )}
      </SectionCard>

      {/* New / Edit case modal */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        onConfirm={saveCase}
        title={editing ? `Edit Case ${editing.id}` : 'New Lost & Found Case'}
        subtitle={editing ? editing.item_name : 'Register a lost report or found item'}
        variant="form"
        loading={submitting}
        confirmLabel={editing ? 'Save Changes' : 'Open Case'}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Item Name">
              <input className={inputClass} value={form.itemName} onChange={e => setForm(f => ({ ...f, itemName: e.target.value }))} placeholder="e.g., iPhone 15 Pro" />
            </Field>
            <Field label="Category">
              <select className={inputClass} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as SecLostFoundCategory }))}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Description">
            <textarea className={inputClass + ' min-h-[64px]'} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Distinguishing marks, contents, serial numbers…" />
          </Field>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Location Lost">
              <input className={inputClass} value={form.locationLost} onChange={e => setForm(f => ({ ...f, locationLost: e.target.value }))} placeholder="Where it was lost" />
            </Field>
            <Field label="Location Found">
              <input className={inputClass} value={form.locationFound} onChange={e => setForm(f => ({ ...f, locationFound: e.target.value }))} placeholder="Where it was found" />
            </Field>
            <Field label="Storage Location">
              <input className={inputClass} value={form.storageLocation} onChange={e => setForm(f => ({ ...f, storageLocation: e.target.value }))} placeholder="e.g., Safe A" />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Reported By">
              <input className={inputClass} value={form.reportedBy} onChange={e => setForm(f => ({ ...f, reportedBy: e.target.value }))} placeholder="Guest or staff name" />
            </Field>
            <Field label="Contact">
              <input className={inputClass} value={form.reporterContact} onChange={e => setForm(f => ({ ...f, reporterContact: e.target.value }))} placeholder="Room / phone / email" />
            </Field>
            <Field label="Finder">
              <input className={inputClass} value={form.finderName} onChange={e => setForm(f => ({ ...f, finderName: e.target.value }))} placeholder="Who found it" />
            </Field>
          </div>
          <Field label="Estimated Value ($)">
            <input type="number" min={0} step="0.01" className={inputClass} value={form.estimatedValue} onChange={e => setForm(f => ({ ...f, estimatedValue: e.target.value }))} placeholder="0.00" />
          </Field>
        </div>
      </ModalSystem>

      {/* Case detail modal */}
      <ModalSystem
        isOpen={!!detail || detailLoading}
        onClose={() => setDetail(null)}
        title={detail ? `Case ${detail.case.id}` : 'Case Detail'}
        subtitle={detail ? `${detail.case.item_name} · ${detail.case.category}` : ''}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {detailLoading || !detail ? <LoadingRow /> : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Status</p>
                <Badge tone={STATUS_TONE[detail.case.status]}>{detail.case.status}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Category</p>
                <Badge tone="neutral">{detail.case.category}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Est. Value</p>
                <p className="font-medium text-slate-900 dark:text-white flex items-center gap-1"><Banknote size={11} />{fmtValue(detail.case.estimated_value)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Storage</p>
                <p className="font-medium text-slate-900 dark:text-white flex items-center gap-1"><Boxes size={11} />{detail.case.storage_location || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Location Lost</p>
                <p className="text-slate-600 dark:text-slate-300">{detail.case.location_lost || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Location Found</p>
                <p className="text-slate-600 dark:text-slate-300">{detail.case.location_found || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Reported By</p>
                <p className="text-slate-600 dark:text-slate-300">{detail.case.reported_by || '—'}</p>
                {detail.case.reporter_contact && <p className="text-[10px] text-slate-400 flex items-center gap-1"><Phone size={9} />{detail.case.reporter_contact}</p>}
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Finder</p>
                <p className="text-slate-600 dark:text-slate-300">{detail.case.finder_name || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Claimed By</p>
                <p className="text-slate-600 dark:text-slate-300">{detail.case.claimed_by || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Reported</p>
                <p className="text-slate-600 dark:text-slate-300">{fmtDateTime(detail.case.reported_at)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Returned</p>
                <p className="text-slate-600 dark:text-slate-300">{fmtDateTime(detail.case.returned_at)}</p>
              </div>
              {detail.case.description && (
                <div className="col-span-2 sm:col-span-4">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Description</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{detail.case.description}</p>
                </div>
              )}
            </div>

            {/* Lifecycle actions */}
            <div className="flex flex-wrap gap-2">
              {detail.case.status === 'Reported' && (
                <button onClick={() => patchCase(detail.case, { status: 'Found' }, `Item marked found — ${detail.case.item_name}`)} disabled={actingOn === detail.case.id} className={button.primary + ' disabled:opacity-50'}>
                  <CheckCircle2 className="w-4 h-4" /> Mark Found
                </button>
              )}
              {(detail.case.status === 'Found' || detail.case.status === 'Reported') && (
                <button onClick={() => patchCase(detail.case, { status: 'In Storage' }, `Item stored — ${detail.case.item_name}`)} disabled={actingOn === detail.case.id} className={button.secondary + ' disabled:opacity-50'}>
                  <Archive className="w-4 h-4" /> Place in Storage
                </button>
              )}
              {(detail.case.status === 'In Storage' || detail.case.status === 'Found') && (
                <button onClick={() => patchCase(detail.case, { status: 'Claim Pending' }, `Claim submitted — ${detail.case.item_name}`)} disabled={actingOn === detail.case.id} className={button.secondary + ' disabled:opacity-50'}>
                  <User className="w-4 h-4" /> Record Claim
                </button>
              )}
              {(detail.case.status === 'Claim Pending' || detail.case.status === 'In Storage') && (
                <button onClick={() => patchCase(detail.case, { status: 'Returned' }, `Item released to owner — ${detail.case.item_name}`)} disabled={actingOn === detail.case.id} className={button.primary + ' disabled:opacity-50'}>
                  <Handshake className="w-4 h-4" /> Release to Owner
                </button>
              )}
              {detail.case.status !== 'Returned' && detail.case.status !== 'Disposed' && (
                <button onClick={() => patchCase(detail.case, { status: 'Disposed' }, `Case ${detail.case.id} disposed`)} disabled={actingOn === detail.case.id} className={button.secondary + ' text-[var(--color-danger)]'}>
                  Dispose
                </button>
              )}
              <button onClick={() => { setDetail(null); openEdit(detail.case); }} className={button.secondary}>
                <Pencil className="w-4 h-4" /> Edit
              </button>
              <button onClick={() => setDeleteTarget(detail.case)} className={button.secondary + ' text-[var(--color-danger)]'}>
                <Trash2 className="w-4 h-4" /> Remove
              </button>
            </div>

            {/* Custody note form */}
            <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-4">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                <ShieldCheck className="w-4 h-4 text-[var(--color-accent-operations)]" /> Log Custody Entry
              </h4>
              <div className="flex flex-wrap gap-2">
                <select className={inputClass + ' !w-auto'} value={custodyAction} onChange={e => setCustodyAction(e.target.value as SecCustodyAction)}>
                  {CUSTODY_ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
                <input className={inputClass + ' !w-40'} value={custodyLocation} onChange={e => setCustodyLocation(e.target.value)} placeholder="Location (optional)" />
                <input className={inputClass + ' flex-1 min-w-[160px]'} value={custodyNote} onChange={e => setCustodyNote(e.target.value)} placeholder="Custody note — who handled it, where…" />
                <button onClick={submitCustody} disabled={actingOn === detail.case.id} className={button.secondary + ' disabled:opacity-50'}>
                  <Plus size={14} /> Log
                </button>
              </div>
            </div>

            {/* Custody chain */}
            <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-4">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                <History className="w-4 h-4 text-[var(--color-accent-operations)]" /> Chain of Custody
              </h4>
              <div className="space-y-0 max-h-56 overflow-y-auto">
                {detail.custody.map((ev, idx) => (
                  <div key={ev.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className={`w-2.5 h-2.5 rounded-full mt-1 ${CUSTODY_DOT[ev.action] || 'bg-slate-400'}`} />
                      {idx < detail.custody.length - 1 && <div className="w-0.5 flex-1 bg-slate-200 dark:bg-slate-700" />}
                    </div>
                    <div className="pb-3 min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-white">{ev.action}</p>
                      {(ev.from_person || ev.to_person) && (
                        <p className="text-xs text-slate-500">{[ev.from_person, ev.to_person].filter(Boolean).join(' → ')}</p>
                      )}
                      {ev.location && <p className="text-xs text-slate-500 flex items-center gap-1"><MapPin size={10} />{ev.location}</p>}
                      {ev.note && <p className="text-xs text-slate-500">{ev.note}</p>}
                      <p className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                        <Clock size={10} />{fmtDateTime(ev.created_at)}{ev.actor ? ` · ${ev.actor}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
                {detail.custody.length === 0 && <p className="text-xs text-slate-400">No custody entries yet.</p>}
              </div>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* Delete confirm */}
      <ModalSystem
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={removeCase}
        title="Remove Case"
        subtitle={deleteTarget ? `Permanently remove case ${deleteTarget.id} (${deleteTarget.item_name}) and its custody log?` : ''}
        variant="confirm"
        loading={actingOn === deleteTarget?.id}
        confirmLabel="Remove"
        confirmColor="rose"
      />
    </div>
  );
};

export default LostFoundOversight;
