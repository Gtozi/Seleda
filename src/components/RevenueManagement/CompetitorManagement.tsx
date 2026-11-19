/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Competitor Management — DB-integrated.
 *
 * Fetches from /api/rms-portal/competitors (Supabase-direct, same pattern
 * as /api/hk-portal/*). Add / edit / delete / refresh actions persist back
 * through the same endpoints.
 *
 * UI uses the shared Front Office primitives (PageHeader, SectionCard,
 * Badge, StatCard) so the module matches the Housekeeping / F&B portals.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Edit,
  Trash2,
  Search,
  MapPin,
  Star,
  RefreshCw,
  Building2,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ServerCrash,
  X,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import { rmsGet, rmsPost, rmsPut, rmsDelete } from '../../services/rmsService';

const API = '/api/rms-portal/competitors';

// ── Types ────────────────────────────────────────────────────────────────
interface CompetitorRoomMapping {
  id: string;
  competitor_id: string;
  our_room_type: string;
  their_room_type: string;
  quality_score: number;
}

interface CompetitorRate {
  id: string;
  competitor_id: string;
  room_type: string;
  rate_date: string;
  rate: number;
  currency: string;
  availability: boolean;
  source: string;
  collected_at: string;
}

interface Competitor {
  id: string;
  name: string;
  star_rating: number;
  proximity: 'same_area' | 'nearby' | 'city_wide';
  distance_km: number;
  contact_email: string | null;
  contact_phone: string | null;
  website: string | null;
  active: boolean;
  last_rate_update: string | null;
  last_rate_error: string | null;
  feed_config: { endpoint?: string; mode?: 'live' | 'simulated'; [k: string]: any } | null;
  created_at: string;
  updated_at: string;
  roomMappings: CompetitorRoomMapping[];
  rates: CompetitorRate[];
  analysis: {
    market_share: number;
    rate_position: string;
    occupancy: number;
    adr: number;
    revpar: number;
  } | null;
}

interface ParityAlert {
  id: string;
  channel: string;
  competitor_id: string | null;
  our_rate: number;
  competitor_rate: number;
  variance_pct: number;
  severity: 'high' | 'medium' | 'low';
}

// ── Helpers ─────────────────────────────────────────────────────────────
const PROXIMITY_LABEL: Record<string, string> = {
  same_area: 'Same Area',
  nearby: 'Nearby',
  city_wide: 'City Wide',
};
const PROXIMITY_TONE: Record<string, StatusTone> = {
  same_area: 'success',
  nearby: 'info',
  city_wide: 'warning',
};
const POSITION_TONE: Record<string, StatusTone> = {
  premium: 'accent',
  competitive: 'success',
  luxury: 'warning',
  budget: 'neutral',
};

// ── Component ───────────────────────────────────────────────────────────
const CompetitorManagement = () => {
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [parityAlerts, setParityAlerts] = useState<ParityAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Competitor | null>(null);
  const [rateModalFor, setRateModalFor] = useState<Competitor | null>(null);
  const { currentPropertyId } = useERP();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await rmsGet(API, { propertyId: currentPropertyId });
      setCompetitors(Array.isArray(json.data) ? json.data : []);
      setParityAlerts(Array.isArray(json.parityAlerts) ? json.parityAlerts : []);
    } catch (e: any) {
      setError(e.message || 'Failed to load competitors');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!searchQuery) return competitors;
    const q = searchQuery.toLowerCase();
    return competitors.filter(c => c.name.toLowerCase().includes(q));
  }, [competitors, searchQuery]);

  const stats = useMemo(() => ({
    total: competitors.length,
    active: competitors.filter(c => c.active).length,
    trackedRates: competitors.reduce((sum, c) => sum + c.rates.length, 0),
    alerts: parityAlerts.length,
  }), [competitors, parityAlerts]);

  // ── Actions ───────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this competitor?')) return;
    setActionLoading(true);
    try {
      await rmsDelete(`${API}/${id}`, { propertyId: currentPropertyId });
      await load();
    } catch (e: any) {
      setError(e.message || 'Delete failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRefresh = async (id: string) => {
    setActionLoading(true);
    setNotice(null);
    try {
      const json = await rmsPost(`${API}/${id}/refresh`, {}, { propertyId: currentPropertyId });
      setNotice(
        json.simulated
          ? `Demo refresh — ${json.records} simulated rates stored (not real market data)`
          : `Refreshed ${json.records} rates from feed`,
      );
      await load();
    } catch (e: any) {
      setError(e.message || 'Refresh failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSave = async (form: Record<string, any>) => {
    setActionLoading(true);
    try {
      const url = editing ? `${API}/${editing.id}` : API;
      if (editing) await rmsPut(url, form, { propertyId: currentPropertyId });
      else await rmsPost(url, form, { propertyId: currentPropertyId });
      setShowForm(false);
      setEditing(null);
      await load();
    } catch (e: any) {
      setError(e.message || 'Save failed');
    } finally {
      setActionLoading(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin mr-2" />
          Loading competitors…
        </div>
      </div>
    );
  }

  if (error && competitors.length === 0) {
    return (
      <div className="p-6">
        <div className="flex flex-col items-center justify-center py-20 text-rose-600 dark:text-rose-400">
          <ServerCrash className="w-10 h-10 mb-3" />
          <p className="font-medium">{error}</p>
          <button onClick={load} className="mt-4 text-sm text-blue-600 hover:underline">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Competitor Management"
        subtitle="Track competitor rates and market positioning"
        actions={
          <>
            <button
              onClick={() => { setEditing(null); setShowForm(true); }}
              className={button.primary}
            >
              <Plus className="w-4 h-4" />
              Add Competitor
            </button>
          </>
        }
      />

      {error && (
        <div className="text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg px-4 py-2">
          {error}
        </div>
      )}

      {notice && (
        <div className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2">
          {notice}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title="Total"        value={stats.total}        icon={Building2}    tone="accent" />
        <StatCard title="Active"       value={stats.active}       icon={CheckCircle2} tone="success" />
        <StatCard title="Tracked Rates" value={stats.trackedRates} icon={DollarSign}  tone="info" />
        <StatCard title="Parity Alerts" value={stats.alerts}       icon={AlertCircle} tone="danger" />
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
        <input
          type="text"
          placeholder="Search competitors…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400"
        />
      </div>

      {/* Competitor List */}
      <SectionCard pad="none">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700">
              <tr>
                {['Competitor', 'Rating', 'Proximity', 'Room Mappings', 'Last Update', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {filtered.map((c) => (
                <CompetitorRow
                  key={c.id}
                  competitor={c}
                  onEdit={() => { setEditing(c); setShowForm(true); }}
                  onDelete={() => handleDelete(c.id)}
                  onViewRates={() => setRateModalFor(c)}
                  onRefresh={() => handleRefresh(c.id)}
                  actionLoading={actionLoading}
                />
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="text-center py-12">
            <Building2 className="w-12 h-12 text-slate-400 mx-auto mb-4" />
            <p className="text-slate-600 dark:text-slate-400">No competitors found</p>
          </div>
        )}
      </SectionCard>

      {/* Competitor Analysis */}
      <SectionCard title="Competitor Analysis" icon={Building2} pad="md">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {competitors.map((c) => (
            <CompetitorAnalysisCard key={c.id} competitor={c} />
          ))}
          {competitors.length === 0 && (
            <p className="text-sm text-slate-500 col-span-full text-center py-4">No analysis data</p>
          )}
        </div>
      </SectionCard>

      {/* Rate Parity Alerts */}
      <SectionCard
        title="Rate Parity Alerts"
        icon={AlertCircle}
        tone="danger"
        actions={<span className="text-sm text-slate-600 dark:text-slate-400">{parityAlerts.length} active</span>}
        pad="md"
      >
        <div className="space-y-3">
          {parityAlerts.map((alert) => {
            const comp = competitors.find(c => c.id === alert.competitor_id);
            return (
              <div
                key={alert.id}
                className={`flex items-center justify-between p-4 rounded-lg border ${
                  alert.severity === 'high'
                    ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                    : alert.severity === 'medium'
                    ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                    : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                }`}
              >
                <div className="flex items-center gap-3">
                  <AlertCircle className="w-5 h-5" />
                  <div>
                    <h4 className="font-medium text-slate-900 dark:text-white">{alert.channel}</h4>
                    <p className="text-sm text-slate-600 dark:text-slate-400">{comp?.name || 'Unknown'}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Our: ${alert.our_rate} vs Their: ${alert.competitor_rate}
                  </p>
                  <p className={`text-sm font-medium ${alert.variance_pct < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                    {alert.variance_pct}% variance
                  </p>
                </div>
              </div>
            );
          })}
          {parityAlerts.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-4">No active parity alerts</p>
          )}
        </div>
      </SectionCard>

      {/* Form Modal */}
      {showForm && (
        <CompetitorForm
          competitor={editing}
          onCancel={() => { setShowForm(false); setEditing(null); }}
          onSave={handleSave}
          saving={actionLoading}
        />
      )}

      {/* Rate History Modal */}
      {rateModalFor && (
        <RateHistoryModal
          competitor={rateModalFor}
          onClose={() => setRateModalFor(null)}
        />
      )}
    </div>
  );
};

// ── CompetitorRow ────────────────────────────────────────────────────────
interface CompetitorRowProps {
  competitor: Competitor;
  onEdit: () => void;
  onDelete: () => void;
  onViewRates: () => void;
  onRefresh: () => void;
  actionLoading: boolean;
}

const CompetitorRow = ({ competitor: c, onEdit, onDelete, onViewRates, onRefresh, actionLoading }: CompetitorRowProps) => {
  const avgRate = c.rates.length > 0
    ? Math.round(c.rates.reduce((sum, r) => sum + Number(r.rate), 0) / c.rates.length)
    : 0;

  return (
    <tr className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
      <td className="px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-200 dark:bg-slate-700 rounded-lg flex items-center justify-center">
            <Building2 className="w-5 h-5 text-slate-500 dark:text-slate-400" />
          </div>
          <div>
            <p className="font-medium text-slate-900 dark:text-white">{c.name}</p>
            <p className="text-sm text-slate-600 dark:text-slate-400">{c.contact_email || '—'}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-4">
        <div className="flex items-center gap-1">
          {[...Array(5)].map((_, i) => (
            <Star
              key={i}
              className={`w-4 h-4 ${i < c.star_rating ? 'text-amber-400 fill-amber-400' : 'text-slate-300 dark:text-slate-600'}`}
            />
          ))}
        </div>
      </td>
      <td className="px-4 py-4">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-slate-400" />
          <Badge tone={PROXIMITY_TONE[c.proximity] || 'neutral'}>
            {PROXIMITY_LABEL[c.proximity] || c.proximity}
          </Badge>
          <span className="text-sm text-slate-600 dark:text-slate-400">{c.distance_km} km</span>
        </div>
      </td>
      <td className="px-4 py-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">{c.roomMappings.length} rooms</p>
        <p className="text-sm text-slate-500 dark:text-slate-500">Avg rate: ${avgRate}</p>
      </td>
      <td className="px-4 py-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {c.last_rate_update ? new Date(c.last_rate_update).toLocaleString() : '—'}
        </p>
        {c.feed_config?.mode === 'simulated' && (
          <Badge tone="warning">demo feed</Badge>
        )}
        {c.feed_config?.endpoint && c.feed_config?.mode !== 'simulated' && (
          <Badge tone="info">live feed</Badge>
        )}
        {c.last_rate_error && (
          <p className="text-xs text-rose-600 dark:text-rose-400" title={c.last_rate_error}>
            Last pull failed
          </p>
        )}
      </td>
      <td className="px-4 py-4">
        <Badge tone={c.active ? 'success' : 'neutral'}>
          {c.active ? (
            <>
              <CheckCircle2 className="w-3 h-3" />
              Active
            </>
          ) : (
            <>
              <AlertCircle className="w-3 h-3" />
              Inactive
            </>
          )}
        </Badge>
      </td>
      <td className="px-4 py-4">
        <div className="flex items-center gap-1">
          <button onClick={onViewRates} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors" title="View Rates">
            <DollarSign className="w-5 h-5 text-slate-400" />
          </button>
          <button onClick={onRefresh} disabled={actionLoading} className="p-1.5 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-lg transition-colors" title="Refresh Rates">
            <RefreshCw className={`w-5 h-5 text-blue-600 dark:text-blue-400 ${actionLoading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={onEdit} className="p-1.5 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-lg transition-colors" title="Edit">
            <Edit className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </button>
          <button onClick={onDelete} disabled={actionLoading} className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors" title="Delete">
            <Trash2 className="w-5 h-5 text-red-600 dark:text-red-400" />
          </button>
        </div>
      </td>
    </tr>
  );
};

// ── CompetitorAnalysisCard ───────────────────────────────────────────────
const CompetitorAnalysisCard = ({ competitor: c }: { competitor: Competitor }) => {
  const a = c.analysis;
  return (
    <div className="p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-medium text-slate-900 dark:text-white">{c.name}</h4>
        {a && (
          <Badge tone={POSITION_TONE[a.rate_position] || 'neutral'}>{a.rate_position}</Badge>
        )}
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-600 dark:text-slate-400">Market Share</span>
          <span className="font-medium text-slate-900 dark:text-white">{a?.market_share ?? 0}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-600 dark:text-slate-400">Occupancy</span>
          <span className="font-medium text-slate-900 dark:text-white">{a?.occupancy ?? 0}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-600 dark:text-slate-400">ADR</span>
          <span className="font-medium text-slate-900 dark:text-white">${a?.adr ?? 0}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-600 dark:text-slate-400">RevPAR</span>
          <span className="font-medium text-slate-900 dark:text-white">${a?.revpar ?? 0}</span>
        </div>
      </div>
    </div>
  );
};

// ── CompetitorForm (modal) ───────────────────────────────────────────────
interface CompetitorFormProps {
  competitor: Competitor | null;
  onCancel: () => void;
  onSave: (form: Record<string, any>) => void;
  saving: boolean;
}

const CompetitorForm = ({ competitor: c, onCancel, onSave, saving }: CompetitorFormProps) => {
  const [form, setForm] = useState({
    name: c?.name || '',
    star_rating: c?.star_rating || 4,
    proximity: c?.proximity || 'nearby',
    distance_km: c?.distance_km || 1,
    contact_email: c?.contact_email || '',
    contact_phone: c?.contact_phone || '',
    website: c?.website || '',
    active: c?.active ?? true,
  });

  const set = (k: string, v: any) => setForm(prev => ({ ...prev, [k]: v }));

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto">
        <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
              {c ? 'Edit Competitor' : 'Add New Competitor'}
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {c ? 'Update competitor information' : 'Enter competitor details to add to tracking'}
            </p>
          </div>
          <button onClick={onCancel} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Competitor Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
              placeholder="Enter competitor name"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Star Rating</label>
              <select
                value={form.star_rating}
                onChange={(e) => set('star_rating', Number(e.target.value))}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
              >
                {[1, 2, 3, 4, 5].map(r => <option key={r} value={r}>{r} Stars</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Proximity</label>
              <select
                value={form.proximity}
                onChange={(e) => set('proximity', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
              >
                <option value="same_area">Same Area</option>
                <option value="nearby">Nearby</option>
                <option value="city_wide">City Wide</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Distance (km)</label>
            <input
              type="number"
              step="0.1"
              value={form.distance_km}
              onChange={(e) => set('distance_km', Number(e.target.value))}
              className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Contact Email</label>
              <input
                type="email"
                value={form.contact_email}
                onChange={(e) => set('contact_email', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                placeholder="email@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Contact Phone</label>
              <input
                type="tel"
                value={form.contact_phone}
                onChange={(e) => set('contact_phone', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                placeholder="+251 911 123 456"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Website</label>
            <input
              type="url"
              value={form.website}
              onChange={(e) => set('website', e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
              placeholder="https://example.com"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => set('active', e.target.checked)}
              className="rounded border-slate-300"
            />
            Active
          </label>
        </div>

        <div className="p-6 border-t border-slate-200 dark:border-slate-700 flex items-center justify-end gap-3">
          <button onClick={onCancel} className={button.secondary}>Cancel</button>
          <button
            onClick={() => onSave(form)}
            disabled={saving || !form.name}
            className={button.primary}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {c ? 'Save Changes' : 'Add Competitor'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── RateHistoryModal ────────────────────────────────────────────────────
const RateHistoryModal = ({ competitor: c, onClose }: { competitor: Competitor; onClose: () => void }) => {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
        <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{c.name} — Rate History</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">Competitor rate tracking</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>
        <div className="p-6 overflow-auto max-h-[60vh]">
          <table className="w-full">
            <thead className="bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700">
              <tr>
                {['Room Type', 'Rate', 'Date', 'Availability', 'Source'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {c.rates.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 text-sm text-slate-900 dark:text-white">{r.room_type}</td>
                  <td className="px-4 py-3 text-sm font-medium text-slate-900 dark:text-white">${r.rate}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">{new Date(r.rate_date).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <Badge tone={r.availability ? 'success' : 'danger'}>
                      {r.availability ? 'Available' : 'Sold Out'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">{r.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {c.rates.length === 0 && (
            <div className="text-center py-8">
              <p className="text-slate-600 dark:text-slate-400">No rate history available</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CompetitorManagement;
