/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Negotiation Management — Supply Chain & Procurement Portal (/erp/procurement/negotiations).
 * Aligns with unified_supply_chain_procurement_portal.md section 13 (Sourcing Management).
 *
 * Negotiations are part of the sourcing workflow: after receiving quotations,
 * the procurement officer can negotiate price, terms, volume, or contract terms.
 *
 * Features:
 * - Negotiation types: Price, Terms, Volume, Contract, Combined
 * - Status flow: Open → In Progress → Agreed / Rejected / Expired
 * - Initial price vs target price vs final price tracking
 * - Savings calculation (initial - final)
 * - All 12 spec departments
 * - Negotiation rounds view
 * - Supplier selection from active suppliers
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  MessageSquare, Plus, RefreshCw, Loader2, TrendingDown,
  AlertCircle, CheckCircle2, X, Eye, Handshake,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchNegotiations, createNegotiation, updateNegotiation, fetchSuppliers,
  type Negotiation, type NegotiationStatus, type Supplier,
} from '../../services/procurementService';

const DEPARTMENTS = [
  'Food & Beverage', 'Kitchen', 'Housekeeping', 'Engineering & Maintenance',
  'Spa & Wellness', 'Banquet & Events', 'Transportation & Fleet',
  'Human Resources', 'Administration', 'Security & Risk', 'IT', 'Other',
] as const;

const NEGOTIATION_TYPES = ['Price', 'Terms', 'Volume', 'Contract', 'Combined'] as const;

const STATUS_TONE: Record<NegotiationStatus, any> = {
  Open: 'info', 'In Progress': 'warning', Agreed: 'success',
  Rejected: 'danger', Expired: 'neutral',
};

// Source system display labels for sourcing-originated negotiations
const SOURCE_LABELS: Record<string, { label: string; tone: 'info' | 'accent' | 'warning' }> = {
  procurement: { label: 'Procurement', tone: 'info' },
  rfq: { label: 'RFQ', tone: 'accent' },
  tender: { label: 'Tender', tone: 'accent' },
  engineering: { label: 'Engineering', tone: 'accent' },
  housekeeping: { label: 'Housekeeping', tone: 'accent' },
  food_beverage: { label: 'F&B', tone: 'accent' },
};

