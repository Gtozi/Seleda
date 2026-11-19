/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Contract Management — Supply Chain & Procurement Portal (/erp/procurement/contracts).
 * Aligns with unified_supply_chain_procurement_portal.md sections 31, 32, 33, 34.
 *
 * Contract types (spec section 31):
 *   Supplier Contract, Framework Agreement, Rate Agreement, Service Agreement,
 *   Volume Agreement, Long-Term Agreement, Exclusive Agreement
 *
 * Contract data (spec section 31):
 *   Contract Number, Supplier, Property, Category, Start Date, End Date,
 *   Renewal Date, Contract Value, Currency, Payment Terms, SLA, Penalties,
 *   Minimum Commitment, Maximum Commitment, Pricing Rules
 *
 * Contract lifecycle (spec section 32):
 *   Draft → Review → Approval → Active → Renewal Review → Renewed/Expired → Closed
 *
 * Contract alerts (spec section 33):
 *   90/60/30 days before expiry, renewal date, SLA breach, price review,
 *   minimum/maximum volume — alert periods configurable
 *
 * Supplier pricing (spec section 34):
 *   Current Price, Contract Price, Negotiated Price, Historical Price, Market Reference Price
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FileText, Plus, Search, RefreshCw, Loader2, AlertCircle,
  Eye, ArrowRight, AlertTriangle, Clock, FileSignature, CheckCircle2,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchContracts, createContract, updateContract, fetchSuppliers,
  type Contract, type ContractStatus, type ContractType, type Supplier,
} from '../../services/procurementService';

// Spec section 31: Contract types
const CONTRACT_TYPES: ContractType[] = [
  'Supplier Contract', 'Framework Agreement', 'Rate Agreement',
  'Service Agreement', 'Volume Agreement', 'Long-Term Agreement',
  'Exclusive Agreement',
];

// Spec section 32: Lifecycle
const STATUS_FLOW: ContractStatus[] = [
  'Draft', 'Review', 'Approval', 'Active', 'Renewal Review', 'Renewed', 'Closed',
];
const ALT_STATUSES: ContractStatus[] = ['Expired'];

const STATUS_TONE: Record<ContractStatus, StatusTone> = {
  Draft: 'neutral', Review: 'info', Approval: 'warning', Active: 'success',
  'Renewal Review': 'warning', Renewed: 'accent', Expired: 'danger', Closed: 'neutral',
};

const NEXT_STATUS: Record<ContractStatus, ContractStatus | null> = {
  Draft: 'Review', Review: 'Approval', Approval: 'Active', Active: 'Renewal Review',
  'Renewal Review': 'Renewed', Renewed: 'Closed', Closed: null, Expired: 'Closed',
};

const ACTION_LABELS: Record<ContractStatus, string> = {
  Draft: 'Submit for Review', Review: 'Submit for Approval', Approval: 'Activate',
  Active: 'Start Renewal Review', 'Renewal Review': 'Mark Renewed',
  Renewed: 'Close', Closed: 'Closed', Expired: 'Close',
};

// Spec section 33: Alert periods
const ALERT_PERIODS = ['90 days', '60 days', '30 days', 'Renewal date', 'SLA breach', 'Price review', 'Min volume', 'Max volume'];

// Spec section 34: Pricing types
const PRICING_TYPES = ['Current Price', 'Contract Price', 'Negotiated Price', 'Historical Price', 'Market Reference Price'];

