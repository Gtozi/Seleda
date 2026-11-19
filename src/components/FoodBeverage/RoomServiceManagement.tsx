/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 *
 * Room Service module — F&B Portal.
 * Owns Menu, Orders, Delivery, Minibar, and Guest Preferences for Room Service.
 * Per spec §14 (Room Service).
 *
 * Fully DB-integrated: every sub-tab performs live CRUD against the
 * `/api/fb/room-service-*` and `/api/fb/minibar-inventory` routes, which
 * read/write the `fb_room_service_*` and `fb_minibar_*` Supabase tables.
 */

import { useState, useEffect, useMemo } from 'react';
import {
  Utensils,
  Clock,
  ShoppingCart,
  Wine,
  Heart,
  Search,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  X,
  Plus,
  Edit,
  Trash2,
  Package,
  Truck,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';

type SubTab = 'menu' | 'orders' | 'delivery' | 'minibar' | 'preferences';

interface RSMenuItem {
  id: string;
  menu_item_id: string;
  menu_item_name: string;
  outlet_id: string;
  outlet_name: string;
  is_available_24h: boolean;
  available_from: string | null;
  available_until: string | null;
  availability_days: string[] | null;
  is_active: boolean;
}

interface RSOrder {
  id: string;
  order_id: string | null;
  room_number: string;
  guest_name: string | null;
  guest_id: string | null;
  reservation_id: string | null;
  order_type: 'Immediate' | 'Scheduled';
  scheduled_for: string | null;
  total_amount: number;
  special_instructions: string | null;
  status: 'Pending' | 'Confirmed' | 'In Progress' | 'Ready' | 'Delivered' | 'Cancelled';
  charge_to_room: boolean;
  folio_id: string | null;
}

interface RSDelivery {
  id: string;
  room_service_order_id: string;
  assigned_to: string | null;
  status: 'Assigned' | 'Picked Up' | 'In Transit' | 'Delivered' | 'Collected';
  picked_up_at: string | null;
  delivered_at: string | null;
  collected_at: string | null;
  delivery_notes: string | null;
}

interface GuestPreference {
  id: string;
  guest_id: string | null;
  room_number: string | null;
  dietary_restrictions: string[] | null;
  preferred_temperature: string | null;
  special_requests: string | null;
  favorite_items: string[] | null;
  disliked_items: string[] | null;
  notes: string | null;
}

interface MinibarInventory {
  id: string;
  room_number: string;
  menu_item_id: string;
  menu_item_name: string;
  current_stock: number;
  max_stock: number;
  last_restocked_at: string | null;
  is_active: boolean;
}

interface MenuItemOption { id: string; name: string; }
interface OutletOption { id: string; name: string; }

const SUB_TABS: { id: SubTab; label: string; icon: typeof Utensils }[] = [
  { id: 'menu', label: 'Menu', icon: Utensils },
  { id: 'orders', label: 'Orders', icon: ShoppingCart },
  { id: 'delivery', label: 'Delivery', icon: Clock },
  { id: 'minibar', label: 'Minibar', icon: Wine },
  { id: 'preferences', label: 'Guest Preferences', icon: Heart },
];

const ORDER_STATUSES: RSOrder['status'][] = ['Pending', 'Confirmed', 'In Progress', 'Ready', 'Delivered', 'Cancelled'];
const DELIVERY_STATUSES: RSDelivery['status'][] = ['Assigned', 'Picked Up', 'In Transit', 'Delivered', 'Collected'];
const ORDER_TYPES: RSOrder['order_type'][] = ['Immediate', 'Scheduled'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DIET_OPTIONS = ['Vegetarian', 'Vegan', 'Gluten-Free', 'Halal', 'Kosher', 'No Nuts', 'No Pork', 'No Dairy', 'No Seafood'];
const TEMP_OPTIONS = ['Hot', 'Warm', 'Room Temperature', 'Cold', 'Chilled'];

const ORDER_STATUS_TONE: Record<RSOrder['status'], 'info' | 'warning' | 'success' | 'neutral'> = {
  Pending: 'warning',
  Confirmed: 'info',
  'In Progress': 'info',
  Ready: 'success',
  Delivered: 'success',
  Cancelled: 'neutral',
};

const DELIVERY_STATUS_TONE: Record<RSDelivery['status'], 'info' | 'warning' | 'success'> = {
  Assigned: 'info',
  'Picked Up': 'info',
  'In Transit': 'warning',
  Delivered: 'success',
  Collected: 'success',
};

type ModalKind = 'menu' | 'order' | 'delivery' | 'preference' | 'minibar' | null;

export default function RoomServiceManagement() {
  const { formatAmount, addNotification } = useERP();
  const [subTab, setSubTab] = useState<SubTab>('menu');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [rsMenuItems, setRSMenuItems] = useState<RSMenuItem[]>([]);
  const [rsOrders, setRSOrders] = useState<RSOrder[]>([]);
  const [rsDeliveries, setRSDeliveries] = useState<RSDelivery[]>([]);
  const [guestPreferences, setGuestPreferences] = useState<GuestPreference[]>([]);
  const [minibarInventory, setMinibarInventory] = useState<MinibarInventory[]>([]);
  const [menuItemOptions, setMenuItemOptions] = useState<MenuItemOption[]>([]);
  const [outletOptions, setOutletOptions] = useState<OutletOption[]>([]);

  const [modalKind, setModalKind] = useState<ModalKind>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});

  const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('auth_token') || localStorage.getItem('hotel_erp_session');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [menuRes, ordersRes, deliveryRes, prefRes, minibarRes, miRes, outRes] = await Promise.all([
        fetch('/api/fb/room-service-menu-items', { headers: getAuthHeaders() }),
        fetch('/api/fb/room-service-orders', { headers: getAuthHeaders() }),
        fetch('/api/fb/room-service-deliveries', { headers: getAuthHeaders() }),
        fetch('/api/fb/room-service-guest-preferences', { headers: getAuthHeaders() }),
        fetch('/api/fb/minibar-inventory', { headers: getAuthHeaders() }),
        fetch('/api/fb/menu-items', { headers: getAuthHeaders() }),
        fetch('/api/fb/outlets', { headers: getAuthHeaders() }),
      ]);
      if (menuRes.ok) setRSMenuItems(await menuRes.json());
      if (ordersRes.ok) setRSOrders(await ordersRes.json());
      if (deliveryRes.ok) setRSDeliveries(await deliveryRes.json());
      if (prefRes.ok) setGuestPreferences(await prefRes.json());
      if (minibarRes.ok) setMinibarInventory(await minibarRes.json());
      if (miRes.ok) {
        const miData = await miRes.json();
        setMenuItemOptions((miData.data || miData || []).map((mi: any) => ({ id: mi.id, name: mi.name })));
      }
      if (outRes.ok) {
        const outData = await outRes.json();
        setOutletOptions((outData.data || outData || []).map((o: any) => ({ id: o.id, name: o.name })));
      }
    } catch (err) {
      console.error('Failed to fetch room service data:', err);
      addNotification('Failed to load room service data', 'warning', 'F&B');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const stats = useMemo(() => ({
    activeOrders: rsOrders.filter(o => o.status === 'Pending' || o.status === 'In Progress').length,
    deliveredToday: rsOrders.filter(o => o.status === 'Delivered').length,
    lowStockItems: minibarInventory.filter(m => m.current_stock <= 1).length,
    totalMenuItems: rsMenuItems.filter(m => m.is_active).length,
  }), [rsOrders, minibarInventory, rsMenuItems]);

  const filteredOrders = rsOrders.filter(o => o.room_number.includes(search) || (o.guest_name && o.guest_name.toLowerCase().includes(search.toLowerCase())));
  const filteredPreferences = guestPreferences.filter(p => p.room_number && p.room_number.includes(search));

  // ── Modal helpers ──────────────────────────────────────────────────────
  const openCreate = (kind: ModalKind) => {
    setEditingId(null);
    setModalKind(kind);
    if (kind === 'menu') {
      setFormData({
        menu_item_id: menuItemOptions[0]?.id || '',
        outlet_id: outletOptions.find(o => o.name === 'Room Service')?.id || outletOptions[0]?.id || '',
        is_available_24h: true,
        available_from: '',
        available_until: '',
        availability_days: [],
        is_active: true,
      });
    } else if (kind === 'order') {
      setFormData({
        room_number: '',
        guest_name: '',
        order_type: 'Immediate',
        scheduled_for: '',
        total_amount: 0,
        special_instructions: '',
        status: 'Pending',
        charge_to_room: true,
      });
    } else if (kind === 'delivery') {
      setFormData({
        room_service_order_id: rsOrders[0]?.id || '',
        assigned_to: '',
        status: 'Assigned',
        delivery_notes: '',
      });
    } else if (kind === 'preference') {
      setFormData({
        room_number: '',
        dietary_restrictions: [],
        preferred_temperature: '',
        special_requests: '',
        favorite_items: [],
        disliked_items: [],
        notes: '',
      });
    } else if (kind === 'minibar') {
      setFormData({
        room_number: '',
        menu_item_id: menuItemOptions[0]?.id || '',
        current_stock: 0,
        max_stock: 5,
        is_active: true,
      });
    }
  };

  const openEdit = (kind: ModalKind, item: any) => {
    setEditingId(item.id);
    setModalKind(kind);
    if (kind === 'menu') {
      setFormData({
        menu_item_id: item.menu_item_id,
        outlet_id: item.outlet_id,
        is_available_24h: item.is_available_24h,
        available_from: item.available_from || '',
        available_until: item.available_until || '',
        availability_days: item.availability_days || [],
        is_active: item.is_active,
      });
    } else if (kind === 'order') {
      setFormData({
        room_number: item.room_number,
        guest_name: item.guest_name || '',
        order_type: item.order_type,
        scheduled_for: item.scheduled_for ? item.scheduled_for.slice(0, 16) : '',
        total_amount: item.total_amount,
        special_instructions: item.special_instructions || '',
        status: item.status,
        charge_to_room: item.charge_to_room,
      });
    } else if (kind === 'delivery') {
      setFormData({
        room_service_order_id: item.room_service_order_id,
        assigned_to: item.assigned_to || '',
        status: item.status,
        delivery_notes: item.delivery_notes || '',
      });
    } else if (kind === 'preference') {
      setFormData({
        room_number: item.room_number || '',
        dietary_restrictions: item.dietary_restrictions || [],
        preferred_temperature: item.preferred_temperature || '',
        special_requests: item.special_requests || '',
        favorite_items: item.favorite_items || [],
        disliked_items: item.disliked_items || [],
        notes: item.notes || '',
      });
    } else if (kind === 'minibar') {
      setFormData({
        room_number: item.room_number,
        menu_item_id: item.menu_item_id,
        current_stock: item.current_stock,
        max_stock: item.max_stock,
        is_active: item.is_active,
      });
    }
  };

  const closeModal = () => {
    setModalKind(null);
    setEditingId(null);
    setFormData({});
  };

  // Build the payload for the active modal, normalizing empty strings → null
  const buildPayload = (): Record<string, any> => {
    const p: Record<string, any> = { ...formData };
    if (modalKind === 'menu') {
      p.available_from = p.available_from || null;
      p.available_until = p.available_until || null;
      p.availability_days = p.is_available_24h ? null : (p.availability_days?.length ? p.availability_days : null);
    } else if (modalKind === 'order') {
      p.guest_name = p.guest_name || null;
      p.scheduled_for = p.order_type === 'Scheduled' && p.scheduled_for ? new Date(p.scheduled_for).toISOString() : null;
      p.special_instructions = p.special_instructions || null;
      p.total_amount = Number(p.total_amount) || 0;
    } else if (modalKind === 'delivery') {
      p.assigned_to = p.assigned_to || null;
      p.delivery_notes = p.delivery_notes || null;
    } else if (modalKind === 'preference') {
      p.room_number = p.room_number || null;
      p.preferred_temperature = p.preferred_temperature || null;
      p.special_requests = p.special_requests || null;
      p.notes = p.notes || null;
      p.favorite_items = p.favorite_items?.length ? p.favorite_items : null;
      p.disliked_items = p.disliked_items?.length ? p.disliked_items : null;
      p.dietary_restrictions = p.dietary_restrictions?.length ? p.dietary_restrictions : null;
    } else if (modalKind === 'minibar') {
      p.current_stock = Number(p.current_stock) || 0;
      p.max_stock = Number(p.max_stock) || 5;
      if (editingId) p.last_restocked_at = new Date().toISOString();
    }
    return p;
  };

  const handleSave = async () => {
    if (!modalKind) return;
    setSaving(true);
    try {
      const payload = buildPayload();
      const routeMap: Record<Exclude<ModalKind, null>, string> = {
        menu: 'room-service-menu-items',
        order: 'room-service-orders',
        delivery: 'room-service-deliveries',
        preference: 'room-service-guest-preferences',
        minibar: 'minibar-inventory',
      };
      const route = routeMap[modalKind];
      const method = editingId ? 'PATCH' : 'POST';
      const url = editingId ? `/api/fb/${route}/${editingId}` : `/api/fb/${route}`;
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Failed to save (${res.status})`);
      }
      addNotification(editingId ? `${modalKind} updated successfully` : `${modalKind} created successfully`, 'success', 'F&B');
      closeModal();
      fetchData();
    } catch (err: any) {
      console.error('Error saving:', err);
      addNotification(err.message || 'Failed to save', 'warning', 'F&B');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (kind: ModalKind, id: string) => {
    if (!kind) return;
    if (!confirm(`Are you sure you want to delete this ${kind} record?`)) return;
    try {
      const routeMap: Record<Exclude<ModalKind, null>, string> = {
        menu: 'room-service-menu-items',
        order: 'room-service-orders',
        delivery: 'room-service-deliveries',
        preference: 'room-service-guest-preferences',
        minibar: 'minibar-inventory',
      };
      const res = await fetch(`/api/fb/${routeMap[kind]}/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to delete');
      addNotification(`${kind} deleted successfully`, 'success', 'F&B');
      fetchData();
    } catch (err) {
      console.error('Error deleting:', err);
      addNotification('Failed to delete', 'warning', 'F&B');
    }
  };

  const setField = (key: string, value: any) => setFormData(prev => ({ ...prev, [key]: value }));
  const toggleArrayValue = (key: string, value: string) =>
    setFormData(prev => {
      const arr: string[] = prev[key] || [];
      return { ...prev, [key]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value] };
    });

  // ── Input primitives ───────────────────────────────────────────────────
  const inputCls = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-fb)]/40';
  const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';

  const renderModal = () => {
    if (!modalKind) return null;
    const title = editingId ? `Edit ${modalKind}` : `Add ${modalKind}`;
    const ModalIcon = modalKind === 'menu' ? Utensils
      : modalKind === 'order' ? ShoppingCart
      : modalKind === 'delivery' ? Truck
      : modalKind === 'preference' ? Heart
      : Wine;
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto">
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-2xl my-8 border border-gray-200 dark:border-slate-700">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2 capitalize">
              <div className="p-2 rounded-lg bg-[var(--color-accent-fb)]/10 text-[var(--color-accent-fb)]">
                <ModalIcon className="w-5 h-5" />
              </div>
              {title}
            </h2>
            <button onClick={closeModal} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            {modalKind === 'menu' && (
              <>
                <div>
                  <label className={labelCls}>Menu Item</label>
                  <select className={inputCls} value={formData.menu_item_id} onChange={e => setField('menu_item_id', e.target.value)}>
                    {menuItemOptions.map(mi => <option key={mi.id} value={mi.id}>{mi.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Outlet</label>
                  <select className={inputCls} value={formData.outlet_id} onChange={e => setField('outlet_id', e.target.value)}>
                    {outletOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input type="checkbox" checked={!!formData.is_available_24h} onChange={e => setField('is_available_24h', e.target.checked)} />
                  Available 24h
                </label>
                {!formData.is_available_24h && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Available From</label>
                      <input type="time" className={inputCls} value={formData.available_from || ''} onChange={e => setField('available_from', e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>Available Until</label>
                      <input type="time" className={inputCls} value={formData.available_until || ''} onChange={e => setField('available_until', e.target.value)} />
                    </div>
                  </div>
                )}
                {!formData.is_available_24h && (
                  <div>
                    <label className={labelCls}>Availability Days</label>
                    <div className="flex flex-wrap gap-2">
                      {DAYS.map(d => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => toggleArrayValue('availability_days', d)}
                          className={`px-3 py-1 rounded-lg text-xs font-medium border ${
                            (formData.availability_days || []).includes(d)
                              ? 'bg-[var(--color-accent-operations)] text-white border-transparent'
                              : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-slate-700'
                          }`}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input type="checkbox" checked={!!formData.is_active} onChange={e => setField('is_active', e.target.checked)} />
                  Active
                </label>
              </>
            )}

            {modalKind === 'order' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Room Number</label>
                    <input className={inputCls} value={formData.room_number || ''} onChange={e => setField('room_number', e.target.value)} placeholder="e.g. 101" />
                  </div>
                  <div>
                    <label className={labelCls}>Guest Name</label>
                    <input className={inputCls} value={formData.guest_name || ''} onChange={e => setField('guest_name', e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Order Type</label>
                    <select className={inputCls} value={formData.order_type} onChange={e => setField('order_type', e.target.value)}>
                      {ORDER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Status</label>
                    <select className={inputCls} value={formData.status} onChange={e => setField('status', e.target.value)}>
                      {ORDER_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
                {formData.order_type === 'Scheduled' && (
                  <div>
                    <label className={labelCls}>Scheduled For</label>
                    <input type="datetime-local" className={inputCls} value={formData.scheduled_for || ''} onChange={e => setField('scheduled_for', e.target.value)} />
                  </div>
                )}
                <div>
                  <label className={labelCls}>Total Amount</label>
                  <input type="number" step="0.01" className={inputCls} value={formData.total_amount ?? 0} onChange={e => setField('total_amount', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Special Instructions</label>
                  <textarea className={inputCls} rows={2} value={formData.special_instructions || ''} onChange={e => setField('special_instructions', e.target.value)} />
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input type="checkbox" checked={!!formData.charge_to_room} onChange={e => setField('charge_to_room', e.target.checked)} />
                  Charge to Room
                </label>
              </>
            )}

            {modalKind === 'delivery' && (
              <>
                <div>
                  <label className={labelCls}>Room Service Order</label>
                  <select className={inputCls} value={formData.room_service_order_id || ''} onChange={e => setField('room_service_order_id', e.target.value)}>
                    {rsOrders.map(o => <option key={o.id} value={o.id}>Room {o.room_number} — {o.guest_name || 'Unknown'}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Assigned To</label>
                  <input className={inputCls} value={formData.assigned_to || ''} onChange={e => setField('assigned_to', e.target.value)} placeholder="Staff name" />
                </div>
                <div>
                  <label className={labelCls}>Status</label>
                  <select className={inputCls} value={formData.status} onChange={e => setField('status', e.target.value)}>
                    {DELIVERY_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Delivery Notes</label>
                  <textarea className={inputCls} rows={2} value={formData.delivery_notes || ''} onChange={e => setField('delivery_notes', e.target.value)} />
                </div>
              </>
            )}

            {modalKind === 'preference' && (
              <>
                <div>
                  <label className={labelCls}>Room Number</label>
                  <input className={inputCls} value={formData.room_number || ''} onChange={e => setField('room_number', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Dietary Restrictions</label>
                  <div className="flex flex-wrap gap-2">
                    {DIET_OPTIONS.map(d => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => toggleArrayValue('dietary_restrictions', d)}
                        className={`px-3 py-1 rounded-lg text-xs font-medium border ${
                          (formData.dietary_restrictions || []).includes(d)
                            ? 'bg-[var(--color-accent-operations)] text-white border-transparent'
                            : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-slate-700'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Preferred Temperature</label>
                  <select className={inputCls} value={formData.preferred_temperature || ''} onChange={e => setField('preferred_temperature', e.target.value)}>
                    <option value="">—</option>
                    {TEMP_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Special Requests</label>
                  <input className={inputCls} value={formData.special_requests || ''} onChange={e => setField('special_requests', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Favorite Items</label>
                  <select multiple className={`${inputCls} h-24`} value={formData.favorite_items || []} onChange={e => setField('favorite_items', Array.from(e.target.selectedOptions).map(o => o.value))}>
                    {menuItemOptions.map(mi => <option key={mi.id} value={mi.id}>{mi.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Disliked Items</label>
                  <select multiple className={`${inputCls} h-24`} value={formData.disliked_items || []} onChange={e => setField('disliked_items', Array.from(e.target.selectedOptions).map(o => o.value))}>
                    {menuItemOptions.map(mi => <option key={mi.id} value={mi.id}>{mi.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Notes</label>
                  <textarea className={inputCls} rows={2} value={formData.notes || ''} onChange={e => setField('notes', e.target.value)} />
                </div>
              </>
            )}

            {modalKind === 'minibar' && (
              <>
                <div>
                  <label className={labelCls}>Room Number</label>
                  <input className={inputCls} value={formData.room_number || ''} onChange={e => setField('room_number', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Menu Item</label>
                  <select className={inputCls} value={formData.menu_item_id || ''} onChange={e => setField('menu_item_id', e.target.value)}>
                    {menuItemOptions.map(mi => <option key={mi.id} value={mi.id}>{mi.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Current Stock</label>
                    <input type="number" className={inputCls} value={formData.current_stock ?? 0} onChange={e => setField('current_stock', e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>Max Stock</label>
                    <input type="number" className={inputCls} value={formData.max_stock ?? 5} onChange={e => setField('max_stock', e.target.value)} />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input type="checkbox" checked={!!formData.is_active} onChange={e => setField('is_active', e.target.checked)} />
                  Active
                </label>
              </>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 mt-5">
            <button onClick={closeModal} className={button.secondary}>Cancel</button>
            <button onClick={handleSave} disabled={saving} className={button.primary}>
              {saving ? 'Saving…' : (editingId ? 'Update' : 'Create')}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const actionCell = (kind: ModalKind, item: any) => (
    <div className="flex items-center gap-2">
      <button onClick={() => openEdit(kind, item)} className={button.ghost} title="Edit">
        <Edit className="w-4 h-4" />
      </button>
      <button onClick={() => handleDelete(kind, item.id)} className={button.ghost} title="Delete">
        <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />
      </button>
    </div>
  );

  const addLabel = subTab === 'preferences' ? 'Preference' : subTab.charAt(0).toUpperCase() + subTab.slice(1);

  // Shared empty-state renderer
  const emptyState = (icon: typeof Utensils, message: string, hint: string) => (
    <div className="text-center py-12 text-gray-500 dark:text-gray-400">
      {(() => { const I = icon; return <I className="w-10 h-10 mx-auto mb-2 opacity-50" />; })()}
      <p className="text-sm">{message}</p>
      <p className="text-xs mt-1">{hint}</p>
    </div>
  );

  return (
    <div className={['accent-fb', layout.sectionStack].join(' ')}>
      {/* Header */}
      <PageHeader
        title="Room Service"
        subtitle="Manage room service menu, orders, delivery, minibar, and guest preferences"
        icon={Utensils}
        actions={
          <>
            <button onClick={() => fetchData()} className={button.secondary}>
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
            <button onClick={() => openCreate(subTab)} className={button.primary}>
              <Plus className="w-4 h-4" />
              Add {addLabel}
            </button>
          </>
        }
      />

      {/* KPI Cards */}
      <div className={layout.kpiGrid}>
        <StatCard title="Active Orders" value={stats.activeOrders} icon={ShoppingCart} tone="accent" interactive />
        <StatCard title="Delivered Today" value={stats.deliveredToday} icon={CheckCircle2} tone="success" interactive />
        <StatCard title="Low Stock Items" value={stats.lowStockItems} icon={AlertTriangle} tone="warning" interactive />
        <StatCard title="Menu Items" value={stats.totalMenuItems} icon={Utensils} tone="info" interactive />
      </div>

      {/* Sub-tabs */}
      <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-x-auto">
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => { setSubTab(t.id); setSearch(''); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all whitespace-nowrap ${
              subTab === t.id
                ? 'bg-white dark:bg-slate-800 text-[var(--color-accent-fb)] shadow-sm font-medium'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
          >
            <t.icon className="w-4 h-4" />
            <span className="text-sm">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Search bar (orders + preferences) */}
      {(subTab === 'orders' || subTab === 'preferences') && (
        <div className="flex flex-wrap items-center gap-4 p-4 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-gray-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search by room or guest..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white w-56"
            />
          </div>
          {search && (
            <button
              onClick={() => setSearch('')}
              className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Menu */}
      {subTab === 'menu' && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6 card-shadow">
          {loading ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">Loading menu items...</div>
          ) : rsMenuItems.length === 0 ? (
            emptyState(Utensils, 'No menu items found', 'Click "Add Menu" to add your first room service menu item')
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Menu Item</th>
                    <th className="px-4 py-3 font-medium">Outlet</th>
                    <th className="px-4 py-3 font-medium">24h Available</th>
                    <th className="px-4 py-3 font-medium">Availability</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {rsMenuItems.map(m => (
                    <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="shrink-0 p-2 rounded-lg bg-[var(--color-accent-fb)]/10 text-[var(--color-accent-fb)]">
                            <Utensils className="w-4 h-4" />
                          </div>
                          <div className="font-medium text-gray-900 dark:text-white">{m.menu_item_name || m.menu_item_id}</div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{m.outlet_name || m.outlet_id}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{m.is_available_24h ? 'Yes' : 'No'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                        {m.is_available_24h ? '24h' : `${m.available_from || '—'} - ${m.available_until || '—'}`}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={m.is_active ? 'success' : 'neutral'}>{m.is_active ? 'Active' : 'Inactive'}</Badge>
                      </td>
                      <td className="px-4 py-3">{actionCell('menu', m)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Orders */}
      {subTab === 'orders' && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6 card-shadow">
          {loading ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">Loading orders...</div>
          ) : filteredOrders.length === 0 ? (
            emptyState(ShoppingCart, 'No orders found', 'Click "Add Orders" to create your first room service order')
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Room</th>
                    <th className="px-4 py-3 font-medium">Guest</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Total</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Charge to Room</th>
                    <th className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {filteredOrders.map(o => (
                    <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="shrink-0 p-2 rounded-lg bg-[var(--color-accent-fb)]/10 text-[var(--color-accent-fb)]">
                            <ShoppingCart className="w-4 h-4" />
                          </div>
                          <div className="font-medium text-gray-900 dark:text-white">{o.room_number}</div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{o.guest_name || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{o.order_type}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400 tabular-nums">{formatAmount(o.total_amount)}</td>
                      <td className="px-4 py-3"><Badge tone={ORDER_STATUS_TONE[o.status]}>{o.status}</Badge></td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{o.charge_to_room ? 'Yes' : 'No'}</td>
                      <td className="px-4 py-3">{actionCell('order', o)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Delivery */}
      {subTab === 'delivery' && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6 card-shadow">
          {loading ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">Loading deliveries...</div>
          ) : rsDeliveries.length === 0 ? (
            emptyState(Truck, 'No deliveries found', 'Click "Add Delivery" to create your first delivery record')
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Order ID</th>
                    <th className="px-4 py-3 font-medium">Assigned To</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Picked Up</th>
                    <th className="px-4 py-3 font-medium">Delivered</th>
                    <th className="px-4 py-3 font-medium">Collected</th>
                    <th className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {rsDeliveries.map(d => (
                    <tr key={d.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="shrink-0 p-2 rounded-lg bg-[var(--color-accent-fb)]/10 text-[var(--color-accent-fb)]">
                            <Truck className="w-4 h-4" />
                          </div>
                          <div className="font-mono text-xs text-gray-900 dark:text-white">{d.room_service_order_id.substring(0, 8)}</div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{d.assigned_to || '—'}</td>
                      <td className="px-4 py-3"><Badge tone={DELIVERY_STATUS_TONE[d.status]}>{d.status}</Badge></td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400 tabular-nums">{d.picked_up_at ? new Date(d.picked_up_at).toLocaleTimeString() : '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400 tabular-nums">{d.delivered_at ? new Date(d.delivered_at).toLocaleTimeString() : '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400 tabular-nums">{d.collected_at ? new Date(d.collected_at).toLocaleTimeString() : '—'}</td>
                      <td className="px-4 py-3">{actionCell('delivery', d)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Minibar */}
      {subTab === 'minibar' && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6 card-shadow">
          {loading ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">Loading minibar inventory...</div>
          ) : minibarInventory.length === 0 ? (
            emptyState(Wine, 'No minibar inventory found', 'Click "Add Minibar" to add your first minibar item')
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Room</th>
                    <th className="px-4 py-3 font-medium">Item</th>
                    <th className="px-4 py-3 font-medium">Stock</th>
                    <th className="px-4 py-3 font-medium">Max Stock</th>
                    <th className="px-4 py-3 font-medium">Last Restocked</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {minibarInventory.slice(0, 50).map(m => (
                    <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="shrink-0 p-2 rounded-lg bg-[var(--color-accent-fb)]/10 text-[var(--color-accent-fb)]">
                            <Wine className="w-4 h-4" />
                          </div>
                          <div className="font-medium text-gray-900 dark:text-white">{m.room_number}</div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{m.menu_item_name || m.menu_item_id}</td>
                      <td className="px-4 py-3">
                        <span className={`tabular-nums ${m.current_stock <= 1 ? 'text-red-600 dark:text-red-400 font-bold' : 'text-slate-600 dark:text-slate-400'}`}>
                          {m.current_stock}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400 tabular-nums">{m.max_stock}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{m.last_restocked_at ? new Date(m.last_restocked_at).toLocaleDateString() : 'Never'}</td>
                      <td className="px-4 py-3"><Badge tone={m.is_active ? 'success' : 'neutral'}>{m.is_active ? 'Active' : 'Inactive'}</Badge></td>
                      <td className="px-4 py-3">{actionCell('minibar', m)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Guest Preferences */}
      {subTab === 'preferences' && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6 card-shadow">
          {loading ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">Loading preferences...</div>
          ) : filteredPreferences.length === 0 ? (
            emptyState(Heart, 'No preferences found', 'Click "Add Preference" to record your first guest preference')
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Room</th>
                    <th className="px-4 py-3 font-medium">Dietary Restrictions</th>
                    <th className="px-4 py-3 font-medium">Temperature</th>
                    <th className="px-4 py-3 font-medium">Special Requests</th>
                    <th className="px-4 py-3 font-medium">Notes</th>
                    <th className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {filteredPreferences.map(p => (
                    <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="shrink-0 p-2 rounded-lg bg-[var(--color-accent-fb)]/10 text-[var(--color-accent-fb)]">
                            <Heart className="w-4 h-4" />
                          </div>
                          <div className="font-medium text-gray-900 dark:text-white">{p.room_number || '—'}</div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                        {p.dietary_restrictions?.length
                          ? <div className="flex flex-wrap gap-1">{p.dietary_restrictions.map(d => <Badge key={d} tone="info">{d}</Badge>)}</div>
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{p.preferred_temperature || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{p.special_requests || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{p.notes || '—'}</td>
                      <td className="px-4 py-3">{actionCell('preference', p)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {renderModal()}
    </div>
  );
}
