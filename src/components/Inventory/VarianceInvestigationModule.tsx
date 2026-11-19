/**
 * Variance Investigations — spec §23/§50.
 * DB-integrated via /api/uinv-portal/variance-investigations.
 *
 * Workflow: Open → Under Investigation → (Resolved - Adjusted | Resolved - Accepted |
 *           Resolved - Escalated | Closed).
 * "From Count" auto-creates investigations for every line on a count with a non-zero
 * variance (POST /variance-investigations/from-count/:countId).
 */
import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Search, Plus, Clock, Loader2, ServerCrash, MoreVertical,
  CheckCircle2, XCircle, Trash2, AlertTriangle, Send,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchVarianceInvestigations, createVarianceInvestigation,
  createVarianceInvestigationsFromCount, updateVarianceInvestigation,
  deleteVarianceInvestigation,
  fetchItems, fetchStores, fetchCounts,
  type UinvVarianceInvestigation, type UinvItem, type UinvStore,
} from '../../services/inventoryService';
import InventoryTable, { IdentityCell, OpsCell } from './InventoryTable';

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

const SOURCES = ['Stock Count', 'Receiving', 'Issue', 'Return', 'Transfer', 'Waste', 'Adjustment', 'Batch', 'Other'];
const STATUSES = ['Open', 'Under Investigation', 'Resolved - Adjusted', 'Resolved - Accepted', 'Resolved - Escalated', 'Closed'];

const emptyForm = () => ({
  item_id: '',
  store_id: '',
  source: 'Stock Count',
  variance_quantity: 0,
  variance_value: 0,
  assigned_to: '',
  notes: '',
});

