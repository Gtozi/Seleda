/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Package,
  Search,
  Filter,
  ArrowUpRight,
  AlertTriangle,
  CheckCircle2,
  History,
  Plus,
  Box,
  Truck,
  FileText,
  Activity,
  Warehouse,
  ShieldCheck,
  Zap,
  ArrowDownToLine,
  MoreVertical,
  ClipboardCheck,
  BarChart3,
  X,
  RefreshCw,
  Trash2,
  Store as StoreIcon,
  Pencil,
  Building2
} from 'lucide-react';
import StockCountModal from './StockCountModal';
import { useERP } from '../../context/ERPContext';
import { ModalSystem } from '../Shared/ModalSystem';
import { InventoryItem } from './FoodBeveragePortal';
import DepartmentDynamicParPanel from '../Inventory/DepartmentDynamicParPanel';
import DepartmentParOverridesPanel from '../Inventory/DepartmentParOverridesPanel';
import {
  fetchStockByDepartment,
  createItem,
  createWaste,
  fetchWaste,
  fetchStores,
  createStore as createUinvStore,
  updateStore as updateUinvStore,
  deleteStore as deleteUinvStore,
  isConsumableItem,
  isFixedAssetItem,
  type UinvStockBalance,
  type UinvStore,
  type UinvWaste,
} from '../../services/inventoryService';

// ── Display-item shape derived from unified stock balances ─────────────
// Maps a UinvStockBalance (with nested item + store) into the InventoryItem
// shape the existing table JSX expects, so the table renders from the
// unified single source of truth instead of ERPContext.inventoryItems.
interface DisplayItem extends InventoryItem {
  balanceId: string;
  storeId: string;
  storeName: string;
  rawItemType: string;
}

function toDisplayItem(b: UinvStockBalance): DisplayItem {
  const item = b.item;
  const store = b.store;
  const itemType = item?.item_type || 'Consumable';
  const isFixedAsset = isFixedAssetItem({ item_type: itemType });
  return {
    id: b.item_id || item?.id || b.id,
    balanceId: b.id,
    storeId: b.store_id,
    storeName: store?.store_name || b.store_id || '—',
    rawItemType: itemType,
    code: item?.item_code || '',
    name: item?.item_name || 'Unknown',
    category: isFixedAsset ? 'Fixed Assets' as any : 'Food & Beverage' as any,
    subcategory: (item?.subcategory as any) || (item?.category === 'Food & Beverage' ? 'Food' : 'Consumables'),
    unit: item?.unit_of_measure || 'Pcs',
    supplierId: '',
    minStock: Number(item?.min_stock || 0),
    maxStock: Number(item?.max_stock || 0),
    reorderLevel: Number(item?.reorder_point || 0),
    lastCost: Number(b.unit_cost || item?.last_cost || 0),
    avgCost: Number(item?.avg_cost || 0),
    currentStock: Number(b.on_hand || 0),
    location: store?.store_name || b.store_id || '—',
  };
}

