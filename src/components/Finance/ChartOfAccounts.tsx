import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FileText,
  Plus,
  Search,
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
  AlertCircle,
  MoreVertical,
  Eye,
  Edit3,
  Trash2,
  Save,
  X,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { ModalSystem } from '../Shared/ModalSystem';
import { DataTable, Column } from '../Shared/DataTable';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import StatCard from '../FrontOffice/StatCard';
import {
  fetchChartOfAccounts,
  createChartOfAccount,
  updateChartOfAccount,
  deleteChartOfAccount,
  type ChartOfAccountFE,
} from '../../services/financePortalService';

const CATEGORIES = [
  'All', 'Asset', 'Liability', 'Equity', 'Revenue',
  'Cost of Sales', 'Operating Expenses', 'Other Income', 'Other Expenses',
];

const CATEGORY_TONE: Record<string, StatusTone> = {
  Asset: 'info',
  Liability: 'warning',
  Equity: 'accent',
  Revenue: 'success',
  'Cost of Sales': 'danger',
  'Operating Expenses': 'danger',
  'Other Income': 'success',
  'Other Expenses': 'danger',
};

const DEPARTMENTS = [
  'Front Office', 'Housekeeping', 'Engineering', 'Food & Beverage',
  'Kitchen', 'Laundry', 'Spa', 'Sales & Marketing',
  'Administration', 'Security', 'IT',
];

