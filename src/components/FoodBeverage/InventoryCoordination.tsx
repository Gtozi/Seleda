/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Package,
  Search,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  BarChart3,
  Truck,
  ArrowDownToLine,
  ClipboardCheck,
  ClipboardList,
  Edit,
  Trash2,
  X,
  Plus,
  BookOpen,
  AlertCircle,
  Scale,
  ArrowDownUp,
  Activity,
  Zap,
  Target,
  Clock,
  Loader2,
  ServerCrash,
  ArrowRightLeft,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { PageHeader, SectionCard, Badge } from '../../components/FrontOffice/ui';
import { button as buttonStyles } from '../../components/FrontOffice/brandTheme';
import StatCard from '../../components/FrontOffice/StatCard';
import DepartmentReplenishmentPanel from '../Inventory/DepartmentReplenishmentPanel';
import DepartmentRequisitionForm from '../Inventory/DepartmentRequisitionForm';
import DepartmentDynamicParPanel from '../Inventory/DepartmentDynamicParPanel';
import DepartmentParOverridesPanel from '../Inventory/DepartmentParOverridesPanel';
import InterDepartmentTransferPanel from '../Inventory/InterDepartmentTransferPanel';
import StockCountsModule from '../Inventory/StockCountsModule';
import {
  fetchStockByDepartment,
  fetchIssues,
  fetchTransfers,
  fetchWaste,
  fetchLedger,
  createTransfer,
  createWaste,
  createAdjustment,
  deleteIssue,
  type UinvStockBalance,
} from '../../services/inventoryService';

interface ConsumptionRecord {
  id: string;
  date: string;
  outlet_id: string;
  outlet_name: string;
  menu_item_id: string | null;
  recipe_id: string | null;
  item_name: string;
  theoretical_qty: number;
  actual_qty: number;
  variance_qty: number;
  variance_percent: number;
  unit: string;
  cost: number;
}

type WasteType = 'waste' | 'spoilage' | 'breakage' | 'preparation' | 'expired' | 'overproduction' | 'plate' | 'complimentary';

interface WasteRecord {
  id: string;
  date: string;
  outlet_id: string;
  outlet_name: string;
  item_id: string;
  item_name: string;
  waste_type: WasteType;
  quantity: number;
  unit: string;
  reason: string;
  cost: number;
  reported_by: string;
}

interface TransferRecord {
  id: string;
  date: string;
  from_outlet_id: string;
  from_outlet_name: string;
  to_outlet_id: string;
  to_outlet_name: string;
  item_id: string;
  item_name: string;
  quantity: number;
  unit: string;
  reason: string;
  status: 'pending' | 'approved' | 'completed';
}

interface InventoryItem {
  id: string;
  name: string;
  category: string;
  category_id?: string;
  item_type?: string;
  type: 'consumable' | 'non-consumable';
  unit_of_measure: string;
  current_quantity: number;
  minimum_stock: number;
  maximum_stock: number | null;
  reorder_point: number;
  unit_cost: number;
  location: string;
  last_updated: string;
  main_store_stock: number;
}

interface Requisition {
  id: string;
  requisition_number: string;
  requested_by: string;
  request_date: string;
  from_location: string;
  to_location: string;
  status: 'pending' | 'approved' | 'rejected' | 'completed' | 'partially issued';
  items: RequisitionItem[];
  total_cost: number;
}

interface RequisitionItem {
  id: string;
  item_id: string;
  item_name: string;
  requested_quantity: number;
  issued_quantity: number;
  unit: string;
  unit_cost: number;
  approved_quantity: number | null;
  reason: string;
}

