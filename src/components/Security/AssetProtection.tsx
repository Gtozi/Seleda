/**
 * Asset Protection — /erp/security/asset-protection.
 *
 * DB-integrated via /api/sec-portal/assets routes (migration 616).
 * `sec_assets` is the high-value asset register — type, estimated value,
 * custodian, security level (Maximum/High/Standard), protection measures,
 * and a check schedule (last_check / next_check_due). `sec_asset_logs`
 * is the movement + review trail (Registered, Check Performed, Moved,
 * Status Change, Security Review, Alarm Test, Note), CASCADE on asset
 * delete. Status changes and location moves auto-log; POST /:id/check
 * stamps last_check and rolls next_check_due forward 30 days.
 *
 * UI follows the HK StaffManagementModule / F&B StaffOperations pattern:
 * PageHeader, StatCard KPIs, SectionCard + DataTable, Badge status pills,
 * ModalSystem forms, ERP notifications on mutations.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Shield, Plus, Search, CheckCircle2, Eye, Pencil, Trash2, RefreshCw,
  Loader2, ServerCrash, Filter, Clock, History, User, Tag, MapPin,
  AlertOctagon, Gem, ShieldCheck, Truck, FileText, CalendarClock,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import {
  fetchSecAssets, fetchSecAsset, createSecAsset, updateSecAsset,
  deleteSecAsset, checkSecAsset, addSecAssetLog, fetchSecStaff,
  type SecAsset, type SecAssetDetail, type SecAssetType,
  type SecAssetStatus, type SecAssetLevel, type SecAssetLogAction,
  type SecStaff,
} from '../../services/securityService';

// ── Static registries ────────────────────────────────────────────────────

const ASSET_TYPES: SecAssetType[] = [
  'Artwork', 'Cash & Valuables', 'Electronics', 'Vehicle',
  'Equipment', 'Documents', 'Furniture', 'Other',
];
const STATUSES: SecAssetStatus[] = ['Secured', 'In Transit', 'Under Review', 'Missing', 'Compromised'];
const LEVELS: SecAssetLevel[] = ['Maximum', 'High', 'Standard'];
const LOG_ACTIONS: SecAssetLogAction[] = [
  'Check Performed', 'Security Review', 'Moved', 'Alarm Test', 'Note',
];

const STATUS_TONE: Record<SecAssetStatus, StatusTone> = {
  Secured: 'success',
  'In Transit': 'info',
  'Under Review': 'warning',
  Missing: 'danger',
  Compromised: 'danger',
};

const LEVEL_TONE: Record<SecAssetLevel, StatusTone> = {
  Maximum: 'danger', High: 'warning', Standard: 'neutral',
};

const LOG_DOT: Record<SecAssetLogAction, string> = {
  Registered: 'bg-indigo-500',
  'Check Performed': 'bg-emerald-500',
  Moved: 'bg-blue-500',
  'Status Change': 'bg-amber-500',
  'Security Review': 'bg-violet-500',
  'Alarm Test': 'bg-cyan-500',
  Note: 'bg-slate-400',
};

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

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtMoney(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toLocaleString([], { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function checkOverdue(due: string | null | undefined): boolean {
  if (!due) return false;
  return new Date(due) < new Date();
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
            <tr><td colSpan={emptyColSpan} className="px-6 py-8 text-center text-slate-400">No assets found.</td></tr>
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

const AssetProtection: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [assets, setAssets] = useState<SecAsset[]>([]);
  const [staff, setStaff] = useState<SecStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | SecAssetStatus>('all');
  const [filterType, setFilterType] = useState<'all' | SecAssetType>('all');
  const [filterLevel, setFilterLevel] = useState<'all' | SecAssetLevel>('all');

  // Modals
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SecAsset | null>(null);
  const [detail, setDetail] = useState<SecAssetDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SecAsset | null>(null);

  // Log form (detail modal)
  const [logAction, setLogAction] = useState<SecAssetLogAction>('Check Performed');
  const [logDetail, setLogDetail] = useState('');

  const emptyForm = {
    name: '', assetType: 'Equipment' as SecAssetType, location: '',
    estimatedValue: '', serialNo: '', custodian: '',
    securityLevel: 'Standard' as SecAssetLevel, protectionMeasures: '',
    nextCheckDue: '', notes: '',
  };
  const [form, setForm] = useState({ ...emptyForm });

  // ── Data loading ───────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, s] = await Promise.all([
        fetchSecAssets(currentPropertyId),
        fetchSecStaff(currentPropertyId),
      ]);
      setAssets(a);
      setStaff(s);
    } catch (e: any) {
      setError(e?.message || 'Failed to load assets');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      setDetail(await fetchSecAsset(id));
    } catch (e: any) {
      addNotification(e?.message || 'Failed to load asset detail', 'warning', 'Security');
    } finally {
      setDetailLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { load(); }, [load]);

  const openDetail = (a: SecAsset) => {
    setDetail(null);
    setLogAction('Check Performed');
    setLogDetail('');
    loadDetail(a.id);
  };

  const refreshAll = async () => {
    await load();
    if (detail) await loadDetail(detail.asset.id);
    addNotification('Asset register refreshed', 'task', 'Security');
  };

  // ── Derived data ───────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    totalValue: assets.reduce((sum, a) => sum + (a.estimated_value || 0), 0),
    secured: assets.filter(a => a.status === 'Secured').length,
    attention: assets.filter(a => ['Under Review', 'Missing', 'Compromised'].includes(a.status)).length,
    checksOverdue: assets.filter(a => checkOverdue(a.next_check_due)).length,
  }), [assets]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return assets.filter(a => {
      const matchesStatus = filterStatus === 'all' || a.status === filterStatus;
      const matchesType = filterType === 'all' || a.asset_type === filterType;
      const matchesLevel = filterLevel === 'all' || a.security_level === filterLevel;
      const matchesSearch = !q ||
        a.id.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        (a.location?.toLowerCase().includes(q) ?? false) ||
        (a.serial_no?.toLowerCase().includes(q) ?? false) ||
        (a.custodian?.toLowerCase().includes(q) ?? false);
      return matchesStatus && matchesType && matchesLevel && matchesSearch;
    });
  }, [assets, filterStatus, filterType, filterLevel, search]);

  // ── Mutations ──────────────────────────────────────────────────────────

  const openNew = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  };

  const openEdit = (a: SecAsset) => {
    setEditing(a);
    setForm({
      name: a.name,
      assetType: a.asset_type,
      location: a.location || '',
      estimatedValue: a.estimated_value != null ? String(a.estimated_value) : '',
      serialNo: a.serial_no || '',
      custodian: a.custodian || '',
      securityLevel: a.security_level,
      protectionMeasures: a.protection_measures || '',
      nextCheckDue: a.next_check_due || '',
      notes: a.notes || '',
    });
    setShowForm(true);
  };

  const saveAsset = async () => {
    if (!form.name.trim()) {
      addNotification('Name is required', 'warning', 'Security');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name: form.name.trim(),
        assetType: form.assetType,
        location: form.location || null,
        estimatedValue: form.estimatedValue === '' ? null : parseFloat(form.estimatedValue),
        serialNo: form.serialNo || null,
        custodian: form.custodian || null,
        securityLevel: form.securityLevel,
        protectionMeasures: form.protectionMeasures || null,
        nextCheckDue: form.nextCheckDue || null,
        notes: form.notes || null,
      };
      if (editing) {
        const res = await updateSecAsset(editing.id, payload);
        setAssets(prev => prev.map(a => (a.id === editing.id ? res.asset : a)));
        if (detail?.asset.id === editing.id) loadDetail(editing.id);
        addNotification(`Asset ${editing.id} updated`, 'task', 'Security');
      } else {
        const created = await createSecAsset({ propertyId: currentPropertyId, ...payload });
        setAssets(prev => [created, ...prev]);
        addNotification(`Asset registered — ${created.id}`, 'task', 'Security');
      }
      setShowForm(false);
      setEditing(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save asset', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const patchAsset = async (a: SecAsset, patch: Parameters<typeof updateSecAsset>[1], toast?: string) => {
    setActingOn(a.id);
    try {
      const res = await updateSecAsset(a.id, patch);
      setAssets(prev => prev.map(x => (x.id === a.id ? res.asset : x)));
      if (detail?.asset.id === a.id) loadDetail(a.id);
      addNotification(toast || `Asset ${a.id} updated`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Update failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const logCheck = async (a: SecAsset) => {
    setActingOn(a.id);
    try {
      const res = await checkSecAsset(a.id);
      setAssets(prev => prev.map(x => (x.id === a.id ? res.asset : x)));
      if (detail?.asset.id === a.id) loadDetail(a.id);
      addNotification(`Check logged — ${a.id}, next due ${fmtDate(res.asset.next_check_due)}`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Check failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const submitLog = async () => {
    if (!detail) return;
    if (!logDetail.trim()) {
      addNotification('Describe the log entry', 'warning', 'Security');
      return;
    }
    setActingOn(detail.asset.id);
    try {
      await addSecAssetLog(detail.asset.id, {
        action: logAction,
        detail: logDetail.trim(),
        location: detail.asset.location || undefined,
      });
      await loadDetail(detail.asset.id);
      setLogDetail('');
      addNotification(`${logAction} logged`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Log failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const removeAsset = async () => {
    if (!deleteTarget) return;
    setActingOn(deleteTarget.id);
    try {
      await deleteSecAsset(deleteTarget.id);
      setAssets(prev => prev.filter(a => a.id !== deleteTarget.id));
      if (detail?.asset.id === deleteTarget.id) setDetail(null);
      addNotification(`Asset ${deleteTarget.id} removed`, 'task', 'Security');
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
        title="Asset Protection"
        subtitle="High-value asset register, security reviews, and tracking"
        icon={Shield}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={openNew} className={button.primary}>
              <Plus className="w-4 h-4" /> Register Asset
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Value" value={fmtMoney(stats.totalValue)} icon={Gem} tone="accent" />
        <StatCard title="Secured" value={stats.secured} icon={ShieldCheck} tone="success" />
        <StatCard title="Attention Required" value={stats.attention} icon={AlertOctagon} tone="danger" />
        <StatCard title="Checks Overdue" value={stats.checksOverdue} icon={Clock} tone="warning" />
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
              placeholder="Search name, ID, location, serial…"
              className={inputClass + ' pl-9'}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Filter size={12} className="text-slate-400" />
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} className={filterSelect}>
              <option value="all">All Status</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <Tag size={12} className="text-slate-400" />
            <select value={filterType} onChange={e => setFilterType(e.target.value as any)} className={filterSelect}>
              <option value="all">All Types</option>
              {ASSET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <Shield size={12} className="text-slate-400" />
            <select value={filterLevel} onChange={e => setFilterLevel(e.target.value as any)} className={filterSelect}>
              <option value="all">All Levels</option>
              {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        </div>
      </SectionCard>

      {/* Asset register */}
      <SectionCard title="Asset Register" subtitle="Asset · Type · Level · Value · Status · Check Schedule" icon={Shield} tone="accent" pad="none">
        {loading ? <LoadingRow /> : (
          <DataTable
            headers={['Asset', 'Type', 'Level', 'Value', 'Status', 'Custodian', 'Next Check', '']}
            rows={filtered.map(a => [
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg shrink-0 ${['Missing', 'Compromised'].includes(a.status) ? 'bg-red-500/10' : 'bg-[var(--color-accent-operations)]/10'}`}>
                  <Gem className={`w-4 h-4 ${['Missing', 'Compromised'].includes(a.status) ? 'text-red-500' : 'text-[var(--color-accent-operations)]'}`} />
                </div>
                <div className="min-w-0">
                  <button onClick={() => openDetail(a)} className="font-medium text-slate-900 dark:text-white hover:text-[var(--color-accent-operations)]">{a.name}</button>
                  <div className="text-[10px] text-slate-400 font-mono">
                    {a.id}{a.location ? ` · ${a.location}` : ''}
                  </div>
                </div>
              </div>,
              <Badge tone="neutral">{a.asset_type}</Badge>,
              <Badge tone={LEVEL_TONE[a.security_level]}>{a.security_level}</Badge>,
              <span className="font-mono text-xs font-semibold text-slate-900 dark:text-white">{fmtMoney(a.estimated_value)}</span>,
              <select
                value={a.status}
                onChange={e => patchAsset(a, { status: e.target.value as SecAssetStatus }, `Asset ${a.id} → ${e.target.value}`)}
                disabled={actingOn === a.id}
                className={inlineStatusSelect}
              >
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>,
              <span className="text-xs flex items-center gap-1"><User size={11} className="text-slate-400" />{a.custodian || '—'}</span>,
              <span className={`text-xs ${checkOverdue(a.next_check_due) ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>
                {a.next_check_due ? fmtDate(a.next_check_due) : '—'}{checkOverdue(a.next_check_due) ? ' · overdue' : ''}
              </span>,
              <div className="inline-flex gap-2">
                <button onClick={() => logCheck(a)} disabled={actingOn === a.id} className="p-1 text-slate-400 hover:text-emerald-500" title="Log Check"><CheckCircle2 className="w-4 h-4" /></button>
                <button onClick={() => openDetail(a)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="View"><Eye className="w-4 h-4" /></button>
                <button onClick={() => openEdit(a)} disabled={actingOn === a.id} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => setDeleteTarget(a)} disabled={actingOn === a.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete">
                  {actingOn === a.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>,
            ])}
            empty={filtered.length === 0}
            emptyColSpan={8}
          />
        )}
      </SectionCard>

      {/* New / Edit asset modal */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        onConfirm={saveAsset}
        title={editing ? `Edit ${editing.id}` : 'Register Asset'}
        subtitle={editing ? editing.name : 'Add a high-value asset to the protection register'}
        variant="form"
        size="lg"
        loading={submitting}
        confirmLabel={editing ? 'Save Changes' : 'Register Asset'}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Asset Name">
              <input className={inputClass} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g., Lobby Sculpture — Bronze" />
            </Field>
            <Field label="Asset Type">
              <select className={inputClass} value={form.assetType} onChange={e => setForm(f => ({ ...f, assetType: e.target.value as SecAssetType }))}>
                {ASSET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Location">
              <input className={inputClass} value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g., Main Lobby" />
            </Field>
            <Field label="Estimated Value (USD)">
              <input type="number" min={0} step="0.01" className={inputClass} value={form.estimatedValue} onChange={e => setForm(f => ({ ...f, estimatedValue: e.target.value }))} placeholder="e.g., 85000" />
            </Field>
            <Field label="Serial / Ref No.">
              <input className={inputClass} value={form.serialNo} onChange={e => setForm(f => ({ ...f, serialNo: e.target.value }))} placeholder="e.g., SAFE-FO-01" />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Custodian">
              <input
                className={inputClass}
                list="sec-asset-custodians"
                value={form.custodian}
                onChange={e => setForm(f => ({ ...f, custodian: e.target.value }))}
                placeholder="Select or type custodian"
              />
              <datalist id="sec-asset-custodians">
                {staff.map(s => <option key={s.id} value={s.name}>{s.role}</option>)}
              </datalist>
            </Field>
            <Field label="Security Level">
              <select className={inputClass} value={form.securityLevel} onChange={e => setForm(f => ({ ...f, securityLevel: e.target.value as SecAssetLevel }))}>
                {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </Field>
            <Field label="Next Check Due">
              <input type="date" className={inputClass} value={form.nextCheckDue} onChange={e => setForm(f => ({ ...f, nextCheckDue: e.target.value }))} />
            </Field>
          </div>
          <Field label="Protection Measures">
            <textarea className={inputClass + ' min-h-[56px]'} value={form.protectionMeasures} onChange={e => setForm(f => ({ ...f, protectionMeasures: e.target.value }))} placeholder="CCTV coverage, sensors, access controls, count procedures…" />
          </Field>
          <Field label="Notes">
            <textarea className={inputClass + ' min-h-[48px]'} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Insurance riders, loan terms, special handling…" />
          </Field>
        </div>
      </ModalSystem>

      {/* Asset detail modal */}
      <ModalSystem
        isOpen={!!detail || detailLoading}
        onClose={() => setDetail(null)}
        title={detail ? `Asset ${detail.asset.id}` : 'Asset Detail'}
        subtitle={detail ? `${detail.asset.name} · ${detail.asset.asset_type}` : ''}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {detailLoading || !detail ? <LoadingRow /> : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Status</p>
                <Badge tone={STATUS_TONE[detail.asset.status]}>{detail.asset.status}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Security Level</p>
                <Badge tone={LEVEL_TONE[detail.asset.security_level]}>{detail.asset.security_level}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Value</p>
                <p className="font-mono text-sm font-bold text-slate-900 dark:text-white">{fmtMoney(detail.asset.estimated_value)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Serial / Ref</p>
                <p className="font-mono text-xs text-slate-600 dark:text-slate-300">{detail.asset.serial_no || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Location</p>
                <p className="text-slate-600 dark:text-slate-300 flex items-center gap-1"><MapPin size={11} />{detail.asset.location || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Custodian</p>
                <p className="font-medium text-slate-900 dark:text-white flex items-center gap-1"><User size={11} />{detail.asset.custodian || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Last Check</p>
                <p className="text-slate-600 dark:text-slate-300">{fmtDateTime(detail.asset.last_check)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Next Check Due</p>
                <p className={`flex items-center gap-1 ${checkOverdue(detail.asset.next_check_due) ? 'text-red-600 font-semibold' : 'text-slate-600 dark:text-slate-300'}`}>
                  <CalendarClock size={11} />{fmtDate(detail.asset.next_check_due)}
                </p>
              </div>
              {detail.asset.protection_measures && (
                <div className="col-span-2 sm:col-span-4">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Protection Measures</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{detail.asset.protection_measures}</p>
                </div>
              )}
              {detail.asset.notes && (
                <div className="col-span-2 sm:col-span-4">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Notes</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{detail.asset.notes}</p>
                </div>
              )}
            </div>

            {/* Lifecycle actions */}
            <div className="flex flex-wrap gap-2">
              <button onClick={() => logCheck(detail.asset)} disabled={actingOn === detail.asset.id} className={button.primary + ' disabled:opacity-50'}>
                <CheckCircle2 className="w-4 h-4" /> Log Check
              </button>
              {detail.asset.status !== 'Secured' && (
                <button onClick={() => patchAsset(detail.asset, { status: 'Secured' }, `Asset ${detail.asset.id} secured`)} disabled={actingOn === detail.asset.id} className={button.secondary + ' disabled:opacity-50'}>
                  <ShieldCheck className="w-4 h-4" /> Mark Secured
                </button>
              )}
              {detail.asset.status !== 'In Transit' && (
                <button onClick={() => patchAsset(detail.asset, { status: 'In Transit' }, `Asset ${detail.asset.id} → In Transit`)} disabled={actingOn === detail.asset.id} className={button.secondary + ' disabled:opacity-50'}>
                  <Truck className="w-4 h-4" /> Mark In Transit
                </button>
              )}
              {detail.asset.status !== 'Under Review' && (
                <button onClick={() => patchAsset(detail.asset, { status: 'Under Review' }, `Asset ${detail.asset.id} → Under Review`)} disabled={actingOn === detail.asset.id} className={button.secondary + ' disabled:opacity-50'}>
                  <Eye className="w-4 h-4" /> Start Review
                </button>
              )}
              {detail.asset.status !== 'Missing' && detail.asset.status !== 'Compromised' && (
                <button onClick={() => patchAsset(detail.asset, { status: 'Missing' }, `Asset ${detail.asset.id} reported missing`)} disabled={actingOn === detail.asset.id} className={button.secondary + ' !text-[var(--color-danger)] disabled:opacity-50'}>
                  <AlertOctagon className="w-4 h-4" /> Report Missing
                </button>
              )}
              <button onClick={() => { setDetail(null); openEdit(detail.asset); }} className={button.secondary}>
                <Pencil className="w-4 h-4" /> Edit
              </button>
              <button onClick={() => setDeleteTarget(detail.asset)} className={button.secondary + ' text-[var(--color-danger)]'}>
                <Trash2 className="w-4 h-4" /> Remove
              </button>
            </div>

            {/* Log entry form */}
            <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-4">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                <FileText className="w-4 h-4 text-[var(--color-accent-operations)]" /> Log Entry
              </h4>
              <div className="flex flex-wrap gap-2">
                <select className={inputClass + ' !w-auto'} value={logAction} onChange={e => setLogAction(e.target.value as SecAssetLogAction)}>
                  {LOG_ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
                <input
                  className={inputClass + ' flex-1 min-w-[200px]'}
                  value={logDetail}
                  onChange={e => setLogDetail(e.target.value)}
                  placeholder="Check result, move details, review notes…"
                />
                <button onClick={submitLog} disabled={actingOn === detail.asset.id} className={button.secondary + ' disabled:opacity-50'}>
                  <Plus size={14} /> Log
                </button>
              </div>
            </div>

            {/* Asset trail */}
            <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-4">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                <History className="w-4 h-4 text-[var(--color-accent-operations)]" /> Tracking & Review Trail
              </h4>
              <div className="space-y-0 max-h-64 overflow-y-auto">
                {detail.logs.map((l, idx) => (
                  <div key={l.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className={`mt-1.5 inline-block w-2.5 h-2.5 rounded-full shrink-0 ${LOG_DOT[l.action]}`} />
                      {idx < detail.logs.length - 1 && <div className="w-0.5 flex-1 bg-slate-200 dark:bg-slate-700" />}
                    </div>
                    <div className="pb-3 min-w-0 flex-1">
                      <p className="text-sm text-slate-900 dark:text-white">{l.detail || l.action}</p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-400 mt-0.5">
                        <span className="font-bold uppercase">{l.action}</span>
                        {l.location && <span>· {l.location}</span>}
                        <span>· {fmtDateTime(l.created_at)}</span>
                        {l.actor && <span>· {l.actor}</span>}
                      </div>
                    </div>
                  </div>
                ))}
                {detail.logs.length === 0 && <p className="text-xs text-slate-400">No log entries yet.</p>}
              </div>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* Delete confirm */}
      <ModalSystem
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={removeAsset}
        title="Remove Asset"
        subtitle={deleteTarget ? `Permanently remove asset ${deleteTarget.id} (${deleteTarget.name}) and its tracking log?` : ''}
        variant="confirm"
        loading={actingOn === deleteTarget?.id}
        confirmLabel="Remove"
        confirmColor="rose"
      />
    </div>
  );
};

export default AssetProtection;
