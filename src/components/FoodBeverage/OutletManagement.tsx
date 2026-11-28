/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import { useState, useEffect } from 'react';
import {
  Building2,
  Clock,
  Settings,
  Plus,
  Edit,
  Trash2,
  Utensils,
  RefreshCw,
  X,
  Store,
  ChefHat,
  Monitor,
  Search
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import KitchenManagement, { type KitchenManagementAPI } from './KitchenManagement';
import POSOutletManagement from '../Admin/POSOutletManagement';

interface Outlet {
  id: string;
  name: string;
  type: 'Restaurant' | 'Bar' | 'RoomService' | 'Banquet' | 'Minibar';
  operating_hours: Record<string, { open: string; close: string }> | null;
  revenue_center_code: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface OutletStatistics {
  totalOutlets: number;
  activeOutlets: number;
  outletTypes: number;
  configuredOutlets: number;
}

interface OperatingHours {
  monday: { open: string; close: string };
  tuesday: { open: string; close: string };
  wednesday: { open: string; close: string };
  thursday: { open: string; close: string };
  friday: { open: string; close: string };
  saturday: { open: string; close: string };
  sunday: { open: string; close: string };
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
const DAY_LABELS = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday'
};

// Helper function to safely convert operating hours from DB to proper type
function toOperatingHours(hours: Record<string, { open: string; close: string }> | null): OperatingHours {
  const defaultHours: OperatingHours = {
    monday: { open: '07:00', close: '22:00' },
    tuesday: { open: '07:00', close: '22:00' },
    wednesday: { open: '07:00', close: '22:00' },
    thursday: { open: '07:00', close: '22:00' },
    friday: { open: '07:00', close: '22:00' },
    saturday: { open: '07:00', close: '22:00' },
    sunday: { open: '07:00', close: '22:00' }
  };

  if (!hours) return defaultHours;

  return DAYS.reduce((acc, day) => {
    acc[day] = hours[day] || { open: '07:00', close: '22:00' };
    return acc;
  }, {} as OperatingHours);
}

export default function OutletManagement() {
  const { addNotification } = useERP();
  const [activeSubTab, setActiveSubTab] = useState<'outlets' | 'kitchen' | 'pos_setup'>('outlets');
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingOutlet, setEditingOutlet] = useState<Outlet | null>(null);
  const [statistics, setStatistics] = useState<OutletStatistics>({
    totalOutlets: 0,
    activeOutlets: 0,
    outletTypes: 0,
    configuredOutlets: 0
  });
  const [formData, setFormData] = useState({
    name: '',
    type: 'Restaurant' as 'Restaurant' | 'Bar' | 'RoomService' | 'Banquet' | 'Minibar',
    revenue_center_code: '',
    operating_hours: null as OperatingHours | null,
    is_active: true
  });
  const [filterSearch, setFilterSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [kitchenApi, setKitchenApi] = useState<KitchenManagementAPI | null>(null);
  const [kitchenStats, setKitchenStats] = useState<{ totalStations: number; activeStations: number; stationsWithKDS: number }>({
    totalStations: 0,
    activeStations: 0,
    stationsWithKDS: 0
  });

  const handleKitchenReady = (api: KitchenManagementAPI) => {
    setKitchenApi(api);
    setKitchenStats(api.statistics);
  };

  const fetchStatistics = async () => {
    try {
      const response = await fetch('/api/food-beverage/outlets/statistics');
      if (!response.ok) throw new Error('Failed to fetch statistics');
      const data = await response.json();
      setStatistics(data);
    } catch (error) {
      console.error('Error fetching statistics:', error);
    }
  };

  const fetchOutlets = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/food-beverage/outlets');
      if (!response.ok) throw new Error('Failed to fetch outlets');
      const data = await response.json();
      setOutlets(data.data || data || []);
      fetchStatistics();
    } catch (error) {
      console.error('Error fetching outlets:', error);
      addNotification('Failed to load outlets', 'warning', 'F&B');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOutlets();
  }, []);

  const handleCreateOutlet = () => {
    setEditingOutlet(null);
    setFormData({
      name: '',
      type: 'Restaurant',
      revenue_center_code: '',
      operating_hours: null,
      is_active: true
    });
    setShowModal(true);
  };

  const handleEditOutlet = (outlet: Outlet) => {
    setEditingOutlet(outlet);
    setFormData({
      name: outlet.name,
      type: outlet.type,
      revenue_center_code: outlet.revenue_center_code || '',
      operating_hours: outlet.operating_hours ? toOperatingHours(outlet.operating_hours) : null,
      is_active: outlet.is_active
    });
    setShowModal(true);
  };

  const handleSaveOutlet = async () => {
    try {
      const url = editingOutlet
        ? `/api/food-beverage/outlets/${editingOutlet.id}`
        : '/api/food-beverage/outlets';

      const method = editingOutlet ? 'PATCH' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (!response.ok) throw new Error('Failed to save outlet');

      addNotification(editingOutlet ? 'Outlet updated successfully' : 'Outlet created successfully', 'success', 'F&B');
      setShowModal(false);
      fetchOutlets();
    } catch (error) {
      console.error('Error saving outlet:', error);
      addNotification('Failed to save outlet', 'warning', 'F&B');
    }
  };

  const handleDeleteOutlet = async (id: string) => {
    if (!confirm('Are you sure you want to delete this outlet?')) return;

    try {
      const response = await fetch(`/api/food-beverage/outlets/${id}`, {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error('Failed to delete outlet');

      addNotification('Outlet deleted successfully', 'success', 'F&B');
      fetchOutlets();
    } catch (error) {
      console.error('Error deleting outlet:', error);
      addNotification('Failed to delete outlet', 'warning', 'F&B');
    }
  };

  const formatHours = (hours: Record<string, { open: string; close: string }> | null) => {
    const h = toOperatingHours(hours);
    return `${h.monday.open} – ${h.monday.close}`;
  };

  return (
    <div className={['accent-fb', layout.sectionStack].join(' ')}>
      {/* Header */}
      <PageHeader
        title="Outlet Management"
        subtitle="Configure and manage F&B outlets"
        icon={Store}
        actions={
          activeSubTab === 'outlets' ? (
            <>
              <button onClick={fetchOutlets} className={button.secondary}>
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
              <button onClick={handleCreateOutlet} className={button.primary}>
                <Plus className="w-4 h-4" />
                Add Outlet
              </button>
            </>
          ) : (
            <>
              <button onClick={() => kitchenApi?.refresh()} className={button.secondary}>
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
              <button onClick={() => kitchenApi?.createStation()} className={button.primary}>
                <Plus className="w-4 h-4" />
                Add Station
              </button>
            </>
          )
        }
      />

      {/* KPI Cards — change based on active sub-tab */}
      {activeSubTab === 'outlets' ? (
        <div className={layout.kpiGrid}>
          <StatCard
            title="Total Outlets"
            value={statistics.totalOutlets}
            icon={Building2}
            tone="accent"
            interactive
          />
          <StatCard
            title="Active Outlets"
            value={statistics.activeOutlets}
            icon={Clock}
            tone="success"
            interactive
          />
          <StatCard
            title="Outlet Types"
            value={statistics.outletTypes}
            icon={Utensils}
            tone="info"
            interactive
          />
          <StatCard
            title="Configured"
            value={statistics.configuredOutlets}
            icon={Settings}
            tone="neutral"
            interactive
          />
        </div>
      ) : (
        <div className={layout.kpiGrid}>
          <StatCard
            title="Total Stations"
            value={kitchenStats.totalStations}
            icon={ChefHat}
            tone="accent"
            interactive
          />
          <StatCard
            title="Active Stations"
            value={kitchenStats.activeStations}
            icon={Clock}
            tone="success"
            interactive
          />
          <StatCard
            title="KDS Connected"
            value={kitchenStats.stationsWithKDS}
            icon={Monitor}
            tone="info"
            interactive
          />
        </div>
      )}

      {/* Tabs */}
      <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-2xl border border-gray-200 dark:border-slate-700">
        <button
          onClick={() => setActiveSubTab('outlets')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all ${
            activeSubTab === 'outlets'
              ? 'bg-white dark:bg-slate-800 text-[var(--color-accent-fb)] shadow-sm font-medium'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700'
          }`}
        >
          <Store className="w-4 h-4" />
          <span className="text-sm">Outlets</span>
        </button>
        <button
          onClick={() => setActiveSubTab('kitchen')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all ${
            activeSubTab === 'kitchen'
              ? 'bg-white dark:bg-slate-800 text-[var(--color-accent-fb)] shadow-sm font-medium'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700'
          }`}
        >
          <ChefHat className="w-4 h-4" />
          <span className="text-sm">Kitchen Management</span>
        </button>
        <button
          onClick={() => setActiveSubTab('pos_setup')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all ${
            activeSubTab === 'pos_setup'
              ? 'bg-white dark:bg-slate-800 text-[var(--color-accent-fb)] shadow-sm font-medium'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700'
          }`}
        >
          <Settings className="w-4 h-4" />
          <span className="text-sm">POS Outlets, GL & Shifts</span>
        </button>
      </div>

      {/* Kitchen Management sub-tab */}
      {activeSubTab === 'kitchen' && <KitchenManagement embedded onReady={handleKitchenReady} />}

      {/* POS Outlets, GL & Shifts sub-tab */}
      {activeSubTab === 'pos_setup' && <POSOutletManagement embedded />}

      {/* Outlets sub-tab */}
      {activeSubTab === 'outlets' && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6 card-shadow">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-4 p-4 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-gray-200 dark:border-slate-700">
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder="Search outlets..."
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
                className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white w-48"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-600 dark:text-slate-400">Type:</label>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
              >
                <option value="all">All Types</option>
                <option value="Restaurant">Restaurant</option>
                <option value="Bar">Bar</option>
                <option value="RoomService">Room Service</option>
                <option value="Banquet">Banquet</option>
                <option value="Minibar">Minibar</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-600 dark:text-slate-400">Status:</label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            {(filterType !== 'all' || filterStatus !== 'all' || filterSearch) && (
              <button
                onClick={() => { setFilterType('all'); setFilterStatus('all'); setFilterSearch(''); }}
                className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              >
                Clear Filters
              </button>
            )}
          </div>

          {loading ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">Loading outlets...</div>
          ) : outlets.length === 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <Building2 className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No outlets found</p>
              <p className="text-xs mt-1">Click "Add Outlet" to create your first outlet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Revenue Center</th>
                    <th className="px-4 py-3 font-medium">Hours (Mon)</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {outlets
                    .filter(outlet => {
                      const matchesType = filterType === 'all' || outlet.type === filterType;
                      const matchesStatus = filterStatus === 'all' || (filterStatus === 'active' ? outlet.is_active : !outlet.is_active);
                      const matchesSearch = !filterSearch ||
                        outlet.name.toLowerCase().includes(filterSearch.toLowerCase()) ||
                        (outlet.revenue_center_code || '').toLowerCase().includes(filterSearch.toLowerCase());
                      return matchesType && matchesStatus && matchesSearch;
                    })
                    .map((outlet) => (
                    <tr key={outlet.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="shrink-0 p-2 rounded-lg bg-[var(--color-accent-fb)]/10 text-[var(--color-accent-fb)]">
                            <Building2 className="w-4 h-4" />
                          </div>
                          <div className="font-medium text-gray-900 dark:text-white">{outlet.name}</div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{outlet.type}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400 font-mono text-xs">{outlet.revenue_center_code || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{formatHours(outlet.operating_hours)}</td>
                      <td className="px-4 py-3">
                        <Badge tone={outlet.is_active ? 'success' : 'neutral'}>
                          {outlet.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button onClick={() => handleEditOutlet(outlet)} className={button.ghost}>
                            <Edit className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleDeleteOutlet(outlet.id)} className={button.ghost}>
                            <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Outlet Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-2xl my-8 border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                {editingOutlet ? 'Edit Outlet' : 'New Outlet'}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Outlet Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Outlet Type</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                >
                  <option value="Restaurant">Restaurant</option>
                  <option value="Bar">Bar</option>
                  <option value="RoomService">Room Service</option>
                  <option value="Banquet">Banquet</option>
                  <option value="Minibar">Minibar</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Revenue Center Code</label>
                <input
                  type="text"
                  value={formData.revenue_center_code}
                  onChange={(e) => setFormData({ ...formData, revenue_center_code: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                />
              </div>

              {/* Operating Hours */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Operating Hours</label>
                  <button
                    type="button"
                    onClick={() => {
                      const defaultHours: OperatingHours = {
                        monday: { open: '07:00', close: '22:00' },
                        tuesday: { open: '07:00', close: '22:00' },
                        wednesday: { open: '07:00', close: '22:00' },
                        thursday: { open: '07:00', close: '22:00' },
                        friday: { open: '07:00', close: '22:00' },
                        saturday: { open: '07:00', close: '22:00' },
                        sunday: { open: '07:00', close: '22:00' }
                      };
                      setFormData({ ...formData, operating_hours: defaultHours });
                    }}
                    className="text-xs text-[var(--color-accent-fb)] hover:text-[var(--color-accent-fb-hover)]"
                  >
                    Set Default (07:00-22:00)
                  </button>
                </div>
                <div className="space-y-2">
                  {DAYS.map((day) => (
                    <div key={day} className="grid grid-cols-3 gap-2 items-center">
                      <span className="text-sm text-gray-600 dark:text-gray-400 capitalize">{DAY_LABELS[day]}</span>
                      <input
                        type="time"
                        value={formData.operating_hours?.[day]?.open || ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          operating_hours: {
                            ...formData.operating_hours,
                            [day]: { ...formData.operating_hours?.[day], open: e.target.value }
                          } as OperatingHours
                        })}
                        className="px-2 py-1 text-sm border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                      />
                      <input
                        type="time"
                        value={formData.operating_hours?.[day]?.close || ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          operating_hours: {
                            ...formData.operating_hours,
                            [day]: { ...formData.operating_hours?.[day], close: e.target.value }
                          } as OperatingHours
                        })}
                        className="px-2 py-1 text-sm border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={formData.is_active}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300"
                />
                <label htmlFor="isActive" className="text-sm text-gray-700 dark:text-gray-300">Active</label>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleSaveOutlet}
                  className={button.primary}
                >
                  {editingOutlet ? 'Update Outlet' : 'Create Outlet'}
                </button>
                <button
                  onClick={() => setShowModal(false)}
                  className={button.secondary}
                >
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