export default function InventoryCoordination() {
  const { formatAmount, addNotification, currentPropertyId } = useERP();
  const [activeTab, setActiveTab] = useState<'inventory' | 'par-management' | 'requisitions' | 'consumption' | 'waste' | 'transfers' | 'movements' | 'stock-count' | 'variance' | 'inter-dept-transfer'>('inventory');
  const [parView, setParView] = useState<'dynamic' | 'overrides'>('dynamic');
  // External action triggers for embedded shared components
  const [replenishRefreshTrigger, setReplenishRefreshTrigger] = useState(0);
  const [replenishAutoTrigger, setReplenishAutoTrigger] = useState(0);
  const [reqRefreshTrigger, setReqRefreshTrigger] = useState(0);
  const [reqNewTrigger, setReqNewTrigger] = useState(0);
  const [parRefreshTrigger, setParRefreshTrigger] = useState(0);
  const [parRecalculateTrigger, setParRecalculateTrigger] = useState(0);
  const [parAutoReplenishTrigger, setParAutoReplenishTrigger] = useState(0);
  const [countRefreshTrigger, setCountRefreshTrigger] = useState(0);
  const [countNewTrigger, setCountNewTrigger] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [showConsumptionModal, setShowConsumptionModal] = useState(false);
  const [showWasteModal, setShowWasteModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [menuItems, setMenuItems] = useState<any[]>([]);
  const [outlets, setOutlets] = useState<{id: string; name: string}[]>([]);
  const [consumptionForm, setConsumptionForm] = useState<{
    menu_item_id: string;
    servings_sold: number;
    outlet_id: string;
    actual_quantities: { ingredient_id: string; ingredient_name: string; actual_qty: number; theoretical_qty: number; unit: string }[];
  }>({ menu_item_id: '', servings_sold: 1, outlet_id: '', actual_quantities: [] });
  const [wasteForm, setWasteForm] = useState<{
    item_id: string;
    outlet_id: string;
    waste_type: WasteType;
    quantity: number;
    reason: string;
  }>({ item_id: '', outlet_id: '', waste_type: 'waste', quantity: 0, reason: '' });
  const [transferForm, setTransferForm] = useState<{
    item_id: string;
    from_outlet_id: string;
    to_outlet_id: string;
    quantity: number;
    reason: string;
  }>({ item_id: '', from_outlet_id: '', to_outlet_id: '', quantity: 0, reason: '' });
  const [showMovementModal, setShowMovementModal] = useState(false);
  const [movementForm, setMovementForm] = useState<{
    item_id: string;
    transaction_type: string;
    quantity: number;
    outlet_id: string;
    reason: string;
  }>({ item_id: '', transaction_type: 'goods_receipt', quantity: 0, outlet_id: '', reason: '' });

  // Data state
  const [consumption, setConsumption] = useState<ConsumptionRecord[]>([]);
  const [waste, setWaste] = useState<WasteRecord[]>([]);
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [allTransactions, setAllTransactions] = useState<any[]>([]);
  const [varianceData, setVarianceData] = useState<{
    records: ConsumptionRecord[];
    aggregated: Array<{
      item_id: string;
      item_name: string;
      category: string;
      theoretical: number;
      actual: number;
      variance_qty: number;
      variance_percent: number | null;
      variance_cost: number;
      unit: string;
      records: number;
      severity: 'high' | 'medium' | 'low' | 'na';
    }>;
    summary: { high: number; medium: number; low: number; na: number; total: number; total_variance_cost: number };
  }>({ records: [], aggregated: [], summary: { high: 0, medium: 0, low: 0, na: 0, total: 0, total_variance_cost: 0 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<'food' | 'beverage' | 'all'>('all');
  const [filterItemType, setFilterItemType] = useState<'consumable' | 'non-consumable' | 'all'>('all');
  const [filterLocation, setFilterLocation] = useState<string>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterStorageType, setFilterStorageType] = useState<string>('all');
  const [categories, setCategories] = useState<any[]>([]);

  const fetchData = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      // ── SINGLE SOURCE OF TRUTH: unified uinv_* system ──
      // Fetch stock balances for F&B department (Food Store + Beverage Store)
      const stockBalances = await fetchStockByDepartment('Food & Beverage', currentPropertyId || undefined).catch(() => [] as UinvStockBalance[]);

      // Map unified stock balances to component shape
      const mappedItems: InventoryItem[] = stockBalances.map((b: UinvStockBalance) => ({
        id: b.item_id,
        name: b.item?.item_name || 'Unknown',
        category: b.item?.category || 'Uncategorized',
        category_id: b.item?.category || '',
        item_type: b.item?.item_type || 'non-perishable',
        type: (b.item?.item_type === 'Spare Part') ? 'non-consumable' : 'consumable',
        unit_of_measure: b.item?.unit_of_measure || 'PCS',
        current_quantity: Number(b.on_hand || 0),
        minimum_stock: Number(b.item?.min_stock || 0),
        maximum_stock: b.item?.max_stock ? Number(b.item?.max_stock) : null,
        reorder_point: Number(b.item?.reorder_point || 0),
        unit_cost: Number(b.unit_cost || 0),
        location: b.store?.store_name || b.location?.location_name || 'Unassigned',
        last_updated: b.updated_at ? b.updated_at.slice(0, 10) : '',
        main_store_stock: Number(b.on_hand || 0),
      }));
      setInventoryItems(mappedItems);

      // Derive categories from unified items (replaces /api/inventory/categories)
      const categorySet = new Set(stockBalances.map(b => b.item?.category).filter(Boolean) as string[]);
      setCategories(Array.from(categorySet).map(c => ({ id: c, name: c, code: c, sub_categories: [] })));

      // Fetch unified issues (requisitions) for F&B department
      try {
        const issues = await fetchIssues({ propertyId: currentPropertyId || undefined, department: 'Food & Beverage' }).catch(() => []);
        const mappedReqs: Requisition[] = (issues as any[]).map((iss: any) => ({
          id: iss.id,
          requisition_number: iss.issue_number,
          requested_by: iss.requester || '—',
          request_date: iss.created_at ? iss.created_at.slice(0, 10) : '',
          from_location: iss.store?.store_name || 'Main Store',
          to_location: iss.department || 'Food & Beverage',
          status: (iss.approval_status?.toLowerCase() === 'pending' ? 'pending'
            : iss.approval_status?.toLowerCase() === 'approved' ? 'approved'
            : iss.approval_status?.toLowerCase() === 'rejected' ? 'rejected'
            : iss.approval_status?.toLowerCase() === 'partially issued' ? 'partially issued'
            : 'completed') as 'pending' | 'approved' | 'rejected' | 'completed' | 'partially issued',
          items: (iss.lines || []).map((line: any) => ({
            id: line.itemId,
            item_id: line.itemId,
            item_name: line.itemName || '—',
            requested_quantity: Number(line.requestedQty || 0),
            issued_quantity: Number(line.issuedQty || 0),
            unit: line.unit || 'PCS',
            unit_cost: Number(line.unitCost || 0),
            approved_quantity: line.approvedQty != null ? Number(line.approvedQty) : null,
            reason: iss.purpose || '',
          })),
          total_cost: (iss.lines || []).reduce((s: number, l: any) => s + Number(l.issuedQty || l.requestedQty || 0) * Number(l.unitCost || 0), 0),
        }));
        setRequisitions(mappedReqs);
      } catch (e) { console.error('Error fetching issues:', e); }

      // Fetch unified transfers
      try {
        const transfers = await fetchTransfers({ propertyId: currentPropertyId || undefined }).catch(() => []);
        const mappedTransfers: TransferRecord[] = (transfers as any[]).flatMap((t: any) =>
          (t.lines || []).map((line: any) => ({
            id: t.id,
            date: t.created_at ? t.created_at.slice(0, 10) : '',
            from_outlet_id: t.from_store_id || '',
            from_outlet_name: t.from_store?.store_name || '—',
            to_outlet_id: t.to_store_id || '',
            to_outlet_name: t.to_store?.store_name || '—',
            item_id: line.itemId,
            item_name: line.itemName || '—',
            quantity: Number(line.quantity || 0),
            unit: line.unit || 'PCS',
            reason: t.reason || 'Transfer',
            status: (t.status?.toLowerCase() === 'received' || t.status?.toLowerCase() === 'completed') ? 'completed' as const
              : (t.status?.toLowerCase() === 'pending' ? 'pending' as const : 'approved' as const),
          }))
        );
        setTransfers(mappedTransfers);
      } catch (e) { console.error('Error fetching transfers:', e); }

      // Fetch unified waste records
      try {
        const wasteRecords = await fetchWaste({ propertyId: currentPropertyId || undefined }).catch(() => []);
        const mappedWaste: WasteRecord[] = (wasteRecords as any[]).map((w: any) => ({
          id: w.id,
          date: w.created_at ? w.created_at.slice(0, 10) : '',
          outlet_id: w.store_id || '',
          outlet_name: w.store?.store_name || '—',
          item_id: w.item_id,
          item_name: w.item?.item_name || '—',
          waste_type: (w.waste_type || 'waste').toLowerCase() as WasteType,
          quantity: Number(w.quantity || 0),
          unit: w.item?.unit_of_measure || 'PCS',
          reason: w.reason || 'Not specified',
          cost: Number(w.total_cost || 0),
          reported_by: w.created_by || 'System',
        }));
        setWaste(mappedWaste);
      } catch (e) { console.error('Error fetching waste:', e); }

      // Fetch unified stock ledger for consumption/variance data
      let ledger: any[] = [];
      try {
        ledger = await fetchLedger({ propertyId: currentPropertyId || undefined }).catch(() => []) as any[];
        setAllTransactions(ledger || []);
        // Map ledger entries to consumption records
        const consumptionRecords: ConsumptionRecord[] = (ledger as any[])
          .filter((l: any) => l.transaction_type === 'Department Issue' || l.transaction_type === 'Consumption')
          .slice(0, 50)
          .map((l: any) => ({
            id: l.id,
            date: l.transaction_date ? l.transaction_date.slice(0, 10) : '',
            outlet_id: l.store_id || '',
            outlet_name: l.store?.store_name || '—',
            menu_item_id: null,
            recipe_id: null,
            item_name: l.item?.item_name || '—',
            theoretical_qty: 0,
            actual_qty: Number(l.quantity_out || 0),
            variance_qty: 0,
            variance_percent: 0,
            unit: l.item?.unit_of_measure || 'PCS',
            cost: Number(l.value || 0),
          }));
        setConsumption(consumptionRecords);
      } catch (e) { console.error('Error fetching ledger:', e); }

      // Fetch menu items with recipes (F&B domain — not inventory stock)
      try {
        const miRes = await fetch('/api/inventory/menu-items', { headers });
        if (miRes.ok) {
          const miData = await miRes.json();
          setMenuItems(miData || []);
        }
      } catch (miErr) {
        console.error('Error fetching menu items:', miErr);
      }

      // Fetch outlets (F&B domain — not inventory stock)
      try {
        const outRes = await fetch('/api/inventory/outlets', { headers });
        if (outRes.ok) {
          const outData = await outRes.json();
          const fetchedOutlets = outData || [];
          setOutlets(fetchedOutlets);
        }
      } catch (outErr) {
        console.error('Error fetching outlets:', outErr);
      }

      // ── Compute variance from unified ledger (mirrors HK variance endpoint) ──
      // Filter ledger for F&B stores + variance-related transaction types
      const FB_STORE_IDS = ['UINV-ST-FOOD', 'UINV-ST-BEV'];
      const VARIANCE_TX_TYPES = ['Cycle Count', 'Stock Count', 'Adjustment', 'Waste', 'Consumption', 'Count Adjustment'];
      const varianceLedger = (ledger as any[]).filter((l: any) =>
        l.store_id && FB_STORE_IDS.includes(l.store_id) &&
        VARIANCE_TX_TYPES.includes(l.transaction_type)
      );

      const varianceRecords = varianceLedger.map((t: any) => {
        const qtyIn = Number(t.quantity_in || 0);
        const qtyOut = Number(t.quantity_out || 0);
        const balance = Number(t.balance || 0);
        const reconstructedVariance = qtyIn - qtyOut;
        const hasExplicit = t.theoretical_qty != null || t.actual_qty != null;
        const theoreticalQty = hasExplicit ? Number(t.theoretical_qty ?? 0) : balance + reconstructedVariance;
        const actualQty = hasExplicit ? Number(t.actual_qty ?? 0) : balance;
        const varianceQty = hasExplicit ? (actualQty - theoreticalQty) : reconstructedVariance;
        return {
          id: t.id,
          date: t.transaction_date ? String(t.transaction_date).slice(0, 10) : '',
          item_id: t.item_id,
          item_name: t.item?.item_name || '—',
          category: t.item?.category || t.item?.subcategory || 'Uncategorized',
          theoretical_qty: theoreticalQty,
          actual_qty: actualQty,
          variance_qty: varianceQty,
          variance_percent: theoreticalQty !== 0 ? (varianceQty / theoreticalQty) * 100 : 0,
          unit: t.item?.unit_of_measure || 'PCS',
          cost: Number(t.value || 0),
          transaction_type: t.transaction_type,
        };
      });

      // Aggregate by item
      const byItem: Record<string, any> = {};
      for (const r of varianceRecords) {
        if (!byItem[r.item_id]) {
          byItem[r.item_id] = {
            item_id: r.item_id,
            item_name: r.item_name,
            category: r.category,
            theoretical: 0,
            actual: 0,
            records: 0,
            unit: r.unit,
          };
        }
        byItem[r.item_id].theoretical += r.theoretical_qty;
        byItem[r.item_id].actual += r.actual_qty;
        byItem[r.item_id].records += 1;
      }

      const aggregated = Object.values(byItem).map((a: any) => {
        const varianceQty = a.actual - a.theoretical;
        const variancePct = a.theoretical !== 0 ? (varianceQty / a.theoretical) * 100 : null;
        const severity: 'high' | 'medium' | 'low' | 'na' = Math.abs(variancePct ?? 0) >= 20 ? 'high' : Math.abs(variancePct ?? 0) >= 10 ? 'medium' : variancePct === null ? 'na' : 'low';
        const varianceCost = varianceQty * (inventoryItems.find(i => i.id === a.item_id)?.unit_cost || 0);
        return { ...a, variance_qty: varianceQty, variance_percent: variancePct, variance_cost: varianceCost, severity };
      });

      const totalVarianceCost = aggregated.reduce((s: number, a: any) => s + Math.abs(a.variance_cost), 0);
      setVarianceData({
        records: varianceRecords,
        aggregated,
        summary: {
          high: aggregated.filter((a: any) => a.severity === 'high').length,
          medium: aggregated.filter((a: any) => a.severity === 'medium').length,
          low: aggregated.filter((a: any) => a.severity === 'low').length,
          na: aggregated.filter((a: any) => a.severity === 'na').length,
          total: aggregated.length,
          total_variance_cost: totalVarianceCost,
        },
      });
    } catch (e: any) {
      console.error('Error fetching inventory data:', e);
      setError(e?.message || 'Failed to load inventory data');
      addNotification('Failed to load inventory data', 'warning', 'F&B');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, addNotification]);

  useEffect(() => {
    fetchData();
    // Auto-refresh every 30s to pick up requisition status changes from Inventory
    const interval = setInterval(() => fetchData(), 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // When a menu item is selected, pre-calculate theoretical quantities from recipe lines
  const onConsumptionMenuItemChange = (menuItemId: string) => {
    const mi = menuItems.find(m => m.id === menuItemId);
    if (!mi || !mi.recipe_lines || mi.recipe_lines.length === 0) {
      setConsumptionForm(prev => ({ ...prev, menu_item_id: menuItemId, actual_quantities: [] }));
      return;
    }
    const portions = mi.portions || 1;
    const multiplier = consumptionForm.servings_sold / portions;
    const actualQuantities = mi.recipe_lines.map((rl: any) => ({
      ingredient_id: rl.ingredient_id,
      ingredient_name: rl.ingredient_name,
      theoretical_qty: Number((rl.quantity_per_portion * multiplier).toFixed(4)),
      actual_qty: Number((rl.quantity_per_portion * multiplier).toFixed(4)), // default: same as theoretical
      unit: rl.unit,
    }));
    setConsumptionForm(prev => ({ ...prev, menu_item_id: menuItemId, actual_quantities: actualQuantities }));
  };

  // When servings change, re-calculate theoretical for all lines
  const onServingsChange = (servings: number) => {
    const mi = menuItems.find(m => m.id === consumptionForm.menu_item_id);
    if (!mi || !mi.recipe_lines) {
      setConsumptionForm(prev => ({ ...prev, servings_sold: servings }));
      return;
    }
    const portions = mi.portions || 1;
    const multiplier = servings / portions;
    const actualQuantities = consumptionForm.actual_quantities.map(aq => ({
      ...aq,
      theoretical_qty: Number(((mi.recipe_lines.find((rl: any) => rl.ingredient_id === aq.ingredient_id)?.quantity_per_portion || 0) * multiplier).toFixed(4)),
    }));
    setConsumptionForm(prev => ({ ...prev, servings_sold: servings, actual_quantities: actualQuantities }));
  };

  const updateActualQty = (ingredientId: string, actualQty: number) => {
    setConsumptionForm(prev => ({
      ...prev,
      actual_quantities: prev.actual_quantities.map(aq =>
        aq.ingredient_id === ingredientId ? { ...aq, actual_qty: actualQty } : aq
      ),
    }));
  };

  const submitConsumption = async () => {
    if (!consumptionForm.menu_item_id) {
      addNotification('Please select a menu item', 'warning', 'F&B');
      return;
    }
    if (!consumptionForm.servings_sold || consumptionForm.servings_sold <= 0) {
      addNotification('Please enter servings sold', 'warning', 'F&B');
      return;
    }
    if (!consumptionForm.outlet_id) {
      addNotification('Please select an outlet', 'warning', 'F&B');
      return;
    }
    try {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const actualQuantities = consumptionForm.actual_quantities.map(aq => ({
        ingredient_id: aq.ingredient_id,
        actual_qty: aq.actual_qty,
      }));

      const res = await fetch('/api/inventory/consumption', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          menu_item_id: consumptionForm.menu_item_id,
          servings_sold: consumptionForm.servings_sold,
          outlet_id: consumptionForm.outlet_id,
          actual_quantities: actualQuantities,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to record consumption');
      }
      const result = await res.json();
      const unmatched = result.unmatched_ingredients?.length > 0
        ? ` (${result.unmatched_ingredients.length} ingredients unmatched)`
        : '';
      addNotification(`Consumption recorded: ${result.transactions_created} transactions${unmatched}`, 'success', 'F&B');
      setShowConsumptionModal(false);
      setConsumptionForm({ menu_item_id: '', servings_sold: 1, outlet_id: '', actual_quantities: [] });
      fetchData();
    } catch (err: any) {
      addNotification(err.message || 'Failed to record consumption', 'warning', 'F&B');
    }
  };

  const submitWaste = async () => {
    if (!wasteForm.item_id) { addNotification('Please select an item', 'warning', 'F&B'); return; }
    if (!wasteForm.outlet_id) { addNotification('Please select an outlet', 'warning', 'F&B'); return; }
    if (!wasteForm.quantity || wasteForm.quantity <= 0) { addNotification('Please enter a valid quantity', 'warning', 'F&B'); return; }
    try {
      const item = inventoryItems.find(i => i.id === wasteForm.item_id);
      const unitCost = item?.unit_cost || 0;
      await createWaste({
        property_id: currentPropertyId || null,
        item_id: wasteForm.item_id,
        store_id: null,
        quantity: wasteForm.quantity,
        unit_cost: unitCost,
        total_cost: wasteForm.quantity * unitCost,
        waste_type: wasteForm.waste_type,
        reason: wasteForm.reason || `${wasteForm.waste_type} waste`,
        department: 'Food & Beverage',
        status: 'Pending',
      });
      addNotification('Waste recorded successfully', 'success', 'F&B');
      setShowWasteModal(false);
      setWasteForm({ item_id: '', outlet_id: '', waste_type: 'waste', quantity: 0, reason: '' });
      fetchData();
    } catch (err: any) {
      addNotification(err.message || 'Failed to record waste', 'warning', 'F&B');
    }
  };

  const submitTransfer = async () => {
    if (!transferForm.item_id) { addNotification('Please select an item', 'warning', 'F&B'); return; }
    if (!transferForm.from_outlet_id) { addNotification('Please select source outlet', 'warning', 'F&B'); return; }
    if (!transferForm.to_outlet_id) { addNotification('Please select destination outlet', 'warning', 'F&B'); return; }
    if (transferForm.from_outlet_id === transferForm.to_outlet_id) { addNotification('Source and destination must be different', 'warning', 'F&B'); return; }
    if (!transferForm.quantity || transferForm.quantity <= 0) { addNotification('Please enter a valid quantity', 'warning', 'F&B'); return; }
    try {
      const item = inventoryItems.find(i => i.id === transferForm.item_id);
      const unitCost = item?.unit_cost || 0;
      await createTransfer({
        property_id: currentPropertyId || null,
        from_store_id: transferForm.from_outlet_id,
        to_store_id: transferForm.to_outlet_id,
        lines: [{
          itemId: transferForm.item_id,
          itemName: item?.name || '—',
          quantity: transferForm.quantity,
          unit: item?.unit_of_measure || 'PCS',
          unitCost,
        }],
        transfer_value: transferForm.quantity * unitCost,
        status: 'Pending',
        priority: 'Normal',
        reason: transferForm.reason || 'Inter-store transfer',
      });
      addNotification('Transfer recorded successfully', 'success', 'F&B');
      setShowTransferModal(false);
      setTransferForm({ item_id: '', from_outlet_id: '', to_outlet_id: '', quantity: 0, reason: '' });
      fetchData();
    } catch (err: any) {
      addNotification(err.message || 'Failed to record transfer', 'warning', 'F&B');
    }
  };

  const submitMovement = async () => {
    if (!movementForm.item_id) { addNotification('Please select an item', 'warning', 'F&B'); return; }
    if (!movementForm.transaction_type) { addNotification('Please select a transaction type', 'warning', 'F&B'); return; }
    if (!movementForm.quantity || movementForm.quantity <= 0) { addNotification('Please enter a valid quantity', 'warning', 'F&B'); return; }
    try {
      const item = inventoryItems.find(i => i.id === movementForm.item_id);
      const unitCost = item?.unit_cost || 0;
      // Map to unified adjustment
      const isReceipt = movementForm.transaction_type === 'goods_receipt' || movementForm.transaction_type === 'returns';
      await createAdjustment({
        property_id: currentPropertyId || null,
        item_id: movementForm.item_id,
        store_id: movementForm.outlet_id || null,
        adjustment_type: isReceipt ? 'Receipt' : movementForm.transaction_type === 'adjustment' ? 'Adjustment' : 'Issue',
        reason: movementForm.reason || movementForm.transaction_type,
        quantity_delta: isReceipt ? movementForm.quantity : -movementForm.quantity,
        unit_cost: unitCost,
        value_delta: (isReceipt ? movementForm.quantity : -movementForm.quantity) * unitCost,
        status: 'Approved',
        reference: movementForm.transaction_type,
      });
      addNotification(`${movementForm.transaction_type} recorded successfully`, 'success', 'F&B');
      setShowMovementModal(false);
      setMovementForm({ item_id: '', transaction_type: 'goods_receipt', quantity: 0, outlet_id: '', reason: '' });
      fetchData();
    } catch (err: any) {
      addNotification(err.message || 'Failed to record stock movement', 'warning', 'F&B');
    }
  };

  const deleteTransaction = async (id: string) => {
    try {
      // Unified issues can be deleted via their own endpoint. The stock
      // ledger is immutable (spec §28) — there is no DELETE /stock-ledger
      // route, so a 404 there must NOT be reported as success.
      try {
        await deleteIssue(id);
      } catch (issueErr: any) {
        addNotification(
          issueErr?.message || 'This record cannot be deleted — the stock ledger is immutable.',
          'warning',
          'F&B',
        );
        return;
      }
      addNotification('Record deleted', 'success', 'F&B');
      fetchData();
    } catch (err: any) {
      addNotification(err.message || 'Failed to delete record', 'warning', 'F&B');
    }
  };

  // Requisition approve/issue/reject are now handled by the Inventory portal.
  // Departments can only create and view requisition status.

  const tabs = [
    { id: 'inventory' as const, label: 'Inventory', icon: Package, count: inventoryItems.length },
    { id: 'par-management' as const, label: 'Par Management', icon: Activity, count: undefined },
    { id: 'requisitions' as const, label: 'Replenishment & Requisition', icon: ClipboardCheck, count: requisitions.filter(r => r.status === 'pending').length, countLabel: 'pending' },
    { id: 'consumption' as const, label: 'Consumption', icon: BookOpen, count: consumption.length },
    { id: 'waste' as const, label: 'Waste & Loss', icon: AlertTriangle, count: waste.length },
    { id: 'transfers' as const, label: 'Transfers', icon: Truck, count: transfers.length },
    { id: 'movements' as const, label: 'Stock Movements', icon: ArrowDownUp, count: allTransactions.filter(t => ['goods_receipt', 'stock_count', 'cycle_count', 'returns', 'expiry', 'spoilage', 'adjustment'].includes(t.transaction_type)).length },
    { id: 'stock-count' as const, label: 'Stock Count', icon: ClipboardList, count: undefined },
    { id: 'variance' as const, label: 'Variance Analysis', icon: BarChart3, count: varianceData.aggregated.length },
    { id: 'inter-dept-transfer' as const, label: 'Inter-Dept Transfer', icon: ArrowRightLeft, count: undefined },
  ];

  const totalConsumptionCost = consumption.reduce((sum, c) => sum + c.cost, 0);
  const totalWasteCost = waste.reduce((sum, w) => sum + w.cost, 0);

  // Inventory value + stock status metrics
  const totalInventoryValue = inventoryItems.reduce((sum, i) => sum + i.current_quantity * i.unit_cost, 0);
  const lowStockItems = inventoryItems.filter(i => i.current_quantity <= i.reorder_point && i.reorder_point > 0);
  const criticalStockItems = inventoryItems.filter(i => i.current_quantity <= i.minimum_stock && i.minimum_stock > 0);
  const totalItemsCount = inventoryItems.length;

  // Food vs Beverage cost split — based on inventory item category
  // Items whose category contains "Beverage" or "BEVERAGE" are beverage; everything else is food.
  const itemCategoryMap = new Map(inventoryItems.map(i => [i.name.toLowerCase(), i.category]));
  const isBeverage = (itemName: string) => {
    const cat = itemCategoryMap.get(itemName.toLowerCase()) || '';
    return cat.toLowerCase().includes('beverage') || cat.toLowerCase().includes('bar') || cat === 'BEVERAGE';
  };
  const foodConsumptionCost = consumption.filter(c => !isBeverage(c.item_name)).reduce((sum, c) => sum + c.cost, 0);
  const beverageConsumptionCost = consumption.filter(c => isBeverage(c.item_name)).reduce((sum, c) => sum + c.cost, 0);

  // Dynamic stats — change based on the active sub-tab (mirrors HK pattern)
  const stats = useMemo(() => {
    const consumptionRecords = consumption;
    const wasteRecords = waste;
    const transferRecords = transfers;
    const movementRecords = allTransactions.filter(t => ['goods_receipt', 'stock_count', 'cycle_count', 'returns', 'expiry', 'spoilage', 'adjustment'].includes(t.transaction_type));
    const pendingReqs = requisitions.filter(r => r.status === 'pending');
    const approvedReqs = requisitions.filter(r => r.status === 'approved' || r.status === 'completed');

    switch (activeTab) {
      case 'inventory':
        return [
          { label: 'Total Items', value: String(totalItemsCount), changeLabel: `${lowStockItems.length} low · ${criticalStockItems.length} critical`, icon: Package, color: 'indigo' as const },
          { label: 'Inventory Value', value: formatAmount(totalInventoryValue), changeLabel: 'Current stock value', icon: DollarSign, color: 'blue' as const },
          { label: 'Low Stock', value: String(lowStockItems.length), changeLabel: `${criticalStockItems.length} critical items`, icon: AlertTriangle, color: 'amber' as const },
          { label: 'Critical', value: String(criticalStockItems.length), changeLabel: 'Below minimum stock', icon: AlertCircle, color: 'red' as const },
        ];
      case 'par-management':
        return [
          { label: 'Total Items', value: String(totalItemsCount), changeLabel: 'F&B items tracked', icon: Package, color: 'indigo' as const },
          { label: 'With Par Level', value: String(inventoryItems.filter(i => i.minimum_stock > 0).length), changeLabel: 'Par level set', icon: Target, color: 'blue' as const },
          { label: 'With Reorder Point', value: String(inventoryItems.filter(i => i.reorder_point > 0).length), changeLabel: 'Reorder configured', icon: Zap, color: 'amber' as const },
          { label: 'Low Stock', value: String(lowStockItems.length), changeLabel: `${criticalStockItems.length} critical`, icon: AlertTriangle, color: 'red' as const },
        ];
      case 'requisitions':
        return [
          { label: 'Total Requisitions', value: String(requisitions.length), changeLabel: 'All time', icon: ClipboardCheck, color: 'indigo' as const },
          { label: 'Pending', value: String(pendingReqs.length), changeLabel: 'Awaiting approval', icon: Clock, color: 'amber' as const },
          { label: 'Approved/Completed', value: String(approvedReqs.length), changeLabel: 'Completed', icon: CheckCircle2, color: 'blue' as const },
          { label: 'Total Value', value: formatAmount(requisitions.reduce((s, r) => s + (r.total_cost || 0), 0)), changeLabel: 'Requisition value', icon: DollarSign, color: 'red' as const },
        ];
      case 'consumption':
        return [
          { label: 'Consumption Records', value: String(consumptionRecords.length), changeLabel: 'Total entries', icon: BookOpen, color: 'indigo' as const },
          { label: 'Total Consumed', value: String(consumptionRecords.reduce((s, c) => s + c.actual_qty, 0)), changeLabel: 'Units consumed', icon: Package, color: 'blue' as const },
          { label: 'Consumption Cost', value: formatAmount(totalConsumptionCost), changeLabel: `Food: ${formatAmount(foodConsumptionCost)} · Bev: ${formatAmount(beverageConsumptionCost)}`, icon: DollarSign, color: 'red' as const },
          { label: 'Avg Variance', value: `${consumptionRecords.length > 0 ? ((consumptionRecords.reduce((s, c) => s + (c.actual_qty - c.theoretical_qty), 0) / consumptionRecords.length).toFixed(1)) : '0.0'}`, changeLabel: 'Actual vs theoretical', icon: BarChart3, color: 'amber' as const },
        ];
      case 'waste':
        return [
          { label: 'Waste Records', value: String(wasteRecords.length), changeLabel: 'Total entries', icon: AlertTriangle, color: 'red' as const },
          { label: 'Total Wasted', value: String(wasteRecords.reduce((s, w) => s + w.quantity, 0)), changeLabel: 'Units lost', icon: Package, color: 'amber' as const },
          { label: 'Waste Cost', value: formatAmount(totalWasteCost), changeLabel: 'Total loss value', icon: DollarSign, color: 'red' as const },
          { label: 'Breakage', value: String(wasteRecords.filter(w => w.waste_type === 'breakage').length), changeLabel: 'Broken items', icon: AlertCircle, color: 'amber' as const },
        ];
      case 'transfers':
        return [
          { label: 'Transfer Records', value: String(transferRecords.length), changeLabel: 'Total transfers', icon: Truck, color: 'indigo' as const },
          { label: 'Total Transferred', value: String(transferRecords.reduce((s, t) => s + t.quantity, 0)), changeLabel: 'Units moved', icon: Package, color: 'blue' as const },
          { label: 'Transfer Value', value: formatAmount(transferRecords.reduce((s, t) => s + (t.quantity * (inventoryItems.find(i => i.id === t.item_id)?.unit_cost || 0)), 0)), changeLabel: 'Total value', icon: DollarSign, color: 'red' as const },
          { label: 'Recent', value: String(transferRecords.filter(t => { const d = new Date(t.date); return Date.now() - d.getTime() < 7 * 86400000; }).length), changeLabel: 'Last 7 days', icon: Clock, color: 'amber' as const },
        ];
      case 'movements':
        return [
          { label: 'Movement Records', value: String(movementRecords.length), changeLabel: 'All movements', icon: ArrowDownUp, color: 'indigo' as const },
          { label: 'Stock Counts', value: String(allTransactions.filter(t => t.transaction_type === 'stock_count' || t.transaction_type === 'cycle_count').length), changeLabel: 'Count adjustments', icon: ClipboardList, color: 'blue' as const },
          { label: 'Adjustments', value: String(allTransactions.filter(t => t.transaction_type === 'adjustment').length), changeLabel: 'Manual adjustments', icon: Zap, color: 'amber' as const },
          { label: 'Receipts', value: String(allTransactions.filter(t => t.transaction_type === 'goods_receipt').length), changeLabel: 'Goods received', icon: Package, color: 'red' as const },
        ];
      case 'stock-count':
        return [
          { label: 'F&B Stores', value: '2', changeLabel: 'Food + Beverage store', icon: Package, color: 'indigo' as const },
          { label: 'Total Items', value: String(totalItemsCount), changeLabel: 'Items to count', icon: ClipboardList, color: 'blue' as const },
          { label: 'Inventory Value', value: formatAmount(totalInventoryValue), changeLabel: 'Stock at risk', icon: DollarSign, color: 'amber' as const },
          { label: 'Critical Items', value: String(criticalStockItems.length), changeLabel: 'Below minimum', icon: AlertCircle, color: 'red' as const },
        ];
      case 'variance':
        return [
          { label: 'Variance Records', value: String(varianceData.summary.total), changeLabel: 'Total entries', icon: BarChart3, color: 'indigo' as const },
          { label: 'High Severity', value: String(varianceData.summary.high), changeLabel: 'Needs attention', icon: AlertCircle, color: 'red' as const },
          { label: 'Medium Severity', value: String(varianceData.summary.medium), changeLabel: 'Monitor closely', icon: AlertTriangle, color: 'amber' as const },
          { label: 'Low/None', value: String(varianceData.summary.low + varianceData.summary.na), changeLabel: 'Within tolerance', icon: CheckCircle2, color: 'blue' as const },
        ];
      default:
        return [
          { label: 'Inventory Value', value: formatAmount(totalInventoryValue), changeLabel: `${totalItemsCount} items · ${criticalStockItems.length} critical`, icon: DollarSign, color: 'indigo' as const },
          { label: 'Total Consumption', value: formatAmount(totalConsumptionCost), changeLabel: `Food: ${formatAmount(foodConsumptionCost)} · Bev: ${formatAmount(beverageConsumptionCost)}`, icon: Package, color: 'blue' as const },
          { label: 'Total Waste', value: formatAmount(totalWasteCost), changeLabel: `${waste.length} records`, icon: AlertTriangle, color: 'red' as const },
          { label: 'Low Stock Items', value: String(lowStockItems.length), changeLabel: `${criticalStockItems.length} critical · ${lowStockItems.length - criticalStockItems.length} low`, icon: AlertCircle, color: 'amber' as const },
        ];
    }
  }, [activeTab, inventoryItems, consumption, waste, transfers, allTransactions, requisitions, varianceData, totalItemsCount, totalInventoryValue, lowStockItems, criticalStockItems, totalConsumptionCost, totalWasteCost, foodConsumptionCost, beverageConsumptionCost, formatAmount]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="F&B Inventory"
        subtitle="F&B Food & Beverage store inventory — stock, par levels, consumption, waste, transfers, counts, and variance"
        icon={Package}
        actions={
          <div className="flex gap-2">
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
              <button onClick={() => setShowWasteModal(true)} className="px-3 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">
                <AlertTriangle size={14} className="inline-block mr-1" /> Record F&B Waste
              </button>
            )}
            {activeTab === 'transfers' && (
              <button onClick={() => setShowTransferModal(true)} className="px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
                <Truck size={14} className="inline-block mr-1" /> New F&B Transfer
              </button>
            )}
            {activeTab === 'consumption' && (
              <button onClick={() => setShowConsumptionModal(true)} className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                <BookOpen size={14} className="inline-block mr-1" /> Record F&B Consumption
              </button>
            )}
            {activeTab === 'movements' && (
              <button onClick={() => setShowMovementModal(true)} className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                <Plus size={14} className="inline-block mr-1" /> Record Movement
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
            changeLabel={stat.changeLabel}
            icon={stat.icon}
            color={stat.color as any}
          />
        ))}
      </div>

      {/* Low-stock alert banner */}
      {criticalStockItems.length > 0 && (
        <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
          <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
          <div className="flex-1 text-sm">
            <span className="font-medium text-red-700 dark:text-red-400">
              {criticalStockItems.length} item{criticalStockItems.length > 1 ? 's' : ''} at or below minimum stock:
            </span>
            <span className="text-red-600 dark:text-red-400 ml-2">
              {criticalStockItems.slice(0, 5).map(i => `${i.name} (${i.current_quantity} ${i.unit_of_measure})`).join(', ')}
              {criticalStockItems.length > 5 && ` +${criticalStockItems.length - 5} more`}
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
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className={`inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 text-xs font-medium rounded-full ${
                activeTab === tab.id
                  ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                  : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Filter Bar — shown on inventory + stock-count tabs (search/filter) */}
      {(activeTab === 'inventory' || activeTab === 'stock-count') && (
      <div className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-gray-200 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white w-48"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-600 dark:text-slate-400">Type:</label>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
          >
            <option value="all">All</option>
            <option value="food">Food</option>
            <option value="beverage">Beverage</option>
          </select>
        </div>
        {activeTab === 'inventory' && (
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600 dark:text-slate-400">Item Type:</label>
            <select
              value={filterItemType}
              onChange={(e) => setFilterItemType(e.target.value as any)}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
            >
              <option value="all">All Types</option>
              <option value="consumable">Consumable</option>
              <option value="non-consumable">Non-Consumable</option>
            </select>
          </div>
        )}
        {activeTab === 'inventory' && (
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600 dark:text-slate-400">Category:</label>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
            >
              <option value="all">All Categories</option>
              {categories.filter(c => !c.parent_category_id).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}
        {activeTab === 'inventory' && (
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600 dark:text-slate-400">Storage:</label>
            <select
              value={filterStorageType}
              onChange={(e) => setFilterStorageType(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
            >
              <option value="all">All Storage</option>
              <option value="perishable">Perishable</option>
              <option value="non-perishable">Non-Perishable</option>
              <option value="frozen">Frozen</option>
              <option value="dry">Dry</option>
              <option value="ambient">Ambient</option>
            </select>
          </div>
        )}
        {activeTab === 'inventory' && (
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600 dark:text-slate-400">Location:</label>
            <select
              value={filterLocation}
              onChange={(e) => setFilterLocation(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
            >
              <option value="all">All Locations</option>
              {Array.from(new Set(inventoryItems.map(i => i.location).filter(Boolean))).sort().map(loc => (
                <option key={loc} value={loc}>{loc}</option>
              ))}
            </select>
          </div>
        )}
        {(filterType !== 'all' || searchTerm || (activeTab === 'inventory' && filterItemType !== 'all') || (activeTab === 'inventory' && filterLocation !== 'all') || (activeTab === 'inventory' && filterCategory !== 'all') || (activeTab === 'inventory' && filterStorageType !== 'all')) && (
          <button
            onClick={() => { setFilterType('all'); setSearchTerm(''); setFilterItemType('all'); setFilterLocation('all'); setFilterCategory('all'); setFilterStorageType('all'); }}
            className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
          >
            Clear Filters
          </button>
        )}
      </div>
      )}

      {/* Loading / Error states */}
      {loading && (
        <div className="p-8 flex justify-center"><Loader2 size={20} className="animate-spin text-gray-400" /></div>
      )}
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
          {parView === 'dynamic' && <DepartmentDynamicParPanel department="Food & Beverage" hideStats hideHeader refreshTrigger={parRefreshTrigger} recalculateTrigger={parRecalculateTrigger} autoReplenishTrigger={parAutoReplenishTrigger} />}
          {parView === 'overrides' && <DepartmentParOverridesPanel department="Food & Beverage" />}
        </div>
      )}

      {/* Content */}
      {!loading && !error && (
        <>
          {/* Inventory Tab */}
          {activeTab === 'inventory' && (
            <SectionCard title="F&B Inventory Listing" subtitle="All F&B items by store and category — par levels, stock status, and valuation">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Name</th>
                      <th className="px-4 py-3 font-medium">Category</th>
                      <th className="px-4 py-3 font-medium">Storage</th>
                      <th className="px-4 py-3 font-medium">Location</th>
                      <th className="px-4 py-3 font-medium">Stock Level</th>
                      <th className="px-4 py-3 font-medium">Qty</th>
                      <th className="px-4 py-3 font-medium">Unit</th>
                      <th className="px-4 py-3 font-medium">Unit Cost</th>
                      <th className="px-4 py-3 font-medium">Stock Value</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                    {inventoryItems
                      .filter(item => {
                        const matchesType = filterItemType === 'all' || item.type === filterItemType;
                        const matchesLocation = filterLocation === 'all' || item.location === filterLocation;
                        const matchesCategory = filterCategory === 'all' || item.category_id === filterCategory;
                        const matchesStorage = filterStorageType === 'all' || item.item_type === filterStorageType;
                        const matchesSearch = !searchTerm || 
                          item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          item.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          item.location.toLowerCase().includes(searchTerm.toLowerCase());
                        return matchesType && matchesLocation && matchesCategory && matchesStorage && matchesSearch;
                      })
                      .map((item) => {
                        const stockStatus = item.current_quantity <= item.minimum_stock && item.minimum_stock > 0 ? 'critical' : 
                                         item.current_quantity <= item.reorder_point && item.reorder_point > 0 ? 'low' : 'normal';
                        const stockValue = item.current_quantity * item.unit_cost;
                        // Progress bar: 0-100% based on current vs max (or reorder_point × 3 as fallback max)
                        const maxRef = item.maximum_stock || (item.reorder_point > 0 ? item.reorder_point * 3 : 100);
                        const stockPct = Math.min(100, Math.max(0, (item.current_quantity / maxRef) * 100));
                        return (
                          <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                            <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{item.name}</td>
                            <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{item.category}</td>
                            <td className="px-4 py-3">
                              <Badge tone={
                                item.item_type === 'perishable' ? 'danger'
                                : item.item_type === 'frozen' ? 'info'
                                : item.item_type === 'dry' ? 'warning'
                                : item.item_type === 'ambient' ? 'neutral'
                                : 'neutral'
                              }>
                                {item.item_type || 'non-perishable'}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{item.location}</td>
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
                                  min: {item.minimum_stock} · reorder: {item.reorder_point}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`font-medium ${stockStatus === 'critical' ? 'text-red-600' : stockStatus === 'low' ? 'text-amber-600' : 'text-slate-900 dark:text-white'}`}>
                                {item.current_quantity}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{item.unit_of_measure}</td>
                            <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{formatAmount(item.unit_cost)}</td>
                            <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-300">{formatAmount(stockValue)}</td>
                            <td className="px-4 py-3">
                              <Badge tone={stockStatus === 'critical' ? 'danger' : stockStatus === 'low' ? 'warning' : 'success'}>
                                {stockStatus}
                              </Badge>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => {
                                    setMovementForm(prev => ({ ...prev, item_id: item.id, quantity: item.current_quantity, transaction_type: 'adjustment' }));
                                    setShowMovementModal(true);
                                  }}
                                  className="p-1 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                                  title="Adjust stock"
                                >
                                  <Edit className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => {
                                    setMovementForm(prev => ({ ...prev, item_id: item.id, transaction_type: 'goods_receipt' }));
                                    setShowMovementModal(true);
                                  }}
                                  className="p-1 text-slate-400 hover:text-green-600 dark:hover:text-green-400 transition-colors"
                                  title="Receive goods"
                                >
                                  <ArrowDownToLine className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                  {(() => {
                    const filtered = inventoryItems.filter(item => {
                      const matchesType = filterItemType === 'all' || item.type === filterItemType;
                      const matchesLocation = filterLocation === 'all' || item.location === filterLocation;
                      const matchesCategory = filterCategory === 'all' || item.category_id === filterCategory;
                      const matchesStorage = filterStorageType === 'all' || item.item_type === filterStorageType;
                      const matchesSearch = !searchTerm || 
                        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        item.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        item.location.toLowerCase().includes(searchTerm.toLowerCase());
                      return matchesType && matchesLocation && matchesCategory && matchesStorage && matchesSearch;
                    });
                    const totalValue = filtered.reduce((sum, i) => sum + i.current_quantity * i.unit_cost, 0);
                    if (filtered.length === 0) return null;
                    return (
                      <tfoot className="bg-slate-50 dark:bg-slate-900/40 border-t-2 border-slate-300 dark:border-slate-500">
                        <tr>
                          <td colSpan={8} className="px-4 py-3 text-right text-slate-600 dark:text-slate-400 font-medium">
                            {filtered.length} items — Total Stock Value:
                          </td>
                          <td className="px-4 py-3 font-bold text-indigo-600 dark:text-indigo-400">{formatAmount(totalValue)}</td>
                          <td colSpan={2}></td>
                        </tr>
                      </tfoot>
                    );
                  })()}
                </table>
              </div>
            </SectionCard>
          )}

          {/* Replenishment & Requisition Tab — F&B-scoped replenishment + requisitions */}
          {activeTab === 'requisitions' && (
            <div className="space-y-6">
              <DepartmentReplenishmentPanel department="Food & Beverage" hideStats hideHeader refreshTrigger={replenishRefreshTrigger} autoReplenishTrigger={replenishAutoTrigger} />
              <DepartmentRequisitionForm department="Food & Beverage" hideStats hideHeader refreshTrigger={reqRefreshTrigger} newRequisitionTrigger={reqNewTrigger} />
            </div>
          )}

          {/* Consumption Tab */}
          {activeTab === 'consumption' && (
            <SectionCard title="Consumption Tracking" subtitle="Theoretical (from recipe) vs Actual Consumption">
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                Theoretical consumption is auto-calculated from recipe lines × servings sold.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 font-medium">Outlet</th>
                      <th className="px-4 py-3 font-medium">Item/Recipe</th>
                      <th className="px-4 py-3 font-medium">Theoretical</th>
                      <th className="px-4 py-3 font-medium">Actual</th>
                      <th className="px-4 py-3 font-medium">Variance</th>
                      <th className="px-4 py-3 font-medium">Cost</th>
                      <th className="px-4 py-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                    {consumption.map((record) => (
                      <tr key={record.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{record.date}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{record.outlet_name}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{record.item_name}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{record.theoretical_qty} {record.unit}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{record.actual_qty} {record.unit}</td>
                        <td className="px-4 py-3">
                          <Badge tone={record.variance_percent > -5 ? 'success' : 'danger'}>
                            {record.variance_qty} {record.unit} ({record.variance_percent}%)
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{formatAmount(record.cost)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button className={buttonStyles.ghost}><Edit className="w-4 h-4" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}

          {/* Waste Tab */}
          {activeTab === 'waste' && (
            <SectionCard title="Waste & Loss Tracking" subtitle="Preparation, Spoilage, Breakage, Expired, Overproduction, Plate, Complimentary">
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                Track all waste categories per spec: preparation, spoilage, expired, overproduction, plate, breakage, complimentary.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 font-medium">Outlet</th>
                      <th className="px-4 py-3 font-medium">Item</th>
                      <th className="px-4 py-3 font-medium">Type</th>
                      <th className="px-4 py-3 font-medium">Quantity</th>
                      <th className="px-4 py-3 font-medium">Reason</th>
                      <th className="px-4 py-3 font-medium">Cost</th>
                      <th className="px-4 py-3 font-medium">Reported By</th>
                      <th className="px-4 py-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                    {waste.map((record) => (
                      <tr key={record.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{record.date}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{record.outlet_name}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{record.item_name}</td>
                        <td className="px-4 py-3">
                          <Badge tone={record.waste_type === 'breakage' ? 'danger' : record.waste_type === 'spoilage' || record.waste_type === 'expired' ? 'warning' : 'neutral'}>
                            {record.waste_type}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{record.quantity} {record.unit}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{record.reason}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{formatAmount(record.cost)}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{record.reported_by}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button className={buttonStyles.ghost}><Edit className="w-4 h-4" /></button>
                            <button onClick={() => deleteTransaction(record.id)} className={buttonStyles.ghost}><Trash2 className="w-4 h-4 text-red-600" /></button>
                          </div>
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
            <SectionCard title="Inventory Transfers" subtitle="Inter-outlet inventory transfers">
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                Transfer stock between outlets. Source and destination must be different.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 font-medium">From</th>
                      <th className="px-4 py-3 font-medium">To</th>
                      <th className="px-4 py-3 font-medium">Item</th>
                      <th className="px-4 py-3 font-medium">Quantity</th>
                      <th className="px-4 py-3 font-medium">Reason</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                    {transfers.map((record) => (
                      <tr key={record.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{record.date}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{record.from_outlet_name}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{record.to_outlet_name}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{record.item_name}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{record.quantity} {record.unit}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{record.reason}</td>
                        <td className="px-4 py-3">
                          <Badge tone={record.status === 'completed' ? 'success' : record.status === 'approved' ? 'warning' : 'neutral'}>
                            {record.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button className={buttonStyles.ghost}><Edit className="w-4 h-4" /></button>
                            <button onClick={() => deleteTransaction(record.id)} className={buttonStyles.ghost}><Trash2 className="w-4 h-4 text-red-600" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}

          {/* Stock Movements Tab */}
          {activeTab === 'movements' && (
            <SectionCard title="Stock Movements" subtitle="Goods Receipt, Returns, Expiry, Spoilage, Stock Counts, Cycle Counts">
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                Record stock movements: goods receipt (add stock), returns, expiry, spoilage, stock counts, and cycle counts.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 font-medium">Type</th>
                      <th className="px-4 py-3 font-medium">Item</th>
                      <th className="px-4 py-3 font-medium">Outlet</th>
                      <th className="px-4 py-3 font-medium">Quantity</th>
                      <th className="px-4 py-3 font-medium">Cost</th>
                      <th className="px-4 py-3 font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                    {allTransactions
                      .filter(t => ['goods_receipt', 'stock_count', 'cycle_count', 'returns', 'expiry', 'spoilage', 'adjustment'].includes(t.transaction_type))
                      .map((tx) => (
                      <tr key={tx.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                          {tx.transaction_date ? String(tx.transaction_date).slice(0, 10) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={
                            tx.transaction_type === 'goods_receipt' ? 'success'
                            : tx.transaction_type === 'returns' ? 'info'
                            : tx.transaction_type === 'expiry' || tx.transaction_type === 'spoilage' ? 'danger'
                            : 'neutral'
                          }>
                            {tx.transaction_type.replace(/_/g, ' ')}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{tx.item?.name || '—'}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                          {tx.to_outlet?.name || tx.from_outlet?.name || '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{tx.quantity} {tx.item?.unit_of_measure || ''}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{formatAmount(Number(tx.total_cost || 0))}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{tx.reason || '—'}</td>
                      </tr>
                    ))}
                    {allTransactions.filter(t => ['goods_receipt', 'stock_count', 'cycle_count', 'returns', 'expiry', 'spoilage', 'adjustment'].includes(t.transaction_type)).length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                          No stock movements recorded yet. Use "Record Movement" to add goods receipt, returns, expiry, spoilage, or stock counts.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}

          {/* Stock Count Tab — F&B-scoped shared module */}
          {activeTab === 'stock-count' && (
            <StockCountsModule
              storeFilter={['UINV-ST-FOOD', 'UINV-ST-BEV']}
              title="F&B Stock Counts"
              subtitle="Physical inventory counts for the Food Store and Beverage Store"
              hideStats
              hideHeader
              refreshTrigger={countRefreshTrigger}
              newCountTrigger={countNewTrigger}
            />
          )}

          {/* Variance Tab */}
          {activeTab === 'variance' && (
            <SectionCard title="Variance Analysis" subtitle="Theoretical vs Actual Consumption Variance (Qty + Cost)">
              <div className="space-y-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">Item/Recipe</th>
                        <th className="px-4 py-3 font-medium">Category</th>
                        <th className="px-4 py-3 font-medium">Theoretical</th>
                        <th className="px-4 py-3 font-medium">Actual</th>
                        <th className="px-4 py-3 font-medium">Variance Qty</th>
                        <th className="px-4 py-3 font-medium">Variance %</th>
                        <th className="px-4 py-3 font-medium">Cost Variance</th>
                        <th className="px-4 py-3 font-medium">Severity</th>
                        <th className="px-4 py-3 font-medium">Trend</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                      {varianceData.aggregated.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                            No variance data available. Variance is calculated from consumption transactions with theoretical vs actual quantities.
                          </td>
                        </tr>
                      ) : varianceData.aggregated.map((row) => {
                        const isHigh = row.severity === 'high';
                        const isMedium = row.severity === 'medium';
                        const isNa = row.severity === 'na';
                        const varianceClass = isNa ? 'text-slate-400' : isHigh ? 'text-red-600' : isMedium ? 'text-amber-600' : 'text-green-600';
                        const pctDisplay = row.variance_percent === null
                          ? 'N/A'
                          : `${row.variance_percent > 0 ? '+' : ''}${row.variance_percent}%`;
                        return (
                          <tr key={row.item_id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                            <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{row.item_name}</td>
                            <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{row.category || '—'}</td>
                            <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{row.theoretical} {row.unit}</td>
                            <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{row.actual} {row.unit}</td>
                            <td className={`px-4 py-3 ${varianceClass}`}>
                              {isNa ? '—' : `${row.variance_qty > 0 ? '+' : ''}${row.variance_qty} ${row.unit}`}
                            </td>
                            <td className={`px-4 py-3 ${varianceClass}`}>{pctDisplay}</td>
                            <td className={`px-4 py-3 ${varianceClass}`}>
                              {isNa ? '—' : `${row.variance_cost > 0 ? '+' : ''}${formatAmount(row.variance_cost)}`}
                            </td>
                            <td className="px-4 py-3">
                              <Badge tone={isNa ? 'neutral' : isHigh ? 'danger' : isMedium ? 'warning' : 'success'}>
                                {isNa ? 'N/A' : row.severity}
                              </Badge>
                            </td>
                            <td className="px-4 py-3">
                              {isNa ? (
                                <Scale className="w-4 h-4 text-slate-300" />
                              ) : row.variance_percent !== null && row.variance_percent < 0 ? (
                                <TrendingDown className={`w-4 h-4 ${isHigh ? 'text-red-500' : 'text-amber-500'}`} />
                              ) : row.variance_percent !== null && row.variance_percent > 0 ? (
                                <TrendingUp className="w-4 h-4 text-green-500" />
                              ) : (
                                <Scale className="w-4 h-4 text-slate-400" />
                              )}
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

          {/* Inter-Department Transfer Tab */}
          {activeTab === 'inter-dept-transfer' && (
            <InterDepartmentTransferPanel sourceDepartment="Food & Beverage" />
          )}
        </>
      )}

      {/* Consumption Modal — theoretical auto-calculated from recipe */}
      {showConsumptionModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Record Consumption</h2>
              <button onClick={() => setShowConsumptionModal(false)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Menu Item</label>
                  <select
                    value={consumptionForm.menu_item_id}
                    onChange={(e) => onConsumptionMenuItemChange(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value="">Select menu item...</option>
                    {menuItems.map(mi => (
                      <option key={mi.id} value={mi.id}>
                        {mi.name} {mi.recipe_lines?.length ? `(${mi.recipe_lines.length} ingredients)` : '(no recipe)'}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Servings Sold</label>
                  <input
                    type="number"
                    min="1"
                    value={consumptionForm.servings_sold}
                    onChange={(e) => onServingsChange(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Outlet</label>
                <select
                  value={consumptionForm.outlet_id}
                  onChange={(e) => setConsumptionForm(prev => ({ ...prev, outlet_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="">Select outlet...</option>
                  {Array.from(new Set(inventoryItems.map(i => i.location).filter(Boolean))).sort().map(loc => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
              </div>

              {consumptionForm.actual_quantities.length > 0 && (
                <div className="border border-slate-200 dark:border-slate-600 rounded-lg overflow-hidden">
                  <div className="bg-slate-50 dark:bg-slate-900/40 px-4 py-2 text-xs uppercase text-slate-500 font-medium">
                    Recipe Breakdown — Theoretical auto-calculated, enter actual counted usage
                  </div>
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-slate-500">
                      <tr>
                        <th className="px-4 py-2 font-medium">Ingredient</th>
                        <th className="px-4 py-2 font-medium">Theoretical (from recipe)</th>
                        <th className="px-4 py-2 font-medium">Actual (counted)</th>
                        <th className="px-4 py-2 font-medium">Variance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                      {consumptionForm.actual_quantities.map((aq) => {
                        const variance = aq.actual_qty - aq.theoretical_qty;
                        const varianceClass = Math.abs(variance) < 0.001 ? 'text-slate-400' : variance < 0 ? 'text-red-600' : 'text-green-600';
                        return (
                          <tr key={aq.ingredient_id}>
                            <td className="px-4 py-2 text-slate-700 dark:text-slate-300">{aq.ingredient_name}</td>
                            <td className="px-4 py-2 text-slate-600 dark:text-slate-400">
                              {aq.theoretical_qty} {aq.unit}
                            </td>
                            <td className="px-4 py-2">
                              <input
                                type="number"
                                step="0.001"
                                value={aq.actual_qty}
                                onChange={(e) => updateActualQty(aq.ingredient_id, Number(e.target.value))}
                                className="w-24 px-2 py-1 border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
                              />
                              <span className="ml-1 text-xs text-slate-400">{aq.unit}</span>
                            </td>
                            <td className={`px-4 py-2 ${varianceClass}`}>
                              {Math.abs(variance) < 0.001 ? '—' : `${variance > 0 ? '+' : ''}${variance.toFixed(4)} ${aq.unit}`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {consumptionForm.menu_item_id && consumptionForm.actual_quantities.length === 0 && (
                <div className="text-center py-4 text-amber-600 text-sm">
                  This menu item has no recipe. Theoretical consumption cannot be calculated.
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <button
                  onClick={submitConsumption}
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  Record Consumption
                </button>
                <button
                  onClick={() => setShowConsumptionModal(false)}
                  className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Waste Modal — all 8 waste types from spec */}
      {showWasteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Record Waste</h2>
              <button onClick={() => setShowWasteModal(false)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Item</label>
                <select
                  value={wasteForm.item_id}
                  onChange={(e) => setWasteForm(prev => ({ ...prev, item_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="">Select item...</option>
                  {inventoryItems.filter(i => i.type === 'consumable').map(i => (
                    <option key={i.id} value={i.id}>{i.name} ({i.unit_of_measure})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Outlet</label>
                <select
                  value={wasteForm.outlet_id}
                  onChange={(e) => setWasteForm(prev => ({ ...prev, outlet_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="">Select outlet...</option>
                  {outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Waste Type</label>
                <select
                  value={wasteForm.waste_type}
                  onChange={(e) => setWasteForm(prev => ({ ...prev, waste_type: e.target.value as WasteType }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="waste">General Waste</option>
                  <option value="preparation">Preparation Waste</option>
                  <option value="spoilage">Spoilage</option>
                  <option value="expired">Expired Items</option>
                  <option value="overproduction">Overproduction</option>
                  <option value="plate">Plate Waste</option>
                  <option value="breakage">Breakage</option>
                  <option value="complimentary">Complimentary Waste</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Quantity</label>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={wasteForm.quantity}
                    onChange={(e) => setWasteForm(prev => ({ ...prev, quantity: Number(e.target.value) }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Reason</label>
                  <input
                    type="text"
                    value={wasteForm.reason}
                    onChange={(e) => setWasteForm(prev => ({ ...prev, reason: e.target.value }))}
                    placeholder="e.g. Burned batch, dropped, expired"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <button onClick={submitWaste} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">
                  Record Waste
                </button>
                <button onClick={() => setShowWasteModal(false)} className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Transfer Modal — inter-outlet stock transfer */}
      {showTransferModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Record Transfer</h2>
              <button onClick={() => setShowTransferModal(false)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Item</label>
                <select
                  value={transferForm.item_id}
                  onChange={(e) => setTransferForm(prev => ({ ...prev, item_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="">Select item...</option>
                  {inventoryItems.map(i => (
                    <option key={i.id} value={i.id}>{i.name} ({i.unit_of_measure}) — {formatAmount(i.unit_cost)}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">From Outlet</label>
                  <select
                    value={transferForm.from_outlet_id}
                    onChange={(e) => setTransferForm(prev => ({ ...prev, from_outlet_id: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value="">Source...</option>
                    {outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">To Outlet</label>
                  <select
                    value={transferForm.to_outlet_id}
                    onChange={(e) => setTransferForm(prev => ({ ...prev, to_outlet_id: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value="">Destination...</option>
                    {outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Quantity</label>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={transferForm.quantity}
                    onChange={(e) => setTransferForm(prev => ({ ...prev, quantity: Number(e.target.value) }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Reason</label>
                  <input
                    type="text"
                    value={transferForm.reason}
                    onChange={(e) => setTransferForm(prev => ({ ...prev, reason: e.target.value }))}
                    placeholder="e.g. Restock outlet, event transfer"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <button onClick={submitTransfer} className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
                  Record Transfer
                </button>
                <button onClick={() => setShowTransferModal(false)} className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stock Movement Modal — goods receipt, returns, expiry, spoilage, stock/cycle counts */}
      {showMovementModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Record Stock Movement</h2>
              <button onClick={() => setShowMovementModal(false)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Movement Type</label>
                <select
                  value={movementForm.transaction_type}
                  onChange={(e) => setMovementForm(prev => ({ ...prev, transaction_type: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="goods_receipt">Goods Receipt (add stock)</option>
                  <option value="returns">Returns (add stock back)</option>
                  <option value="expiry">Expiry (remove stock)</option>
                  <option value="spoilage">Spoilage (remove stock)</option>
                  <option value="stock_count">Stock Count (adjustment)</option>
                  <option value="cycle_count">Cycle Count (adjustment)</option>
                  <option value="adjustment">Adjustment (manual)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Item</label>
                <select
                  value={movementForm.item_id}
                  onChange={(e) => setMovementForm(prev => ({ ...prev, item_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="">Select item...</option>
                  {inventoryItems.map(i => (
                    <option key={i.id} value={i.id}>{i.name} ({i.unit_of_measure}) — stock: {i.current_quantity}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Outlet</label>
                <select
                  value={movementForm.outlet_id}
                  onChange={(e) => setMovementForm(prev => ({ ...prev, outlet_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="">Select outlet...</option>
                  {outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Quantity</label>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={movementForm.quantity}
                    onChange={(e) => setMovementForm(prev => ({ ...prev, quantity: Number(e.target.value) }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Reason</label>
                  <input
                    type="text"
                    value={movementForm.reason}
                    onChange={(e) => setMovementForm(prev => ({ ...prev, reason: e.target.value }))}
                    placeholder="e.g. PO #1234, expired batch, count variance"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <button onClick={submitMovement} className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                  Record Movement
                </button>
                <button onClick={() => setShowMovementModal(false)} className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}