export default function InventoryModule({ forcedStore }: { forcedStore?: string }) {
  const {
    formatAmount,
    addNotification,
    auditLogs,
    globalHotelSettings,
    currentPropertyId
  } = useERP();

  const [activeType, setActiveType] = useState<'Consumable' | 'Fixed Asset'>('Consumable');
  const [activeTab, setActiveTab] = useState<'inventory' | 'transactions' | 'cost-control' | 'dynamic-par' | 'par-overrides'>('inventory');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStore, setSelectedStore] = useState<string>(forcedStore || 'All');
  const [showAudit, setShowAudit] = useState(false);
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [isCreatingRequisition, setIsCreatingRequisition] = useState(false);
  const [isCreatingStockCount, setIsCreatingStockCount] = useState(false);
  const [stockCountLines, setStockCountLines] = useState<{ ingredientId: string; countedQty: number }[]>([]);

  // Store management state
  const [showStoreManager, setShowStoreManager] = useState(false);
  const [isAddingStore, setIsAddingStore] = useState(false);
  const [editingStoreId, setEditingStoreId] = useState<string | null>(null);
  const [newStore, setNewStore] = useState({ name: '', type: 'Departmental' as 'Main' | 'Departmental' | 'Virtual', manager: '' });

  // API data state — unified uinv_* system (single source of truth)
  const [loading, setLoading] = useState(true);
  const [unifiedStock, setUnifiedStock] = useState<UinvStockBalance[]>([]);
  // Unified F&B stores (persisted to uinv_stores, not ERPContext memory)
  const [unifiedStores, setUnifiedStores] = useState<UinvStore[]>([]);
  // Waste records from the unified ledger (replaces the string-parsed lossRegistry)
  const [wasteRecords, setWasteRecords] = useState<UinvWaste[]>([]);
  const [lossSubmitting, setLossSubmitting] = useState(false);
  const [storeSubmitting, setStoreSubmitting] = useState(false);

  const [newItem, setNewItem] = useState<Partial<InventoryItem>>({
    name: '',
    category: 'Consumable',
    stockCategory: globalHotelSettings.posCategories?.[0] || 'Food',
    unit: 'Pcs',
    quantity: 0,
    minLevel: 5,
    cost: 0,
    location: forcedStore || 'All'
  });

  // Load F&B inventory data from unified uinv_* system (single source of truth)
  // and unified F&B stores + waste records.
  const reloadUnifiedData = async () => {
    setLoading(true);
    try {
      const [stockBalances, stores, waste] = await Promise.all([
        fetchStockByDepartment('Food & Beverage', currentPropertyId),
        fetchStores({ active: 'true' }).then((all: UinvStore[]) =>
          (all || []).filter(s => s.department === 'Food & Beverage' || s.store_code === 'UINV-ST-FOOD' || s.store_code === 'UINV-ST-BEV'),
        ).catch(() => [] as UinvStore[]),
        fetchWaste().catch(() => [] as UinvWaste[]),
      ]);
      setUnifiedStock(stockBalances);
      setUnifiedStores(stores);
      setWasteRecords(waste);
    } catch (error) {
      console.error('Failed to load unified inventory data:', error);
      addNotification('Failed to load inventory data from server', 'error', 'Inventory');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reloadUnifiedData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId]);

  const handleAddItem = async () => {
    if (!newItem.name) return;

    try {
      // Create item via unified inventory service (single source of truth)
      await createItem({
        property_id: currentPropertyId || null,
        item_code: `FB-${Math.random().toString(36).substring(7).toUpperCase()}`,
        item_name: newItem.name!,
        category: 'Food & Beverage',
        subcategory: newItem.stockCategory as string || 'Food',
        item_type: 'Consumable',
        unit_of_measure: newItem.unit || 'Pcs',
        min_stock: newItem.minLevel || 5,
        max_stock: 100,
        reorder_point: 10,
        safety_stock: 0,
        par_level: newItem.minLevel || 5,
        last_cost: newItem.cost || 0,
        avg_cost: newItem.cost || 0,
        standard_cost: newItem.cost || 0,
        is_active: true,
      });

      // Reload unified stock so the table reflects the new item
      await reloadUnifiedData();

      setIsAddingItem(false);
      addNotification(`Added ${newItem.name} to inventory.`, 'success', 'Inventory');
    } catch (error) {
      console.error('Failed to add item:', error);
      addNotification('Failed to add item to inventory', 'error', 'Inventory');
    }
  };

  // ── Display items derived from unified stock balances ───────────────
  // The table now renders from the unified uinv_* system (single source of
  // truth) instead of ERPContext.inventoryItems (legacy in-memory state).
  const displayItems: DisplayItem[] = useMemo(
    () => (Array.isArray(unifiedStock) ? unifiedStock.map(toDisplayItem) : []),
    [unifiedStock],
  );

  // F&B stores from the unified uinv_stores table (persisted, not ERPContext memory).
  // Mapped to the { id, name, type, manager } shape the dropdown/cards expect.
  const fbStores = useMemo(() => unifiedStores.map(s => ({
    id: s.id,
    name: s.store_name,
    type: (s.store_type === 'Warehouse' ? 'Main' : s.store_type === 'Virtual' ? 'Virtual' : 'Departmental') as 'Main' | 'Departmental' | 'Virtual',
    manager: s.manager || '',
  })), [unifiedStores]);

  const handleAddStore = async () => {
    if (!newStore.name.trim() || !newStore.manager.trim()) {
      addNotification('Please fill in store name and manager.', 'warning', 'F&B');
      return;
    }
    setStoreSubmitting(true);
    try {
      await createUinvStore({
        store_code: `FB-ST-${Date.now().toString().slice(-6)}`,
        store_name: newStore.name.trim(),
        store_type: newStore.type === 'Main' ? 'Warehouse' : newStore.type === 'Virtual' ? 'Virtual' : 'Department',
        manager: newStore.manager.trim(),
        department: 'Food & Beverage',
        is_active: true,
        property_id: currentPropertyId || null,
      });
      await reloadUnifiedData();
      addNotification(`Store "${newStore.name.trim()}" created successfully.`, 'success', 'F&B');
      setNewStore({ name: '', type: 'Departmental', manager: '' });
      setIsAddingStore(false);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create store', 'error', 'F&B');
    } finally {
      setStoreSubmitting(false);
    }
  };

  const handleUpdateStore = async () => {
    if (!editingStoreId || !newStore.name.trim() || !newStore.manager.trim()) {
      addNotification('Please fill in store name and manager.', 'warning', 'F&B');
      return;
    }
    setStoreSubmitting(true);
    try {
      await updateUinvStore(editingStoreId, {
        store_name: newStore.name.trim(),
        store_type: newStore.type === 'Main' ? 'Warehouse' : newStore.type === 'Virtual' ? 'Virtual' : 'Department',
        manager: newStore.manager.trim(),
      });
      await reloadUnifiedData();
      addNotification(`Store "${newStore.name.trim()}" updated successfully.`, 'success', 'F&B');
      setNewStore({ name: '', type: 'Departmental', manager: '' });
      setEditingStoreId(null);
      setIsAddingStore(false);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update store', 'error', 'F&B');
    } finally {
      setStoreSubmitting(false);
    }
  };

  const handleDeleteStore = async (storeId: string, storeName: string) => {
    const itemCount = displayItems.filter(i => i.storeName === storeName).length;
    if (itemCount > 0) {
      addNotification(`Cannot delete "${storeName}" — it still has ${itemCount} item(s). Transfer or remove them first.`, 'warning', 'F&B');
      return;
    }
    setStoreSubmitting(true);
    try {
      await deleteUinvStore(storeId);
      await reloadUnifiedData();
      addNotification(`Store "${storeName}" deleted.`, 'warning', 'F&B');
      if (selectedStore === storeName) setSelectedStore('All');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete store', 'error', 'F&B');
    } finally {
      setStoreSubmitting(false);
    }
  };

  const startEditStore = (store: typeof fbStores[0]) => {
    setEditingStoreId(store.id);
    setNewStore({ name: store.name, type: store.type, manager: store.manager });
    setIsAddingStore(true);
  };

  const getStoreItemCount = (storeName: string) =>
    displayItems.filter(i => i.storeName === storeName).length;

  const getStoreValue = (storeName: string) =>
    displayItems
      .filter(i => i.storeName === storeName)
      .reduce((acc, item) => acc + (item.lastCost * (item.currentStock || 0)), 0);

  const filteredInventory = displayItems.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) || item.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStore = selectedStore === 'All' || item.storeName === selectedStore;

    // Type matching logic — uses the unified item_type via rawItemType
    const isFixedAsset = isFixedAssetItem({ item_type: item.rawItemType });
    const isConsumable = isConsumableItem({ item_type: item.rawItemType });

    if (activeType === 'Fixed Asset' && !isFixedAsset) return false;
    if (activeType === 'Consumable' && !isConsumable) return false;

    return matchesSearch && matchesStore;
  });

  const [isRecordingLoss, setIsRecordingLoss] = useState(false);
  const [selectedItemForLoss, setSelectedItemForLoss] = useState<DisplayItem | null>(null);
  const [lossData, setLossData] = useState({ qty: 0, reason: '', type: 'Spoilage' as 'Spoilage' | 'Damage' | 'Broken' | 'Lost' | 'Theft' | 'Expired' | 'Contamination' | 'Discarded' });

  const handleRecordLoss = async () => {
    if (!selectedItemForLoss || lossData.qty <= 0) return;

    setLossSubmitting(true);
    try {
      // Route the loss through the unified waste endpoint so it hits the
      // uinv_stock_ledger and is visible to valuation + dynamic par.
      await createWaste({
        property_id: currentPropertyId || null,
        item_id: selectedItemForLoss.id,
        store_id: selectedItemForLoss.storeId,
        quantity: lossData.qty,
        unit_cost: selectedItemForLoss.lastCost,
        total_cost: lossData.qty * selectedItemForLoss.lastCost,
        waste_type: lossData.type,
        reason: lossData.reason || 'Not specified',
        department: 'Food & Beverage',
        status: 'Approved',
      });

      // Reload unified data so stock + waste registry reflect the loss
      await reloadUnifiedData();

      addNotification(
        `Recorded ${lossData.qty} ${selectedItemForLoss.unit} as ${lossData.type} for ${selectedItemForLoss.name}.`,
        'warning',
        'Inventory',
      );

      setIsRecordingLoss(false);
      setSelectedItemForLoss(null);
      setLossData({ qty: 0, reason: '', type: 'Spoilage' });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to record loss', 'error', 'Inventory');
    } finally {
      setLossSubmitting(false);
    }
  };

  // Waste registry from the unified uinv_waste table (replaces the fragile
  // string-parsed lossRegistry that read from audit log entries).
  const lossRegistry = useMemo(() => wasteRecords.map(w => ({
    timestamp: w.created_at,
    type: w.waste_type || 'Unknown',
    item: w.item?.item_name || w.item_id || 'Unknown',
    qty: String(w.quantity || 0),
    reason: w.reason || 'Not specified',
  })), [wasteRecords]);

  const stats = {
    totalValue: filteredInventory.reduce((acc, item) => acc + (item.lastCost * (item.currentStock || 0)), 0),
    stockouts: filteredInventory.filter(i => i.currentStock <= 0).length,
    lowStock: filteredInventory.filter(i => i.currentStock > 0 && i.currentStock <= i.minStock).length,
  };

  return (
    <div className="space-y-6 font-sans animate-fade-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 p-6 rounded-[2rem] shadow-3xs">
        <div className="space-y-1">
          <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">F&B Inventory Governance</h3>
          <p className="text-[10px] text-slate-400 font-mono italic">Dedicated sub-store management for consumables and fixed assets.</p>
        </div>

        {/* View mode toggle: Inventory / Dynamic Par */}
        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl gap-1">
          <button
            onClick={() => setActiveTab('inventory')}
            className={`px-4 py-2 rounded-xl text-[10px] font-black transition-all ${
              activeTab === 'inventory'
                ? 'bg-white dark:bg-slate-700 text-slate-950 dark:text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            INVENTORY
          </button>
          <button
            onClick={() => setActiveTab('dynamic-par')}
            className={`px-4 py-2 rounded-xl text-[10px] font-black transition-all ${
              activeTab === 'dynamic-par'
                ? 'bg-white dark:bg-slate-700 text-slate-950 dark:text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            DYNAMIC PAR
          </button>
          <button
            onClick={() => setActiveTab('par-overrides')}
            className={`px-4 py-2 rounded-xl text-[10px] font-black transition-all ${
              activeTab === 'par-overrides'
                ? 'bg-white dark:bg-slate-700 text-slate-950 dark:text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            PAR OVERRIDES
          </button>
        </div>

        {/* Inventory view controls (only shown in inventory mode) */}
        {activeTab === 'inventory' && (
          <>
            <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl gap-1">
              <button
                onClick={() => setActiveType('Consumable')}
                className={`px-5 py-2 rounded-xl text-[10px] font-black transition-all flex items-center gap-2 ${
                  activeType === 'Consumable'
                  ? 'bg-white dark:bg-slate-700 text-slate-950 dark:text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <Box size={14} /> CONSUMABLES
              </button>
              <button
                onClick={() => setActiveType('Fixed Asset')}
                className={`px-5 py-2 rounded-xl text-[10px] font-black transition-all flex items-center gap-2 ${
                  activeType === 'Fixed Asset'
                  ? 'bg-white dark:bg-slate-700 text-slate-950 dark:text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <ShieldCheck size={14} /> FIXED ASSETS
              </button>
              <div className="w-px bg-slate-200 dark:bg-slate-600 mx-1 my-1" />
              <select
                value={selectedStore}
                onChange={(e) => setSelectedStore(e.target.value)}
                className="bg-transparent text-[10px] font-black uppercase tracking-widest text-slate-500 outline-none px-4 py-2"
              >
                <option value="All">All Stores</option>
                {fbStores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowStoreManager(true)}
                className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-tight shadow-lg shadow-indigo-600/10 hover:bg-indigo-700 transition-all"
              >
                <StoreIcon size={14} /> MANAGE STORES
              </button>
              <button
                onClick={() => setIsCreatingStockCount(true)}
                className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-tight shadow-lg shadow-emerald-600/10 hover:bg-emerald-700 transition-all"
              >
                <ClipboardCheck size={14} /> STOCK COUNT
              </button>
              <button
                onClick={() => setIsAddingItem(true)}
                className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 dark:bg-white dark:text-slate-950 text-white rounded-2xl text-[10px] font-black uppercase tracking-tight shadow-lg shadow-slate-900/10 hover:bg-indigo-600 transition-all"
              >
                <Plus size={14} /> NEW ITEM
              </button>
              <div className="relative">
                <Search className="absolute left-3 top-3 text-slate-400" size={14} />
                <input
                  type="text"
                  placeholder="Filter by ID/Name..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full md:w-52 bg-slate-50 dark:bg-slate-850 border dark:border-slate-800 p-2.5 pl-10 rounded-2xl text-xs outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
                />
              </div>
              <button
                onClick={() => addNotification('Opening inventory filters...', 'info', 'Sub-Store')}
                className="p-2.5 border dark:border-slate-800 rounded-2xl hover:bg-slate-50 text-slate-400 transition-colors"
              >
                <Filter size={16} />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Dynamic Par view */}
      {activeTab === 'dynamic-par' && (
        <DepartmentDynamicParPanel department="Food & Beverage" />
      )}

      {/* Manual Par Overrides view */}
      {activeTab === 'par-overrides' && (
        <DepartmentParOverridesPanel department="Food & Beverage" />
      )}

      {/* Inventory view (table + side panel) */}
      {activeTab === 'inventory' && (
      <>
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
        <div className="lg:col-span-3 space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 rounded-[2.5rem] shadow-3xs overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-850/50 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-150 dark:border-slate-800">
                  <th className="px-8 py-5">Product/Asset Info</th>
                  <th className="px-8 py-5">Stock Details</th>
                  <th className="px-8 py-5">Unit Value</th>
                  <th className="px-8 py-5">Deployment</th>
                  <th className="px-8 py-5 text-right">Ops</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredInventory.map(item => {
                  const isLow = item.currentStock <= item.minStock;
                  return (
                    <tr key={item.id} className="group hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-5">
                          <div className={`p-3.5 rounded-2xl shadow-sm ${
                            item.subcategory === 'Food' ? 'bg-orange-100 text-orange-600' :
                            item.subcategory === 'Beverages' ? 'bg-indigo-100 text-indigo-600' :
                            'bg-slate-100 text-slate-400'
                          }`}>
                            <Package size={20} />
                          </div>
                          <div className="space-y-0.5">
                            <p className="text-sm font-black text-slate-850 dark:text-white uppercase tracking-tight">{item.name}</p>
                            <div className="flex items-center gap-2">
                               <span className="text-[9px] font-black text-indigo-500/60 uppercase">{item.code}</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <div className="space-y-1">
                           <div className="flex items-center gap-2">
                             <span className={`text-base font-black ${isLow ? 'text-rose-600' : 'text-slate-800 dark:text-slate-200'}`}>
                               {item.currentStock} <span className="text-[10px] uppercase">{item.unit}</span>
                             </span>
                             {isLow && <AlertTriangle size={14} className="text-rose-500 animate-pulse" />}
                           </div>
                           <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Safety Margin: {item.minStock}</p>
                        </div>
                      </td>
                      <td className="px-8 py-6 font-black text-xs text-slate-700 dark:text-slate-300">
                        {formatAmount(item.lastCost)}
                        <p className="text-[8px] text-slate-400 uppercase tracking-tighter mt-0.5 font-bold italic">Base Purchase</p>
                      </td>
                      <td className="px-8 py-6">
                        <span className="text-[10px] font-black text-slate-500 bg-slate-50 dark:bg-slate-800 border dark:border-slate-700 px-3 py-1.5 rounded-2xl uppercase tracking-tighter">
                          {item.storeName}
                        </span>
                      </td>
                      <td className="px-8 py-6 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button 
                            onClick={() => {
                              setSelectedItemForLoss(item);
                              setIsRecordingLoss(true);
                              setLossData({ ...lossData, type: isFixedAssetItem({ item_type: item.rawItemType }) ? 'Damage' : 'Spoilage' });
                            }}
                            className="p-2.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-2xl transition-all opacity-0 group-hover:opacity-100"
                            title="Record Loss/Damage"
                          >
                            <AlertTriangle size={18} />
                          </button>
                          <button 
                            onClick={() => addNotification('Opening actions for ' + item.id, 'info', 'Sub-Store')}
                            className="p-2.5 text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/10 rounded-2xl transition-all opacity-0 group-hover:opacity-100"
                          >
                            <MoreVertical size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-slate-900 dark:bg-black rounded-[2.5rem] p-7 text-white space-y-7 shadow-2xl relative overflow-hidden">
             <div className="absolute -top-10 -right-10 opacity-5 grayscale">
                <BarChart3 size={160} strokeWidth={1} />
             </div>
             <div className="space-y-1 relative z-10">
               <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400">Store Valuation</h4>
               <p className="text-3xl font-bold tabular-nums">{formatAmount(stats.totalValue)}</p>
             </div>
             <div className="grid grid-cols-2 gap-5 relative z-10">
               <div className="space-y-1">
                 <p className="text-[9px] font-black text-slate-500 uppercase tracking-[0.1em]">Stock Alerts</p>
                 <div className="flex items-center gap-2">
                    <p className="text-2xl font-bold text-rose-500">{stats.lowStock}</p>
                    <ArrowUpRight size={14} className="text-rose-500" />
                 </div>
               </div>
               <div className="space-y-1">
                 <p className="text-[9px] font-black text-slate-500 uppercase tracking-[0.1em]">Out of Stock</p>
                 <div className="flex items-center gap-2">
                    <p className="text-2xl font-bold text-slate-400">{stats.stockouts}</p>
                 </div>
               </div>
             </div>
             <button 
              onClick={() => setIsCreatingRequisition(true)}
              className="w-full py-4 bg-white/5 hover:bg-white/10 border border-white/5 transition-all rounded-[1.5rem] text-[10px] font-black uppercase tracking-[0.2em] flex items-center justify-center gap-3"
             >
                <Truck size={16} /> Order Requisition
             </button>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 rounded-[2.5rem] p-7 shadow-3xs space-y-5">
            <div className="flex justify-between items-center">
               <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Sub-Store Feed</h4>
               <span className="text-[9px] font-black text-emerald-500 uppercase flex items-center gap-1"><Zap size={10} /> Live</span>
            </div>
            <div className="space-y-5">
              {[
                { label: 'Beef Tenderloin Issue', time: '12m ago', vol: '-3.5kg', type: 'out' },
                { label: 'Wine Cellar Audit', time: '4h ago', vol: 'Verified', type: 'audit' },
                { label: 'Broken Glassware', time: 'Yesterday', vol: '-12pcs', type: 'wastage' },
              ].map((activity, idx) => (
                <div key={idx} className="flex items-center justify-between border-b dark:border-slate-800 border-slate-50 pb-5 last:border-0 last:pb-0">
                  <div className="space-y-0.5">
                    <p className="text-[11px] font-black text-slate-900 dark:text-slate-100 uppercase tracking-tight">{activity.label}</p>
                    <p className="text-[9px] text-slate-400 font-bold italic">{activity.time}</p>
                  </div>
                  <span className={`text-[10px] font-black tabular-nums tracking-tighter ${
                    activity.type === 'audit' ? 'text-indigo-500' : 
                    activity.type === 'wastage' ? 'text-rose-500 font-bold' : 'text-slate-400'
                  }`}>
                    {activity.vol}
                  </span>
                </div>
              ))}
            </div>
            <button 
              onClick={() => setShowAudit(!showAudit)}
              className="w-full pt-3 text-[10px] font-black text-indigo-600 hover:text-slate-900 hover:bg-slate-50 py-3 rounded-2xl transition-all uppercase tracking-widest border border-dashed border-slate-200"
            >
               {showAudit ? 'Hide Audit History' : 'View Loss & Audit Registries'}
            </button>
          </div>
        </div>
      </div>

      {/* Audit History & Loss Registry */}
      {showAudit && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-3xs overflow-hidden">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Stock Movement Audit</h3>
              <button 
                onClick={() => addNotification('Syncing Audit History Ledger...', 'success', 'Sub-Store')}
                className="p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl text-slate-400 transition-all"
              >
                <RefreshCw size={14} />
              </button>
            </div>
            <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
              {auditLogs.filter(log => log).slice(0, 50).map((log, idx) => {
                const messageStartIdx = log.indexOf(' - ') + 3;
                const timestamp = log.substring(0, messageStartIdx - 3);
                const message = log.substring(messageStartIdx);
                return (
                  <div key={idx} className="p-5 border-b border-slate-50 dark:border-slate-800 flex items-start gap-4 hover:bg-slate-50/50 dark:hover:bg-indigo-900/5 transition-all">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-2 shrink-0" />
                    <div className="flex-1">
                      <p className="text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed font-semibold">{message}</p>
                      <p className="text-[9px] text-slate-400 font-mono mt-1.5 uppercase font-black">{timestamp}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] border border-rose-100 dark:border-rose-900 shadow-3xs overflow-hidden">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-rose-50/20 dark:bg-rose-950/10 flex justify-between items-center">
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-rose-500">Damage & Spoilage Registry</h3>
              <Trash2 size={16} className="text-rose-400" />
            </div>
            <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
              {lossRegistry.length === 0 ? (
                <div className="p-16 text-center">
                   <p className="text-[10px] text-slate-400 font-mono uppercase tracking-widest">No loss events recorded.</p>
                </div>
              ) : (
                lossRegistry.map((record, idx) => (
                  <div key={idx} className="p-5 border-b border-slate-50 dark:border-slate-800 flex items-start gap-4 hover:bg-rose-50/30 transition-all border-l-4 border-l-transparent hover:border-l-rose-500">
                    <div className={`px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest ${
                      record.type === 'Spoilage' ? 'bg-amber-100 text-amber-600' : 'bg-rose-100 text-rose-600'
                    }`}>
                      {record.type}
                    </div>
                    <div className="flex-1">
                      <p className="text-[11px] font-black text-slate-850 dark:text-slate-100 uppercase">{record.item}</p>
                      <p className="text-[10px] text-slate-500 mt-1 italic font-medium">"{record.reason}"</p>
                      <div className="flex items-center gap-5 mt-2.5">
                        <p className="text-[9px] font-black text-rose-500 uppercase tracking-tighter">Impact: {record.qty} Units</p>
                        <p className="text-[9px] text-slate-400 font-mono uppercase tracking-widest">{new Date(record.timestamp).toLocaleString()}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
      </>
      )}

      {/* Record Loss Modal */}
      <ModalSystem
        isOpen={isRecordingLoss && !!selectedItemForLoss}
        onClose={() => setIsRecordingLoss(false)}
        title="Loss / Damage Registry"
        subtitle={`Adjusting stock for: ${selectedItemForLoss?.name ?? ''}`}
        variant="form"
        size="lg"
        showFooter={false}
      >
              <div className="space-y-6">
                <div>
                   <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3 block">Loss Classification</label>
                   <div className="grid grid-cols-2 gap-2">
                      {(selectedItemForLoss && isFixedAssetItem({ item_type: selectedItemForLoss.rawItemType }) ? ['Damage', 'Broken', 'Lost', 'Theft'] : ['Spoilage', 'Expired', 'Contamination', 'Discarded']).map(t => (
                        <button
                          key={t}
                          onClick={() => setLossData({...lossData, type: t as any})}
                          className={`py-3.5 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                            lossData.type === t 
                            ? 'bg-rose-500 text-white border-rose-500 shadow-lg shadow-rose-200' 
                            : 'bg-slate-50 dark:bg-slate-800 border-transparent text-slate-500 hover:border-slate-200'
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                   </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                   <div>
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Quantity Lost</label>
                      <div className="relative">
                        <input 
                          type="number"
                          value={lossData.qty || ''}
                          onChange={(e) => setLossData({...lossData, qty: parseInt(e.target.value) || 0})}
                          className="w-full bg-slate-50 dark:bg-slate-800 p-4 rounded-2xl border-2 border-transparent focus:border-rose-500 outline-none text-sm font-black transition-all"
                          placeholder="0"
                        />
                        <span className="absolute right-4 top-4 text-[10px] font-black text-slate-400 uppercase">{selectedItemForLoss?.unit}</span>
                      </div>
                      <p className="text-[9px] text-slate-400 mt-2 font-bold italic ml-2">Currently: {selectedItemForLoss?.currentStock} in stock</p>
                   </div>
                </div>

                <div>
                   <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Incident Narrative</label>
                   <textarea 
                    value={lossData.reason}
                    onChange={(e) => setLossData({...lossData, reason: e.target.value})}
                    placeholder="Describe how the spoilage or damage occurred..."
                    className="w-full bg-slate-50 dark:bg-slate-800 p-4 rounded-2xl border-2 border-transparent focus:border-rose-500 outline-none text-sm font-medium transition-all h-28 resize-none"
                   />
                </div>
              </div>

              <div className="pt-8 flex gap-4">
                 <button 
                  onClick={() => setIsRecordingLoss(false)}
                  className="flex-1 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-all"
                 >
                   Discard Adjustments
                 </button>
                 <button
                  onClick={handleRecordLoss}
                  disabled={lossSubmitting || !lossData.qty || !lossData.reason || (selectedItemForLoss && lossData.qty > selectedItemForLoss.currentStock)}
                  className="flex-1 py-4 bg-rose-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-xl shadow-rose-200 dark:shadow-none hover:bg-rose-700 transition-all disabled:opacity-30 disabled:grayscale"
                 >
                   {lossSubmitting ? 'Recording…' : 'Confirm Record'}
                 </button>
              </div>
      </ModalSystem>

      {/* Requisition Modal */}
      <ModalSystem
        isOpen={isCreatingRequisition}
        onClose={() => setIsCreatingRequisition(false)}
        title="Stock Requisition"
        subtitle="Pull inventory from the Main Lodge Warehouse."
        variant="form"
        size="lg"
        showFooter={false}
      >
              <div className="p-4 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 rounded-2xl flex gap-3 text-amber-800 dark:text-amber-400 text-xs font-medium">
                 <AlertTriangle size={16} className="shrink-0" />
                 <p>All pulls are logged and require Storekeeper approval at the Main Warehouse.</p>
              </div>

              <div className="space-y-4">
                <div>
                   <label className="text-[9px] font-black text-slate-400 uppercase mb-1.5 block">Select Item</label>
                   <select className="w-full bg-slate-50 dark:bg-slate-850 p-3 rounded-2xl border dark:border-slate-800 text-sm outline-none">
                      {filteredInventory.map(i => <option key={i.id} value={i.id}>{i.name} ({i.currentStock} {i.unit} in hand)</option>)}
                   </select>
                </div>
                <div>
                   <label className="text-[9px] font-black text-slate-400 uppercase mb-1.5 block">Requested Quantity</label>
                   <input type="number" placeholder="0.00" className="w-full bg-slate-50 dark:bg-slate-850 p-3 rounded-2xl border dark:border-slate-800 text-sm outline-none shadow-none" />
                </div>
                <div>
                   <label className="text-[9px] font-black text-slate-400 uppercase mb-1.5 block">Priority</label>
                   <div className="flex gap-2">
                      {['Standard', 'Urgent'].map(p => (
                        <button key={p} className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase border ${p === 'Standard' ? 'bg-slate-100 border-slate-200' : 'bg-white border-rose-200 text-rose-500'}`}>{p}</button>
                      ))}
                   </div>
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                <button 
                  onClick={() => setIsCreatingRequisition(false)}
                  className="flex-1 py-3.5 rounded-2xl text-[10px] font-black uppercase text-slate-500 hover:bg-slate-50 transition-all font-mono"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    setIsCreatingRequisition(false);
                    addNotification('Requisition #REQ-942 submitted successfully.', 'success', 'Inventory');
                  }}
                  className="flex-1 py-3.5 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase shadow-lg shadow-indigo-600/20 hover:bg-indigo-700 transition-all"
                >
                  Submit Pull Request
                </button>
              </div>
      </ModalSystem>

      {/* Add Item Modal */}
      <ModalSystem
        isOpen={isAddingItem}
        onClose={() => setIsAddingItem(false)}
        title="Add New Stock"
        subtitle="Register a new consumable or fixed asset."
        variant="form"
        size="lg"
        showFooter={false}
      >
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="text-[9px] font-black text-slate-400 uppercase mb-1.5 block">Item Name</label>
                  <input
                    type="text"
                    value={newItem.name}
                    onChange={(e) => setNewItem({...newItem, name: e.target.value})}
                    placeholder="e.g. Premium Beef Fillet"
                    className="w-full bg-slate-50 dark:bg-slate-850 p-3 rounded-2xl border dark:border-slate-800 text-sm outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase mb-1.5 block">Category</label>
                  <select 
                    value={newItem.category}
                    onChange={(e) => setNewItem({...newItem, category: e.target.value as any})}
                    className="w-full bg-slate-50 dark:bg-slate-850 p-3 rounded-2xl border dark:border-slate-800 text-sm outline-none"
                  >
                    <option value="Consumable">Consumable</option>
                    <option value="Fixed Asset">Fixed Asset</option>
                  </select>
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase mb-1.5 block">Stock Group</label>
                   <select 
                    value={newItem.stockCategory}
                    onChange={(e) => setNewItem({...newItem, stockCategory: e.target.value as any})}
                    className="w-full bg-slate-50 dark:bg-slate-850 p-3 rounded-2xl border dark:border-slate-800 text-sm outline-none"
                  >
                    {(globalHotelSettings.posCategories || []).map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase mb-1.5 block">Initial Qty</label>
                  <input
                    type="number"
                    value={newItem.quantity}
                    onChange={(e) => setNewItem({...newItem, quantity: Number(e.target.value)})}
                    className="w-full bg-slate-50 dark:bg-slate-850 p-3 rounded-2xl border dark:border-slate-800 text-sm"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase mb-1.5 block">Cost per Unit</label>
                  <input
                    type="number"
                    value={newItem.cost}
                    onChange={(e) => setNewItem({...newItem, cost: Number(e.target.value)})}
                    className="w-full bg-slate-50 dark:bg-slate-850 p-3 rounded-2xl border dark:border-slate-800 text-sm"
                  />
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                <button 
                  onClick={() => setIsAddingItem(false)}
                  className="flex-1 py-3.5 rounded-2xl text-[10px] font-black uppercase text-slate-500 hover:bg-slate-50 transition-all font-mono"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleAddItem}
                  className="flex-1 py-3.5 bg-slate-950 dark:bg-white dark:text-slate-950 text-white rounded-2xl text-[10px] font-black uppercase shadow-lg shadow-slate-900/10 transition-all"
                >
                  Confirm Entry
                </button>
              </div>
      </ModalSystem>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
         <div 
           className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 rounded-[2rem] p-7 flex items-center justify-between shadow-3xs hover:border-indigo-500 transition-all group overflow-hidden relative cursor-pointer"
           onClick={() => addNotification('Opening Stock Requisition form...', 'info', 'Sub-Store')}
          >
            <div className="flex items-center gap-5 relative z-10">
               <div className="p-4 bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 rounded-2xl shadow-sm border border-indigo-100/50 group-hover:scale-110 transition-transform">
                  <ArrowDownToLine size={28} />
               </div>
               <div>
                  <h4 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">Supply Chain Pull</h4>
                  <p className="text-xs text-slate-400 font-bold italic mt-0.5">Request stock from Main Warehouse</p>
               </div>
            </div>
            <button className="px-8 py-3 bg-slate-950 dark:bg-white dark:text-slate-950 text-white rounded-2xl text-[10px] font-black shadow-lg shadow-slate-950/10 flex items-center gap-3 hover:translate-x-1 transition-all uppercase tracking-widest relative z-10">
               New Request <ArrowUpRight size={16} />
            </button>
            <div className="absolute -right-6 -bottom-6 opacity-5 group-hover:scale-125 transition-transform"><Package size={120} /></div>
         </div>

         <div 
           className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 rounded-[2rem] p-7 flex items-center justify-between shadow-3xs hover:border-amber-500 transition-all group overflow-hidden relative cursor-pointer"
           onClick={() => setShowAudit(!showAudit)}
         >
            <div className="flex items-center gap-5 relative z-10">
               <div className="p-4 bg-amber-50 dark:bg-amber-950/20 text-amber-600 rounded-2xl shadow-sm border border-amber-100/50 group-hover:scale-110 transition-transform">
                  <ClipboardCheck size={28} />
               </div>
               <div>
                  <h4 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">Sub-Store Audit Control</h4>
                  <p className="text-xs text-slate-400 font-bold italic mt-0.5">View spoilage records and audit trails</p>
               </div>
            </div>
            <button 
              className={`px-8 py-3 rounded-2xl text-[10px] font-black shadow-lg flex items-center gap-3 hover:translate-x-1 transition-all uppercase tracking-widest relative z-10 ${
                showAudit ? 'bg-indigo-600 text-white shadow-indigo-600/20' : 'bg-amber-500 text-white shadow-amber-500/10'
              }`}
            >
               {showAudit ? 'Close Logs' : 'Open Logs'} <Zap size={16} />
            </button>
            <div className="absolute -right-6 -bottom-6 opacity-5 group-hover:scale-125 transition-transform"><ShieldCheck size={120} /></div>
         </div>
      </div>

      {/* Store Manager Modal */}
      <ModalSystem
        isOpen={showStoreManager}
        onClose={() => { setShowStoreManager(false); setIsAddingStore(false); setEditingStoreId(null); setNewStore({ name: '', type: 'Departmental', manager: '' }); }}
        title="F&B Store Management"
        subtitle="Consolidated store governance — add, edit, and manage all F&B stores."
        variant="form"
        size="xl"
        showFooter={false}
      >
        <div className="space-y-6">
          {/* Add/Edit Store Form */}
          {isAddingStore ? (
            <div className="bg-slate-50 dark:bg-slate-850 rounded-2xl p-6 space-y-4 border-2 border-indigo-200 dark:border-indigo-900">
              <div className="flex items-center justify-between">
                <h4 className="text-[11px] font-black uppercase tracking-widest text-indigo-600">
                  {editingStoreId ? 'Edit Store' : 'Register New Store'}
                </h4>
                <button
                  onClick={() => { setIsAddingStore(false); setEditingStoreId(null); setNewStore({ name: '', type: 'Departmental', manager: '' }); }}
                  className="p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Store Name</label>
                  <input
                    type="text"
                    value={newStore.name}
                    onChange={(e) => setNewStore({ ...newStore, name: e.target.value })}
                    placeholder="e.g. Bar Store, Restaurant Store, Kitchen Pantry"
                    className="w-full bg-white dark:bg-slate-800 p-3 rounded-2xl border dark:border-slate-700 text-sm outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Store Type</label>
                  <select
                    value={newStore.type}
                    onChange={(e) => setNewStore({ ...newStore, type: e.target.value as 'Main' | 'Departmental' | 'Virtual' })}
                    className="w-full bg-white dark:bg-slate-800 p-3 rounded-2xl border dark:border-slate-700 text-sm outline-none"
                  >
                    <option value="Main">Main</option>
                    <option value="Departmental">Departmental</option>
                    <option value="Virtual">Virtual</option>
                  </select>
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Manager</label>
                  <input
                    type="text"
                    value={newStore.manager}
                    onChange={(e) => setNewStore({ ...newStore, manager: e.target.value })}
                    placeholder="Store manager name"
                    className="w-full bg-white dark:bg-slate-800 p-3 rounded-2xl border dark:border-slate-700 text-sm outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => { setIsAddingStore(false); setEditingStoreId(null); setNewStore({ name: '', type: 'Departmental', manager: '' }); }}
                  className="flex-1 py-3.5 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={editingStoreId ? handleUpdateStore : handleAddStore}
                  disabled={storeSubmitting}
                  className="flex-1 py-3.5 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-lg shadow-indigo-600/20 hover:bg-indigo-700 transition-all disabled:opacity-50"
                >
                  {storeSubmitting ? 'Saving…' : editingStoreId ? 'Update Store' : 'Create Store'}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setIsAddingStore(true)}
              className="w-full py-4 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-400 hover:border-indigo-500 hover:text-indigo-600 transition-all flex items-center justify-center gap-2"
            >
              <Plus size={16} /> Add New Store
            </button>
          )}

          {/* Store Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {fbStores.length === 0 ? (
              <div className="col-span-2 py-12 text-center">
                <Building2 size={48} className="mx-auto text-slate-300 dark:text-slate-700 mb-3" />
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">No stores configured yet.</p>
                <p className="text-[9px] text-slate-400 mt-1">Click "Add New Store" to create your first F&B store.</p>
              </div>
            ) : (
              fbStores.map(store => {
                const itemCount = getStoreItemCount(store.name);
                const storeValue = getStoreValue(store.name);
                const isActive = selectedStore === store.name;
                return (
                  <div
                    key={store.id}
                    className={`bg-white dark:bg-slate-900 border-2 rounded-2xl p-5 transition-all cursor-pointer group ${
                      isActive ? 'border-indigo-500 shadow-lg shadow-indigo-100 dark:shadow-indigo-900/20' : 'border-slate-150 dark:border-slate-800 hover:border-indigo-300'
                    }`}
                    onClick={() => { setSelectedStore(store.name); setShowStoreManager(false); }}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className={`p-3 rounded-2xl ${
                          store.type === 'Main' ? 'bg-amber-100 text-amber-600' :
                          store.type === 'Virtual' ? 'bg-purple-100 text-purple-600' :
                          'bg-indigo-100 text-indigo-600'
                        }`}>
                          <StoreIcon size={20} />
                        </div>
                        <div>
                          <p className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">{store.name}</p>
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-0.5">{store.type}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); startEditStore(store); }}
                          className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-xl transition-all"
                          title="Edit Store"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteStore(store.id, store.name); }}
                          className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-xl transition-all"
                          title="Delete Store"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest">
                      <div className="space-y-0.5">
                        <p className="text-slate-400">Manager</p>
                        <p className="text-slate-700 dark:text-slate-300 normal-case tracking-tight">{store.manager || '—'}</p>
                      </div>
                      <div className="space-y-0.5 text-right">
                        <p className="text-slate-400">Items</p>
                        <p className="text-slate-700 dark:text-slate-300 tabular-nums">{itemCount}</p>
                      </div>
                      <div className="space-y-0.5 text-right">
                        <p className="text-slate-400">Value</p>
                        <p className="text-slate-700 dark:text-slate-300 tabular-nums">{formatAmount(storeValue)}</p>
                      </div>
                    </div>
                    {isActive && (
                      <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                        <p className="text-[9px] font-black text-indigo-600 uppercase tracking-widest flex items-center gap-1">
                          <CheckCircle2 size={10} /> Currently Selected
                        </p>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </ModalSystem>
    </div>
  );
}
