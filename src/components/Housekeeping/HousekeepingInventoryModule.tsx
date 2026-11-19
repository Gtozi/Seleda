/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Full Housekeeping Inventory module with 8 tabs.
 * Uses the shared inventory_items + inventory_transactions ledger (property-scoped).
 * Tabs: Inventory, Requisitions, Consumption, Waste, Transfers, Stock Movements,
 * Stock Count, Variance Analysis.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Package,
  Plus,
  Search,
  RefreshCw,
  Loader2,
  ServerCrash,
  Pencil,
  Trash2,
  ArrowDownToLine,
  ArrowUpFromLine,
  AlertTriangle,
  X,
  History,
  ShoppingCart,
  Ban,
  BookOpen,
  ClipboardList,
  ClipboardCheck,
  BarChart3,
  ArrowDownUp,
  Truck,
  AlertCircle,
  DollarSign,
  Activity,
  Zap,
  Layers,
  Target,
  Clock,
  CheckCircle2,
  ArrowRightLeft,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { useERP } from '../../context/ERPContext';
import DepartmentRequisitionForm from '../Inventory/DepartmentRequisitionForm';
import DepartmentDynamicParPanel from '../Inventory/DepartmentDynamicParPanel';
import DepartmentParOverridesPanel from '../Inventory/DepartmentParOverridesPanel';
import InterDepartmentTransferPanel from '../Inventory/InterDepartmentTransferPanel';
import DepartmentReplenishmentPanel from '../Inventory/DepartmentReplenishmentPanel';
import StockCountsModule from '../Inventory/StockCountsModule';
import { createIssue } from '../../services/inventoryService';

const CATEGORIES: { id: string; label: string }[] = [
  { id: 'cleaning_supplies', label: 'Cleaning Supplies' },
  { id: 'linens', label: 'Linens' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'amenities', label: 'Amenities' },
  { id: 'other', label: 'Other' },
];

interface InventoryItem {
  id: string;
  name: string;
  category: string;
  categoryCode: string;
  categoryLabel: string;
  currentQuantity: number;
  minimumQuantity: number;
  maximumStock: number | null;
  unitOfMeasure: string;
  reorderPoint: number;
  reorderQuantity: number;
  parLevel: number;
  lastRestocked: string | null;
  supplier: string;
  costPerUnit: number;
  location: string;
  propertyId: string | null;
  updatedAt: string;
  // Linen extended data
  isLinen?: boolean;
  linenInUse?: number;
  linenAtLaundry?: number;
  linenDamaged?: number;
  linenLost?: number;
  linenType?: string | null;
}

interface Transaction {
  id: string;
  propertyId: string | null;
  itemId: string;
  itemName: string;
  transactionType: string;
  quantity: number;
  unit: string;
  unitCost: number;
  totalCost: number;
  reason: string;
  performedBy: string;
  transactionDate: string;
  createdAt: string;
  theoreticalQty: number;
  actualQty: number;
  varianceQty: number;
  wasteType: string | null;
  referenceNumber: string | null;
}

interface MainStoreItem {
  id: string;
  name: string;
  currentQuantity: number;
  unitOfMeasure: string;
  unitCost: number;
}

interface RequisitionLine {
  id: string;
  itemId: string;
  itemName: string;
  requestedQuantity: number;
  approvedQuantity: number | null;
  unit: string;
  unitCost: number;
  reason: string;
}

interface Requisition {
  id: string;
  number: string;
  requestedBy: string;
  requestDate: string;
  fromLocation: string;
  toLocation: string;
  status: string;
  totalCost: number;
  notes: string;
  items: RequisitionLine[];
}

interface InventoryData {
  propertyId: string;
  items: InventoryItem[];
  summary: {
    total: number;
    totalValue: number;
    lowStock: number;
    critical: number;
  };
  lowStock: InventoryItem[];
  critical: InventoryItem[];
  generatedAt: string;
}

interface VarianceRecord {
  id: string;
  date: string;
  itemId: string;
  itemName: string;
  category: string;
  theoreticalQty: number;
  actualQty: number;
  varianceQty: number;
  variancePercent: number;
  unit: string;
  cost: number;
  transactionType: string;
}

type TabKey = 'inventory' | 'requisitions' | 'consumption' | 'waste' | 'transfers' | 'movements' | 'stock-count' | 'variance' | 'par-management' | 'inter-dept-transfer';

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

