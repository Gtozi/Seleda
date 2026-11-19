/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Corporate Rates — DB-integrated.
 *
 * Fetches from /api/rms-portal/corporate-rates (Supabase-direct, same
 * pattern as /api/hk-portal/*). Manages two related tables:
 *   - rms_corporate_accounts: corporate account master records
 *   - rms_corporate_rates: negotiated rates per account + room type
 *
 * UI uses the shared Front Office primitives (PageHeader, SectionCard,
 * Badge, StatCard) so the module matches the Housekeeping / F&B portals.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Edit,
  Trash2,
  Building2,
  DollarSign,
  Briefcase,
  CheckCircle2,
  Loader2,
  ServerCrash,
  X,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { useERP } from '../../context/ERPContext';
import { button, type StatusTone } from '../FrontOffice/brandTheme';
import { rmsGet, rmsRequest } from '../../services/rmsService';

// ── Types ────────────────────────────────────────────────────────────────
interface CorporateRate {
  id: string;
  account_id: string;
  room_type: string;
  rate_plan: string;
  rate_type: 'fixed' | 'floating';
  rate_value: number;
  currency: string;
  meal_plan: 'RO' | 'BB' | 'HB' | 'FB';
  start_date: string;
  end_date: string | null;
  status: 'active' | 'pending' | 'expired' | 'terminated';
  notes: string | null;
}

interface CorporateAccount {
  id: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  industry: string | null;
  annual_volume: number;
  status: 'active' | 'pending' | 'expired' | 'terminated';
  notes: string | null;
  created_at: string;
  updated_at: string;
  rates: CorporateRate[];
}

// ── Helpers ─────────────────────────────────────────────────────────────
const STATUS_TONE: Record<string, StatusTone> = {
  active: 'success',
  pending: 'warning',
  expired: 'neutral',
  terminated: 'danger',
};
const MEAL_PLAN_LABEL: Record<string, string> = {
  RO: 'Room Only',
  BB: 'Bed & Breakfast',
  HB: 'Half Board',
  FB: 'Full Board',
};
const RATE_TYPE_TONE: Record<string, StatusTone> = {
  fixed: 'info',
  floating: 'accent',
};

function formatRateValue(rate: CorporateRate): string {
  if (rate.rate_type === 'floating') {
    const v = Number(rate.rate_value);
    return `${v < 0 ? '−' : '+'}${Math.abs(v)}% off BAR`;
  }
  return `${rate.currency} ${Number(rate.rate_value).toFixed(0)}`;
}

function formatDateRange(start: string, end: string | null): string {
  const s = start ? new Date(start).toLocaleDateString() : '—';
  const e = end ? new Date(end).toLocaleDateString() : 'Open';
  return `${s} → ${e}`;
}

// ── Component ───────────────────────────────────────────────────────────
const CorporateRates = () => {
  const { currentPropertyId } = useERP();
  const [accounts, setAccounts] = useState<CorporateAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [showAcctForm, setShowAcctForm] = useState(false);
  const [editingAcct, setEditingAcct] = useState<CorporateAccount | null>(null);
  const [showRateForm, setShowRateForm] = useState(false);
  const [editingRate, setEditingRate] = useState<CorporateRate | null>(null);
  const [rateForAcct, setRateForAcct] = useState<string | null>(null);
  const [expandedAccts, setExpandedAccts] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await rmsGet('/api/rms-portal/corporate-rates', { propertyId: currentPropertyId });
      setAccounts(Array.isArray(json.data) ? json.data : []);
    } catch (e: any) {
      setError(e.message || 'Failed to load corporate rates');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const allRates = accounts.flatMap(a => a.rates);
    return {
      accounts: accounts.length,
      activeAccounts: accounts.filter(a => a.status === 'active').length,
      totalRates: allRates.length,
      activeRates: allRates.filter(r => r.status === 'active').length,
    };
  }, [accounts]);

  const toggleAcct = (id: string) => {
    setExpandedAccts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Account actions ───────────────────────────────────────────────────
  const handleDeleteAcct = async (id: string) => {
    if (!confirm('Delete this corporate account and all its rates?')) return;
    setActionLoading(true);
    try {
      await rmsRequest(`/api/rms-portal/corporate-rates/accounts/${id}`, { method: 'DELETE', propertyId: currentPropertyId });
      await load();
    } catch (e: any) {
      setError(e.message || 'Delete failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSaveAcct = async (form: Record<string, any>) => {
    setActionLoading(true);
    try {
      const url = editingAcct ? `/api/rms-portal/corporate-rates/accounts/${editingAcct.id}` : '/api/rms-portal/corporate-rates/accounts';
      await rmsRequest(url, { method: editingAcct ? 'PUT' : 'POST', body: form, propertyId: currentPropertyId });
      setShowAcctForm(false);
      setEditingAcct(null);
      await load();
    } catch (e: any) {
      setError(e.message || 'Save failed');
    } finally {
      setActionLoading(false);
    }
  };

  // ── Rate actions ──────────────────────────────────────────────────────
  const handleDeleteRate = async (id: string) => {
    if (!confirm('Delete this rate?')) return;
    setActionLoading(true);
    try {
      await rmsRequest(`/api/rms-portal/corporate-rates/${id}`, { method: 'DELETE', propertyId: currentPropertyId });
      await load();
    } catch (e: any) {
      setError(e.message || 'Delete failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSaveRate = async (form: Record<string, any>) => {
    setActionLoading(true);
    try {
      const url = editingRate ? `/api/rms-portal/corporate-rates/${editingRate.id}` : '/api/rms-portal/corporate-rates';
      await rmsRequest(url, { method: editingRate ? 'PUT' : 'POST', body: form, propertyId: currentPropertyId });
      setShowRateForm(false);
      setEditingRate(null);
      setRateForAcct(null);
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
          Loading corporate rates…
        </div>
      </div>
    );
  }

  if (error && accounts.length === 0) {
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
        title="Corporate Rates"
        subtitle="Negotiated corporate rate agreements"
        actions={
          <button
            onClick={() => { setEditingAcct(null); setShowAcctForm(true); }}
            className={button.primary}
          >
            <Plus className="w-4 h-4" />
            Add Account
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
        <StatCard title="Accounts"        value={stats.accounts}        icon={Building2}    tone="info" />
        <StatCard title="Active Accounts" value={stats.activeAccounts}  icon={CheckCircle2} tone="success" />
        <StatCard title="Total Rates"     value={stats.totalRates}      icon={DollarSign}  tone="accent" />
        <StatCard title="Active Rates"    value={stats.activeRates}     icon={Briefcase}   tone="warning" />
      </div>

      {/* Accounts + Rates */}
      <SectionCard title="Corporate Accounts" icon={Building2} pad="none">
        <div className="divide-y divide-slate-200 dark:divide-slate-700">
          {accounts.map(acct => {
            const expanded = expandedAccts.has(acct.id);
            return (
              <div key={acct.id}>
                {/* Account header row */}
                <div
                  className="flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer"
                  onClick={() => toggleAcct(acct.id)}
                >
                  <div className="flex items-center gap-3">
                    {expanded ? <ChevronDown className="w-5 h-5 text-slate-400" /> : <ChevronRight className="w-5 h-5 text-slate-400" />}
                    <div className="w-10 h-10 bg-slate-200 dark:bg-slate-700 rounded-lg flex items-center justify-center">
                      <Building2 className="w-5 h-5 text-slate-500 dark:text-slate-400" />
                    </div>
                    <div>
                      <p className="font-medium text-slate-900 dark:text-white">{acct.name}</p>
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        {acct.industry || '—'} · {acct.annual_volume} nights/yr · {acct.rates.length} rate{acct.rates.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone={STATUS_TONE[acct.status] || 'neutral'}>{acct.status}</Badge>
                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => { setEditingRate(null); setRateForAcct(acct.id); setShowRateForm(true); }}
                        className="p-1.5 hover:bg-green-100 dark:hover:bg-green-900/30 rounded-lg transition-colors"
                        title="Add Rate"
                      >
                        <Plus className="w-5 h-5 text-green-600 dark:text-green-400" />
                      </button>
                      <button
                        onClick={() => { setEditingAcct(acct); setShowAcctForm(true); }}
                        className="p-1.5 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
                        title="Edit Account"
                      >
                        <Edit className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      </button>
                      <button
                        onClick={() => handleDeleteAcct(acct.id)}
                        disabled={actionLoading}
                        className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                        title="Delete Account"
                      >
                        <Trash2 className="w-5 h-5 text-red-600 dark:text-red-400" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Expanded rates */}
                {expanded && (
                  <div className="pl-12 pr-4 pb-4">
                    {acct.rates.length === 0 ? (
                      <p className="text-sm text-slate-500 py-3">No rates configured for this account.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700">
                            <tr>
                              {['Room Type', 'Rate Plan', 'Type', 'Rate', 'Meal Plan', 'Validity', 'Status', 'Actions'].map(h => (
                                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                            {acct.rates.map(r => (
                              <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                <td className="px-3 py-3 text-sm font-medium text-slate-900 dark:text-white">{r.room_type}</td>
                                <td className="px-3 py-3 text-sm text-slate-600 dark:text-slate-400">{r.rate_plan}</td>
                                <td className="px-3 py-3"><Badge tone={RATE_TYPE_TONE[r.rate_type] || 'neutral'}>{r.rate_type}</Badge></td>
                                <td className="px-3 py-3 text-sm font-medium text-slate-900 dark:text-white">{formatRateValue(r)}</td>
                                <td className="px-3 py-3 text-sm text-slate-600 dark:text-slate-400">{MEAL_PLAN_LABEL[r.meal_plan] || r.meal_plan}</td>
                                <td className="px-3 py-3 text-sm text-slate-600 dark:text-slate-400">{formatDateRange(r.start_date, r.end_date)}</td>
                                <td className="px-3 py-3"><Badge tone={STATUS_TONE[r.status] || 'neutral'}>{r.status}</Badge></td>
                                <td className="px-3 py-3">
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => { setEditingRate(r); setRateForAcct(acct.id); setShowRateForm(true); }}
                                      className="p-1.5 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
                                      title="Edit Rate"
                                    >
                                      <Edit className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteRate(r.id)}
                                      disabled={actionLoading}
                                      className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                                      title="Delete Rate"
                                    >
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
              </div>
            );
          })}
        </div>
        {accounts.length === 0 && (
          <div className="text-center py-12">
            <Building2 className="w-12 h-12 text-slate-400 mx-auto mb-4" />
            <p className="text-slate-600 dark:text-slate-400">No corporate accounts configured</p>
          </div>
        )}
      </SectionCard>

      {/* Account Form Modal */}
      {showAcctForm && (
        <AccountForm
          account={editingAcct}
          onCancel={() => { setShowAcctForm(false); setEditingAcct(null); }}
          onSave={handleSaveAcct}
          saving={actionLoading}
        />
      )}

      {/* Rate Form Modal */}
      {showRateForm && (
        <RateForm
          rate={editingRate}
          accounts={accounts}
          defaultAccountId={rateForAcct}
          onCancel={() => { setShowRateForm(false); setEditingRate(null); setRateForAcct(null); }}
          onSave={handleSaveRate}
          saving={actionLoading}
        />
      )}
    </div>
  );
};

// ── AccountForm (modal) ─────────────────────────────────────────────────
interface AccountFormProps {
  account: CorporateAccount | null;
  onCancel: () => void;
  onSave: (form: Record<string, any>) => void;
  saving: boolean;
}

const AccountForm = ({ account: a, onCancel, onSave, saving }: AccountFormProps) => {
  const [form, setForm] = useState({
    name: a?.name || '',
    contact_name: a?.contact_name || '',
    contact_email: a?.contact_email || '',
    contact_phone: a?.contact_phone || '',
    industry: a?.industry || '',
    annual_volume: a?.annual_volume ?? 0,
    status: a?.status || 'active',
    notes: a?.notes || '',
  });
  const set = (k: string, v: any) => setForm(prev => ({ ...prev, [k]: v }));

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto">
        <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{a ? 'Edit Account' : 'Add Corporate Account'}</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">Corporate account master record</p>
          </div>
          <button onClick={onCancel} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Account Name</label>
            <input type="text" value={form.name} onChange={e => set('name', e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
              placeholder="e.g. Acme Corp" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Contact Name</label>
              <input type="text" value={form.contact_name} onChange={e => set('contact_name', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Industry</label>
              <input type="text" value={form.industry} onChange={e => set('industry', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                placeholder="e.g. Technology" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Contact Email</label>
              <input type="email" value={form.contact_email} onChange={e => set('contact_email', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Contact Phone</label>
              <input type="tel" value={form.contact_phone} onChange={e => set('contact_phone', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Annual Volume (nights)</label>
              <input type="number" min="0" value={form.annual_volume} onChange={e => set('annual_volume', Number(e.target.value))}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white">
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="expired">Expired</option>
                <option value="terminated">Terminated</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
              className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white" />
          </div>
        </div>

        <div className="p-6 border-t border-slate-200 dark:border-slate-700 flex items-center justify-end gap-3">
          <button onClick={onCancel} className={button.secondary}>Cancel</button>
          <button onClick={() => onSave(form)} disabled={saving || !form.name} className={button.primary}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {a ? 'Save Changes' : 'Add Account'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── RateForm (modal) ────────────────────────────────────────────────────
interface RateFormProps {
  rate: CorporateRate | null;
  accounts: CorporateAccount[];
  defaultAccountId: string | null;
  onCancel: () => void;
  onSave: (form: Record<string, any>) => void;
  saving: boolean;
}

const RateForm = ({ rate: r, accounts, defaultAccountId, onCancel, onSave, saving }: RateFormProps) => {
  const [form, setForm] = useState({
    account_id: r?.account_id || defaultAccountId || '',
    room_type: r?.room_type || '',
    rate_plan: r?.rate_plan || 'Corporate',
    rate_type: r?.rate_type || 'fixed',
    rate_value: r?.rate_value ?? 0,
    currency: r?.currency || 'ETB',
    meal_plan: r?.meal_plan || 'BB',
    start_date: r?.start_date || new Date().toISOString().slice(0, 10),
    end_date: r?.end_date || '',
    status: r?.status || 'active',
    notes: r?.notes || '',
  });
  const set = (k: string, v: any) => setForm(prev => ({ ...prev, [k]: v }));

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto">
        <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{r ? 'Edit Rate' : 'Add Corporate Rate'}</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">Negotiated rate for an account + room type</p>
          </div>
          <button onClick={onCancel} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Account</label>
            <select value={form.account_id} onChange={e => set('account_id', e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white">
              <option value="">Select account…</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Room Type</label>
              <input type="text" value={form.room_type} onChange={e => set('room_type', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                placeholder="e.g. Deluxe Suite" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Rate Plan</label>
              <input type="text" value={form.rate_plan} onChange={e => set('rate_plan', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Rate Type</label>
              <select value={form.rate_type} onChange={e => set('rate_type', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white">
                <option value="fixed">Fixed</option>
                <option value="floating">Floating (off BAR)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                {form.rate_type === 'fixed' ? 'Rate Value' : '% off BAR (−)'}
              </label>
              <input type="number" step="0.01" value={form.rate_value} onChange={e => set('rate_value', Number(e.target.value))}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                placeholder={form.rate_type === 'fixed' ? 'e.g. 140' : 'e.g. -10'} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Currency</label>
              <input type="text" value={form.currency} onChange={e => set('currency', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Meal Plan</label>
              <select value={form.meal_plan} onChange={e => set('meal_plan', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white">
                <option value="RO">Room Only</option>
                <option value="BB">Bed & Breakfast</option>
                <option value="HB">Half Board</option>
                <option value="FB">Full Board</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Start Date</label>
              <input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">End Date (blank = open)</label>
              <input type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white">
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="expired">Expired</option>
                <option value="terminated">Terminated</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Notes</label>
              <input type="text" value={form.notes} onChange={e => set('notes', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white" />
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-slate-200 dark:border-slate-700 flex items-center justify-end gap-3">
          <button onClick={onCancel} className={button.secondary}>Cancel</button>
          <button onClick={() => onSave(form)} disabled={saving || !form.account_id || !form.room_type} className={button.primary}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {r ? 'Save Changes' : 'Add Rate'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CorporateRates;
