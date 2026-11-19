/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Spare Parts & Tools — Engineering Portal
 * (/erp/maintenance/spare-parts).
 *
 * DB-integrated, HK-inventory-style UI with requisition workflow plus a
 * Tools registry with checkout/return to technicians.
 *
 * Tabs: Inventory, Requisitions, Consumption, Waste & Loss, Stock Movements,
 *       Stock Count, Variance Analysis, Tools
 *
 * Key design decisions (matching HK Inventory):
 *   - No "Add Part" button — parts arrive via Requisitions from Main Store.
 *   - Requisitions use the shared inventory_requisitions table with
 *     department='Engineering'. Workflow: pending → approved → completed
 *     (issued: adds stock to spare_parts + logs Restock tx + deducts main
 *     store) | rejected.
 *   - Table-based inventory listing with stock level bars, status badges.
 *   - Per-row actions: Edit, Adjust Stock, Delete.
 *   - Waste recording, stock count, consumption, variance tracking.
 *   - Tools tab: durable, trackable assets with a checkout/return lifecycle
 *     to technicians (eng_tools + eng_tool_checkouts, migration 344).
 *
 * UI aligned with HousekeepingInventoryModule — PageHeader, SectionCard,
 * StatCard, Badge, tabbed navigation, table rows.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Package, ClipboardCheck, BookOpen, AlertTriangle, Truck,
  ArrowDownUp, ClipboardList, BarChart3, Search, RefreshCw,
  Loader2, ServerCrash, X, Trash2, Check, Ban, ArrowDownToLine,
  ShoppingCart, DollarSign, AlertCircle, Pencil, Plus, Wrench,
  ArrowUpFromLine, History, Activity, Zap, ArrowRightLeft,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { useERP } from '../../context/ERPContext';
import DepartmentRequisitionForm from '../Inventory/DepartmentRequisitionForm';
import DepartmentDynamicParPanel from '../Inventory/DepartmentDynamicParPanel';
import DepartmentParOverridesPanel from '../Inventory/DepartmentParOverridesPanel';
import InterDepartmentTransferPanel from '../Inventory/InterDepartmentTransferPanel';
import { createIssue } from '../../services/inventoryService';
import {
  fetchSpareParts, updateSparePart, deleteSparePart,
  fetchSparePartTransactions, createSparePartTransaction, deleteSparePartTransaction,
  wasteSparePart, stockCountSparePart,
  fetchReorderRecommendations,
  fetchMainStoreItems,
  fetchTools, createTool, updateTool, deleteTool,
  checkoutTool, returnTool, fetchToolCheckouts, deleteToolCheckout,
  type SparePart, type SparePartTransaction, type SparePartTransactionType,
  type SparePartWasteType, type ReorderRecommendation,
  type MainStoreItem,
  type Tool, type ToolStatus, type ToolCondition, type ToolCheckout,
} from '../../services/engineeringService';

// ── Types ────────────────────────────────────────────────────────────────
type TabKey = 'inventory' | 'requisitions' | 'consumption' | 'waste' | 'movements' | 'stock-count' | 'variance' | 'tools' | 'dynamic-par' | 'par-overrides' | 'inter-dept-transfer';

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

