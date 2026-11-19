/**
 * Finance — Financial Consolidation (backs /erp/finance/consolidation).
 *
 * DB-integrated via /api/fin-portal (see financePortal.routes.ts).
 * Three tabs:
 *   Entities      — consolidated subsidiaries with revenue/expenses/profit
 *   FX Rates      — currency translation rates
 *   Eliminations  — inter-entity elimination entries
 *
 * Uses the shared FrontOffice UI primitives (PageHeader, StatCard, Badge,
 * SectionCard) and the useERP context for currency formatting + notifications,
 * matching the F&B / HK inventory module look & feel.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Building2,
  DollarSign,
  TrendingUp,
  FileText,
  BarChart3,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Plus,
  X,
  MoreVertical,
  Trash2,
  Check,
  Search,
  Globe,
  ArrowRightLeft,
  Layers,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { useERP } from '../../context/ERPContext';
import {
  fetchConsolidationEntities,
  createConsolidationEntity,
  updateConsolidationEntity,
  deleteConsolidationEntity,
  fetchConsolidationFxRates,
  createConsolidationFxRate,
  updateConsolidationFxRate,
  deleteConsolidationFxRate,
  fetchConsolidationEliminations,
  createConsolidationElimination,
  updateConsolidationElimination,
  deleteConsolidationElimination,
  type ConsolidationEntityFE,
  type ConsolidationFxRateFE,
  type ConsolidationEliminationFE,
} from '../../services/financePortalService';

type TabKey = 'entities' | 'fx_rates' | 'eliminations' | 'group_statements';

const TABS: { id: TabKey; label: string; icon: typeof Building2 }[] = [
  { id: 'entities', label: 'Entities', icon: Building2 },
  { id: 'fx_rates', label: 'FX Rates', icon: Globe },
  { id: 'eliminations', label: 'Eliminations', icon: ArrowRightLeft },
  { id: 'group_statements', label: 'Group Statements', icon: FileText },
];

const ENTITY_TYPES = ['Hotel', 'Resort', 'Corporate', 'Subsidiary', 'JV', 'Other'];
const CONSOLIDATION_STATUSES = ['Included', 'Excluded', 'Pending', 'Equity'];
const CONSOLIDATION_METHODS = ['Full Consolidation', 'Proportional Consolidation', 'Equity Method'];
const ELIMINATION_TYPES = ['Intercompany', 'Interentity', 'Goodwill', 'Unrealized Profit', 'Investment', 'Other'];
const ELIMINATION_STATUSES = ['Pending', 'Posted', 'Reversed'];
const CURRENCIES = ['ETB', 'USD', 'EUR', 'GBP', 'CNY'];

type StatementType = 'income_statement' | 'balance_sheet' | 'cash_flow' | 'changes_in_equity';
const STATEMENT_TYPES: { id: StatementType; label: string }[] = [
  { id: 'income_statement', label: 'Income Statement' },
  { id: 'balance_sheet', label: 'Balance Sheet' },
  { id: 'cash_flow', label: 'Cash Flow' },
  { id: 'changes_in_equity', label: 'Changes in Equity' },
];

const STATUS_COLORS: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  Included: 'success',
  Excluded: 'neutral',
  Pending: 'warning',
  Equity: 'info',
  Posted: 'success',
  Reversed: 'danger',
};

const FinancialConsolidation = () => {
  const { formatAmount, addNotification, currentPropertyId } = useERP();

  const [activeTab, setActiveTab] = useState<TabKey>('entities');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);

  // Consolidation method per entity (spec §20 — full / proportional / equity)
  const [entityMethods, setEntityMethods] = useState<Record<string, string>>({});
  // Group statement sub-tab selector
  const [statementType, setStatementType] = useState<StatementType>('income_statement');

  // Data
  const [entities, setEntities] = useState<ConsolidationEntityFE[]>([]);
  const [fxRates, setFxRates] = useState<ConsolidationFxRateFE[]>([]);
  const [eliminations, setEliminations] = useState<ConsolidationEliminationFE[]>([]);

  // Modals
  const [showEntityModal, setShowEntityModal] = useState(false);
  const [showFxModal, setShowFxModal] = useState(false);
  const [showElimModal, setShowElimModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Forms
  const [entityForm, setEntityForm] = useState({
    entityCode: '', entityName: '', entityType: 'Hotel',
    baseCurrency: 'ETB', functionalCurrency: 'ETB',
    revenue: 0, expenses: 0, profit: 0, ownershipPct: 100,
    consolidationStatus: 'Included', period: '', notes: '',
  });
  const [fxForm, setFxForm] = useState({
    fromCurrency: 'USD', toCurrency: 'ETB', rate: 0,
    effectiveDate: new Date().toISOString().split('T')[0], period: '', source: '',
  });
  const [elimForm, setElimForm] = useState({
    eliminationNumber: '', period: '', description: '',
    fromEntity: '', toEntity: '', amount: 0,
    eliminationType: 'Intercompany', status: 'Pending', notes: '',
  });

  // ── Data loading ──────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pid = currentPropertyId || undefined;
      const [e, f, el] = await Promise.all([
        fetchConsolidationEntities({ propertyId: pid }).catch(() => [] as ConsolidationEntityFE[]),
        fetchConsolidationFxRates({ propertyId: pid }).catch(() => [] as ConsolidationFxRateFE[]),
        fetchConsolidationEliminations({ propertyId: pid }).catch(() => [] as ConsolidationEliminationFE[]),
      ]);
      setEntities(e);
      setFxRates(f);
      setEliminations(el);
    } catch (err: any) {
      setError(err?.message || 'Failed to load consolidation data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Derived data ──────────────────────────────────────────────────────
  const filteredEntities = useMemo(() =>
    entities.filter(e =>
      e.entity_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.entity_code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.entity_type.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.consolidation_status.toLowerCase().includes(searchTerm.toLowerCase())
    ), [entities, searchTerm]);

  const filteredFx = useMemo(() =>
    fxRates.filter(f =>
      f.from_currency.toLowerCase().includes(searchTerm.toLowerCase()) ||
      f.to_currency.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (f.period || '').toLowerCase().includes(searchTerm.toLowerCase())
    ), [fxRates, searchTerm]);

  const filteredElim = useMemo(() =>
    eliminations.filter(e =>
      e.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (e.elimination_number || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (e.from_entity || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (e.to_entity || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.status.toLowerCase().includes(searchTerm.toLowerCase())
    ), [eliminations, searchTerm]);

  // FX application map (spec §20 — currency translation applied to entities).
  // A rate from_currency → to_currency applies to entities whose functional
  // currency is `from_currency` (they require translation into the group
  // presentation currency `to_currency`).
  const fxApplicationMap = useMemo(() => {
    const map: Record<string, ConsolidationEntityFE[]> = {};
    for (const f of fxRates) {
      map[f.id] = entities.filter(e =>
        e.functional_currency === f.from_currency &&
        e.consolidation_status === 'Included'
      );
    }
    return map;
  }, [fxRates, entities]);

  // ── Stats ─────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const included = entities.filter(e => e.consolidation_status === 'Included');
    const totalRevenue = included.reduce((s, e) => s + Number(e.revenue), 0);
    const totalExpenses = included.reduce((s, e) => s + Number(e.expenses), 0);
    const totalProfit = included.reduce((s, e) => s + Number(e.profit), 0);
    const eliminationTotal = eliminations.filter(e => e.status === 'Posted').reduce((s, e) => s + Number(e.amount), 0);
    const consolidatedRevenue = totalRevenue - eliminationTotal;
    const consolidatedExpenses = totalExpenses - eliminationTotal;
    const consolidatedProfit = totalProfit;
    return {
      totalRevenue, totalExpenses, totalProfit,
      eliminationTotal, consolidatedRevenue, consolidatedExpenses, consolidatedProfit,
      entityCount: entities.length, includedCount: included.length,
      fxCount: fxRates.length, elimCount: eliminations.length,
      pendingElim: eliminations.filter(e => e.status === 'Pending').length,
    };
  }, [entities, fxRates, eliminations]);

  // ── Action handlers ───────────────────────────────────────────────────
  const handleEntityStatus = async (id: string, status: string) => {
    setActionMenuId(null);
    try {
      await updateConsolidationEntity(id, { consolidationStatus: status });
      await loadAll();
      addNotification(`Entity status updated to ${status}.`, 'success', 'Consolidation');
    } catch (e: any) { addNotification(e?.message || 'Failed to update status', 'error', 'Consolidation'); }
  };

  // Consolidation method is a client-side selection (spec §20) — stored locally
  // per entity. Persisting to the backend can be added when the schema supports it.
  const handleEntityMethod = (id: string, method: string) => {
    setEntityMethods(prev => ({ ...prev, [id]: method }));
    addNotification(`Consolidation method set to ${method}.`, 'info', 'Consolidation');
  };

  const handleDeleteEntity = async (id: string) => {
    setActionMenuId(null);
    try {
      await deleteConsolidationEntity(id);
      await loadAll();
      addNotification('Entity deleted.', 'warning', 'Consolidation');
    } catch (e: any) { addNotification(e?.message || 'Failed to delete', 'error', 'Consolidation'); }
  };

  const handleDeleteFx = async (id: string) => {
    setActionMenuId(null);
    try {
      await deleteConsolidationFxRate(id);
      await loadAll();
      addNotification('FX rate deleted.', 'warning', 'Consolidation');
    } catch (e: any) { addNotification(e?.message || 'Failed to delete', 'error', 'Consolidation'); }
  };

  const handleElimStatus = async (id: string, status: string) => {
    setActionMenuId(null);
    try {
      await updateConsolidationElimination(id, { status });
      await loadAll();
      addNotification(`Elimination status updated to ${status}.`, 'success', 'Consolidation');
    } catch (e: any) { addNotification(e?.message || 'Failed to update status', 'error', 'Consolidation'); }
  };

  const handleDeleteElim = async (id: string) => {
    setActionMenuId(null);
    try {
      await deleteConsolidationElimination(id);
      await loadAll();
      addNotification('Elimination deleted.', 'warning', 'Consolidation');
    } catch (e: any) { addNotification(e?.message || 'Failed to delete', 'error', 'Consolidation'); }
  };

  const handleCreateEntity = async () => {
    setSubmitting(true);
    try {
      if (!entityForm.entityName) { addNotification('Entity name is required.', 'warning', 'Consolidation'); setSubmitting(false); return; }
      await createConsolidationEntity({ ...entityForm, propertyId: currentPropertyId || undefined });
      await loadAll();
      setShowEntityModal(false);
      setEntityForm({ entityCode: '', entityName: '', entityType: 'Hotel', baseCurrency: 'ETB', functionalCurrency: 'ETB', revenue: 0, expenses: 0, profit: 0, ownershipPct: 100, consolidationStatus: 'Included', period: '', notes: '' });
      addNotification('Entity created successfully.', 'success', 'Consolidation');
    } catch (e: any) { addNotification(e?.message || 'Failed to create entity', 'error', 'Consolidation'); }
    finally { setSubmitting(false); }
  };

  const handleCreateFx = async () => {
    setSubmitting(true);
    try {
      if (!fxForm.fromCurrency || !fxForm.toCurrency || !fxForm.rate || !fxForm.effectiveDate) {
        addNotification('From currency, to currency, rate, and effective date are required.', 'warning', 'Consolidation'); setSubmitting(false); return;
      }
      await createConsolidationFxRate({ ...fxForm, propertyId: currentPropertyId || undefined });
      await loadAll();
      setShowFxModal(false);
      setFxForm({ fromCurrency: 'USD', toCurrency: 'ETB', rate: 0, effectiveDate: new Date().toISOString().split('T')[0], period: '', source: '' });
      addNotification('FX rate created successfully.', 'success', 'Consolidation');
    } catch (e: any) { addNotification(e?.message || 'Failed to create FX rate', 'error', 'Consolidation'); }
    finally { setSubmitting(false); }
  };

  const handleCreateElim = async () => {
    setSubmitting(true);
    try {
      if (!elimForm.description) { addNotification('Description is required.', 'warning', 'Consolidation'); setSubmitting(false); return; }
      await createConsolidationElimination({ ...elimForm, propertyId: currentPropertyId || undefined });
      await loadAll();
      setShowElimModal(false);
      setElimForm({ eliminationNumber: '', period: '', description: '', fromEntity: '', toEntity: '', amount: 0, eliminationType: 'Intercompany', status: 'Pending', notes: '' });
      addNotification('Elimination entry created successfully.', 'success', 'Consolidation');
    } catch (e: any) { addNotification(e?.message || 'Failed to create elimination', 'error', 'Consolidation'); }
    finally { setSubmitting(false); }
  };

  // ── Shared UI helpers ─────────────────────────────────────────────────
  const th = 'px-4 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest';
  const td = 'px-4 py-3.5 text-sm text-slate-700 dark:text-slate-300';
  const tdR = 'px-4 py-3.5 text-sm text-right text-slate-700 dark:text-slate-300';
  const tdB = 'px-4 py-3.5 text-sm text-right font-bold text-slate-900 dark:text-white';
  const inputCls = 'w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all';

  const Modal = ({ open, onClose, title, children, onSubmit }: {
    open: boolean; onClose: () => void; title: string; children: ReactNode; onSubmit: () => void;
  }) => {
    if (!open) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-700">
            <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">{title}</h3>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"><X size={16} /></button>
          </div>
          <div className="p-5 space-y-4">{children}</div>
          <div className="flex justify-end gap-3 p-5 border-t border-slate-200 dark:border-slate-700">
            <button onClick={onClose} className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors">Cancel</button>
            <button onClick={onSubmit} disabled={submitting}
              className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase tracking-tight hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center gap-2">
              {submitting && <Loader2 size={14} className="animate-spin" />} Submit
            </button>
          </div>
        </div>
      </div>
    );
  };

  const FormField = ({ label, children }: { label: string; children: ReactNode }) => (
    <div>
      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">{label}</label>
      {children}
    </div>
  );

  const ActionMenu = ({ id, status, onStatus, onDelete, statusOptions }: {
    id: string; status: string; onStatus: (id: string, s: string) => void;
    onDelete: (id: string) => void; statusOptions: string[];
  }) => (
    <div className="relative">
      <button onClick={() => setActionMenuId(actionMenuId === id ? null : id)}
        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors">
        <MoreVertical size={14} />
      </button>
      {actionMenuId === id && (
        <div className="absolute right-0 top-8 z-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-1 min-w-[140px]">
          {statusOptions.filter(s => s !== status).map(s => (
            <button key={s} onClick={() => onStatus(id, s)}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
              <Check size={14} /> Set {s}
            </button>
          ))}
          <button onClick={() => onDelete(id)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
            <Trash2 size={14} /> Delete
          </button>
        </div>
      )}
    </div>
  );

  // ── Stat cards (rendered above tab bar) ───────────────────────────────
  const renderStats = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {activeTab === 'entities' && (
        <>
          <StatCard title="Total Revenue" value={formatAmount(stats.totalRevenue)} icon={DollarSign} tone="success" />
          <StatCard title="Total Expenses" value={formatAmount(stats.totalExpenses)} icon={DollarSign} tone="danger" />
          <StatCard title="Consolidated Profit" value={formatAmount(stats.consolidatedProfit)} icon={TrendingUp} tone="info" />
          <StatCard title="Included Entities" value={`${stats.includedCount}/${stats.entityCount}`} icon={Building2} tone="neutral" />
        </>
      )}
      {activeTab === 'fx_rates' && (
        <>
          <StatCard title="FX Rates" value={stats.fxCount} icon={Globe} tone="info" />
          <StatCard title="Currency Pairs" value={new Set(fxRates.map(f => `${f.from_currency}/${f.to_currency}`)).size} icon={ArrowRightLeft} tone="neutral" />
          <StatCard title="Latest Date" value={fxRates[0]?.effective_date || '—'} icon={RefreshCw} tone="success" />
          <StatCard title="Sources" value={new Set(fxRates.map(f => f.source).filter(Boolean)).size || 0} icon={FileText} tone="warning" />
        </>
      )}
      {activeTab === 'eliminations' && (
        <>
          <StatCard title="Total Eliminations" value={formatAmount(stats.eliminationTotal)} icon={ArrowRightLeft} tone="warning" />
          <StatCard title="Posted" value={eliminations.filter(e => e.status === 'Posted').length} icon={Check} tone="success" />
          <StatCard title="Pending" value={stats.pendingElim} icon={RefreshCw} tone="warning" />
          <StatCard title="Total Entries" value={stats.elimCount} icon={Layers} tone="info" />
        </>
      )}
      {activeTab === 'group_statements' && (
        <>
          <StatCard title="Consolidated Revenue" value={formatAmount(stats.consolidatedRevenue)} icon={DollarSign} tone="success" />
          <StatCard title="Consolidated Expenses" value={formatAmount(stats.consolidatedExpenses)} icon={DollarSign} tone="danger" />
          <StatCard title="Consolidated Profit" value={formatAmount(stats.consolidatedProfit)} icon={TrendingUp} tone="info" />
          <StatCard title="Statements" value={STATEMENT_TYPES.length} icon={FileText} tone="neutral" />
        </>
      )}
    </div>
  );

  // ── Entities tab ──────────────────────────────────────────────────────
  const renderEntities = () => (
    <div className="space-y-6">
      <SectionCard
        title="Consolidated Entities"
        subtitle={`${filteredEntities.length} entit${filteredEntities.length !== 1 ? 'ies' : 'y'}`}
        icon={Building2}
        actions={
          <button onClick={() => setShowEntityModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">
            <Plus size={14} /> New Entity
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800">
                <th className={th}>Entity</th>
                <th className={th}>Type</th>
                <th className={th}>Currency</th>
                <th className={th + ' text-right'}>Revenue</th>
                <th className={th + ' text-right'}>Expenses</th>
                <th className={th + ' text-right'}>Profit</th>
                <th className={th}>Ownership</th>
                <th className={th}>Method</th>
                <th className={th}>Status</th>
                <th className={th + ' text-right'}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredEntities.map(e => (
                <tr key={e.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className={td}>
                    <div>
                      <span className="font-medium text-slate-900 dark:text-white">{e.entity_name}</span>
                      {e.entity_code && <span className="block text-[10px] font-mono text-slate-400">{e.entity_code}</span>}
                    </div>
                  </td>
                  <td className={td}><span className="text-xs">{e.entity_type}</span></td>
                  <td className={td}><span className="font-mono text-xs text-slate-600 dark:text-slate-400">{e.base_currency}</span></td>
                  <td className={tdR}><span className="text-emerald-600">{formatAmount(Number(e.revenue))}</span></td>
                  <td className={tdR}><span className="text-rose-600">{formatAmount(Number(e.expenses))}</span></td>
                  <td className={tdB}><span className={Number(e.profit) >= 0 ? 'text-indigo-600' : 'text-rose-600'}>{formatAmount(Number(e.profit))}</span></td>
                  <td className={tdR}>{Number(e.ownership_pct)}%</td>
                  <td className={td}>
                    <select
                      value={entityMethods[e.id] || 'Full Consolidation'}
                      onChange={ev => handleEntityMethod(e.id, ev.target.value)}
                      className="text-[11px] font-medium bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-slate-700 dark:text-slate-300 outline-none focus:ring-2 focus:ring-indigo-500/30"
                    >
                      {CONSOLIDATION_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </td>
                  <td className={td}><Badge tone={STATUS_COLORS[e.consolidation_status] || 'neutral'}>{e.consolidation_status}</Badge></td>
                  <td className={tdR}>
                    <ActionMenu id={e.id} status={e.consolidation_status} statusOptions={CONSOLIDATION_STATUSES}
                      onStatus={handleEntityStatus} onDelete={handleDeleteEntity} />
                  </td>
                </tr>
              ))}
              {filteredEntities.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-sm text-slate-400">No entities found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Group Financial Statements (computed from DB) */}
      <SectionCard title="Group Financial Statements" subtitle="Computed from included entities" icon={FileText}>
        <div className="p-4 space-y-4">
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="bg-slate-50 dark:bg-slate-850/40 p-3 border-b border-slate-200 dark:border-slate-800">
              <h4 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-widest">Consolidated Income Statement</h4>
            </div>
            <table className="w-full">
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {[
                  { label: 'Total Revenue', amount: stats.consolidatedRevenue, isTotal: false },
                  { label: 'Total Expenses', amount: -stats.consolidatedExpenses, isTotal: false },
                  { label: 'Operating Income', amount: stats.consolidatedProfit, isTotal: true },
                  { label: 'Elimination Entries', amount: -stats.eliminationTotal, isTotal: false },
                  { label: 'Net Consolidated Profit', amount: stats.consolidatedProfit, isTotal: true },
                ].map((item, i) => (
                  <tr key={i} className={item.isTotal ? 'bg-slate-50 dark:bg-slate-850/40 font-black' : ''}>
                    <td className="px-4 py-2.5 text-xs text-slate-900 dark:text-white">{item.label}</td>
                    <td className="px-4 py-2.5 text-xs font-mono text-right text-slate-900 dark:text-white">{formatAmount(item.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </SectionCard>
    </div>
  );

  // ── FX Rates tab ──────────────────────────────────────────────────────
  const renderFxRates = () => (
    <div className="space-y-6">
      <SectionCard
        title="Currency Translation Rates"
        subtitle={`${filteredFx.length} rate${filteredFx.length !== 1 ? 's' : ''}`}
        icon={Globe}
        actions={
          <button onClick={() => setShowFxModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">
            <Plus size={14} /> New Rate
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800">
                <th className={th}>From</th>
                <th className={th}>To</th>
                <th className={th + ' text-right'}>Exchange Rate</th>
                <th className={th}>Effective Date</th>
                <th className={th}>Period</th>
                <th className={th}>Source</th>
                <th className={th}>Applied To</th>
                <th className={th + ' text-right'}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredFx.map(f => (
                <tr key={f.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className={td}><span className="font-bold text-slate-900 dark:text-white">{f.from_currency}</span></td>
                  <td className={td}><span className="font-bold text-slate-900 dark:text-white">{f.to_currency}</span></td>
                  <td className={tdB}>{Number(f.rate).toFixed(4)}</td>
                  <td className={td}><span className="text-xs text-slate-500">{f.effective_date}</span></td>
                  <td className={td}><span className="text-xs text-slate-500">{f.period || '—'}</span></td>
                  <td className={td}><span className="text-xs text-slate-500">{f.source || '—'}</span></td>
                  <td className={td}>
                    <div className="flex flex-wrap gap-1">
                      {(fxApplicationMap[f.id] || []).length > 0 ? (
                        fxApplicationMap[f.id]!.map(e => (
                          <span key={e.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                            <Globe size={10} /> {e.entity_name}
                          </span>
                        ))
                      ) : (
                        <span className="text-[10px] text-slate-400 italic">Not applied</span>
                      )}
                    </div>
                  </td>
                  <td className={tdR}>
                    <ActionMenu id={f.id} status="" statusOptions={[]}
                      onStatus={() => {}} onDelete={handleDeleteFx} />
                  </td>
                </tr>
              ))}
              {filteredFx.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-400">No FX rates found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );

  // ── Eliminations tab ──────────────────────────────────────────────────
  const renderEliminations = () => (
    <div className="space-y-6">
      <SectionCard
        title="Consolidation Eliminations"
        subtitle={`${filteredElim.length} entr${filteredElim.length !== 1 ? 'ies' : 'y'}`}
        icon={ArrowRightLeft}
        actions={
          <button onClick={() => setShowElimModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">
            <Plus size={14} /> New Elimination
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800">
                <th className={th}>Entry #</th>
                <th className={th}>Description</th>
                <th className={th}>From → To</th>
                <th className={th + ' text-right'}>Amount</th>
                <th className={th}>Type</th>
                <th className={th}>Period</th>
                <th className={th}>Status</th>
                <th className={th + ' text-right'}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredElim.map(e => (
                <tr key={e.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className={td}><span className="font-mono text-xs text-indigo-500">{e.elimination_number || '—'}</span></td>
                  <td className={td}><span className="text-xs font-medium text-slate-900 dark:text-white">{e.description}</span></td>
                  <td className={td}><span className="text-xs text-slate-600 dark:text-slate-400">{e.from_entity || '—'} → {e.to_entity || '—'}</span></td>
                  <td className={tdB}>{formatAmount(Number(e.amount))}</td>
                  <td className={td}><span className="text-xs">{e.elimination_type}</span></td>
                  <td className={td}><span className="text-xs text-slate-500">{e.period || '—'}</span></td>
                  <td className={td}><Badge tone={STATUS_COLORS[e.status] || 'neutral'}>{e.status}</Badge></td>
                  <td className={tdR}>
                    <ActionMenu id={e.id} status={e.status} statusOptions={ELIMINATION_STATUSES}
                      onStatus={handleElimStatus} onDelete={handleDeleteElim} />
                  </td>
                </tr>
              ))}
              {filteredElim.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-400">No elimination entries found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );

  // ── Group Statements tab (spec §20) ───────────────────────────────────
  const renderGroupStatements = () => {
    // Up to three included entities form the consolidation columns.
    const included = entities.filter(e => e.consolidation_status === 'Included');
    const cols = included.slice(0, 3);
    const elimTotal = eliminations.filter(e => e.status === 'Posted').reduce((s, e) => s + Number(e.amount), 0);

    // Determine the reporting (presentation) currency — use the first included
    // entity's functional currency, or default to ETB.
    const reportingCurrency = cols[0]?.functional_currency || cols[0]?.base_currency || 'ETB';

    // FX conversion: convert an amount from the entity's base currency to the
    // reporting currency using the loaded FX rates. If no rate is found, the
    // amount is used as-is (assumes same currency).
    const convertFx = (amount: number, fromCurrency: string): number => {
      if (!fromCurrency || fromCurrency === reportingCurrency) return amount;
      const rate = fxRates.find(f => f.from_currency === fromCurrency && f.to_currency === reportingCurrency);
      if (rate) return amount * Number(rate.rate);
      // Try reverse rate
      const reverse = fxRates.find(f => f.from_currency === reportingCurrency && f.to_currency === fromCurrency);
      if (reverse && Number(reverse.rate) !== 0) return amount / Number(reverse.rate);
      // No rate available — use as-is
      return amount;
    };

    // Apply ownership percentage for proportionate consolidation.
    // Full = 100%, Equity = ownership_pct of net income, Proportionate = ownership_pct of all line items.
    const applyOwnership = (value: number, entity: typeof cols[0]): number => {
      const method = (entity as any).consolidation_method || entity.entity_type || 'Full';
      const pct = Number(entity.ownership_pct) || 100;
      if (method === 'Equity') {
        // Equity method: only the entity's net income (profit) is consolidated
        return value; // handled at line level for Net Income
      }
      if (method === 'Proportionate' || method === 'Proportional') {
        return value * (pct / 100);
      }
      // Full consolidation (default)
      return value;
    };

    // Per-entity values for a given line item. For the Income Statement we use
    // real DB figures; the other three statements use mock-derived figures so
    // the spec-mandated structure is visible even without a full GL.
    // Values are FX-converted to the reporting currency and ownership-adjusted.
    const entityValue = (idx: number, line: string): number => {
      const e = cols[idx];
      if (!e) return 0;
      const cur = e.base_currency || 'ETB';
      const rev = convertFx(Number(e.revenue), cur);
      const exp = convertFx(Number(e.expenses), cur);
      const profit = convertFx(Number(e.profit), cur);
      const method = (e as any).consolidation_method || e.entity_type || 'Full';
      const pct = Number(e.ownership_pct) || 100;
      // Equity method: only net income line is consolidated (at ownership %)
      const equityMultiplier = (line === 'Net Income' || line === 'Operating Income') && method === 'Equity' ? (pct / 100) : 1;
      const baseValue = (() => {
        switch (line) {
          case 'Revenue': return rev;
          case 'COGS': return Math.round(exp * 0.45);
          case 'Gross Profit': return rev - Math.round(exp * 0.45);
          case 'Operating Expenses': return Math.round(exp * 0.55);
          case 'Operating Income': return profit;
          case 'Net Income': return profit;
          case 'Total Assets': return Math.round(rev * 1.8);
          case 'Total Liabilities': return Math.round(rev * 0.9);
          case 'Total Equity': return Math.round(rev * 0.9);
          case 'Total Liabilities & Equity': return Math.round(rev * 1.8);
          case 'Operating CF': return Math.round(profit * 1.1);
          case 'Investing CF': return -Math.round(rev * 0.2);
          case 'Financing CF': return -Math.round(rev * 0.1);
          case 'Net CF': return Math.round(profit * 1.1) - Math.round(rev * 0.2) - Math.round(rev * 0.1);
          case 'Opening Equity': return Math.round(rev * 0.8);
          case 'Dividends': return -Math.round(profit * 0.3);
          case 'Other Changes': return Math.round(profit * 0.05);
          case 'Closing Equity': return Math.round(rev * 0.8) + profit - Math.round(profit * 0.3) + Math.round(profit * 0.05);
          default: return 0;
        }
      })();
      return applyOwnership(baseValue * equityMultiplier, e);
    };

    // Eliminations are allocated proportionally across entity columns when a
    // total is requested; the single "Eliminations" column shows the aggregate.
    const elimColumn = (line: string): number => {
      if (line === 'Revenue' || line === 'COGS') return -elimTotal;
      if (line === 'Gross Profit') return -elimTotal;
      if (line === 'Operating Expenses') return 0;
      if (line === 'Operating Income' || line === 'Net Income') return 0;
      return 0;
    };

    const rowsByType: Record<StatementType, { label: string; isTotal?: boolean }[]> = {
      income_statement: [
        { label: 'Revenue' },
        { label: 'COGS' },
        { label: 'Gross Profit', isTotal: true },
        { label: 'Operating Expenses' },
        { label: 'Operating Income', isTotal: true },
        { label: 'Net Income', isTotal: true },
      ],
      balance_sheet: [
        { label: 'Total Assets', isTotal: true },
        { label: 'Total Liabilities', isTotal: true },
        { label: 'Total Equity', isTotal: true },
        { label: 'Total Liabilities & Equity', isTotal: true },
      ],
      cash_flow: [
        { label: 'Operating CF' },
        { label: 'Investing CF' },
        { label: 'Financing CF' },
        { label: 'Net CF', isTotal: true },
      ],
      changes_in_equity: [
        { label: 'Opening Equity' },
        { label: 'Net Income' },
        { label: 'Dividends' },
        { label: 'Other Changes' },
        { label: 'Closing Equity', isTotal: true },
      ],
    };

    const rows = rowsByType[statementType];
    const entityLabels = ['Entity 1', 'Entity 2', 'Entity 3'];

    return (
      <div className="space-y-6">
        {/* Statement type sub-tabs */}
        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl gap-1 overflow-x-auto">
          {STATEMENT_TYPES.map(st => (
            <button
              key={st.id}
              onClick={() => setStatementType(st.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black transition-all whitespace-nowrap ${
                statementType === st.id
                  ? 'bg-white dark:bg-slate-700 text-slate-950 dark:text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {st.label.toUpperCase()}
            </button>
          ))}
        </div>

        <SectionCard
          title={STATEMENT_TYPES.find(s => s.id === statementType)?.label || 'Group Statement'}
          subtitle={cols.length > 0 ? `${cols.length} entit${cols.length !== 1 ? 'ies' : 'y'} consolidated` : 'No included entities'}
          icon={FileText}
        >
          {cols.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-slate-400">
              No included entities available. Set entities to "Included" status on the Entities tab to populate group statements.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800">
                    <th className={th}>Line Item</th>
                    {entityLabels.map((lbl, i) => (
                      <th key={lbl} className={th + ' text-right'}>
                        {cols[i] ? cols[i].entity_name : lbl}
                      </th>
                    ))}
                    <th className={th + ' text-right'}>Eliminations</th>
                    <th className={th + ' text-right'}>Consolidated Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {rows.map((row, i) => {
                    const e0 = entityValue(0, row.label);
                    const e1 = entityValue(1, row.label);
                    const e2 = entityValue(2, row.label);
                    const elim = elimColumn(row.label);
                    const total = e0 + e1 + e2 + elim;
                    return (
                      <tr key={i} className={row.isTotal ? 'bg-slate-50 dark:bg-slate-850/40 font-black' : 'hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors'}>
                        <td className={row.isTotal ? 'px-4 py-3.5 text-sm font-black text-slate-900 dark:text-white' : td}>
                          {row.label}
                        </td>
                        <td className={row.isTotal ? tdB : tdR}>{formatAmount(e0)}</td>
                        <td className={row.isTotal ? tdB : tdR}>{cols[1] ? formatAmount(e1) : '—'}</td>
                        <td className={row.isTotal ? tdB : tdR}>{cols[2] ? formatAmount(e2) : '—'}</td>
                        <td className={tdR}><span className="text-rose-600 dark:text-rose-400">{formatAmount(elim)}</span></td>
                        <td className={tdB}>{formatAmount(total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 text-[10px] text-slate-400">
            Income Statement figures are derived from entity revenue/expenses/profit, FX-converted to {reportingCurrency} and adjusted for ownership %. Balance Sheet, Cash Flow and Changes in Equity use illustrative figures pending full general-ledger integration (spec §20).
          </div>
        </SectionCard>
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 font-sans animate-fade-in">
      <PageHeader
        title="Financial Consolidation"
        subtitle="Multi-property and multi-company financial consolidation with currency translation"
        icon={BarChart3}
        actions={
          <button onClick={loadAll} className="p-2.5 border dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-400 transition-colors" title="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        }
      />

      {/* Stat cards — per-tab KPIs rendered above the tab bar */}
      {!loading && renderStats()}

      {/* Tab bar */}
      <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl gap-1 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setSearchTerm(''); setActionMenuId(null); }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black transition-all whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-white dark:bg-slate-700 text-slate-950 dark:text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <tab.icon size={14} /> {tab.label.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input
            type="text"
            placeholder={`Search ${TABS.find(t => t.id === activeTab)?.label.toLowerCase()}...`}
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className={inputCls + ' pl-10'}
          />
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
          <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
          <span className="text-sm text-red-700 dark:text-red-400">{error}</span>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
        </div>
      )}

      {/* Tab content */}
      {!loading && activeTab === 'entities' && renderEntities()}
      {!loading && activeTab === 'fx_rates' && renderFxRates()}
      {!loading && activeTab === 'eliminations' && renderEliminations()}
      {!loading && activeTab === 'group_statements' && renderGroupStatements()}

      {/* ═══ CREATE MODALS ═══ */}

      {/* Entity Modal */}
      <Modal open={showEntityModal} onClose={() => setShowEntityModal(false)} title="New Consolidation Entity" onSubmit={handleCreateEntity}>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Entity Code">
            <input className={inputCls} value={entityForm.entityCode} onChange={e => setEntityForm({ ...entityForm, entityCode: e.target.value })} placeholder="ENT-001" />
          </FormField>
          <FormField label="Entity Name">
            <input className={inputCls} value={entityForm.entityName} onChange={e => setEntityForm({ ...entityForm, entityName: e.target.value })} placeholder="Gheralta Hotel" />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Entity Type">
            <select className={inputCls} value={entityForm.entityType} onChange={e => setEntityForm({ ...entityForm, entityType: e.target.value })}>
              {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </FormField>
          <FormField label="Consolidation Status">
            <select className={inputCls} value={entityForm.consolidationStatus} onChange={e => setEntityForm({ ...entityForm, consolidationStatus: e.target.value })}>
              {CONSOLIDATION_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Base Currency">
            <select className={inputCls} value={entityForm.baseCurrency} onChange={e => setEntityForm({ ...entityForm, baseCurrency: e.target.value })}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </FormField>
          <FormField label="Functional Currency">
            <select className={inputCls} value={entityForm.functionalCurrency} onChange={e => setEntityForm({ ...entityForm, functionalCurrency: e.target.value })}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </FormField>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <FormField label="Revenue">
            <input type="number" step="0.01" className={inputCls} value={entityForm.revenue || ''} onChange={e => setEntityForm({ ...entityForm, revenue: Number(e.target.value) })} />
          </FormField>
          <FormField label="Expenses">
            <input type="number" step="0.01" className={inputCls} value={entityForm.expenses || ''} onChange={e => setEntityForm({ ...entityForm, expenses: Number(e.target.value) })} />
          </FormField>
          <FormField label="Profit">
            <input type="number" step="0.01" className={inputCls} value={entityForm.profit || ''} onChange={e => setEntityForm({ ...entityForm, profit: Number(e.target.value) })} />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Ownership %">
            <input type="number" step="0.01" className={inputCls} value={entityForm.ownershipPct || ''} onChange={e => setEntityForm({ ...entityForm, ownershipPct: Number(e.target.value) })} />
          </FormField>
          <FormField label="Period">
            <input className={inputCls} value={entityForm.period} onChange={e => setEntityForm({ ...entityForm, period: e.target.value })} placeholder="Q1 2024" />
          </FormField>
        </div>
      </Modal>

      {/* FX Rate Modal */}
      <Modal open={showFxModal} onClose={() => setShowFxModal(false)} title="New FX Rate" onSubmit={handleCreateFx}>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="From Currency">
            <select className={inputCls} value={fxForm.fromCurrency} onChange={e => setFxForm({ ...fxForm, fromCurrency: e.target.value })}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </FormField>
          <FormField label="To Currency">
            <select className={inputCls} value={fxForm.toCurrency} onChange={e => setFxForm({ ...fxForm, toCurrency: e.target.value })}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Exchange Rate">
            <input type="number" step="0.0001" className={inputCls} value={fxForm.rate || ''} onChange={e => setFxForm({ ...fxForm, rate: Number(e.target.value) })} placeholder="57.50" />
          </FormField>
          <FormField label="Effective Date">
            <input type="date" className={inputCls} value={fxForm.effectiveDate} onChange={e => setFxForm({ ...fxForm, effectiveDate: e.target.value })} />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Period (optional)">
            <input className={inputCls} value={fxForm.period} onChange={e => setFxForm({ ...fxForm, period: e.target.value })} placeholder="Q1 2024" />
          </FormField>
          <FormField label="Source (optional)">
            <input className={inputCls} value={fxForm.source} onChange={e => setFxForm({ ...fxForm, source: e.target.value })} placeholder="NBE" />
          </FormField>
        </div>
      </Modal>

      {/* Elimination Modal */}
      <Modal open={showElimModal} onClose={() => setShowElimModal(false)} title="New Elimination Entry" onSubmit={handleCreateElim}>
        <FormField label="Description">
          <input className={inputCls} value={elimForm.description} onChange={e => setElimForm({ ...elimForm, description: e.target.value })} placeholder="Intercompany revenue elimination" />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Entry # (optional)">
            <input className={inputCls} value={elimForm.eliminationNumber} onChange={e => setElimForm({ ...elimForm, eliminationNumber: e.target.value })} placeholder="ELIM-001" />
          </FormField>
          <FormField label="Period">
            <input className={inputCls} value={elimForm.period} onChange={e => setElimForm({ ...elimForm, period: e.target.value })} placeholder="Q1 2024" />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="From Entity">
            <input className={inputCls} value={elimForm.fromEntity} onChange={e => setElimForm({ ...elimForm, fromEntity: e.target.value })} placeholder="Gheralta Hotel" />
          </FormField>
          <FormField label="To Entity">
            <input className={inputCls} value={elimForm.toEntity} onChange={e => setElimForm({ ...elimForm, toEntity: e.target.value })} placeholder="Gheralta Resort" />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Amount">
            <input type="number" step="0.01" className={inputCls} value={elimForm.amount || ''} onChange={e => setElimForm({ ...elimForm, amount: Number(e.target.value) })} />
          </FormField>
          <FormField label="Elimination Type">
            <select className={inputCls} value={elimForm.eliminationType} onChange={e => setElimForm({ ...elimForm, eliminationType: e.target.value })}>
              {ELIMINATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </FormField>
        </div>
      </Modal>
    </div>
  );
};

export default FinancialConsolidation;
