/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lost & Found module — docs/Housekeeping Portal new.md §16.
 * Registration (description, category, location, date, finder, photo) and
 * lifecycle backed by the shared lost_found table via /api/hk-portal/lost-found.
 * Statuses mirror the DB CHECK values: Found, Claimed, Donated, Disposed,
 * Returned to Owner, Transferred to Lost Property.
 */

import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Package,
  Search,
  Plus,
  Camera,
  Archive,
  UserSearch,
  RotateCcw,
  Truck,
  Trash2,
  MapPin,
  Calendar,
  User,
  RefreshCw,
  X,
  type LucideIcon,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';

// DB-backed statuses (lost_found.status CHECK constraint).
type Lifecycle = 'Found' | 'Claimed' | 'Donated' | 'Disposed' | 'Returned to Owner' | 'Transferred to Lost Property';
type Category = 'Electronics' | 'Jewelry' | 'Clothing' | 'Documents' | 'Keys' | 'Luggage' | 'Toiletries' | 'Other';

interface LostItem {
  id: string;
  item_name: string;
  item_description?: string;
  item_category?: string;
  found_location: string;
  found_date: string;
  found_time?: string;
  found_by?: string;
  found_by_name?: string;
  room_number?: string;
  status: Lifecycle;
  storage_location?: string;
  photo_url?: string;
  claimed_by?: string;
  claimed_date?: string;
  property_id?: string;
}

const LIFECYCLE_ICON: Record<Lifecycle, LucideIcon> = {
  'Found': Archive,
  'Claimed': UserSearch,
  'Returned to Owner': RotateCcw,
  'Transferred to Lost Property': Truck,
  'Donated': Package,
  'Disposed': Trash2,
};

const LIFECYCLE_TONE: Record<Lifecycle, StatusTone> = {
  'Found': 'neutral',
  'Claimed': 'info',
  'Returned to Owner': 'success',
  'Transferred to Lost Property': 'info',
  'Donated': 'neutral',
  'Disposed': 'danger',
};

const LIFECYCLE_LABEL: Record<Lifecycle, string> = {
  'Found': 'Stored',
  'Claimed': 'Matched',
  'Returned to Owner': 'Returned',
  'Transferred to Lost Property': 'Shipped',
  'Donated': 'Donated',
  'Disposed': 'Disposed',
};

const CATEGORIES: Category[] = ['Electronics', 'Jewelry', 'Clothing', 'Documents', 'Keys', 'Luggage', 'Toiletries', 'Other'];

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

