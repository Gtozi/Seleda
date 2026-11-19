/**
 * Room Service Module
 * Browse the real F&B room-service menu, cart, order placement, order tracking.
 * Live data: /api/guest-portal/room-service/*
 */

import { useCallback, useEffect, useState } from 'react';
import {
  UtensilsCrossed,
  Search,
  Filter,
  Clock,
  Plus,
  Minus,
  ShoppingCart,
  Calendar,
  Truck,
  ChefHat,
  Leaf,
  Wheat,
  Loader2,
  AlertCircle,
  XCircle
} from 'lucide-react';

interface RoomServiceModuleProps {
  reservationId?: string;
  guestId?: string;
}

interface MenuItem {
  id: string;
  menuItemId: string;
  name: string;
  description: string;
  price: number;
  category: string;
  dietary: string[];
  allergens: string[];
  image?: string | null;
  preparationTime: number;
  availableNow: boolean;
  availableFrom?: string | null;
  availableUntil?: string | null;
}

interface CartItem {
  menuItem: MenuItem;
  quantity: number;
}

interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  specialInstructions?: string | null;
}

interface Order {
  id: string;
  orderNumber?: string;
  roomNumber?: string;
  status: string;
  orderType?: string;
  scheduledFor?: string | null;
  totalAmount: number;
  specialInstructions?: string | null;
  chargeToRoom?: boolean;
  createdAt?: string;
  items: OrderItem[];
}

interface RsReservation {
  id: string;
  guestId?: string;
  guestName?: string;
  roomNumber?: string | null;
  propertyId?: string;
  status?: string;
}

interface ReservationListItem {
  id: string;
  status?: string;
  checkOutDate?: string;
}

const IN_HOUSE_STATUSES = new Set(['CheckedIn', 'Checked In', 'InHouse', 'In House']);
const ORDERABLE_STATUSES = new Set([...IN_HOUSE_STATUSES, 'Reserved', 'Pending', 'Confirmed']);

function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

