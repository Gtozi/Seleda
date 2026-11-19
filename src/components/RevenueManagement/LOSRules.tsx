/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LOS (Length of Stay) Rules — DB-integrated.
 *
 * Fetches from /api/rms-portal/los-rules (Supabase-direct, same pattern
 * as /api/hk-portal/*). Manages two related tables:
 *   - rms_los_rules: min/max stay + arrival/departure day restrictions
 *   - rms_los_pricing_adjustments: LOS-based discounts/surcharges
 *
 * UI uses the shared Front Office primitives (PageHeader, SectionCard,
 * Badge, StatCard) so the module matches the Housekeeping / F&B portals.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Edit,
  Trash2,
  Calendar,
  Clock,
  Percent,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ServerCrash,
  X,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { useERP } from '../../context/ERPContext';
import { button, type StatusTone } from '../FrontOffice/brandTheme';
import { rmsGet, rmsRequest } from '../../services/rmsService';

// ── Types ────────────────────────────────────────────────────────────────
interface LOSRule {
  id: string;
  name: string;
  room_type: string;
  start_date: string | null;
  end_date: string | null;
  min_los: number;
  max_los: number | null;
  cta_closed_days: string | null;
  ctd_closed_days: string | null;
  priority: number;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface LOSAdjustment {
  id: string;
  name: string;
  room_type: string;
  los_nights: number;
  adjustment_type: 'percentage' | 'absolute';
  adjustment_value: number;
  start_date: string | null;
  end_date: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatClosedDays(closed: string | null): string {
  if (!closed) return '—';
  const days = closed.split(',').map(d => parseInt(d.trim(), 10)).filter(d => !isNaN(d));
  if (days.length === 0) return '—';
  if (days.length === 7) return 'All days';
  return days.map(d => WEEKDAY_LABELS[d] || `?${d}`).join(', ');
}

function formatDateRange(start: string | null, end: string | null): string {
  if (!start && !end) return 'Always';
  const s = start ? new Date(start).toLocaleDateString() : '…';
  const e = end ? new Date(end).toLocaleDateString() : '…';
  return `${s} → ${e}`;
}

// ── Component ───────────────────────────────────────────────────────────
const LOSRules = () => {
  const [rules, setRules] = useState<LOSRule[]>([]);
  const [adjustments, setAdjustments] = useState<LOSAdjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [showRuleForm, setShowRuleForm] = useState(false);
  const [editingRule, setEditingRule] = useState<LOSRule | null>(null);
  const [showAdjForm, setShowAdjForm] = useState(false);
  const [editingAdj, setEditingAdj] = useState<LOSAdjustment | null>(null);
  const { currentPropertyId } = useERP();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await rmsGet('/api/rms-portal/los-rules', { propertyId: currentPropertyId });
      setRules(Array.isArray(json.rules) ? json.rules : []);
      setAdjustments(Array.isArray(json.adjustments) ? json.adjustments : []);
    } catch (e: any) {
      setError(e.message || 'Failed to load LOS rules');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => ({
    total: rules.length,
    active: rules.filter(r => r.active).length,
    adjustments: adjustments.length,
    activeAdjustments: adjustments.filter(a => a.active).length,
  }), [rules, adjustments]);

  // ── Rule actions ─────────────────────────────────────────────────────
  const handleDeleteRule = async (id: string) => {
    if (!confirm('Delete this LOS rule?')) return;
    setActionLoading(true);
    try {
      await rmsRequest(`/api/rms-portal/los-rules/${id}`, { method: 'DELETE', propertyId: currentPropertyId });
      await load();
    } catch (e: any) {
      setError(e.message || 'Delete failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSaveRule = async (form: Record<string, any>) => {
    setActionLoading(true);
    try {
      const url = editingRule ? `/api/rms-portal/los-rules/${editingRule.id}` : '/api/rms-portal/los-rules';
      await rmsRequest(url, { method: editingRule ? 'PUT' : 'POST', body: form, propertyId: currentPropertyId });
      setShowRuleForm(false);
      setEditingRule(null);
      await load();
    } catch (e: any) {
      setError(e.message || 'Save failed');
    } finally {
      setActionLoading(false);
    }
  };

  // ── Adjustment actions ──────────────────────────────────────────────
  const handleDeleteAdj = async (id: string) => {
    if (!confirm('Delete this pricing adjustment?')) return;
    setActionLoading(true);
    try {
      await rmsRequest(`/api/rms-portal/los-rules/adjustments/${id}`, { method: 'DELETE', propertyId: currentPropertyId });
      await load();
    } catch (e: any) {
      setError(e.message || 'Delete failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSaveAdj = async (form: Record<string, any>) => {
    setActionLoading(true);
    try {
      const url = editingAdj ? `/api/rms-portal/los-rules/adjustments/${editingAdj.id}` : '/api/rms-portal/los-rules/adjustments';
      await rmsRequest(url, { method: editingAdj ? 'PUT' : 'POST', body: form, propertyId: currentPropertyId });
      setShowAdjForm(false);
      setEditingAdj(null);
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
          Loading LOS rules…
        </div>
      </div>
    );
  }

  if (error && rules.length === 0) {
    return (
      <div className="p-6">
        <div className="flex flex-col items-center justify-center py-20 text-rose-600 dark:text-rose-400">
          <ServerCrash className="w-10 h-10 mb-3" />
          <p className="font-medium">{error}</p>
          <button onClick={load} className="mt-4 text-sm text-blue-600 hover:underline">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="LOS Rules"
        subtitle="Length-of-stay constraints and pricing adjustments"
        actions={
          <button
            onClick={() => { setEditingRule(null); setShowRuleForm(true); }}
            className={button.primary}
          >
            <Plus className="w-4 h-4" />
            Add Rule
          </button>
        }
      />

      {error && (
        <div className="text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg px-4 py-2">
          {error}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title="Total Rules"      value={stats.total}             icon={Clock}        tone="info" />
        <StatCard title="Active Rules"     value={stats.active}            icon={CheckCircle2} tone="success" />
        <StatCard title="Pricing Adjustments" value={stats.adjustments}    icon={Percent}      tone="accent" />
        <StatCard title="Active Adjustments" value={stats.activeAdjustments} icon={AlertCircle} tone="warning" />
      </div>

      {/* Stay Constraints */}
      <SectionCard title="Stay Constraints" icon={Clock} pad="none">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700">
              <tr>
                {['Rule', 'Room Type', 'Date Range', 'Min LOS', 'Max LOS', 'CTA Closed', 'CTD Closed', 'Priority', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {rules.map(r => (
                <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                  <td className="px-4 py-4">
                    <p className="font-medium text-slate-900 dark:text-white">{r.name}</p>
                    {r.notes && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{r.notes}</p>}
                  </td>
                  <td className="px-4 py-4">
                    <Badge tone={r.room_type === 'all' ? 'neutral' : 'info'}>{r.room_type}</Badge>
                  </td>
                  <td className="px-4 py-4 text-sm text-slate-600 dark:text-slate-400">
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      {formatDateRange(r.start_date, r.end_date)}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-sm font-medium text-slate-900 dark:text-white">{r.min_los}n</td>
                  <td className="px-4 py-4 text-sm text-slate-600 dark:text-slate-400">{r.max_los ? `${r.max_los}n` : '—'}</td>
                  <td className="px-4 py-4 text-sm text-slate-600 dark:text-slate-400">{formatClosedDays(r.cta_closed_days)}</td>
                  <td className="px-4 py-4 text-sm text-slate-600 dark:text-slate-400">{formatClosedDays(r.ctd_closed_days)}</td>
                  <td className="px-4 py-4 text-sm text-slate-600 dark:text-slate-400">{r.priority}</td>
                  <td className="px-4 py-4">
                    <Badge tone={r.active ? 'success' : 'neutral'}>
                      {r.active ? (
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
                      <button
                        onClick={() => { setEditingRule(r); setShowRuleForm(true); }}
                        className="p-1.5 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
                        title="Edit"
                      >
                        <Edit className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      </button>
                      <button
                        onClick={() => handleDeleteRule(r.id)}
                        disabled={actionLoading}
                        className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-5 h-5 text-red-600 dark:text-red-400" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rules.length === 0 && (
          <div className="text-center py-12">
            <Clock className="w-12 h-12 text-slate-400 mx-auto mb-4" />
            <p className="text-slate-600 dark:text-slate-400">No LOS rules configured</p>
          </div>
        )}
      </SectionCard>

      {/* Pricing Adjustments */}
      <SectionCard
        title="LOS Pricing Adjustments"
        icon={Percent}
        pad="none"
        actions={
          <button
            onClick={() => { setEditingAdj(null); setShowAdjForm(true); }}
            className={button.secondary}
          >
            <Plus className="w-4 h-4" />
            Add Adjustment
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700">
              <tr>
                {['Name', 'Room Type', 'LOS Nights', 'Type', 'Value', 'Date Range', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {adjustments.map(a => {
                const isDiscount = a.adjustment_value < 0;
                const tone: StatusTone = isDiscount ? 'success' : a.adjustment_value > 0 ? 'warning' : 'neutral';
                return (
                  <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                    <td className="px-4 py-4 font-medium text-slate-900 dark:text-white">{a.name}</td>
                    <td className="px-4 py-4"><Badge tone={a.room_type === 'all' ? 'neutral' : 'info'}>{a.room_type}</Badge></td>
                    <td className="px-4 py-4 text-sm text-slate-600 dark:text-slate-400">{a.los_nights}n+</td>
                    <td className="px-4 py-4 text-sm text-slate-600 dark:text-slate-400">{a.adjustment_type}</td>
                    <td className="px-4 py-4">
                      <Badge tone={tone}>
                        {isDiscount ? '−' : '+'}{Math.abs(a.adjustment_value)}{a.adjustment_type === 'percentage' ? '%' : ''}
                      </Badge>
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-600 dark:text-slate-400">{formatDateRange(a.start_date, a.end_date)}</td>
                    <td className="px-4 py-4">
                      <Badge tone={a.active ? 'success' : 'neutral'}>
                        {a.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => { setEditingAdj(a); setShowAdjForm(true); }}
                          className="p-1.5 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
                          title="Edit"
                        >
                          <Edit className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                        </button>
                        <button
                          onClick={() => handleDeleteAdj(a.id)}
                          disabled={actionLoading}
                          className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-5 h-5 text-red-600 dark:text-red-400" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {adjustments.length === 0 && (
          <div className="text-center py-12">
            <Percent className="w-12 h-12 text-slate-400 mx-auto mb-4" />
            <p className="text-slate-600 dark:text-slate-400">No pricing adjustments configured</p>
          </div>
        )}
      </SectionCard>

      {/* Rule Form Modal */}
      {showRuleForm && (
        <LOSRuleForm
          rule={editingRule}
          onCancel={() => { setShowRuleForm(false); setEditingRule(null); }}
          onSave={handleSaveRule}
          saving={actionLoading}
        />
      )}

      {/* Adjustment Form Modal */}
      {showAdjForm && (
        <LOSAdjustmentForm
          adjustment={editingAdj}
          onCancel={() => { setShowAdjForm(false); setEditingAdj(null); }}
          onSave={handleSaveAdj}
          saving={actionLoading}
        />
      )}
    </div>
  );
};

// ── LOSRuleForm (modal) ─────────────────────────────────────────────────
interface LOSRuleFormProps {
  rule: LOSRule | null;
  onCancel: () => void;
  onSave: (form: Record<string, any>) => void;
  saving: boolean;
}

const LOSRuleForm = ({ rule: r, onCancel, onSave, saving }: LOSRuleFormProps) => {
  const [form, setForm] = useState({
    name: r?.name || '',
    room_type: r?.room_type || 'all',
    start_date: r?.start_date || '',
    end_date: r?.end_date || '',
    min_los: r?.min_los ?? 1,
    max_los: r?.max_los ?? '',
    cta_closed_days: r?.cta_closed_days || '',
    ctd_closed_days: r?.ctd_closed_days || '',
    priority: r?.priority ?? 100,
    active: r?.active ?? true,
    notes: r?.notes || '',
  });
  const set = (k: string, v: any) => setForm(prev => ({ ...prev, [k]: v }));

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto">
        <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{r ? 'Edit LOS Rule' : 'Add LOS Rule'}</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">Length-of-stay constraint</p>
          </div>
          <button onClick={onCancel} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Rule Name</label>
            <input
              type="text" value={form.name}
              onChange={e => set('name', e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
              placeholder="e.g. Weekend Min 2 Nights"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Room Type</label>
              <input
                type="text" value={form.room_type}
                onChange={e => set('room_type', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                placeholder="all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Priority (lower = higher)</label>
              <input
                type="number" value={form.priority}
                onChange={e => set('priority', Number(e.target.value))}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Start Date</label>
              <input
                type="date" value={form.start_date}
                onChange={e => set('start_date', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">End Date</label>
              <input
                type="date" value={form.end_date}
                onChange={e => set('end_date', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Min LOS (nights)</label>
              <input
                type="number" min="0" max="30" value={form.min_los}
                onChange={e => set('min_los', Number(e.target.value))}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Max LOS (nights, blank = none)</label>
              <input
                type="number" min="1" max="30" value={form.max_los}
                onChange={e => set('max_los', e.target.value === '' ? null : Number(e.target.value))}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">CTA Closed Days (0-6, comma-sep)</label>
              <input
                type="text" value={form.cta_closed_days}
                onChange={e => set('cta_closed_days', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                placeholder="e.g. 0,1,2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">CTD Closed Days (0-6, comma-sep)</label>
              <input
                type="text" value={form.ctd_closed_days}
                onChange={e => set('ctd_closed_days', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                placeholder="e.g. 6"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              rows={2}
              className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
              placeholder="Optional description"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} className="rounded border-slate-300" />
            Active
          </label>
        </div>

        <div className="p-6 border-t border-slate-200 dark:border-slate-700 flex items-center justify-end gap-3">
          <button onClick={onCancel} className={button.secondary}>Cancel</button>
          <button onClick={() => onSave(form)} disabled={saving || !form.name} className={button.primary}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {r ? 'Save Changes' : 'Add Rule'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── LOSAdjustmentForm (modal) ───────────────────────────────────────────
interface LOSAdjFormProps {
  adjustment: LOSAdjustment | null;
  onCancel: () => void;
  onSave: (form: Record<string, any>) => void;
  saving: boolean;
}

const LOSAdjustmentForm = ({ adjustment: a, onCancel, onSave, saving }: LOSAdjFormProps) => {
  const [form, setForm] = useState({
    name: a?.name || '',
    room_type: a?.room_type || 'all',
    los_nights: a?.los_nights ?? 3,
    adjustment_type: a?.adjustment_type || 'percentage',
    adjustment_value: a?.adjustment_value ?? -10,
    start_date: a?.start_date || '',
    end_date: a?.end_date || '',
    active: a?.active ?? true,
  });
  const set = (k: string, v: any) => setForm(prev => ({ ...prev, [k]: v }));

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto">
        <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{a ? 'Edit Adjustment' : 'Add Pricing Adjustment'}</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">LOS-based rate adjustment (negative = discount, positive = surcharge)</p>
          </div>
          <button onClick={onCancel} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Name</label>
            <input
              type="text" value={form.name}
              onChange={e => set('name', e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
              placeholder="e.g. Stay 3+ Save 10%"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Room Type</label>
              <input
                type="text" value={form.room_type}
                onChange={e => set('room_type', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">LOS Nights (applies at N+)</label>
              <input
                type="number" min="1" max="30" value={form.los_nights}
                onChange={e => set('los_nights', Number(e.target.value))}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Adjustment Type</label>
              <select
                value={form.adjustment_type}
                onChange={e => set('adjustment_type', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
              >
                <option value="percentage">Percentage (%)</option>
                <option value="absolute">Absolute ($)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Adjustment Value</label>
              <input
                type="number" step="0.01" value={form.adjustment_value}
                onChange={e => set('adjustment_value', Number(e.target.value))}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                placeholder="e.g. -10 for 10% discount"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Start Date</label>
              <input
                type="date" value={form.start_date}
                onChange={e => set('start_date', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">End Date</label>
              <input
                type="date" value={form.end_date}
                onChange={e => set('end_date', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} className="rounded border-slate-300" />
            Active
          </label>
        </div>

        <div className="p-6 border-t border-slate-200 dark:border-slate-700 flex items-center justify-end gap-3">
          <button onClick={onCancel} className={button.secondary}>Cancel</button>
          <button onClick={() => onSave(form)} disabled={saving || !form.name} className={button.primary}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {a ? 'Save Changes' : 'Add Adjustment'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default LOSRules;
