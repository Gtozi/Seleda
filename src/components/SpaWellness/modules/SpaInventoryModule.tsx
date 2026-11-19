/**
 * Spa & Wellness Inventory Module — mimics the Housekeeping inventory UI.
 * Backed by the unified uinv_* inventory system, scoped to the
 * UINV-ST-SPA department store (resolveDepartmentStoreIds matches the
 * store's `department` column, so all uinv-portal endpoints pick it up).
 *
 * Sub-tabs: Inventory, Replenishment & Requisition, Consumption, Waste,
 * Transfers, Stock Movements, Stock Count, Par Management.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Package,
  Plus,
  Search,
  RefreshCw,
  Loader2,
  ServerCrash,
  Pencil,
  Trash2,
  AlertTriangle,
  BookOpen,
  ClipboardCheck,
  ClipboardList,
  ArrowDownUp,
  Truck,
  AlertCircle,
  DollarSign,
  Activity,
  Target,
  Zap,
  Clock,
  CheckCircle2,
  ArrowUpFromLine,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { ModalSystem } from '../../Shared/ModalSystem';
import { useERP } from '../../../context/ERPContext';
import DepartmentRequisitionForm from '../../Inventory/DepartmentRequisitionForm';
import DepartmentDynamicParPanel from '../../Inventory/DepartmentDynamicParPanel';
import DepartmentParOverridesPanel from '../../Inventory/DepartmentParOverridesPanel';
import InterDepartmentTransferPanel from '../../Inventory/InterDepartmentTransferPanel';
import DepartmentReplenishmentPanel from '../../Inventory/DepartmentReplenishmentPanel';
import StockCountsModule from '../../Inventory/StockCountsModule';
import {
  fetchStockByDepartment,
  fetchItemsByDepartment,
  fetchLedger,
  fetchWaste,
  createWaste,
  fetchIssues,
  createItem,
  updateItem,
  deleteItem,
  createAdjustmentBulk,
  updateAdjustment,
  type UinvItem,
  type UinvStockBalance,
  type UinvLedgerEntry,
  type UinvWaste,
  type UinvIssue,
} from '../../../services/inventoryService';

const DEPARTMENT = 'Spa & Wellness';
const SPA_STORE_ID = 'UINV-ST-SPA';

const SUBCATEGORIES = [
  'Massage Oils & Lotions',
  'Facial Products',
  'Body Treatments',
  'Towels & Linens',
  'Guest Amenities',
  'Aromatherapy',
  'Equipment',
  'Spa Supplies',
];

const WASTE_TYPES = ['Spoilage', 'Damaged', 'Expired', 'Lost', 'Contamination'];
const UOMS = ['pcs', 'bottle', 'box', 'kg', 'ltr', 'set', 'pair', 'roll'];

type TabKey =
  | 'inventory' | 'requisitions' | 'consumption' | 'waste' | 'transfers'
  | 'movements' | 'stock-count' | 'par-management';

interface Row {
  item: UinvItem;
  onHand: number;
  reserved: number;
  unitCost: number;
  lastMovement: string | null;
  balanceId: string | null;
  location: string;
}

const inputCls = 'px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-spa)]';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">{label}</span>
      {children}
    </label>
  );
}

const btnPrimary = 'px-3 py-2 text-sm bg-[var(--color-accent-spa)] text-white rounded-lg hover:opacity-90 transition-opacity';
const btnSecondary = 'px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors';

export default function SpaInventoryModule() {
  const { currentPropertyId, addNotification, formatAmount } = useERP();

  const [items, setItems] = useState<UinvItem[]>([]);
  const [balances, setBalances] = useState<UinvStockBalance[]>([]);
  const [ledger, setLedger] = useState<UinvLedgerEntry[]>([]);
  const [wasteRecords, setWasteRecords] = useState<UinvWaste[]>([]);
  const [requisitions, setRequisitions] = useState<UinvIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<TabKey>('inventory');
  const [parView, setParView] = useState<'dynamic' | 'overrides'>('dynamic');
  const [search, setSearch] = useState('');
  const [subcatFilter, setSubcatFilter] = useState('all');
  const [stockFilter, setStockFilter] = useState('all');

  // External action triggers for embedded panels (HK pattern)
  const [replenishRefreshTrigger, setReplenishRefreshTrigger] = useState(0);
  const [replenishAutoTrigger, setReplenishAutoTrigger] = useState(0);
  const [reqRefreshTrigger, setReqRefreshTrigger] = useState(0);
  const [reqNewTrigger, setReqNewTrigger] = useState(0);
  const [parRefreshTrigger, setParRefreshTrigger] = useState(0);
  const [parRecalculateTrigger, setParRecalculateTrigger] = useState(0);
  const [parAutoReplenishTrigger, setParAutoReplenishTrigger] = useState(0);
  const [countRefreshTrigger, setCountRefreshTrigger] = useState(0);
  const [countNewTrigger, setCountNewTrigger] = useState(0);

  // Item form
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<UinvItem | null>(null);
  const [form, setForm] = useState<Partial<UinvItem>>({});
  const [saving, setSaving] = useState(false);

  // Adjust stock
  const [adjustRow, setAdjustRow] = useState<Row | null>(null);
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustReason, setAdjustReason] = useState('');

  // Waste form
  const [wasteOpen, setWasteOpen] = useState(false);
  const [wasteForm, setWasteForm] = useState({ itemId: '', wasteType: 'Spoilage', quantity: '', reason: '' });

  // Consumption (HK-style theoretical vs actual)
  const [showConsumptionModal, setShowConsumptionModal] = useState(false);
  const [consumptionForm, setConsumptionForm] = useState<{ treatmentsCompleted: number; entries: { itemId: string; actualQty: number }[] }>({ treatmentsCompleted: 1, entries: [] });
  const [consumptionSearch, setConsumptionSearch] = useState('');

  // ── Data ──────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    // Bump embedded-panel triggers so the shared panels refresh alongside.
    setReplenishRefreshTrigger(t => t + 1);
    setReqRefreshTrigger(t => t + 1);
    setParRefreshTrigger(t => t + 1);
    setCountRefreshTrigger(t => t + 1);
    setLoading(true);
    setError(null);
    try {
      const [it, bal, led, wst, iss] = await Promise.all([
        fetchItemsByDepartment(DEPARTMENT, currentPropertyId || undefined).catch(() => [] as UinvItem[]),
        fetchStockByDepartment(DEPARTMENT, currentPropertyId || undefined).catch(() => [] as UinvStockBalance[]),
        fetchLedger({ storeId: SPA_STORE_ID, propertyId: currentPropertyId || undefined }).catch(() => [] as UinvLedgerEntry[]),
        fetchWaste({ propertyId: currentPropertyId || undefined }).catch(() => [] as UinvWaste[]),
        fetchIssues({ department: DEPARTMENT, propertyId: currentPropertyId || undefined }).catch(() => [] as UinvIssue[]),
      ]);
      setItems(it);
      setBalances(bal);
      setLedger(led);
      setWasteRecords(wst.filter(w => w.store_id === SPA_STORE_ID));
      setRequisitions(iss);
    } catch (e: any) {
      setError(e.message || 'Failed to load inventory');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Derived rows (item ↔ aggregated spa-store balance) ───────────────────

  const rows: Row[] = useMemo(() => {
    const byItem = new Map<string, { onHand: number; reserved: number; unitCost: number; lastMovement: string | null; balanceId: string | null; location: string }>();
    for (const b of balances) {
      const e = byItem.get(b.item_id);
      if (e) {
        e.onHand += Number(b.on_hand || 0);
        e.reserved += Number(b.reserved || 0);
      } else {
        byItem.set(b.item_id, {
          onHand: Number(b.on_hand || 0),
          reserved: Number(b.reserved || 0),
          unitCost: Number(b.unit_cost || 0),
          lastMovement: b.last_movement_date,
          balanceId: b.id,
          location: b.location?.location_name || b.store?.store_name || 'Spa Store',
        });
      }
    }
    return items
      .filter(i => i.is_active)
      .map(item => {
        const b = byItem.get(item.id);
        return {
          item,
          onHand: b?.onHand ?? 0,
          reserved: b?.reserved ?? 0,
          unitCost: b?.unitCost ?? Number(item.avg_cost || item.last_cost || 0),
          lastMovement: b?.lastMovement ?? null,
          balanceId: b?.balanceId ?? null,
          location: b?.location ?? 'Spa Store',
        };
      });
  }, [items, balances]);

  const filteredRows = useMemo(() => {
    const s = search.toLowerCase();
    return rows.filter(r => {
      const matchSearch = !s || r.item.item_name.toLowerCase().includes(s) || r.item.item_code.toLowerCase().includes(s) || (r.item.brand || '').toLowerCase().includes(s);
      const matchSub = subcatFilter === 'all' || r.item.subcategory === subcatFilter;
      const critical = r.item.min_stock > 0 && r.onHand <= r.item.min_stock;
      const low = !critical && r.item.reorder_point > 0 && r.onHand <= r.item.reorder_point;
      const matchStock = stockFilter === 'all' || (stockFilter === 'low' && low) || (stockFilter === 'critical' && critical) || (stockFilter === 'normal' && !low && !critical);
      return matchSearch && matchSub && matchStock;
    });
  }, [rows, search, subcatFilter, stockFilter]);

  const totalItemsCount = rows.length;
  const totalInventoryValue = rows.reduce((s, r) => s + r.onHand * r.unitCost, 0);
  const criticalStockItems = rows.filter(r => r.item.min_stock > 0 && r.onHand <= r.item.min_stock).length;
  const lowStockItems = rows.filter(r => r.item.reorder_point > 0 && r.onHand <= r.item.reorder_point).length;

  const nextItemCode = useMemo(() => {
    const nums = items.map(i => Number((i.item_code.match(/SPA-(\d+)/) || [])[1])).filter(n => Number.isFinite(n));
    return `SPA-${String(Math.max(100, ...(nums.length ? nums : [100])) + 1)}`;
  }, [items]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const openNew = () => {
    setEditing(null);
    setForm({
      item_code: nextItemCode,
      category: DEPARTMENT,
      subcategory: 'Massage Oils & Lotions',
      item_type: 'Consumable',
      unit_of_measure: 'pcs',
      min_stock: 10,
      reorder_point: 20,
      par_level: 40,
      last_cost: 0,
      expiry_controlled: false,
      is_active: true,
    });
    setShowForm(true);
  };

  const openEdit = (item: UinvItem) => {
    setEditing(item);
    setForm({ ...item });
    setShowForm(true);
  };

  const saveItem = async () => {
    if (!form.item_name || !form.item_code) {
      addNotification('Item code and name are required', 'warning', 'Spa');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        category: DEPARTMENT,
        default_store_id: SPA_STORE_ID,
        property_id: currentPropertyId || null,
      };
      if (editing) await updateItem(editing.id, payload);
      else await createItem(payload);
      addNotification(editing ? 'Item updated' : 'Item created', 'success', 'Spa');
      setShowForm(false);
      fetchData();
    } catch (e: any) {
      addNotification(`Save failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setSaving(false);
    }
  };

  const removeItem = async (item: UinvItem) => {
    if (!confirm(`Delete ${item.item_name} (${item.item_code})?`)) return;
    try {
      await deleteItem(item.id);
      setItems(prev => prev.filter(i => i.id !== item.id));
      addNotification(`${item.item_name} deleted`, 'success', 'Spa');
    } catch (e: any) {
      addNotification(`Delete failed: ${e.message}`, 'warning', 'Spa');
    }
  };

  const submitAdjust = async () => {
    if (!adjustRow) return;
    const qty = Number(adjustQty);
    if (!Number.isFinite(qty) || qty === 0) {
      addNotification('Adjustment must be a non-zero number', 'warning', 'Spa');
      return;
    }
    if (qty < 0 && Math.abs(qty) > adjustRow.onHand) {
      addNotification(`Cannot remove more than on-hand (${adjustRow.onHand})`, 'warning', 'Spa');
      return;
    }
    setSaving(true);
    try {
      const created = await createAdjustmentBulk({
        store_id: SPA_STORE_ID,
        property_id: currentPropertyId || null,
        reason: adjustReason || 'Stock Adjustment',
        adjustment_type: qty > 0 ? 'Quantity Increase' : 'Quantity Decrease',
        lines: [{ item_id: adjustRow.item.id, quantity_delta: qty, unit_cost: adjustRow.unitCost }],
      });
      const adj = Array.isArray(created) ? created[0] : (created as any);
      if (adj?.id) await updateAdjustment(adj.id, { status: 'Approved' });
      addNotification(`Stock adjusted by ${qty} ${adjustRow.item.unit_of_measure}`, 'success', 'Spa');
      setAdjustRow(null);
      setAdjustQty('');
      setAdjustReason('');
      fetchData();
    } catch (e: any) {
      addNotification(`Adjustment failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setSaving(false);
    }
  };

  const submitWaste = async () => {
    const qty = Number(wasteForm.quantity);
    const row = rows.find(r => r.item.id === wasteForm.itemId);
    if (!row || !Number.isFinite(qty) || qty <= 0) {
      addNotification('Select an item and enter a valid quantity', 'warning', 'Spa');
      return;
    }
    if (qty > row.onHand) {
      addNotification(`Only ${row.onHand} ${row.item.unit_of_measure} on hand`, 'warning', 'Spa');
      return;
    }
    setSaving(true);
    try {
      await createWaste({
        item_id: row.item.id,
        store_id: SPA_STORE_ID,
        property_id: currentPropertyId || null,
        quantity: qty,
        unit_cost: row.unitCost,
        waste_type: wasteForm.wasteType,
        reason: wasteForm.reason || wasteForm.wasteType,
        department: DEPARTMENT,
        status: 'Approved',
      });
      addNotification('Waste recorded', 'success', 'Spa');
      setWasteOpen(false);
      setWasteForm({ itemId: '', wasteType: 'Spoilage', quantity: '', reason: '' });
      fetchData();
    } catch (e: any) {
      addNotification(`Waste failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setSaving(false);
    }
  };

  const submitConsumption = async () => {
    if (!consumptionForm.treatmentsCompleted || consumptionForm.treatmentsCompleted <= 0) {
      addNotification('Enter the number of treatments completed', 'warning', 'Spa');
      return;
    }
    if (consumptionForm.entries.length === 0) {
      addNotification('Add at least one item to the consumption entry', 'warning', 'Spa');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/spa-wellness/inventory/consumption', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: currentPropertyId,
          treatmentsCompleted: consumptionForm.treatmentsCompleted,
          entries: consumptionForm.entries,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to record consumption');
      addNotification(`Consumption recorded for ${consumptionForm.treatmentsCompleted} treatments`, 'success', 'Spa');
      setShowConsumptionModal(false);
      setConsumptionForm({ treatmentsCompleted: 1, entries: [] });
      fetchData();
    } catch (e: any) {
      addNotification(`Consumption failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setSaving(false);
    }
  };

  // ── Tabs (HK-style underline tabs with count badges) ──────────────────────

  const tabs = [
    { id: 'inventory' as const, label: 'Inventory', icon: Package },
    { id: 'par-management' as const, label: 'Par Management', icon: Activity },
    { id: 'requisitions' as const, label: 'Replenishment & Requisition', icon: ClipboardCheck },
    { id: 'consumption' as const, label: 'Consumption', icon: BookOpen },
    { id: 'waste' as const, label: 'Waste & Loss', icon: AlertTriangle },
    { id: 'transfers' as const, label: 'Transfers', icon: Truck },
    { id: 'movements' as const, label: 'Stock Movements', icon: ArrowDownUp },
    { id: 'stock-count' as const, label: 'Stock Count', icon: ClipboardList },
  ];

  const tabCounts: Partial<Record<TabKey, number | undefined>> = {
    inventory: rows.length,
    requisitions: requisitions.filter(r => r.approval_status === 'Pending').length,
    waste: wasteRecords.length,
    movements: ledger.length,
    'stock-count': undefined,
    'par-management': undefined,
    consumption: undefined,
    transfers: undefined,
  };

  // Dynamic stats — change based on the active sub-tab (HK pattern)
  const stats = useMemo(() => {
    const wasteCost = wasteRecords.reduce((s, w) => s + Number(w.total_cost || 0), 0);
    const wasteQty = wasteRecords.reduce((s, w) => s + Number(w.quantity || 0), 0);
    const pendingReqs = requisitions.filter(r => r.approval_status === 'Pending');
    const approvedReqs = requisitions.filter(r => r.approval_status === 'Approved' || r.approval_status === 'Issued');
    const movIn = ledger.filter(l => Number(l.quantity_in) > 0);
    const movOut = ledger.filter(l => Number(l.quantity_out) > 0);
    const consumptionRecords = ledger.filter(l => l.transaction_type === 'Consumption');
    switch (activeTab) {
      case 'par-management':
        return [
          { label: 'Total Items', value: String(totalItemsCount), caption: 'Spa items tracked', icon: Package, tone: 'info' as const },
          { label: 'With Par Level', value: String(rows.filter(r => Number(r.item.par_level) > 0).length), caption: 'Par level set', icon: Target, tone: 'success' as const },
          { label: 'With Reorder Point', value: String(rows.filter(r => Number(r.item.reorder_point) > 0).length), caption: 'Reorder configured', icon: Zap, tone: 'warning' as const },
          { label: 'Low Stock', value: String(lowStockItems), caption: `${criticalStockItems} critical`, icon: AlertTriangle, tone: 'danger' as const },
        ];
      case 'requisitions':
        return [
          { label: 'Total Requisitions', value: String(requisitions.length), caption: 'All time', icon: ClipboardCheck, tone: 'info' as const },
          { label: 'Pending', value: String(pendingReqs.length), caption: 'Awaiting approval', icon: Clock, tone: 'warning' as const },
          { label: 'Approved/Issued', value: String(approvedReqs.length), caption: 'Completed', icon: CheckCircle2, tone: 'success' as const },
          { label: 'Inventory Value', value: formatAmount(totalInventoryValue), caption: 'Current stock value', icon: DollarSign, tone: 'info' as const },
        ];
      case 'consumption':
        return [
          { label: 'Consumption Records', value: String(consumptionRecords.length), caption: 'Total entries', icon: BookOpen, tone: 'info' as const },
          { label: 'Total Consumed', value: String(consumptionRecords.reduce((s, l) => s + Number(l.actual_qty ?? l.quantity_out ?? 0), 0)), caption: 'Units consumed', icon: Package, tone: 'warning' as const },
          { label: 'Consumption Cost', value: formatAmount(consumptionRecords.reduce((s, l) => s + Number(l.value || 0), 0)), caption: 'Total cost', icon: DollarSign, tone: 'danger' as const },
          { label: 'Avg Variance', value: `${consumptionRecords.length > 0 ? (consumptionRecords.reduce((s, l) => s + (Number(l.actual_qty ?? l.quantity_out ?? 0) - Number(l.theoretical_qty ?? 0)), 0) / consumptionRecords.length).toFixed(1) : '0.0'}`, caption: 'Actual vs theoretical', icon: Activity, tone: 'success' as const },
        ];
      case 'waste':
        return [
          { label: 'Waste Records', value: String(wasteRecords.length), caption: 'Total entries', icon: AlertTriangle, tone: 'danger' as const },
          { label: 'Total Wasted', value: String(wasteQty), caption: 'Units lost', icon: Package, tone: 'warning' as const },
          { label: 'Waste Cost', value: formatAmount(wasteCost), caption: 'Total loss value', icon: DollarSign, tone: 'danger' as const },
          { label: 'Spoilage', value: String(wasteRecords.filter(w => w.waste_type === 'Spoilage').length), caption: 'Spoiled items', icon: AlertCircle, tone: 'warning' as const },
        ];
      case 'movements':
        return [
          { label: 'Ledger Entries', value: String(ledger.length), caption: 'All movements', icon: ArrowDownUp, tone: 'info' as const },
          { label: 'Stock In', value: String(movIn.reduce((s, l) => s + Number(l.quantity_in), 0)), caption: `${movIn.length} receipts/adjustments`, icon: ArrowUpFromLine, tone: 'success' as const },
          { label: 'Stock Out', value: String(movOut.reduce((s, l) => s + Number(l.quantity_out), 0)), caption: `${movOut.length} issues`, icon: Package, tone: 'warning' as const },
          { label: 'Adjustments', value: String(ledger.filter(l => l.transaction_type === 'Adjustment').length), caption: 'Manual adjustments', icon: Zap, tone: 'danger' as const },
        ];
      case 'stock-count':
        return [
          { label: 'Spa Stores', value: '1', caption: 'Spa & Wellness store', icon: Package, tone: 'info' as const },
          { label: 'Total Items', value: String(totalItemsCount), caption: 'Items to count', icon: ClipboardList, tone: 'success' as const },
          { label: 'Inventory Value', value: formatAmount(totalInventoryValue), caption: 'Stock at risk', icon: DollarSign, tone: 'warning' as const },
          { label: 'Low Stock', value: String(lowStockItems), caption: `${criticalStockItems} critical`, icon: AlertTriangle, tone: 'danger' as const },
        ];
      default:
        return [
          { label: 'Total Items', value: String(totalItemsCount), caption: `${lowStockItems} low · ${criticalStockItems} critical`, icon: Package, tone: 'info' as const },
          { label: 'Inventory Value', value: formatAmount(totalInventoryValue), caption: 'Current stock value', icon: DollarSign, tone: 'success' as const },
          { label: 'Low Stock', value: String(lowStockItems), caption: `${criticalStockItems} critical items`, icon: AlertTriangle, tone: 'warning' as const },
          { label: 'Critical', value: String(criticalStockItems), caption: 'Below minimum stock', icon: AlertCircle, tone: 'danger' as const },
        ];
    }
  }, [activeTab, rows, wasteRecords, requisitions, ledger, totalItemsCount, totalInventoryValue, lowStockItems, criticalStockItems, formatAmount]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <PageHeader
        title="Spa & Wellness Inventory"
        subtitle="Spa store inventory — stock, par levels, consumption, waste, transfers, and counts"
        icon={Package}
        actions={
          <div className="flex gap-2">
            {activeTab === 'inventory' && (
              <button onClick={openNew} className={btnPrimary}>
                <Plus size={14} className="inline-block mr-1" /> Add Spa Item
              </button>
            )}
            {activeTab === 'requisitions' && (
              <>
                <button onClick={() => setReplenishAutoTrigger(t => t + 1)} className={btnPrimary}>
                  <Zap size={14} className="inline-block mr-1" /> Auto-Replenish
                </button>
                <button onClick={() => setReqNewTrigger(t => t + 1)} className={btnPrimary}>
                  <Plus size={14} className="inline-block mr-1" /> New Requisition
                </button>
              </>
            )}
            {activeTab === 'par-management' && parView === 'dynamic' && (
              <>
                <button onClick={() => setParRecalculateTrigger(t => t + 1)} className={btnSecondary}>
                  <Activity size={14} className="inline-block mr-1" /> Recalculate
                </button>
                <button onClick={() => setParAutoReplenishTrigger(t => t + 1)} className={btnPrimary}>
                  <Zap size={14} className="inline-block mr-1" /> Auto-Replenish
                </button>
              </>
            )}
            {activeTab === 'stock-count' && (
              <button onClick={() => setCountNewTrigger(t => t + 1)} className={btnPrimary}>
                <Plus size={14} className="inline-block mr-1" /> New Count
              </button>
            )}
            {activeTab === 'waste' && (
              <button onClick={() => setWasteOpen(true)} className={btnPrimary}>
                <AlertTriangle size={14} className="inline-block mr-1" /> Record Spa Waste
              </button>
            )}
            {activeTab === 'consumption' && (
              <button onClick={() => { setConsumptionForm({ treatmentsCompleted: 1, entries: [] }); setShowConsumptionModal(true); }} className={btnPrimary}>
                <BookOpen size={14} className="inline-block mr-1" /> Record Spa Consumption
              </button>
            )}
          </div>
        }
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(stat => (
          <StatCard
            key={stat.label}
            title={stat.label}
            value={stat.value}
            caption={stat.caption}
            icon={stat.icon}
            tone={stat.tone as any}
          />
        ))}
      </div>

      {/* Critical stock alert */}
      {criticalStockItems > 0 && (
        <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
          <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
          <div className="flex-1 text-sm">
            <span className="font-medium text-red-700 dark:text-red-400">
              {criticalStockItems} item{criticalStockItems > 1 ? 's' : ''} at or below minimum stock
            </span>
          </div>
          <button
            onClick={() => setActiveTab('inventory')}
            className="text-sm px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex-shrink-0"
          >
            View Inventory
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-slate-700 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-[var(--color-accent-spa)] text-[var(--color-accent-spa)]'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
            {tabCounts[tab.id] !== undefined && tabCounts[tab.id]! > 0 && (
              <span className={`inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 text-xs font-medium rounded-full ${
                activeTab === tab.id
                  ? 'bg-[var(--color-accent-spa)]/10 text-[var(--color-accent-spa)]'
                  : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
              }`}>
                {tabCounts[tab.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Filter Bar */}
      {(activeTab === 'inventory' || activeTab === 'movements' || activeTab === 'waste') && (
        <div className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-gray-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={inputCls + ' w-48'}
            />
          </div>
          {activeTab === 'inventory' && (
            <>
              <div className="flex items-center gap-2">
                <label className="text-sm text-slate-600 dark:text-slate-400">Subcategory:</label>
                <select value={subcatFilter} onChange={e => setSubcatFilter(e.target.value)} className={inputCls}>
                  <option value="all">All Subcategories</option>
                  {SUBCATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-slate-600 dark:text-slate-400">Stock:</label>
                <select value={stockFilter} onChange={e => setStockFilter(e.target.value)} className={inputCls}>
                  <option value="all">All Stock</option>
                  <option value="normal">In Stock</option>
                  <option value="low">Low Stock</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            </>
          )}
          <button onClick={fetchData} className={btnSecondary} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      )}

      {loading && <div className="p-8 flex justify-center"><Loader2 size={20} className="animate-spin text-gray-400" /></div>}
      {error && !loading && (
        <div className="p-8 text-center text-sm text-red-500">
          <ServerCrash className="w-5 h-5 mx-auto mb-2" />
          {error}
        </div>
      )}

      {/* Inventory Tab */}
      {activeTab === 'inventory' && (
        <SectionCard title="Spa & Wellness Inventory Listing" subtitle="All spa store items by subcategory — par levels, stock status, and valuation.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Subcategory</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">Stock Level</th>
                  <th className="px-4 py-3 font-medium">Qty</th>
                  <th className="px-4 py-3 font-medium">Par</th>
                  <th className="px-4 py-3 font-medium">Unit</th>
                  <th className="px-4 py-3 font-medium">Unit Cost</th>
                  <th className="px-4 py-3 font-medium">Stock Value</th>
                  <th className="px-4 py-3 font-medium">Brand</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {filteredRows.map(r => {
                  const isCritical = r.item.min_stock > 0 && r.onHand <= r.item.min_stock;
                  const isLow = !isCritical && r.item.reorder_point > 0 && r.onHand <= r.item.reorder_point;
                  const stockStatus = isCritical ? 'critical' : isLow ? 'low' : 'normal';
                  const stockValue = r.onHand * r.unitCost;
                  const maxRef = r.item.max_stock || (r.item.reorder_point > 0 ? r.item.reorder_point * 3 : 100);
                  const stockPct = Math.min(100, Math.max(0, (r.onHand / maxRef) * 100));
                  return (
                    <tr key={r.item.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{r.item.item_name}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{r.item.subcategory || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{r.location || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="w-24">
                          <div className="h-2 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                stockStatus === 'critical' ? 'bg-red-500'
                                : stockStatus === 'low' ? 'bg-amber-500'
                                : 'bg-green-500'
                              }`}
                              style={{ width: `${stockPct}%` }}
                            />
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            min: {r.item.min_stock} · reorder: {r.item.reorder_point}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`font-medium ${stockStatus === 'critical' ? 'text-red-600' : stockStatus === 'low' ? 'text-amber-600' : 'text-slate-900 dark:text-white'}`}>
                          {r.onHand}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-medium text-[var(--color-accent-spa)]">{r.item.par_level ?? '—'}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{r.item.unit_of_measure}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{formatAmount(r.unitCost)}</td>
                      <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-300">{formatAmount(stockValue)}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{r.item.brand || '—'}</td>
                      <td className="px-4 py-3">
                        <Badge tone={stockStatus === 'critical' ? 'danger' : stockStatus === 'low' ? 'warning' : 'success'}>
                          {stockStatus}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openEdit(r.item)}
                            className="p-1 text-slate-400 hover:text-[var(--color-accent-spa)] transition-colors"
                            title="Edit"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => { setAdjustRow(r); setAdjustQty(''); setAdjustReason(''); }}
                            className="p-1 text-slate-400 hover:text-[var(--color-accent-spa)] transition-colors"
                            title="Adjust stock"
                          >
                            <ArrowUpFromLine className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => removeItem(r.item)}
                            className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {filteredRows.length > 0 && (
                <tfoot className="bg-slate-50 dark:bg-slate-900/40 border-t-2 border-slate-300 dark:border-slate-500">
                  <tr>
                    <td colSpan={8} className="px-4 py-3 text-right text-slate-600 dark:text-slate-400 font-medium">
                      {filteredRows.length} items — Total Stock Value:
                    </td>
                    <td className="px-4 py-3 font-bold text-[var(--color-accent-spa)]">{formatAmount(filteredRows.reduce((s, r) => s + r.onHand * r.unitCost, 0))}</td>
                    <td colSpan={3}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {!loading && !error && filteredRows.length === 0 && (
            <div className="p-8 text-center text-sm text-gray-500">No inventory items match the filters.</div>
          )}
        </SectionCard>
      )}

      {/* Par Management Tab — merged Dynamic Par + Manual Overrides */}
      {activeTab === 'par-management' && !loading && !error && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 p-1 bg-slate-100 dark:bg-slate-900/40 rounded-xl w-fit">
            <button
              onClick={() => setParView('dynamic')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${parView === 'dynamic' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
            >
              <Activity size={14} className="inline-block mr-1.5" /> Dynamic Par
            </button>
            <button
              onClick={() => setParView('overrides')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${parView === 'overrides' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
            >
              <Zap size={14} className="inline-block mr-1.5" /> Manual Overrides
            </button>
          </div>
          {parView === 'dynamic' && <DepartmentDynamicParPanel department={DEPARTMENT} hideStats hideHeader refreshTrigger={parRefreshTrigger} recalculateTrigger={parRecalculateTrigger} autoReplenishTrigger={parAutoReplenishTrigger} />}
          {parView === 'overrides' && <DepartmentParOverridesPanel department={DEPARTMENT} hideHeader />}
        </div>
      )}

      {/* Replenishment & Requisition Tab — spa-scoped replenishment + requisitions */}
      {activeTab === 'requisitions' && (
        <div className="space-y-6">
          <DepartmentReplenishmentPanel department={DEPARTMENT} hideStats hideHeader refreshTrigger={replenishRefreshTrigger} autoReplenishTrigger={replenishAutoTrigger} />
          <DepartmentRequisitionForm department={DEPARTMENT} hideStats hideHeader refreshTrigger={reqRefreshTrigger} newRequisitionTrigger={reqNewTrigger} />
        </div>
      )}

      {/* Consumption Tab */}
      {activeTab === 'consumption' && (
        <SectionCard title="Spa Consumption Tracking" subtitle="Theoretical (par × treatments completed) vs Actual consumption for spa items">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Item</th>
                  <th className="px-4 py-3 font-medium">Theoretical</th>
                  <th className="px-4 py-3 font-medium">Actual</th>
                  <th className="px-4 py-3 font-medium">Variance</th>
                  <th className="px-4 py-3 font-medium">Cost</th>
                  <th className="px-4 py-3 font-medium">Performed By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {(() => {
                  const consumptionRecords = ledger.filter(l => l.transaction_type === 'Consumption');
                  if (consumptionRecords.length === 0) {
                    return <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">No consumption records yet. Use "Record Spa Consumption" to log actual consumption.</td></tr>;
                  }
                  return consumptionRecords.map(l => {
                    const theoretical = Number(l.theoretical_qty ?? 0);
                    const actual = Number(l.actual_qty ?? l.quantity_out ?? 0);
                    const unit = l.item?.unit_of_measure || '';
                    const variance = actual - theoretical;
                    const variancePct = theoretical > 0 ? (variance / theoretical) * 100 : null;
                    return (
                      <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{l.transaction_date ? String(l.transaction_date).slice(0, 10) : '—'}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{l.item?.item_name || l.item_id}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{l.theoretical_qty != null ? `${theoretical} ${unit}` : '—'}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{actual} {unit}</td>
                        <td className="px-4 py-3">
                          {l.theoretical_qty != null ? (
                            <Badge tone={variance === 0 ? 'success' : variance < 0 ? 'danger' : 'warning'}>
                              {variance > 0 ? '+' : ''}{variance.toFixed(2)} {unit}
                              {variancePct !== null ? ` (${variancePct.toFixed(1)}%)` : ''}
                            </Badge>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{formatAmount(Number(l.value || 0))}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{l.performed_by || '—'}</td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* Waste Tab */}
      {activeTab === 'waste' && (
        <SectionCard title="Spa & Wellness Waste & Loss Tracking" subtitle="Spoilage, damaged, expired, lost and contaminated stock for the spa store">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Waste #</th>
                  <th className="px-4 py-3 font-medium">Item</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Quantity</th>
                  <th className="px-4 py-3 font-medium">Reason</th>
                  <th className="px-4 py-3 font-medium">Cost</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {wasteRecords.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">No waste records yet.</td></tr>
                ) : wasteRecords.map(w => (
                  <tr key={w.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{w.created_at ? String(w.created_at).slice(0, 10) : '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{w.waste_number}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{w.item?.item_name || w.item_id}</td>
                    <td className="px-4 py-3">
                      <Badge tone={w.waste_type === 'Damaged' || w.waste_type === 'Lost' ? 'danger' : w.waste_type === 'Expired' || w.waste_type === 'Spoilage' ? 'warning' : 'neutral'}>
                        {w.waste_type}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{w.quantity}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{w.reason || '—'}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{formatAmount(w.total_cost)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={w.status === 'Approved' ? 'success' : w.status === 'Rejected' ? 'danger' : 'neutral'}>{w.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* Transfers Tab */}
      {activeTab === 'transfers' && (
        <InterDepartmentTransferPanel sourceDepartment={DEPARTMENT} />
      )}

      {/* Stock Movements Tab */}
      {activeTab === 'movements' && (
        <SectionCard title="Spa & Wellness Stock Movements" subtitle="Receipts, adjustments, counts and issues for the spa store">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Item</th>
                  <th className="px-4 py-3 font-medium">In</th>
                  <th className="px-4 py-3 font-medium">Out</th>
                  <th className="px-4 py-3 font-medium">Balance</th>
                  <th className="px-4 py-3 font-medium">Cost</th>
                  <th className="px-4 py-3 font-medium">Reason</th>
                  <th className="px-4 py-3 font-medium">Performed By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {ledger.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500">No stock movements recorded yet.</td></tr>
                ) : ledger.map(l => (
                  <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{l.transaction_date ? String(l.transaction_date).slice(0, 10) : '—'}</td>
                    <td className="px-4 py-3">
                      <Badge tone={Number(l.quantity_in) > 0 ? 'success' : Number(l.quantity_out) > 0 ? 'warning' : 'info'}>
                        {l.transaction_type.replace(/_/g, ' ')}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{l.item?.item_name || l.item_id}</td>
                    <td className="px-4 py-3 text-emerald-600 font-medium">{Number(l.quantity_in) > 0 ? `+${l.quantity_in}` : '—'}</td>
                    <td className="px-4 py-3 text-rose-600 font-medium">{Number(l.quantity_out) > 0 ? `-${l.quantity_out}` : '—'}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{l.balance}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{formatAmount(l.value)}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400 max-w-[220px] truncate">{l.reason || l.reference || '—'}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{l.performed_by || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* Stock Count Tab — unified uinv_counts system */}
      {activeTab === 'stock-count' && (
        <StockCountsModule
          storeFilter={[SPA_STORE_ID]}
          title="Spa & Wellness Stock Counts"
          subtitle="Physical, cycle, and spot count workflows for the spa store — full lifecycle: Draft → In Progress → Reconciled → Approved."
          hideStats
          hideHeader
          refreshTrigger={countRefreshTrigger}
          newCountTrigger={countNewTrigger}
        />
      )}

      {/* ── Item create/edit modal ── */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        onConfirm={saveItem}
        title={editing ? `Edit ${editing.item_name}` : 'New Spa Inventory Item'}
        subtitle="Spa & Wellness store item"
        variant="form"
        size="lg"
        loading={saving}
        confirmLabel={editing ? 'Save Changes' : 'Create Item'}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Item Code *">
            <input className={inputCls + ' w-full'} value={form.item_code || ''} onChange={e => setForm(f => ({ ...f, item_code: e.target.value }))} />
          </Field>
          <Field label="Item Name *">
            <input className={inputCls + ' w-full'} value={form.item_name || ''} onChange={e => setForm(f => ({ ...f, item_name: e.target.value }))} />
          </Field>
          <Field label="Subcategory">
            <select className={inputCls + ' w-full'} value={form.subcategory || ''} onChange={e => setForm(f => ({ ...f, subcategory: e.target.value }))}>
              {SUBCATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Unit of Measure">
            <select className={inputCls + ' w-full'} value={form.unit_of_measure || 'pcs'} onChange={e => setForm(f => ({ ...f, unit_of_measure: e.target.value }))}>
              {UOMS.map(u => <option key={u}>{u}</option>)}
            </select>
          </Field>
          <Field label="Brand">
            <input className={inputCls + ' w-full'} value={form.brand || ''} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} />
          </Field>
          <Field label="Unit Cost ($)">
            <input type="number" min={0} step="0.01" className={inputCls + ' w-full'} value={form.last_cost ?? 0} onChange={e => setForm(f => ({ ...f, last_cost: Number(e.target.value), standard_cost: Number(e.target.value), avg_cost: Number(e.target.value) }))} />
          </Field>
          <Field label="Min Stock">
            <input type="number" min={0} className={inputCls + ' w-full'} value={form.min_stock ?? 0} onChange={e => setForm(f => ({ ...f, min_stock: Number(e.target.value) }))} />
          </Field>
          <Field label="Reorder Point">
            <input type="number" min={0} className={inputCls + ' w-full'} value={form.reorder_point ?? 0} onChange={e => setForm(f => ({ ...f, reorder_point: Number(e.target.value) }))} />
          </Field>
          <Field label="Par Level">
            <input type="number" min={0} className={inputCls + ' w-full'} value={form.par_level ?? 0} onChange={e => setForm(f => ({ ...f, par_level: Number(e.target.value) }))} />
          </Field>
          <Field label="Max Stock">
            <input type="number" min={0} className={inputCls + ' w-full'} value={form.max_stock ?? ''} onChange={e => setForm(f => ({ ...f, max_stock: e.target.value === '' ? null : Number(e.target.value) }))} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 md:col-span-2">
            <input type="checkbox" checked={!!form.expiry_controlled} onChange={e => setForm(f => ({ ...f, expiry_controlled: e.target.checked }))} className="rounded" />
            Expiry-controlled item (lot expiry tracking)
          </label>
        </div>
      </ModalSystem>

      {/* ── Adjust stock modal ── */}
      <ModalSystem
        isOpen={!!adjustRow}
        onClose={() => setAdjustRow(null)}
        onConfirm={submitAdjust}
        title={`Adjust Stock — ${adjustRow?.item.item_name || ''}`}
        subtitle={`On hand: ${adjustRow?.onHand ?? 0} ${adjustRow?.item.unit_of_measure || ''}`}
        variant="form"
        size="sm"
        loading={saving}
        confirmLabel="Apply Adjustment"
      >
        <div className="space-y-4">
          <Field label="Quantity Delta (+/-)">
            <input type="number" className={inputCls + ' w-full'} value={adjustQty} onChange={e => setAdjustQty(e.target.value)} placeholder="e.g. 10 or -3" />
          </Field>
          <Field label="Reason">
            <input className={inputCls + ' w-full'} value={adjustReason} onChange={e => setAdjustReason(e.target.value)} placeholder="e.g. Stock count correction" />
          </Field>
        </div>
      </ModalSystem>

      {/* ── Waste modal ── */}
      <ModalSystem
        isOpen={wasteOpen}
        onClose={() => setWasteOpen(false)}
        onConfirm={submitWaste}
        title="Record Spa Waste"
        subtitle="Spa & Wellness store"
        variant="form"
        size="sm"
        loading={saving}
        confirmLabel="Record Waste"
      >
        <div className="space-y-4">
          <Field label="Item *">
            <select className={inputCls + ' w-full'} value={wasteForm.itemId} onChange={e => setWasteForm(f => ({ ...f, itemId: e.target.value }))}>
              <option value="">Select item…</option>
              {rows.filter(r => r.onHand > 0).map(r => (
                <option key={r.item.id} value={r.item.id}>{r.item.item_name} ({r.onHand} {r.item.unit_of_measure})</option>
              ))}
            </select>
          </Field>
          <Field label="Waste Type">
            <select className={inputCls + ' w-full'} value={wasteForm.wasteType} onChange={e => setWasteForm(f => ({ ...f, wasteType: e.target.value }))}>
              {WASTE_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Quantity *">
            <input type="number" min={1} className={inputCls + ' w-full'} value={wasteForm.quantity} onChange={e => setWasteForm(f => ({ ...f, quantity: e.target.value }))} />
          </Field>
          <Field label="Reason">
            <input className={inputCls + ' w-full'} value={wasteForm.reason} onChange={e => setWasteForm(f => ({ ...f, reason: e.target.value }))} />
          </Field>
        </div>
      </ModalSystem>

      {/* ── Consumption modal (HK-style: theoretical vs actual) ── */}
      <ModalSystem
        isOpen={showConsumptionModal}
        onClose={() => setShowConsumptionModal(false)}
        onConfirm={submitConsumption}
        title="Record Spa Consumption"
        subtitle="Log actual counted usage against theoretical par consumption"
        variant="form"
        size="xl"
        loading={saving}
        confirmLabel="Record Consumption"
      >
        <div className="space-y-4">
          <Field label="Treatments Completed">
            <input
              type="number"
              min={1}
              className={inputCls + ' w-full'}
              value={consumptionForm.treatmentsCompleted}
              onChange={e => setConsumptionForm({ ...consumptionForm, treatmentsCompleted: Number(e.target.value) })}
            />
          </Field>

          {consumptionForm.entries.length > 0 && (
            <div className="border border-slate-200 dark:border-slate-600 rounded-lg overflow-hidden">
              <div className="bg-slate-50 dark:bg-slate-900/40 px-4 py-2 text-xs uppercase text-slate-500 font-medium">
                Consumption Breakdown — Theoretical (par × treatments), enter actual counted usage
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Item</th>
                    <th className="px-4 py-2 font-medium">Theoretical (par × treatments)</th>
                    <th className="px-4 py-2 font-medium">Actual (counted)</th>
                    <th className="px-4 py-2 font-medium">Variance</th>
                    <th className="px-4 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {consumptionForm.entries.map((e, idx) => {
                    const row = rows.find(r => r.item.id === e.itemId);
                    const item = row?.item;
                    const theoretical = Number(item?.min_stock || 0) * consumptionForm.treatmentsCompleted;
                    const variance = e.actualQty - theoretical;
                    const varianceClass = Math.abs(variance) < 0.001 ? 'text-slate-400' : variance < 0 ? 'text-red-600' : 'text-green-600';
                    return (
                      <tr key={e.itemId}>
                        <td className="px-4 py-2 text-slate-700 dark:text-slate-300">{item?.item_name || 'Unknown'}</td>
                        <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{theoretical} {item?.unit_of_measure || ''}</td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            step="0.001"
                            value={e.actualQty}
                            onChange={e2 => {
                              const newEntries = [...consumptionForm.entries];
                              newEntries[idx].actualQty = Number(e2.target.value);
                              setConsumptionForm({ ...consumptionForm, entries: newEntries });
                            }}
                            className="w-24 px-2 py-1 border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
                          />
                          <span className="ml-1 text-xs text-slate-400">{item?.unit_of_measure || ''}</span>
                        </td>
                        <td className={`px-4 py-2 ${varianceClass}`}>
                          {Math.abs(variance) < 0.001 ? '—' : `${variance > 0 ? '+' : ''}${variance.toFixed(3)} ${item?.unit_of_measure || ''}`}
                        </td>
                        <td className="px-4 py-2">
                          <button
                            onClick={() => setConsumptionForm({ ...consumptionForm, entries: consumptionForm.entries.filter((_, i) => i !== idx) })}
                            className="p-1 text-slate-400 hover:text-red-600"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Add Items</span>
              <span className="text-xs text-slate-500">Click items to add to consumption</span>
            </div>
            <input
              type="text"
              value={consumptionSearch}
              onChange={e => setConsumptionSearch(e.target.value)}
              placeholder="Search items..."
              className={inputCls + ' w-full mb-2'}
            />
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {rows
                .filter(r => {
                  const s = consumptionSearch.toLowerCase();
                  if (!s) return true;
                  return r.item.item_name.toLowerCase().includes(s) || (r.item.subcategory || '').toLowerCase().includes(s);
                })
                .map(r => {
                  const added = consumptionForm.entries.find(e => e.itemId === r.item.id);
                  return (
                    <button
                      key={r.item.id}
                      onClick={() => {
                        if (!added) {
                          setConsumptionForm({ ...consumptionForm, entries: [...consumptionForm.entries, { itemId: r.item.id, actualQty: 0 }] });
                        }
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm flex justify-between ${added ? 'bg-slate-200 dark:bg-slate-700 cursor-default' : 'bg-slate-50 dark:bg-slate-900/40 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                    >
                      <span>{r.item.item_name}</span>
                      <span className="text-slate-400">{r.item.min_stock} par · {r.onHand} on hand</span>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      </ModalSystem>
    </div>
  );
}
