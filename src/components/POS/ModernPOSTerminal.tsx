/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Search,
  Plus,
  Minus,
  X,
  Receipt,
  CreditCard,
  ShoppingCart,
  User,
  Grid3x3,
  List,
  LayoutGrid,
  Table,
  Users,
  Settings,
  MoreVertical,
  Printer,
  RotateCcw,
  Percent,
  Star,
  Flame,
  Coffee,
  Utensils,
  Wine,
  Package,
  Sparkles,
  ChevronDown,
  Scan,
  Trash2,
  Edit,
  Send
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useERP } from '../../context/ERPContext';
import PaymentSystem, { PaymentSplit } from '../Shared/PaymentSystem';
import UnifiedInvoiceTemplate from '../Shared/UnifiedInvoiceTemplate';
import { ManagerPinModal } from '../Shared/ManagerPinModal';

interface ModernPOSTerminalProps {
  outlet: {
    id: string;
    name: string;
    outlet_type: 'restaurant' | 'bar' | 'gift_shop' | 'spa' | 'reception' | 'cafe' | 'pool_bar' | 'room_service' | 'other';
    code: string;
    user_role?: string;
  };
  user?: {
    id: string;
    name?: string;
    email?: string;
    erpUser?: any;
  };
  onOpenSettings?: () => void;
}

interface InHouseRoom {
  reservationId: string;
  roomNumber: string;
  guestName: string;
}

interface MenuCategory {
  id: string;
  name: string;
  display_order: number;
  icon?: string;
  is_active: boolean;
}

interface MenuItem {
  id: string;
  outlet_id: string;
  category_id?: string | null;
  name: string;
  description?: string;
  sku?: string;
  barcode?: string;
  selling_price: number;
  cost_price?: number;
  is_active: boolean;
  is_available: boolean;
  image_url?: string;
  preparation_time?: number;
  is_taxable: boolean;
  tax_rate?: number;
  is_service_charge_applicable: boolean;
}

interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  categoryId?: string;
  image?: string;
  isPopular?: boolean;
  isFeatured?: boolean;
  isAvailable: boolean;
  description?: string;
  taxable: boolean;
  serviceChargeApplicable: boolean;
  preparationTime?: number;
}

interface CartItem {
  product: Product;
  quantity: number;
  notes?: string;
}

interface DbTable {
  id: string;
  table_number: string;
  seats: number;
  section: string;
  outlet_id: string;
  status: string;
  current_order_id?: string;
  is_active: boolean;
}

interface Table {
  id: string;
  number: string;
  seats: number;
  status: 'available' | 'occupied' | 'reserved' | 'dirty';
  currentOrder?: {
    id: string;
    total: number;
    time: string;
    items: number;
  };
}

