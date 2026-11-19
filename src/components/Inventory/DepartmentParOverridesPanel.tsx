/**
 * Department Manual Par Overrides Panel — embedded in department portals.
 *
 * Lets department users set and manage manual par-level overrides for their
 * own stores.  Distinct from the central inventory module: each department
 * only sees and edits overrides for the stores that belong to it.
 *
 * Three-tier par precedence:  Manual > Dynamic > Standard
 */
import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Zap, Plus, Clock, Loader2, ServerCrash, XCircle, Activity,
} from 'lucide-react';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchStores, fetchItems, fetchManualParOverrides, createManualParOverride,
  deactivateManualParOverride, deleteManualParOverride, resolveEffectivePar,
  type UinvStore, type UinvItem, type ManualParOverride, type EffectiveParResult,
} from '../../services/inventoryService';
import { filterItemsForDepartment } from '../../config/departmentCategories';
import InventoryTable, { type InventoryColumn } from './InventoryTable';

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

/** Department name → store match predicate.
 *  Matches on the explicit `department` field first, then falls back to
 *  store-code patterns.  Central stores (Main Warehouse, General Store,
 *  Beverage, Food) are excluded — only department-owned stores match. */
const STORE_MATCHERS: Record<string, (s: UinvStore) => boolean> = {
  Engineering: s =>
    s.department === 'Engineering' ||
    /^UINV-ST-ENG$/i.test(s.store_code) ||
    /engineering/i.test(s.store_name),
  Housekeeping: s =>
    s.department === 'Housekeeping' ||
    /^UINV-ST-HK$/i.test(s.store_code) ||
    /^UINV-ST-LINEN$/i.test(s.store_code) ||
    /housekeeping/i.test(s.store_name) ||
    /linen/i.test(s.store_name),
  'Food & Beverage': s =>
    s.department === 'Food & Beverage' ||
    /^UINV-ST-FOOD$/i.test(s.store_code) ||
    /^UINV-ST-BEV$/i.test(s.store_code) ||
    /food store/i.test(s.store_name) ||
    /beverage store/i.test(s.store_name),
  'Spa & Wellness': s =>
    s.department === 'Spa & Wellness' ||
    /^UINV-ST-SPA$/i.test(s.store_code) ||
    /spa/i.test(s.store_name),
  'Banquet & Events': s =>
    s.department === 'Banquet & Events' ||
    /^UINV-ST-BANQ$/i.test(s.store_code) ||
    /banquet/i.test(s.store_name) ||
    /event/i.test(s.store_name),
};

interface Props {
  department: string;
  /** Hide the internal PageHeader (when embedded in a module that has its own header) */
  hideHeader?: boolean;
}

