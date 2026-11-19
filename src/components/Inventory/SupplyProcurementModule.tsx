/**
 * Centralized Supply & Procurement — /erp/inventory/supply-procurement
 *
 * Consolidates the department-siloed supply/procurement workflows
 * (Engineering, Housekeeping, F&B) into a single Inventory-portal view.
 *
 * Three tabs:
 *   1. Demand — items at/below reorder point across all department stores.
 *   2. Requisitions — aggregated purchase requisitions from all departments.
 *   3. Suppliers — shared supplier master (fb_suppliers).
 *
 * DB-integrated via /api/uinv-portal/supply-procurement/*.
 */
import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ShoppingCart, Plus, Search, Clock, Loader2, ServerCrash, Trash2,
  Package, AlertTriangle, Filter, TrendingUp, Users, ClipboardList,
  CheckCircle2, XCircle, ArrowRightCircle, Zap, RefreshCw, DollarSign, Edit,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchSupplyProcurementStats, fetchSupplyDemand, fetchSupplyRequisitions,
  createSupplyRequisition, updateSupplyRequisitionStatus, receiveSupplyRequisition,
  fetchSupplySuppliers,
  previewProcurementTrigger, generateProcurementRequisitions,
  generateDraftRequisition, fetchDraftRequisition, updateDraftRequisition, submitDraftRequisition,
  type SupplyProcurementStats, type SupplyDemandRow, type SupplyRequisition,
  type SupplySupplier, type ProcurementTriggerPreview,
  type ProcDraftLine, type ProcDraftRequisition,
} from '../../services/inventoryService';
import InventoryTable, { IdentityCell, OpsCell, IconButton } from './InventoryTable';

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

const SUPPLY_DEPARTMENTS = ['Engineering', 'Housekeeping', 'Food & Beverage'] as const;
const DEPT_FILTERS = ['All', ...SUPPLY_DEPARTMENTS, 'Inventory'] as const;

const STATUS_BADGE: Record<string, 'info' | 'success' | 'warning' | 'danger' | 'neutral'> = {
  draft: 'neutral',
  submitted: 'info',
  approved: 'success',
  processing: 'warning',
  rejected: 'danger',
};

type TabId = 'demand' | 'requisitions' | 'suppliers';