const ChartOfAccounts = () => {
  const { currentPropertyId, addNotification, properties } = useERP();
  const [accounts, setAccounts] = useState<ChartOfAccountFE[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [selectedAccount, setSelectedAccount] = useState<ChartOfAccountFE | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'flat' | 'tree'>('flat');

  const propertyName = useCallback((id?: string | null): string => {
    if (!id) return '—';
    return properties.find(p => p.id === id)?.property_name || '—';
  }, [properties]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchChartOfAccounts({
        propertyId: currentPropertyId || undefined,
      });
      setAccounts(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load Chart of Accounts');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { loadData(); }, [loadData]);

  const filteredAccounts = useMemo(() => {
    return categoryFilter === 'All'
      ? accounts
      : accounts.filter(a => a.category === categoryFilter || a.account_type === categoryFilter);
  }, [accounts, categoryFilter]);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete account "${name}"?`)) return;
    try {
      await deleteChartOfAccount(id);
      addNotification(`Account ${name} deleted`, 'success', 'finance');
      await loadData();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete account', 'error', 'finance');
    }
  };

  const AccountForm = ({ account, onSaved }: { account: ChartOfAccountFE | null; onSaved: () => void }) => {
    const [form, setForm] = useState({
      code: account?.code || '',
      name: account?.name || '',
      category: account?.category || account?.account_type || 'Asset',
      subcategory: account?.subcategory || '',
      department: account?.department || '',
      costCenter: account?.cost_center || '',
      profitCenter: account?.profit_center || '',
      project: account?.project || '',
      parentCode: account?.parent_code || '',
      description: account?.description || '',
      normalBalance: account?.normal_balance || '',
      currency: account?.currency || 'ETB',
      isControlAccount: account?.is_control_account || false,
      propertyId: account?.property_id || currentPropertyId || '',
    });
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setSaving(true);
      try {
        if (account) {
          await updateChartOfAccount(account.id, {
            name: form.name,
            subcategory: form.subcategory || null,
            department: form.department || null,
            description: form.description || null,
            normalBalance: form.normalBalance || undefined,
            currency: form.currency,
            isControlAccount: form.isControlAccount,
            propertyId: form.propertyId || null,
            costCenter: form.costCenter || null,
            profitCenter: form.profitCenter || null,
            project: form.project || null,
          });
          addNotification('Account updated', 'success', 'finance');
        } else {
          await createChartOfAccount({
            code: form.code,
            name: form.name,
            category: form.category,
            subcategory: form.subcategory || undefined,
            department: form.department || undefined,
            accountType: form.category,
            parentCode: form.parentCode || undefined,
            description: form.description || undefined,
            normalBalance: form.normalBalance || undefined,
            currency: form.currency,
            isControlAccount: form.isControlAccount,
            propertyId: form.propertyId || undefined,
            costCenter: form.costCenter || undefined,
            profitCenter: form.profitCenter || undefined,
            project: form.project || undefined,
          });
          addNotification('Account created', 'success', 'finance');
        }
        onSaved();
      } catch (err: any) {
        addNotification(err?.message || 'Failed to save account', 'error', 'finance');
      } finally {
        setSaving(false);
      }
    };

    return (
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Account Code *</label>
            <input
              type="text"
              value={form.code}
              disabled={!!account}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100"
              required
            />
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Category *</label>
            <select
              value={form.category}
              disabled={!!account}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100"
            >
              {CATEGORIES.slice(1).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Account Name *</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            required
          />
        </div>
        <div>
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Description</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            rows={2}
          />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Subcategory</label>
            <input
              type="text"
              value={form.subcategory}
              onChange={(e) => setForm({ ...form, subcategory: e.target.value })}
              className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Department</label>
            <select
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
              className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">— None —</option>
              {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Parent Code</label>
            <input
              type="text"
              value={form.parentCode}
              onChange={(e) => setForm({ ...form, parentCode: e.target.value })}
              className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Cost Center</label>
            <input
              type="text"
              value={form.costCenter}
              onChange={(e) => setForm({ ...form, costCenter: e.target.value })}
              className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="e.g. CC-001"
            />
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Profit Center</label>
            <input
              type="text"
              value={form.profitCenter}
              onChange={(e) => setForm({ ...form, profitCenter: e.target.value })}
              className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="e.g. PC-001"
            />
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Project</label>
            <input
              type="text"
              value={form.project}
              onChange={(e) => setForm({ ...form, project: e.target.value })}
              className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="e.g. PRJ-001"
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Normal Balance</label>
            <select
              value={form.normalBalance}
              onChange={(e) => setForm({ ...form, normalBalance: e.target.value })}
              className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Auto</option>
              <option value="Debit">Debit</option>
              <option value="Credit">Credit</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Currency</label>
            <select
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
              className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="ETB">ETB</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Property</label>
            <select
              value={form.propertyId}
              onChange={(e) => setForm({ ...form, propertyId: e.target.value })}
              className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">— No Property —</option>
              {properties.map(p => <option key={p.id} value={p.id}>{p.property_name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="is_control_account"
            checked={form.isControlAccount}
            onChange={(e) => setForm({ ...form, isControlAccount: e.target.checked })}
            className="w-4 h-4 text-indigo-600 rounded"
          />
          <label htmlFor="is_control_account" className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Control Account</label>
        </div>
        <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
          <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 hover:bg-slate-50 transition">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition flex items-center gap-2">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
          </button>
        </div>
      </form>
    );
  };

  const toneForCategory = (cat?: string): StatusTone => {
    return (cat && CATEGORY_TONE[cat]) || 'neutral';
  };

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Chart of Accounts"
        subtitle="Enterprise account structure and USALI mapping"
        icon={FileText}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex bg-slate-100 dark:bg-slate-800 rounded-xl p-0.5 border border-gray-200 dark:border-slate-700">
              <button
                onClick={() => setViewMode('flat')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${viewMode === 'flat' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}
              >
                Flat
              </button>
              <button
                onClick={() => setViewMode('tree')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${viewMode === 'tree' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}
              >
                Tree
              </button>
            </div>
            <button onClick={() => loadData()} className={button.secondary}>
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
              Refresh
            </button>
            <button onClick={() => { setSelectedAccount(null); setShowModal(true); }} className="bg-indigo-600 text-white font-medium py-2 px-4 rounded-xl flex items-center gap-2 text-sm hover:bg-indigo-700 transition shadow-sm">
              <Plus size={16} /> New Account
            </button>
          </div>
        }
      />

      {error && (
        <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-2xl p-6 text-center">
          <AlertCircle size={20} className="mx-auto text-rose-500 mb-2" />
          <p className="text-xs font-bold text-rose-600">{error}</p>
          <button onClick={() => loadData()} className="text-[10px] font-black text-rose-600 uppercase hover:underline mt-2">Retry</button>
        </div>
      )}

      <div className={layout.kpiGrid}>
        <StatCard title="Total Accounts" value={accounts.length} icon={FileText} tone="accent" />
        <StatCard title="Active" value={accounts.filter(a => a.is_active !== false).length} icon={ArrowUpRight} tone="success" />
        <StatCard title="Assets" value={accounts.filter(a => a.category === 'Asset' || a.account_type === 'Asset').length} icon={ArrowUpRight} tone="info" />
        <StatCard title="Liabilities" value={accounts.filter(a => a.category === 'Liability' || a.account_type === 'Liability').length} icon={ArrowDownRight} tone="warning" />
        <StatCard title="Equity" value={accounts.filter(a => a.category === 'Equity' || a.account_type === 'Equity').length} icon={FileText} tone="accent" />
        <StatCard title="Revenue" value={accounts.filter(a => a.category === 'Revenue' || a.account_type === 'Revenue').length} icon={ArrowUpRight} tone="success" />
        <StatCard title="Cost of Sales" value={accounts.filter(a => a.category === 'Cost of Sales' || a.account_type === 'Cost of Sales').length} icon={ArrowDownRight} tone="danger" />
        <StatCard title="Op. Expenses" value={accounts.filter(a => a.category === 'Operating Expenses' || a.account_type === 'Operating Expenses').length} icon={ArrowDownRight} tone="danger" />
        <StatCard title="Other Income" value={accounts.filter(a => a.category === 'Other Income' || a.account_type === 'Other Income').length} icon={ArrowUpRight} tone="success" />
        <StatCard title="Other Expenses" value={accounts.filter(a => a.category === 'Other Expenses' || a.account_type === 'Other Expenses').length} icon={ArrowDownRight} tone="danger" />
      </div>

      <SectionCard
        title="Enterprise Chart of Accounts"
        subtitle="USALI-compliant account structure with property scoping"
        icon={FileText}
        pad="none"
        bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
      >
        {/* Category filter */}
        <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center gap-2 overflow-x-auto">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition whitespace-nowrap ${
                categoryFilter === cat
                  ? 'bg-[var(--color-accent-operations)] text-white'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {loading && (
          <div className="p-8 flex items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading chart of accounts…
          </div>
        )}
        {!loading && filteredAccounts.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-500">No accounts found.</div>
        )}
        {!loading && viewMode === 'tree' && filteredAccounts.length > 0 && (() => {
          const childMap = new Map<string | null, ChartOfAccountFE[]>();
          filteredAccounts.forEach(a => {
            const parent = a.parent_code || null;
            if (!childMap.has(parent)) childMap.set(parent, []);
            childMap.get(parent)!.push(a);
          });
          const roots = childMap.get(null) || filteredAccounts.filter(a => !a.parent_code);
          const renderNode = (acc: ChartOfAccountFE, depth: number): React.ReactNode => {
            const children = childMap.get(acc.code) || [];
            return (
              <div key={acc.id}>
                <div
                  className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 border-b border-gray-50 dark:border-slate-700"
                  style={{ paddingLeft: `${16 + depth * 24}px` }}
                >
                  {children.length > 0 && <span className="text-slate-400 text-xs">▾</span>}
                  {children.length === 0 && <span className="w-3" />}
                  <span className="text-xs font-black text-indigo-600 font-mono italic w-24">{acc.code}</span>
                  <span className="text-xs font-black text-slate-900 dark:text-white flex-1">{acc.name}</span>
                  <Badge tone={toneForCategory(acc.category || acc.account_type)}>{acc.category || acc.account_type}</Badge>
                  <span className="text-[10px] font-bold text-slate-500 w-20 text-right">{acc.currency || 'ETB'}</span>
                  <span className="text-xs font-black text-slate-900 dark:text-white w-28 text-right">{Number(acc.balance || 0).toLocaleString()}</span>
                  <div className={`flex items-center gap-1.5 w-16 ${acc.is_active === false ? 'text-slate-400' : 'text-emerald-500'}`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${acc.is_active === false ? 'bg-slate-400' : 'bg-emerald-500'}`} />
                    <span className="text-[9px] font-black uppercase">{acc.is_active === false ? 'Inactive' : 'Active'}</span>
                  </div>
                </div>
                {children.map(c => renderNode(c, depth + 1))}
              </div>
            );
          };
          return (
            <div className="divide-y divide-gray-50 dark:divide-slate-700">
              <div className="flex items-center gap-3 px-4 py-2 bg-slate-50 dark:bg-slate-800 border-b border-gray-100 dark:border-slate-700">
                <span className="w-3" />
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 w-24">Code</span>
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 flex-1">Account Name</span>
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 w-24">Category</span>
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 w-20 text-right">Currency</span>
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 w-28 text-right">Balance</span>
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 w-16">Status</span>
              </div>
              {roots.map(r => renderNode(r, 0))}
            </div>
          );
        })()}
        {!loading && viewMode === 'flat' && filteredAccounts.length > 0 && (
          <DataTable
            columns={[
              { key: 'code', label: 'Account Code', render: (acc: ChartOfAccountFE) => <span className="text-xs font-black text-indigo-600 font-mono italic">{acc.code}</span> },
              { key: 'name', label: 'Account Name', render: (acc: ChartOfAccountFE) => (
                <div className="flex flex-col">
                  <span className="text-xs font-black text-slate-900 dark:text-white">{acc.name}</span>
                  {acc.description && <span className="text-[9px] font-bold text-slate-400 truncate max-w-[200px]">{acc.description}</span>}
                </div>
              )},
              { key: 'category', label: 'Category', render: (acc: ChartOfAccountFE) => <Badge tone={toneForCategory(acc.category || acc.account_type)}>{acc.category || acc.account_type}</Badge> },
              { key: 'subcategory', label: 'Subcategory', render: (acc: ChartOfAccountFE) => <span className="text-[10px] font-bold text-slate-500">{acc.subcategory || '—'}</span> },
              { key: 'department', label: 'Department', render: (acc: ChartOfAccountFE) => <span className="text-[10px] font-bold text-slate-500">{acc.department || '—'}</span> },
              { key: 'cost_center', label: 'Cost Center', render: (acc: ChartOfAccountFE) => <span className="text-[10px] font-bold text-slate-500">{acc.cost_center || '—'}</span> },
              { key: 'profit_center', label: 'Profit Center', render: (acc: ChartOfAccountFE) => <span className="text-[10px] font-bold text-slate-500">{acc.profit_center || '—'}</span> },
              { key: 'normal_balance', label: 'Normal', align: 'center' as const, render: (acc: ChartOfAccountFE) => <span className="text-[10px] font-black uppercase text-slate-500">{acc.normal_balance}</span> },
              { key: 'currency', label: 'Currency', align: 'center' as const, render: (acc: ChartOfAccountFE) => <span className="text-[10px] font-black uppercase text-slate-500">{acc.currency || 'ETB'}</span> },
              { key: 'balance', label: 'Balance', align: 'right' as const, render: (acc: ChartOfAccountFE) => <span className="text-xs font-black text-slate-900 dark:text-white">{Number(acc.balance || 0).toLocaleString()}</span> },
              { key: 'property_name', label: 'Property', render: (acc: ChartOfAccountFE) => <span className="text-[10px] font-bold text-slate-500">{acc.property_name || propertyName(acc.property_id)}</span> },
              { key: 'is_active', label: 'Status', align: 'center' as const, sortable: false, render: (acc: ChartOfAccountFE) => (
                <div className={`flex justify-center items-center gap-1.5 ${acc.is_active === false ? 'text-slate-400' : 'text-emerald-500'}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${acc.is_active === false ? 'bg-slate-400' : 'bg-emerald-500'}`} />
                  <span className="text-[9px] font-black uppercase">{acc.is_active === false ? 'Inactive' : 'Active'}</span>
                </div>
              )},
              { key: 'actions', label: 'Actions', align: 'center' as const, sortable: false, render: (acc: ChartOfAccountFE) => {
                const isOpen = menuOpen === acc.id;
                return (
                  <div className="flex justify-center gap-1 relative">
                    <button onClick={() => setMenuOpen(isOpen ? null : acc.id)} className={button.ghost}>
                      <MoreVertical className="w-4 h-4" />
                    </button>
                    {isOpen && (
                      <div className="absolute right-0 top-full mt-2 w-40 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden">
                        <button onClick={() => { setMenuOpen(null); setSelectedAccount(acc); setShowModal(true); }} className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition flex items-center gap-2">
                          <Edit3 className="w-3.5 h-3.5" /> Edit
                        </button>
                        <button onClick={() => { setMenuOpen(null); handleDelete(acc.id, acc.name); }} className="w-full text-left px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 transition flex items-center gap-2">
                          <Trash2 className="w-3.5 h-3.5" /> Delete
                        </button>
                      </div>
                    )}
                  </div>
                );
              }},
            ] as Column<ChartOfAccountFE>[]}
            data={filteredAccounts}
            rowKey={(acc) => acc.id}
            sortable
            filterable
            filterPlaceholder="Search accounts..."
            filterKeys={['code', 'name', 'category', 'subcategory', 'department', 'property_name']}
            containerClassName="rounded-lg border-0"
          />
        )}
      </SectionCard>

      <ModalSystem
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={selectedAccount ? 'Edit Account' : 'New Account'}
        subtitle={selectedAccount ? `Account ${selectedAccount.code}` : 'Create a new USALI account'}
        variant="form"
        size="lg"
        showFooter={false}
      >
        <div className="p-6">
          <AccountForm
            account={selectedAccount}
            onSaved={() => { setShowModal(false); setSelectedAccount(null); loadData(); }}
          />
        </div>
      </ModalSystem>
    </div>
  );
};

export default ChartOfAccounts;