export default function ModernPOSTerminal({ outlet, user, onOpenSettings }: ModernPOSTerminalProps) {
  const { formatAmount, formatTaxesAndFees, addNotification, userProfile } = useERP();
  const cashierId = user?.id || userProfile?.id || '';
  const cashierName = user?.name || userProfile?.name || 'POS User';
  
  // Data State
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [dbTables, setDbTables] = useState<DbTable[]>([]);
  const [inHouseRooms, setInHouseRooms] = useState<InHouseRoom[]>([]);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [activeKdsOrders, setActiveKdsOrders] = useState<any[]>([]);
  const [openShift, setOpenShift] = useState<any | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  
  // UI State
  const [viewMode, setViewMode] = useState<'products' | 'tables' | 'orders'>('products');
  const [gridView, setGridView] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  
  // Cart State
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [discountPercent, setDiscountPercent] = useState(0);
  const [discountReason, setDiscountReason] = useState('');
  
  // Order Management
  const [orderNotes, setOrderNotes] = useState('');
  
  // Payment
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [invoicePrintData, setInvoicePrintData] = useState<any | null>(null);
  const [lastInvoice, setLastInvoice] = useState<any | null>(null);
  const [processingPayment, setProcessingPayment] = useState(false);
  
  // Modals
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinAction, setPinAction] = useState<'discount' | 'void' | null>(null);
  
  // Quick Actions
  const [showQuickActions, setShowQuickActions] = useState(false);

  // Fetch menu items, categories, tables, and in-house rooms from API
  // (session cookie auth — credentials: 'include')
  const fetchData = useCallback(async () => {
    setDataLoading(true);
    try {
      const opts = { credentials: 'include' as const };
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const [itemsRes, catRes, tablesRes, roomsRes, ordersRes, kdsRes, shiftsRes] = await Promise.all([
        fetch(`/api/pos/menu-items?outlet_id=${outlet.id}&is_active=true`, opts),
        fetch(`/api/pos/outlet-categories?outlet_id=${outlet.id}`, opts),
        fetch(`/api/pos/tables?outlet_id=${outlet.id}`, opts),
        fetch(`/api/pos/in-house-rooms`, opts),
        fetch(`/api/pos/transactions?outlet_id=${outlet.id}&from=${todayStart.toISOString()}&limit=50`, opts),
        fetch(`/api/pos/kds/orders?outlet_id=${outlet.id}`, opts),
        fetch(`/api/pos/shifts?outlet_id=${outlet.id}&status=open`, opts),
      ]);

      if (itemsRes.ok) {
        const itemsData = await itemsRes.json();
        setMenuItems(itemsData.items || []);
      }
      if (catRes.ok) {
        const catData = await catRes.json();
        setCategories(catData.categories || []);
      }
      if (tablesRes.ok) {
        const tablesData = await tablesRes.json();
        setDbTables(tablesData.tables || []);
      }
      if (roomsRes.ok) {
        const roomsData = await roomsRes.json();
        setInHouseRooms(roomsData.rooms || []);
      }
      if (ordersRes.ok) {
        const ordersData = await ordersRes.json();
        setRecentOrders(ordersData.transactions || []);
      }
      if (kdsRes.ok) {
        const kdsData = await kdsRes.json();
        setActiveKdsOrders(
          (kdsData.orders || []).filter((o: any) => ['fired', 'in_progress', 'ready'].includes(o.status))
        );
      }
      if (shiftsRes.ok) {
        const shiftsData = await shiftsRes.json();
        setOpenShift((shiftsData.shifts || []).find((s: any) => s.cashier_id === cashierId) || null);
      }
    } catch (error) {
      console.error('Failed to fetch POS data:', error);
      addNotification('Failed to load outlet data', 'warning', 'F&B');
    } finally {
      setDataLoading(false);
    }
  }, [outlet.id, addNotification, cashierId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Offline transaction queue ─────────────────────────────────────
  const OFFLINE_QUEUE_KEY = 'pos_offline_queue';

  const flushOfflineQueue = useCallback(async () => {
    try {
      const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
      const queue: any[] = raw ? JSON.parse(raw) : [];
      if (queue.length === 0) return;

      const res = await fetch('/api/pos/sync/transactions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: queue }),
      });
      if (!res.ok) return;
      const result = await res.json();

      // Keep only transactions that failed with non-duplicate errors
      const failedInvoices = new Set(
        (result.results || []).filter((r: any) => !r.success).map((r: any) => r.transactionId)
      );
      const remaining = queue.filter(tx => failedInvoices.has(tx.invoice_number));
      if (remaining.length === 0) {
        localStorage.removeItem(OFFLINE_QUEUE_KEY);
        addNotification(`${result.synced} offline transaction(s) synced`, 'success', 'F&B');
      } else {
        localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
      }
    } catch {
      // Still offline — keep the queue
    }
  }, [addNotification]);

  const enqueueOfflineTransaction = useCallback((payload: any) => {
    try {
      const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
      const queue: any[] = raw ? JSON.parse(raw) : [];
      queue.push(payload);
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    } catch (err) {
      console.error('Failed to queue offline transaction:', err);
    }
  }, []);

  useEffect(() => {
    flushOfflineQueue();
    const onOnline = () => flushOfflineQueue();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [flushOfflineQueue]);

  // Build category name lookup
  const categoryNameMap = useMemo(() => {
    const map = new Map<string, string>();
    categories.forEach(c => map.set(c.id, c.name));
    return map;
  }, [categories]);

  // Transform menu items to products
  const products: Product[] = useMemo(() => {
    return menuItems
      .filter(item => item.is_active && item.is_available)
      .map(item => ({
        id: item.id,
        name: item.name,
        price: Number(item.selling_price),
        category: item.category_id ? (categoryNameMap.get(item.category_id) || 'Uncategorized') : 'Uncategorized',
        categoryId: item.category_id || undefined,
        image: item.image_url,
        isAvailable: item.is_available,
        description: item.description,
        taxable: item.is_taxable,
        serviceChargeApplicable: item.is_service_charge_applicable,
        preparationTime: item.preparation_time,
      }));
  }, [menuItems, categoryNameMap]);

  // Transform DB tables to UI tables
  const tables: Table[] = useMemo(() => {
    return dbTables.map(t => ({
      id: t.id,
      number: t.table_number,
      seats: t.seats,
      status: (t.status as Table['status']) || 'available',
    }));
  }, [dbTables]);

  const categoryList = ['All', ...Array.from(new Set(products.map(p => p.category)))];

  const filteredProducts = useMemo(() => {
    return products.filter(product => {
      const matchSearch = product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          product.category.toLowerCase().includes(searchTerm.toLowerCase());
      if (selectedCategory === 'All') return matchSearch;
      return matchSearch && product.category === selectedCategory;
    });
  }, [products, searchTerm, selectedCategory]);

  // Cart Calculations
  const { subtotal, discountAmount, tax, taxData, total } = useMemo(() => {
    const sub = cart.reduce((acc, item) => acc + (item.product.price * item.quantity), 0);
    const disc = (sub * discountPercent) / 100;
    const taxable = sub - disc;
    const tData = formatTaxesAndFees(taxable);
    return {
      subtotal: sub,
      discountAmount: disc,
      tax: tData.taxAmount,
      taxData: tData,
      total: tData.totalWithTaxes
    };
  }, [cart, discountPercent, formatTaxesAndFees]);

  const addToCart = (product: Product) => {
    const existing = cart.find(item => item.product.id === product.id);
    if (existing) {
      setCart(cart.map(item => 
        item.product.id === product.id 
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ));
    } else {
      setCart([...cart, { product, quantity: 1 }]);
    }
    addNotification(`${product.name} added to cart`, 'success', 'F&B');
  };

  const updateQuantity = (productId: string, delta: number) => {
    const existing = cart.find(item => item.product.id === productId);
    if (!existing) return;
    
    const nextQty = existing.quantity + delta;
    if (nextQty <= 0) {
      setCart(cart.filter(item => item.product.id !== productId));
    } else {
      setCart(cart.map(item => 
        item.product.id === productId 
          ? { ...item, quantity: nextQty }
          : item
      ));
    }
  };

  const removeFromCart = (productId: string) => {
    setCart(cart.filter(item => item.product.id !== productId));
  };

  const processPayment = async (splits: PaymentSplit[]) => {
    if (cart.length === 0) return;

    setProcessingPayment(true);

    const invoiceNum = `INV-${outlet.code}-${Date.now()}`;
    const finalCustomerName = customerName || (selectedTable ? `Table ${selectedTable.number}` : 'Walk-in');

    const finalPaymentMethod = splits.length > 1
      ? `Split: ${splits.map(s => `${s.method} (${formatAmount(s.amount)})`).join(', ')}`
      : splits[0]?.method || 'Cash';

    const lineItems = cart.map(c => ({
      menu_item_id: c.product.id,
      name: c.product.name,
      quantity: c.quantity,
      unit_price: c.product.price,
      line_total: c.product.price * c.quantity,
      notes: c.notes || undefined,
    }));

    const selectedRoom = inHouseRooms.find(r => r.roomNumber === selectedRoomId);
    const payload = {
      outlet_id: outlet.id,
      invoice_number: invoiceNum,
      cashier_id: cashierId,
      cashier_name: cashierName,
      customer_type: selectedRoomId ? 'in_house_guest' : 'walk_in',
      reservation_id: selectedRoom?.reservationId,
      room_number: selectedRoomId || undefined,
      guest_name: customerName || selectedRoom?.guestName || undefined,
      line_items: lineItems,
      subtotal,
      discount_amount: discountAmount,
      discount_percent: discountPercent,
      service_charge_amount: taxData.addonDetails
        .filter(a => a.name.toLowerCase().includes('service'))
        .reduce((sum, a) => sum + a.amount, 0),
      tax_amount: taxData.taxAmount,
      total_amount: total,
      payment_method: splits[0]?.method || 'Cash',
      split_payments: splits.length > 1 ? splits.map(s => ({
        method: s.method,
        amount: s.amount,
      })) : undefined,
      status: 'completed',
    };

    try {
      const response = await fetch('/api/pos/transactions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const err = await response.json();
        addNotification(err.error || 'Failed to record transaction', 'warning', 'F&B');
        setProcessingPayment(false);
        return;
      }
      const saved = await response.json();
      if (saved.folio_posted === false && saved.folio_error) {
        addNotification(`Payment recorded, but room charge was NOT posted to the folio: ${saved.folio_error}`, 'warning', 'F&B');
      } else {
        addNotification(`Payment processed: ${formatAmount(total)}`, 'success', 'F&B');
      }
    } catch (err) {
      console.error('Transaction POST failed:', err);
      enqueueOfflineTransaction(payload);
      addNotification('Transaction saved offline — will sync when connection returns', 'warning', 'F&B');
    }

    const invoiceData = {
      invoiceNumber: invoiceNum,
      date: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      customerName: finalCustomerName,
      customerEmail: '',
      roomNo: selectedTable?.number || selectedRoomId,
      items: cart.map(c => ({ productName: c.product.name, quantity: c.quantity, price: c.product.price })),
      subtotal,
      fees: [
        ...taxData.addonDetails.map(a => ({ label: a.name, amount: a.amount })),
        { label: `VAT (15%)`, amount: taxData.taxAmount }
      ],
      total,
      paymentMethod: finalPaymentMethod,
      splitPayments: splits.length > 1 ? splits : undefined
    };
    setInvoicePrintData(invoiceData);
    setLastInvoice(invoiceData);
    fetchData();

    setCart([]);
    setCustomerName('');
    setSelectedRoomId('');
    setDiscountPercent(0);
    setDiscountReason('');
    setShowPaymentModal(false);
    setProcessingPayment(false);
  };

  // Barcode lookup — scans pos_menu_items for this outlet
  const handleBarcodeScan = async () => {
    const barcode = window.prompt('Scan or enter barcode:');
    if (!barcode?.trim()) return;
    try {
      const res = await fetch(
        `/api/pos/products/barcode/${encodeURIComponent(barcode.trim())}?outlet_id=${outlet.id}`,
        { credentials: 'include' }
      );
      if (!res.ok) {
        addNotification('No menu item found for that barcode', 'warning', 'F&B');
        return;
      }
      const item = await res.json();
      const product: Product = {
        id: item.id,
        name: item.name,
        price: Number(item.selling_price),
        category: item.category_id ? (categoryNameMap.get(item.category_id) || 'Uncategorized') : 'Uncategorized',
        categoryId: item.category_id || undefined,
        image: item.image_url,
        isAvailable: item.is_available !== false,
        description: item.description,
        taxable: item.is_taxable !== false,
        serviceChargeApplicable: item.is_service_charge_applicable !== false,
        preparationTime: item.preparation_time,
      };
      addToCart(product);
    } catch (err) {
      console.error('Barcode lookup failed:', err);
      addNotification('Barcode lookup failed', 'warning', 'F&B');
    }
  };

  // Open a POS shift for the current cashier
  const handleOpenShift = async () => {
    try {
      const res = await fetch('/api/pos/shifts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outlet_id: outlet.id,
          cashier_id: cashierId,
          cashier_name: cashierName,
          opening_float: 0,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        addNotification(err.error || 'Failed to open shift', 'warning', 'F&B');
        return;
      }
      const shift = await res.json();
      setOpenShift(shift);
      addNotification(`Shift #${shift.shift_number} opened`, 'success', 'F&B');
    } catch (err) {
      console.error('Open shift failed:', err);
      addNotification('Failed to open shift', 'warning', 'F&B');
    }
  };

  // Reprint the last completed invoice
  const handleReprint = () => {
    if (!lastInvoice) {
      addNotification('No completed order to reprint', 'warning', 'F&B');
      return;
    }
    setInvoicePrintData(lastInvoice);
  };

  // Reprint a past order from the Orders list
  const reprintOrder = (order: any) => {
    const items = Array.isArray(order.line_items) ? order.line_items : [];
    setInvoicePrintData({
      invoiceNumber: order.invoice_number,
      date: new Date(order.transaction_date).toLocaleDateString() + ' ' +
        new Date(order.transaction_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      customerName: order.guest_name || order.room_number || 'Walk-in',
      customerEmail: '',
      roomNo: order.room_number || '',
      items: items.map((li: any) => ({
        productName: li.name || 'Item',
        quantity: li.quantity || 1,
        price: Number(li.unit_price) || 0,
      })),
      subtotal: Number(order.subtotal) || 0,
      fees: [
        ...(Number(order.service_charge_amount) > 0 ? [{ label: 'Service Charge', amount: Number(order.service_charge_amount) }] : []),
        { label: 'VAT', amount: Number(order.tax_amount) || 0 },
      ],
      total: Number(order.total_amount) || 0,
      paymentMethod: order.payment_method || 'Cash',
    });
  };

  const getOutletIcon = () => {
    switch (outlet.outlet_type) {
      case 'restaurant': return Utensils;
      case 'bar':
      case 'pool_bar': return Wine;
      case 'gift_shop': return Package;
      case 'spa': return Sparkles;
      case 'cafe': return Coffee;
      default: return Package;
    }
  };

  const OutletIcon = getOutletIcon();

  const getTableStatusColor = (status: Table['status']) => {
    switch (status) {
      case 'available': return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800';
      case 'occupied': return 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800';
      case 'reserved': return 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800';
      case 'dirty': return 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-600';
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900">
      {/* Top Bar */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center text-white shadow-lg">
              <OutletIcon size={24} />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900 dark:text-white">{outlet.name}</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                <User size={12} />
                {cashierName} • {outlet.user_role}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* View Mode Toggle */}
            <div className="flex bg-slate-100 dark:bg-slate-700 p-1 rounded-xl">
              <button
                onClick={() => setViewMode('products')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
                  viewMode === 'products'
                    ? 'bg-white dark:bg-slate-600 text-indigo-600 dark:text-indigo-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <Grid3x3 size={14} />
                Products
              </button>
              <button
                onClick={() => setViewMode('tables')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
                  viewMode === 'tables'
                    ? 'bg-white dark:bg-slate-600 text-indigo-600 dark:text-indigo-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <Table size={14} />
                Tables
              </button>
              <button
                onClick={() => setViewMode('orders')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
                  viewMode === 'orders'
                    ? 'bg-white dark:bg-slate-600 text-indigo-600 dark:text-indigo-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <Receipt size={14} />
                Orders
              </button>
            </div>

            {/* Quick Actions */}
            <div className="relative">
              <button
                onClick={() => setShowQuickActions(!showQuickActions)}
                className="p-3 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-xl transition-all"
              >
                <MoreVertical size={18} className="text-slate-600 dark:text-slate-400" />
              </button>
              
              <AnimatePresence>
                {showQuickActions && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50"
                  >
                    <div className="p-2">
                      <button
                        onClick={() => { handleReprint(); setShowQuickActions(false); }}
                        className="w-full flex items-center gap-3 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-all"
                      >
                        <Printer size={16} />
                        Reprint Last Receipt
                      </button>
                      {openShift ? (
                        <div className="w-full flex items-center gap-3 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
                          <RotateCcw size={16} />
                          Shift #{openShift.shift_number} open
                        </div>
                      ) : (
                        <button
                          onClick={() => { handleOpenShift(); setShowQuickActions(false); }}
                          className="w-full flex items-center gap-3 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-all"
                        >
                          <RotateCcw size={16} />
                          Open Shift
                        </button>
                      )}
                      <button
                        onClick={() => { onOpenSettings?.(); setShowQuickActions(false); }}
                        className="w-full flex items-center gap-3 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-all"
                      >
                        <Settings size={16} />
                        Settings
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Products/Tables */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Search and Filter Bar */}
          <div className="p-4 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
            <div className="flex gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input
                  type="text"
                  placeholder="Search products..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-2">
                  <button
                    onClick={handleBarcodeScan}
                    className="p-1 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-all"
                    title="Barcode Scanner"
                  >
                    <Scan size={16} className="text-slate-400" />
                  </button>
                </div>
              </div>
              
              <button
                onClick={() => setGridView(!gridView)}
                className="p-3 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-xl transition-all"
              >
                {gridView ? <List size={18} className="text-slate-600 dark:text-slate-400" /> : <LayoutGrid size={18} className="text-slate-600 dark:text-slate-400" />}
              </button>
            </div>

            {/* Category Pills */}
            <div className="flex gap-2 mt-4 overflow-x-auto pb-2">
              {categoryList.map(category => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
                    selectedCategory === category
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-4">
            {viewMode === 'products' && (
              <div className={gridView ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4' : 'space-y-3'}>
                {dataLoading ? (
                  <div className="col-span-full flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                  </div>
                ) : filteredProducts.length === 0 ? (
                  <div className="col-span-full text-center py-12">
                    <Package className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                    <p className="text-sm text-slate-500 dark:text-slate-400">No menu items found for this outlet</p>
                  </div>
                ) : filteredProducts.map(product => (
                  <motion.button
                    key={product.id}
                    onClick={() => addToCart(product)}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className={`relative p-4 rounded-2xl text-left transition-all border-2 ${
                      !product.isAvailable
                        ? 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 opacity-50'
                        : gridView
                        ? 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-indigo-500 hover:shadow-lg'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-indigo-500 flex items-center gap-4'
                    }`}
                    disabled={!product.isAvailable}
                  >
                    {/* Badges */}
                    <div className="absolute top-2 right-2 flex gap-1">
                      {product.isPopular && (
                        <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-full text-[10px] font-bold flex items-center gap-1">
                          <Flame size={10} />
                          Popular
                        </span>
                      )}
                      {product.isFeatured && (
                        <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-full text-[10px] font-bold flex items-center gap-1">
                          <Star size={10} />
                          Featured
                        </span>
                      )}
                    </div>

                    {/* Content */}
                    <div className={gridView ? '' : 'flex-1'}>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-1 line-clamp-2">
                        {product.name}
                      </h4>
                      {!gridView && product.description && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-2 line-clamp-1">
                          {product.description}
                        </p>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-500 dark:text-slate-400">{product.category}</span>
                        <span className="text-sm font-black text-indigo-600 dark:text-indigo-400">
                          {formatAmount(product.price)}
                        </span>
                      </div>
                    </div>

                    {/* Quick Add Button */}
                    <div className={`absolute ${gridView ? 'bottom-2 right-2' : 'ml-4'} w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center text-white shadow-lg hover:bg-indigo-700 transition-all`}>
                      <Plus size={16} />
                    </div>
                  </motion.button>
                ))}
              </div>
            )}

            {viewMode === 'tables' && (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {tables.length === 0 ? (
                  <div className="col-span-full text-center py-12">
                    <Table className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                    <p className="text-sm text-slate-500 dark:text-slate-400">No tables configured for this outlet</p>
                  </div>
                ) : tables.map(table => {
                  const liveOrder = activeKdsOrders.find(o => o.table_number === table.number);
                  return (
                  <motion.button
                    key={table.id}
                    onClick={() => setSelectedTable(table)}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className={`p-6 rounded-2xl border-2 transition-all ${getTableStatusColor(liveOrder ? 'occupied' : table.status)}`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-2xl font-bold">{table.number}</h4>
                      <div className="flex items-center gap-1 text-xs font-bold">
                        <Users size={12} />
                        {table.seats}
                      </div>
                    </div>
                    
                    {liveOrder ? (
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span>Order: {liveOrder.order_id}</span>
                          <span className="font-bold capitalize">{String(liveOrder.status || '').replace('_', ' ')}</span>
                        </div>
                        <div className="flex justify-between text-xs opacity-75">
                          <span>{new Date(liveOrder.fired_at || liveOrder.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          <span>{(liveOrder.items || []).reduce((s: number, i: any) => s + (i.quantity || 1), 0)} items</span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs font-bold capitalize">{table.status}</p>
                    )}
                  </motion.button>
                  );
                })}
              </div>
            )}

            {viewMode === 'orders' && (
              <div className="space-y-3">
                {recentOrders.length === 0 ? (
                  <div className="text-center py-12">
                    <Receipt className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                    <h4 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
                      No Orders Today
                    </h4>
                    <p className="text-slate-500 dark:text-slate-400">
                      Completed orders for this outlet will appear here
                    </p>
                  </div>
                ) : recentOrders.map(order => {
                  const itemCount = Array.isArray(order.line_items)
                    ? order.line_items.reduce((s: number, li: any) => s + (li.quantity || 1), 0)
                    : 0;
                  return (
                    <div
                      key={order.id}
                      className="flex items-center justify-between p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          order.status === 'completed'
                            ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600'
                            : 'bg-amber-100 dark:bg-amber-900/30 text-amber-600'
                        }`}>
                          <Receipt size={16} />
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                            {order.invoice_number}
                          </h4>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400">
                            {new Date(order.transaction_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            {' • '}{itemCount} items
                            {order.room_number ? ` • Room ${order.room_number}` : ''}
                            {' • '}{String(order.payment_method || '').replace(/_/g, ' ')}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">
                          {formatAmount(Number(order.total_amount) || 0)}
                        </span>
                        <button
                          onClick={() => reprintOrder(order)}
                          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-500 transition-all"
                          title="Reprint receipt"
                        >
                          <Printer size={16} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Cart */}
        <div className="w-96 bg-white dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700 flex flex-col">
          {/* Cart Header */}
          <div className="p-4 border-b border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <ShoppingCart size={20} />
                Current Order
              </h2>
              {cart.length > 0 && (
                <button
                  onClick={() => setCart([])}
                  className="p-2 hover:bg-rose-100 dark:hover:bg-rose-900/30 rounded-lg text-rose-600 transition-all"
                  title="Clear Cart"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>

            {/* Table/Room Selection */}
            {selectedTable && (
              <div className="flex items-center gap-2 p-2 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
                <Table size={16} className="text-indigo-600 dark:text-indigo-400" />
                <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">
                  {selectedTable.number} • {selectedTable.seats} seats
                </span>
                <button
                  onClick={() => setSelectedTable(null)}
                  className="ml-auto p-1 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 rounded"
                >
                  <X size={14} className="text-indigo-600 dark:text-indigo-400" />
                </button>
              </div>
            )}

            {/* Customer Name */}
            <div className="mt-3">
              <input
                type="text"
                placeholder="Customer name (optional)"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
              />
            </div>

            {/* Room Charge — in-house guest selection */}
            <div className="mt-2">
              <select
                value={selectedRoomId}
                onChange={(e) => {
                  const roomNo = e.target.value;
                  setSelectedRoomId(roomNo);
                  const room = inHouseRooms.find(r => r.roomNumber === roomNo);
                  if (room?.guestName) setCustomerName(room.guestName);
                }}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
              >
                <option value="">Charge to room… (in-house guests)</option>
                {inHouseRooms.map(room => (
                  <option key={room.reservationId} value={room.roomNumber}>
                    Room {room.roomNumber} — {room.guestName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Cart Items */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {cart.map(item => (
              <motion.div
                key={item.product.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="bg-slate-50 dark:bg-slate-700/50 p-3 rounded-xl border border-slate-200 dark:border-slate-600"
              >
                <div className="flex justify-between items-start mb-2">
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white flex-1">
                    {item.product.name}
                  </h4>
                  <button
                    onClick={() => removeFromCart(item.product.id)}
                    className="p-1 hover:bg-rose-100 dark:hover:bg-rose-900/30 rounded text-rose-600"
                  >
                    <X size={14} />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateQuantity(item.product.id, -1)}
                      className="w-8 h-8 bg-white dark:bg-slate-600 border border-slate-200 dark:border-slate-500 rounded-lg flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-500 transition-all"
                    >
                      <Minus size={14} className="text-slate-600 dark:text-slate-400" />
                    </button>
                    <span className="w-8 text-center text-sm font-bold text-slate-900 dark:text-white">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => updateQuantity(item.product.id, 1)}
                      className="w-8 h-8 bg-white dark:bg-slate-600 border border-slate-200 dark:border-slate-500 rounded-lg flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-500 transition-all"
                    >
                      <Plus size={14} className="text-slate-600 dark:text-slate-400" />
                    </button>
                  </div>

                  <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">
                    {formatAmount(item.product.price * item.quantity)}
                  </span>
                </div>

                {item.notes && (
                  <p className="text-xs text-slate-500 mt-2 italic">"{item.notes}"</p>
                )}
              </motion.div>
            ))}

            {cart.length === 0 && (
              <div className="text-center py-12">
                <ShoppingCart className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Cart is empty
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                  Add items to start an order
                </p>
              </div>
            )}
          </div>

          {/* Cart Summary */}
          <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 space-y-3">
            {/* Discount */}
            <button
              onClick={() => setShowDiscountModal(true)}
              className="w-full flex items-center justify-between p-3 bg-white dark:bg-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-600 transition-all"
            >
              <div className="flex items-center gap-2">
                <Percent size={16} className="text-indigo-600" />
                <span className="text-sm text-slate-700 dark:text-slate-300">Discount</span>
              </div>
              <div className="flex items-center gap-2">
                {discountPercent > 0 && (
                  <span className="text-sm font-bold text-rose-600">
                    -{formatAmount(discountAmount)}
                  </span>
                )}
                <ChevronDown size={16} className="text-slate-400" />
              </div>
            </button>

            {/* Summary */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600 dark:text-slate-400">Subtotal</span>
                <span className="text-slate-900 dark:text-white font-medium">{formatAmount(subtotal)}</span>
              </div>
              {discountPercent > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-rose-600">Discount ({discountPercent}%)</span>
                  <span className="text-rose-600 font-medium">-{formatAmount(discountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-slate-600 dark:text-slate-400">Tax</span>
                <span className="text-slate-900 dark:text-white font-medium">{formatAmount(tax)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold pt-2 border-t border-slate-200 dark:border-slate-600">
                <span className="text-slate-900 dark:text-white">Total</span>
                <span className="text-indigo-600 dark:text-indigo-400">{formatAmount(total)}</span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-2 pt-2">
              <button
                onClick={() => setShowPaymentModal(true)}
                disabled={cart.length === 0 || processingPayment}
                className="w-full py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 disabled:from-slate-300 disabled:to-slate-400 text-white rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/25 disabled:shadow-none"
              >
                <CreditCard size={20} />
                Process Payment
              </button>
              
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    if (cart.length === 0) return;
                    try {
                      const kdsPayload = {
                        orderId: `KDS-${outlet.code}-${Date.now()}`,
                        outlet_id: outlet.id,
                        items: cart.map(c => ({
                          menu_item_id: c.product.id,
                          name: c.product.name,
                          quantity: c.quantity,
                          notes: c.notes || orderNotes || undefined,
                        })),
                        tableNumber: selectedTable?.number || undefined,
                        customer_name: customerName || undefined,
                        priority: 'normal',
                        station: outlet.outlet_type === 'restaurant' ? 'kitchen' : 'bar',
                        notes: orderNotes || undefined,
                      };
                      const response = await fetch('/api/pos/kds/orders', {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(kdsPayload),
                      });
                      if (response.ok) {
                        addNotification('Order sent to kitchen (KDS)', 'success', 'F&B');
                        setOrderNotes('');
                      } else {
                        addNotification('Failed to send to kitchen', 'warning', 'F&B');
                      }
                    } catch (err) {
                      console.error('KDS order failed:', err);
                      addNotification('KDS order failed — will retry', 'warning', 'F&B');
                    }
                  }}
                  disabled={cart.length === 0}
                  className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-300 text-white rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2"
                >
                  <Send size={16} />
                  Send to Kitchen
                </button>
                <button
                  onClick={() => setShowNotesModal(true)}
                  className="flex-1 py-3 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2"
                >
                  <Edit size={16} />
                  Add Notes
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Payment Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-auto shadow-2xl">
            <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Process Payment</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">Total: {formatAmount(total)}</p>
              </div>
              <button
                onClick={() => setShowPaymentModal(false)}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-all"
              >
                <X size={20} className="text-slate-600 dark:text-slate-400" />
              </button>
            </div>
            <div className="p-4">
              <PaymentSystem
                totalAmount={total}
                onPaymentComplete={processPayment}
                currency="ETB"
                availableMethods={['Cash', 'Card', 'Mobile', 'Room Charge']}
                isRoomChargeAvailable={inHouseRooms.length > 0}
                selectedRoomId={selectedRoomId || undefined}
              />
            </div>
          </div>
        </div>
      )}

      {/* Invoice Print Modal */}
      {invoicePrintData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-auto print-area">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center">
              <h3 className="text-lg font-bold text-slate-900">Receipt</h3>
              <button
                onClick={() => {
                  setInvoicePrintData(null);
                  window.print();
                }}
                className="p-2 hover:bg-slate-100 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-4">
              <UnifiedInvoiceTemplate {...invoicePrintData} />
            </div>
          </div>
        </div>
      )}

      {/* Discount Modal */}
      {showDiscountModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Apply Discount</h3>
              <button
                onClick={() => setShowDiscountModal(false)}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Discount Percentage
                </label>
                <input
                  type="number"
                  value={discountPercent}
                  onChange={(e) => setDiscountPercent(Number(e.target.value))}
                  min="0"
                  max="100"
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Reason
                </label>
                <textarea
                  value={discountReason}
                  onChange={(e) => setDiscountReason(e.target.value)}
                  placeholder="Discount reason..."
                  rows={3}
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white resize-none"
                />
              </div>

              <button
                onClick={() => {
                  setPinAction('discount');
                  setShowPinModal(true);
                }}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm transition-all"
              >
                Apply Discount
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manager PIN Modal */}
      <ManagerPinModal
        open={showPinModal}
        onClose={() => { setShowPinModal(false); setPinAction(null); }}
        onSuccess={() => {
          if (pinAction === 'discount') {
            setShowDiscountModal(false);
            addNotification(`Discount applied: ${discountPercent}%`, 'success', 'F&B');
          }
        }}
        context={pinAction === 'discount' ? `pos_discount_${discountPercent}%` : 'pos_action'}
        outletId={outlet.id}
        title="Manager Approval"
        description={pinAction === 'discount' ? 'Authorize discount application' : 'Authorize action'}
      />

      {/* Notes Modal */}
      {showNotesModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Order Notes</h3>
              <button
                onClick={() => setShowNotesModal(false)}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <textarea
                value={orderNotes}
                onChange={(e) => setOrderNotes(e.target.value)}
                placeholder="Add special instructions for the kitchen..."
                rows={4}
                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white resize-none"
              />

              <button
                onClick={() => {
                  setShowNotesModal(false);
                  addNotification('Order notes saved', 'success', 'F&B');
                }}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm transition-all"
              >
                Save Notes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
