/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import { useState, useEffect } from 'react';
import {
  Package,
  Search,
  Filter,
  Plus,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Calculator,
  DollarSign,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Download,
  Truck,
  ArrowDownToLine,
  ClipboardCheck,
  Edit,
  Trash2,
  X
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { PageHeader, Card, SectionCard, Badge } from '../../components/FrontOffice/ui';
import { button as buttonStyles } from '../../components/FrontOffice/brandTheme';
import { layout } from '../../components/FrontOffice/brandTheme';
import StatCard from '../../components/FrontOffice/StatCard';
import {
  fetchStockByDepartment,
  fetchLedger,
  fetchItems,
  createItem,
  updateItem,
  deleteItem,
  createAdjustment,
  type UinvStockBalance,
} from '../../services/inventoryService';

interface InventoryCategory {
  id: string;
  name: string;
  code: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
}

interface InventoryItem {
  id: string;
  category_id: string;
  outlet_id: string | null;
  item_code: string | null;
  sku: string | null;
  name: string;
  description: string | null;
  unit_of_measure: string;
  current_quantity: number;
  minimum_stock: number;
  maximum_stock: number | null;
  reorder_point: number;
  unit_cost: number;
  average_cost: number | null;
  total_value: number;
  location: string | null;
  supplier: string | null;
  last_purchase_date: string | null;
  expiry_date: string | null;
  batch_number: string | null;
  is_active: boolean;
  category?: InventoryCategory;
  outlet?: any;
}

interface InventoryTransaction {
  id: string;
  item_id: string;
  transaction_type: string;
  quantity: number;
  unit_cost: number | null;
  total_cost: number | null;
  reference_number: string | null;
  from_outlet_id: string | null;
  to_outlet_id: string | null;
  reason: string | null;
  performed_by: string;
  transaction_date: string;
  item?: InventoryItem;
  from_outlet?: any;
  to_outlet?: any;
}

export default function InventoryCostControl() {
  const { formatAmount, addNotification, currentPropertyId } = useERP();
  const [activeTab, setActiveTab] = useState<'inventory' | 'transactions' | 'cost-control'>('inventory');
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<'item' | 'transaction'>('item');
  const [editingItem, setEditingItem] = useState<InventoryItem | InventoryTransaction | null>(null);
  
  // Data state
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [costControl, setCostControl] = useState<any>(null);
  
  // Form state
  const [formData, setFormData] = useState<any>({});

  const tabs = [
    { id: 'inventory', label: 'Inventory', icon: Package },
    { id: 'transactions', label: 'Transactions', icon: Truck },
    { id: 'cost-control', label: 'Cost Control', icon: Calculator },
  ];

  // Fetch functions — unified uinv_* system (single source of truth)
  const fetchCategories = async () => {
    try {
      // Derive categories from unified items
      const stockBalances = await fetchStockByDepartment('Food & Beverage', currentPropertyId).catch(() => [] as UinvStockBalance[]);
      const catSet = new Set<string>();
      const cats: InventoryCategory[] = [];
      for (const b of stockBalances) {
        const cat = b.item?.category;
        if (cat && !catSet.has(cat)) {
          catSet.add(cat);
          cats.push({ id: cat, name: cat, code: cat, description: null, sort_order: 0, is_active: true });
        }
      }
      setCategories(cats);
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  };

  const fetchItems = async () => {
    try {
      // Fetch stock balances for F&B department and map to component shape
      const stockBalances = await fetchStockByDepartment('Food & Beverage', currentPropertyId);
      const mapped: InventoryItem[] = stockBalances.map((b: UinvStockBalance) => ({
        id: b.item_id,
        category_id: b.item?.category || '',
        outlet_id: b.store_id || null,
        item_code: b.item?.item_code || null,
        sku: b.item?.sku || null,
        name: b.item?.item_name || 'Unknown',
        description: b.item?.description || null,
        unit_of_measure: b.item?.unit_of_measure || 'PCS',
        current_quantity: Number(b.on_hand || 0),
        minimum_stock: Number(b.item?.min_stock || 0),
        maximum_stock: b.item?.max_stock ? Number(b.item?.max_stock) : null,
        reorder_point: Number(b.item?.reorder_point || 0),
        unit_cost: Number(b.unit_cost || 0),
        average_cost: b.item?.avg_cost ? Number(b.item?.avg_cost) : null,
        total_value: Number(b.on_hand || 0) * Number(b.unit_cost || 0),
        location: b.store?.store_name || b.location?.location_name || null,
        supplier: b.item?.brand || null,
        last_purchase_date: null,
        expiry_date: null,
        batch_number: null,
        is_active: b.item?.is_active ?? true,
        category: b.item ? { id: b.item.category, name: b.item.category, code: b.item.category, description: null, sort_order: 0, is_active: true } : undefined,
        outlet: b.store || undefined,
      }));
      setItems(mapped);
    } catch (error) {
      console.error('Error fetching items:', error);
    }
  };

  const fetchTransactions = async () => {
    try {
      const ledger = await fetchLedger({ propertyId: currentPropertyId });
      const mapped: InventoryTransaction[] = (ledger as any[]).map((l: any) => ({
        id: l.id,
        item_id: l.item_id,
        transaction_type: l.transaction_type || 'adjustment',
        quantity: Number(l.quantity_in || 0) - Number(l.quantity_out || 0),
        unit_cost: Number(l.unit_cost || 0),
        total_cost: Number(l.value || 0),
        reference_number: l.reference || null,
        from_outlet_id: l.store_id || null,
        to_outlet_id: null,
        reason: l.reason || null,
        performed_by: l.performed_by || 'System',
        transaction_date: l.transaction_date || '',
        item: l.item ? { id: l.item_id, name: l.item.item_name, unit_of_measure: l.item.unit_of_measure } as any : undefined,
        from_outlet: l.store ? { name: l.store.store_name } as any : undefined,
        to_outlet: undefined,
      }));
      setTransactions(mapped);
    } catch (error) {
      console.error('Error fetching transactions:', error);
    }
  };

  const fetchAnalytics = async () => {
    try {
      // Derive analytics from unified stock balances
      const stockBalances = await fetchStockByDepartment('Food & Beverage', currentPropertyId).catch(() => [] as UinvStockBalance[]);
      const totalValue = stockBalances.reduce((s, b) => s + Number(b.on_hand || 0) * Number(b.unit_cost || 0), 0);
      const totalItems = stockBalances.length;
      const lowStock = stockBalances.filter(b => b.item && Number(b.on_hand) <= Number(b.item.reorder_point)).length;
      setAnalytics({ total_value: totalValue, total_items: totalItems, low_stock_items: lowStock });
    } catch (error) {
      console.error('Error fetching analytics:', error);
    }
  };

  const fetchCostControl = async () => {
    try {
      // Derive cost control from unified stock balances
      const stockBalances = await fetchStockByDepartment('Food & Beverage', currentPropertyId).catch(() => [] as UinvStockBalance[]);
      const byCategory: Record<string, { value: number; count: number }> = {};
      for (const b of stockBalances) {
        const cat = b.item?.category || 'Uncategorized';
        if (!byCategory[cat]) byCategory[cat] = { value: 0, count: 0 };
        byCategory[cat].value += Number(b.on_hand || 0) * Number(b.unit_cost || 0);
        byCategory[cat].count++;
      }
      setCostControl({ by_category: byCategory });
    } catch (error) {
      console.error('Error fetching cost control:', error);
    }
  };

  useEffect(() => {
    fetchCategories();
    fetchItems();
    fetchTransactions();
    fetchAnalytics();
    fetchCostControl();
  }, []);

  // Handlers
  const handleCreateItem = () => {
    setEditingItem(null);
    setModalType('item');
    setFormData({
      category_id: categories[0]?.id || '',
      name: '',
      item_code: '',
      sku: '',
      description: '',
      unit_of_measure: 'PCS',
      current_quantity: 0,
      minimum_stock: 0,
      maximum_stock: null,
      reorder_point: 0,
      unit_cost: 0,
      location: '',
      supplier: '',
      expiry_date: '',
      batch_number: '',
      is_active: true
    });
    setShowModal(true);
  };

  const handleEditItem = (item: InventoryItem) => {
    setEditingItem(item);
    setModalType('item');
    setFormData({
      category_id: item.category_id,
      name: item.name,
      item_code: item.item_code || '',
      sku: item.sku || '',
      description: item.description || '',
      unit_of_measure: item.unit_of_measure,
      current_quantity: item.current_quantity,
      minimum_stock: item.minimum_stock,
      maximum_stock: item.maximum_stock,
      reorder_point: item.reorder_point,
      unit_cost: item.unit_cost,
      location: item.location || '',
      supplier: item.supplier || '',
      expiry_date: item.expiry_date || '',
      batch_number: item.batch_number || '',
      is_active: item.is_active
    });
    setShowModal(true);
  };

  const handleSaveItem = async () => {
    try {
      const itemData: any = {
        property_id: currentPropertyId || null,
        item_code: formData.item_code || undefined,
        item_name: formData.name,
        description: formData.description || null,
        category: formData.category_id || 'Food & Beverage',
        unit_of_measure: formData.unit_of_measure || 'PCS',
        min_stock: Number(formData.minimum_stock || 0),
        max_stock: formData.maximum_stock ? Number(formData.maximum_stock) : null,
        reorder_point: Number(formData.reorder_point || 0),
        safety_stock: 0,
        par_level: Number(formData.reorder_point || 0) * 2,
        last_cost: Number(formData.unit_cost || 0),
        avg_cost: Number(formData.unit_cost || 0),
        standard_cost: Number(formData.unit_cost || 0),
        is_active: formData.is_active ?? true,
        brand: formData.supplier || null,
      };
      if (editingItem) {
        await updateItem((editingItem as InventoryItem).id, itemData);
        addNotification('Item updated successfully', 'success', 'Inventory');
      } else {
        await createItem(itemData);
        addNotification('Item created successfully', 'success', 'Inventory');
      }
      setShowModal(false);
      fetchItems();
      fetchAnalytics();
    } catch (error) {
      console.error('Error saving item:', error);
      addNotification('Failed to save item', 'warning', 'Inventory');
    }
  };

  const handleDeleteItem = async (id: string) => {
    if (!confirm('Are you sure you want to delete this item?')) return;
    try {
      await deleteItem(id);
      addNotification('Item deleted successfully', 'success', 'Inventory');
      fetchItems();
      fetchAnalytics();
    } catch (error) {
      console.error('Error deleting item:', error);
      addNotification('Failed to delete item', 'warning', 'Inventory');
    }
  };

  const handleCreateTransaction = () => {
    setEditingItem(null);
    setModalType('transaction');
    setFormData({
      item_id: items[0]?.id || '',
      transaction_type: 'goods_receipt',
      quantity: 0,
      unit_cost: 0,
      reference_number: '',
      reason: ''
    });
    setShowModal(true);
  };

  const handleSaveTransaction = async () => {
    try {
      const item = items.find(i => i.id === formData.item_id);
      const unitCost = Number(formData.unit_cost || item?.unit_cost || 0);
      const qty = Number(formData.quantity || 0);
      const isReceipt = formData.transaction_type === 'goods_receipt' || formData.transaction_type === 'returns';
      await createAdjustment({
        property_id: currentPropertyId || null,
        item_id: formData.item_id,
        store_id: item?.outlet_id || null,
        adjustment_type: isReceipt ? 'Receipt' : 'Adjustment',
        reason: formData.reason || formData.transaction_type,
        quantity_delta: isReceipt ? qty : -qty,
        unit_cost: unitCost,
        value_delta: (isReceipt ? qty : -qty) * unitCost,
        status: 'Approved',
        reference: formData.reference_number || formData.transaction_type,
      });
      addNotification('Transaction recorded successfully', 'success', 'Inventory');
      setShowModal(false);
      fetchTransactions();
      fetchItems();
    } catch (error) {
      console.error('Error saving transaction:', error);
      addNotification('Failed to save transaction', 'warning', 'Inventory');
    }
  };

  const getModalSaveHandler = () => {
    return modalType === 'item' ? handleSaveItem : handleSaveTransaction;
  };

  const categoryCounts = categories.reduce((acc, cat) => {
    acc[cat.name] = items.filter(item => item.category_id === cat.id).length;
    return acc;
  }, {} as Record<string, number>);

  const lowStockCount = items.filter(item => item.current_quantity <= item.reorder_point).length;
  const stockoutCount = items.filter(item => item.current_quantity === 0).length;

  return (
    <div className={layout.sectionStack}>
      {/* Header */}
      <PageHeader
        title="Inventory & Cost Control"
        subtitle="Inventory management and cost control analytics"
        icon={Package}
        actions={
          <>
            <buttonStyles onClick={() => { fetchCategories(); fetchItems(); fetchTransactions(); fetchAnalytics(); }} className={buttonStyles.secondary}>
              <RefreshCw className="w-4 h-4" />
              Refresh
            </buttonStyles>
            <buttonStyles onClick={activeTab === 'inventory' ? handleCreateItem : handleCreateTransaction} className={buttonStyles.primary}>
              <Plus className="w-4 h-4" />
              {activeTab === 'inventory' ? 'Add Item' : 'Add Transaction'}
            </buttonStyles>
          </>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Value"
          value={formatAmount(analytics?.totalValue || 0)}
          icon={DollarSign}
          color="indigo"
        />
        <StatCard
          title="Food Cost %"
          value={`${costControl?.foodCostPercent || 0}%`}
          icon={Calculator}
          color="green"
        />
        <StatCard
          title="Low Stock Items"
          value={lowStockCount.toString()}
          icon={AlertTriangle}
          color="amber"
        />
        <StatCard
          title="Stockouts"
          value={stockoutCount.toString()}
          icon={ArrowDownToLine}
          color="red"
        />
      </div>

      {/* Tabs */}
      <SectionCard>
        <div className="flex bg-gray-100 dark:bg-slate-700 p-1 rounded-xl">
          {tabs.map((tab) => (
            <buttonStyles
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
                activeTab === tab.id
                  ? 'bg-white dark:bg-slate-600 text-indigo-600 dark:text-indigo-400 shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              <span className="text-sm font-medium">{tab.label}</span>
            </buttonStyles>
          ))}
        </div>

        {/* Inventory Tab */}
        {activeTab === 'inventory' && (
          <div className="space-y-4 mt-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {categories.map((cat) => (
                <div key={cat.id} className="bg-gray-50 dark:bg-slate-700 rounded-lg p-4 border border-gray-200 dark:border-slate-600">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">{cat.name}</h3>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">{categoryCounts[cat.name] || 0}</p>
                </div>
              ))}
            </div>
            <div className="border-t border-gray-200 dark:border-slate-700 pt-4">
              <div className="flex items-center gap-2 mb-4">
                <Search className="w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search items..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                />
              </div>
              <div className="space-y-2">
                {items.filter(item => 
                  item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                  item.item_code?.toLowerCase().includes(searchTerm.toLowerCase())
                ).map((item) => (
                  <div key={item.id} className="flex items-center justify-between bg-white dark:bg-slate-800 rounded-lg px-4 py-3 border border-gray-200 dark:border-slate-700">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-indigo-100 dark:bg-indigo-900 rounded-lg flex items-center justify-center">
                        <Package className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{item.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{item.item_code} • {item.unit_of_measure}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{item.current_quantity} {item.unit_of_measure}</p>
                        <p className="text-xs text-gray-500">{formatAmount(item.total_value)}</p>
                      </div>
                      {item.current_quantity <= item.reorder_point && (
                        <Badge tone="warning">Low Stock</Badge>
                      )}
                      {item.current_quantity === 0 && (
                        <Badge tone="danger">Out of Stock</Badge>
                      )}
                      <buttonStyles onClick={() => handleEditItem(item)} className={buttonStyles.ghost}>
                        <Edit className="w-4 h-4" />
                      </buttonStyles>
                      <buttonStyles onClick={() => handleDeleteItem(item.id)} className={buttonStyles.ghost}>
                        <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />
                      </buttonStyles>
                    </div>
                  </div>
                ))}
                {items.length === 0 && (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    <Package className="w-10 h-10 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No inventory items found</p>
                    <p className="text-xs mt-1">Click "Add Item" to create your first item</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Transactions Tab */}
        {activeTab === 'transactions' && (
          <div className="space-y-4 mt-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 border border-green-200 dark:border-green-800">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Goods Receipt</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">Inbound deliveries</p>
              </div>
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Internal Transfer</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">Between stores</p>
              </div>
              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4 border border-amber-200 dark:border-amber-800">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Production</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">Consumption & output</p>
              </div>
              <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4 border border-purple-200 dark:border-purple-800">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Stock Count</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">Cycle counts</p>
              </div>
              <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 border border-red-200 dark:border-red-800">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Waste</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">Spoilage & expiry</p>
              </div>
            </div>
            <div className="border-t border-gray-200 dark:border-slate-700 pt-4">
              <div className="space-y-2">
                {transactions.slice(0, 50).map((txn) => (
                  <div key={txn.id} className="flex items-center justify-between bg-white dark:bg-slate-800 rounded-lg px-4 py-3 border border-gray-200 dark:border-slate-700">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
                        <Truck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{txn.item?.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{txn.transaction_type} • {new Date(txn.transaction_date).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <p className={`text-sm font-medium ${txn.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {txn.quantity > 0 ? '+' : ''}{txn.quantity} {txn.item?.unit_of_measure}
                      </p>
                      {txn.total_cost && (
                        <p className="text-sm text-gray-900 dark:text-white">{formatAmount(txn.total_cost)}</p>
                      )}
                    </div>
                  </div>
                ))}
                {transactions.length === 0 && (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    <Truck className="w-10 h-10 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No transactions found</p>
                    <p className="text-xs mt-1">Click "Add Transaction" to record inventory movements</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Cost Control Tab */}
        {activeTab === 'cost-control' && (
          <div className="space-y-4 mt-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-4 border border-indigo-200 dark:border-indigo-800">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Standard Recipe Cost</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">Theoretical cost per recipe</p>
              </div>
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Actual Recipe Cost</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">Real cost from consumption</p>
              </div>
              <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 border border-green-200 dark:border-green-800">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Food Cost %</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">{costControl?.foodCostPercent || 0}% current</p>
              </div>
              <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4 border border-purple-200 dark:border-purple-800">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Beverage Cost %</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">{costControl?.beverageCostPercent || 0}% current</p>
              </div>
              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4 border border-amber-200 dark:border-amber-800">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Contribution Margin</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">Per item analysis</p>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-4 border border-emerald-200 dark:border-emerald-800">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Gross Margin</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">{costControl?.grossMargin || 0}%</p>
              </div>
              <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 border border-red-200 dark:border-red-800">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Purchase Price Variance</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">{costControl?.purchasePriceVariance || 0}%</p>
              </div>
              <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-4 border border-orange-200 dark:border-orange-800">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Production Variance</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">{costControl?.productionVariance || 0}%</p>
              </div>
              <div className="bg-pink-50 dark:bg-pink-900/20 rounded-lg p-4 border border-pink-200 dark:border-pink-800">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Consumption Variance</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">{costControl?.consumptionVariance || 0}%</p>
              </div>
              <div className="bg-cyan-50 dark:bg-cyan-900/20 rounded-lg p-4 border border-cyan-200 dark:border-cyan-800">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Daily Profitability</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">Daily P&L tracking</p>
              </div>
            </div>
          </div>
        )}
      </SectionCard>

      {/* Daily Profitability Panel */}
      {costControl?.dailyProfitability && (
        <SectionCard>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
            <BarChart3 className="w-5 h-5 text-green-600 dark:text-green-400" />
            Daily Profitability Summary
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-gray-200 dark:border-slate-700">
              <div className="flex items-center gap-3 mb-2">
                <DollarSign className="w-5 h-5 text-green-600 dark:text-green-400" />
                <span className="text-sm font-medium text-gray-900 dark:text-white">Revenue</span>
              </div>
              <p className="text-lg font-bold text-gray-900 dark:text-white">{formatAmount(costControl.dailyProfitability.revenue)}</p>
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-gray-200 dark:border-slate-700">
              <div className="flex items-center gap-3 mb-2">
                <Calculator className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                <span className="text-sm font-medium text-gray-900 dark:text-white">COGS</span>
              </div>
              <p className="text-lg font-bold text-gray-900 dark:text-white">{formatAmount(costControl.dailyProfitability.cogs)}</p>
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-gray-200 dark:border-slate-700">
              <div className="flex items-center gap-3 mb-2">
                <TrendingUp className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                <span className="text-sm font-medium text-gray-900 dark:text-white">Gross Margin</span>
              </div>
              <p className="text-lg font-bold text-gray-900 dark:text-white">{costControl.dailyProfitability.grossMargin}%</p>
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-gray-200 dark:border-slate-700">
              <div className="flex items-center gap-3 mb-2">
                <CheckCircle2 className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                <span className="text-sm font-medium text-gray-900 dark:text-white">Net Profit</span>
              </div>
              <p className="text-lg font-bold text-gray-900 dark:text-white">{formatAmount(costControl.dailyProfitability.netProfit)}</p>
            </div>
          </div>
        </SectionCard>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-lg">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
              {editingItem ? (modalType === 'item' ? 'Edit Item' : 'Edit Transaction') : (modalType === 'item' ? 'Add Item' : 'Add Transaction')}
            </h2>
            
            {modalType === 'item' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Category</label>
                  <select
                    value={formData.category_id || ''}
                    onChange={(e) => setFormData({ ...formData, category_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                  >
                    <option value="">Select a category...</option>
                    {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                    {categories.length === 0 && <option value="" disabled>No categories available</option>}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Item Name</label>
                  <input
                    type="text"
                    value={formData.name || ''}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Item Code</label>
                    <input
                      type="text"
                      value={formData.item_code || ''}
                      onChange={(e) => setFormData({ ...formData, item_code: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">SKU</label>
                    <input
                      type="text"
                      value={formData.sku || ''}
                      onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Unit of Measure</label>
                    <input
                      type="text"
                      value={formData.unit_of_measure || 'PCS'}
                      onChange={(e) => setFormData({ ...formData, unit_of_measure: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Unit Cost</label>
                    <input
                      type="number"
                      value={formData.unit_cost || 0}
                      onChange={(e) => setFormData({ ...formData, unit_cost: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Current Qty</label>
                    <input
                      type="number"
                      value={formData.current_quantity || 0}
                      onChange={(e) => setFormData({ ...formData, current_quantity: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Min Stock</label>
                    <input
                      type="number"
                      value={formData.minimum_stock || 0}
                      onChange={(e) => setFormData({ ...formData, minimum_stock: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reorder Point</label>
                    <input
                      type="number"
                      value={formData.reorder_point || 0}
                      onChange={(e) => setFormData({ ...formData, reorder_point: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                </div>
              </div>
            )}

            {modalType === 'transaction' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Item</label>
                  <select
                    value={formData.item_id || ''}
                    onChange={(e) => setFormData({ ...formData, item_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                  >
                    {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Transaction Type</label>
                  <select
                    value={formData.transaction_type || 'goods_receipt'}
                    onChange={(e) => setFormData({ ...formData, transaction_type: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                  >
                    <option value="goods_receipt">Goods Receipt</option>
                    <option value="internal_transfer">Internal Transfer</option>
                    <option value="production_consumption">Production Consumption</option>
                    <option value="production_output">Production Output</option>
                    <option value="stock_adjustment">Stock Adjustment</option>
                    <option value="stock_count">Stock Count</option>
                    <option value="cycle_count">Cycle Count</option>
                    <option value="return">Return</option>
                    <option value="waste">Waste</option>
                    <option value="expiry">Expiry</option>
                    <option value="spoilage">Spoilage</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Quantity</label>
                    <input
                      type="number"
                      value={formData.quantity || 0}
                      onChange={(e) => setFormData({ ...formData, quantity: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Unit Cost</label>
                    <input
                      type="number"
                      value={formData.unit_cost || 0}
                      onChange={(e) => setFormData({ ...formData, unit_cost: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reference Number</label>
                  <input
                    type="text"
                    value={formData.reference_number || ''}
                    onChange={(e) => setFormData({ ...formData, reference_number: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    placeholder="PO number, transfer ID, etc."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reason</label>
                  <input
                    type="text"
                    value={formData.reason || ''}
                    onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    placeholder="Reason for transaction"
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 mt-6">
              <buttonStyles onClick={() => setShowModal(false)} className={buttonStyles.secondary}>
                Cancel
              </buttonStyles>
              <buttonStyles onClick={getModalSaveHandler()} className={buttonStyles.primary}>
                Save
              </buttonStyles>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