const VarianceInvestigationModule: React.FC<{ subTabBar?: React.ReactNode }> = ({ subTabBar }) => {
  const { currentPropertyId, addNotification } = useERP();
  const [rows, setRows] = useState<UinvVarianceInvestigation[]>([]);
  const [items, setItems] = useState<UinvItem[]>([]);
  const [stores, setStores] = useState<UinvStore[]>([]);
  const [counts, setCounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [showForm, setShowForm] = useState(false);
  const [showFromCount, setShowFromCount] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [form, setForm] = useState<any>(emptyForm());
  const [fromCountId, setFromCountId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const propertyId = currentPropertyId || undefined;
      const [v, it, st, ct] = await Promise.all([
        fetchVarianceInvestigations({ propertyId }),
        fetchItems({ propertyId, active: 'true' }).catch(() => [] as UinvItem[]),
        fetchStores({ propertyId, active: 'true' }).catch(() => [] as UinvStore[]),
        fetchCounts({ propertyId }).catch(() => [] as any[]),
      ]);
      setRows(v);
      setItems(it);
      setStores(st);
      setCounts(ct);
    } catch (e: any) {
      setError(e?.message || 'Failed to load variance investigations');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      const matchesStatus = statusFilter === 'All' || r.status === statusFilter;
      const matchesSearch = !q ||
        (r.investigation_number || '').toLowerCase().includes(q) ||
        (r.item?.item_name || '').toLowerCase().includes(q) ||
        (r.source || '').toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [rows, search, statusFilter]);

  const counts2 = useMemo(() => ({
    open: rows.filter(r => r.status === 'Open').length,
    investigating: rows.filter(r => r.status === 'Under Investigation').length,
    resolved: rows.filter(r => r.status.startsWith('Resolved')).length,
    total: rows.length,
    totalVarianceValue: rows.reduce((s, r) => s + Number(r.variance_value || 0), 0),
  }), [rows]);

  const submit = async () => {
    if (!form.item_id) { addNotification('Item is required.', 'warning', 'Inventory'); return; }
    setSubmitting(true);
    try {
      const created = await createVarianceInvestigation({
        ...form,
        property_id: currentPropertyId,
        variance_quantity: Number(form.variance_quantity) || 0,
        variance_value: Number(form.variance_value) || 0,
      });
      setRows(prev => [created, ...prev]);
      addNotification(`Investigation ${created.investigation_number} created.`, 'success', 'Inventory');
      setShowForm(false);
      setForm(emptyForm());
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create investigation', 'warning', 'Inventory');
    } finally { setSubmitting(false); }
  };

  const submitFromCount = async () => {
    if (!fromCountId) { addNotification('Select a count.', 'warning', 'Inventory'); return; }
    setSubmitting(true);
    try {
      const result = await createVarianceInvestigationsFromCount(fromCountId);
      addNotification(`${result.created.length} investigations created from count.`, 'success', 'Inventory');
      setShowFromCount(false);
      setFromCountId('');
      load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create from count', 'warning', 'Inventory');
    } finally { setSubmitting(false); }
  };

  const advance = async (r: UinvVarianceInvestigation, newStatus: string) => {
    setActingOn(r.id); setMenuOpen(null);
    try {
      const patch: any = { status: newStatus };
      if (newStatus.startsWith('Resolved') || newStatus === 'Closed') {
        patch.resolved_at = new Date().toISOString();
      }
      const updated = await updateVarianceInvestigation(r.id, patch);
      setRows(prev => prev.map(x => (x.id === r.id ? updated : x)));
      addNotification(`→ ${newStatus}.`, 'success', 'Inventory');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update', 'warning', 'Inventory');
    } finally { setActingOn(null); }
  };

  const remove = async (id: string) => {
    setActingOn(id); setMenuOpen(null);
    try {
      await deleteVarianceInvestigation(id);
      setRows(prev => prev.filter(x => x.id !== id));
      addNotification('Investigation deleted.', 'warning', 'Inventory');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete', 'warning', 'Inventory');
    } finally { setActingOn(null); }
  };

  const statusToneFor = (status: string): StatusTone => {
    if (status === 'Open') return 'warning';
    if (status === 'Under Investigation') return 'info';
    if (status.startsWith('Resolved - Adjusted')) return 'success';
    if (status.startsWith('Resolved - Accepted')) return 'success';
    if (status.startsWith('Resolved - Escalated')) return 'danger';
    if (status === 'Closed') return 'neutral';
    return 'neutral';
  };

  const ACTIONS: Record<string, { label: string; next: string; icon: React.ElementType }[]> = {
    'Open': [{ label: 'Investigate', next: 'Under Investigation', icon: Search }],
    'Under Investigation': [
      { label: 'Resolve - Adjusted', next: 'Resolved - Adjusted', icon: CheckCircle2 },
      { label: 'Resolve - Accepted', next: 'Resolved - Accepted', icon: CheckCircle2 },
      { label: 'Escalate', next: 'Resolved - Escalated', icon: Send },
    ],
    'Resolved - Adjusted': [{ label: 'Close', next: 'Closed', icon: XCircle }],
    'Resolved - Accepted': [{ label: 'Close', next: 'Closed', icon: XCircle }],
    'Resolved - Escalated': [{ label: 'Close', next: 'Closed', icon: XCircle }],
    'Closed': [],
  };

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Variance Investigations"
        subtitle="Count variance detection → investigation → resolution (spec §23/§50)."
        icon={AlertTriangle}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />} Refresh
            </button>
            <button onClick={() => setShowFromCount(true)} className={button.secondary}>
              <Plus className="w-4 h-4" /> From Count
            </button>
            <button onClick={() => setShowForm(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> New Investigation
            </button>
          </div>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Open" value={counts2.open} icon={AlertTriangle} tone="warning" />
        <StatCard title="Under Investigation" value={counts2.investigating} icon={Search} tone="info" />
        <StatCard title="Resolved" value={counts2.resolved} icon={CheckCircle2} tone="success" />
        <StatCard title="Total Variance Value" value={counts2.totalVarianceValue.toLocaleString(undefined, { minimumFractionDigits: 2 })} icon={AlertTriangle} tone="danger" />
      </div>

      {subTabBar}

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      <SectionCard pad="md">
        <div className="flex flex-wrap items-center justify-end gap-4">
          <div className="flex items-center gap-2">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white">
              <option>All</option>
              {STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
          </div>
        </div>
      </SectionCard>

      <InventoryTable
        rows={filtered}
        rowKey={(r: UinvVarianceInvestigation) => r.id}
        loading={loading}
        loadingMessage="Loading…"
        error={error}
        onRetry={load}
        emptyMessage="No variance investigations."
        columns={[
          {
            key: 'record',
            header: 'Investigation',
            widthClass: 'md:w-44 shrink-0',
            render: (r: UinvVarianceInvestigation) => {
              const tone = statusToneFor(r.status);
              return (
                <IdentityCell
                  icon={<AlertTriangle size={20} />}
                  soft={statusTone[tone].soft}
                  text={statusTone[tone].text}
                  name={r.investigation_number}
                  code={r.source}
                />
              );
            },
          },
          {
            key: 'item',
            header: 'Item',
            widthClass: 'md:w-52 shrink-0',
            render: (r: UinvVarianceInvestigation) => (
              <div className="min-w-0">
                <p className="font-medium text-slate-900 dark:text-white truncate">{r.item?.item_name || 'Unknown item'}</p>
                <span className="text-xs text-slate-500 dark:text-slate-400 block truncate">{r.item?.item_code || r.item_id}</span>
              </div>
            ),
          },
          {
            key: 'store',
            header: 'Store',
            widthClass: 'md:w-40 shrink-0',
            render: (r: UinvVarianceInvestigation) => (
              <span className="text-sm text-slate-600 dark:text-slate-300">{r.store?.store_name || r.store_id || '—'}</span>
            ),
          },
          {
            key: 'variance',
            header: 'Variance',
            widthClass: 'md:w-32 shrink-0',
            align: 'right',
            render: (r: UinvVarianceInvestigation) => (
              <div className="text-right">
                <p className={`text-sm font-bold ${Number(r.variance_quantity) < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {Number(r.variance_quantity).toLocaleString()}
                </p>
                <span className="text-xs text-slate-500">{Number(r.variance_value).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
            ),
          },
          {
            key: 'assigned',
            header: 'Assigned To',
            widthClass: 'md:w-36 shrink-0',
            render: (r: UinvVarianceInvestigation) => (
              <span className="text-sm text-slate-600 dark:text-slate-300">{r.assigned_to || '—'}</span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            widthClass: 'md:w-40 shrink-0',
            render: (r: UinvVarianceInvestigation) => (
              <Badge tone={statusToneFor(r.status)} variant="solid">{r.status}</Badge>
            ),
          },
          {
            key: 'ops',
            header: 'Ops',
            widthClass: 'md:w-24 shrink-0',
            align: 'right',
            render: (r: UinvVarianceInvestigation) => (
              <OpsCell>
                <button onClick={() => setMenuOpen(menuOpen === r.id ? null : r.id)} className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
                  {actingOn === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoreVertical className="w-4 h-4" />}
                </button>
                {menuOpen === r.id && (
                  <div className="absolute right-0 top-8 z-20 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg py-1 min-w-[180px]">
                    {(ACTIONS[r.status] || []).map(act => {
                      const Icon = act.icon;
                      return (
                        <button key={act.next} onClick={() => advance(r, act.next)} disabled={actingOn === r.id}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-slate-700 flex items-center gap-2 disabled:opacity-50">
                          <Icon className="w-4 h-4" /> {act.label}
                        </button>
                      );
                    })}
                    <button onClick={() => remove(r.id)} disabled={actingOn === r.id}
                      className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 disabled:opacity-50">
                      <Trash2 className="w-4 h-4" /> Delete
                    </button>
                  </div>
                )}
              </OpsCell>
            ),
          },
        ]}
      />

      {/* New Investigation modal */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        title="New Variance Investigation"
        subtitle="Manually open an investigation"
        variant="form"
        size="md"
        showFooter={false}
      >
        <div className="p-6 space-y-4">
          <Field label="Item">
            <select className={inputClass} value={form.item_id} onChange={e => setForm({ ...form, item_id: e.target.value })}>
              <option value="">— Select Item —</option>
              {items.map(it => <option key={it.id} value={it.id}>{it.item_name} ({it.item_code})</option>)}
            </select>
          </Field>
          <Field label="Store">
            <select className={inputClass} value={form.store_id} onChange={e => setForm({ ...form, store_id: e.target.value })}>
              <option value="">— Select Store —</option>
              {stores.map(s => <option key={s.id} value={s.id}>{s.store_name}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Source">
              <select className={inputClass} value={form.source} onChange={e => setForm({ ...form, source: e.target.value })}>
                {SOURCES.map(s => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Assigned To">
              <input className={inputClass} value={form.assigned_to} onChange={e => setForm({ ...form, assigned_to: e.target.value })} placeholder="Staff name" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Variance Quantity">
              <input type="number" className={inputClass} value={form.variance_quantity} onChange={e => setForm({ ...form, variance_quantity: Number(e.target.value) })} />
            </Field>
            <Field label="Variance Value">
              <input type="number" className={inputClass} value={form.variance_value} onChange={e => setForm({ ...form, variance_value: Number(e.target.value) })} />
            </Field>
          </div>
          <Field label="Notes">
            <textarea className={inputClass} rows={3} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
        <div className="p-6 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-3 bg-slate-50/30 dark:bg-slate-700/20">
          <button onClick={() => setShowForm(false)} className={button.secondary}>Cancel</button>
          <button onClick={submit} disabled={submitting} className={button.primary + ' disabled:opacity-50'}>
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create
          </button>
        </div>
      </ModalSystem>

      {/* From Count modal */}
      <ModalSystem
        isOpen={showFromCount}
        onClose={() => setShowFromCount(false)}
        title="Create Investigations From Count"
        subtitle="Auto-create investigations for every line with a non-zero variance"
        variant="form"
        size="md"
        showFooter={false}
      >
        <div className="p-6 space-y-4">
          <Field label="Stock Count">
            <select className={inputClass} value={fromCountId} onChange={e => setFromCountId(e.target.value)}>
              <option value="">— Select Count —</option>
              {counts.filter(c => c.status === 'Completed' || c.status === 'Approved').map(c => (
                <option key={c.id} value={c.id}>{c.count_number || c.id.slice(0, 8)} — {c.status}</option>
              ))}
            </select>
          </Field>
          <p className="text-xs text-slate-500">
            For each count line where counted ≠ theoretical, an investigation is created with the
            variance quantity and value. Lines with zero variance are skipped.
          </p>
        </div>
        <div className="p-6 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-3 bg-slate-50/30 dark:bg-slate-700/20">
          <button onClick={() => setShowFromCount(false)} className={button.secondary}>Cancel</button>
          <button onClick={submitFromCount} disabled={submitting} className={button.primary + ' disabled:opacity-50'}>
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create
          </button>
        </div>
      </ModalSystem>
    </div>
  );
};

export default VarianceInvestigationModule;
