/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import { useState, useEffect, useMemo } from 'react';
import {
  Users,
  Heart,
  AlertCircle,
  Star,
  Award,
  MessageSquare,
  TrendingUp,
  Search,
  Filter,
  Plus,
  History,
  Gift,
  ThumbsUp,
  ChevronRight,
  X,
  Edit,
  Trash2,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { PageHeader, Card, SectionCard, Badge } from '../../components/FrontOffice/ui';
import { button as buttonStyles } from '../../components/FrontOffice/brandTheme';
import StatCard from '../../components/FrontOffice/StatCard';

interface GuestProfile {
  id: string;
  guest_name: string;
  room_number: string | null;
  check_in_date: string;
  check_out_date: string | null;
  vip_tier: 'none' | 'silver' | 'gold' | 'platinum';
  loyalty_points: number;
  total_visits: number;
  total_spent: number;
}

interface DiningHistory {
  id: string;
  guest_id: string;
  date: string;
  outlet: string;
  party_size: number;
  table_number: string;
  items_ordered: string[];
  total_amount: number;
  rating: number | null;
  notes: string;
}

interface FavoriteItem {
  id: string;
  guest_id: string;
  item_name: string;
  category: string;
  outlet: string;
  times_ordered: number;
  last_ordered: string;
  notes: string;
}

interface AllergyDietary {
  id: string;
  guest_id: string;
  type: 'allergy' | 'dietary';
  name: string;
  severity: 'mild' | 'moderate' | 'severe';
  notes: string;
}

interface Feedback {
  id: string;
  guest_id: string;
  date: string;
  outlet: string;
  type: 'compliment' | 'complaint' | 'suggestion';
  rating: number | null;
  category: 'food' | 'service' | 'ambiance' | 'other' | 'menu';
  description: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
}

interface Overview {
  totalGuests: number;
  vipGuests: number;
  loyaltyPointsIssued: number;
  avgSatisfaction: number;
}

const API_BASE = '/api/fb/guest-experience';

export default function GuestExperienceCRM() {
  const { formatAmount, addNotification } = useERP();
  const [activeTab, setActiveTab] = useState<'dining-history' | 'favorites' | 'allergies' | 'vip' | 'loyalty' | 'feedback'>('dining-history');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<'favorite' | 'allergy' | 'feedback' | null>(null);
  const [editingItem, setEditingItem] = useState<any>(null);

  const [overview, setOverview] = useState<Overview>({
    totalGuests: 0,
    vipGuests: 0,
    loyaltyPointsIssued: 0,
    avgSatisfaction: 0,
  });

  // Data state
  const [guests, setGuests] = useState<GuestProfile[]>([]);
  const [diningHistory, setDiningHistory] = useState<DiningHistory[]>([]);
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [allergies, setAllergies] = useState<AllergyDietary[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);

  // Filter state
  const [diningOutlet, setDiningOutlet] = useState('all');
  const [favoriteCategory, setFavoriteCategory] = useState('all');
  const [allergyType, setAllergyType] = useState('all');
  const [feedbackType, setFeedbackType] = useState('all');
  const [feedbackStatus, setFeedbackStatus] = useState('all');

  // Modal form state
  const [form, setForm] = useState<Record<string, any>>({});

  const authHeaders = (): Record<string, string> => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  };

  const api = async (path: string, method: string = 'GET', body?: any) => {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: authHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.status === 204 ? undefined : res.json();
  };

  const loadOverview = async () => {
    try {
      const data = await api('');
      setOverview(data || { totalGuests: 0, vipGuests: 0, loyaltyPointsIssued: 0, avgSatisfaction: 0 });
    } catch (error) {
      console.error('Overview fetch error:', error);
      addNotification('Failed to load overview', 'warning', 'F&B');
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [p, d, f, a, fb] = await Promise.all([
        api('/profiles'),
        api('/dining-history'),
        api('/favorites'),
        api('/allergies'),
        api('/feedback'),
      ]);
      setGuests(p || []);
      setDiningHistory(d || []);
      setFavorites(f || []);
      setAllergies(a || []);
      setFeedback(fb || []);
    } catch (error) {
      console.error('FB guest experience fetch error:', error);
      addNotification('Failed to load guest data', 'warning', 'F&B');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
    loadData();
  }, []);

  // Reload data when a tab is re-focused (simple approach)
  const refreshTab = async () => {
    try {
      if (activeTab === 'dining-history') setDiningHistory(await api('/dining-history'));
      if (activeTab === 'favorites') setFavorites(await api('/favorites'));
      if (activeTab === 'allergies') setAllergies(await api('/allergies'));
      if (activeTab === 'feedback') setFeedback(await api('/feedback'));
      if (activeTab === 'vip' || activeTab === 'loyalty') await loadOverview();
    } catch (error) {
      console.error('Tab refresh error:', error);
    }
  };

  useEffect(() => {
    if (!loading) refreshTab();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, loading]);

  const openModal = (type: 'favorite' | 'allergy' | 'feedback', item: any = null) => {
    setModalType(type);
    setEditingItem(item);
    if (type === 'favorite') {
      setForm(item ? {
        guest_id: item.guest_id,
        item_name: item.item_name,
        category: item.category,
        outlet: item.outlet,
        times_ordered: item.times_ordered,
        last_ordered: item.last_ordered,
        notes: item.notes,
      } : { guest_id: guests[0]?.id || '', item_name: '', category: 'Main Course', outlet: 'Main Restaurant', times_ordered: 1, last_ordered: new Date().toISOString().slice(0, 10), notes: '' });
    } else if (type === 'allergy') {
      setForm(item ? {
        guest_id: item.guest_id,
        type: item.type,
        name: item.name,
        severity: item.severity,
        notes: item.notes,
      } : { guest_id: guests[0]?.id || '', type: 'allergy', name: '', severity: 'mild', notes: '' });
    } else if (type === 'feedback') {
      setForm(item ? {
        guest_id: item.guest_id,
        type: item.type,
        category: item.category,
        rating: item.rating,
        outlet: item.outlet,
        date: item.date,
        status: item.status,
        description: item.description,
      } : { guest_id: guests[0]?.id || '', type: 'compliment', category: 'service', rating: '', outlet: 'Main Restaurant', date: new Date().toISOString().slice(0, 10), status: 'open', description: '' });
    }
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setModalType(null);
    setEditingItem(null);
    setForm({});
  };

  const handleSave = async () => {
    if (!modalType) return;
    try {
      if (modalType === 'favorite') {
        if (editingItem) {
          await api(`/favorites/${editingItem.id}`, 'PUT', form);
          addNotification('Favorite updated', 'success', 'F&B');
        } else {
          await api('/favorites', 'POST', form);
          addNotification('Favorite added', 'success', 'F&B');
        }
        setFavorites(await api('/favorites'));
      } else if (modalType === 'allergy') {
        if (editingItem) {
          await api(`/allergies/${editingItem.id}`, 'PUT', form);
          addNotification('Allergy / dietary restriction updated', 'success', 'F&B');
        } else {
          await api('/allergies', 'POST', form);
          addNotification('Allergy / dietary restriction added', 'success', 'F&B');
        }
        setAllergies(await api('/allergies'));
      } else if (modalType === 'feedback') {
        const body = { ...form, rating: form.rating === '' || form.rating == null ? null : Number(form.rating) };
        if (editingItem) {
          await api(`/feedback/${editingItem.id}`, 'PUT', body);
          addNotification('Feedback updated', 'success', 'F&B');
        } else {
          await api('/feedback', 'POST', body);
          addNotification('Feedback added', 'success', 'F&B');
        }
        setFeedback(await api('/feedback'));
      }
      closeModal();
      loadOverview();
    } catch (error) {
      console.error('Save error:', error);
      addNotification('Failed to save', 'warning', 'F&B');
    }
  };

  const handleDelete = async (type: 'favorites' | 'allergies' | 'feedback', id: string) => {
    try {
      await api(`/${type}/${id}`, 'DELETE');
      addNotification('Item deleted', 'success', 'F&B');
      if (type === 'favorites') setFavorites(await api('/favorites'));
      if (type === 'allergies') setAllergies(await api('/allergies'));
      if (type === 'feedback') setFeedback(await api('/feedback'));
      loadOverview();
    } catch (error) {
      console.error('Delete error:', error);
      addNotification('Failed to delete', 'warning', 'F&B');
    }
  };

  const filteredDiningHistory = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return diningHistory.filter((h) => {
      const guest = guests.find((g) => g.id === h.guest_id);
      const matchesSearch =
        !term ||
        (guest?.guest_name || '').toLowerCase().includes(term) ||
        (guest?.room_number || '').toLowerCase().includes(term) ||
        h.outlet.toLowerCase().includes(term) ||
        h.items_ordered.join(' ').toLowerCase().includes(term) ||
        (h.notes || '').toLowerCase().includes(term);
      const matchesOutlet = diningOutlet === 'all' || h.outlet === diningOutlet;
      return matchesSearch && matchesOutlet;
    });
  }, [diningHistory, guests, searchTerm, diningOutlet]);

  const filteredFavorites = useMemo(() => {
    return favoriteCategory === 'all'
      ? favorites
      : favorites.filter((f) => f.category === favoriteCategory);
  }, [favorites, favoriteCategory]);

  const filteredAllergies = useMemo(() => {
    return allergyType === 'all'
      ? allergies
      : allergies.filter((a) => a.type === allergyType);
  }, [allergies, allergyType]);

  const filteredFeedback = useMemo(() => {
    return feedback.filter((fb) => {
      const matchesType = feedbackType === 'all' || fb.type === feedbackType;
      const matchesStatus = feedbackStatus === 'all' || fb.status === feedbackStatus;
      return matchesType && matchesStatus;
    });
  }, [feedback, feedbackType, feedbackStatus]);

  const uniqueOutlets = useMemo(() => Array.from(new Set(diningHistory.map((h) => h.outlet))), [diningHistory]);
  const uniqueCategories = useMemo(() => Array.from(new Set(favorites.map((f) => f.category))), [favorites]);

  const tabs = [
    { id: 'dining-history', label: 'Dining History', icon: History },
    { id: 'favorites', label: 'Favorites', icon: Heart },
    { id: 'allergies', label: 'Allergies & Diet', icon: AlertCircle },
    { id: 'vip', label: 'VIP Recognition', icon: Award },
    { id: 'loyalty', label: 'Loyalty Points', icon: Star },
    { id: 'feedback', label: 'Feedback', icon: MessageSquare },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Guest Experience & CRM"
        subtitle="Guest dining profiles, preferences, and loyalty management"
        icon={Users}
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Guests" value={overview.totalGuests.toLocaleString()} change="+12%" icon={Users} color="blue" />
        <StatCard title="VIP Guests" value={overview.vipGuests} change="+3" icon={Award} color="amber" />
        <StatCard title="Loyalty Points Issued" value={`${(overview.loyaltyPointsIssued / 1000).toFixed(1)}K`} change="+5.1K" icon={Star} color="green" />
        <StatCard title="Avg Satisfaction" value={overview.avgSatisfaction.toFixed(1)} change="+0.2" icon={ThumbsUp} color="purple" />
      </div>

      {/* Tabs */}
      <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
              activeTab === tab.id
                ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            <span className="text-sm font-medium">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Content Area */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
        {activeTab === 'dining-history' && (
          <SectionCard title="Dining History" subtitle="View complete dining history for each guest across all outlets">
            <div className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-gray-200 dark:border-slate-700 mb-4">
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search by guest name, room, or outlet..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white w-64"
                />
              </div>
              <select
                value={diningOutlet}
                onChange={(e) => setDiningOutlet(e.target.value)}
                className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
              >
                <option value="all">All Outlets</option>
                {uniqueOutlets.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Guest</th>
                    <th className="px-4 py-3 font-medium">Room</th>
                    <th className="px-4 py-3 font-medium">Outlet</th>
                    <th className="px-4 py-3 font-medium">Party Size</th>
                    <th className="px-4 py-3 font-medium">Table</th>
                    <th className="px-4 py-3 font-medium">Items</th>
                    <th className="px-4 py-3 font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium">Rating</th>
                    <th className="px-4 py-3 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {loading ? (
                    <tr><td colSpan={10} className="px-4 py-6 text-center text-slate-500">Loading...</td></tr>
                  ) : filteredDiningHistory.length === 0 ? (
                    <tr><td colSpan={10} className="px-4 py-6 text-center text-slate-500">No dining history found.</td></tr>
                  ) : (
                    filteredDiningHistory.map((history) => (
                      <tr key={history.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{history.date}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{guests.find(g => g.id === history.guest_id)?.guest_name || 'Unknown'}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{guests.find(g => g.id === history.guest_id)?.room_number || '—'}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{history.outlet}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{history.party_size}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{history.table_number}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{history.items_ordered.join(', ')}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{formatAmount(history.total_amount)}</td>
                        <td className="px-4 py-3">
                          {history.rating ? (
                            <div className="flex items-center gap-1">
                              <Star className="w-4 h-4 text-yellow-500 fill" />
                              <span className="text-slate-600 dark:text-slate-400">{history.rating}</span>
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{history.notes}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}

        {activeTab === 'favorites' && (
          <SectionCard title="Favorite Dishes & Preferences" subtitle="Track favorite dishes, drinks, and dining preferences">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <select
                  value={favoriteCategory}
                  onChange={(e) => setFavoriteCategory(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                >
                  <option value="all">All Categories</option>
                  {uniqueCategories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => openModal('favorite')}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm"
              >
                <Plus className="w-4 h-4" /> Add Favorite
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {loading ? (
                <p className="text-slate-500 text-sm col-span-full">Loading...</p>
              ) : filteredFavorites.length === 0 ? (
                <p className="text-slate-500 text-sm col-span-full">No favorites found.</p>
              ) : (
                filteredFavorites.map((fav) => (
                  <Card key={fav.id} className="p-4 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-600 transition">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Heart className="w-5 h-5 text-red-500 fill" />
                        <div>
                          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{fav.item_name}</h3>
                          <p className="text-xs text-slate-500">{fav.category} • {fav.outlet}</p>
                        </div>
                      </div>
                      <Badge tone="neutral">{fav.times_ordered} orders</Badge>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">{fav.notes}</p>
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Last: {fav.last_ordered}</span>
                      <div className="flex items-center gap-1">
                        <button onClick={() => openModal('favorite', fav)} className={buttonStyles.ghost}><Edit className="w-3 h-3" /></button>
                        <button onClick={() => handleDelete('favorites', fav.id)} className={buttonStyles.ghost}><Trash2 className="w-3 h-3" /></button>
                      </div>
                    </div>
                  </Card>
                ))
              )}
            </div>
          </SectionCard>
        )}

        {activeTab === 'allergies' && (
          <SectionCard title="Allergies & Dietary Restrictions" subtitle="Manage guest allergies, dietary restrictions, and special requirements">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <select
                  value={allergyType}
                  onChange={(e) => setAllergyType(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                >
                  <option value="all">All Types</option>
                  <option value="allergy">Allergies</option>
                  <option value="dietary">Dietary Restrictions</option>
                </select>
              </div>
              <button
                onClick={() => openModal('allergy')}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm"
              >
                <Plus className="w-4 h-4" /> Add Allergy/Diet
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Guest</th>
                    <th className="px-4 py-3 font-medium">Room</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Severity</th>
                    <th className="px-4 py-3 font-medium">Notes</th>
                    <th className="px-4 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {loading ? (
                    <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">Loading...</td></tr>
                  ) : filteredAllergies.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">No allergies or dietary restrictions found.</td></tr>
                  ) : (
                    filteredAllergies.map((allergy) => (
                      <tr key={allergy.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{guests.find(g => g.id === allergy.guest_id)?.guest_name || 'Unknown'}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{guests.find(g => g.id === allergy.guest_id)?.room_number || '—'}</td>
                        <td className="px-4 py-3">
                          <Badge tone={allergy.type === 'allergy' ? 'danger' : 'neutral'}>
                            {allergy.type === 'allergy' ? 'Allergy' : 'Dietary'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{allergy.name}</td>
                        <td className="px-4 py-3">
                          <Badge tone={allergy.severity === 'severe' ? 'danger' : allergy.severity === 'moderate' ? 'warning' : 'neutral'}>
                            {allergy.severity}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{allergy.notes}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button onClick={() => openModal('allergy', allergy)} className={buttonStyles.ghost}><Edit className="w-3 h-3" /></button>
                            <button onClick={() => handleDelete('allergies', allergy.id)} className={buttonStyles.ghost}><Trash2 className="w-3 h-3" /></button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}

        {activeTab === 'vip' && (
          <SectionCard title="VIP Recognition" subtitle="Identify and manage VIP guests with special recognition and service">
            <div className="space-y-4">
              {loading ? (
                <p className="text-slate-500 text-sm">Loading...</p>
              ) : guests.filter(g => g.vip_tier !== 'none').length === 0 ? (
                <p className="text-slate-500 text-sm">No VIP guests found.</p>
              ) : (
                guests.filter(g => g.vip_tier !== 'none').map((guest) => (
                  <Card key={guest.id} className="p-4 border border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-white font-bold">
                          {guest.guest_name.split(' ').map(n => n[0]).join('')}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{guest.guest_name}</h3>
                            <Badge tone={guest.vip_tier === 'platinum' ? 'success' : guest.vip_tier === 'gold' ? 'warning' : 'neutral'}>
                              {guest.vip_tier.toUpperCase()}
                            </Badge>
                          </div>
                          <p className="text-xs text-slate-500">Room {guest.room_number} • {guest.total_visits} visits • {formatAmount(guest.total_spent)} total</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">{guest.loyalty_points} pts</p>
                        <p className="text-xs text-slate-500">Loyalty Points</p>
                      </div>
                    </div>
                  </Card>
                ))
              )}
            </div>
          </SectionCard>
        )}

        {activeTab === 'loyalty' && (
          <SectionCard title="Loyalty Points" subtitle="Manage loyalty points, rewards, and personalized offers">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <Card className="p-4 border border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-green-100 dark:bg-green-900 rounded-lg flex items-center justify-center">
                    <Star className="w-5 h-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Points Issued (MTD)</p>
                    <p className="text-lg font-bold text-slate-900 dark:text-white">{overview.loyaltyPointsIssued.toLocaleString()}</p>
                  </div>
                </div>
              </Card>
              <Card className="p-4 border border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
                    <Gift className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Active Members</p>
                    <p className="text-lg font-bold text-slate-900 dark:text-white">{overview.totalGuests}</p>
                  </div>
                </div>
              </Card>
              <Card className="p-4 border border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900 rounded-lg flex items-center justify-center">
                    <TrendingUp className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Avg Satisfaction</p>
                    <p className="text-lg font-bold text-slate-900 dark:text-white">{overview.avgSatisfaction.toFixed(1)}</p>
                  </div>
                </div>
              </Card>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Guest</th>
                    <th className="px-4 py-3 font-medium">Room</th>
                    <th className="px-4 py-3 font-medium">VIP Tier</th>
                    <th className="px-4 py-3 font-medium">Points Balance</th>
                    <th className="px-4 py-3 font-medium">Total Visits</th>
                    <th className="px-4 py-3 font-medium">Total Spent</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {loading ? (
                    <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Loading...</td></tr>
                  ) : guests.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No guests found.</td></tr>
                  ) : (
                    guests.map((guest) => (
                      <tr key={guest.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{guest.guest_name}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{guest.room_number || '—'}</td>
                        <td className="px-4 py-3">
                          <Badge tone={guest.vip_tier === 'platinum' ? 'success' : guest.vip_tier === 'gold' ? 'warning' : 'neutral'}>
                            {guest.vip_tier === 'none' ? 'Standard' : guest.vip_tier.toUpperCase()}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{guest.loyalty_points} pts</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{guest.total_visits}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{formatAmount(guest.total_spent)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}

        {activeTab === 'feedback' && (
          <SectionCard title="Feedback & Service Recovery" subtitle="Track guest feedback, complaints, and satisfaction scores">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <select
                  value={feedbackType}
                  onChange={(e) => setFeedbackType(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                >
                  <option value="all">All Types</option>
                  <option value="compliment">Compliments</option>
                  <option value="complaint">Complaints</option>
                  <option value="suggestion">Suggestions</option>
                </select>
                <select
                  value={feedbackStatus}
                  onChange={(e) => setFeedbackStatus(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                >
                  <option value="all">All Status</option>
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
              <button
                onClick={() => openModal('feedback')}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm"
              >
                <Plus className="w-4 h-4" /> Add Feedback
              </button>
            </div>
            <div className="space-y-4">
              {loading ? (
                <p className="text-slate-500 text-sm">Loading...</p>
              ) : filteredFeedback.length === 0 ? (
                <p className="text-slate-500 text-sm">No feedback found.</p>
              ) : (
                filteredFeedback.map((fb) => (
                  <Card key={fb.id} className="p-4 border border-slate-200 dark:border-slate-700">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <Badge tone={fb.type === 'compliment' ? 'success' : fb.type === 'complaint' ? 'danger' : 'neutral'}>
                          {fb.type}
                        </Badge>
                        <span className="text-xs text-slate-500">{fb.date}</span>
                        <span className="text-xs text-slate-500">{fb.outlet}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {fb.rating && (
                          <div className="flex items-center gap-1">
                            <Star className="w-4 h-4 text-yellow-500 fill" />
                            <span className="text-sm text-slate-600 dark:text-slate-400">{fb.rating}</span>
                          </div>
                        )}
                        <Badge tone={fb.status === 'resolved' ? 'success' : fb.status === 'in_progress' ? 'warning' : 'neutral'}>
                          {fb.status.replace('_', ' ')}
                        </Badge>
                      </div>
                    </div>
                    <div className="mb-2">
                      <p className="text-sm text-slate-900 dark:text-white">{fb.description}</p>
                      <p className="text-xs text-slate-500 mt-1">
                        {guests.find(g => g.id === fb.guest_id)?.guest_name || 'Unknown Guest'} • {fb.category}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => openModal('feedback', fb)} className={buttonStyles.ghost}><Edit className="w-3 h-3" /></button>
                      <button onClick={() => handleDelete('feedback', fb.id)} className={buttonStyles.ghost}><Trash2 className="w-3 h-3" /></button>
                    </div>
                  </Card>
                ))
              )}
            </div>
          </SectionCard>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                {editingItem ? 'Edit' : 'Add'} {modalType === 'favorite' && 'Favorite'}
                {modalType === 'allergy' && 'Allergy/Dietary Restriction'}
                {modalType === 'feedback' && 'Feedback'}
              </h2>
              <button onClick={closeModal} className={buttonStyles.ghost}>
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalType === 'favorite' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Guest</label>
                  <select
                    value={form.guest_id || ''}
                    onChange={(e) => setForm({ ...form, guest_id: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                  >
                    {guests.map(g => (
                      <option key={g.id} value={g.id}>{g.guest_name} (Room {g.room_number || '—'})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Item Name</label>
                  <input type="text" value={form.item_name || ''} onChange={(e) => setForm({ ...form, item_name: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" placeholder="e.g., Grilled Salmon" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Category</label>
                  <select value={form.category || ''} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white">
                    <option>Main Course</option>
                    <option>Appetizer</option>
                    <option>Cocktail</option>
                    <option>Dessert</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Outlet</label>
                  <select value={form.outlet || ''} onChange={(e) => setForm({ ...form, outlet: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white">
                    <option>Main Restaurant</option>
                    <option>Fine Dining</option>
                    <option>Main Bar</option>
                    <option>Room Service</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Notes</label>
                  <textarea value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" rows={2} placeholder="Any special notes..." />
                </div>
              </div>
            )}

            {modalType === 'allergy' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Guest</label>
                  <select value={form.guest_id || ''} onChange={(e) => setForm({ ...form, guest_id: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white">
                    {guests.map(g => (
                      <option key={g.id} value={g.id}>{g.guest_name} (Room {g.room_number || '—'})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Type</label>
                  <select value={form.type || ''} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white">
                    <option value="allergy">Allergy</option>
                    <option value="dietary">Dietary Restriction</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Name</label>
                  <input type="text" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" placeholder="e.g., Shellfish, Gluten" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Severity</label>
                  <select value={form.severity || ''} onChange={(e) => setForm({ ...form, severity: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white">
                    <option value="mild">Mild</option>
                    <option value="moderate">Moderate</option>
                    <option value="severe">Severe</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Notes</label>
                  <textarea value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" rows={2} placeholder="Any special notes..." />
                </div>
              </div>
            )}

            {modalType === 'feedback' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Guest</label>
                  <select value={form.guest_id || ''} onChange={(e) => setForm({ ...form, guest_id: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white">
                    {guests.map(g => (
                      <option key={g.id} value={g.id}>{g.guest_name} (Room {g.room_number || '—'})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Type</label>
                  <select value={form.type || ''} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white">
                    <option value="compliment">Compliment</option>
                    <option value="complaint">Complaint</option>
                    <option value="suggestion">Suggestion</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Category</label>
                  <select value={form.category || ''} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white">
                    <option value="food">Food</option>
                    <option value="service">Service</option>
                    <option value="ambiance">Ambiance</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Rating</label>
                  <select value={form.rating == null ? '' : String(form.rating)} onChange={(e) => setForm({ ...form, rating: e.target.value === '' ? '' : Number(e.target.value) })} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white">
                    <option value="">No Rating</option>
                    <option value={1}>1 Star</option>
                    <option value={2}>2 Stars</option>
                    <option value={3}>3 Stars</option>
                    <option value={4}>4 Stars</option>
                    <option value={5}>5 Stars</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Outlet</label>
                  <input type="text" value={form.outlet || ''} onChange={(e) => setForm({ ...form, outlet: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" placeholder="Outlet name" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Description</label>
                  <textarea value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" rows={3} placeholder="Describe the feedback..." />
                </div>
                {editingItem && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Status</label>
                    <select value={form.status || ''} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white">
                      <option value="open">Open</option>
                      <option value="in_progress">In Progress</option>
                      <option value="resolved">Resolved</option>
                      <option value="closed">Closed</option>
                    </select>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-6">
              <button onClick={closeModal} className="px-4 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700">
                Cancel
              </button>
              <button onClick={handleSave} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                Save
              </button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
