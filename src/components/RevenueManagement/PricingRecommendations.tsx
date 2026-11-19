/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pricing Recommendations — DB-integrated.
 *
 * Fetches from /api/rms-portal/recommendations (Supabase-direct, same
 * pattern as /api/hk-portal/*). Approve / reject / batch / generate
 * actions persist back through the same endpoints.
 *
 * UI uses the shared Front Office primitives (PageHeader, SectionCard,
 * Badge, StatCard) so the module matches the Housekeeping / F&B portals.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Clock,
  TrendingUp,
  RefreshCw,
  Filter,
  Calendar,
  Download,
  ArrowUpRight,
  ArrowDownRight,
  AlertCircle,
  MoreVertical,
  ServerCrash,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { useERP } from '../../context/ERPContext';
import { button, type StatusTone } from '../FrontOffice/brandTheme';
import { rmsGet, rmsPost } from '../../services/rmsService';

const API = '/api/rms-portal/recommendations';

// ── Types ────────────────────────────────────────────────────────────────
type RecommendationStatus = 'pending' | 'approved' | 'rejected' | 'applied';
type FilterStatus = 'all' | RecommendationStatus;

interface PricingRecommendation {
  id: string;
  room_type_id: string;
  room_type: string;
  recommendation_date: string;
  current_rate: number;
  recommended_rate: number;
  confidence: number;
  reason: string | null;
  demand_score: number;
  competitor_avg: number;
  occupancy_forecast: number;
  seasonality: number;
  events_impact: number;
  status: RecommendationStatus;
  applied_by: string | null;
  applied_at: string | null;
  created_at: string;
}

// ── Status metadata ─────────────────────────────────────────────────────
const STATUS_TONE: Record<RecommendationStatus, StatusTone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  applied: 'info',
};
const STATUS_LABEL: Record<RecommendationStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  applied: 'Applied',
};
const STATUS_ICON: Record<RecommendationStatus, LucideIcon> = {
  pending: Clock,
  approved: CheckCircle2,
  rejected: XCircle,
  applied: TrendingUp,
};

const getPercentChange = (current: number, recommended: number) =>
  Math.round(((recommended - current) / current) * 100);

// ── Component ───────────────────────────────────────────────────────────
const PricingRecommendations = () => {
  const { currentPropertyId } = useERP();
  const [recommendations, setRecommendations] = useState<PricingRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [selectedDateRange, setSelectedDateRange] = useState<'7days' | '14days' | '30days'>('7days');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await rmsGet(API, { propertyId: currentPropertyId });
      setRecommendations(Array.isArray(json.data) ? json.data : []);
    } catch (e: any) {
      setError(e.message || 'Failed to load recommendations');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const days = selectedDateRange === '7days' ? 7 : selectedDateRange === '14days' ? 14 : 30;
    const cutoff = Date.now() - days * 86400000;
    return recommendations.filter(r => {
      if (filterStatus !== 'all' && r.status !== filterStatus) return false;
      const created = r.created_at ? new Date(r.created_at).getTime() : 0;
      return created >= cutoff;
    });
  }, [recommendations, filterStatus, selectedDateRange]);

  const stats = useMemo(() => ({
    pending: recommendations.filter(r => r.status === 'pending').length,
    approved: recommendations.filter(r => r.status === 'approved').length,
    rejected: recommendations.filter(r => r.status === 'rejected').length,
    applied: recommendations.filter(r => r.status === 'applied').length,
  }), [recommendations]);

  // ── Actions ───────────────────────────────────────────────────────────
  const handleAction = async (id: string, action: 'approve' | 'reject' | 'apply') => {
    setActionLoading(true);
    try {
      const json = await rmsPost(`${API}/${id}/${action}`, {}, { propertyId: currentPropertyId });
      if (action === 'apply' && json.sellingRateUpdated === false) {
        setError('Recommendation applied, but no matching room type was found — the selling rate was not updated.');
      }
      await load();
      setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
    } catch (e: any) {
      setError(e.message || 'Action failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleBatch = async (action: 'batch-approve' | 'batch-reject') => {
    if (selected.size === 0) return;
    setActionLoading(true);
    try {
      await rmsPost(`${API}/${action}`, { ids: Array.from(selected) }, { propertyId: currentPropertyId });
      setSelected(new Set());
      await load();
    } catch (e: any) {
      setError(e.message || 'Batch action failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleGenerate = async () => {
    setActionLoading(true);
    try {
      await rmsPost(`${API}/generate`, {}, { propertyId: currentPropertyId });
      await load();
    } catch (e: any) {
      setError(e.message || 'Generate failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSelectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.filter(r => r.status === 'pending').map(r => r.id)));
    }
  };

  const handleSelect = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  // ── Render ───────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin mr-2" />
          Loading recommendations…
        </div>
      </div>
    );
  }

  if (error && recommendations.length === 0) {
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
        title="Pricing Recommendations"
        subtitle="AI-generated rate adjustments with approval workflow"
        actions={
          <>
            <button
              onClick={handleGenerate}
              disabled={actionLoading}
              className={button.primary}
            >
              <RefreshCw className={`w-4 h-4 ${actionLoading ? 'animate-spin' : ''}`} />
              Generate New
            </button>
            <button className={button.secondary}>
              <Download className="w-4 h-4" />
              Export
            </button>
          </>
        }
      />

      {error && (
        <div className="text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg px-4 py-2">
          {error}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title="Pending"  value={stats.pending}  icon={Clock}        tone="warning" />
        <StatCard title="Approved" value={stats.approved} icon={CheckCircle2} tone="success" />
        <StatCard title="Rejected" value={stats.rejected} icon={XCircle}      tone="danger" />
        <StatCard title="Applied"  value={stats.applied}  icon={TrendingUp}   tone="info" />
      </div>

      {/* Filters */}
      <SectionCard pad="md">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
              <Filter className="w-4 h-4" />
              <span className="text-sm font-medium">Status:</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              {(['all', 'pending', 'approved', 'rejected', 'applied'] as FilterStatus[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    filterStatus === s
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                  }`}
                >
                  {s === 'all' ? 'All' : STATUS_LABEL[s as RecommendationStatus]}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-slate-500" />
            <select
              value={selectedDateRange}
              onChange={(e) => setSelectedDateRange(e.target.value as any)}
              className="text-sm border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
            >
              <option value="7days">Last 7 days</option>
              <option value="14days">Last 14 days</option>
              <option value="30days">Last 30 days</option>
            </select>
          </div>
        </div>
      </SectionCard>

      {/* Batch actions */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            {selected.size} recommendation(s) selected
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => handleBatch('batch-approve')}
              disabled={actionLoading}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <CheckCircle2 className="w-4 h-4" />
              Approve All
            </button>
            <button
              onClick={() => handleBatch('batch-reject')}
              disabled={actionLoading}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <XCircle className="w-4 h-4" />
              Reject All
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <SectionCard pad="none">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={selected.size > 0 && selected.size === filtered.filter(r => r.status === 'pending').length && filtered.filter(r => r.status === 'pending').length > 0}
                    onChange={handleSelectAll}
                    className="rounded border-slate-300"
                  />
                </th>
                {['Room Type', 'Date', 'Current Rate', 'Recommended Rate', 'Change', 'Confidence', 'Reason', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {filtered.map((rec) => (
                <RecommendationRow
                  key={rec.id}
                  recommendation={rec}
                  selected={selected.has(rec.id)}
                  onSelect={() => handleSelect(rec.id)}
                  onAction={(a) => handleAction(rec.id, a)}
                />
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="text-center py-12">
            <AlertCircle className="w-12 h-12 text-slate-400 mx-auto mb-4" />
            <p className="text-slate-600 dark:text-slate-400">No recommendations found</p>
          </div>
        )}
      </SectionCard>
    </div>
  );
};

// ── Row ─────────────────────────────────────────────────────────────────
interface RecommendationRowProps {
  recommendation: PricingRecommendation;
  selected: boolean;
  onSelect: () => void;
  onAction: (action: 'approve' | 'reject' | 'apply') => void;
}

const RecommendationRow = ({ recommendation: r, selected, onSelect, onAction }: RecommendationRowProps) => {
  const percentChange = getPercentChange(r.current_rate, r.recommended_rate);
  const isPositive = percentChange > 0;
  const StatusIcon = STATUS_ICON[r.status];

  return (
    <tr className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
      <td className="px-4 py-4">
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          disabled={r.status !== 'pending'}
          className="rounded border-slate-300"
        />
      </td>
      <td className="px-4 py-4">
        <p className="font-medium text-slate-900 dark:text-white">{r.room_type}</p>
      </td>
      <td className="px-4 py-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {new Date(r.recommendation_date).toLocaleDateString()}
        </p>
      </td>
      <td className="px-4 py-4">
        <p className="font-medium text-slate-900 dark:text-white">${r.current_rate}</p>
      </td>
      <td className="px-4 py-4">
        <p className="font-semibold text-slate-900 dark:text-white">${r.recommended_rate}</p>
      </td>
      <td className="px-4 py-4">
        <div className={`flex items-center gap-1 text-sm font-medium ${isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          {isPositive ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
          {Math.abs(percentChange)}%
        </div>
      </td>
      <td className="px-4 py-4">
        <div className="flex items-center gap-2">
          <div className="w-16 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
            <div className="h-full bg-blue-600 rounded-full" style={{ width: `${r.confidence}%` }} />
          </div>
          <span className="text-sm text-slate-600 dark:text-slate-400">{r.confidence}%</span>
        </div>
      </td>
      <td className="px-4 py-4">
        <p className="text-sm text-slate-600 dark:text-slate-400 max-w-xs truncate" title={r.reason || ''}>
          {r.reason || '—'}
        </p>
      </td>
      <td className="px-4 py-4">
        <Badge tone={STATUS_TONE[r.status]}>
          <StatusIcon className="w-3.5 h-3.5" />
          {STATUS_LABEL[r.status]}
        </Badge>
      </td>
      <td className="px-4 py-4">
        {r.status === 'pending' ? (
          <div className="flex items-center gap-1">
            <button
              onClick={() => onAction('approve')}
              className="p-1.5 hover:bg-green-100 dark:hover:bg-green-900/30 rounded-lg transition-colors"
              title="Approve"
            >
              <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
            </button>
            <button
              onClick={() => onAction('reject')}
              className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
              title="Reject"
            >
              <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
            </button>
          </div>
        ) : r.status === 'approved' ? (
          <button
            onClick={() => onAction('apply')}
            className="flex items-center gap-1 px-2 py-1 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-lg transition-colors text-blue-600 dark:text-blue-400 text-xs font-medium"
            title="Apply — push recommended rate to the selling rate"
          >
            <TrendingUp className="w-4 h-4" />
            Apply Rate
          </button>
        ) : (
          <button className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors">
            <MoreVertical className="w-5 h-5 text-slate-400" />
          </button>
        )}
      </td>
    </tr>
  );
};

export default PricingRecommendations;