const fmtMoney = (n: number, currency = 'ETB') => `${currency} ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const isExpiringSoon = (endDate: string, days = 90) => {
  if (!endDate) return false;
  const diff = (new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= days;
};

const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

const ContractManagement: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [viewing, setViewing] = useState<Contract | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | ContractStatus>('All');
  const [typeFilter, setTypeFilter] = useState<'All' | ContractType>('All');
  const [form, setForm] = useState({
    supplierId: '', category: '', contractType: 'Supplier Contract' as ContractType,
    startDate: '', endDate: '', renewalDate: '', contractValue: 0, currency: 'ETB',
    paymentTerms: '', sla: '', penalties: '', minCommitment: 0, maxCommitment: 0, autoRenew: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [conData, supData] = await Promise.all([
        fetchContracts({ propertyId: currentPropertyId || undefined }),
        fetchSuppliers({ status: 'Active', propertyId: currentPropertyId || undefined }),
      ]);
      setContracts(conData.contracts);
      setSuppliers(supData.suppliers);
    } catch (e: any) {
      setError(e?.message || 'Failed to load contracts');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    return contracts.filter((c) => {
      if (statusFilter !== 'All' && c.status !== statusFilter) return false;
      if (typeFilter !== 'All' && c.contract_type !== typeFilter) return false;
      const q = search.trim().toLowerCase();
      return !q || (c.contract_number || '').toLowerCase().includes(q) || (c.category || '').toLowerCase().includes(q) || (c.proc_suppliers?.legal_name || '').toLowerCase().includes(q);
    });
  }, [contracts, search, statusFilter, typeFilter]);

  const submitCreate = async () => {
    if (!form.supplierId || !form.category || !form.startDate || !form.endDate) {
      addNotification('Supplier, category, start date, and end date are required', 'warning', 'Procurement');
      return;
    }
    setSubmitting(true);
    try {
      const { contract } = await createContract({
        supplierId: form.supplierId, propertyId: currentPropertyId || undefined,
        category: form.category, contractType: form.contractType,
        startDate: form.startDate, endDate: form.endDate, renewalDate: form.renewalDate || undefined,
        contractValue: form.contractValue, currency: form.currency, paymentTerms: form.paymentTerms,
        sla: form.sla, penalties: form.penalties, minCommitment: form.minCommitment,
        maxCommitment: form.maxCommitment, autoRenew: form.autoRenew,
      });
      setContracts((prev) => [contract, ...prev]);
      addNotification(`Contract ${contract.contract_number} created`, 'task', 'Procurement');
      setShowForm(false);
      setForm({ supplierId: '', category: '', contractType: 'Supplier Contract', startDate: '', endDate: '', renewalDate: '', contractValue: 0, currency: 'ETB', paymentTerms: '', sla: '', penalties: '', minCommitment: 0, maxCommitment: 0, autoRenew: false });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create contract', 'warning', 'Procurement');
    } finally {
      setSubmitting(false);
    }
  };

  const changeStatus = async (id: string, status: ContractStatus) => {
    setActingOn(id);
    try {
      const { contract } = await updateContract(id, { status });
      setContracts((prev) => prev.map((c) => (c.id === id ? contract : c)));
      addNotification(`Contract → ${status}`, 'task', 'Procurement');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update status', 'warning', 'Procurement');
    } finally {
      setActingOn(null);
    }
  };

  const counts = {
    active: contracts.filter((c) => c.status === 'Active').length,
    pending: contracts.filter((c) => c.status === 'Draft' || c.status === 'Review' || c.status === 'Approval').length,
    renewal: contracts.filter((c) => c.status === 'Renewal Review').length,
    expiringSoon: contracts.filter((c) => isExpiringSoon(c.end_date)).length,
  };

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Contract Management"
        subtitle="Supplier contracts and agreements per specification sections 31-34."
        icon={FileSignature}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button onClick={() => setShowForm(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> New Contract
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
        <StatCard title="Active" value={counts.active} icon={CheckCircle2} tone="success" />
        <StatCard title="Pending Approval" value={counts.pending} icon={Clock} tone="warning" />
        <StatCard title="Renewal Review" value={counts.renewal} icon={AlertTriangle} tone="warning" />
        <StatCard title="Expiring Soon" value={counts.expiringSoon} icon={AlertCircle} tone="danger" />
      </div>

      {/* Lifecycle (spec section 32) */}
      <SectionCard title="Contract Lifecycle" subtitle="Per specification section 32" icon={ArrowRight} pad="md">
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_FLOW.map((s, i) => (
            <React.Fragment key={s}>
              <div className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${statusTone[STATUS_TONE[s]] || 'border-gray-200 text-gray-600'}`}>
                {s}
              </div>
              {i < STATUS_FLOW.length - 1 && <ArrowRight className="w-3 h-3 text-gray-400" />}
            </React.Fragment>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">Alternative:</span>
          {ALT_STATUSES.map((s) => <Badge key={s} tone={STATUS_TONE[s]}>{s}</Badge>)}
        </div>
      </SectionCard>

      {/* Contract Alerts (spec section 33) */}
      <SectionCard title="Contract Alerts" subtitle="Per specification section 33 — alert periods configurable" icon={AlertTriangle} pad="md">
        <div className="flex flex-wrap gap-1.5">
          {ALERT_PERIODS.map((a) => (
            <span key={a} className="px-2 py-1 text-xs rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">{a}</span>
          ))}
        </div>
      </SectionCard>

      {/* Filters */}
      <SectionCard pad="md">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input className={inputClass + ' pl-10'} placeholder="Search by contract number, supplier, category..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className={inputClass + ' max-w-[160px]'} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
            <option value="All">All Status</option>
            {[...STATUS_FLOW, ...ALT_STATUSES].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className={inputClass + ' max-w-[180px]'} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)}>
            <option value="All">All Types</option>
            {CONTRACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </SectionCard>

      {/* Contracts List */}
      <SectionCard title="Contracts" subtitle={`${filtered.length} contract${filtered.length !== 1 ? 's' : ''}`} pad="none">
        {loading ? (
          <div className="flex items-center justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-gray-500 dark:text-gray-400">
            <FileSignature className="w-12 h-12 mb-3 opacity-50" />
            <p className="text-sm">No contracts found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {filtered.map((c) => (
              <div key={c.id} className="px-6 py-4 flex items-center justify-between gap-4 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{c.contract_number}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{c.proc_suppliers?.legal_name || c.supplier_id} · {c.contract_type} · {c.category}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{c.start_date} → {c.end_date}</p>
                    {isExpiringSoon(c.end_date) && <p className="text-xs text-amber-500">Expiring soon</p>}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {c.contract_value != null && <p className="text-sm font-mono font-bold text-gray-900 dark:text-white tabular-nums">{fmtMoney(c.contract_value, c.currency)}</p>}
                  <button onClick={() => setViewing(c)} className="p-1.5 text-gray-400 hover:text-indigo-600 transition" title="View">
                    <Eye className="w-4 h-4" />
                  </button>
                  {NEXT_STATUS[c.status] && (
                    <button onClick={() => changeStatus(c.id, NEXT_STATUS[c.status]!)} disabled={actingOn === c.id} className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                      {ACTION_LABELS[c.status]}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Create Modal */}
      <ModalSystem isOpen={showForm} onClose={() => setShowForm(false)} title="New Contract" size="xl" loading={submitting} confirmLabel="Create" onConfirm={submitCreate}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Supplier *</label>
              <select className={inputClass} value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
                <option value="">Select supplier...</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.legal_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Contract Type *</label>
              <select className={inputClass} value={form.contractType} onChange={(e) => setForm({ ...form, contractType: e.target.value as ContractType })}>
                {CONTRACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Category *</label>
              <input className={inputClass} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Food & Beverage" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Currency</label>
              <select className={inputClass} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                <option value="ETB">ETB</option><option value="USD">USD</option><option value="EUR">EUR</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Start Date *</label>
              <input type="date" className={inputClass} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">End Date *</label>
              <input type="date" className={inputClass} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Renewal Date</label>
              <input type="date" className={inputClass} value={form.renewalDate} onChange={(e) => setForm({ ...form, renewalDate: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Contract Value</label>
              <input type="number" className={inputClass} value={form.contractValue} onChange={(e) => setForm({ ...form, contractValue: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Payment Terms</label>
              <input className={inputClass} value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} placeholder="e.g. Net 30" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">SLA</label>
              <input className={inputClass} value={form.sla} onChange={(e) => setForm({ ...form, sla: e.target.value })} placeholder="Service level agreement" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Penalties</label>
              <input className={inputClass} value={form.penalties} onChange={(e) => setForm({ ...form, penalties: e.target.value })} placeholder="Penalty terms" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Min Commitment</label>
              <input type="number" className={inputClass} value={form.minCommitment} onChange={(e) => setForm({ ...form, minCommitment: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Max Commitment</label>
              <input type="number" className={inputClass} value={form.maxCommitment} onChange={(e) => setForm({ ...form, maxCommitment: parseFloat(e.target.value) || 0 })} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={form.autoRenew} onChange={(e) => setForm({ ...form, autoRenew: e.target.checked })} className="rounded border-gray-300" />
            Auto-renew
          </label>
        </div>
      </ModalSystem>

      {/* View Detail Modal */}
      {viewing && (
        <ModalSystem isOpen={!!viewing} onClose={() => setViewing(null)} title="Contract Details" size="lg" showFooter={false}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-xs text-gray-500 uppercase">Contract Number</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.contract_number}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Status</p><Badge tone={STATUS_TONE[viewing.status]}>{viewing.status}</Badge></div>
              <div><p className="text-xs text-gray-500 uppercase">Supplier</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.proc_suppliers?.legal_name || viewing.supplier_id}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Type</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.contract_type}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Category</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.category}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Value</p><p className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">{fmtMoney(viewing.contract_value, viewing.currency)}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Start Date</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.start_date}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">End Date</p><p className={`text-sm font-medium ${isExpiringSoon(viewing.end_date) ? 'text-amber-500' : 'text-gray-900 dark:text-white'}`}>{viewing.end_date}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Renewal Date</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.renewal_date || '—'}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Payment Terms</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.payment_terms || '—'}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">SLA</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.sla || '—'}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Penalties</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.penalties || '—'}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Min Commitment</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.min_commitment || '—'}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Max Commitment</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.max_commitment || '—'}</p></div>
            </div>

            {/* Supplier Pricing (spec section 34) */}
            <div className="p-3 rounded-xl bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700">
              <p className="text-xs font-bold text-gray-600 dark:text-gray-400 mb-2">Supplier Pricing Types (Spec §34)</p>
              <div className="flex flex-wrap gap-1.5">
                {PRICING_TYPES.map((p) => <span key={p} className="px-2 py-1 text-xs rounded-lg bg-white dark:bg-slate-700 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-slate-600">{p}</span>)}
              </div>
            </div>

            <div className="flex gap-2 pt-4 border-t border-gray-200 dark:border-slate-700">
              {NEXT_STATUS[viewing.status] && (
                <button onClick={() => { changeStatus(viewing.id, NEXT_STATUS[viewing.status]!); setViewing(null); }} disabled={actingOn === viewing.id} className={button.primary}>
                  {ACTION_LABELS[viewing.status]}
                </button>
              )}
            </div>
          </div>
        </ModalSystem>
      )}
    </div>
  );
};

export default ContractManagement;