export default function LostAndFoundModule() {
  const { addNotification, currentPropertyId } = useERP();
  const [items, setItems] = useState<LostItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'All' | Lifecycle>('All');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    itemName: '',
    itemDescription: '',
    itemCategory: 'Other' as Category,
    foundLocation: '',
    roomNumber: '',
    foundByName: '',
    dateFound: new Date().toISOString().slice(0, 10),
    storageLocation: '',
  });

  const loadItems = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/hk-portal/lost-found/${currentPropertyId}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const json = await res.json();
      setItems(json.items || []);
    } catch (err) {
      console.error('Error loading lost & found:', err);
      addNotification('Failed to load lost & found items', 'warning', 'Housekeeping');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, addNotification]);

  useEffect(() => { loadItems(); }, [loadItems]);

  const filtered = useMemo(
    () =>
      items.filter(i => {
        const matchesFilter = filter === 'All' || i.status === filter;
        const s = search.toLowerCase();
        const matchesSearch =
          (i.item_name || '').toLowerCase().includes(s) ||
          (i.item_description || '').toLowerCase().includes(s) ||
          (i.found_location || '').toLowerCase().includes(s) ||
          (i.found_by_name || '').toLowerCase().includes(s) ||
          (i.room_number || '').toLowerCase().includes(s) ||
          (i.claimed_by || '').toLowerCase().includes(s) ||
          (i.id || '').toLowerCase().includes(s);
        return matchesFilter && matchesSearch;
      }),
    [items, filter, search]
  );

  const advance = async (id: string, next: Lifecycle) => {
    const update: Record<string, unknown> = { status: next };
    if (next === 'Claimed' || next === 'Returned to Owner') {
      update.claimed_date = new Date().toISOString().slice(0, 10);
    }
    try {
      const res = await fetch(`/api/hk-portal/lost-found/${id}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify(update),
      });
      if (!res.ok) throw new Error(`Failed to update (${res.status})`);
      addNotification(`Lost item ${id} → ${LIFECYCLE_LABEL[next]}`, 'info', 'Housekeeping');
      loadItems();
    } catch (err) {
      console.error(err);
      addNotification('Failed to update item status', 'warning', 'Housekeeping');
    }
  };

  const submitItem = async () => {
    if (!currentPropertyId) {
      addNotification('No active property selected', 'warning', 'Housekeeping');
      return;
    }
    if (!form.itemName.trim() || !form.foundLocation.trim() || !form.foundByName.trim()) {
      addNotification('Item name, found location, and finder are required', 'warning', 'Housekeeping');
      return;
    }
    try {
      const res = await fetch('/api/hk-portal/lost-found', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          propertyId: currentPropertyId,
          itemName: form.itemName.trim(),
          itemDescription: form.itemDescription.trim() || undefined,
          itemCategory: form.itemCategory,
          foundLocation: form.foundLocation.trim(),
          foundBy: form.foundByName.trim(),
          foundByName: form.foundByName.trim(),
          roomNumber: form.roomNumber.trim() || undefined,
          dateFound: form.dateFound,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to register (${res.status})`);
      }
      addNotification('Lost & found item registered', 'success', 'Housekeeping');
      setShowForm(false);
      setForm({
        itemName: '', itemDescription: '', itemCategory: 'Other',
        foundLocation: '', roomNumber: '', foundByName: '',
        dateFound: new Date().toISOString().slice(0, 10), storageLocation: '',
      });
      loadItems();
    } catch (err: any) {
      addNotification(err.message || 'Failed to register item', 'warning', 'Housekeeping');
    }
  };

  const counts = (['Found', 'Claimed', 'Returned to Owner', 'Transferred to Lost Property', 'Disposed'] as Lifecycle[]).map(l => ({
    label: LIFECYCLE_LABEL[l], value: items.filter(i => i.status === l).length, icon: LIFECYCLE_ICON[l], tone: LIFECYCLE_TONE[l],
  }));

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Lost & Found"
        subtitle="Item registration & lifecycle management."
        icon={Package}
        actions={
          <div className="flex gap-2">
            <button onClick={loadItems} disabled={loading} className={button.ghost + ' text-xs'}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button onClick={() => setShowForm(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> Register Item
            </button>
          </div>
        }
      />

      <div className={layout.kpiGrid}>
        {counts.map(t => (
          <StatCard key={t.label} title={t.label} value={t.value} icon={t.icon} tone={t.tone} />
        ))}
      </div>

      <SectionCard pad="md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap">
            {(['All', 'Found', 'Claimed', 'Returned to Owner', 'Transferred to Lost Property', 'Disposed'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${filter === f ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {f === 'All' ? 'All' : LIFECYCLE_LABEL[f]}
              </button>
            ))}
          </div>
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input placeholder="Search item, location, owner..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(i => {
          const Icon = LIFECYCLE_ICON[i.status] || Archive;
          const tone = LIFECYCLE_TONE[i.status] || 'neutral';
          return (
            <div key={i.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 card-shadow smooth-transition overflow-hidden">
              <div className={`h-1 ${statusTone[tone].dot}`} />
              <div className="p-5">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-2">
                    <div className={`p-2 rounded-xl ${statusTone[tone].soft}`}><Package className="w-4 h-4" /></div>
                    <div>
                      <h3 className="text-sm font-bold text-gray-900 dark:text-white leading-tight">{i.item_name}</h3>
                      <p className="text-xs text-gray-500">{i.id}</p>
                    </div>
                  </div>
                  {i.photo_url && <Camera className="w-3.5 h-3.5 text-gray-400" />}
                </div>

                <div className="space-y-1.5 text-xs mb-3">
                  <p className="flex items-center gap-1.5 text-gray-500"><Badge tone="neutral">{i.item_category || 'Other'}</Badge></p>
                  <p className="flex items-center gap-1.5 text-gray-700 dark:text-gray-300"><MapPin className="w-3 h-3 text-gray-400" /> {i.found_location}</p>
                  <p className="flex items-center gap-1.5 text-gray-700 dark:text-gray-300"><Calendar className="w-3 h-3 text-gray-400" /> {i.found_date}</p>
                  <p className="flex items-center gap-1.5 text-gray-700 dark:text-gray-300"><User className="w-3 h-3 text-gray-400" /> Finder: {i.found_by_name || i.found_by || '—'}</p>
                  {i.room_number && <p className="flex items-center gap-1.5 text-gray-700 dark:text-gray-300"><MapPin className="w-3 h-3 text-gray-400" /> Room {i.room_number}</p>}
                  {i.claimed_by && <p className="flex items-center gap-1.5 text-[var(--color-accent-operations)]"><UserSearch className="w-3 h-3" /> Claimed by: {i.claimed_by}</p>}
                </div>

                <div className="pt-3 border-t border-gray-100 dark:border-slate-700 flex items-center justify-between">
                  <span className={`flex items-center gap-1.5 text-xs font-bold uppercase ${statusTone[tone].text}`}><Icon className="w-3.5 h-3.5" /> {LIFECYCLE_LABEL[i.status]}</span>
                  <div className="flex gap-1.5">
                    {i.status === 'Found' && (
                      <button onClick={() => advance(i.id, 'Claimed')} className={button.ghost + ' text-xs'}>Match</button>
                    )}
                    {i.status === 'Claimed' && (
                      <>
                        <button onClick={() => advance(i.id, 'Returned to Owner')} className={button.ghost + ' text-xs'}>Return</button>
                        <button onClick={() => advance(i.id, 'Transferred to Lost Property')} className={button.ghost + ' text-xs'}>Ship</button>
                      </>
                    )}
                    {(i.status === 'Found' || i.status === 'Claimed') && (
                      <button onClick={() => advance(i.id, 'Disposed')} className={button.ghost + ' text-xs'}>Dispose</button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {filtered.length === 0 && <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 p-8 rounded-2xl text-center text-sm text-gray-500">{loading ? 'Loading…' : 'No items match the filters.'}</div>}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-slate-700">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Register Lost & Found Item</h2>
              <button onClick={() => setShowForm(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Item Name *</label>
                <input value={form.itemName} onChange={e => setForm({ ...form, itemName: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Description</label>
                <textarea value={form.itemDescription} onChange={e => setForm({ ...form, itemDescription: e.target.value })} rows={2} className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Category</label>
                  <select value={form.itemCategory} onChange={e => setForm({ ...form, itemCategory: e.target.value as Category })} className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white">
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Room (optional)</label>
                  <input value={form.roomNumber} onChange={e => setForm({ ...form, roomNumber: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Found Location *</label>
                <input value={form.foundLocation} onChange={e => setForm({ ...form, foundLocation: e.target.value })} placeholder="e.g. Room 204, Lobby, Spa" className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Finder *</label>
                  <input value={form.foundByName} onChange={e => setForm({ ...form, foundByName: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Date Found</label>
                  <input type="date" value={form.dateFound} onChange={e => setForm({ ...form, dateFound: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 p-5 border-t border-gray-200 dark:border-slate-700">
              <button onClick={() => setShowForm(false)} className={button.ghost}>Cancel</button>
              <button onClick={submitItem} className={button.primary}>Register</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