const NegotiationManagement: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [negotiations, setNegotiations] = useState<Negotiation[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [viewing, setViewing] = useState<Negotiation | null>(null);
  const [form, setForm] = useState({
    supplierId: '',
    department: 'Kitchen' as string,
    negotiationType: 'Price' as typeof NEGOTIATION_TYPES[number],
    initialPrice: 0,
    targetPrice: 0,
    notes: '',
  });

  const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [negData, supData] = await Promise.all([
        fetchNegotiations({ propertyId: currentPropertyId || undefined }),
        fetchSuppliers({ status: 'Active', propertyId: currentPropertyId || undefined }),
      ]);
      setNegotiations(negData.negotiations);
      setSuppliers(supData.suppliers);
    } catch (e: any) {
      setError(e?.message || 'Failed to load negotiations');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const submitCreate = async () => {
    if (!form.supplierId || !form.department) {
      addNotification('Supplier and department are required', 'warning', 'Procurement');
      return;
    }
    setSubmitting(true);
    try {
      const { negotiation } = await createNegotiation({
        propertyId: currentPropertyId || undefined,
        supplierId: form.supplierId,
        department: form.department,
        negotiationType: form.negotiationType,
        initialPrice: form.initialPrice,
        targetPrice: form.targetPrice,
        notes: form.notes,
      });
      setNegotiations((prev) => [negotiation, ...prev]);
      addNotification(`Negotiation ${negotiation.negotiation_number} created`, 'task', 'Procurement');
      setShowForm(false);
      setForm({ supplierId: '', department: 'Kitchen', negotiationType: 'Price', initialPrice: 0, targetPrice: 0, notes: '' });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create negotiation', 'warning', 'Procurement');
    } finally {
      setSubmitting(false);
    }
  };

  const changeStatus = async (id: string, status: NegotiationStatus, finalPrice?: number) => {
    setActingOn(id);
    try {
      const neg = negotiations.find(n => n.id === id);
      const savings = finalPrice && neg ? (neg.initial_price - finalPrice) : undefined;
      const { negotiation } = await updateNegotiation(id, { status, finalPrice, savingsAmount: savings });
      setNegotiations((prev) => prev.map((n) => (n.id === id ? negotiation : n)));
      addNotification(`Negotiation → ${status}`, 'task', 'Procurement');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update negotiation', 'warning', 'Procurement');
    } finally {
      setActingOn(null);
    }
  };

  const totalSavings = negotiations.reduce((sum, n) => sum + (n.savings_amount || 0), 0);
  const openCount = negotiations.filter((n) => n.status === 'Open' || n.status === 'In Progress').length;
  const agreedCount = negotiations.filter((n) => n.status === 'Agreed').length;

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Negotiation Management"
        subtitle="Track price, terms, and contract negotiations with suppliers."
        icon={MessageSquare}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button onClick={() => setShowForm(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> New Negotiation
            </button>
          </div>
        }
      />

      {error && (
        <SectionCard tone="danger" pad="md">
          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        </SectionCard>
      )}

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Open Negotiations" value={openCount} icon={MessageSquare} tone="warning" />
        <StatCard title="Agreed" value={agreedCount} icon={CheckCircle2} tone="success" />
        <StatCard title="Total Savings" value={`${totalSavings.toLocaleString()}`} icon={TrendingDown} tone="success" />
        <StatCard title="Total" value={negotiations.length} icon={Handshake} tone="neutral" />
      </div>

      {/* Negotiations List */}
      <SectionCard title="Negotiations" subtitle={`${negotiations.length} negotiation${negotiations.length !== 1 ? 's' : ''}`} pad="none">
        {loading ? (
          <div className="p-12 text-center"><Loader2 className="w-8 h-8 animate-spin text-indigo-600 mx-auto" /></div>
        ) : negotiations.length === 0 ? (
          <div className="p-12 text-center text-gray-500 dark:text-gray-400">
            <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No negotiations found</p>
            <p className="text-xs mt-1">Click "New Negotiation" to start one.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {negotiations.map((n) => (
              <div key={n.id} className="px-6 py-4 flex items-center justify-between gap-4 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors group">
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  <Badge tone={STATUS_TONE[n.status] || 'neutral'}>{n.status}</Badge>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{n.negotiation_number}</p>
                      {n.source_system && n.source_system !== 'procurement' && SOURCE_LABELS[n.source_system] && (
                        <Badge tone={SOURCE_LABELS[n.source_system].tone}>{SOURCE_LABELS[n.source_system].label}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{n.proc_suppliers?.legal_name || n.supplier_id} · {n.negotiation_type}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                      Initial: {n.initial_price?.toLocaleString() || '—'} → Target: {n.target_price?.toLocaleString() || '—'}
                      {n.final_price != null && ` → Final: ${n.final_price.toLocaleString()}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {n.savings_amount != null && n.savings_amount > 0 && (
                    <p className="text-sm font-bold text-green-600 tabular-nums">Saved: {n.savings_amount.toLocaleString()}</p>
                  )}
                  <button onClick={() => setViewing(n)} className="p-1.5 text-gray-400 hover:text-indigo-600 transition" title="View Details">
                    <Eye className="w-4 h-4" />
                  </button>
                  {n.status === 'Open' && (
                    <button onClick={() => changeStatus(n.id, 'In Progress')} disabled={actingOn === n.id} className="text-xs bg-indigo-600 text-white px-3 py-1 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                      Start
                    </button>
                  )}
                  {n.status === 'In Progress' && (
                    <>
                      <button onClick={() => changeStatus(n.id, 'Agreed', n.target_price || undefined)} disabled={actingOn === n.id} className="text-xs bg-green-600 text-white px-3 py-1 rounded-lg hover:bg-green-700 disabled:opacity-50">
                        Agree
                      </button>
                      <button onClick={() => changeStatus(n.id, 'Rejected')} disabled={actingOn === n.id} className="text-xs bg-red-600 text-white px-3 py-1 rounded-lg hover:bg-red-700 disabled:opacity-50">
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Create Modal */}
      <ModalSystem isOpen={showForm} onClose={() => setShowForm(false)} title="New Negotiation" size="lg" loading={submitting} confirmLabel="Create" onConfirm={submitCreate}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">Supplier *</label>
            <select className={inputClass} value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
              <option value="">Select supplier...</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.legal_name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Department</label>
              <select className={inputClass} value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Negotiation Type</label>
              <select className={inputClass} value={form.negotiationType} onChange={(e) => setForm({ ...form, negotiationType: e.target.value as any })}>
                {NEGOTIATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Initial Price</label>
              <input type="number" className={inputClass} value={form.initialPrice} onChange={(e) => setForm({ ...form, initialPrice: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Target Price</label>
              <input type="number" className={inputClass} value={form.targetPrice} onChange={(e) => setForm({ ...form, targetPrice: parseFloat(e.target.value) || 0 })} />
            </div>
          </div>
          {form.initialPrice > 0 && form.targetPrice > 0 && (
            <div className="p-3 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
              <p className="text-xs text-green-700 dark:text-green-300">
                Target savings: <span className="font-bold">{(form.initialPrice - form.targetPrice).toLocaleString()}</span>
                ({form.initialPrice > 0 ? Math.round(((form.initialPrice - form.targetPrice) / form.initialPrice) * 100) : 0}%)
              </p>
            </div>
          )}
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">Notes</label>
            <textarea className={inputClass} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Negotiation context and strategy" />
          </div>
        </div>
      </ModalSystem>

      {/* View Detail Modal */}
      {viewing && (
        <ModalSystem isOpen={!!viewing} onClose={() => setViewing(null)} title="Negotiation Details" size="lg" showFooter={false}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500 uppercase">Number</p>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.negotiation_number}</p>
                  {viewing.source_system && viewing.source_system !== 'procurement' && SOURCE_LABELS[viewing.source_system] && (
                    <Badge tone={SOURCE_LABELS[viewing.source_system].tone}>{SOURCE_LABELS[viewing.source_system].label}</Badge>
                  )}
                </div>
              </div>
              <div><p className="text-xs text-gray-500 uppercase">Status</p><Badge tone={STATUS_TONE[viewing.status] || 'neutral'}>{viewing.status}</Badge></div>
              <div><p className="text-xs text-gray-500 uppercase">Supplier</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.proc_suppliers?.legal_name || viewing.supplier_id}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Department</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.department}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Type</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.negotiation_type}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Started</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.started_at ? new Date(viewing.started_at).toLocaleDateString() : '—'}</p></div>
            </div>

            {/* Price tracking */}
            <div className="p-4 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800">
              <p className="text-xs font-bold text-gray-500 uppercase mb-3">Price Tracking</p>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <p className="text-xs text-gray-500">Initial</p>
                  <p className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">{viewing.initial_price?.toLocaleString() || '—'}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-500">Target</p>
                  <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400 tabular-nums">{viewing.target_price?.toLocaleString() || '—'}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-500">Final</p>
                  <p className="text-lg font-bold text-green-600 tabular-nums">{viewing.final_price?.toLocaleString() || '—'}</p>
                </div>
              </div>
              {viewing.savings_amount != null && viewing.savings_amount > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-slate-700 text-center">
                  <p className="text-sm font-bold text-green-600">Total Savings: {viewing.savings_amount.toLocaleString()}</p>
                </div>
              )}
            </div>

            {viewing.notes && (
              <div><p className="text-xs text-gray-500 uppercase mb-1">Notes</p><p className="text-sm text-gray-700 dark:text-gray-300">{viewing.notes}</p></div>
            )}

            {/* Negotiation rounds */}
            {viewing.proc_negotiation_rounds && viewing.proc_negotiation_rounds.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 uppercase mb-2">Negotiation Rounds</p>
                <div className="space-y-2">
                  {viewing.proc_negotiation_rounds.map((round, i) => (
                    <div key={round.id || i} className="p-3 border border-gray-200 dark:border-slate-700 rounded-xl">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-white">Round {round.round_number || i + 1}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{round.proposed_price?.toLocaleString() || '—'} → {round.counter_price?.toLocaleString() || '—'}</p>
                        </div>
                        <Badge tone={round.status === 'Accepted' ? 'success' : round.status === 'Rejected' ? 'danger' : 'warning'}>
                          {round.status || 'Pending'}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            {viewing.status === 'Open' && (
              <button onClick={() => { changeStatus(viewing.id, 'In Progress'); setViewing(null); }} className={button.primary + ' w-full'}>
                Start Negotiation
              </button>
            )}
            {viewing.status === 'In Progress' && (
              <div className="flex gap-2">
                <button onClick={() => { changeStatus(viewing.id, 'Agreed', viewing.target_price || undefined); setViewing(null); }} className={button.primary + ' flex-1'}>
                  <CheckCircle2 className="w-4 h-4" /> Agree
                </button>
                <button onClick={() => { changeStatus(viewing.id, 'Rejected'); setViewing(null); }} className="text-sm bg-red-600 text-white px-4 py-2 rounded-xl hover:bg-red-700 flex-1">
                  <X className="w-4 h-4 inline" /> Reject
                </button>
              </div>
            )}
          </div>
        </ModalSystem>
      )}
    </div>
  );
};

export default NegotiationManagement;