export default function HousekeepingInventoryModule() {
  const { currentPropertyId, addNotification, formatAmount } = useERP();
  const [data, setData] = useState<InventoryData | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [varianceData, setVarianceData] = useState<{
    records: VarianceRecord[];
    aggregated: Array<{
      itemId: string;
      itemName: string;
      category: string;
      theoretical: number;
      actual: number;
      varianceQty: number;
      variancePercent: number | null;
      unit: string;
      records: number;
      severity: 'high' | 'medium' | 'low' | 'na';
    }>;
    summary: { high: number; medium: number; low: number; na: number; total: number };
  }>({ records: [], aggregated: [], summary: { high: 0, medium: 0, low: 0, na: 0, total: 0 } });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('inventory');
  const [parView, setParView] = useState<'dynamic' | 'overrides'>('dynamic');
  // External action triggers for embedded components
  const [replenishRefreshTrigger, setReplenishRefreshTrigger] = useState(0);
  const [replenishAutoTrigger, setReplenishAutoTrigger] = useState(0);
  const [reqRefreshTrigger, setReqRefreshTrigger] = useState(0);
  const [reqNewTrigger, setReqNewTrigger] = useState(0);
  const [parRefreshTrigger, setParRefreshTrigger] = useState(0);
  const [parRecalculateTrigger, setParRecalculateTrigger] = useState(0);
  const [parAutoReplenishTrigger, setParAutoReplenishTrigger] = useState(0);
  const [countRefreshTrigger, setCountRefreshTrigger] = useState(0);
  const [countNewTrigger, setCountNewTrigger] = useState(0);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [itemTypeFilter, setItemTypeFilter] = useState<string>('all');
  const [storageFilter, setStorageFilter] = useState<string>('all');
  const [locationFilter, setLocationFilter] = useState<string>('all');

  // Requisition state
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [showReqForm, setShowReqForm] = useState(false);
  const [mainStoreItems, setMainStoreItems] = useState<MainStoreItem[]>([]);
  const [mainStoreSearch, setMainStoreSearch] = useState('');
  const [reqItems, setReqItems] = useState<{ itemId: string; itemName: string; quantity: number; unit: string; unitCost: number }[]>([]);
  const [reqNotes, setReqNotes] = useState('');
  const [reqRequestedBy, setReqRequestedBy] = useState('');

  // Inventory item form state
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState<Partial<InventoryItem>>({});

  // Adjust stock state
  const [adjustItem, setAdjustItem] = useState<InventoryItem | null>(null);
  const [adjustQty, setAdjustQty] = useState<string>('');
  const [adjustNotes, setAdjustNotes] = useState<string>('');

  // Linen operations modal state
  const [linenOpItem, setLinenOpItem] = useState<InventoryItem | null>(null);
  const [linenOpForm, setLinenOpForm] = useState({
    operation: 'Issue Linen' as 'Issue Linen' | 'Return Linen' | 'Damaged Linen' | 'Lost Linen' | 'Linen Count',
    type: '',
    quantity: '',
    location: '',
    staff: '',
    notes: '',
  });
  const [linenOpSubmitting, setLinenOpSubmitting] = useState(false);

  // Consumption form state
  const [showConsumptionModal, setShowConsumptionModal] = useState(false);
  const [consumptionSearch, setConsumptionSearch] = useState('');
  const [consumptionForm, setConsumptionForm] = useState({
    roomsCleaned: 1,
    entries: [] as { itemId: string; actualQty: number }[],
  });

  // Waste form state
  const [showWasteModal, setShowWasteModal] = useState(false);
  const [wasteSearch, setWasteSearch] = useState('');
  const [wasteForm, setWasteForm] = useState({
    itemId: '',
    wasteType: 'damaged' as const,
    quantity: 0,
    reason: '',
  });

  // Transfer form state
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferSearch, setTransferSearch] = useState('');
  const [locations, setLocations] = useState<Array<{ id: string; locationName: string; locationType: string }>>([]);
  const [customToLocation, setCustomToLocation] = useState(false);
  const [transferForm, setTransferForm] = useState({
    itemId: '',
    fromLocation: 'Main HK Store',
    toLocation: 'Floor 1 Linen Closet',
    toLocationId: '',
    quantity: 0,
    reason: '',
  });

  // Stock count is now handled by the embedded StockCountsModule (uinv_counts system)

  const fetchData = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoading(true);
    setError(null);
    try {
      const [invRes, trRes, reqRes] = await Promise.all([
        fetch(`/api/hk-portal/inventory/central/${currentPropertyId}`, { headers: authHeaders() }),
        fetch(`/api/hk-portal/inventory/central/${currentPropertyId}/transfers`, { headers: authHeaders() }),
        fetch(`/api/hk-portal/inventory/requisitions/${currentPropertyId}`, { headers: authHeaders() }),
      ]);
      if (!invRes.ok) throw new Error(`Failed to load inventory (${invRes.status})`);
      const invJson = (await invRes.json()) as InventoryData;
      setData(invJson);
      if (trRes.ok) {
        const trJson = await trRes.json();
        setTransactions(trJson.transfers || []);
      }
      if (reqRes.ok) {
        const reqJson = await reqRes.json();
        setRequisitions(reqJson.requisitions || []);
      }
      // Fetch HK and property secondary locations
      try {
        const locRes = await fetch(`/api/hk-portal/inventory/locations/${currentPropertyId}`, { headers: authHeaders() });
        if (locRes.ok) {
          const locJson = await locRes.json();
          if (Array.isArray(locJson)) setLocations(locJson);
        }
      } catch {
        // Fallback defaults will be used
      }
      // Fetch variance data
      try {
        const varRes = await fetch(`/api/hk-portal/inventory/variance/${currentPropertyId}`, { headers: authHeaders() });
        if (varRes.ok) {
          const varJson = await varRes.json();
          setVarianceData(varJson || { records: [], aggregated: [], summary: { high: 0, medium: 0, low: 0, na: 0, total: 0 } });
        }
      } catch {
        // Variance may not exist yet
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load inventory');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filteredItems = useMemo(() => {
    if (!data) return [];
    return data.items.filter(item => {
      const s = search.toLowerCase();
      const matchesSearch =
        !s ||
        item.name.toLowerCase().includes(s) ||
        item.supplier.toLowerCase().includes(s) ||
        item.unitOfMeasure.toLowerCase().includes(s);
      const matchesCat = catFilter === 'all' || item.category === catFilter || item.categoryLabel === catFilter;
      const matchesType = typeFilter === 'all' || (typeFilter === 'linen' && item.isLinen) || (typeFilter === 'regular' && !item.isLinen);
      const matchesItemType = itemTypeFilter === 'all' || (itemTypeFilter === 'consumable' && !item.isLinen) || (itemTypeFilter === 'non-consumable' && item.isLinen);
      const matchesStorage = storageFilter === 'all' || (storageFilter === 'perishable' && item.categoryLabel === 'Cleaning Supplies') || (storageFilter === 'non-perishable' && item.categoryLabel !== 'Cleaning Supplies');
      const matchesLocation = locationFilter === 'all' || (item.location || '') === locationFilter;
      return matchesSearch && matchesCat && matchesType && matchesItemType && matchesStorage && matchesLocation;
    });
  }, [data, catFilter, search, typeFilter, itemTypeFilter, storageFilter, locationFilter]);

  const openNew = () => {
    setEditing(null);
    setForm({
      category: 'cleaning_supplies',
      currentQuantity: 0,
      minimumQuantity: 10,
      reorderPoint: 10,
      reorderQuantity: 50,
      parLevel: 20,
      costPerUnit: 0,
      unitOfMeasure: 'PCS',
    });
    setShowForm(true);
  };

  const openEdit = (item: InventoryItem) => {
    setEditing(item);
    setForm({ ...item });
    setShowForm(true);
  };

  const saveItem = async () => {
    if (!currentPropertyId || !form.name || !form.category) return;
    const payload = { ...form, propertyId: currentPropertyId };
    const url = editing ? `/api/hk-portal/inventory/central/${editing.id}` : '/api/hk-portal/inventory/central';
    const method = editing ? 'PUT' : 'POST';
    try {
      const res = await fetch(url, { method, headers: authHeaders(true), body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(`Failed to save item (${res.status})`);
      addNotification(editing ? 'Inventory item updated.' : 'Inventory item created.', 'success', 'Housekeeping');
      setShowForm(false);
      fetchData();
    } catch (e: any) {
      addNotification(e.message, 'warning', 'Housekeeping');
    }
  };

  const deleteItem = async (id: string) => {
    if (!confirm('Delete this inventory item?')) return;
    try {
      const res = await fetch(`/api/hk-portal/inventory/central/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to delete item (${res.status})`);
      addNotification('Inventory item deleted.', 'success', 'Housekeeping');
      fetchData();
    } catch (e: any) {
      addNotification(e.message, 'warning', 'Housekeeping');
    }
  };

  const submitAdjust = async () => {
    if (!adjustItem) return;
    const qty = Number(adjustQty);
    if (!Number.isFinite(qty) || qty === 0) {
      addNotification('Adjustment must be a non-zero number.', 'warning', 'Housekeeping');
      return;
    }
    try {
      const res = await fetch(`/api/hk-portal/inventory/central/${adjustItem.id}/adjust`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ delta: qty, notes: adjustNotes }),
      });
      if (!res.ok) throw new Error(`Adjustment failed (${res.status})`);
      addNotification(`Stock adjusted by ${qty}.`, 'success', 'Housekeeping');
      setAdjustItem(null);
      setAdjustQty('');
      setAdjustNotes('');
      fetchData();
    } catch (e: any) {
      addNotification(e.message, 'warning', 'Housekeeping');
    }
  };

  const handleNumber = (key: keyof InventoryItem, v: string) => {
    setForm(prev => ({ ...prev, [key]: Number(v) || 0 } as Partial<InventoryItem>));
  };

  // ── Linen operation handler ───────────────────────────────────────────
  const submitLinenOp = async () => {
    if (!linenOpItem || !currentPropertyId) return;
    const qty = Number(linenOpForm.quantity);
    if (!Number.isFinite(qty) || qty < 0) {
      addNotification('Quantity must be a non-negative number.', 'warning', 'Housekeeping');
      return;
    }
    setLinenOpSubmitting(true);
    try {
      const res = await fetch('/api/hk-portal/linen/operation', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          propertyId: currentPropertyId,
          operation: linenOpForm.operation,
          type: linenOpForm.type,
          quantity: qty,
          location: linenOpForm.location || undefined,
          staff: linenOpForm.staff || undefined,
          notes: linenOpForm.notes || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Linen operation failed (${res.status})`);
      }
      const json = await res.json();
      addNotification(
        `${linenOpForm.operation} — ${qty} ${linenOpItem.unitOfMeasure}${json.inventoryWarning ? ` ⚠ ${json.inventoryWarning}` : ''}`,
        json.inventoryWarning ? 'warning' : 'success',
        'Housekeeping',
      );
      setLinenOpItem(null);
      fetchData();
    } catch (e: any) {
      addNotification(e.message, 'warning', 'Housekeeping');
    } finally {
      setLinenOpSubmitting(false);
    }
  };

  // ── Requisition handlers ──────────────────────────────────────────────
  const openReqForm = async () => {
    setShowReqForm(true);
    setReqItems([]);
    setReqNotes('');
    setReqRequestedBy('');
    setMainStoreSearch('');
    try {
      const res = await fetch('/api/hk-portal/inventory/main-store-items', { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setMainStoreItems(json.items || []);
      }
    } catch { /* ignore */ }
  };

  const addReqItem = (item: MainStoreItem) => {
    setReqItems(prev => {
      if (prev.some(r => r.itemId === item.id)) return prev;
      return [...prev, { itemId: item.id, itemName: item.name, quantity: 1, unit: item.unitOfMeasure, unitCost: item.unitCost }];
    });
  };

  const removeReqItem = (itemId: string) => {
    setReqItems(prev => prev.filter(r => r.itemId !== itemId));
  };

  const updateReqQty = (itemId: string, qty: number) => {
    setReqItems(prev => prev.map(r => (r.itemId === itemId ? { ...r, quantity: Math.max(1, qty) } : r)));
  };

  const submitRequisition = async () => {
    if (!currentPropertyId || !reqRequestedBy || reqItems.length === 0) {
      addNotification('Requested by and at least one item are required.', 'warning', 'Housekeeping');
      return;
    }
    try {
      await createIssue({
        property_id: currentPropertyId,
        department: 'Housekeeping',
        requester: reqRequestedBy,
        store_id: null,
        priority: 'Normal',
        purpose: 'Requisition to Main Store',
        notes: reqNotes || undefined,
        lines: reqItems.map(r => ({
          itemId: r.itemId,
          itemName: r.itemName,
          requestedQty: r.quantity,
          approvedQty: 0,
          issuedQty: 0,
          unit: r.unit,
          unitCost: r.unitCost,
        })),
        approval_status: 'Pending',
        source: 'Requisition',
      });
      addNotification('Requisition sent to Inventory for approval.', 'success', 'Housekeeping');
      setShowReqForm(false);
      setReqItems([]);
      setReqNotes('');
      setReqRequestedBy('');
      fetchData();
    } catch (e: any) {
      addNotification(e.message || 'Failed to create requisition', 'warning', 'Housekeeping');
    }
  };

  // Requisition approve/issue/reject are now handled by the Inventory portal.
  // Departments can only create and view requisition status.

  const filteredMainStoreItems = useMemo(() => {
    const s = mainStoreSearch.toLowerCase();
    if (!s) return mainStoreItems.slice(0, 20);
    return mainStoreItems.filter(i => i.name.toLowerCase().includes(s)).slice(0, 30);
  }, [mainStoreItems, mainStoreSearch]);

  // ── Waste handler ──────────────────────────────────────────────────────
  const submitWaste = async () => {
    if (!wasteForm.itemId) { addNotification('Please select an item', 'warning', 'Housekeeping'); return; }
    if (!wasteForm.quantity || wasteForm.quantity <= 0) { addNotification('Please enter a valid quantity', 'warning', 'Housekeeping'); return; }
    try {
      const res = await fetch('/api/hk-portal/inventory/waste', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          itemId: wasteForm.itemId,
          wasteType: wasteForm.wasteType,
          quantity: wasteForm.quantity,
          reason: wasteForm.reason,
        }),
      });
      if (!res.ok) throw new Error(`Failed to record waste (${res.status})`);
      addNotification('Waste recorded successfully', 'success', 'Housekeeping');
      setShowWasteModal(false);
      setWasteSearch('');
      setWasteForm({ itemId: '', wasteType: 'damaged', quantity: 0, reason: '' });
      fetchData();
    } catch (e: any) {
      addNotification(e.message, 'warning', 'Housekeeping');
    }
  };

  // ── Consumption handler ─────────────────────────────────────────────────
  const submitConsumption = async () => {
    if (!currentPropertyId) { addNotification('Property ID required', 'warning', 'Housekeeping'); return; }
    if (!consumptionForm.roomsCleaned || consumptionForm.roomsCleaned <= 0) {
      addNotification('Rooms cleaned must be positive', 'warning', 'Housekeeping');
      return;
    }
    if (consumptionForm.entries.length === 0) {
      addNotification('Please add at least one item', 'warning', 'Housekeeping');
      return;
    }
    try {
      const res = await fetch('/api/hk-portal/inventory/consumption', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          propertyId: currentPropertyId,
          roomsCleaned: consumptionForm.roomsCleaned,
          entries: consumptionForm.entries,
        }),
      });
      if (!res.ok) throw new Error(`Failed to record consumption (${res.status})`);
      addNotification(`Consumption recorded for ${consumptionForm.roomsCleaned} rooms`, 'success', 'Housekeeping');
      setShowConsumptionModal(false);
      setConsumptionSearch('');
      setConsumptionForm({ roomsCleaned: 1, entries: [] });
      fetchData();
    } catch (e: any) {
      addNotification(e.message, 'warning', 'Housekeeping');
    }
  };

  // ── Transfer handler ────────────────────────────────────────────────────
  const submitTransfer = async () => {
    if (!currentPropertyId || !transferForm.itemId || !transferForm.toLocation) {
      addNotification('Property, item, and destination are required', 'warning', 'Housekeeping');
      return;
    }
    if (transferForm.quantity <= 0) {
      addNotification('Quantity must be positive', 'warning', 'Housekeeping');
      return;
    }
    try {
      const res = await fetch('/api/hk-portal/inventory/transfers', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          propertyId: currentPropertyId,
          itemId: transferForm.itemId,
          fromLocation: transferForm.fromLocation,
          toLocation: transferForm.toLocation,
          toLocationId: transferForm.toLocationId || undefined,
          quantity: transferForm.quantity,
          reason: transferForm.reason,
        }),
      });
      if (!res.ok) throw new Error(`Failed to create transfer (${res.status})`);
      addNotification('Transfer recorded successfully', 'success', 'Housekeeping');
      setShowTransferModal(false);
      setTransferSearch('');
      setTransferForm({
        itemId: '',
        fromLocation: 'Main HK Store',
        toLocation: locations[0]?.locationName || 'Floor 1 Linen Closet',
        toLocationId: locations[0]?.id || '',
        quantity: 0,
        reason: '',
      });
      setCustomToLocation(false);
      fetchData();
    } catch (e: any) {
      addNotification(e.message, 'warning', 'Housekeeping');
    }
  };

  // ── Stock count handler ─────────────────────────────────────────────────
  const tabs = [
    { id: 'inventory' as const, label: 'Inventory', icon: Package },
    { id: 'par-management' as const, label: 'Par Management', icon: Activity },
    { id: 'requisitions' as const, label: 'Replenishment & Requisition', icon: ClipboardCheck },
    { id: 'consumption' as const, label: 'Consumption', icon: BookOpen },
    { id: 'waste' as const, label: 'Waste & Loss', icon: AlertTriangle },
    { id: 'transfers' as const, label: 'Transfers', icon: Truck },
    { id: 'movements' as const, label: 'Stock Movements', icon: ArrowDownUp },
    { id: 'stock-count' as const, label: 'Stock Count', icon: ClipboardList },
    { id: 'variance' as const, label: 'Variance Analysis', icon: BarChart3 },
    { id: 'inter-dept-transfer' as const, label: 'Inter-Dept Transfer', icon: ArrowRightLeft },
  ];

  const totalInventoryValue = data?.summary.totalValue || 0;
  const lowStockItems = data?.lowStock.length || 0;
  const criticalStockItems = data?.critical.length || 0;
  const totalItemsCount = data?.summary.total || 0;

  // Dynamic stats — change based on the active sub-tab
  const stats = useMemo(() => {
    const consumptionRecords = transactions.filter(t => t.transactionType === 'consumption');
    const wasteRecords = transactions.filter(t => t.transactionType === 'waste');
    const transferRecords = transactions.filter(t => t.transactionType === 'transfer');
    const movementRecords = transactions.filter(t => ['goods_receipt', 'stock_count', 'cycle_count', 'adjustment', 'Stock Count', 'Transfer In', 'Transfer Out', 'Count Adjustment'].includes(t.transactionType));
    const pendingReqs = requisitions.filter(r => r.status === 'pending');
    const approvedReqs = requisitions.filter(r => r.status === 'approved' || r.status === 'fulfilled');
    const linenItems = (data?.items || []).filter(i => i.isLinen);
    const linenTotalQty = linenItems.reduce((s, i) => s + i.currentQuantity + (i.linenInUse || 0) + (i.linenAtLaundry || 0), 0);
    const linenDamagedLost = linenItems.reduce((s, i) => s + (i.linenDamaged || 0) + (i.linenLost || 0), 0);

    switch (activeTab) {
      case 'inventory':
        return [
          { label: 'Total Items', value: String(totalItemsCount), caption: `${lowStockItems} low · ${criticalStockItems} critical`, icon: Package, tone: 'info' as const },
          { label: 'Inventory Value', value: formatAmount(totalInventoryValue), caption: 'Current stock value', icon: DollarSign, tone: 'success' as const },
          { label: 'Low Stock', value: String(lowStockItems), caption: `${criticalStockItems} critical items`, icon: AlertTriangle, tone: 'warning' as const },
          { label: 'Critical', value: String(criticalStockItems), caption: 'Below minimum stock', icon: AlertCircle, tone: 'danger' as const },
        ];
      case 'par-management':
        return [
          { label: 'Total Items', value: String(totalItemsCount), caption: 'HK items tracked', icon: Package, tone: 'info' as const },
          { label: 'With Par Level', value: String((data?.items || []).filter(i => i.parLevel > 0).length), caption: 'Par level set', icon: Target, tone: 'success' as const },
          { label: 'With Reorder Point', value: String((data?.items || []).filter(i => i.reorderPoint > 0).length), caption: 'Reorder configured', icon: Zap, tone: 'warning' as const },
          { label: 'Low Stock', value: String(lowStockItems), caption: `${criticalStockItems} critical`, icon: AlertTriangle, tone: 'danger' as const },
        ];
      case 'requisitions':
        return [
          { label: 'Total Requisitions', value: String(requisitions.length), caption: 'All time', icon: ClipboardCheck, tone: 'info' as const },
          { label: 'Pending', value: String(pendingReqs.length), caption: 'Awaiting approval', icon: Clock, tone: 'warning' as const },
          { label: 'Approved/Fulfilled', value: String(approvedReqs.length), caption: 'Completed', icon: CheckCircle2, tone: 'success' as const },
          { label: 'Total Value', value: formatAmount(requisitions.reduce((s, r) => s + (r.totalCost || 0), 0)), caption: 'Requisition value', icon: DollarSign, tone: 'info' as const },
        ];
      case 'consumption':
        return [
          { label: 'Consumption Records', value: String(consumptionRecords.length), caption: 'Total entries', icon: BookOpen, tone: 'info' as const },
          { label: 'Total Consumed', value: String(consumptionRecords.reduce((s, t) => s + t.actualQty, 0)), caption: 'Units consumed', icon: Package, tone: 'warning' as const },
          { label: 'Consumption Cost', value: formatAmount(consumptionRecords.reduce((s, t) => s + t.totalCost, 0)), caption: 'Total cost', icon: DollarSign, tone: 'danger' as const },
          { label: 'Avg Variance', value: `${consumptionRecords.length > 0 ? ((consumptionRecords.reduce((s, t) => s + (t.actualQty - t.theoreticalQty), 0) / consumptionRecords.length).toFixed(1)) : '0.0'}`, caption: 'Actual vs theoretical', icon: BarChart3, tone: 'success' as const },
        ];
      case 'waste':
        return [
          { label: 'Waste Records', value: String(wasteRecords.length), caption: 'Total entries', icon: AlertTriangle, tone: 'danger' as const },
          { label: 'Total Wasted', value: String(wasteRecords.reduce((s, t) => s + t.quantity, 0)), caption: 'Units lost', icon: Package, tone: 'warning' as const },
          { label: 'Waste Cost', value: formatAmount(wasteRecords.reduce((s, t) => s + t.totalCost, 0)), caption: 'Total loss value', icon: DollarSign, tone: 'danger' as const },
          { label: 'Damaged', value: String(wasteRecords.filter(t => t.wasteType === 'damaged').length), caption: 'Damaged items', icon: AlertCircle, tone: 'warning' as const },
        ];
      case 'transfers':
        return [
          { label: 'Transfer Records', value: String(transferRecords.length), caption: 'Total transfers', icon: Truck, tone: 'info' as const },
          { label: 'Total Transferred', value: String(transferRecords.reduce((s, t) => s + t.quantity, 0)), caption: 'Units moved', icon: Package, tone: 'success' as const },
          { label: 'Transfer Value', value: formatAmount(transferRecords.reduce((s, t) => s + t.totalCost, 0)), caption: 'Total value', icon: DollarSign, tone: 'info' as const },
          { label: 'Recent', value: String(transferRecords.filter(t => { const d = new Date(t.transactionDate); return Date.now() - d.getTime() < 7 * 86400000; }).length), caption: 'Last 7 days', icon: Clock, tone: 'warning' as const },
        ];
      case 'movements':
        return [
          { label: 'Movement Records', value: String(movementRecords.length), caption: 'All movements', icon: ArrowDownUp, tone: 'info' as const },
          { label: 'Stock Counts', value: String(transactions.filter(t => t.transactionType === 'stock_count' || t.transactionType === 'cycle_count' || t.transactionType === 'Stock Count' || t.transactionType === 'Count Adjustment').length), caption: 'Count adjustments', icon: ClipboardList, tone: 'success' as const },
          { label: 'Adjustments', value: String(transactions.filter(t => t.transactionType === 'adjustment').length), caption: 'Manual adjustments', icon: Zap, tone: 'warning' as const },
          { label: 'Receipts', value: String(transactions.filter(t => t.transactionType === 'goods_receipt').length), caption: 'Goods received', icon: Package, tone: 'info' as const },
        ];
      case 'stock-count':
        return [
          { label: 'HK Stores', value: '2', caption: 'HK + Linen store', icon: Package, tone: 'info' as const },
          { label: 'Total Items', value: String(totalItemsCount), caption: 'Items to count', icon: ClipboardList, tone: 'success' as const },
          { label: 'Inventory Value', value: formatAmount(totalInventoryValue), caption: 'Stock at risk', icon: DollarSign, tone: 'warning' as const },
          { label: 'Linen Items', value: String(linenItems.length), caption: 'Linen tracked', icon: Layers, tone: 'info' as const },
        ];
      case 'variance':
        return [
          { label: 'Variance Records', value: String(varianceData.summary.total), caption: 'Total entries', icon: BarChart3, tone: 'info' as const },
          { label: 'High Severity', value: String(varianceData.summary.high), caption: 'Needs attention', icon: AlertCircle, tone: 'danger' as const },
          { label: 'Medium Severity', value: String(varianceData.summary.medium), caption: 'Monitor closely', icon: AlertTriangle, tone: 'warning' as const },
          { label: 'Low/None', value: String(varianceData.summary.low + varianceData.summary.na), caption: 'Within tolerance', icon: CheckCircle2, tone: 'success' as const },
        ];
      default:
        return [
          { label: 'Total Items', value: String(totalItemsCount), caption: `${lowStockItems} low · ${criticalStockItems} critical`, icon: Package, tone: 'info' as const },
          { label: 'Inventory Value', value: formatAmount(totalInventoryValue), caption: 'Current stock value', icon: DollarSign, tone: 'success' as const },
          { label: 'Low Stock', value: String(lowStockItems), caption: `${criticalStockItems} critical items`, icon: AlertTriangle, tone: 'warning' as const },
          { label: 'Critical', value: String(criticalStockItems), caption: 'Below minimum stock', icon: AlertCircle, tone: 'danger' as const },
        ];
    }
  }, [activeTab, data, transactions, requisitions, varianceData, totalItemsCount, totalInventoryValue, lowStockItems, criticalStockItems]);

  const tabCounts = {
    inventory: data?.items.length || 0,
    requisitions: requisitions.filter(r => r.status === 'pending').length,
    consumption: transactions.filter(t => t.transactionType === 'consumption').length,
    waste: transactions.filter(t => t.transactionType === 'waste').length,
    transfers: transactions.filter(t => t.transactionType === 'transfer').length,
    movements: transactions.filter(t => ['goods_receipt', 'stock_count', 'cycle_count', 'adjustment'].includes(t.transactionType)).length,
    'stock-count': undefined,
    variance: varianceData.aggregated.length,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Housekeeping Inventory"
        subtitle="Housekeeping & Linen store inventory — stock, par levels, consumption, waste, transfers, counts, and variance"
        icon={Package}
        actions={
          <div className="flex gap-2">
            {activeTab === 'inventory' && (
              <button onClick={() => setShowForm(true)} className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                <Plus size={14} className="inline-block mr-1" /> Add HK Item
              </button>
            )}
            {activeTab === 'requisitions' && (
              <>
                <button onClick={() => setReplenishAutoTrigger(t => t + 1)} className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                  <Zap size={14} className="inline-block mr-1" /> Auto-Replenish
                </button>
                <button onClick={() => setReqNewTrigger(t => t + 1)} className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                  <Plus size={14} className="inline-block mr-1" /> New Requisition
                </button>
              </>
            )}
            {activeTab === 'par-management' && parView === 'dynamic' && (
              <>
                <button onClick={() => setParRecalculateTrigger(t => t + 1)} className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors">
                  <Activity size={14} className="inline-block mr-1" /> Recalculate
                </button>
                <button onClick={() => setParAutoReplenishTrigger(t => t + 1)} className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                  <Zap size={14} className="inline-block mr-1" /> Auto-Replenish
                </button>
              </>
            )}
            {activeTab === 'stock-count' && (
              <button onClick={() => setCountNewTrigger(t => t + 1)} className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                <Plus size={14} className="inline-block mr-1" /> New Count
              </button>
            )}
            {activeTab === 'waste' && (
              <button onClick={() => setShowWasteModal(true)} className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                <AlertTriangle size={14} className="inline-block mr-1" /> Record HK Waste
              </button>
            )}
            {activeTab === 'transfers' && (
              <button onClick={() => setShowTransferModal(true)} className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                <Truck size={14} className="inline-block mr-1" /> New HK Transfer
              </button>
            )}
            {activeTab === 'consumption' && (
              <button onClick={() => setShowConsumptionModal(true)} className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                <BookOpen size={14} className="inline-block mr-1" /> Record HK Consumption
              </button>
            )}
          </div>
        }
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
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
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
            {tabCounts[tab.id] !== undefined && tabCounts[tab.id]! > 0 && (
              <span className={`inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 text-xs font-medium rounded-full ${
                activeTab === tab.id
                  ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                  : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
              }`}>
                {tabCounts[tab.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Filter Bar */}
      {(activeTab === 'inventory' || activeTab === 'movements' || activeTab === 'waste' || activeTab === 'transfers' || activeTab === 'variance' || activeTab === 'consumption') && (
        <div className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-gray-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white w-48"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600 dark:text-slate-400">Type:</label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
            >
              <option value="all">All</option>
              <option value="regular">Regular</option>
              <option value="linen">Linen</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600 dark:text-slate-400">Item Type:</label>
            <select
              value={itemTypeFilter}
              onChange={(e) => setItemTypeFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
            >
              <option value="all">All Types</option>
              <option value="consumable">Consumable</option>
              <option value="non-consumable">Non-Consumable</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600 dark:text-slate-400">Category:</label>
            <select
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
            >
              <option value="all">All Categories</option>
              <option value="Cleaning Supplies">Cleaning Supplies</option>
              <option value="Linens">Linens</option>
              <option value="Equipment">Equipment</option>
              <option value="Amenities">Amenities</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600 dark:text-slate-400">Storage:</label>
            <select
              value={storageFilter}
              onChange={(e) => setStorageFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
            >
              <option value="all">All Storage</option>
              <option value="perishable">Perishable</option>
              <option value="non-perishable">Non-Perishable</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600 dark:text-slate-400">Location:</label>
            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
            >
              <option value="all">All Locations</option>
              <option value="HK Store">HK Store</option>
              <option value="Linen Store">Linen Store</option>
            </select>
          </div>
          <button onClick={fetchData} className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors" disabled={loading}>
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
          {parView === 'dynamic' && <DepartmentDynamicParPanel department="Housekeeping" hideStats hideHeader refreshTrigger={parRefreshTrigger} recalculateTrigger={parRecalculateTrigger} autoReplenishTrigger={parAutoReplenishTrigger} />}
          {parView === 'overrides' && <DepartmentParOverridesPanel department="Housekeeping" />}
        </div>
      )}

      {/* Inventory Tab */}
      {activeTab === 'inventory' && (
        <SectionCard title="Housekeeping Inventory Listing" subtitle="All housekeeping items by store and category — par levels, stock status, and valuation. Linen items show extended tracking (In Use, At Laundry, Damaged, Lost).">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">Stock Level</th>
                  <th className="px-4 py-3 font-medium">Qty</th>
                  <th className="px-4 py-3 font-medium">Par</th>
                  <th className="px-4 py-3 font-medium">Unit</th>
                  <th className="px-4 py-3 font-medium">In Use</th>
                  <th className="px-4 py-3 font-medium">Laundry</th>
                  <th className="px-4 py-3 font-medium">Damaged</th>
                  <th className="px-4 py-3 font-medium">Lost</th>
                  <th className="px-4 py-3 font-medium">Unit Cost</th>
                  <th className="px-4 py-3 font-medium">Stock Value</th>
                  <th className="px-4 py-3 font-medium">Supplier</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {filteredItems.map(item => {
                  const isCritical = item.minimumQuantity > 0 && item.currentQuantity <= item.minimumQuantity;
                  const isLow = !isCritical && item.reorderPoint > 0 && item.currentQuantity <= item.reorderPoint;
                  const stockStatus = isCritical ? 'critical' : isLow ? 'low' : 'normal';
                  const stockValue = item.currentQuantity * item.costPerUnit;
                  const maxRef = item.maximumStock || (item.reorderPoint > 0 ? item.reorderPoint * 3 : 100);
                  const stockPct = Math.min(100, Math.max(0, (item.currentQuantity / maxRef) * 100));
                  return (
                    <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{item.name}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{item.categoryLabel}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{item.location || '—'}</td>
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
                            min: {item.minimumQuantity} · reorder: {item.reorderPoint}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`font-medium ${stockStatus === 'critical' ? 'text-red-600' : stockStatus === 'low' ? 'text-amber-600' : 'text-slate-900 dark:text-white'}`}>
                          {item.currentQuantity}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-medium text-indigo-600 dark:text-indigo-400">{item.parLevel ?? '—'}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{item.unitOfMeasure}</td>
                      <td className="px-4 py-3">
                        {item.isLinen ? <span className="font-medium text-blue-600 dark:text-blue-400 tabular-nums">{item.linenInUse ?? 0}</span> : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {item.isLinen ? <span className="font-medium text-cyan-600 dark:text-cyan-400 tabular-nums">{item.linenAtLaundry ?? 0}</span> : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {item.isLinen ? <span className="font-medium text-red-600 tabular-nums">{item.linenDamaged ?? 0}</span> : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {item.isLinen ? <span className="font-medium text-red-800 tabular-nums">{item.linenLost ?? 0}</span> : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{formatAmount(item.costPerUnit)}</td>
                      <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-300">{formatAmount(stockValue)}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{item.supplier || '—'}</td>
                      <td className="px-4 py-3">
                        <Badge tone={stockStatus === 'critical' ? 'danger' : stockStatus === 'low' ? 'warning' : 'success'}>
                          {stockStatus}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {item.isLinen && (
                            <button
                              onClick={() => { setLinenOpItem(item); setLinenOpForm({ operation: 'Issue Linen', type: item.linenType || item.name, quantity: '', location: '', staff: '', notes: '' }); }}
                              className="p-1 text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors"
                              title="Linen operations (Issue / Return / Damaged / Lost / Count)"
                            >
                              <Layers className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => openEdit(item)}
                            className="p-1 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                            title="Edit"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => { setAdjustItem(item); setAdjustQty(''); setAdjustNotes(''); }}
                            className="p-1 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                            title="Adjust stock"
                          >
                            <ArrowUpFromLine className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => deleteItem(item.id)}
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
              {(() => {
                if (filteredItems.length === 0) return null;
                const totalValue = filteredItems.reduce((sum, i) => sum + i.currentQuantity * i.costPerUnit, 0);
                return (
                  <tfoot className="bg-slate-50 dark:bg-slate-900/40 border-t-2 border-slate-300 dark:border-slate-500">
                    <tr>
                      <td colSpan={12} className="px-4 py-3 text-right text-slate-600 dark:text-slate-400 font-medium">
                        {filteredItems.length} items — Total Stock Value:
                      </td>
                      <td className="px-4 py-3 font-bold text-indigo-600 dark:text-indigo-400">{formatAmount(totalValue)}</td>
                      <td colSpan={3}></td>
                    </tr>
                  </tfoot>
                );
              })()}
            </table>
          </div>
          {!loading && !error && filteredItems.length === 0 && (
            <div className="p-8 text-center text-sm text-gray-500">No inventory items match the filters.</div>
          )}
        </SectionCard>
      )}

      {/* Replenishment & Requisition Tab — HK-scoped replenishment + requisitions */}
      {activeTab === 'requisitions' && (
        <div className="space-y-6">
          <DepartmentReplenishmentPanel department="Housekeeping" hideStats hideHeader refreshTrigger={replenishRefreshTrigger} autoReplenishTrigger={replenishAutoTrigger} />
          <DepartmentRequisitionForm department="Housekeeping" hideStats hideHeader refreshTrigger={reqRefreshTrigger} newRequisitionTrigger={reqNewTrigger} />
        </div>
      )}

      {/* Movements Tab */}
      {activeTab === 'movements' && (
        <SectionCard title="Housekeeping Stock Movements" subtitle="Goods Receipt, Adjustments, Stock Counts, Cycle Counts for HK & Linen stores">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Item</th>
                  <th className="px-4 py-3 font-medium">Quantity</th>
                  <th className="px-4 py-3 font-medium">Cost</th>
                  <th className="px-4 py-3 font-medium">Reason</th>
                  <th className="px-4 py-3 font-medium">Performed By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {(() => {
                  const movTypes = ['goods_receipt', 'stock_count', 'cycle_count', 'adjustment', 'restock'];
                  const movs = transactions.filter(t => movTypes.includes(t.transactionType));
                  if (movs.length === 0) {
                    return <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">No stock movements recorded yet.</td></tr>;
                  }
                  return movs.map(t => (
                    <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.transactionDate ? String(t.transactionDate).slice(0, 10) : '—'}</td>
                      <td className="px-4 py-3">
                        <Badge tone={
                          t.transactionType === 'goods_receipt' || t.transactionType === 'restock' ? 'success'
                          : t.transactionType === 'adjustment' ? 'info'
                          : 'neutral'
                        }>
                          {t.transactionType.replace(/_/g, ' ')}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.itemName}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.quantity} {t.unit}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{formatAmount(t.totalCost)}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.reason || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.performedBy || '—'}</td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* Waste Tab */}
      {activeTab === 'waste' && (
        <SectionCard title="Housekeeping Waste & Loss Tracking" subtitle="Damaged, Stained, Lost, Expired, Guest Taken, Overstock for HK & Linen stores">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Item</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Quantity</th>
                  <th className="px-4 py-3 font-medium">Reason</th>
                  <th className="px-4 py-3 font-medium">Cost</th>
                  <th className="px-4 py-3 font-medium">Performed By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {(() => {
                  const wasteRecords = transactions.filter(t => t.transactionType === 'waste');
                  if (wasteRecords.length === 0) {
                    return <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">No waste records yet.</td></tr>;
                  }
                  return wasteRecords.map(t => (
                    <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.transactionDate ? String(t.transactionDate).slice(0, 10) : '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.itemName}</td>
                      <td className="px-4 py-3">
                        <Badge tone={
                          t.wasteType === 'damaged' || t.wasteType === 'lost' ? 'danger'
                          : t.wasteType === 'expired' || t.wasteType === 'stained' ? 'warning'
                          : 'neutral'
                        }>
                          {(t.wasteType || 'waste').replace(/_/g, ' ')}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.quantity} {t.unit}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.reason || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{formatAmount(t.totalCost)}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.performedBy || '—'}</td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* Transfers Tab */}
      {activeTab === 'transfers' && (
        <SectionCard title="Housekeeping Inventory Transfers" subtitle="Transfer cleaning supplies, linens, amenities, and equipment between HK store and floor closets/carts">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Item</th>
                  <th className="px-4 py-3 font-medium">Reference</th>
                  <th className="px-4 py-3 font-medium">Quantity</th>
                  <th className="px-4 py-3 font-medium">Reason</th>
                  <th className="px-4 py-3 font-medium">Cost</th>
                  <th className="px-4 py-3 font-medium">Performed By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {(() => {
                  const transferRecords = transactions.filter(t => t.transactionType === 'transfer');
                  if (transferRecords.length === 0) {
                    return <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">No transfer records yet.</td></tr>;
                  }
                  return transferRecords.map(t => (
                    <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.transactionDate ? String(t.transactionDate).slice(0, 10) : '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.itemName}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.referenceNumber || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.quantity} {t.unit}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.reason || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{formatAmount(t.totalCost)}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.performedBy || '—'}</td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* Stock Count Tab — uses the unified uinv_counts system via StockCountsModule */}
      {activeTab === 'stock-count' && (
        <StockCountsModule
          storeFilter={['UINV-ST-HK', 'UINV-ST-LINEN']}
          title="Housekeeping Stock Counts"
          subtitle="Physical, cycle, and spot count workflows for HK & Linen stores — full lifecycle: Draft → In Progress → Reconciled → Approved."
          hideStats
          hideHeader
          refreshTrigger={countRefreshTrigger}
          newCountTrigger={countNewTrigger}
        />
      )}

      {/* Consumption Tab */}
      {activeTab === 'consumption' && (
        <SectionCard title="Housekeeping Consumption Tracking" subtitle="Theoretical (par × rooms cleaned) vs Actual consumption for HK & Linen items">
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
                  const consumptionRecords = transactions.filter(t => t.transactionType === 'consumption');
                  if (consumptionRecords.length === 0) {
                    return <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">No consumption records yet. Use "Record Consumption" to log actual consumption.</td></tr>;
                  }
                  return consumptionRecords.map(t => {
                    const variance = t.actualQty - t.theoreticalQty;
                    const variancePct = t.theoreticalQty > 0 ? (variance / t.theoreticalQty) * 100 : null;
                    return (
                      <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.transactionDate ? String(t.transactionDate).slice(0, 10) : '—'}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.itemName}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.theoreticalQty} {t.unit}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.actualQty} {t.unit}</td>
                        <td className="px-4 py-3">
                          <Badge tone={variance === 0 ? 'success' : variance < 0 ? 'danger' : 'warning'}>
                            {variance > 0 ? '+' : ''}{variance.toFixed(2)} {t.unit}
                            {variancePct !== null ? ` (${variancePct.toFixed(1)}%)` : ''}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{formatAmount(t.totalCost)}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.performedBy || '—'}</td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* Variance Tab */}
      {activeTab === 'variance' && (
        <SectionCard title="Housekeeping Variance Analysis" subtitle="Theoretical (par × rooms) vs Actual consumption variance for HK & Linen stores (Qty + Cost)">
          <div className="p-6 space-y-4">
            {/* Variance table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Item</th>
                    <th className="px-4 py-3 font-medium">Category</th>
                    <th className="px-4 py-3 font-medium">Theoretical</th>
                    <th className="px-4 py-3 font-medium">Actual</th>
                    <th className="px-4 py-3 font-medium">Variance Qty</th>
                    <th className="px-4 py-3 font-medium">Variance %</th>
                    <th className="px-4 py-3 font-medium">Severity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {varianceData.aggregated.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                        No variance data available. Variance is calculated from consumption transactions with theoretical vs actual quantities.
                      </td>
                    </tr>
                  ) : varianceData.aggregated.map(row => {
                    const isHigh = row.severity === 'high';
                    const isMedium = row.severity === 'medium';
                    const isNa = row.severity === 'na';
                    const varianceClass = isNa ? 'text-slate-400' : isHigh ? 'text-red-600' : isMedium ? 'text-amber-600' : 'text-green-600';
                    const pctDisplay = row.variancePercent === null ? 'N/A' : `${row.variancePercent > 0 ? '+' : ''}${row.variancePercent.toFixed(1)}%`;
                    return (
                      <tr key={row.itemId} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{row.itemName}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{row.category || '—'}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{row.theoretical} {row.unit}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{row.actual} {row.unit}</td>
                        <td className={`px-4 py-3 ${varianceClass}`}>
                          {isNa ? '—' : `${row.varianceQty > 0 ? '+' : ''}${row.varianceQty.toFixed(2)} ${row.unit}`}
                        </td>
                        <td className={`px-4 py-3 ${varianceClass}`}>{pctDisplay}</td>
                        <td className="px-4 py-3">
                          <Badge tone={isNa ? 'neutral' : isHigh ? 'danger' : isMedium ? 'warning' : 'success'}>
                            {isNa ? 'N/A' : row.severity}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </SectionCard>
      )}

      {/* ── Inter-Department Transfer Tab ─────────────────────────────── */}
      {activeTab === 'inter-dept-transfer' && !loading && !error && (
        <InterDepartmentTransferPanel sourceDepartment="Housekeeping" />
      )}

      {/* Modals */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">{editing ? 'Edit Housekeeping Item' : 'Add Housekeeping Item'}</h2>
              <button onClick={() => setShowForm(false)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Name</label>
                <input value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Category</label>
                <select value={form.category || 'cleaning_supplies'} onChange={e => setForm({ ...form, category: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white">
                  {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Current Qty</label>
                  <input type="number" value={form.currentQuantity ?? 0} onChange={e => handleNumber('currentQuantity', e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Unit</label>
                  <input value={form.unitOfMeasure || 'PCS'} onChange={e => setForm({ ...form, unitOfMeasure: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Min Qty</label>
                  <input type="number" value={form.minimumQuantity ?? 0} onChange={e => handleNumber('minimumQuantity', e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Reorder Point</label>
                  <input type="number" value={form.reorderPoint ?? 0} onChange={e => handleNumber('reorderPoint', e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Par Level</label>
                  <input type="number" value={form.parLevel ?? 0} onChange={e => handleNumber('parLevel', e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Reorder Qty</label>
                  <input type="number" value={form.reorderQuantity ?? 0} onChange={e => handleNumber('reorderQuantity', e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Cost per Unit</label>
                  <input type="number" step="0.01" value={form.costPerUnit ?? 0} onChange={e => handleNumber('costPerUnit', e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Supplier</label>
                <input value={form.supplier || ''} onChange={e => setForm({ ...form, supplier: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
              </div>
              <div className="flex gap-3 pt-4">
                <button onClick={saveItem} className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">{editing ? 'Update' : 'Create'}</button>
                <button onClick={() => setShowForm(false)} className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {adjustItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Adjust HK Stock: {adjustItem.name}</h2>
              <button onClick={() => setAdjustItem(null)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <p className="text-sm text-slate-600 dark:text-slate-400">Current stock: {adjustItem.currentQuantity} {adjustItem.unitOfMeasure}</p>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Delta (positive = restock, negative = consume)</label>
                <input type="number" value={adjustQty} onChange={e => setAdjustQty(e.target.value)} placeholder="e.g. 10 or -5" className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Notes</label>
                <input value={adjustNotes} onChange={e => setAdjustNotes(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
              </div>
              <div className="flex gap-3 pt-4">
                <button onClick={submitAdjust} className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">Adjust</button>
                <button onClick={() => setAdjustItem(null)} className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showReqForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">HK Requisition from Main Store</h2>
              <button onClick={() => setShowReqForm(false)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Requested By</label>
                  <input value={reqRequestedBy} onChange={e => setReqRequestedBy(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Notes</label>
                  <input value={reqNotes} onChange={e => setReqNotes(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Items</label>
                  <span className="text-xs text-slate-500">Search and click to add items</span>
                </div>
                <input value={mainStoreSearch} onChange={e => setMainStoreSearch(e.target.value)} placeholder="Search main store..." className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white mb-2" />
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {filteredMainStoreItems.map(i => (
                    <button key={i.id} onClick={() => addReqItem(i)} className="w-full text-left px-3 py-2 bg-slate-50 dark:bg-slate-900/40 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-sm flex justify-between">
                      <span>{i.name}</span>
                      <span className="text-slate-400">{i.currentQuantity} {i.unitOfMeasure}</span>
                    </button>
                  ))}
                </div>
              </div>
              {reqItems.length > 0 && (
                <div className="space-y-2">
                  {reqItems.map(r => (
                    <div key={r.itemId} className="flex items-center gap-2 p-3 bg-slate-50 dark:bg-slate-900/40 rounded-lg">
                      <span className="flex-1 text-sm">{r.itemName}</span>
                      <input type="number" value={r.quantity} onChange={e => updateReqQty(r.itemId, Number(e.target.value))} className="w-24 px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm" placeholder="Qty" />
                      <button onClick={() => removeReqItem(r.itemId)} className="p-1 text-slate-400 hover:text-red-600">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-3 pt-4">
                <button onClick={submitRequisition} className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">Submit Requisition</button>
                <button onClick={() => setShowReqForm(false)} className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showWasteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Record HK Waste & Loss</h2>
              <button onClick={() => setShowWasteModal(false)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Item</label>
                {wasteForm.itemId ? (
                  <div className="flex items-center gap-2 p-3 bg-slate-50 dark:bg-slate-900/40 rounded-lg">
                    <span className="flex-1 text-sm">{filteredItems.find(i => i.id === wasteForm.itemId)?.name || 'Unknown'}</span>
                    <button onClick={() => setWasteForm({ ...wasteForm, itemId: '' })} className="p-1 text-slate-400 hover:text-red-600">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      value={wasteSearch}
                      onChange={e => setWasteSearch(e.target.value)}
                      placeholder="Search items..."
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white mb-2"
                    />
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {filteredItems
                        .filter(i => {
                          const s = wasteSearch.toLowerCase();
                          if (!s) return true;
                          return i.name.toLowerCase().includes(s) || (i.categoryLabel || '').toLowerCase().includes(s);
                        })
                        .map(i => (
                          <button key={i.id} onClick={() => { setWasteForm({ ...wasteForm, itemId: i.id }); setWasteSearch(''); }} className="w-full text-left px-3 py-2 bg-slate-50 dark:bg-slate-900/40 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-sm flex justify-between">
                            <span>{i.name}</span>
                            <span className="text-slate-400">{i.currentQuantity} {i.unitOfMeasure}</span>
                          </button>
                        ))}
                    </div>
                  </>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Waste Type</label>
                <select value={wasteForm.wasteType} onChange={e => setWasteForm({ ...wasteForm, wasteType: e.target.value as any })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white">
                  <option value="damaged">Damaged</option>
                  <option value="stained">Stained</option>
                  <option value="lost">Lost</option>
                  <option value="expired">Expired</option>
                  <option value="guest_taken">Guest Taken</option>
                  <option value="overstock">Overstock</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Quantity</label>
                  <input type="number" step="0.001" min="0" value={wasteForm.quantity} onChange={e => setWasteForm({ ...wasteForm, quantity: Number(e.target.value) })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Reason</label>
                  <input value={wasteForm.reason} onChange={e => setWasteForm({ ...wasteForm, reason: e.target.value })} placeholder="e.g. Damaged in use, expired" className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <button onClick={submitWaste} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">Record Waste</button>
                <button onClick={() => setShowWasteModal(false)} className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showTransferModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Record HK Stock Transfer</h2>
              <button onClick={() => setShowTransferModal(false)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Item</label>
                {transferForm.itemId ? (
                  <div className="flex items-center gap-2 p-3 bg-slate-50 dark:bg-slate-900/40 rounded-lg">
                    <span className="flex-1 text-sm">{filteredItems.find(i => i.id === transferForm.itemId)?.name || 'Unknown'}</span>
                    <button onClick={() => setTransferForm({ ...transferForm, itemId: '' })} className="p-1 text-slate-400 hover:text-red-600">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      value={transferSearch}
                      onChange={e => setTransferSearch(e.target.value)}
                      placeholder="Search items..."
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white mb-2"
                    />
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {filteredItems
                        .filter(i => {
                          const s = transferSearch.toLowerCase();
                          if (!s) return true;
                          return i.name.toLowerCase().includes(s) || (i.categoryLabel || '').toLowerCase().includes(s);
                        })
                        .map(i => (
                          <button key={i.id} onClick={() => { setTransferForm({ ...transferForm, itemId: i.id }); setTransferSearch(''); }} className="w-full text-left px-3 py-2 bg-slate-50 dark:bg-slate-900/40 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-sm flex justify-between">
                            <span>{i.name}</span>
                            <span className="text-slate-400">{i.currentQuantity} {i.unitOfMeasure}</span>
                          </button>
                        ))}
                    </div>
                  </>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">From Location</label>
                  <select
                    value={transferForm.fromLocation}
                    onChange={e => setTransferForm({ ...transferForm, fromLocation: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    {locations.map(loc => (
                      <option key={loc.id} value={loc.locationName}>{loc.locationName} ({loc.locationType})</option>
                    ))}
                    {!locations.some(l => l.locationName === transferForm.fromLocation) && (
                      <option value={transferForm.fromLocation}>{transferForm.fromLocation}</option>
                    )}
                  </select>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">To Location</label>
                    <button
                      type="button"
                      onClick={() => setCustomToLocation(!customToLocation)}
                      className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold hover:underline"
                    >
                      {customToLocation ? 'Choose from list' : '+ Custom'}
                    </button>
                  </div>
                  {customToLocation ? (
                    <input
                      value={transferForm.toLocation}
                      onChange={e => setTransferForm({ ...transferForm, toLocation: e.target.value, toLocationId: '' })}
                      placeholder="e.g. Floor 5 Service Closet..."
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    />
                  ) : (
                    <select
                      value={transferForm.toLocation}
                      onChange={e => {
                        const sel = locations.find(l => l.locationName === e.target.value);
                        setTransferForm({
                          ...transferForm,
                          toLocation: e.target.value,
                          toLocationId: sel?.id || '',
                        });
                      }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    >
                      {locations.map(loc => (
                        <option key={loc.id} value={loc.locationName}>{loc.locationName} ({loc.locationType})</option>
                      ))}
                      {!locations.some(l => l.locationName === transferForm.toLocation) && (
                        <option value={transferForm.toLocation}>{transferForm.toLocation}</option>
                      )}
                    </select>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Quantity</label>
                  <input type="number" step="0.001" min="0" value={transferForm.quantity} onChange={e => setTransferForm({ ...transferForm, quantity: Number(e.target.value) })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Reason</label>
                  <input value={transferForm.reason} onChange={e => setTransferForm({ ...transferForm, reason: e.target.value })} placeholder="e.g. Restock location, event transfer" className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <button onClick={submitTransfer} className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">Record Transfer</button>
                <button onClick={() => setShowTransferModal(false)} className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showConsumptionModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Record HK Consumption</h2>
              <button onClick={() => setShowConsumptionModal(false)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Rooms Cleaned</label>
                <input type="number" min="1" value={consumptionForm.roomsCleaned} onChange={e => setConsumptionForm({ ...consumptionForm, roomsCleaned: Number(e.target.value) })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
              </div>

              {consumptionForm.entries.length > 0 && (
                <div className="border border-slate-200 dark:border-slate-600 rounded-lg overflow-hidden">
                  <div className="bg-slate-50 dark:bg-slate-900/40 px-4 py-2 text-xs uppercase text-slate-500 font-medium">
                    Consumption Breakdown — Theoretical (par × rooms), enter actual counted usage
                  </div>
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-slate-500">
                      <tr>
                        <th className="px-4 py-2 font-medium">Item</th>
                        <th className="px-4 py-2 font-medium">Theoretical (par × rooms)</th>
                        <th className="px-4 py-2 font-medium">Actual (counted)</th>
                        <th className="px-4 py-2 font-medium">Variance</th>
                        <th className="px-4 py-2 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                      {consumptionForm.entries.map((e, idx) => {
                        const item = filteredItems.find(i => i.id === e.itemId);
                        const theoretical = (item?.minimumQuantity || 0) * consumptionForm.roomsCleaned;
                        const variance = e.actualQty - theoretical;
                        const varianceClass = Math.abs(variance) < 0.001 ? 'text-slate-400' : variance < 0 ? 'text-red-600' : 'text-green-600';
                        return (
                          <tr key={e.itemId}>
                            <td className="px-4 py-2 text-slate-700 dark:text-slate-300">{item?.name || 'Unknown'}</td>
                            <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{theoretical} {item?.unitOfMeasure || ''}</td>
                            <td className="px-4 py-2">
                              <input type="number" step="0.001" value={e.actualQty} onChange={e2 => {
                                const newEntries = [...consumptionForm.entries];
                                newEntries[idx].actualQty = Number(e2.target.value);
                                setConsumptionForm({ ...consumptionForm, entries: newEntries });
                              }} className="w-24 px-2 py-1 border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm" />
                              <span className="ml-1 text-xs text-slate-400">{item?.unitOfMeasure || ''}</span>
                            </td>
                            <td className={`px-4 py-2 ${varianceClass}`}>
                              {Math.abs(variance) < 0.001 ? '—' : `${variance > 0 ? '+' : ''}${variance.toFixed(3)} ${item?.unitOfMeasure || ''}`}
                            </td>
                            <td className="px-4 py-2">
                              <button onClick={() => setConsumptionForm({ ...consumptionForm, entries: consumptionForm.entries.filter((_, i) => i !== idx) })} className="p-1 text-slate-400 hover:text-red-600">
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
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Add Items</label>
                  <span className="text-xs text-slate-500">Click items to add to consumption</span>
                </div>
                <input
                  type="text"
                  value={consumptionSearch}
                  onChange={e => setConsumptionSearch(e.target.value)}
                  placeholder="Search items..."
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white mb-2"
                />
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {filteredItems
                    .filter(i => {
                      const s = consumptionSearch.toLowerCase();
                      if (!s) return true;
                      return i.name.toLowerCase().includes(s) || (i.categoryLabel || '').toLowerCase().includes(s);
                    })
                    .map(i => {
                    const added = consumptionForm.entries.find(e => e.itemId === i.id);
                    return (
                      <button key={i.id} onClick={() => {
                        if (!added) {
                          setConsumptionForm({ ...consumptionForm, entries: [...consumptionForm.entries, { itemId: i.id, actualQty: 0 }] });
                        }
                      }} className={`w-full text-left px-3 py-2 rounded-lg text-sm flex justify-between ${added ? 'bg-slate-200 dark:bg-slate-700 cursor-default' : 'bg-slate-50 dark:bg-slate-900/40 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
                        <span>{i.name}</span>
                        <span className="text-slate-400">{i.minimumQuantity} par</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button onClick={submitConsumption} className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">Record Consumption</button>
                <button onClick={() => setShowConsumptionModal(false)} className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Linen Operations Modal — Issue / Return / Damaged / Lost / Count */}
      {linenOpItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">HK Linen Operations — {linenOpItem.name}</h3>
              <button onClick={() => setLinenOpItem(null)} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              {/* Current linen status */}
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="bg-slate-50 dark:bg-slate-900/40 rounded-lg p-2">
                  <p className="text-xs text-slate-500">In Stock</p>
                  <p className="text-lg font-bold text-slate-900 dark:text-white">{linenOpItem.currentQuantity}</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/40 rounded-lg p-2">
                  <p className="text-xs text-slate-500">In Use</p>
                  <p className="text-lg font-bold text-blue-600">{linenOpItem.linenInUse ?? 0}</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/40 rounded-lg p-2">
                  <p className="text-xs text-slate-500">At Laundry</p>
                  <p className="text-lg font-bold text-cyan-600">{linenOpItem.linenAtLaundry ?? 0}</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/40 rounded-lg p-2">
                  <p className="text-xs text-slate-500">Damaged/Lost</p>
                  <p className="text-lg font-bold text-red-600">{(linenOpItem.linenDamaged ?? 0) + (linenOpItem.linenLost ?? 0)}</p>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Operation</label>
                <select
                  value={linenOpForm.operation}
                  onChange={e => setLinenOpForm({ ...linenOpForm, operation: e.target.value as any })}
                  className="w-full mt-1 px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
                >
                  <option value="Issue Linen">Issue Linen (stock → in use)</option>
                  <option value="Return Linen">Return Linen (in use → laundry → stock)</option>
                  <option value="Damaged Linen">Damaged Linen (in use → damaged)</option>
                  <option value="Lost Linen">Lost Linen (in use → lost)</option>
                  <option value="Linen Count">Linen Count (reset stock)</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Linen Type</label>
                <input
                  type="text"
                  value={linenOpForm.type}
                  onChange={e => setLinenOpForm({ ...linenOpForm, type: e.target.value })}
                  className="w-full mt-1 px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
                  placeholder="e.g. Bed Sheets"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Quantity</label>
                <input
                  type="number"
                  value={linenOpForm.quantity}
                  onChange={e => setLinenOpForm({ ...linenOpForm, quantity: e.target.value })}
                  className="w-full mt-1 px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
                  placeholder="0"
                  min="0"
                />
                <p className="text-xs text-slate-400 mt-1">
                  {linenOpForm.operation === 'Linen Count' ? 'Counted quantity (resets in-stock)' : 'Number of pieces'}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Location</label>
                  <input
                    type="text"
                    value={linenOpForm.location}
                    onChange={e => setLinenOpForm({ ...linenOpForm, location: e.target.value })}
                    className="w-full mt-1 px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
                    placeholder="Room / Floor"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Staff</label>
                  <input
                    type="text"
                    value={linenOpForm.staff}
                    onChange={e => setLinenOpForm({ ...linenOpForm, staff: e.target.value })}
                    className="w-full mt-1 px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
                    placeholder="Staff name"
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Notes</label>
                <input
                  type="text"
                  value={linenOpForm.notes}
                  onChange={e => setLinenOpForm({ ...linenOpForm, notes: e.target.value })}
                  className="w-full mt-1 px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
                  placeholder="Optional notes"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={submitLinenOp}
                  disabled={linenOpSubmitting}
                  className="flex-1 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors disabled:opacity-50"
                >
                  {linenOpSubmitting ? 'Submitting…' : 'Apply Operation'}
                </button>
                <button
                  onClick={() => setLinenOpItem(null)}
                  className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  Cancel
                </button>
              </div>
              <p className="text-xs text-slate-400">
                Operations write to the unified stock ledger: Issue → Consumption, Return → Transfer In, Damaged/Lost → Waste, Count → Stock Count. View them in the Transfers and Stock Movements tabs.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}