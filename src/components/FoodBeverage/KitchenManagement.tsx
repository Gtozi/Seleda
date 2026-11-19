/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import { useState, useEffect, useRef } from 'react';
import {
  ChefHat,
  Clock,
  Settings,
  Plus,
  Edit,
  Trash2,
  Utensils,
  RefreshCw,
  X,
  Monitor,
  Link2,
  Unlink
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';

export interface KitchenManagementAPI {
  refresh: () => void;
  createStation: () => void;
  statistics: KitchenStatistics;
}

interface KitchenStation {
  id: string;
  station_name: string;
  station_type: 'Hot' | 'Cold' | 'Prep' | 'Grill' | 'Sauté' | 'Fry' | 'Dessert' | 'Beverage' | 'Expo' | 'Other';
  outlet_id: string | null; // TEXT type to match outlets.id
  description: string | null;
  capacity_per_hour: number;
  active_hours_start: string;
  active_hours_end: string;
  is_active: boolean;
  kds_instance_id: string | null;
  created_at: string;
  updated_at: string;
}

interface KitchenStatistics {
  totalStations: number;
  activeStations: number;
  stationsWithKDS: number;
}

const STATION_TYPES = [
  'Hot', 'Cold', 'Prep', 'Grill', 'Sauté', 'Fry', 'Dessert', 'Beverage', 'Expo', 'Other'
] as const;

export default function KitchenManagement({ embedded = false, onReady }: { embedded?: boolean; onReady?: (api: KitchenManagementAPI) => void }) {
  const { addNotification } = useERP();
  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [kdsInstances, setKdsInstances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingStation, setEditingStation] = useState<KitchenStation | null>(null);
  const [statistics, setStatistics] = useState<KitchenStatistics>({
    totalStations: 0,
    activeStations: 0,
    stationsWithKDS: 0
  });
  const [formData, setFormData] = useState({
    station_name: '',
    station_type: 'Hot' as typeof STATION_TYPES[number],
    outlet_id: null as string | null,
    description: '',
    capacity_per_hour: 30,
    active_hours_start: '06:00',
    active_hours_end: '22:00',
    is_active: true,
    kds_instance_id: null as string | null
  });

  const fetchStatistics = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch('/api/food-beverage/kitchen/statistics', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!response.ok) throw new Error('Failed to fetch statistics');
      const data = await response.json();
      setStatistics(data);
    } catch (error) {
      console.error('Error fetching statistics:', error);
    }
  };

  const fetchStations = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch('/api/food-beverage/kitchen/stations', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!response.ok) throw new Error('Failed to fetch stations');
      const data = await response.json();
      setStations(data.data || data || []);
      fetchStatistics();
    } catch (error) {
      console.error('Error fetching stations:', error);
      addNotification('Failed to load kitchen stations', 'warning', 'F&B');
    } finally {
      setLoading(false);
    }
  };

  const fetchKDSInstances = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch('/api/kds', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setKdsInstances(data.instances || []);
      }
    } catch (error) {
      console.error('Error fetching KDS instances:', error);
    }
  };

  useEffect(() => {
    fetchStations();
    fetchKDSInstances();
  }, []);

  const handleCreateStation = () => {
    setEditingStation(null);
    setFormData({
      station_name: '',
      station_type: 'Hot',
      outlet_id: null,
      description: '',
      capacity_per_hour: 30,
      active_hours_start: '06:00',
      active_hours_end: '22:00',
      is_active: true,
      kds_instance_id: null
    });
    setShowModal(true);
  };

  // Expose API to parent when embedded
  const apiRef = useRef<KitchenManagementAPI>({ refresh: fetchStations, createStation: handleCreateStation, statistics });
  apiRef.current.refresh = fetchStations;
  apiRef.current.createStation = handleCreateStation;
  apiRef.current.statistics = statistics;
  useEffect(() => {
    if (onReady) onReady(apiRef.current);
  }, [onReady, statistics]);

  const handleEditStation = (station: KitchenStation) => {
    setEditingStation(station);
    setFormData({
      station_name: station.station_name,
      station_type: station.station_type,
      outlet_id: station.outlet_id,
      description: station.description || '',
      capacity_per_hour: station.capacity_per_hour,
      active_hours_start: station.active_hours_start,
      active_hours_end: station.active_hours_end,
      is_active: station.is_active,
      kds_instance_id: station.kds_instance_id
    });
    setShowModal(true);
  };

  const handleSaveStation = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const url = editingStation
        ? `/api/food-beverage/kitchen/stations/${editingStation.id}`
        : '/api/food-beverage/kitchen/stations';

      const method = editingStation ? 'PATCH' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.error || 'Failed to save station');
      }

      addNotification(editingStation ? 'Station updated successfully' : 'Station created successfully', 'success', 'F&B');
      setShowModal(false);
      fetchStations();
    } catch (error) {
      console.error('Error saving station:', error);
      addNotification('Failed to save station', 'warning', 'F&B');
    }
  };

  const handleDeleteStation = async (id: string) => {
    if (!confirm('Are you sure you want to delete this station?')) return;

    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`/api/food-beverage/kitchen/stations/${id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });

      if (!response.ok) throw new Error('Failed to delete station');

      addNotification('Station deleted successfully', 'success', 'F&B');
      fetchStations();
    } catch (error) {
      console.error('Error deleting station:', error);
      addNotification('Failed to delete station', 'warning', 'F&B');
    }
  };

  return (
    <div className={['accent-fb', layout.sectionStack].join(' ')}>
      {/* Header + KPI Cards (hidden when embedded — parent renders them) */}
      {!embedded && (
        <>
      {/* Header */}
      <PageHeader
        title="Kitchen Management"
        subtitle="Manage kitchen prep stations, capacity, and scheduling"
        icon={ChefHat}
        actions={
          <>
            <button onClick={fetchStations} className={button.secondary}>
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
            <button onClick={handleCreateStation} className={button.primary}>
              <Plus className="w-4 h-4" />
              Add Station
            </button>
          </>
        }
      />

      {/* KPI Cards */}
      <div className={layout.kpiGrid}>
        <StatCard
          title="Total Stations"
          value={statistics.totalStations}
          icon={ChefHat}
          tone="accent"
          interactive
        />
        <StatCard
          title="Active Stations"
          value={statistics.activeStations}
          icon={Clock}
          tone="success"
          interactive
        />
        <StatCard
          title="KDS Connected"
          value={statistics.stationsWithKDS}
          icon={Monitor}
          tone="info"
          interactive
        />
      </div>
        </>
      )}

      {/* Content Area */}
      <SectionCard
        icon={ChefHat}
        title="Kitchen Stations"
        tone="accent"
      >
        <div className="p-6">
            {loading ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">Loading kitchen stations...</div>
            ) : stations.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400 space-y-3">
                <ChefHat className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No kitchen stations found</p>
                <p className="text-xs">Click "Add Station" to create your first station.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {stations.map((station) => (
                  <div key={station.id} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl border border-gray-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition">
                    <div className="flex items-center gap-4">
                      <div className="shrink-0 p-2.5 rounded-xl bg-[var(--color-accent-fb)]/10 text-[var(--color-accent-fb)]">
                        <ChefHat className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{station.station_name}</h3>
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                          {station.station_type} • Capacity: {station.capacity_per_hour}/hr • Hours: {station.active_hours_start} - {station.active_hours_end}
                        </p>
                        {station.description && (
                          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">{station.description}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {station.kds_instance_id && (
                        <Badge tone="info">
                          <Link2 className="w-3 h-3 mr-1" />
                          KDS Connected
                        </Badge>
                      )}
                      <Badge tone={station.is_active ? 'success' : 'neutral'}>
                        {station.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                      <button onClick={() => handleEditStation(station)} className="p-1 text-gray-400 hover:text-[var(--color-accent-fb)]">
                        <Edit className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDeleteStation(station.id)} className="p-1 text-gray-400 hover:text-[var(--color-danger)]">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
        </div>
      </SectionCard>

      {/* Station Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-2xl my-8 border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                {editingStation ? 'Edit Station' : 'New Station'}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Station Name</label>
                <input
                  type="text"
                  value={formData.station_name}
                  onChange={(e) => setFormData({ ...formData, station_name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Station Type</label>
                <select
                  value={formData.station_type}
                  onChange={(e) => setFormData({ ...formData, station_type: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                >
                  {STATION_TYPES.map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Capacity (per hour)</label>
                  <input
                    type="number"
                    value={formData.capacity_per_hour}
                    onChange={(e) => setFormData({ ...formData, capacity_per_hour: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">KDS Integration</label>
                  <select
                    value={formData.kds_instance_id || ''}
                    onChange={(e) => setFormData({ ...formData, kds_instance_id: e.target.value || null })}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                  >
                    <option value="">No KDS Integration</option>
                    {kdsInstances.map(instance => (
                      <option key={instance.id} value={instance.id}>{instance.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Active Hours Start</label>
                  <input
                    type="time"
                    value={formData.active_hours_start}
                    onChange={(e) => setFormData({ ...formData, active_hours_start: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Active Hours End</label>
                  <input
                    type="time"
                    value={formData.active_hours_end}
                    onChange={(e) => setFormData({ ...formData, active_hours_end: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                  />
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
                  onClick={handleSaveStation}
                  className={button.primary}
                >
                  {editingStation ? 'Update Station' : 'Create Station'}
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