const RoomServiceModule: React.FC<RoomServiceModuleProps> = ({
  reservationId: reservationIdProp,
  guestId
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noContext, setNoContext] = useState(false);
  const [noEligible, setNoEligible] = useState(false);
  const [reservationId, setReservationId] = useState(reservationIdProp || '');
  const [reservation, setReservation] = useState<RsReservation | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [dietaryFilter, setDietaryFilter] = useState<string>('All');
  const [showCart, setShowCart] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [scheduledTime, setScheduledTime] = useState('');
  const [orderInstructions, setOrderInstructions] = useState('');

  const loadData = useCallback(async (resId: string) => {
    const [menuRes, ordersRes] = await Promise.all([
      fetch(`/api/guest-portal/room-service/menu/${encodeURIComponent(resId)}`, {
        headers: authHeaders(), credentials: 'include'
      }),
      fetch(`/api/guest-portal/room-service/orders/${encodeURIComponent(resId)}`, {
        headers: authHeaders(), credentials: 'include'
      })
    ]);
    if (!menuRes.ok) {
      const body = await menuRes.json().catch(() => ({}));
      throw new Error(body.error || `Failed to load menu (${menuRes.status})`);
    }
    const menuBody = await menuRes.json();
    setReservation(menuBody.reservation || null);
    setMenuItems(menuBody.menu || []);
    if (ordersRes.ok) {
      const ordersBody = await ordersRes.json();
      setOrders(ordersBody.orders || []);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        let resId = reservationIdProp || '';
        if (!resId && guestId) {
          const res = await fetch(
            `/api/guest-portal/reservations/${encodeURIComponent(guestId)}`,
            { headers: authHeaders(), credentials: 'include' }
          );
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `Failed to load reservations (${res.status})`);
          }
          const body = await res.json();
          const list: ReservationListItem[] = body.reservations || [];
          const today = new Date().toISOString().slice(0, 10);
          const inHouse = list.find(r => IN_HOUSE_STATUSES.has(String(r.status)));
          const upcoming = list
            .filter(r => ['Reserved', 'Pending', 'Confirmed'].includes(String(r.status)))
            .filter(r => String(r.checkOutDate || '') >= today)
            .sort((a, b) => String(a.checkOutDate).localeCompare(String(b.checkOutDate)));
          resId = (inHouse || upcoming[0])?.id || '';
        }
        if (!resId) {
          if (!cancelled) {
            if (guestId) setNoEligible(true); else setNoContext(true);
          }
          return;
        }
        if (!cancelled) {
          setReservationId(resId);
          await loadData(resId);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load room service');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [reservationIdProp, guestId, loadData]);

  const categories = ['All', ...new Set(menuItems.map(i => i.category))];
  const dietaryOptions = ['All', ...new Set(menuItems.flatMap(i => i.dietary))];

  const filteredMenuItems = menuItems.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         item.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === 'All' || item.category === categoryFilter;
    const matchesDietary = dietaryFilter === 'All' || item.dietary.includes(dietaryFilter);
    return matchesSearch && matchesCategory && matchesDietary;
  });

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      'Pending': 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:border-amber-700/50 dark:text-amber-400',
      'Confirmed': 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:border-blue-700/50 dark:text-blue-400',
      'In Progress': 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:border-blue-700/50 dark:text-blue-400',
      'Ready': 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/20 dark:border-indigo-700/50 dark:text-indigo-400',
      'In Transit': 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/20 dark:border-indigo-700/50 dark:text-indigo-400',
      'Picked Up': 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/20 dark:border-indigo-700/50 dark:text-indigo-400',
      'Delivered': 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700/50 dark:text-emerald-400',
      'Collected': 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700/50 dark:text-emerald-400',
      'Cancelled': 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-400'
    };
    return colors[status] || colors['Pending'];
  };

  const addToCart = (menuItem: MenuItem) => {
    const existingItem = cart.find(item => item.menuItem.id === menuItem.id);
    if (existingItem) {
      setCart(cart.map(item =>
        item.menuItem.id === menuItem.id
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ));
    } else {
      setCart([...cart, { menuItem, quantity: 1 }]);
    }
  };

  const removeFromCart = (menuItemId: string) => {
    setCart(cart.filter(item => item.menuItem.id !== menuItemId));
  };

  const updateQuantity = (menuItemId: string, delta: number) => {
    setCart(cart.map(item => {
      if (item.menuItem.id === menuItemId) {
        const newQuantity = Math.max(1, item.quantity + delta);
        return { ...item, quantity: newQuantity };
      }
      return item;
    }));
  };

  const cartTotal = cart.reduce((sum, item) => sum + (item.menuItem.price * item.quantity), 0);
  const canOrder = ORDERABLE_STATUSES.has(String(reservation?.status)) && !!reservation?.roomNumber;

  const handlePlaceOrder = async () => {
    if (cart.length === 0 || placing) return;
    setPlacing(true);
    setActionError(null);
    try {
      const res = await fetch('/api/guest-portal/room-service/orders', {
        method: 'POST',
        headers: authHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          reservationId,
          items: cart.map(i => ({ menuItemId: i.menuItem.menuItemId, quantity: i.quantity })),
          scheduledFor: scheduling && scheduledTime ? new Date(scheduledTime).toISOString() : null,
          specialInstructions: orderInstructions || null,
          chargeToRoom: true
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Order failed (${res.status})`);
      setCart([]);
      setShowCart(false);
      setScheduling(false);
      setScheduledTime('');
      setOrderInstructions('');
      await loadData(reservationId);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to place order');
    } finally {
      setPlacing(false);
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    if (!confirm('Cancel this order?')) return;
    setCancellingId(orderId);
    setActionError(null);
    try {
      const res = await fetch(`/api/guest-portal/room-service/orders/${encodeURIComponent(orderId)}/cancel`, {
        method: 'PATCH',
        headers: authHeaders(),
        credentials: 'include',
        body: JSON.stringify({ reservationId })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Cancel failed (${res.status})`);
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'Cancelled' } : o));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to cancel order');
    } finally {
      setCancellingId(null);
    }
  };

  // ── Render states ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-4 sm:p-6">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-12 text-center">
          <Loader2 size={32} className="mx-auto text-indigo-500 animate-spin mb-3" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading room service…</p>
        </div>
      </div>
    );
  }

  if (noContext || noEligible) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Room Service</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Order delicious meals to your room</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 sm:p-12 text-center">
          <UtensilsCrossed size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
            {noContext ? 'Sign in to order room service' : 'No reservation available for room service'}
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {noContext
              ? 'Link a guest profile to browse the menu and place orders.'
              : 'Room service is available for current or upcoming stays.'}
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Room Service</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Order delicious meals to your room</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 sm:p-12 text-center">
          <AlertCircle size={40} className="mx-auto text-red-400 mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Room service unavailable</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{error}</p>
          <button
            onClick={() => { setLoading(true); setError(null); loadData(reservationId).catch(e => setError(e.message)).finally(() => setLoading(false)); }}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Room Service</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {reservation?.roomNumber
              ? `Delivering to Room ${reservation.roomNumber} · ${reservation.guestName || 'Guest'}`
              : 'Order delicious meals to your room'}
          </p>
        </div>
        <button
          onClick={() => setShowCart(true)}
          className="relative flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium"
        >
          <ShoppingCart size={18} />
          Cart
          {cart.length > 0 && (
            <span className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
              {cart.length}
            </span>
          )}
        </button>
      </div>

      {!canOrder && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-700/50">
          <AlertCircle size={20} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800 dark:text-amber-200">
            {reservation?.roomNumber
              ? 'Orders can be placed once your stay begins.'
              : 'No room assigned yet — you can browse the menu, and order once the front desk assigns your room.'}
          </p>
        </div>
      )}

      {actionError && (
        <div className="flex items-start gap-3 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-700/50">
          <AlertCircle size={20} className="text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700 dark:text-red-300">{actionError}</p>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search menu..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Filter size={18} className="text-slate-400" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            {dietaryOptions.length > 1 && (
              <select
                value={dietaryFilter}
                onChange={(e) => setDietaryFilter(e.target.value)}
                className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {dietaryOptions.map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      {/* Menu Items */}
      {filteredMenuItems.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 sm:p-12 text-center">
          <ChefHat size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">No menu items found</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {menuItems.length === 0
              ? 'The room-service menu has not been published for this property yet.'
              : 'Try adjusting your search or filters.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredMenuItems.map((item) => (
            <div key={item.id} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              {item.image ? (
                <img src={item.image} alt={item.name} className="aspect-video w-full object-cover" />
              ) : (
                <div className="aspect-video bg-gradient-to-br from-amber-100 to-orange-200 dark:from-amber-900/20 dark:to-orange-900/20 flex items-center justify-center">
                  <ChefHat size={48} className="text-amber-600 dark:text-amber-400" />
                </div>
              )}
              <div className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-slate-900 dark:text-white">{item.name}</h3>
                  <span className="font-bold text-indigo-600 dark:text-indigo-400">
                    ${item.price.toFixed(2)}
                  </span>
                </div>
                {item.description && (
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">{item.description}</p>
                )}
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                    <Clock size={12} />
                    <span>{item.preparationTime} min</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {item.dietary.map((diet) => (
                      <span
                        key={diet}
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          diet === 'Vegetarian' || diet === 'Vegan'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                            : diet === 'Gluten-Free'
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
                            : 'bg-slate-100 text-slate-700 dark:bg-slate-900/20 dark:text-slate-400'
                        }`}
                      >
                        {diet === 'Vegetarian' && <Leaf size={10} className="inline mr-1" />}
                        {diet === 'Gluten-Free' && <Wheat size={10} className="inline mr-1" />}
                        {diet}
                      </span>
                    ))}
                  </div>
                </div>
                {!item.availableNow && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mb-2">
                    Currently unavailable{item.availableFrom ? ` — available ${String(item.availableFrom).slice(0, 5)}–${String(item.availableUntil || '').slice(0, 5)}` : ''}
                  </p>
                )}
                <button
                  onClick={() => addToCart(item)}
                  disabled={!item.availableNow || !canOrder}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus size={16} />
                  Add to Order
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent Orders */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Your Orders</h3>
        {orders.length === 0 ? (
          <div className="p-8 text-center border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">
            <Truck size={32} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
            <p className="text-sm text-slate-500 dark:text-slate-400">No orders yet — your room-service orders will appear here.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <div key={order.id} className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900/20">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="font-medium text-slate-900 dark:text-white">
                      Order {order.orderNumber || `#${order.id.slice(0, 8)}`}
                      {order.orderType === 'Scheduled' && order.scheduledFor && (
                        <span className="ml-2 text-xs text-indigo-600 dark:text-indigo-400">
                          scheduled {new Date(order.scheduledFor).toLocaleString()}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-slate-600 dark:text-slate-400">
                      {order.createdAt ? new Date(order.createdAt).toLocaleString() : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(order.status)}`}>
                      {order.status}
                    </span>
                    {order.status === 'Pending' && (
                      <button
                        onClick={() => handleCancelOrder(order.id)}
                        disabled={cancellingId === order.id}
                        className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition disabled:opacity-50"
                        title="Cancel order"
                      >
                        {cancellingId === order.id ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />}
                      </button>
                    )}
                  </div>
                </div>
                {order.items.length > 0 && (
                  <div className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                    {order.items.map(i => `${i.quantity}× ${i.name}`).join(', ')}
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <div className="text-sm text-slate-600 dark:text-slate-400">
                    {order.items.length} item{order.items.length === 1 ? '' : 's'}
                    {order.chargeToRoom ? ' · charged to room' : ''}
                  </div>
                  <div className="font-semibold text-slate-900 dark:text-white">
                    ${order.totalAmount.toFixed(2)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cart Modal */}
      {showCart && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 sm:p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Your Order</h3>
              <button
                onClick={() => setShowCart(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                ✕
              </button>
            </div>

            {cart.length === 0 ? (
              <div className="text-center py-8">
                <ShoppingCart size={48} className="mx-auto text-slate-400 mb-4" />
                <p className="text-slate-600 dark:text-slate-400">Your cart is empty</p>
              </div>
            ) : (
              <>
                <div className="space-y-4 mb-4">
                  {cart.map((item) => (
                    <div key={item.menuItem.id} className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-900/20 rounded-lg">
                      <div className="flex-1">
                        <div className="font-medium text-slate-900 dark:text-white">{item.menuItem.name}</div>
                        <div className="text-sm text-slate-600 dark:text-slate-400">
                          ${item.menuItem.price.toFixed(2)} each
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => updateQuantity(item.menuItem.id, -1)}
                          className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600"
                        >
                          <Minus size={16} />
                        </button>
                        <span className="w-8 text-center font-medium text-slate-900 dark:text-white">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => updateQuantity(item.menuItem.id, 1)}
                          className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600"
                        >
                          <Plus size={16} />
                        </button>
                      </div>
                      <button
                        onClick={() => removeFromCart(item.menuItem.id)}
                        className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>

                {/* Special instructions */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Special Instructions
                  </label>
                  <textarea
                    value={orderInstructions}
                    onChange={(e) => setOrderInstructions(e.target.value)}
                    placeholder="Allergies, delivery notes…"
                    rows={2}
                    className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                {/* Scheduling */}
                <div className="mb-4 p-4 bg-slate-50 dark:bg-slate-900/20 rounded-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <input
                      type="checkbox"
                      id="schedule"
                      checked={scheduling}
                      onChange={(e) => setScheduling(e.target.checked)}
                      className="rounded border-slate-300 dark:border-slate-600"
                    />
                    <label htmlFor="schedule" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      Schedule Delivery
                    </label>
                  </div>
                  {scheduling && (
                    <div className="flex items-center gap-2">
                      <Calendar size={18} className="text-slate-400" />
                      <input
                        type="datetime-local"
                        value={scheduledTime}
                        onChange={(e) => setScheduledTime(e.target.value)}
                        min={new Date().toISOString().slice(0, 16)}
                        className="flex-1 px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  )}
                </div>

                <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-lg font-semibold text-slate-900 dark:text-white">Total</span>
                    <span className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                      ${cartTotal.toFixed(2)}
                    </span>
                  </div>
                  <button
                    onClick={handlePlaceOrder}
                    disabled={placing || !canOrder}
                    className="w-full flex items-center justify-center gap-2 px-4 sm:px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {placing ? <Loader2 size={18} className="animate-spin" /> : <Truck size={18} />}
                    {placing ? 'Placing Order…' : `Place Order${reservation?.roomNumber ? ` — Room ${reservation.roomNumber}` : ''}`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default RoomServiceModule;