// ── Component ────────────────────────────────────────────────────────────
export default function SparePartsInterface() {
  const { currentPropertyId, addNotification, formatAmount } = useERP();

  // Data state
  const [parts, setParts] = useState<SparePart[]>([]);
  const [transactions, setTransactions] = useState<SparePartTransaction[]>([]);
  const [requisitions, setRequisitions] = useState<SparePartRequisition[]>([]);
  const [recommendations, setRecommendations] = useState<ReorderRecommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [activeTab, setActiveTab] = useState<TabKey>('inventory');
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<string>('All');

  // Edit modal state
  const [editPart, setEditPart] = useState<SparePart | null>(null);
  const [editForm, setEditForm] = useState<Partial<SparePart>>({});

  // Adjust stock state
  const [adjustPart, setAdjustPart] = useState<SparePart | null>(null);
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustNotes, setAdjustNotes] = useState('');

  // Requisition state
  const [showReqForm, setShowReqForm] = useState(false);
  const [mainStoreItems, setMainStoreItems] = useState<MainStoreItem[]>([]);
  const [mainStoreSearch, setMainStoreSearch] = useState('');
  const [reqItems, setReqItems] = useState<{ itemId: string; itemName: string; quantity: number; unit: string; unitCost: number }[]>([]);
  const [reqNotes, setReqNotes] = useState('');
  const [reqRequestedBy, setReqRequestedBy] = useState('');

  // Waste state
  const [showWasteModal, setShowWasteModal] = useState(false);
  const [wasteSearch, setWasteSearch] = useState('');
  const [wasteForm, setWasteForm] = useState({
    partId: '',
    wasteType: 'damaged' as SparePartWasteType,
    quantity: 0,
    reason: '',
  });

  // Consumption state
  const [showConsumptionModal, setShowConsumptionModal] = useState(false);
  const [consumptionSearch, setConsumptionSearch] = useState('');
  const [consumptionForm, setConsumptionForm] = useState({
    workOrder: '',
    technician: '',
    entries: [] as { partId: string; partName: string; quantity: number; unit: string }[],
  });

  // Stock count state
  const [showStockCountModal, setShowStockCountModal] = useState(false);
  const [stockCountForm, setStockCountForm] = useState({
    counts: [] as { partId: string; partName: string; theoreticalQty: number; countedQty: number; unit: string }[],
  });

  // Tools state
  const [tools, setTools] = useState<Tool[]>([]);
  const [toolCheckouts, setToolCheckouts] = useState<ToolCheckout[]>([]);
  const [toolStatusFilter, setToolStatusFilter] = useState<string>('All');
  const [toolSearch, setToolSearch] = useState('');
  const [showToolForm, setShowToolForm] = useState(false);
  const [editingTool, setEditingTool] = useState<Tool | null>(null);
  const [toolForm, setToolForm] = useState<Partial<Tool>>({});
  const [checkoutToolItem, setCheckoutToolItem] = useState<Tool | null>(null);
  const [checkoutForm, setCheckoutForm] = useState({ technician: '', workOrder: '', expectedReturnAt: '', notes: '' });
  const [returnToolItem, setReturnToolItem] = useState<Tool | null>(null);
  const [returnForm, setReturnForm] = useState({ notes: '', condition: '' as ToolCondition | '' });
  const [showToolHistory, setShowToolHistory] = useState<Tool | null>(null);

  // ── Data loading ──────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoading(true);
    setError(null);
    try {
      const [pRes, tRes, rRes, recRes] = await Promise.all([
        fetch(`/api/eng-portal/spare-parts?propertyId=${currentPropertyId}`, { headers: authHeaders() }),
        fetch(`/api/eng-portal/spare-parts-transactions?propertyId=${currentPropertyId}`, { headers: authHeaders() }),
        fetch(`/api/eng-portal/spare-parts/requisitions?propertyId=${currentPropertyId}`, { headers: authHeaders() }),
        fetch(`/api/eng-portal/spare-parts/reorder-recommendations?propertyId=${currentPropertyId}`, { headers: authHeaders() }),
      ]);
      if (!pRes.ok) throw new Error(`Failed to load parts (${pRes.status})`);
      setParts(await pRes.json());
      if (tRes.ok) setTransactions(await tRes.json());
      if (rRes.ok) { const rj = await rRes.json(); setRequisitions(rj.requisitions || []); }
      if (recRes.ok) setRecommendations(await recRes.json());
    } catch (e: any) {
      setError(e.message || 'Failed to load spare parts data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  const fetchToolsData = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const [tl, co] = await Promise.all([
        fetchTools({ propertyId: currentPropertyId }),
        fetchToolCheckouts({ propertyId: currentPropertyId }),
      ]);
      setTools(tl);
      setToolCheckouts(co);
    } catch (e: any) {
      addNotification(e.message || 'Failed to load tools', 'warning', 'Maintenance');
    }
  }, [currentPropertyId, addNotification]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { if (activeTab === 'tools') fetchToolsData(); }, [activeTab, fetchToolsData]);

  // ── Derived data ──────────────────────────────────────────────────────
  const categories = useMemo(() => {
    const set = new Set<string>();
    parts.forEach(p => { if (p.category) set.add(p.category); });
    return Array.from(set).sort();
  }, [parts]);

  const filteredParts = useMemo(() => {
    return parts.filter(p => {
      const matchesCat = catFilter === 'All' || p.category === catFilter;
      const s = search.toLowerCase();
      const matchesSearch = !s ||
        (p.part_name || '').toLowerCase().includes(s) ||
        (p.part_number || '').toLowerCase().includes(s) ||
        (p.supplier || '').toLowerCase().includes(s) ||
        (p.location || '').toLowerCase().includes(s);
      return matchesCat && matchesSearch;
    });
  }, [parts, catFilter, search]);

  const totalItems = parts.length;
  const totalValue = parts.reduce((sum, p) => sum + (Number(p.current_stock) || 0) * (Number(p.unit_cost) || 0), 0);
  const lowStockItems = parts.filter(p => (Number(p.current_stock) || 0) <= (Number(p.reorder_point) || Number(p.min_stock) || 0) && (Number(p.current_stock) || 0) > 0).length;
  const criticalItems = parts.filter(p => (Number(p.current_stock) || 0) <= (Number(p.min_stock) || 0)).length;
  const pendingReqs = requisitions.filter(r => r.status === 'pending').length;

  // Tools derived data
  const toolCategories = useMemo(() => {
    const set = new Set<string>();
    tools.forEach(t => { if (t.category) set.add(t.category); });
    return Array.from(set).sort();
  }, [tools]);

  const filteredTools = useMemo(() => {
    return tools.filter(t => {
      const matchesStatus = toolStatusFilter === 'All' || t.status === toolStatusFilter;
      const s = toolSearch.toLowerCase();
      const matchesSearch = !s ||
        (t.tool_name || '').toLowerCase().includes(s) ||
        (t.tool_number || '').toLowerCase().includes(s) ||
        (t.serial_number || '').toLowerCase().includes(s) ||
        (t.manufacturer || '').toLowerCase().includes(s) ||
        (t.assigned_to || '').toLowerCase().includes(s) ||
        (t.location || '').toLowerCase().includes(s);
      return matchesStatus && matchesSearch;
    });
  }, [tools, toolStatusFilter, toolSearch]);

  const toolsAvailable = tools.filter(t => t.status === 'Available').length;
  const toolsCheckedOut = tools.filter(t => t.status === 'Checked Out').length;
  const toolsInRepair = tools.filter(t => t.status === 'In Repair').length;
  const toolsLostRetired = tools.filter(t => t.status === 'Lost' || t.status === 'Retired').length;
  const toolsOverdueCheckouts = toolCheckouts.filter(c => c.status === 'Overdue').length;

  // ── Tab config ────────────────────────────────────────────────────────
  const tabs = [
    { id: 'inventory' as const, label: 'Inventory', icon: Package },
    { id: 'dynamic-par' as const, label: 'Dynamic Par', icon: Activity },
    { id: 'par-overrides' as const, label: 'Par Overrides', icon: Zap },
    { id: 'requisitions' as const, label: 'Requisitions', icon: ClipboardCheck },
    { id: 'consumption' as const, label: 'Consumption', icon: BookOpen },
    { id: 'waste' as const, label: 'Waste & Loss', icon: AlertTriangle },
    { id: 'movements' as const, label: 'Stock Movements', icon: ArrowDownUp },
    { id: 'stock-count' as const, label: 'Stock Count', icon: ClipboardList },
    { id: 'variance' as const, label: 'Variance Analysis', icon: BarChart3 },
    { id: 'inter-dept-transfer' as const, label: 'Inter-Dept Transfer', icon: ArrowRightLeft },
    { id: 'tools' as const, label: 'Tools', icon: Wrench },
  ];

  const tabCounts: Record<TabKey, number | undefined> = {
    inventory: parts.length,
    'dynamic-par': undefined,
    'par-overrides': undefined,
    requisitions: pendingReqs,
    consumption: transactions.filter(t => t.transaction_type === 'Consumption' || t.transaction_type === 'Issue').length,
    waste: transactions.filter(t => t.transaction_type === 'Waste').length,
    movements: transactions.filter(t => ['Restock', 'Adjustment', 'Stock Count', 'Return'].includes(t.transaction_type)).length,
    'stock-count': undefined,
    variance: transactions.filter(t => t.transaction_type === 'Stock Count' && t.theoretical_qty !== null).length,
    tools: toolsCheckedOut + toolsOverdueCheckouts,
  };

  const stats = [
    { label: 'Total Items', value: String(totalItems), caption: `${lowStockItems} low · ${criticalItems} critical`, icon: Package, tone: 'info' },
    { label: 'Inventory Value', value: formatAmount(totalValue), caption: 'Current stock value', icon: DollarSign, tone: 'success' },
    { label: 'Low Stock', value: String(lowStockItems), caption: `${criticalItems} critical items`, icon: AlertTriangle, tone: 'warning' },
    { label: 'Critical', value: String(criticalItems), caption: 'Below minimum stock', icon: AlertCircle, tone: 'danger' },
  ];

  const toolStats = [
    { label: 'Total Tools', value: String(tools.length), caption: `${toolCategories.length} categories`, icon: Wrench, tone: 'info' },
    { label: 'Available', value: String(toolsAvailable), caption: 'Ready for checkout', icon: Check, tone: 'success' },
    { label: 'Checked Out', value: String(toolsCheckedOut), caption: `${toolsOverdueCheckouts} overdue`, icon: ArrowUpFromLine, tone: 'warning' },
    { label: 'In Repair / Lost', value: String(toolsInRepair + toolsLostRetired), caption: `${toolsInRepair} repair · ${toolsLostRetired} lost/retired`, icon: AlertTriangle, tone: 'danger' },
  ];

  // ── Edit handler ─────────────────────────────────────────────────────
  const openEdit = (part: SparePart) => {
    setEditPart(part);
    setEditForm({ ...part });
  };

  const saveEdit = async () => {
    if (!editPart) return;
    try {
      const res = await fetch(`/api/eng-portal/spare-parts/${editPart.id}`, {
        method: 'PATCH',
        headers: authHeaders(true),
        body: JSON.stringify({
          partNumber: editForm.part_number,
          partName: editForm.part_name,
          category: editForm.category,
          manufacturer: editForm.manufacturer,
          supplier: editForm.supplier,
          unit: editForm.unit,
          minStock: editForm.min_stock,
          maxStock: editForm.max_stock,
          currentStock: editForm.current_stock,
          unitCost: editForm.unit_cost,
          location: editForm.location,
          reorderQty: editForm.reorder_qty,
          reorderPoint: editForm.reorder_point,
        }),
      });
      if (!res.ok) throw new Error(`Failed to save (${res.status})`);
      addNotification('Part updated.', 'task', 'Maintenance');
      setEditPart(null);
      fetchData();
    } catch (e: any) {
      addNotification(e.message, 'warning', 'Maintenance');
    }
  };

  const removePart = async (id: string) => {
    if (!confirm('Delete this spare part?')) return;
    try {
      const res = await fetch(`/api/eng-portal/spare-parts/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to delete (${res.status})`);
      addNotification('Part deleted.', 'task', 'Maintenance');
      fetchData();
    } catch (e: any) {
      addNotification(e.message, 'warning', 'Maintenance');
    }
  };

  // ── Adjust stock handler ─────────────────────────────────────────────
  const submitAdjust = async () => {
    if (!adjustPart) return;
    const qty = Number(adjustQty);
    if (!Number.isFinite(qty) || qty === 0) {
      addNotification('Adjustment must be a non-zero number.', 'warning', 'Maintenance');
      return;
    }
    try {
      const txType: SparePartTransactionType = qty > 0 ? 'Restock' : 'Consumption';
      await createSparePartTransaction({
        propertyId: currentPropertyId,
        partId: adjustPart.id,
        transactionType: txType,
        quantity: Math.abs(qty),
        notes: adjustNotes,
      });
      addNotification(`Stock adjusted by ${qty}.`, 'task', 'Maintenance');
      setAdjustPart(null);
      setAdjustQty('');
      setAdjustNotes('');
      fetchData();
    } catch (e: any) {
      addNotification(e.message, 'warning', 'Maintenance');
    }
  };

  // ── Requisition handlers ─────────────────────────────────────────────
  const openReqForm = async () => {
    setShowReqForm(true);
    setReqItems([]);
    setReqNotes('');
    setReqRequestedBy('');
    setMainStoreSearch('');
    try {
      const res = await fetch('/api/eng-portal/spare-parts/main-store-items', { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setMainStoreItems(json.items || []);
      }
    } catch { /* ignore */ }
  };

  const addReqItem = (item: MainStoreItem) => {
    setReqItems(prev => {
      if (prev.find(r => r.itemId === item.id)) return prev;
      return [...prev, { itemId: item.id, itemName: item.name, quantity: 1, unit: item.unitOfMeasure, unitCost: item.unitCost }];
    });
  };

  const updateReqQty = (itemId: string, qty: number) => {
    setReqItems(prev => prev.map(r => r.itemId === itemId ? { ...r, quantity: qty } : r));
  };

  const removeReqItem = (itemId: string) => {
    setReqItems(prev => prev.filter(r => r.itemId !== itemId));
  };

  const submitRequisition = async () => {
    if (!currentPropertyId || !reqRequestedBy || reqItems.length === 0) {
      addNotification('Requested by and at least one item are required.', 'warning', 'Maintenance');
      return;
    }
    try {
      await createIssue({
        property_id: currentPropertyId,
        department: 'Engineering',
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
      addNotification('Requisition sent to Inventory for approval.', 'task', 'Maintenance');
      setShowReqForm(false);
      setReqItems([]);
      setReqNotes('');
      setReqRequestedBy('');
      fetchData();
    } catch (e: any) {
      addNotification(e.message || 'Failed to create requisition', 'warning', 'Maintenance');
    }
  };

  // Requisition approve/issue/reject are now handled by the Inventory portal.
  // Departments can only create and view requisition status.

  const filteredMainStoreItems = useMemo(() => {
    const s = mainStoreSearch.toLowerCase();
    if (!s) return mainStoreItems.slice(0, 20);
    return mainStoreItems.filter(i => i.name.toLowerCase().includes(s)).slice(0, 30);
  }, [mainStoreItems, mainStoreSearch]);

  // ── Waste handler ────────────────────────────────────────────────────
  const submitWaste = async () => {
    if (!wasteForm.partId) { addNotification('Please select a part', 'warning', 'Maintenance'); return; }
    if (!wasteForm.quantity || wasteForm.quantity <= 0) { addNotification('Please enter a valid quantity', 'warning', 'Maintenance'); return; }
    try {
      await wasteSparePart(wasteForm.partId, {
        wasteType: wasteForm.wasteType,
        quantity: wasteForm.quantity,
        reason: wasteForm.reason,
      });
      addNotification('Waste recorded.', 'task', 'Maintenance');
      setShowWasteModal(false);
      setWasteForm({ partId: '', wasteType: 'damaged', quantity: 0, reason: '' });
      fetchData();
    } catch (e: any) {
      addNotification(e.message, 'warning', 'Maintenance');
    }
  };

  // ── Consumption handler ──────────────────────────────────────────────
  const addConsumptionItem = (part: SparePart) => {
    setConsumptionForm(prev => ({
      ...prev,
      entries: [...prev.entries, { partId: part.id, partName: part.part_name, quantity: 1, unit: part.unit }],
    }));
  };

  const updateConsumptionQty = (partId: string, qty: number) => {
    setConsumptionForm(prev => ({
      ...prev,
      entries: prev.entries.map(e => e.partId === partId ? { ...e, quantity: qty } : e),
    }));
  };

  const removeConsumptionItem = (partId: string) => {
    setConsumptionForm(prev => ({ ...prev, entries: prev.entries.filter(e => e.partId !== partId) }));
  };

  const submitConsumption = async () => {
    if (consumptionForm.entries.length === 0) { addNotification('Add at least one item', 'warning', 'Maintenance'); return; }
    try {
      for (const entry of consumptionForm.entries) {
        await createSparePartTransaction({
          propertyId: currentPropertyId,
          partId: entry.partId,
          transactionType: 'Consumption',
          quantity: entry.quantity,
          workOrder: consumptionForm.workOrder || undefined,
          technician: consumptionForm.technician || undefined,
        });
      }
      addNotification(`Consumption recorded: ${consumptionForm.entries.length} items.`, 'task', 'Maintenance');
      setShowConsumptionModal(false);
      setConsumptionForm({ workOrder: '', technician: '', entries: [] });
      fetchData();
    } catch (e: any) {
      addNotification(e.message, 'warning', 'Maintenance');
    }
  };

  // ── Stock count handler ──────────────────────────────────────────────
  const startStockCount = () => {
    setStockCountForm({
      counts: filteredParts.map(p => ({
        partId: p.id,
        partName: p.part_name,
        theoreticalQty: Number(p.current_stock) || 0,
        countedQty: Number(p.current_stock) || 0,
        unit: p.unit,
      })),
    });
    setShowStockCountModal(true);
  };

  const updateStockCount = (partId: string, counted: number) => {
    setStockCountForm(prev => ({
      ...prev,
      counts: prev.counts.map(c => c.partId === partId ? { ...c, countedQty: counted } : c),
    }));
  };

  const submitStockCount = async () => {
    const changed = stockCountForm.counts.filter(c => c.countedQty !== c.theoreticalQty);
    if (changed.length === 0) { addNotification('No variances detected — all counts match system.', 'task', 'Maintenance'); setShowStockCountModal(false); return; }
    try {
      for (const c of changed) {
        await stockCountSparePart(c.partId, { actualQty: c.countedQty });
      }
      addNotification(`Stock count posted: ${changed.length} variance(s).`, 'task', 'Maintenance');
      setShowStockCountModal(false);
      fetchData();
    } catch (e: any) {
      addNotification(e.message, 'warning', 'Maintenance');
    }
  };

  // ── Delete transaction ───────────────────────────────────────────────
  const removeTransaction = async (id: string) => {
    try {
      await deleteSparePartTransaction(id);
      addNotification('Transaction deleted.', 'task', 'Maintenance');
      fetchData();
    } catch (e: any) {
      addNotification(e.message, 'warning', 'Maintenance');
    }
  };

  // ── Tool handlers ────────────────────────────────────────────────────
  const openNewToolForm = () => {
    setEditingTool(null);
    setToolForm({
      tool_number: `TL-${String(tools.length + 1).padStart(3, '0')}`,
      tool_name: '', category: '', manufacturer: '', model: '',
      serial_number: '', location: '', status: 'Available', condition: 'Good',
      assigned_to: '', purchase_cost: 0, notes: '',
    });
    setShowToolForm(true);
  };

  const openEditToolForm = (tool: Tool) => {
    setEditingTool(tool);
    setToolForm({ ...tool });
    setShowToolForm(true);
  };

  const saveTool = async () => {
    if (!toolForm.tool_name || !toolForm.tool_number) {
      addNotification('Tool name and number are required.', 'warning', 'Maintenance');
      return;
    }
    try {
      if (editingTool) {
        await updateTool(editingTool.id, {
          toolNumber: toolForm.tool_number,
          toolName: toolForm.tool_name,
          category: toolForm.category,
          manufacturer: toolForm.manufacturer,
          model: toolForm.model,
          serialNumber: toolForm.serial_number,
          location: toolForm.location,
          status: toolForm.status,
          condition: toolForm.condition,
          assignedTo: toolForm.assigned_to || null,
          purchaseDate: toolForm.purchase_date,
          purchaseCost: toolForm.purchase_cost,
          calibrationDueDate: toolForm.calibration_due_date,
          notes: toolForm.notes,
        });
        addNotification('Tool updated.', 'task', 'Maintenance');
      } else {
        await createTool({
          propertyId: currentPropertyId,
          toolNumber: toolForm.tool_number,
          toolName: toolForm.tool_name,
          category: toolForm.category,
          manufacturer: toolForm.manufacturer,
          model: toolForm.model,
          serialNumber: toolForm.serial_number,
          location: toolForm.location,
          status: toolForm.status || 'Available',
          condition: toolForm.condition || 'Good',
          assignedTo: toolForm.assigned_to || null,
          purchaseDate: toolForm.purchase_date,
          purchaseCost: toolForm.purchase_cost,
          calibrationDueDate: toolForm.calibration_due_date,
          notes: toolForm.notes,
        });
        addNotification('Tool added.', 'task', 'Maintenance');
      }
      setShowToolForm(false);
      fetchToolsData();
    } catch (e: any) {
      addNotification(e.message, 'warning', 'Maintenance');
    }
  };

  const removeTool = async (id: string) => {
    if (!confirm('Delete this tool? Its checkout history will also be removed.')) return;
    try {
      await deleteTool(id);
      addNotification('Tool deleted.', 'task', 'Maintenance');
      fetchToolsData();
    } catch (e: any) {
      addNotification(e.message, 'warning', 'Maintenance');
    }
  };

  const setToolStatus = async (tool: Tool, status: ToolStatus) => {
    try {
      await updateTool(tool.id, { status, assignedTo: status === 'Available' ? null : tool.assigned_to });
      addNotification(`Tool marked ${status}.`, 'task', 'Maintenance');
      fetchToolsData();
    } catch (e: any) {
      addNotification(e.message, 'warning', 'Maintenance');
    }
  };

  const openCheckout = (tool: Tool) => {
    setCheckoutToolItem(tool);
    const defaultReturn = new Date();
    defaultReturn.setDate(defaultReturn.getDate() + 7);
    setCheckoutForm({
      technician: tool.assigned_to || '',
      workOrder: '',
      expectedReturnAt: defaultReturn.toISOString().slice(0, 10),
      notes: '',
    });
  };

  const submitCheckout = async () => {
    if (!checkoutToolItem) return;
    if (!checkoutForm.technician) {
      addNotification('Technician is required.', 'warning', 'Maintenance');
      return;
    }
    try {
      await checkoutTool(checkoutToolItem.id, {
        technician: checkoutForm.technician,
        workOrder: checkoutForm.workOrder || undefined,
        expectedReturnAt: checkoutForm.expectedReturnAt
          ? new Date(checkoutForm.expectedReturnAt).toISOString()
          : undefined,
        notes: checkoutForm.notes || undefined,
        propertyId: currentPropertyId,
      });
      addNotification(`Tool checked out to ${checkoutForm.technician}.`, 'task', 'Maintenance');
      setCheckoutToolItem(null);
      fetchToolsData();
    } catch (e: any) {
      addNotification(e.message, 'warning', 'Maintenance');
    }
  };

  const openReturn = (tool: Tool) => {
    setReturnToolItem(tool);
    setReturnForm({ notes: '', condition: tool.condition });
  };

  const submitReturn = async () => {
    if (!returnToolItem) return;
    try {
      await returnTool(returnToolItem.id, {
        notes: returnForm.notes || undefined,
        condition: returnForm.condition || undefined,
      });
      addNotification('Tool returned and marked Available.', 'task', 'Maintenance');
      setReturnToolItem(null);
      fetchToolsData();
    } catch (e: any) {
      addNotification(e.message, 'warning', 'Maintenance');
    }
  };

  const removeCheckout = async (id: string) => {
    if (!confirm('Delete this checkout record?')) return;
    try {
      await deleteToolCheckout(id);
      addNotification('Checkout record deleted.', 'task', 'Maintenance');
      fetchToolsData();
    } catch (e: any) {
      addNotification(e.message, 'warning', 'Maintenance');
    }
  };

  const toolStatusTone = (status: ToolStatus): string => {
    switch (status) {
      case 'Available': return 'success';
      case 'Checked Out': return 'info';
      case 'In Repair': return 'warning';
      case 'Lost': return 'danger';
      case 'Retired': return 'neutral';
      default: return 'neutral';
    }
  };

  const toolConditionTone = (condition: ToolCondition): string => {
    switch (condition) {
      case 'New': return 'success';
      case 'Good': return 'info';
      case 'Fair': return 'warning';
      case 'Poor': return 'danger';
      default: return 'neutral';
    }
  };

  const activeCheckoutForTool = (toolId: string): ToolCheckout | undefined =>
    toolCheckouts.find(c => c.tool_id === toolId && (c.status === 'Active' || c.status === 'Overdue'));

  // ── Helpers ──────────────────────────────────────────────────────────
  const getStatus = (p: SparePart): { label: string; tone: string } => {
    const cur = Number(p.current_stock) || 0;
    const min = Number(p.min_stock) || 0;
    const reorder = Number(p.reorder_point) || min;
    if (cur === 0) return { label: 'out_of_stock', tone: 'danger' };
    if (cur <= min) return { label: 'critical', tone: 'danger' };
    if (cur <= reorder) return { label: 'low', tone: 'warning' };
    return { label: 'normal', tone: 'success' };
  };

  const stockPercent = (p: SparePart): number => {
    const cur = Number(p.current_stock) || 0;
    const max = Number(p.max_stock) || 0;
    if (max <= 0) return 50;
    return Math.min(100, Math.round((cur / max) * 100));
  };

  const fmtDate = (s: string | null): string => {
    if (!s) return '—';
    const d = new Date(s);
    return isNaN(d.getTime()) ? s : d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  };

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title="Spare Parts & Tools"
        subtitle="Engineering spare parts inventory with requisitions from main store, plus tools registry with checkout/return"
        icon={Package}
        actions={
          <div className="flex gap-2">
            {activeTab === 'requisitions' && (
              <button onClick={openReqForm} className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors">
                <ShoppingCart size={14} className="inline-block mr-1" /> Request from Store
              </button>
            )}
            {activeTab === 'waste' && (
              <button onClick={() => setShowWasteModal(true)} className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                <AlertTriangle size={14} className="inline-block mr-1" /> Record Waste
              </button>
            )}
            {activeTab === 'stock-count' && (
              <button onClick={startStockCount} className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                <ClipboardList size={14} className="inline-block mr-1" /> Start Stock Count
              </button>
            )}
            {activeTab === 'consumption' && (
              <button onClick={() => setShowConsumptionModal(true)} className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                <BookOpen size={14} className="inline-block mr-1" /> Record Consumption
              </button>
            )}
            {activeTab === 'tools' && (
              <button onClick={openNewToolForm} className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                <Plus size={14} className="inline-block mr-1" /> New Tool
              </button>
            )}
          </div>
        }
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {(activeTab === 'tools' ? toolStats : stats).map((stat) => (
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

      {/* Reorder recommendations alert */}
      {recommendations.length > 0 && (
        <div className="flex items-center gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <div className="flex-1 text-sm">
            <span className="font-medium text-amber-700 dark:text-amber-400">
              {recommendations.length} part(s) need reordering — submit a requisition from Main Store.
            </span>
          </div>
          <button
            onClick={() => setActiveTab('requisitions')}
            className="text-sm px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors flex-shrink-0"
          >
            View Requisitions
          </button>
        </div>
      )}

      {/* Critical stock alert */}
      {criticalItems > 0 && (
        <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
          <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
          <div className="flex-1 text-sm">
            <span className="font-medium text-red-700 dark:text-red-400">
              {criticalItems} part(s) at or below minimum stock
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

      {/* Filter Bar — Spare Parts tabs */}
      {(activeTab === 'inventory' || activeTab === 'stock-count' || activeTab === 'movements' || activeTab === 'waste' || activeTab === 'variance' || activeTab === 'consumption') && (
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
            <label className="text-sm text-slate-600 dark:text-slate-400">Category:</label>
            <select
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
            >
              <option value="All">All Categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button onClick={fetchData} className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors" disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      )}

      {/* Filter Bar — Tools tab */}
      {activeTab === 'tools' && (
        <div className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-gray-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search tools..."
              value={toolSearch}
              onChange={(e) => setToolSearch(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white w-48"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600 dark:text-slate-400">Status:</label>
            <select
              value={toolStatusFilter}
              onChange={(e) => setToolStatusFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
            >
              <option value="All">All Statuses</option>
              <option value="Available">Available</option>
              <option value="Checked Out">Checked Out</option>
              <option value="In Repair">In Repair</option>
              <option value="Lost">Lost</option>
              <option value="Retired">Retired</option>
            </select>
          </div>
          <button onClick={fetchToolsData} className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      )}

      {loading && <div className="p-8 flex justify-center"><Loader2 size={20} className="animate-spin text-gray-400" /></div>}
      {error && !loading && (
        <div className="p-8 text-center text-sm text-red-500">
          <ServerCrash className="w-5 h-5 mx-auto mb-2" />
          {error}
          <button onClick={fetchData} className="ml-2 text-indigo-600 underline">Retry</button>
        </div>
      )}

      {/* ── Dynamic Par Tab ───────────────────────────────────────────── */}
      {!loading && !error && activeTab === 'dynamic-par' && (
        <DepartmentDynamicParPanel department="Engineering" />
      )}

      {/* ── Manual Par Overrides Tab ──────────────────────────────────── */}
      {!loading && !error && activeTab === 'par-overrides' && (
        <DepartmentParOverridesPanel department="Engineering" />
      )}

      {/* ── Inventory Tab ──────────────────────────────────────────────── */}
      {!loading && !error && activeTab === 'inventory' && (
        <SectionCard title="Spare Parts Listing" subtitle="All engineering parts by location and category">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Part Name</th>
                  <th className="px-4 py-3 font-medium">Part #</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">Stock Level</th>
                  <th className="px-4 py-3 font-medium">Qty</th>
                  <th className="px-4 py-3 font-medium">Unit</th>
                  <th className="px-4 py-3 font-medium">Unit Cost</th>
                  <th className="px-4 py-3 font-medium">Stock Value</th>
                  <th className="px-4 py-3 font-medium">Supplier</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {filteredParts.length === 0 ? (
                  <tr><td colSpan={12} className="px-4 py-8 text-center text-slate-500">No spare parts in inventory. Submit a requisition from Main Store to add parts.</td></tr>
                ) : filteredParts.map(p => {
                  const status = getStatus(p);
                  const pct = stockPercent(p);
                  const stockValue = (Number(p.current_stock) || 0) * (Number(p.unit_cost) || 0);
                  const barColor = status.tone === 'danger' ? 'bg-red-500' : status.tone === 'warning' ? 'bg-amber-500' : 'bg-green-500';
                  return (
                    <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{p.part_name}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400 font-mono text-xs">{p.part_number || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{p.category || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{p.location || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="w-24">
                          <div className="h-2 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5">min: {p.min_stock} · reorder: {p.reorder_point || p.min_stock}</div>
                        </div>
                      </td>
                      <td className="px-4 py-3"><span className="font-medium text-slate-900 dark:text-white">{p.current_stock}</span></td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{p.unit}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{formatAmount(Number(p.unit_cost) || 0)}</td>
                      <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-300">{formatAmount(stockValue)}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{p.supplier || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[var(--color-${status.tone})]/10 text-[var(--color-${status.tone})]`}>
                          {status.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEdit(p)} className="p-1 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors" title="Edit"><Pencil className="w-4 h-4" /></button>
                          <button onClick={() => { setAdjustPart(p); setAdjustQty(''); setAdjustNotes(''); }} className="p-1 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors" title="Adjust stock"><ArrowDownUp className="w-4 h-4" /></button>
                          <button onClick={() => removePart(p.id)} className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors" title="Delete"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-slate-50 dark:bg-slate-900/40 border-t-2 border-slate-300 dark:border-slate-500">
                <tr>
                  <td colSpan={8} className="px-4 py-3 text-right text-slate-600 dark:text-slate-400 font-medium">{filteredParts.length} items — Total Stock Value:</td>
                  <td className="px-4 py-3 font-bold text-indigo-600 dark:text-indigo-400">
                    {formatAmount(filteredParts.reduce((sum, p) => sum + (Number(p.current_stock) || 0) * (Number(p.unit_cost) || 0), 0))}
                  </td>
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </SectionCard>
      )}

      {/* ── Requisitions Tab — unified uinv_* system ──────────────────── */}
      {!loading && !error && activeTab === 'requisitions' && (
        <DepartmentRequisitionForm department="Engineering" />
      )}

      {/* ── Consumption Tab ───────────────────────────────────────────── */}
      {!loading && !error && activeTab === 'consumption' && (
        <SectionCard title="Consumption Log" subtitle="Parts consumed during maintenance work">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Part</th>
                  <th className="px-4 py-3 font-medium">Quantity</th>
                  <th className="px-4 py-3 font-medium">Cost</th>
                  <th className="px-4 py-3 font-medium">Work Order</th>
                  <th className="px-4 py-3 font-medium">Technician</th>
                  <th className="px-4 py-3 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {(() => {
                  const cons = transactions.filter(t => t.transaction_type === 'Consumption' || t.transaction_type === 'Issue');
                  if (cons.length === 0) return <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">No consumption recorded yet.</td></tr>;
                  return cons.map(t => {
                    const partName = parts.find(p => p.id === t.part_id)?.part_name || t.part_id;
                    return (
                      <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{fmtDate(t.transaction_date)}</td>
                        <td className="px-4 py-3"><Badge tone={t.transaction_type === 'Issue' ? 'warning' : 'danger'}>{t.transaction_type}</Badge></td>
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{partName}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.quantity}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{formatAmount(Number(t.total_cost) || 0)}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.work_order || '—'}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.technician || '—'}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.notes || '—'}</td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* ── Waste Tab ─────────────────────────────────────────────────── */}
      {!loading && !error && activeTab === 'waste' && (
        <SectionCard title="Waste & Loss Log" subtitle="Damaged, expired, lost, or obsolete parts">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Part</th>
                  <th className="px-4 py-3 font-medium">Waste Type</th>
                  <th className="px-4 py-3 font-medium">Quantity</th>
                  <th className="px-4 py-3 font-medium">Cost Lost</th>
                  <th className="px-4 py-3 font-medium">Reason</th>
                  <th className="px-4 py-3 font-medium">Performed By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {(() => {
                  const waste = transactions.filter(t => t.transaction_type === 'Waste');
                  if (waste.length === 0) return <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">No waste recorded yet.</td></tr>;
                  return waste.map(t => {
                    const partName = parts.find(p => p.id === t.part_id)?.part_name || t.part_id;
                    return (
                      <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{fmtDate(t.transaction_date)}</td>
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{partName}</td>
                        <td className="px-4 py-3"><Badge tone="danger">{t.waste_type || 'other'}</Badge></td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.quantity}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{formatAmount(Number(t.total_cost) || 0)}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.reason || '—'}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.performed_by || '—'}</td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* ── Stock Movements Tab ──────────────────────────────────────── */}
      {!loading && !error && activeTab === 'movements' && (
        <SectionCard title="Stock Movements" subtitle="Restocks, Adjustments, Returns, Stock Counts">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Part</th>
                  <th className="px-4 py-3 font-medium">Quantity</th>
                  <th className="px-4 py-3 font-medium">Cost</th>
                  <th className="px-4 py-3 font-medium">Reference</th>
                  <th className="px-4 py-3 font-medium">Performed By</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {(() => {
                  const movTypes = ['Restock', 'Adjustment', 'Stock Count', 'Return'];
                  const movs = transactions.filter(t => movTypes.includes(t.transaction_type));
                  if (movs.length === 0) return <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">No stock movements recorded yet.</td></tr>;
                  return movs.map(t => {
                    const partName = parts.find(p => p.id === t.part_id)?.part_name || t.part_id;
                    return (
                      <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{fmtDate(t.transaction_date)}</td>
                        <td className="px-4 py-3">
                          <Badge tone={
                            t.transaction_type === 'Restock' || t.transaction_type === 'Return' ? 'success'
                            : t.transaction_type === 'Adjustment' ? 'info'
                            : 'neutral'
                          }>
                            {t.transaction_type}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{partName}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.quantity}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{formatAmount(Number(t.total_cost) || 0)}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.reference_number || '—'}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.performed_by || '—'}</td>
                        <td className="px-4 py-3">
                          <button onClick={() => removeTransaction(t.id)} className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors" title="Delete"><Trash2 className="w-4 h-4" /></button>
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* ── Stock Count Tab ───────────────────────────────────────────── */}
      {!loading && !error && activeTab === 'stock-count' && (
        <SectionCard title="Stock Count" subtitle="Current system quantities — click Start Stock Count to reconcile">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Part Name</th>
                  <th className="px-4 py-3 font-medium">Part #</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">System Qty</th>
                  <th className="px-4 py-3 font-medium">Unit</th>
                  <th className="px-4 py-3 font-medium">Last Count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {filteredParts.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No parts to count.</td></tr>
                ) : filteredParts.map(p => {
                  const lastCount = transactions.find(t => t.transaction_type === 'Stock Count' && t.part_id === p.id);
                  return (
                    <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{p.part_name}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400 font-mono text-xs">{p.part_number || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{p.location || '—'}</td>
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{p.current_stock}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{p.unit}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{lastCount ? fmtDate(lastCount.transaction_date) : 'Never'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* ── Variance Analysis Tab ─────────────────────────────────────── */}
      {!loading && !error && activeTab === 'variance' && (
        <SectionCard title="Variance Analysis" subtitle="Discrepancies found during stock counts">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Part</th>
                  <th className="px-4 py-3 font-medium">Theoretical</th>
                  <th className="px-4 py-3 font-medium">Actual</th>
                  <th className="px-4 py-3 font-medium">Variance</th>
                  <th className="px-4 py-3 font-medium">Variance %</th>
                  <th className="px-4 py-3 font-medium">Cost Impact</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {(() => {
                  const varTx = transactions.filter(t => t.transaction_type === 'Stock Count' && t.theoretical_qty !== null && t.actual_qty !== null);
                  if (varTx.length === 0) return <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">No variances recorded yet. Run a stock count to detect discrepancies.</td></tr>;
                  return varTx.map(t => {
                    const partName = parts.find(p => p.id === t.part_id)?.part_name || t.part_id;
                    const theoretical = Number(t.theoretical_qty) || 0;
                    const actual = Number(t.actual_qty) || 0;
                    const variance = actual - theoretical;
                    const variancePct = theoretical > 0 ? ((variance / theoretical) * 100).toFixed(1) : '0';
                    const part = parts.find(p => p.id === t.part_id);
                    const costImpact = Math.abs(variance) * (Number(part?.unit_cost) || 0);
                    return (
                      <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{fmtDate(t.transaction_date)}</td>
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{partName}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{theoretical}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{actual}</td>
                        <td className="px-4 py-3">
                          <span className={`font-medium ${variance === 0 ? 'text-slate-500' : variance > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {variance > 0 ? '+' : ''}{variance}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{variancePct}%</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{formatAmount(costImpact)}</td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* ── Inter-Department Transfer Tab ─────────────────────────────── */}
      {!loading && !error && activeTab === 'inter-dept-transfer' && (
        <InterDepartmentTransferPanel sourceDepartment="Engineering" />
      )}

      {/* ── Tools Tab ─────────────────────────────────────────────────── */}
      {!loading && !error && activeTab === 'tools' && (
        <SectionCard title="Tools Registry" subtitle="Durable tools with checkout/return tracking to technicians">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Tool #</th>
                  <th className="px-4 py-3 font-medium">Tool Name</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Manufacturer / Model</th>
                  <th className="px-4 py-3 font-medium">Serial #</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">Condition</th>
                  <th className="px-4 py-3 font-medium">Assigned To</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {filteredTools.length === 0 ? (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-500">No tools found. Click "New Tool" to add one.</td></tr>
                ) : filteredTools.map(t => {
                  const activeCo = activeCheckoutForTool(t.id);
                  return (
                    <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400 font-mono text-xs">{t.tool_number}</td>
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{t.tool_name}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.category || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                        {t.manufacturer || '—'}{t.model ? ` / ${t.model}` : ''}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400 font-mono text-xs">{t.serial_number || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.location || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[var(--color-${toolConditionTone(t.condition)})]/10 text-[var(--color-${toolConditionTone(t.condition)})]`}>
                          {t.condition}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                        {t.assigned_to || '—'}
                        {activeCo && activeCo.status === 'Overdue' && (
                          <span className="ml-1 text-xs text-red-600 dark:text-red-400">(overdue)</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[var(--color-${toolStatusTone(t.status)})]/10 text-[var(--color-${toolStatusTone(t.status)})]`}>
                          {t.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {t.status === 'Available' && (
                            <button onClick={() => openCheckout(t)} className="p-1 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors" title="Check Out"><ArrowUpFromLine className="w-4 h-4" /></button>
                          )}
                          {t.status === 'Checked Out' && (
                            <button onClick={() => openReturn(t)} className="p-1 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors" title="Return"><ArrowDownToLine className="w-4 h-4" /></button>
                          )}
                          {t.status === 'In Repair' && (
                            <button onClick={() => setToolStatus(t, 'Available')} className="p-1 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors" title="Mark Available"><Check className="w-4 h-4" /></button>
                          )}
                          {t.status !== 'In Repair' && t.status !== 'Checked Out' && (
                            <button onClick={() => setToolStatus(t, 'In Repair')} className="p-1 text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors" title="Mark In Repair"><Wrench className="w-4 h-4" /></button>
                          )}
                          {t.status !== 'Lost' && t.status !== 'Retired' && (
                            <button onClick={() => setToolStatus(t, 'Lost')} className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors" title="Mark Lost"><AlertTriangle className="w-4 h-4" /></button>
                          )}
                          <button onClick={() => openEditToolForm(t)} className="p-1 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors" title="Edit"><Pencil className="w-4 h-4" /></button>
                          <button onClick={() => setShowToolHistory(t)} className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors" title="Checkout History"><History className="w-4 h-4" /></button>
                          <button onClick={() => removeTool(t.id)} className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors" title="Delete"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* ── Edit Part Modal ───────────────────────────────────────────── */}
      {editPart && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Edit Part: {editPart.part_name}</h2>
              <button onClick={() => setEditPart(null)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Part Name</label>
                  <input value={editForm.part_name || ''} onChange={e => setEditForm(f => ({ ...f, part_name: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Part Number</label>
                  <input value={editForm.part_number || ''} onChange={e => setEditForm(f => ({ ...f, part_number: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Category</label>
                  <input value={editForm.category || ''} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Supplier</label>
                  <input value={editForm.supplier || ''} onChange={e => setEditForm(f => ({ ...f, supplier: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Manufacturer</label>
                  <input value={editForm.manufacturer || ''} onChange={e => setEditForm(f => ({ ...f, manufacturer: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Location</label>
                  <input value={editForm.location || ''} onChange={e => setEditForm(f => ({ ...f, location: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Unit</label>
                  <input value={editForm.unit || ''} onChange={e => setEditForm(f => ({ ...f, unit: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Unit Cost</label>
                  <input type="number" step="0.01" value={editForm.unit_cost ?? 0} onChange={e => setEditForm(f => ({ ...f, unit_cost: Number(e.target.value) || 0 }))} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Current Stock</label>
                  <input type="number" value={editForm.current_stock ?? 0} onChange={e => setEditForm(f => ({ ...f, current_stock: Number(e.target.value) || 0 }))} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Min Stock</label>
                  <input type="number" value={editForm.min_stock ?? 0} onChange={e => setEditForm(f => ({ ...f, min_stock: Number(e.target.value) || 0 }))} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Max Stock</label>
                  <input type="number" value={editForm.max_stock ?? 0} onChange={e => setEditForm(f => ({ ...f, max_stock: Number(e.target.value) || 0 }))} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Reorder Point</label>
                  <input type="number" value={editForm.reorder_point ?? 0} onChange={e => setEditForm(f => ({ ...f, reorder_point: Number(e.target.value) || 0 }))} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Reorder Qty</label>
                  <input type="number" value={editForm.reorder_qty ?? 0} onChange={e => setEditForm(f => ({ ...f, reorder_qty: Number(e.target.value) || 0 }))} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <button onClick={saveEdit} className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">Save</button>
                <button onClick={() => setEditPart(null)} className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Adjust Stock Modal ────────────────────────────────────────── */}
      {adjustPart && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Adjust Stock: {adjustPart.part_name}</h2>
              <button onClick={() => setAdjustPart(null)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <p className="text-sm text-slate-600 dark:text-slate-400">Current stock: {adjustPart.current_stock} {adjustPart.unit}</p>
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
                <button onClick={() => setAdjustPart(null)} className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Requisition Form Modal ────────────────────────────────────── */}
      {showReqForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Request from Main Store</h2>
              <button onClick={() => setShowReqForm(false)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"><X className="w-5 h-5" /></button>
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
                      <span className="text-xs text-slate-400">{formatAmount(r.unitCost)}/unit</span>
                      <input type="number" value={r.quantity} onChange={e => updateReqQty(r.itemId, Number(e.target.value))} className="w-24 px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm" placeholder="Qty" />
                      <button onClick={() => removeReqItem(r.itemId)} className="p-1 text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                  <div className="text-right text-sm font-medium text-slate-600 dark:text-slate-400 pt-2">
                    Total: {formatAmount(reqItems.reduce((sum, r) => sum + r.quantity * r.unitCost, 0))}
                  </div>
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

      {/* ── Waste Modal ──────────────────────────────────────────────── */}
      {showWasteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Record Waste</h2>
              <button onClick={() => setShowWasteModal(false)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Part</label>
                {wasteForm.partId ? (
                  <div className="flex items-center gap-2 p-3 bg-slate-50 dark:bg-slate-900/40 rounded-lg">
                    <span className="flex-1 text-sm">{parts.find(p => p.id === wasteForm.partId)?.part_name || 'Unknown'}</span>
                    <button onClick={() => setWasteForm({ ...wasteForm, partId: '' })} className="p-1 text-slate-400 hover:text-red-600"><X className="w-4 h-4" /></button>
                  </div>
                ) : (
                  <>
                    <input type="text" value={wasteSearch} onChange={e => setWasteSearch(e.target.value)} placeholder="Search parts..." className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white mb-2" />
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {filteredParts
                        .filter(p => { const s = wasteSearch.toLowerCase(); return !s || p.part_name.toLowerCase().includes(s) || (p.category || '').toLowerCase().includes(s); })
                        .map(p => (
                          <button key={p.id} onClick={() => setWasteForm({ ...wasteForm, partId: p.id })} className="w-full text-left px-3 py-2 bg-slate-50 dark:bg-slate-900/40 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-sm flex justify-between">
                            <span>{p.part_name}</span>
                            <span className="text-slate-400">{p.current_stock} {p.unit}</span>
                          </button>
                        ))}
                    </div>
                  </>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Waste Type</label>
                <select value={wasteForm.wasteType} onChange={e => setWasteForm({ ...wasteForm, wasteType: e.target.value as SparePartWasteType })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white">
                  <option value="damaged">Damaged</option>
                  <option value="expired">Expired</option>
                  <option value="lost">Lost</option>
                  <option value="obsolete">Obsolete</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Quantity</label>
                <input type="number" value={wasteForm.quantity || ''} onChange={e => setWasteForm({ ...wasteForm, quantity: Number(e.target.value) || 0 })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Reason</label>
                <input value={wasteForm.reason} onChange={e => setWasteForm({ ...wasteForm, reason: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
              </div>
              <div className="flex gap-3 pt-4">
                <button onClick={submitWaste} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">Record Waste</button>
                <button onClick={() => setShowWasteModal(false)} className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Consumption Modal ─────────────────────────────────────────── */}
      {showConsumptionModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Record Consumption</h2>
              <button onClick={() => setShowConsumptionModal(false)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Work Order</label>
                  <input value={consumptionForm.workOrder} onChange={e => setConsumptionForm(f => ({ ...f, workOrder: e.target.value }))} placeholder="WO-2026-001" className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Technician</label>
                  <input value={consumptionForm.technician} onChange={e => setConsumptionForm(f => ({ ...f, technician: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">Add Parts</label>
                <input type="text" value={consumptionSearch} onChange={e => setConsumptionSearch(e.target.value)} placeholder="Search parts..." className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white mb-2" />
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {filteredParts
                    .filter(p => { const s = consumptionSearch.toLowerCase(); return !s || p.part_name.toLowerCase().includes(s); })
                    .filter(p => !consumptionForm.entries.find(e => e.partId === p.id))
                    .slice(0, 15)
                    .map(p => (
                      <button key={p.id} onClick={() => addConsumptionItem(p)} className="w-full text-left px-3 py-2 bg-slate-50 dark:bg-slate-900/40 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-sm flex justify-between">
                        <span>{p.part_name}</span>
                        <span className="text-slate-400">{p.current_stock} {p.unit}</span>
                      </button>
                    ))}
                </div>
              </div>
              {consumptionForm.entries.length > 0 && (
                <div className="space-y-2">
                  {consumptionForm.entries.map(e => (
                    <div key={e.partId} className="flex items-center gap-2 p-3 bg-slate-50 dark:bg-slate-900/40 rounded-lg">
                      <span className="flex-1 text-sm">{e.partName}</span>
                      <input type="number" value={e.quantity} onChange={ev => updateConsumptionQty(e.partId, Number(ev.target.value))} className="w-24 px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm" placeholder="Qty" />
                      <button onClick={() => removeConsumptionItem(e.partId)} className="p-1 text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-3 pt-4">
                <button onClick={submitConsumption} className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">Record Consumption</button>
                <button onClick={() => setShowConsumptionModal(false)} className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Stock Count Modal ─────────────────────────────────────────── */}
      {showStockCountModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Stock Count</h2>
              <button onClick={() => setShowStockCountModal(false)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <p className="text-sm text-slate-600 dark:text-slate-400">Enter the actual counted quantity for each part. Variances will be logged automatically.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Part</th>
                      <th className="px-4 py-3 font-medium">System Qty</th>
                      <th className="px-4 py-3 font-medium">Counted Qty</th>
                      <th className="px-4 py-3 font-medium">Variance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                    {stockCountForm.counts.map(c => {
                      const variance = c.countedQty - c.theoreticalQty;
                      return (
                        <tr key={c.partId}>
                          <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{c.partName}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{c.theoreticalQty} {c.unit}</td>
                          <td className="px-4 py-3">
                            <input type="number" value={c.countedQty} onChange={e => updateStockCount(c.partId, Number(e.target.value) || 0)} className="w-24 px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm" />
                          </td>
                          <td className="px-4 py-3">
                            <span className={`font-medium ${variance === 0 ? 'text-slate-500' : variance > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {variance > 0 ? '+' : ''}{variance}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-3 pt-4">
                <button onClick={submitStockCount} className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">Submit Stock Count</button>
                <button onClick={() => setShowStockCountModal(false)} className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Tool Form Modal (New / Edit) ──────────────────────────────── */}
      {showToolForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">{editingTool ? 'Edit Tool' : 'New Tool'}</h2>
              <button onClick={() => setShowToolForm(false)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tool Number</label>
                  <input value={toolForm.tool_number || ''} onChange={e => setToolForm(f => ({ ...f, tool_number: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tool Name</label>
                  <input value={toolForm.tool_name || ''} onChange={e => setToolForm(f => ({ ...f, tool_name: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Category</label>
                  <input value={toolForm.category || ''} onChange={e => setToolForm(f => ({ ...f, category: e.target.value }))} placeholder="Power Tools, Electrical, HVAC..." className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Location</label>
                  <input value={toolForm.location || ''} onChange={e => setToolForm(f => ({ ...f, location: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Manufacturer</label>
                  <input value={toolForm.manufacturer || ''} onChange={e => setToolForm(f => ({ ...f, manufacturer: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Model</label>
                  <input value={toolForm.model || ''} onChange={e => setToolForm(f => ({ ...f, model: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Serial Number</label>
                  <input value={toolForm.serial_number || ''} onChange={e => setToolForm(f => ({ ...f, serial_number: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Assigned To</label>
                  <input value={toolForm.assigned_to || ''} onChange={e => setToolForm(f => ({ ...f, assigned_to: e.target.value }))} placeholder="Technician name" className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Status</label>
                  <select value={toolForm.status || 'Available'} onChange={e => setToolForm(f => ({ ...f, status: e.target.value as ToolStatus }))} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white">
                    <option value="Available">Available</option>
                    <option value="Checked Out">Checked Out</option>
                    <option value="In Repair">In Repair</option>
                    <option value="Lost">Lost</option>
                    <option value="Retired">Retired</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Condition</label>
                  <select value={toolForm.condition || 'Good'} onChange={e => setToolForm(f => ({ ...f, condition: e.target.value as ToolCondition }))} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white">
                    <option value="New">New</option>
                    <option value="Good">Good</option>
                    <option value="Fair">Fair</option>
                    <option value="Poor">Poor</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Purchase Date</label>
                  <input type="date" value={toolForm.purchase_date ? String(toolForm.purchase_date).slice(0, 10) : ''} onChange={e => setToolForm(f => ({ ...f, purchase_date: e.target.value || null }))} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Purchase Cost</label>
                  <input type="number" step="0.01" value={toolForm.purchase_cost ?? 0} onChange={e => setToolForm(f => ({ ...f, purchase_cost: Number(e.target.value) || 0 }))} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Calibration Due Date</label>
                  <input type="date" value={toolForm.calibration_due_date ? String(toolForm.calibration_due_date).slice(0, 10) : ''} onChange={e => setToolForm(f => ({ ...f, calibration_due_date: e.target.value || null }))} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Notes</label>
                  <textarea value={toolForm.notes || ''} onChange={e => setToolForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <button onClick={saveTool} className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">{editingTool ? 'Save' : 'Add Tool'}</button>
                <button onClick={() => setShowToolForm(false)} className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Checkout Tool Modal ───────────────────────────────────────── */}
      {checkoutToolItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Check Out: {checkoutToolItem.tool_name}</h2>
              <button onClick={() => setCheckoutToolItem(null)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Technician *</label>
                <input value={checkoutForm.technician} onChange={e => setCheckoutForm(f => ({ ...f, technician: e.target.value }))} placeholder="Technician name" className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Work Order</label>
                <input value={checkoutForm.workOrder} onChange={e => setCheckoutForm(f => ({ ...f, workOrder: e.target.value }))} placeholder="WO-2026-001 (optional)" className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Expected Return Date</label>
                <input type="date" value={checkoutForm.expectedReturnAt} onChange={e => setCheckoutForm(f => ({ ...f, expectedReturnAt: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Notes</label>
                <textarea value={checkoutForm.notes} onChange={e => setCheckoutForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
              </div>
              <div className="flex gap-3 pt-4">
                <button onClick={submitCheckout} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">Check Out</button>
                <button onClick={() => setCheckoutToolItem(null)} className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Return Tool Modal ─────────────────────────────────────────── */}
      {returnToolItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Return: {returnToolItem.tool_name}</h2>
              <button onClick={() => setReturnToolItem(null)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Condition on Return</label>
                <select value={returnForm.condition} onChange={e => setReturnForm(f => ({ ...f, condition: e.target.value as ToolCondition | '' }))} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white">
                  <option value="New">New</option>
                  <option value="Good">Good</option>
                  <option value="Fair">Fair</option>
                  <option value="Poor">Poor</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Return Notes</label>
                <textarea value={returnForm.notes} onChange={e => setReturnForm(f => ({ ...f, notes: e.target.value }))} rows={3} placeholder="Any damage or observations..." className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
              </div>
              <div className="flex gap-3 pt-4">
                <button onClick={submitReturn} className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors">Return Tool</button>
                <button onClick={() => setReturnToolItem(null)} className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Tool Checkout History Modal ──────────────────────────────── */}
      {showToolHistory && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Checkout History: {showToolHistory.tool_name}</h2>
              <button onClick={() => setShowToolHistory(null)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"><X className="w-5 h-5" /></button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Technician</th>
                    <th className="px-4 py-3 font-medium">Work Order</th>
                    <th className="px-4 py-3 font-medium">Checked Out</th>
                    <th className="px-4 py-3 font-medium">Expected Return</th>
                    <th className="px-4 py-3 font-medium">Returned</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Notes</th>
                    <th className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {(() => {
                    const rows = toolCheckouts
                      .filter(c => c.tool_id === showToolHistory.id)
                      .sort((a, b) => new Date(b.checked_out_at).getTime() - new Date(a.checked_out_at).getTime());
                    if (rows.length === 0) return <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">No checkout history for this tool.</td></tr>;
                    return rows.map(c => (
                      <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{c.technician}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{c.work_order || '—'}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{fmtDate(c.checked_out_at)}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{fmtDate(c.expected_return_at)}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{fmtDate(c.returned_at)}</td>
                        <td className="px-4 py-3">
                          <Badge tone={c.status === 'Active' ? 'info' : c.status === 'Overdue' ? 'danger' : 'success'}>
                            {c.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{c.checkout_notes || c.return_notes || '—'}</td>
                        <td className="px-4 py-3">
                          <button onClick={() => removeCheckout(c.id)} className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors" title="Delete"><Trash2 className="w-4 h-4" /></button>
                        </td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