const SupplyProcurementModule: React.FC<{ subTabBar?: React.ReactNode }> = ({ subTabBar }) => {
  const { currentPropertyId, addNotification } = useERP();
  const [tab, setTab] = useState<TabId>('demand');

  // Stats
  const [stats, setStats] = useState<SupplyProcurementStats | null>(null);
  const [demand, setDemand] = useState<SupplyDemandRow[]>([]);
  const [requisitions, setRequisitions] = useState<SupplyRequisition[]>([]);
  const [suppliers, setSuppliers] = useState<SupplySupplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');

  // Create requisition modal
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formDept, setFormDept] = useState<string>('Engineering');
  const [formSupplierId, setFormSupplierId] = useState('');
  const [formPriority, setFormPriority] = useState('medium');
  const [formNotes, setFormNotes] = useState('');
  const [formLines, setFormLines] = useState<{ itemName: string; category: string; quantity: number; unit: string; estimatedCost: number; requiredBy: string; reason: string }[]>([]);

  // Receive modal
  const [receiveTarget, setReceiveTarget] = useState<SupplyRequisition | null>(null);
  const [receiveLines, setReceiveLines] = useState<{ lineId: string; receivedQty: number; ordered: number; itemName: string }[]>([]);
  const [receiveSubmitting, setReceiveSubmitting] = useState(false);

  // Central low-stock preview (procurement auto-trigger)
  const [centralLowStock, setCentralLowStock] = useState<ProcurementTriggerPreview[]>([]);
  const [centralLoading, setCentralLoading] = useState(false);
  const [centralGenerating, setCentralGenerating] = useState(false);

  // Draft requisition editor
  const [draftReq, setDraftReq] = useState<ProcDraftRequisition | null>(null);
  const [draftLines, setDraftLines] = useState<ProcDraftLine[]>([]);
  const [draftNotes, setDraftNotes] = useState('');
  const [draftPriority, setDraftPriority] = useState('High');
  const [draftModalOpen, setDraftModalOpen] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftSubmitting, setDraftSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, d, r, sup] = await Promise.all([
        fetchSupplyProcurementStats(currentPropertyId || undefined),
        fetchSupplyDemand({ propertyId: currentPropertyId || undefined }),
        fetchSupplyRequisitions({ propertyId: currentPropertyId || undefined }),
        fetchSupplySuppliers(),
      ]);
      setStats(s);
      setDemand(d);
      setRequisitions(r);
      setSuppliers(sup);
    } catch (e: any) {
      setError(e?.message || 'Failed to load supply & procurement data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  // ── Central low-stock preview ──
  const loadCentralLowStock = useCallback(async () => {
    setCentralLoading(true);
    try {
      const data = await previewProcurementTrigger(currentPropertyId || undefined);
      setCentralLowStock(data || []);
    } catch (e: any) {
      // Non-fatal — central preview is supplementary
      setCentralLowStock([]);
    } finally { setCentralLoading(false); }
  }, [currentPropertyId]);

  useEffect(() => { loadCentralLowStock(); }, [loadCentralLowStock]);

  const handleGenerateProcurement = async () => {
    setCentralGenerating(true);
    try {
      const result = await generateDraftRequisition(currentPropertyId || undefined);
      if (result.requisition) {
        setDraftReq(result.requisition);
        setDraftLines(result.lines || []);
        setDraftNotes('');
        setDraftPriority('High');
        setDraftModalOpen(true);
        addNotification(result.message || `Draft requisition ${result.requisition.pr_number} created with ${result.lines?.length || 0} items.`, 'success', 'Inventory');
      } else {
        addNotification(result.message || 'No low-stock items found.', 'info', 'Inventory');
      }
      await loadCentralLowStock();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to generate procurement requisitions', 'error', 'Inventory');
    } finally { setCentralGenerating(false); }
  };

  // ── Draft editing helpers ──
  const updateDraftLine = (idx: number, field: string, value: any) => {
    setDraftLines(prev => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  };
  const removeDraftLine = (idx: number) => {
    setDraftLines(prev => prev.filter((_, i) => i !== idx));
  };
  const addDraftLine = () => {
    setDraftLines(prev => [...prev, { item_name: '', quantity: 1, unit_of_measure: 'pcs', estimated_unit_price: 0 }]);
  };

  const saveDraft = async () => {
    if (!draftReq) return;
    const validLines = draftLines.filter(l => l.item_name && l.quantity > 0);
    if (validLines.length === 0) {
      addNotification('At least one valid line item is required.', 'warning', 'Inventory');
      return;
    }
    setDraftSaving(true);
    try {
      await updateDraftRequisition(draftReq.id, { lines: validLines, notes: draftNotes, priority: draftPriority });
      addNotification(`Draft ${draftReq.pr_number} saved.`, 'success', 'Inventory');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save draft', 'error', 'Inventory');
    } finally { setDraftSaving(false); }
  };

  const submitDraft = async () => {
    if (!draftReq) return;
    const validLines = draftLines.filter(l => l.item_name && l.quantity > 0);
    if (validLines.length === 0) {
      addNotification('At least one valid line item is required before submitting.', 'warning', 'Inventory');
      return;
    }
    setDraftSubmitting(true);
    try {
      // Save first, then submit
      await updateDraftRequisition(draftReq.id, { lines: validLines, notes: draftNotes, priority: draftPriority });
      const result = await submitDraftRequisition(draftReq.id);
      addNotification(result.message || `Requisition ${draftReq.pr_number} submitted to Procurement.`, 'success', 'Inventory');
      setDraftModalOpen(false);
      setDraftReq(null);
      await loadCentralLowStock();
      await load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to submit draft', 'error', 'Inventory');
    } finally { setDraftSubmitting(false); }
  };

  // ── Demand tab ──
  const filteredDemand = useMemo(() => {
    let rows = demand;
    if (deptFilter !== 'All') rows = rows.filter(r => r.department === deptFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(r =>
        (r.item_name || '').toLowerCase().includes(q) ||
        (r.item_code || '').toLowerCase().includes(q) ||
        (r.category || '').toLowerCase().includes(q)
      );
    }
    return rows;
  }, [demand, deptFilter, search]);

  // ── Requisitions tab ──
  const filteredRequisitions = useMemo(() => {
    let rows = requisitions;
    if (deptFilter !== 'All') rows = rows.filter(r => r.department === deptFilter);
    if (statusFilter !== 'All') rows = rows.filter(r => r.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(r =>
        (r.requisition_number || '').toLowerCase().includes(q) ||
        (r.requested_by || '').toLowerCase().includes(q) ||
        (r.supplier_name || '').toLowerCase().includes(q) ||
        (r.notes || '').toLowerCase().includes(q)
      );
    }
    return rows;
  }, [requisitions, deptFilter, statusFilter, search]);

  // ── Suppliers tab ──
  const filteredSuppliers = useMemo(() => {
    let rows = suppliers;
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(r =>
        (r.supplier_name || '').toLowerCase().includes(q) ||
        (r.supplier_id || '').toLowerCase().includes(q) ||
        (r.category || '').toLowerCase().includes(q)
      );
    }
    return rows;
  }, [suppliers, search]);

  // ── Create requisition helpers ──
  const openCreateForm = () => {
    setFormDept('Engineering');
    setFormSupplierId('');
    setFormPriority('medium');
    setFormNotes('');
    setFormLines([{ itemName: '', category: 'Engineering', quantity: 1, unit: 'pcs', estimatedCost: 0, requiredBy: '', reason: '' }]);
    setShowCreate(true);
  };

  const addLine = () => setFormLines(prev => [...prev, { itemName: '', category: formDept, quantity: 1, unit: 'pcs', estimatedCost: 0, requiredBy: '', reason: '' }]);
  const removeLine = (idx: number) => setFormLines(prev => prev.filter((_, i) => i !== idx));
  const updateLine = (idx: number, field: string, value: any) => {
    setFormLines(prev => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  };

  const handleFormDeptChange = (dept: string) => {
    setFormDept(dept);
    setFormLines(prev => prev.map(l => ({ ...l, category: dept })));
  };

  const submitRequisition = async () => {
    const validLines = formLines.filter(l => l.itemName && l.quantity > 0);
    if (validLines.length === 0) {
      addNotification('Please add at least one item with a name and quantity', 'warning', 'Inventory');
      return;
    }
    if (!currentPropertyId) {
      addNotification('No property selected', 'warning', 'Inventory');
      return;
    }
    setSubmitting(true);
    try {
      const result = await createSupplyRequisition({
        department: formDept,
        propertyId: currentPropertyId,
        supplierId: formSupplierId || undefined,
        priority: formPriority,
        notes: formNotes || undefined,
        items: validLines.map(l => ({
          itemName: l.itemName,
          category: l.category,
          quantity: l.quantity,
          unit: l.unit,
          estimatedCost: l.estimatedCost,
          requiredBy: l.requiredBy,
          reason: l.reason,
        })),
      });
      addNotification(`Requisition ${result.po_number} created for ${result.department}`, 'success', 'Inventory');
      setShowCreate(false);
      load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create requisition', 'error', 'Inventory');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Status advancement ──
  const advanceStatus = async (req: SupplyRequisition, nextStatus: string) => {
    try {
      // If it's an inventory-sourced draft, use the draft submit endpoint
      if (req.department === 'Inventory' && req.po_status === 'draft' && nextStatus === 'submitted') {
        const result = await submitDraftRequisition(req.id);
        addNotification(result.message || `${req.requisition_number} submitted`, 'success', 'Inventory');
        load();
        return;
      }
      await updateSupplyRequisitionStatus(req.id, { status: nextStatus, department: req.department });
      addNotification(`${req.requisition_number} → ${nextStatus}`, 'success', 'Inventory');
      load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update status', 'error', 'Inventory');
    }
  };

  // ── Open draft editor from requisitions list ──
  const openDraftFromList = async (reqId: string) => {
    try {
      const result = await fetchDraftRequisition(reqId);
      setDraftReq(result.requisition);
      setDraftLines(result.lines.map(l => ({
        id: l.id,
        item_code: l.item_code || '',
        item_name: l.item_name,
        category: l.category || '',
        quantity: l.quantity,
        unit_of_measure: l.unit_of_measure || 'pcs',
        estimated_unit_price: l.estimated_unit_price,
        required_date: l.required_date || '',
      })));
      setDraftNotes(result.requisition.notes || '');
      setDraftPriority(result.requisition.priority || 'High');
      setDraftModalOpen(true);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to load draft', 'error', 'Inventory');
    }
  };

  // ── Receive modal ──
  const openReceiveForm = (req: SupplyRequisition) => {
    setReceiveTarget(req);
    setReceiveLines((req.items || []).map(it => ({
      lineId: it.id,
      receivedQty: it.requested_quantity,
      ordered: it.requested_quantity,
      itemName: it.item_name,
    })));
  };

  const submitReceive = async () => {
    if (!receiveTarget) return;
    setReceiveSubmitting(true);
    try {
      const result = await receiveSupplyRequisition(receiveTarget.id, {
        department: receiveTarget.department,
        lines: receiveLines.map(l => ({ lineId: l.lineId, receivedQty: l.receivedQty })),
      });
      addNotification(`Received ${receiveTarget.requisition_number} — ${result.fullyReceived ? 'fully' : 'partially'} (${result.transactionsLogged} ledger entries)`, 'success', 'Inventory');
      setReceiveTarget(null);
      load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to process goods receipt', 'error', 'Inventory');
    } finally {
      setReceiveSubmitting(false);
    }
  };

  const tabs: { id: TabId; label: string; icon: typeof Package }[] = [
    { id: 'demand', label: 'Demand', icon: TrendingUp },
    { id: 'requisitions', label: 'Requisitions', icon: ClipboardList },
    { id: 'suppliers', label: 'Suppliers', icon: Users },
  ];

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Supply & Procurement"
        subtitle="Centralized supply & procurement across all departments. Requisitions, demand, and suppliers in one place."
        icon={ShoppingCart}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />} Refresh
            </button>
            <button onClick={openCreateForm} className={button.primary}>
              <Plus className="w-4 h-4" /> New Requisition
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Open Requisitions" value={stats?.openRequisitions ?? '—'} icon={ClipboardList} tone="info" />
        <StatCard title="Pending Approval" value={stats?.pendingApproval ?? '—'} icon={AlertTriangle} tone="warning" />
        <StatCard title="Active Suppliers" value={stats?.activeSuppliers ?? '—'} icon={Users} tone="accent" />
        <StatCard title="Avg Lead Time (days)" value={stats?.avgLeadTimeDays?.toFixed(1) ?? '—'} icon={TrendingUp} tone="neutral" />
      </div>

      {subTabBar}

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {/* Tab switcher */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl w-fit">
        {tabs.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setSearch(''); setDeptFilter('All'); setStatusFilter('All'); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-white dark:bg-slate-700 text-[var(--color-accent-operations)] shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              <Icon className="w-4 h-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <SectionCard pad="md">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              placeholder={tab === 'suppliers' ? 'Search supplier name or code…' : tab === 'requisitions' ? 'Search requisition, requester, or supplier…' : 'Search item name or code…'}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
            />
          </div>
          {tab !== 'suppliers' && (
            <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className={inputClass + ' w-auto'}>
              {DEPT_FILTERS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          {tab === 'requisitions' && (
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={inputClass + ' w-auto'}>
              {['All', 'draft', 'submitted', 'approved', 'processing', 'rejected'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </div>
      </SectionCard>

      {/* ── Demand tab ── */}
      {tab === 'demand' && (
        <div className="space-y-6">
          {/* Central Low-Stock Preview */}
          <SectionCard pad="md">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300">Central Low-Stock Preview</h3>
                  <p className="text-xs text-slate-500 mt-1">Items in Main Warehouse at or below reorder point. Generating creates Procurement requisitions automatically.</p>
                </div>
                <div className="flex gap-2">
                  <button className={button.secondary} onClick={loadCentralLowStock} disabled={centralLoading}>
                    {centralLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}Refresh
                  </button>
                  <button className={button.primary} onClick={handleGenerateProcurement} disabled={centralGenerating || centralLowStock.length === 0}>
                    {centralGenerating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Zap className="w-4 h-4 mr-2" />}
                    Generate Requisitions
                  </button>
                </div>
              </div>
              {centralLowStock.length > 0 && (
                <div className="flex gap-3">
                  <StatCard label="Low-Stock Items" value={centralLowStock.length} icon={AlertTriangle} tone="warning" />
                  <StatCard label="Total Est. Value" value={`$${centralLowStock.reduce((s, p) => s + Number(p.estimatedValue || 0), 0).toFixed(2)}`} icon={DollarSign} tone="info" />
                </div>
              )}
              <InventoryTable
                rows={centralLowStock}
                rowKey={(r) => r.itemId || r.balanceId}
                loading={centralLoading}
                loadingMessage="Scanning Main Warehouse…"
                error={null}
                onRetry={loadCentralLowStock}
                emptyMessage="No low-stock items at central warehouse. All items are above their reorder points."
                columns={[
                  { key: 'item', header: 'Item', widthClass: 'md:w-48 shrink-0', render: (r) => <span className="text-sm font-medium">{r.itemName}</span> },
                  { key: 'code', header: 'Code', widthClass: 'md:w-32 shrink-0', render: (r) => <span className="text-sm font-mono">{r.itemCode}</span> },
                  { key: 'on_hand', header: 'On Hand', align: 'right', widthClass: 'md:w-24 shrink-0', render: (r) => <span className="text-sm text-red-600 font-semibold">{r.onHand}</span> },
                  { key: 'reorder', header: 'Reorder Point', align: 'right', widthClass: 'md:w-28 shrink-0', render: (r) => <span className="text-sm">{r.reorderPoint}</span> },
                  { key: 'suggested', header: 'Suggested Qty', align: 'right', widthClass: 'md:w-28 shrink-0', render: (r) => <span className="text-sm font-bold">{r.suggestedOrderQty}</span> },
                  { key: 'unit_cost', header: 'Unit Cost', align: 'right', widthClass: 'md:w-24 shrink-0', render: (r) => <span className="text-sm">{Number(r.lastCost).toFixed(2)}</span> },
                  { key: 'est_value', header: 'Est. Value', align: 'right', widthClass: 'md:w-28 shrink-0', render: (r) => <span className="text-sm font-semibold">{Number(r.estimatedValue).toFixed(2)}</span> },
                ]}
              />
            </div>
          </SectionCard>

          {/* Department Demand */}
          <div>
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">Department Demand</h3>
            <InventoryTable
              rows={filteredDemand}
              rowKey={(r) => r.id}
              loading={loading}
              loadingMessage="Loading replenishment demand…"
              error={error}
              onRetry={load}
              emptyMessage={demand.length === 0 ? 'No items at/below reorder point across department stores.' : 'No demand rows match the filters.'}
              columns={[
                {
                  key: 'item',
                  header: 'Item',
                  widthClass: 'md:w-56 shrink-0',
                  render: (r) => (
                    <IdentityCell
                      icon={<Package size={16} />}
                      soft={statusTone.neutral.soft}
                      text={statusTone.neutral.text}
                      name={r.item_name}
                      code={r.item_code}
                    />
                  ),
                },
                {
                  key: 'dept',
                  header: 'Department',
                  widthClass: 'md:w-36 shrink-0',
                  render: (r) => <Badge tone="info">{r.department}</Badge>,
                },
                {
                  key: 'category',
                  header: 'Category',
                  widthClass: 'md:w-32 shrink-0',
                  render: (r) => <span className="text-sm text-slate-500 dark:text-slate-400">{r.category}</span>,
                },
                {
                  key: 'stock',
                  header: 'On Hand',
                  widthClass: 'md:w-24 shrink-0 text-right',
                  render: (r) => <span className="text-sm tabular-nums font-bold text-red-600">{r.current_stock.toFixed(1)}</span>,
                },
                {
                  key: 'reorder',
                  header: 'Reorder Pt',
                  widthClass: 'md:w-24 shrink-0 text-right',
                  render: (r) => <span className="text-sm tabular-nums text-slate-500">{r.reorder_point}</span>,
                },
                {
                  key: 'shortage',
                  header: 'Shortage',
                  widthClass: 'md:w-24 shrink-0 text-right',
                  render: (r) => <span className="text-sm tabular-nums font-bold text-amber-600">{r.shortage.toFixed(1)}</span>,
                },
                {
                  key: 'cost',
                  header: 'Unit Cost',
                  widthClass: 'md:w-24 shrink-0 text-right',
                  render: (r) => <span className="text-sm tabular-nums text-slate-600 dark:text-slate-400">${r.unit_cost.toFixed(2)}</span>,
                },
              ]}
            />
          </div>
        </div>
      )}

      {/* ── Requisitions tab ── */}
      {tab === 'requisitions' && (
        <InventoryTable
          rows={filteredRequisitions}
          rowKey={(r) => r.id}
          loading={loading}
          loadingMessage="Loading requisitions…"
          error={error}
          onRetry={load}
          emptyMessage={requisitions.length === 0 ? 'No requisitions yet. Click "New Requisition" to create one.' : 'No requisitions match the filters.'}
          columns={[
            {
              key: 'req',
              header: 'Requisition',
              widthClass: 'md:w-48 shrink-0',
              render: (r) => (
                <IdentityCell
                  icon={<ClipboardList size={16} />}
                  soft={statusTone.info.soft}
                  text={statusTone.info.text}
                  name={r.requisition_number}
                  code={r.request_date}
                />
              ),
            },
            {
              key: 'dept',
              header: 'Department',
              widthClass: 'md:w-32 shrink-0',
              render: (r) => <Badge tone="info">{r.department}</Badge>,
            },
            {
              key: 'requester',
              header: 'Requester',
              widthClass: 'md:w-32 shrink-0',
              render: (r) => <span className="text-sm text-slate-600 dark:text-slate-400">{r.requested_by}</span>,
            },
            {
              key: 'supplier',
              header: 'Supplier',
              widthClass: 'md:w-36 shrink-0',
              render: (r) => <span className="text-sm text-slate-600 dark:text-slate-400">{r.supplier_name || '—'}</span>,
            },
            {
              key: 'items',
              header: 'Items',
              widthClass: 'md:w-20 shrink-0 text-right',
              render: (r) => <span className="text-sm tabular-nums text-slate-500">{r.items?.length || 0}</span>,
            },
            {
              key: 'total',
              header: 'Total',
              widthClass: 'md:w-24 shrink-0 text-right',
              render: (r) => <span className="text-sm tabular-nums font-bold text-slate-700 dark:text-slate-300">${Number(r.total_cost || 0).toFixed(2)}</span>,
            },
            {
              key: 'status',
              header: 'Status',
              widthClass: 'md:w-28 shrink-0',
              render: (r) => <Badge tone={STATUS_BADGE[r.status] || 'neutral'}>{r.status}</Badge>,
            },
            {
              key: 'actions',
              header: 'Actions',
              widthClass: 'md:w-48 shrink-0 text-right',
              render: (r) => (
                <OpsCell>
                  {r.po_status === 'draft' && r.department === 'Inventory' && (
                    <IconButton title="Edit Draft" onClick={() => openDraftFromList(r.id)}>
                      <Edit className="w-4 h-4" />
                    </IconButton>
                  )}
                  {r.po_status === 'draft' && (
                    <IconButton title="Submit" onClick={() => advanceStatus(r, 'submitted')}>
                      <ArrowRightCircle className="w-4 h-4" />
                    </IconButton>
                  )}
                  {r.po_status === 'submitted' && (
                    <IconButton title="Acknowledge" onClick={() => advanceStatus(r, 'acknowledged')}>
                      <CheckCircle2 className="w-4 h-4" />
                    </IconButton>
                  )}
                  {r.po_status === 'acknowledged' && (
                    <IconButton title="Receive Goods" onClick={() => openReceiveForm(r)}>
                      <Package className="w-4 h-4" />
                    </IconButton>
                  )}
                  {r.po_status === 'partial' && (
                    <IconButton title="Receive Remaining" onClick={() => openReceiveForm(r)}>
                      <Package className="w-4 h-4" />
                    </IconButton>
                  )}
                  {r.po_status === 'received' && (
                    <IconButton title="Close" onClick={() => advanceStatus(r, 'closed')}>
                      <CheckCircle2 className="w-4 h-4" />
                    </IconButton>
                  )}
                  {(r.po_status === 'draft' || r.po_status === 'submitted' || r.po_status === 'acknowledged') && (
                    <IconButton title="Cancel" onClick={() => advanceStatus(r, 'cancelled')}>
                      <XCircle className="w-4 h-4" />
                    </IconButton>
                  )}
                </OpsCell>
              ),
            },
          ]}
        />
      )}

      {/* ── Suppliers tab ── */}
      {tab === 'suppliers' && (
        <InventoryTable
          rows={filteredSuppliers}
          rowKey={(r) => r.id}
          loading={loading}
          loadingMessage="Loading suppliers…"
          error={error}
          onRetry={load}
          emptyMessage={suppliers.length === 0 ? 'No suppliers in the shared master (fb_suppliers).' : 'No suppliers match the search.'}
          columns={[
            {
              key: 'name',
              header: 'Supplier',
              widthClass: 'md:w-56 shrink-0',
              render: (r) => (
                <IdentityCell
                  icon={<Users size={16} />}
                  soft={statusTone.accent.soft}
                  text={statusTone.accent.text}
                  name={r.supplier_name}
                  code={r.supplier_id}
                />
              ),
            },
            {
              key: 'lead',
              header: 'Lead Time (days)',
              widthClass: 'md:w-32 shrink-0 text-right',
              render: (r) => <span className="text-sm tabular-nums text-slate-600 dark:text-slate-400">{r.lead_time_days}</span>,
            },
            {
              key: 'terms',
              header: 'Payment Terms',
              widthClass: 'md:w-32 shrink-0',
              render: (r) => <span className="text-sm text-slate-500 dark:text-slate-400">{r.payment_terms}</span>,
            },
            {
              key: 'lastorder',
              header: 'Last Order',
              widthClass: 'md:w-32 shrink-0',
              render: (r) => <span className="text-sm text-slate-500 dark:text-slate-400">{r.last_order_date || '—'}</span>,
            },
            {
              key: 'status',
              header: 'Status',
              widthClass: 'md:w-24 shrink-0',
              render: (r) => <Badge tone={r.status === 'active' ? 'success' : 'neutral'}>{r.status}</Badge>,
            },
          ]}
        />
      )}

      {/* ── Create Requisition Modal ── */}
      <ModalSystem
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="New Purchase Requisition"
        size="lg"
        footer={
          <>
            <button onClick={() => setShowCreate(false)} className={button.secondary}>Cancel</button>
            <button onClick={submitRequisition} disabled={submitting} className={button.primary + ' disabled:opacity-50'}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create Requisition
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Department">
              <select value={formDept} onChange={e => handleFormDeptChange(e.target.value)} className={inputClass}>
                {SUPPLY_DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="Supplier (optional)">
              <select value={formSupplierId} onChange={e => setFormSupplierId(e.target.value)} className={inputClass}>
                <option value="">— Select supplier —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select value={formPriority} onChange={e => setFormPriority(e.target.value)} className={inputClass}>
                {['low', 'medium', 'high', 'urgent'].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Notes">
            <textarea value={formNotes} onChange={e => setFormNotes(e.target.value)} rows={2} className={inputClass} placeholder="Optional notes for procurement…" />
          </Field>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Line Items</span>
              <button onClick={addLine} className={button.ghost + ' text-xs'}>
                <Plus className="w-3 h-3" /> Add Line
              </button>
            </div>
            <div className="space-y-2">
              {formLines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                  <div className="col-span-12 md:col-span-4">
                    <span className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Item Name</span>
                    <input value={line.itemName} onChange={e => updateLine(idx, 'itemName', e.target.value)} className={inputClass} placeholder="Item name…" />
                  </div>
                  <div className="col-span-4 md:col-span-2">
                    <span className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Qty</span>
                    <input type="number" min={1} value={line.quantity} onChange={e => updateLine(idx, 'quantity', Number(e.target.value))} className={inputClass} />
                  </div>
                  <div className="col-span-4 md:col-span-1">
                    <span className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Unit</span>
                    <input value={line.unit} onChange={e => updateLine(idx, 'unit', e.target.value)} className={inputClass} />
                  </div>
                  <div className="col-span-4 md:col-span-2">
                    <span className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Est. Cost</span>
                    <input type="number" min={0} step="0.01" value={line.estimatedCost} onChange={e => updateLine(idx, 'estimatedCost', Number(e.target.value))} className={inputClass} />
                  </div>
                  <div className="col-span-6 md:col-span-2">
                    <span className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Required By</span>
                    <input type="date" value={line.requiredBy} onChange={e => updateLine(idx, 'requiredBy', e.target.value)} className={inputClass} />
                  </div>
                  <div className="col-span-6 md:col-span-1 flex justify-end">
                    <button onClick={() => removeLine(idx)} className="text-red-500 hover:text-red-700 p-2">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
              {formLines.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-4">No line items. Click "Add Line" to add one.</p>
              )}
            </div>
          </div>
        </div>
      </ModalSystem>

      {/* ── Receive Goods Modal ── */}
      <ModalSystem
        open={!!receiveTarget}
        onClose={() => setReceiveTarget(null)}
        title={`Receive Goods — ${receiveTarget?.requisition_number || ''}`}
        size="md"
        footer={
          <>
            <button onClick={() => setReceiveTarget(null)} className={button.secondary}>Cancel</button>
            <button onClick={submitReceive} disabled={receiveSubmitting} className={button.primary + ' disabled:opacity-50'}>
              {receiveSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />} Confirm Receipt
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Enter the received quantity for each line. Stock will be credited to the {receiveTarget?.department} store.
          </p>
          {receiveLines.map((l, idx) => (
            <div key={l.lineId} className="flex items-center gap-3 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50">
              <div className="flex-1">
                <div className="text-sm font-medium text-slate-700 dark:text-slate-300">{l.itemName}</div>
                <div className="text-xs text-slate-400">Ordered: {l.ordered}</div>
              </div>
              <div className="w-28">
                <input
                  type="number"
                  min={0}
                  max={l.ordered}
                  value={l.receivedQty}
                  onChange={e => setReceiveLines(prev => prev.map((rl, i) => (i === idx ? { ...rl, receivedQty: Number(e.target.value) } : rl)))}
                  className={inputClass}
                />
              </div>
            </div>
          ))}
          {receiveLines.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-4">No lines on this requisition.</p>
          )}
        </div>
      </ModalSystem>

      {/* ── Draft Requisition Editor Modal ── */}
      <ModalSystem
        open={draftModalOpen}
        onClose={() => { setDraftModalOpen(false); setDraftReq(null); }}
        title={`Draft Procurement Requisition — ${draftReq?.pr_number || ''}`}
        size="xl"
        footer={
          <div className="flex items-center justify-between w-full">
            <div className="text-sm text-slate-500">
              {draftLines.filter(l => l.item_name && l.quantity > 0).length} items · Est. Total: <span className="font-bold text-slate-700 dark:text-slate-300">${draftLines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.estimated_unit_price) || 0), 0).toFixed(2)}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setDraftModalOpen(false)} className={button.secondary}>Close</button>
              <button onClick={saveDraft} disabled={draftSaving} className={button.secondary + ' disabled:opacity-50'}>
                {draftSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Save Draft
              </button>
              <button onClick={submitDraft} disabled={draftSubmitting} className={button.primary + ' disabled:opacity-50'}>
                {draftSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightCircle className="w-4 h-4" />} Submit to Procurement
              </button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-300">
            This is a <strong>Draft</strong> requisition auto-generated from central low-stock items. Edit quantities, add or remove items, then click <strong>Submit to Procurement</strong> when ready.
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Priority">
              <select value={draftPriority} onChange={e => setDraftPriority(e.target.value)} className={inputClass}>
                {['Low', 'Normal', 'High', 'Urgent', 'Critical'].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Notes">
              <input value={draftNotes} onChange={e => setDraftNotes(e.target.value)} className={inputClass} placeholder="Optional notes…" />
            </Field>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Line Items ({draftLines.length})</span>
              <button onClick={addDraftLine} className={button.ghost + ' text-xs'}>
                <Plus className="w-3 h-3" /> Add Line
              </button>
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {draftLines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                  <div className="col-span-12 md:col-span-4">
                    <span className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Item Name</span>
                    <input value={line.item_name} onChange={e => updateDraftLine(idx, 'item_name', e.target.value)} className={inputClass} />
                  </div>
                  <div className="col-span-3 md:col-span-1">
                    <span className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Code</span>
                    <input value={line.item_code || ''} onChange={e => updateDraftLine(idx, 'item_code', e.target.value)} className={inputClass} />
                  </div>
                  <div className="col-span-3 md:col-span-2">
                    <span className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Qty</span>
                    <input type="number" min={0} step="any" value={line.quantity} onChange={e => updateDraftLine(idx, 'quantity', Number(e.target.value))} className={inputClass} />
                  </div>
                  <div className="col-span-2 md:col-span-1">
                    <span className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Unit</span>
                    <input value={line.unit_of_measure || 'pcs'} onChange={e => updateDraftLine(idx, 'unit_of_measure', e.target.value)} className={inputClass} />
                  </div>
                  <div className="col-span-2 md:col-span-2">
                    <span className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Unit Cost</span>
                    <input type="number" min={0} step="0.01" value={line.estimated_unit_price} onChange={e => updateDraftLine(idx, 'estimated_unit_price', Number(e.target.value))} className={inputClass} />
                  </div>
                  <div className="col-span-2 md:col-span-2">
                    <span className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Line Total</span>
                    <div className="text-sm font-semibold py-2">{(Number(line.quantity) * Number(line.estimated_unit_price)).toFixed(2)}</div>
                  </div>
                  <div className="col-span-12 md:col-span-1 flex justify-end">
                    <button onClick={() => removeDraftLine(idx)} className="text-red-500 hover:text-red-700 p-2">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
              {draftLines.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-4">No line items. Click "Add Line" to add one.</p>
              )}
            </div>
          </div>
        </div>
      </ModalSystem>
    </div>
  );
};

export default SupplyProcurementModule;
