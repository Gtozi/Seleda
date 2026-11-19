/**
 * Operational Enhancements Module — /erp/inventory/ops-enhancements
 * Consolidates the Migration 373 enhancement features:
 *   1. Replenishment Pulls (Central = separate stock model)
 *   2. Manual Par Overrides (Three-tier par system)
 *   3. Procurement Auto-Trigger (Low central stock → PR)
 *   4. Journal Posting Log (Finance integration)
 *   5. Department Borrowing (Inter-departmental loans)
 */
import React, { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Loader2, ServerCrash, Plus, Zap, ArrowRightLeft, FileText,
  TrendingUp, RefreshCw, CheckCircle2, XCircle, Truck, Undo2,
  Clock, AlertTriangle, DollarSign,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, statusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import InventoryTable, { type InventoryColumn } from './InventoryTable';
import {
  fetchReplenishmentPulls, generateReplenishmentPulls, approveReplenishmentPull,
  rejectReplenishmentPull, convertPullToTransfer, deleteReplenishmentPull,
  type ReplenishmentPull,
  fetchManualParOverrides, createManualParOverride, deactivateManualParOverride,
  deleteManualParOverride, resolveEffectivePar,
  type ManualParOverride, type EffectiveParResult,
  previewProcurementTrigger, generateProcurementRequisitions,
  type ProcurementTriggerPreview,
  fetchJournalPostingLog, batchPostWasteJournals,
  type JournalPostingLogEntry,
  fetchDeptBorrows, createDeptBorrow, approveDeptBorrow, rejectDeptBorrow,
  dispatchDeptBorrow, receiveDeptBorrow, returnDeptBorrow, cancelDeptBorrow,
  deleteDeptBorrow, type DeptBorrow,
  fetchStores, fetchItems, type UinvStore, type UinvItem,
} from '../../services/inventoryService';

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

type SubTab = 'pulls' | 'par-overrides' | 'procurement' | 'journals' | 'borrows';

const SUB_TABS: { key: SubTab; label: string; icon: React.ElementType }[] = [
  { key: 'pulls', label: 'Replenishment Pulls', icon: TrendingUp },
  { key: 'par-overrides', label: 'Manual Par Overrides', icon: Zap },
  { key: 'procurement', label: 'Procurement Trigger', icon: FileText },
  { key: 'journals', label: 'Journal Posting Log', icon: DollarSign },
  { key: 'borrows', label: 'Dept Borrowing', icon: ArrowRightLeft },
];

// ════════════════════════════════════════════════════════════════
// REPLENISHMENT PULLS TAB
// ════════════════════════════════════════════════════════════════

const PullsTab: React.FC<{
  stores: UinvStore[];
  items: UinvItem[];
  propertyId: string | null;
  notify: (msg: string, type?: 'success' | 'error') => void;
}> = ({ stores, items, propertyId, notify }) => {
  const [records, setRecords] = useState<ReplenishmentPull[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('All');
  const [deptStoreFilter, setDeptStoreFilter] = useState('');
  const [generating, setGenerating] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchReplenishmentPulls({
        propertyId: propertyId || undefined,
        deptStoreId: deptStoreFilter || undefined,
        status: statusFilter !== 'All' ? statusFilter : undefined,
      });
      setRecords(data || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [propertyId, deptStoreFilter, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const handleGenerate = async () => {
    if (!deptStoreFilter) { notify('Select a department store first', 'error'); return; }
    setGenerating(true);
    try {
      const result = await generateReplenishmentPulls(deptStoreFilter, propertyId || undefined);
      notify(`Generated ${result?.created || 0} pull(s)`, 'success');
      load();
    } catch (e: any) { notify(e.message, 'error'); }
    finally { setGenerating(false); }
  };

  const handleAction = async (id: string, action: string) => {
    setActingId(id);
    try {
      if (action === 'approve') { await approveReplenishmentPull(id); notify('Pull approved', 'success'); }
      else if (action === 'reject') { await rejectReplenishmentPull(id); notify('Pull rejected', 'success'); }
      else if (action === 'convert') { await convertPullToTransfer(id); notify('Converted to transfer', 'success'); }
      else if (action === 'delete') { await deleteReplenishmentPull(id); notify('Pull deleted', 'success'); }
      load();
    } catch (e: any) { notify(e.message, 'error'); }
    finally { setActingId(null); }
  };

  const itemName = (id: string) => items.find(i => i.id === id)?.item_name || id;
  const storeName = (id: string) => stores.find(s => s.id === id)?.store_name || id;

  const columns: InventoryColumn<ReplenishmentPull>[] = [
    { key: 'pull_number', header: 'Pull #', render: r => <span className="font-mono text-xs">{r.pull_number}</span> },
    { key: 'item', header: 'Item', render: r => <span className="text-sm">{itemName(r.item_id)}</span> },
    { key: 'dept', header: 'Dept Store', render: r => <span className="text-sm">{storeName(r.dept_store_id)}</span> },
    { key: 'source', header: 'Source', render: r => <span className="text-sm">{storeName(r.source_store_id)}</span> },
    { key: 'qty', header: 'Qty Req', align: 'right', render: r => <span className="text-sm font-semibold">{r.quantity_requested}</span> },
    { key: 'trigger', header: 'Trigger', render: r => <Badge tone="neutral">{r.trigger_type}</Badge> },
    { key: 'status', header: 'Status', render: r => {
      const tone = r.status === 'Pending' ? 'warning' : r.status === 'Approved' ? 'info' :
        r.status === 'Fulfilled' || r.status === 'Converted to Transfer' ? 'success' :
        r.status === 'Rejected' || r.status === 'Cancelled' ? 'danger' : 'neutral';
      return <Badge tone={tone as any}>{r.status}</Badge>;
    }},
    { key: 'actions', header: 'Actions', align: 'right', render: r => (
      <div className="flex gap-1 justify-end">
        {r.status === 'Pending' && <>
          <button className="p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded" disabled={actingId === r.id} onClick={() => handleAction(r.id, 'approve')} title="Approve"><CheckCircle2 className="w-4 h-4" /></button>
          <button className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded" disabled={actingId === r.id} onClick={() => handleAction(r.id, 'reject')} title="Reject"><XCircle className="w-4 h-4" /></button>
        </>}
        {r.status === 'Approved' && <button className="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded" disabled={actingId === r.id} onClick={() => handleAction(r.id, 'convert')} title="Convert to Transfer"><Truck className="w-4 h-4" /></button>}
        {(r.status === 'Pending' || r.status === 'Rejected' || r.status === 'Cancelled') && <button className="p-1 text-slate-400 hover:text-red-600 rounded" disabled={actingId === r.id} onClick={() => handleAction(r.id, 'delete')} title="Delete"><XCircle className="w-4 h-4" /></button>}
        {actingId === r.id && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
      </div>
    )},
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="w-64">
          <Field label="Department Store">
            <select className={inputClass} value={deptStoreFilter} onChange={e => setDeptStoreFilter(e.target.value)}>
              <option value="">All stores</option>
              {stores.filter(s => s.parent_store_id || s.store_code !== 'UINV-ST-MAIN').map(s => <option key={s.id} value={s.id}>{s.store_name}</option>)}
            </select>
          </Field>
        </div>
        <div className="w-40">
          <Field label="Status">
            <select className={inputClass} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option>All</option><option>Pending</option><option>Approved</option><option>Converted to Transfer</option><option>Fulfilled</option><option>Rejected</option><option>Cancelled</option>
            </select>
          </Field>
        </div>
        <button className={button.primary} onClick={handleGenerate} disabled={generating}>
          {generating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Zap className="w-4 h-4 mr-2" />}
          Auto-Generate Pulls
        </button>
        <button className={button.secondary} onClick={load}><RefreshCw className="w-4 h-4 mr-2" />Refresh</button>
      </div>
      <InventoryTable
        columns={columns}
        rows={records}
        rowKey={r => r.id}
        loading={loading}
        error={error}
        onRetry={load}
        emptyMessage="No replenishment pulls found. Use Auto-Generate to create pulls for items below par."
      />
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// MANUAL PAR OVERRIDES TAB
// ════════════════════════════════════════════════════════════════

const ParOverridesTab: React.FC<{
  stores: UinvStore[];
  items: UinvItem[];
  propertyId: string | null;
  notify: (msg: string, type?: 'success' | 'error') => void;
}> = ({ stores, items, propertyId, notify }) => {
  const [records, setRecords] = useState<ManualParOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [effectivePar, setEffectivePar] = useState<EffectiveParResult | null>(null);
  const [parLookup, setParLookup] = useState({ itemId: '', storeId: '' });
  const [form, setForm] = useState({ store_id: '', item_id: '', manual_par_level: 0, manual_replenish_min: '', manual_replenish_max: '', reason: '', effective_until: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchManualParOverrides({ propertyId: propertyId || undefined, activeOnly: 'true' });
      setRecords(data || []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [propertyId]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async () => {
    if (!form.store_id || !form.item_id || !form.manual_par_level) { notify('Store, item, and par level are required', 'error'); return; }
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
        property_id: propertyId || undefined,
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
    { key: 'item', header: 'Item', render: r => <span className="text-sm">{itemName(r.item_id)}</span> },
    { key: 'store', header: 'Store', render: r => <span className="text-sm">{storeName(r.store_id)}</span> },
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
    <div className="space-y-4">
      {/* Effective Par Lookup */}
      <SectionCard>
        <div className="p-4">
          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">Effective Par Lookup (Manual {'>'} Dynamic {'>'} Standard)</h3>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="w-48"><Field label="Item"><select className={inputClass} value={parLookup.itemId} onChange={e => setParLookup(p => ({ ...p, itemId: e.target.value }))}><option value="">Select item</option>{items.slice(0, 100).map(i => <option key={i.id} value={i.id}>{i.item_name}</option>)}</select></Field></div>
            <div className="w-48"><Field label="Store"><select className={inputClass} value={parLookup.storeId} onChange={e => setParLookup(p => ({ ...p, storeId: e.target.value }))}><option value="">Select store</option>{stores.map(s => <option key={s.id} value={s.id}>{s.store_name}</option>)}</select></Field></div>
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
        </div>
      </SectionCard>

      <div className="flex justify-between items-center">
        <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300">Active Manual Overrides</h3>
        <button className={button.primary} onClick={() => setShowForm(true)}><Plus className="w-4 h-4 mr-2" />New Override</button>
      </div>

      <InventoryTable
        columns={columns}
        rows={records}
        rowKey={r => r.id}
        loading={loading}
        error={error}
        onRetry={load}
        emptyMessage="No manual par overrides. Create one to temporarily override the dynamic/standard par."
      />

      <ModalSystem isOpen={showForm} onClose={() => setShowForm(false)} title="New Manual Par Override" size="md">
        <div className="space-y-4 p-4">
          <Field label="Store"><select className={inputClass} value={form.store_id} onChange={e => setForm(f => ({ ...f, store_id: e.target.value }))}><option value="">Select store</option>{stores.map(s => <option key={s.id} value={s.id}>{s.store_name}</option>)}</select></Field>
          <Field label="Item"><select className={inputClass} value={form.item_id} onChange={e => setForm(f => ({ ...f, item_id: e.target.value }))}><option value="">Select item</option>{items.slice(0, 200).map(i => <option key={i.id} value={i.id}>{i.item_name}</option>)}</select></Field>
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

// ════════════════════════════════════════════════════════════════
// PROCUREMENT TRIGGER TAB
// ════════════════════════════════════════════════════════════════

const ProcurementTab: React.FC<{
  propertyId: string | null;
  notify: (msg: string, type?: 'success' | 'error') => void;
}> = ({ propertyId, notify }) => {
  const [preview, setPreview] = useState<ProcurementTriggerPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await previewProcurementTrigger(propertyId || undefined);
      setPreview(data || []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [propertyId]);

  useEffect(() => { load(); }, [load]);

  const handleGenerate = async () => {
    if (!propertyId) { notify('Property ID is required', 'error'); return; }
    setGenerating(true);
    try {
      const result = await generateProcurementRequisitions(propertyId);
      notify(`Generated ${result?.count || 0} requisition(s)`, 'success');
      load();
    } catch (e: any) { notify(e.message, 'error'); }
    finally { setGenerating(false); }
  };

  const totalEst = preview.reduce((sum, p) => sum + Number(p.estimatedValue || 0), 0);

  const columns: InventoryColumn<ProcurementTriggerPreview>[] = [
    { key: 'item', header: 'Item', render: r => <span className="text-sm font-medium">{r.itemName}</span> },
    { key: 'code', header: 'Code', render: r => <span className="text-sm font-mono">{r.itemCode}</span> },
    { key: 'on_hand', header: 'On Hand', align: 'right', render: r => <span className="text-sm text-red-600 font-semibold">{r.onHand}</span> },
    { key: 'reorder', header: 'Reorder Point', align: 'right', render: r => <span className="text-sm">{r.reorderPoint}</span> },
    { key: 'suggested', header: 'Suggested Qty', align: 'right', render: r => <span className="text-sm font-bold">{r.suggestedOrderQty}</span> },
    { key: 'unit_cost', header: 'Unit Cost', align: 'right', render: r => <span className="text-sm">{Number(r.lastCost).toFixed(2)}</span> },
    { key: 'est_value', header: 'Est. Value', align: 'right', render: r => <span className="text-sm font-semibold">{Number(r.estimatedValue).toFixed(2)}</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300">Central Low-Stock Preview</h3>
          <p className="text-xs text-slate-500 mt-1">Items in Main Warehouse at or below reorder point. Generating creates Procurement requisitions automatically.</p>
        </div>
        <div className="flex gap-2">
          <button className={button.secondary} onClick={load}><RefreshCw className="w-4 h-4 mr-2" />Refresh</button>
          <button className={button.primary} onClick={handleGenerate} disabled={generating || preview.length === 0}>
            {generating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Zap className="w-4 h-4 mr-2" />}
            Generate Requisitions
          </button>
        </div>
      </div>
      {preview.length > 0 && (
        <div className="flex gap-3">
          <StatCard label="Low-Stock Items" value={preview.length} icon={AlertTriangle} tone="warning" />
          <StatCard label="Total Est. Value" value={`ETB ${totalEst.toFixed(2)}`} icon={DollarSign} tone="info" />
        </div>
      )}
      <InventoryTable
        columns={columns}
        rows={preview}
        rowKey={r => r.item_id}
        loading={loading}
        error={error}
        onRetry={load}
        emptyMessage="No low-stock items at central warehouse. All items are above their reorder points."
      />
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// JOURNAL POSTING LOG TAB
// ════════════════════════════════════════════════════════════════

const JournalsTab: React.FC<{
  notify: (msg: string, type?: 'success' | 'error') => void;
}> = ({ notify }) => {
  const [records, setRecords] = useState<JournalPostingLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [batchPosting, setBatchPosting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJournalPostingLog({ postingType: typeFilter || undefined });
      setRecords(data || []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [typeFilter]);

  useEffect(() => { load(); }, [load]);

  const handleBatchPost = async () => {
    setBatchPosting(true);
    try {
      const result = await batchPostWasteJournals();
      notify(`Posted ${result?.posted || 0} waste journal(s)`, 'success');
      load();
    } catch (e: any) { notify(e.message, 'error'); }
    finally { setBatchPosting(false); }
  };

  const totalAmount = records.reduce((sum, r) => sum + Number(r.amount || 0), 0);

  const columns: InventoryColumn<JournalPostingLogEntry>[] = [
    { key: 'source', header: 'Source Entity', render: r => <span className="text-sm font-mono">{r.source_entity}</span> },
    { key: 'source_id', header: 'Source ID', render: r => <span className="text-xs font-mono text-slate-500">{r.source_id}</span> },
    { key: 'journal_id', header: 'Journal ID', render: r => <span className="text-xs font-mono text-slate-500">{r.journal_id}</span> },
    { key: 'type', header: 'Posting Type', render: r => <Badge tone="info">{r.posting_type}</Badge> },
    { key: 'amount', header: 'Amount', align: 'right', render: r => <span className="text-sm font-semibold">{Number(r.amount).toFixed(2)}</span> },
    { key: 'posted_at', header: 'Posted At', render: r => <span className="text-sm">{new Date(r.posted_at).toLocaleString()}</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex gap-3 items-end">
          <div className="w-48"><Field label="Posting Type"><select className={inputClass} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}><option value="">All</option><option>COGS</option><option>Inventory Valuation</option><option>Shrinkage</option><option>Variance</option></select></Field></div>
          <button className={button.secondary} onClick={load}><RefreshCw className="w-4 h-4 mr-2" />Refresh</button>
        </div>
        <button className={button.primary} onClick={handleBatchPost} disabled={batchPosting}>
          {batchPosting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Zap className="w-4 h-4 mr-2" />}
          Batch-Post Unposted Waste
        </button>
      </div>
      {records.length > 0 && <StatCard label="Total Posted Amount" value={`ETB ${totalAmount.toFixed(2)}`} icon={DollarSign} tone="success" />}
      <InventoryTable
        columns={columns}
        rows={records}
        rowKey={r => r.id}
        loading={loading}
        error={error}
        onRetry={load}
        emptyMessage="No journal postings logged yet. Journals are auto-posted when inventory movements occur."
      />
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// DEPARTMENT BORROWING TAB
// ════════════════════════════════════════════════════════════════

const BorrowsTab: React.FC<{
  stores: UinvStore[];
  items: UinvItem[];
  propertyId: string | null;
  notify: (msg: string, type?: 'success' | 'error') => void;
}> = ({ stores, items, propertyId, notify }) => {
  const [records, setRecords] = useState<DeptBorrow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('All');
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [returnModal, setReturnModal] = useState<DeptBorrow | null>(null);
  const [returnQty, setReturnQty] = useState(0);
  const [form, setForm] = useState({ borrowing_store_id: '', lending_store_id: '', item_id: '', quantity_borrowed: 0, expected_return_date: '', purpose: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDeptBorrows({
        propertyId: propertyId || undefined,
        status: statusFilter !== 'All' ? statusFilter : undefined,
      });
      setRecords(data || []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [propertyId, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async () => {
    if (!form.borrowing_store_id || !form.lending_store_id || !form.item_id || !form.quantity_borrowed) {
      notify('All fields are required', 'error'); return;
    }
    if (form.borrowing_store_id === form.lending_store_id) { notify('Borrowing and lending stores must differ', 'error'); return; }
    setSubmitting(true);
    try {
      await createDeptBorrow({
        borrowing_store_id: form.borrowing_store_id,
        lending_store_id: form.lending_store_id,
        item_id: form.item_id,
        quantity_borrowed: Number(form.quantity_borrowed),
        expected_return_date: form.expected_return_date || undefined,
        purpose: form.purpose || undefined,
        property_id: propertyId || undefined,
      });
      notify('Borrow request created', 'success');
      setShowForm(false);
      setForm({ borrowing_store_id: '', lending_store_id: '', item_id: '', quantity_borrowed: 0, expected_return_date: '', purpose: '' });
      load();
    } catch (e: any) { notify(e.message, 'error'); }
    finally { setSubmitting(false); }
  };

  const handleAction = async (id: string, action: string) => {
    setActingId(id);
    try {
      if (action === 'approve') { await approveDeptBorrow(id); notify('Borrow approved', 'success'); }
      else if (action === 'reject') { await rejectDeptBorrow(id); notify('Borrow rejected', 'success'); }
      else if (action === 'dispatch') { await dispatchDeptBorrow(id); notify('Borrow dispatched', 'success'); }
      else if (action === 'receive') { await receiveDeptBorrow(id); notify('Borrow received', 'success'); }
      else if (action === 'cancel') { await cancelDeptBorrow(id); notify('Borrow cancelled', 'success'); }
      else if (action === 'delete') { await deleteDeptBorrow(id); notify('Borrow deleted', 'success'); }
      load();
    } catch (e: any) { notify(e.message, 'error'); }
    finally { setActingId(null); }
  };

  const handleReturn = async () => {
    if (!returnModal || returnQty <= 0) return;
    setActingId(returnModal.id);
    try {
      await returnDeptBorrow(returnModal.id, returnQty);
      notify('Return recorded', 'success');
      setReturnModal(null);
      setReturnQty(0);
      load();
    } catch (e: any) { notify(e.message, 'error'); }
    finally { setActingId(null); }
  };

  const itemName = (id: string) => items.find(i => i.id === id)?.item_name || id;
  const storeName = (id: string) => stores.find(s => s.id === id)?.store_name || id;

  const columns: InventoryColumn<DeptBorrow>[] = [
    { key: 'number', header: 'Borrow #', render: r => <span className="font-mono text-xs">{r.borrow_number}</span> },
    { key: 'item', header: 'Item', render: r => <span className="text-sm">{itemName(r.item_id)}</span> },
    { key: 'borrowing', header: 'Borrowing', render: r => <span className="text-sm">{storeName(r.borrowing_store_id)}</span> },
    { key: 'lending', header: 'Lending', render: r => <span className="text-sm">{storeName(r.lending_store_id)}</span> },
    { key: 'qty', header: 'Qty', align: 'right', render: r => <span className="text-sm font-semibold">{r.quantity_borrowed}</span> },
    { key: 'returned', header: 'Returned', align: 'right', render: r => <span className="text-sm">{r.quantity_returned}/{r.quantity_borrowed}</span> },
    { key: 'due', header: 'Due Date', render: r => <span className="text-sm">{r.expected_return_date ? new Date(r.expected_return_date).toLocaleDateString() : '-'}</span> },
    { key: 'status', header: 'Status', render: r => {
      const tone = r.status === 'Requested' ? 'warning' : r.status === 'Approved' ? 'info' :
        r.status === 'Dispatched' ? 'info' : r.status === 'Received' ? 'success' :
        r.status === 'Returned' ? 'success' : r.status === 'Rejected' || r.status === 'Cancelled' || r.status === 'Overdue' ? 'danger' : 'neutral';
      return <Badge tone={tone as any}>{r.status}</Badge>;
    }},
    { key: 'actions', header: 'Actions', align: 'right', render: r => (
      <div className="flex gap-1 justify-end">
        {r.status === 'Requested' && <>
          <button className="p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded" disabled={actingId === r.id} onClick={() => handleAction(r.id, 'approve')} title="Approve"><CheckCircle2 className="w-4 h-4" /></button>
          <button className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded" disabled={actingId === r.id} onClick={() => handleAction(r.id, 'reject')} title="Reject"><XCircle className="w-4 h-4" /></button>
        </>}
        {r.status === 'Approved' && <>
          <button className="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded" disabled={actingId === r.id} onClick={() => handleAction(r.id, 'dispatch')} title="Dispatch"><Truck className="w-4 h-4" /></button>
          <button className="p-1 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded" disabled={actingId === r.id} onClick={() => handleAction(r.id, 'cancel')} title="Cancel"><XCircle className="w-4 h-4" /></button>
        </>}
        {r.status === 'Dispatched' && <button className="p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded" disabled={actingId === r.id} onClick={() => handleAction(r.id, 'receive')} title="Receive"><CheckCircle2 className="w-4 h-4" /></button>}
        {(r.status === 'Received' || r.status === 'Partially Returned') && <button className="p-1 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded" disabled={actingId === r.id} onClick={() => { setReturnModal(r); setReturnQty(r.quantity_borrowed - r.quantity_returned); }} title="Return"><Undo2 className="w-4 h-4" /></button>}
        {(r.status === 'Requested' || r.status === 'Rejected' || r.status === 'Cancelled') && <button className="p-1 text-slate-400 hover:text-red-600 rounded" disabled={actingId === r.id} onClick={() => handleAction(r.id, 'delete')} title="Delete"><XCircle className="w-4 h-4" /></button>}
        {actingId === r.id && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
      </div>
    )},
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex gap-3 items-end">
          <div className="w-40"><Field label="Status"><select className={inputClass} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option>All</option><option>Requested</option><option>Approved</option><option>Dispatched</option><option>Received</option><option>Partially Returned</option><option>Returned</option><option>Rejected</option><option>Cancelled</option><option>Overdue</option></select></Field></div>
          <button className={button.secondary} onClick={load}><RefreshCw className="w-4 h-4 mr-2" />Refresh</button>
        </div>
        <button className={button.primary} onClick={() => setShowForm(true)}><Plus className="w-4 h-4 mr-2" />New Borrow Request</button>
      </div>

      <InventoryTable
        columns={columns}
        rows={records}
        rowKey={r => r.id}
        loading={loading}
        error={error}
        onRetry={load}
        emptyMessage="No borrow records. Create a borrow request to temporarily transfer stock between departments."
      />

      <ModalSystem isOpen={showForm} onClose={() => setShowForm(false)} title="New Department Borrow Request" size="md">
        <div className="space-y-4 p-4">
          <Field label="Borrowing Store (who needs the item)"><select className={inputClass} value={form.borrowing_store_id} onChange={e => setForm(f => ({ ...f, borrowing_store_id: e.target.value }))}><option value="">Select store</option>{stores.map(s => <option key={s.id} value={s.id}>{s.store_name}</option>)}</select></Field>
          <Field label="Lending Store (who has the stock)"><select className={inputClass} value={form.lending_store_id} onChange={e => setForm(f => ({ ...f, lending_store_id: e.target.value }))}><option value="">Select store</option>{stores.map(s => <option key={s.id} value={s.id}>{s.store_name}</option>)}</select></Field>
          <Field label="Item"><select className={inputClass} value={form.item_id} onChange={e => setForm(f => ({ ...f, item_id: e.target.value }))}><option value="">Select item</option>{items.slice(0, 200).map(i => <option key={i.id} value={i.id}>{i.item_name}</option>)}</select></Field>
          <Field label="Quantity"><input type="number" min="1" className={inputClass} value={form.quantity_borrowed} onChange={e => setForm(f => ({ ...f, quantity_borrowed: Number(e.target.value) }))} /></Field>
          <Field label="Expected Return Date"><input type="date" className={inputClass} value={form.expected_return_date} onChange={e => setForm(f => ({ ...f, expected_return_date: e.target.value }))} /></Field>
          <Field label="Purpose"><input className={inputClass} value={form.purpose} onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))} placeholder="e.g. Emergency cleaning, event setup" /></Field>
          <div className="flex justify-end gap-2 pt-2">
            <button className={button.secondary} onClick={() => setShowForm(false)}>Cancel</button>
            <button className={button.primary} onClick={handleSubmit} disabled={submitting}>{submitting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Create Request</button>
          </div>
        </div>
      </ModalSystem>

      <ModalSystem isOpen={!!returnModal} onClose={() => setReturnModal(null)} title="Return Borrowed Items" size="sm">
        <div className="space-y-4 p-4">
          <p className="text-sm text-slate-600">Returning <strong>{returnModal ? itemName(returnModal.item_id) : ''}</strong></p>
          <p className="text-xs text-slate-500">Borrowed: {returnModal?.quantity_borrowed} | Already returned: {returnModal?.quantity_returned}</p>
          <Field label="Quantity to Return"><input type="number" min="1" max={returnModal ? returnModal.quantity_borrowed - returnModal.quantity_returned : 1} className={inputClass} value={returnQty} onChange={e => setReturnQty(Number(e.target.value))} /></Field>
          <div className="flex justify-end gap-2 pt-2">
            <button className={button.secondary} onClick={() => setReturnModal(null)}>Cancel</button>
            <button className={button.primary} onClick={handleReturn} disabled={actingId === returnModal?.id}>{actingId === returnModal?.id && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Return</button>
          </div>
        </div>
      </ModalSystem>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════

export { PullsTab, ParOverridesTab, ProcurementTab, JournalsTab, BorrowsTab };

const OperationalEnhancementsModule: React.FC<{ initialTab?: string }> = ({ initialTab = 'pulls' }) => {
  const { currentPropertyId, addNotification } = useERP();
  const [activeSubTab, setActiveSubTab] = useState<SubTab>(initialTab as SubTab || 'pulls');
  const [stores, setStores] = useState<UinvStore[]>([]);
  const [items, setItems] = useState<UinvItem[]>([]);

  const notify = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    addNotification?.({ message: msg, type });
  }, [addNotification]);

  useEffect(() => {
    (async () => {
      try {
        const [s, i] = await Promise.all([fetchStores(), fetchItems()]);
        setStores(s || []);
        setItems(i || []);
      } catch (e) {
        // non-critical — tabs will show raw IDs
      }
    })();
  }, []);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Operational Enhancements"
        subtitle="Migration 373 features: Replenishment Pulls, Manual Par, Procurement Trigger, Journal Posting, Dept Borrowing"
      />

      {/* Sub-tab navigation */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-slate-700 overflow-x-auto">
        {SUB_TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeSubTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveSubTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                isActive
                  ? 'border-[var(--color-accent-operations)] text-[var(--color-accent-operations)]'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeSubTab === 'pulls' && <PullsTab stores={stores} items={items} propertyId={currentPropertyId} notify={notify} />}
      {activeSubTab === 'par-overrides' && <ParOverridesTab stores={stores} items={items} propertyId={currentPropertyId} notify={notify} />}
      {activeSubTab === 'procurement' && <ProcurementTab propertyId={currentPropertyId} notify={notify} />}
      {activeSubTab === 'journals' && <JournalsTab notify={notify} />}
      {activeSubTab === 'borrows' && <BorrowsTab stores={stores} items={items} propertyId={currentPropertyId} notify={notify} />}
    </div>
  );
};

export default OperationalEnhancementsModule;