const DepartmentParOverridesPanel: React.FC<Props> = ({ department, hideHeader }) => {
  const { currentPropertyId, addNotification } = useERP();
  const [stores, setStores] = useState<UinvStore[]>([]);
  const [items, setItems] = useState<UinvItem[]>([]);
  const [records, setRecords] = useState<ManualParOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [effectivePar, setEffectivePar] = useState<EffectiveParResult | null>(null);
  const [parLookup, setParLookup] = useState({ itemId: '', storeId: '' });
  const [form, setForm] = useState({
    store_id: '', item_id: '', manual_par_level: 0,
    manual_replenish_min: '', manual_replenish_max: '',
    reason: '', effective_until: '',
  });

  const notify = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    addNotification?.(msg, type, department);
  }, [addNotification, department]);

  // ── Load stores + items + overrides ────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [allStores, allItems] = await Promise.all([
        fetchStores({ propertyId: currentPropertyId || undefined, active: 'true' }),
        fetchItems({ propertyId: currentPropertyId || undefined, active: 'true' }),
      ]);

      // Filter stores to this department
      const matcher = STORE_MATCHERS[department];
      const deptStores = matcher
        ? (allStores || []).filter(matcher)
        : (allStores || []).filter(s => s.department === department);
      setStores(deptStores);
      // Filter items to only those belonging to this department's categories
      setItems(filterItemsForDepartment(allItems || [], department));

      // Fetch overrides for each department store
      const deptStoreIds = deptStores.map(s => s.id);
      if (deptStoreIds.length === 0) {
        setRecords([]);
      } else {
        // Fetch all active overrides and filter client-side to dept stores
        const allOverrides = await fetchManualParOverrides({
          propertyId: currentPropertyId || undefined,
          activeOnly: 'true',
        });
        setRecords((allOverrides || []).filter(r => deptStoreIds.includes(r.store_id)));
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load par overrides');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, department]);

  useEffect(() => { load(); }, [load]);

  const deptStoreIds = useMemo(() => new Set(stores.map(s => s.id)), [stores]);

  const handleSubmit = async () => {
    if (!form.store_id || !form.item_id || !form.manual_par_level) {
      notify('Store, item, and par level are required', 'error'); return;
    }
    setSubmitting(true);
    try {
      await createManualParOverride({
        store_id: form.store_id,
        item_id: form.item_id,
        manual_par_level: Number(form.manual_par_level),
        manual_replenish_min: form.manual_replenish_min ? Number(form.manual_replenish_min) : undefined,
        manual_replenish_max: form.manual_replenish_max ? Number(form.manual_replenish_max) : undefined,
        reason: form.reason || undefined,
        effective_until: form.effective_until || undefined,
        property_id: currentPropertyId || undefined,
      });
      notify('Manual par override created', 'success');
      setShowForm(false);
      setForm({ store_id: '', item_id: '', manual_par_level: 0, manual_replenish_min: '', manual_replenish_max: '', reason: '', effective_until: '' });
      load();
    } catch (e: any) { notify(e.message, 'error'); }
    finally { setSubmitting(false); }
  };

  const handleAction = async (id: string, action: string) => {
    setActingId(id);
    try {
      if (action === 'deactivate') { await deactivateManualParOverride(id); notify('Override deactivated', 'success'); }
      else if (action === 'delete') { await deleteManualParOverride(id); notify('Override deleted', 'success'); }
      load();
    } catch (e: any) { notify(e.message, 'error'); }
    finally { setActingId(null); }
  };

  const handleLookupPar = async () => {
    if (!parLookup.itemId || !parLookup.storeId) { notify('Select item and store', 'error'); return; }
    try {
      const result = await resolveEffectivePar(parLookup.itemId, parLookup.storeId);
      setEffectivePar(result);
    } catch (e: any) { notify(e.message, 'error'); }
  };

  const itemName = (id: string) => items.find(i => i.id === id)?.item_name || id;
  const storeName = (id: string) => stores.find(s => s.id === id)?.store_name || id;

  const columns: InventoryColumn<ManualParOverride>[] = [
    { key: 'item', header: 'Item', render: r => <span className="text-sm font-medium">{itemName(r.item_id)}</span> },
    { key: 'store', header: 'Store', render: r => <span className="text-sm text-slate-500">{storeName(r.store_id)}</span> },
    { key: 'par', header: 'Manual Par', align: 'right', render: r => <span className="text-sm font-semibold">{r.manual_par_level}</span> },
    { key: 'min', header: 'Min', align: 'right', render: r => <span className="text-sm">{r.manual_replenish_min ?? '-'}</span> },
    { key: 'max', header: 'Max', align: 'right', render: r => <span className="text-sm">{r.manual_replenish_max ?? '-'}</span> },
    { key: 'reason', header: 'Reason', render: r => <span className="text-sm text-slate-500">{r.reason || '-'}</span> },
    { key: 'until', header: 'Effective Until', render: r => <span className="text-sm">{r.effective_until ? new Date(r.effective_until).toLocaleDateString() : 'No expiry'}</span> },
    { key: 'status', header: 'Status', render: r => <Badge tone={r.is_active ? 'success' : 'neutral'}>{r.is_active ? 'Active' : 'Inactive'}</Badge> },
    { key: 'actions', header: 'Actions', align: 'right', render: r => (
      <div className="flex gap-1 justify-end">
        {r.is_active && <button className="p-1 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded" disabled={actingId === r.id} onClick={() => handleAction(r.id, 'deactivate')} title="Deactivate"><Clock className="w-4 h-4" /></button>}
        <button className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded" disabled={actingId === r.id} onClick={() => handleAction(r.id, 'delete')} title="Delete"><XCircle className="w-4 h-4" /></button>
        {actingId === r.id && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
      </div>
    )},
  ];

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      {hideHeader ? (
        <div className="flex items-center justify-end gap-2">
          <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />} Refresh
          </button>
          <button onClick={() => setShowForm(true)} className={button.primary}><Plus className="w-4 h-4" /> New Override</button>
        </div>
      ) : (
        <PageHeader
          title={`${department} Manual Par Overrides`}
          subtitle={`Set temporary par-level overrides for ${department} stores only. Precedence: Manual > Dynamic > Standard.`}
          icon={Zap}
          actions={
            <div className="flex items-center gap-2">
              <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />} Refresh
              </button>
              <button onClick={() => setShowForm(true)} className={button.primary}><Plus className="w-4 h-4" /> New Override</button>
            </div>
          }
        />
      )}

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {/* Effective Par Lookup */}
      <SectionCard pad="md">
        <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-500" />
          {department} Effective Par Lookup (Manual {'>'} Dynamic {'>'} Standard)
        </h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="w-48">
            <Field label="Item">
              <select className={inputClass} value={parLookup.itemId} onChange={e => setParLookup(p => ({ ...p, itemId: e.target.value }))}>
                <option value="">Select item</option>
                {items.map(i => <option key={i.id} value={i.id}>{i.item_name}</option>)}
              </select>
            </Field>
          </div>
          <div className="w-48">
            <Field label="Store">
              <select className={inputClass} value={parLookup.storeId} onChange={e => setParLookup(p => ({ ...p, storeId: e.target.value }))}>
                <option value="">Select store</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.store_name}</option>)}
              </select>
            </Field>
          </div>
          <button className={button.secondary} onClick={handleLookupPar}>Resolve</button>
        </div>
        {effectivePar && (
          <div className="mt-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl flex gap-6">
            <div><span className="text-xs text-slate-500">Par Level</span><div className="text-lg font-bold">{effectivePar.par_level}</div></div>
            <div><span className="text-xs text-slate-500">Min</span><div className="text-lg font-bold">{effectivePar.replenish_min}</div></div>
            <div><span className="text-xs text-slate-500">Max</span><div className="text-lg font-bold">{effectivePar.replenish_max}</div></div>
            <div><span className="text-xs text-slate-500">Source</span><div className="text-lg font-bold capitalize">{effectivePar.source}</div></div>
          </div>
        )}
      </SectionCard>

      <InventoryTable
        columns={columns}
        rows={records}
        rowKey={r => r.id}
        loading={loading}
        error={error}
        onRetry={load}
        emptyMessage={`No manual par overrides for ${department} stores. Create one to temporarily override the dynamic/standard par.`}
      />

      <ModalSystem isOpen={showForm} onClose={() => setShowForm(false)} title={`New Manual Par Override — ${department}`} size="md">
        <div className="space-y-4 p-4">
          <Field label="Store">
            <select className={inputClass} value={form.store_id} onChange={e => setForm(f => ({ ...f, store_id: e.target.value }))}>
              <option value="">Select store</option>
              {stores.map(s => <option key={s.id} value={s.id}>{s.store_name}</option>)}
            </select>
          </Field>
          <Field label="Item">
            <select className={inputClass} value={form.item_id} onChange={e => setForm(f => ({ ...f, item_id: e.target.value }))}>
              <option value="">Select item</option>
              {items.map(i => <option key={i.id} value={i.id}>{i.item_name}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Manual Par Level"><input type="number" className={inputClass} value={form.manual_par_level} onChange={e => setForm(f => ({ ...f, manual_par_level: Number(e.target.value) }))} /></Field>
            <Field label="Min (optional)"><input type="number" className={inputClass} value={form.manual_replenish_min} onChange={e => setForm(f => ({ ...f, manual_replenish_min: e.target.value }))} /></Field>
            <Field label="Max (optional)"><input type="number" className={inputClass} value={form.manual_replenish_max} onChange={e => setForm(f => ({ ...f, manual_replenish_max: e.target.value }))} /></Field>
          </div>
          <Field label="Reason"><input className={inputClass} value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="e.g. Event preparation, seasonal spike" /></Field>
          <Field label="Effective Until (optional)"><input type="date" className={inputClass} value={form.effective_until} onChange={e => setForm(f => ({ ...f, effective_until: e.target.value }))} /></Field>
          <div className="flex justify-end gap-2 pt-2">
            <button className={button.secondary} onClick={() => setShowForm(false)}>Cancel</button>
            <button className={button.primary} onClick={handleSubmit} disabled={submitting}>{submitting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Create Override</button>
          </div>
        </div>
      </ModalSystem>
    </div>
  );
};

export default DepartmentParOverridesPanel;
