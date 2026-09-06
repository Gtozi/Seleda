/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Finance Configuration module — Finance Portal.
 * Backs /erp/finance/config.
 *
 * DB-integrated: all sections read from and persist to the backend
 * via /api/fin-portal/config/* routes. Uses the F&B / HK shared
 * FrontOffice design system (PageHeader, SectionCard, Badge,
 * brandTheme, StatCard) and the useERP context for notifications.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Settings,
  Calendar,
  BookOpen,
  Receipt,
  DollarSign,
  Landmark,
  FileText,
  ShieldCheck,
  Plus,
  Pencil,
  Trash2,
  Search,
  RefreshCw,
  Loader2,
  X,
  AlertTriangle,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import type { LucideIcon } from 'lucide-react';
import {
  fetchFiscalYears,
  fetchFiscalPeriods,
  updateFiscalPeriod,
  fetchCurrencies,
  fetchTaxCodesConfig,
  fetchTaxJurisdictions,
  fetchPostingRulesConfig,
  fetchJournalTypes,
  fetchPostingProfiles,
  fetchApprovalLevelsConfig,
  fetchChartOfAccounts,
  createFiscalYear,
  updateFiscalYear,
  deleteFiscalYear,
  createCurrency,
  updateCurrency,
  deleteCurrency,
  createTaxCodeConfig,
  updateTaxCodeConfig,
  deleteTaxCodeConfig,
  createTaxJurisdiction,
  updateTaxJurisdiction,
  deleteTaxJurisdiction,
  createPostingRuleConfig,
  updatePostingRuleConfig,
  deletePostingRuleConfig,
  createJournalType,
  updateJournalType,
  deleteJournalType,
  createPostingProfile,
  updatePostingProfile,
  deletePostingProfile,
  createApprovalLevelConfig,
  updateApprovalLevelConfig,
  deleteApprovalLevelConfig,
  type FinFiscalYearFE,
  type FinFiscalPeriodFE,
  type FinCurrencyFE,
  type FinTaxCodeFE,
  type FinTaxJurisdictionFE,
  type FinPostingRuleFE,
  type FinJournalTypeFE,
  type FinPostingProfileFE,
  type FinApprovalLevelFE,
  type ChartOfAccountFE,
} from '../../services/financePortalService';

type ConfigSection =
  | 'fiscal-years' | 'fiscal-periods' | 'posting-rules' | 'currencies' | 'exchange-rates'
  | 'chart-of-accounts' | 'journal-types' | 'posting-profiles' | 'cost-centers'
  | 'approval-levels' | 'delegation-rules'
  | 'tax-codes' | 'tax-jurisdictions';

type SectionGroup = 'Financial Setup' | 'Ledger Setup' | 'Approval Setup' | 'Tax Setup';

interface SectionDef {
  id: ConfigSection;
  label: string;
  icon: LucideIcon;
  group: SectionGroup;
}

const SECTIONS: SectionDef[] = [
  { id: 'fiscal-years', label: 'Fiscal Years', icon: Calendar, group: 'Financial Setup' },
  { id: 'fiscal-periods', label: 'Accounting Periods', icon: Calendar, group: 'Financial Setup' },
  { id: 'posting-rules', label: 'Posting Rules', icon: FileText, group: 'Financial Setup' },
  { id: 'currencies', label: 'Currency Setup', icon: DollarSign, group: 'Financial Setup' },
  { id: 'exchange-rates', label: 'Exchange Rates', icon: RefreshCw, group: 'Financial Setup' },
  { id: 'chart-of-accounts', label: 'Chart of Accounts', icon: BookOpen, group: 'Ledger Setup' },
  { id: 'journal-types', label: 'Journal Types', icon: FileText, group: 'Ledger Setup' },
  { id: 'posting-profiles', label: 'Posting Profiles', icon: Landmark, group: 'Ledger Setup' },
  { id: 'cost-centers', label: 'Cost Centers', icon: Landmark, group: 'Ledger Setup' },
  { id: 'approval-levels', label: 'Approval Levels', icon: ShieldCheck, group: 'Approval Setup' },
  { id: 'delegation-rules', label: 'Delegation Rules', icon: ShieldCheck, group: 'Approval Setup' },
  { id: 'tax-codes', label: 'Tax Codes', icon: Receipt, group: 'Tax Setup' },
  { id: 'tax-jurisdictions', label: 'Tax Jurisdictions', icon: Receipt, group: 'Tax Setup' },
];

const statusTone = (s?: string) => {
  const active = ['active', 'open', 'Open'].includes(s || '');
  const closed = ['closed', 'Closed', 'inactive'].includes(s || '');
  const pending = ['pending', 'Closing'].includes(s || '');
  if (active) return 'success';
  if (closed) return 'neutral';
  if (pending) return 'warning';
  return 'info';
};

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

export default function FinanceConfiguration() {
  const { currentPropertyId, addNotification } = useERP();
  const [section, setSection] = useState<ConfigSection>('fiscal-years');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Data
  const [fiscalYears, setFiscalYears] = useState<FinFiscalYearFE[]>([]);
  const [fiscalPeriods, setFiscalPeriods] = useState<FinFiscalPeriodFE[]>([]);
  const [currencies, setCurrencies] = useState<FinCurrencyFE[]>([]);
  const [taxCodes, setTaxCodes] = useState<FinTaxCodeFE[]>([]);
  const [taxJurisdictions, setTaxJurisdictions] = useState<FinTaxJurisdictionFE[]>([]);
  const [postingRules, setPostingRules] = useState<FinPostingRuleFE[]>([]);
  const [journalTypes, setJournalTypes] = useState<FinJournalTypeFE[]>([]);
  const [postingProfiles, setPostingProfiles] = useState<FinPostingProfileFE[]>([]);
  const [approvalLevels, setApprovalLevels] = useState<FinApprovalLevelFE[]>([]);
  const [chartOfAccounts, setChartOfAccounts] = useState<ChartOfAccountFE[]>([]);

  // Modals
  const [modal, setModal] = useState<{ open: boolean; title: string; fields: FieldDef[]; values: Record<string, any>; onSave: (vals: Record<string, any>) => Promise<void>; saving: boolean } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ table: string; id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const params = useMemo(() => ({ propertyId: currentPropertyId || undefined }), [currentPropertyId]);

  useEffect(() => {
    setLoading(true);
    const p = { propertyId: currentPropertyId || undefined };
    const go = async () => {
      try {
        switch (section) {
          case 'fiscal-years':
            setFiscalYears(await fetchFiscalYears(p));
            break;
          case 'fiscal-periods':
            setFiscalPeriods(await fetchFiscalPeriods(p));
            break;
          case 'currencies':
          case 'exchange-rates':
            setCurrencies(await fetchCurrencies(p));
            break;
          case 'tax-codes':
            setTaxCodes(await fetchTaxCodesConfig(p));
            break;
          case 'tax-jurisdictions':
            setTaxJurisdictions(await fetchTaxJurisdictions(p));
            break;
          case 'posting-rules':
            setPostingRules(await fetchPostingRulesConfig(p));
            break;
          case 'journal-types':
            setJournalTypes(await fetchJournalTypes(p));
            break;
          case 'posting-profiles':
            setPostingProfiles(await fetchPostingProfiles(p));
            break;
          case 'approval-levels':
            setApprovalLevels(await fetchApprovalLevelsConfig(p));
            break;
          case 'chart-of-accounts':
            setChartOfAccounts(await fetchChartOfAccounts(p));
            break;
        }
      } catch (err: any) {
        addNotification(err.message || 'Failed to load finance configuration', 'warning', 'Finance');
      } finally {
        setLoading(false);
      }
    };
    go();
  }, [section, refreshKey, currentPropertyId, addNotification]);

  const refresh = () => setRefreshKey(k => k + 1);

  const groupedSections = useMemo(() => {
    const groups: Partial<Record<SectionGroup, SectionDef[]>> = {};
    SECTIONS.forEach(s => { (groups[s.group] = groups[s.group] || []).push(s); });
    return groups;
  }, []);

  const currentSection = SECTIONS.find(s => s.id === section)!;

  const stats = useMemo(() => ({
    fiscalYears: fiscalYears.length,
    periods: fiscalPeriods.length,
    currencies: currencies.length,
    taxCodes: taxCodes.length,
    postingRules: postingRules.length,
    journalTypes: journalTypes.length,
    postingProfiles: postingProfiles.length,
    approvalLevels: approvalLevels.length,
  }), [fiscalYears, fiscalPeriods, currencies, taxCodes, postingRules, journalTypes, postingProfiles, approvalLevels]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      switch (deleteTarget.table) {
        case 'fiscal-years': await deleteFiscalYear(deleteTarget.id); break;
        case 'currencies': await deleteCurrency(deleteTarget.id); break;
        case 'tax-codes': await deleteTaxCodeConfig(deleteTarget.id); break;
        case 'tax-jurisdictions': await deleteTaxJurisdiction(deleteTarget.id); break;
        case 'posting-rules': await deletePostingRuleConfig(deleteTarget.id); break;
        case 'journal-types': await deleteJournalType(deleteTarget.id); break;
        case 'posting-profiles': await deletePostingProfile(deleteTarget.id); break;
        case 'approval-levels': await deleteApprovalLevelConfig(deleteTarget.id); break;
      }
      addNotification(`${deleteTarget.name} deleted`, 'info', 'Finance');
      setDeleteTarget(null);
      refresh();
    } catch (err: any) {
      addNotification(err.message || 'Failed to delete', 'warning', 'Finance');
    } finally {
      setDeleting(false);
    }
  };

  // ── Create/edit helpers ─────────────────────────────────────────────────

  interface FieldDef { key: string; label: string; type: 'text' | 'number' | 'select' | 'date' | 'checkbox' | 'textarea'; options?: string[]; }

  const openCreate = (table: string, fields: FieldDef[], defaults: Record<string, any>) => {
    setModal({
      open: true,
      title: `New ${currentSection.label.replace(/s$/, '')}`,
      fields,
      values: defaults,
      saving: false,
      onSave: async (vals) => {
        const payload = { ...vals, propertyId: currentPropertyId || undefined };
        if (modal) setModal({ ...modal, saving: true });
        try {
          switch (table) {
            case 'fiscal-years': await createFiscalYear(payload); break;
            case 'currencies': await createCurrency(payload); break;
            case 'tax-codes': await createTaxCodeConfig(payload); break;
            case 'tax-jurisdictions': await createTaxJurisdiction(payload); break;
            case 'posting-rules': await createPostingRuleConfig(payload); break;
            case 'journal-types': await createJournalType(payload); break;
            case 'posting-profiles': await createPostingProfile(payload); break;
            case 'approval-levels': await createApprovalLevelConfig(payload); break;
          }
          addNotification(`${currentSection.label} created`, 'success', 'Finance');
          setModal(null);
          refresh();
        } catch (err: any) {
          addNotification(err.message || 'Failed to create', 'warning', 'Finance');
        } finally {
          if (modal) setModal({ ...modal, saving: false });
        }
      },
    });
  };

  const openEdit = (table: string, fields: FieldDef[], values: Record<string, any>, id: string, name: string) => {
    setModal({
      open: true,
      title: `Edit ${name}`,
      fields,
      values,
      saving: false,
      onSave: async (vals) => {
        if (modal) setModal({ ...modal, saving: true });
        try {
          switch (table) {
            case 'fiscal-years': await updateFiscalYear(id, vals); break;
            case 'currencies': await updateCurrency(id, vals); break;
            case 'tax-codes': await updateTaxCodeConfig(id, vals); break;
            case 'tax-jurisdictions': await updateTaxJurisdiction(id, vals); break;
            case 'posting-rules': await updatePostingRuleConfig(id, vals); break;
            case 'journal-types': await updateJournalType(id, vals); break;
            case 'posting-profiles': await updatePostingProfile(id, vals); break;
            case 'approval-levels': await updateApprovalLevelConfig(id, vals); break;
          }
          addNotification(`${name} updated`, 'success', 'Finance');
          setModal(null);
          refresh();
        } catch (err: any) {
          addNotification(err.message || 'Failed to update', 'warning', 'Finance');
        } finally {
          if (modal) setModal({ ...modal, saving: false });
        }
      },
    });
  };

  const toggleFiscalPeriod = async (id: string, current: string, locked: boolean) => {
    const newStatus = current === 'Open' ? 'Closed' : 'Open';
    const newLocked = newStatus === 'Closed';
    try {
      await updateFiscalPeriod(id, { status: newStatus, isLocked: newLocked });
      addNotification(`Period ${newStatus.toLowerCase()}`, 'success', 'Finance');
      refresh();
    } catch (err: any) {
      addNotification(err.message || 'Failed to update period', 'warning', 'Finance');
    }
  };

  // ── Field schemas per section ───────────────────────────────────────────

  const fiscalYearFields: FieldDef[] = [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'startDate', label: 'Start Date', type: 'date' },
    { key: 'endDate', label: 'End Date', type: 'date' },
    { key: 'status', label: 'Status', type: 'select', options: ['open', 'closed'] },
    { key: 'isCurrent', label: 'Current Year', type: 'checkbox' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ];

  const currencyFields: FieldDef[] = [
    { key: 'code', label: 'Code', type: 'text' },
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'symbol', label: 'Symbol', type: 'text' },
    { key: 'exchangeRate', label: 'Exchange Rate', type: 'number' },
    { key: 'isBase', label: 'Base Currency', type: 'checkbox' },
    { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive'] },
  ];

  const taxCodeFields: FieldDef[] = [
    { key: 'code', label: 'Code', type: 'text' },
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'taxType', label: 'Tax Type', type: 'select', options: ['VAT', 'TOT', 'Withholding', 'Excise', 'Service', 'PAYE'] },
    { key: 'rate', label: 'Rate (%)', type: 'number' },
    { key: 'effectiveFrom', label: 'Effective From', type: 'date' },
    { key: 'effectiveTo', label: 'Effective To', type: 'date' },
    { key: 'glMappingIn', label: 'GL In', type: 'text' },
    { key: 'glMappingOut', label: 'GL Out', type: 'text' },
    { key: 'description', label: 'Description', type: 'textarea' },
  ];

  const taxJurisdictionFields: FieldDef[] = [
    { key: 'jurisdiction', label: 'Jurisdiction', type: 'text' },
    { key: 'jurisdictionType', label: 'Type', type: 'select', options: ['National', 'Regional', 'Local'] },
    { key: 'taxAuthority', label: 'Tax Authority', type: 'text' },
    { key: 'filingFrequency', label: 'Filing Frequency', type: 'select', options: ['Monthly', 'Quarterly', 'Annual'] },
    { key: 'registrationNumber', label: 'Registration #', type: 'text' },
    { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive'] },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ];

  const postingRuleFields: FieldDef[] = [
    { key: 'name', label: 'Rule Name', type: 'text' },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'sourceModule', label: 'Source Module', type: 'text' },
    { key: 'transactionType', label: 'Transaction Type', type: 'text' },
    { key: 'debitAccountCode', label: 'Debit Account Code', type: 'text' },
    { key: 'creditAccountCode', label: 'Credit Account Code', type: 'text' },
    { key: 'taxAccountCode', label: 'Tax Account Code', type: 'text' },
    { key: 'priority', label: 'Priority', type: 'number' },
    { key: 'isActive', label: 'Active', type: 'checkbox' },
  ];

  const journalTypeFields: FieldDef[] = [
    { key: 'code', label: 'Code', type: 'text' },
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'color', label: 'Color Class', type: 'select', options: ['bg-blue-50 text-blue-700', 'bg-purple-50 text-purple-700', 'bg-amber-50 text-amber-700', 'bg-emerald-50 text-emerald-700', 'bg-rose-50 text-rose-700', 'bg-indigo-50 text-indigo-700', 'bg-teal-50 text-teal-700', 'bg-orange-50 text-orange-700', 'bg-slate-100 text-slate-700'] },
    { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive'] },
  ];

  const postingProfileFields: FieldDef[] = [
    { key: 'name', label: 'Profile Name', type: 'text' },
    { key: 'module', label: 'Module', type: 'text' },
    { key: 'debitAccountCode', label: 'Debit Account Code', type: 'text' },
    { key: 'debitAccountName', label: 'Debit Account Name', type: 'text' },
    { key: 'creditAccountCode', label: 'Credit Account Code', type: 'text' },
    { key: 'creditAccountName', label: 'Credit Account Name', type: 'text' },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive'] },
  ];

  const approvalLevelFields: FieldDef[] = [
    { key: 'name', label: 'Level Name', type: 'text' },
    { key: 'level', label: 'Level #', type: 'number' },
    { key: 'requiresUnanimous', label: 'Unanimous', type: 'checkbox' },
    { key: 'approvers', label: 'Approvers (comma separated)', type: 'text' },
    { key: 'spendingLimit', label: 'Spending Limit', type: 'number' },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive'] },
  ];

  // ── Render helpers ──────────────────────────────────────────────────────

  const canAdd = ['fiscal-years', 'currencies', 'tax-codes', 'tax-jurisdictions', 'posting-rules', 'journal-types', 'posting-profiles', 'approval-levels'].includes(section);
  const canEdit = canAdd;
  const canDelete = canAdd;

  const renderTable = (headers: string[], rows: JSX.Element[]) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
          <tr>
            {headers.map(h => <th key={h} className="px-6 py-3 font-medium whitespace-nowrap">{h}</th>)}
            {(canEdit || canDelete) && <th className="px-6 py-3 font-medium text-right">Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
          {rows}
        </tbody>
      </table>
    </div>
  );

  const renderActions = (table: string, item: any, fields: FieldDef[], values: Record<string, any>, name: string) => (
    <td className="px-6 py-3 text-right whitespace-nowrap">
      <div className="inline-flex gap-2">
        {canEdit && (
          <button onClick={() => openEdit(table, fields, values, item.id, name)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]">
            <Pencil className="w-4 h-4" />
          </button>
        )}
        {canDelete && (
          <button onClick={() => setDeleteTarget({ table, id: item.id, name })} className="p-1 text-slate-400 hover:text-[var(--color-danger)]">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </td>
  );

  const filter = (rows: any[], keys: string[]) => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter(r => keys.some(k => String(r[k] || '').toLowerCase().includes(s)));
  };

  const content = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent-operations)]" />
        </div>
      );
    }

    switch (section) {
      case 'fiscal-years': {
        const rows = filter(fiscalYears, ['name', 'status', 'notes']);
        return renderTable(['Name', 'Start Date', 'End Date', 'Status', 'Current', 'Notes'],
          rows.map(y => (
            <tr key={y.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
              <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{y.name}</td>
              <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{formatDate(y.start_date)}</td>
              <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{formatDate(y.end_date)}</td>
              <td className="px-6 py-3"><Badge tone={statusTone(y.status)}>{y.status}</Badge></td>
              <td className="px-6 py-3">{y.is_current ? <Badge tone="info">Current</Badge> : '—'}</td>
              <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{y.notes || '—'}</td>
              {renderActions('fiscal-years', y, fiscalYearFields, {
                name: y.name, startDate: y.start_date, endDate: y.end_date, status: y.status, isCurrent: y.is_current, notes: y.notes,
              }, y.name)}
            </tr>
          )));
      }

      case 'fiscal-periods': {
        const rows = filter(fiscalPeriods, ['period_name', 'status']);
        return renderTable(['Period', 'Year', 'Start', 'End', 'Status', 'Locked', 'Actions'],
          rows.map(p => (
            <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
              <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{p.period_name}</td>
              <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{p.fiscal_year}</td>
              <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{formatDate(p.start_date)}</td>
              <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{formatDate(p.end_date)}</td>
              <td className="px-6 py-3"><Badge tone={statusTone(p.status)}>{p.status}</Badge></td>
              <td className="px-6 py-3">{p.is_locked ? <Badge tone="warning">Locked</Badge> : '—'}</td>
              <td className="px-6 py-3 text-right">
                <button onClick={() => toggleFiscalPeriod(p.id, p.status, p.is_locked)} className={button.ghost}>
                  {p.status === 'Open' ? 'Close' : 'Reopen'}
                </button>
              </td>
            </tr>
          )));
      }

      case 'currencies':
      case 'exchange-rates': {
        const rows = filter(currencies, ['code', 'name']);
        return renderTable(['Currency', 'Code', 'Symbol', 'Base', 'Rate vs ETB', 'Last Updated'],
          rows.map(c => (
            <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
              <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{c.name}</td>
              <td className="px-6 py-3 text-slate-600 dark:text-slate-400 font-mono">{c.code}</td>
              <td className="px-6 py-3 text-slate-600 dark:text-slate-400 text-lg">{c.symbol}</td>
              <td className="px-6 py-3">{c.is_base ? <Badge tone="info">Base</Badge> : '—'}</td>
              <td className="px-6 py-3 font-mono font-bold text-[var(--color-accent-finance)]">{Number(c.exchange_rate).toFixed(4)}</td>
              <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{formatDate(c.last_updated)}</td>
              {renderActions('currencies', c, currencyFields, {
                code: c.code, name: c.name, symbol: c.symbol, exchangeRate: c.exchange_rate, isBase: c.is_base, status: c.status,
              }, c.name)}
            </tr>
          )));
      }

      case 'tax-codes': {
        const rows = filter(taxCodes, ['code', 'name', 'tax_type']);
        return renderTable(['Code', 'Name', 'Type', 'Rate', 'GL In', 'GL Out', 'Effective', 'Status'],
          rows.map(t => (
            <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
              <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{t.code}</td>
              <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{t.name}</td>
              <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{t.tax_type}</td>
              <td className="px-6 py-3 font-bold text-emerald-600">{Number(t.rate).toFixed(2)}%</td>
              <td className="px-6 py-3 text-slate-600 dark:text-slate-400 font-mono text-xs">{t.gl_mapping_in || '—'}</td>
              <td className="px-6 py-3 text-slate-600 dark:text-slate-400 font-mono text-xs">{t.gl_mapping_out || '—'}</td>
              <td className="px-6 py-3 text-slate-600 dark:text-slate-400 text-xs">{formatDate(t.effective_from)} {t.effective_to ? `→ ${formatDate(t.effective_to)}` : ''}</td>
              <td className="px-6 py-3"><Badge tone={t.is_active ? 'success' : 'neutral'}>{t.is_active ? 'Active' : 'Inactive'}</Badge></td>
              {renderActions('tax-codes', t, taxCodeFields, {
                code: t.code, name: t.name, taxType: t.tax_type, rate: t.rate, effectiveFrom: t.effective_from, effectiveTo: t.effective_to,
                glMappingIn: t.gl_mapping_in, glMappingOut: t.gl_mapping_out, description: t.description, isActive: t.is_active,
              }, t.name)}
            </tr>
          )));
      }

      case 'tax-jurisdictions': {
        const rows = filter(taxJurisdictions, ['jurisdiction', 'tax_authority', 'registration_number']);
        return renderTable(['Jurisdiction', 'Type', 'Tax Authority', 'Frequency', 'Registration #', 'Status'],
          rows.map(j => (
            <tr key={j.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
              <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{j.jurisdiction}</td>
              <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{j.jurisdiction_type}</td>
              <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{j.tax_authority}</td>
              <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{j.filing_frequency}</td>
              <td className="px-6 py-3 font-mono text-xs text-slate-600 dark:text-slate-400">{j.registration_number || '—'}</td>
              <td className="px-6 py-3"><Badge tone={statusTone(j.status)}>{j.status}</Badge></td>
              {renderActions('tax-jurisdictions', j, taxJurisdictionFields, {
                jurisdiction: j.jurisdiction, jurisdictionType: j.jurisdiction_type, taxAuthority: j.tax_authority,
                filingFrequency: j.filing_frequency, registrationNumber: j.registration_number, status: j.status, notes: j.notes,
              }, j.jurisdiction)}
            </tr>
          )));
      }

      case 'posting-rules': {
        const rows = filter(postingRules, ['name', 'source_module', 'transaction_type']);
        return renderTable(['Rule', 'Module', 'Transaction Type', 'Debit', 'Credit', 'Tax', 'Priority', 'Status'],
          rows.map(r => (
            <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
              <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{r.name}</td>
              <td className="px-6 py-3 text-slate-600 dark:text-slate-400 capitalize">{r.source_module}</td>
              <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.transaction_type}</td>
              <td className="px-6 py-3 font-mono text-xs text-slate-600 dark:text-slate-400">{r.debit_account_code || '—'}</td>
              <td className="px-6 py-3 font-mono text-xs text-slate-600 dark:text-slate-400">{r.credit_account_code || '—'}</td>
              <td className="px-6 py-3 font-mono text-xs text-slate-600 dark:text-slate-400">{r.tax_account_code || '—'}</td>
              <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.priority}</td>
              <td className="px-6 py-3"><Badge tone={r.is_active ? 'success' : 'neutral'}>{r.is_active ? 'Active' : 'Inactive'}</Badge></td>
              {renderActions('posting-rules', r, postingRuleFields, {
                name: r.name, description: r.description, sourceModule: r.source_module, transactionType: r.transaction_type,
                debitAccountCode: r.debit_account_code, creditAccountCode: r.credit_account_code,
                taxAccountCode: r.tax_account_code, priority: r.priority, isActive: r.is_active,
              }, r.name)}
            </tr>
          )));
      }

      case 'journal-types': {
        const rows = filter(journalTypes, ['code', 'name']);
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rows.map(jt => (
              <div key={jt.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-4 card-shadow">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`px-2 py-1 rounded text-xs font-bold ${jt.color}`}>{jt.code}</span>
                    <span className="font-medium text-gray-900 dark:text-white text-sm">{jt.name}</span>
                  </div>
                  <div className="inline-flex gap-1">
                    <button onClick={() => openEdit('journal-types', journalTypeFields, {
                      code: jt.code, name: jt.name, description: jt.description, color: jt.color, status: jt.status,
                    }, jt.id, jt.name)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => setDeleteTarget({ table: 'journal-types', id: jt.id, name: jt.name })} className="p-1 text-slate-400 hover:text-[var(--color-danger)]"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">{jt.description || '—'}</p>
                <div className="mt-3">
                  <Badge tone={statusTone(jt.status)}>{jt.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        );
      }

      case 'posting-profiles': {
        const rows = filter(postingProfiles, ['name', 'module']);
        return renderTable(['Profile', 'Module', 'Debit Account', 'Credit Account', 'Status'],
          rows.map(p => (
            <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
              <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{p.name}</td>
              <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{p.module}</td>
              <td className="px-6 py-3 font-mono text-xs text-slate-600 dark:text-slate-400">{p.debit_account_code || '—'} {p.debit_account_name || ''}</td>
              <td className="px-6 py-3 font-mono text-xs text-slate-600 dark:text-slate-400">{p.credit_account_code || '—'} {p.credit_account_name || ''}</td>
              <td className="px-6 py-3"><Badge tone={statusTone(p.status)}>{p.status}</Badge></td>
              {renderActions('posting-profiles', p, postingProfileFields, {
                name: p.name, module: p.module, debitAccountCode: p.debit_account_code, debitAccountName: p.debit_account_name,
                creditAccountCode: p.credit_account_code, creditAccountName: p.credit_account_name, description: p.description, status: p.status,
              }, p.name)}
            </tr>
          )));
      }

      case 'approval-levels': {
        const rows = filter(approvalLevels, ['name', 'description']);
        return renderTable(['Level', 'Name', 'Unanimous', 'Approvers', 'Spending Limit', 'Status'],
          rows.map(a => (
            <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
              <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{a.level}</td>
              <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{a.name}</td>
              <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{a.requires_unanimous ? 'Yes' : 'No'}</td>
              <td className="px-6 py-3 text-slate-600 dark:text-slate-400 text-xs">{a.approvers?.join(', ') || '—'}</td>
              <td className="px-6 py-3 font-mono text-slate-600 dark:text-slate-400">{a.spending_limit != null ? Number(a.spending_limit).toLocaleString() : '—'}</td>
              <td className="px-6 py-3"><Badge tone={statusTone(a.status)}>{a.status}</Badge></td>
              {renderActions('approval-levels', a, approvalLevelFields, {
                name: a.name, level: a.level, requiresUnanimous: a.requires_unanimous,
                approvers: a.approvers?.join(', '), spendingLimit: a.spending_limit,
                description: a.description, status: a.status,
              }, a.name)}
            </tr>
          )));
      }

      case 'chart-of-accounts': {
        const rows = filter(chartOfAccounts, ['code', 'name', 'account_type', 'category']);
        return renderTable(['Code', 'Name', 'Type', 'Category', 'Normal Balance', 'Status'],
          rows.map(a => (
            <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
              <td className="px-6 py-3 font-mono text-xs text-slate-500">{a.code}</td>
              <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{a.name}</td>
              <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{a.account_type}</td>
              <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{a.category}</td>
              <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{a.normal_balance || '—'}</td>
              <td className="px-6 py-3"><Badge tone={a.is_active !== false ? 'success' : 'neutral'}>{a.is_active !== false ? 'Active' : 'Inactive'}</Badge></td>
            </tr>
          )));
      }

      case 'cost-centers':
      case 'delegation-rules':
        return (
          <div className="text-center py-12 text-slate-500 dark:text-slate-400">
            <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-[var(--color-warning)]" />
            <p>{currentSection.label} configuration is under development.</p>
          </div>
        );
    }
  };

  const currentCreate = () => {
    if (!canAdd) return;
    const defaults: Record<string, any> = { status: 'active' };
    switch (section) {
      case 'fiscal-years': openCreate('fiscal-years', fiscalYearFields, defaults); break;
      case 'currencies':
      case 'exchange-rates': openCreate('currencies', currencyFields, defaults); break;
      case 'tax-codes': openCreate('tax-codes', taxCodeFields, { ...defaults, taxType: 'VAT', rate: 0, effectiveFrom: new Date().toISOString().split('T')[0] }); break;
      case 'tax-jurisdictions': openCreate('tax-jurisdictions', taxJurisdictionFields, { ...defaults, jurisdictionType: 'Regional', filingFrequency: 'Monthly' }); break;
      case 'posting-rules': openCreate('posting-rules', postingRuleFields, { ...defaults, sourceModule: 'frontoffice', transactionType: 'Payment', priority: 100 }); break;
      case 'journal-types': openCreate('journal-types', journalTypeFields, { ...defaults, code: '', color: 'bg-blue-50 text-blue-700' }); break;
      case 'posting-profiles': openCreate('posting-profiles', postingProfileFields, defaults); break;
      case 'approval-levels': openCreate('approval-levels', approvalLevelFields, { ...defaults, level: 1, requiresUnanimous: false, approvers: '' }); break;
    }
  };

  return (
    <div className={[layout.sectionStack].join(' ')}>
      <PageHeader
        title="Finance Configuration"
        subtitle="Fiscal years, accounting periods, chart of accounts, tax codes, and posting setup"
        icon={Settings}
        actions={
          <>
            <button onClick={refresh} className={button.secondary}><RefreshCw className="w-4 h-4" /> Refresh</button>
            {canAdd && (
              <button onClick={currentCreate} className={button.primary}><Plus className="w-4 h-4" /> New {currentSection.label.replace(/s$/, '')}</button>
            )}
          </>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Fiscal Years" value={stats.fiscalYears} icon={Calendar} tone="accent" />
        <StatCard title="Accounting Periods" value={stats.periods} icon={Calendar} tone="info" />
        <StatCard title="Currencies" value={stats.currencies} icon={DollarSign} tone="success" />
        <StatCard title="Tax Codes" value={stats.taxCodes} icon={Receipt} tone="warning" />
        <StatCard title="Posting Rules" value={stats.postingRules} icon={FileText} tone="info" />
        <StatCard title="Journal Types" value={stats.journalTypes} icon={BookOpen} tone="success" />
        <StatCard title="Posting Profiles" value={stats.postingProfiles} icon={Landmark} tone="accent" />
        <StatCard title="Approval Levels" value={stats.approvalLevels} icon={ShieldCheck} tone="warning" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Section navigation */}
        <div className="lg:col-span-1 space-y-4">
          {(Object.keys(groupedSections) as SectionGroup[]).map(group => (
            <div key={group} className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
              <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700">
                <h3 className="text-xs font-semibold uppercase text-slate-500">{group}</h3>
              </div>
              <div className="p-2 space-y-1">
                {groupedSections[group]!.map(s => (
                  <button
                    key={s.id}
                    onClick={() => { setSection(s.id); setSearch(''); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                      section === s.id
                        ? 'bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)] font-medium'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    <s.icon className="w-4 h-4" />
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Section content */}
        <div className="lg:col-span-3 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <currentSection.icon className="w-5 h-5 text-[var(--color-accent-operations)]" />
              {currentSection.label}
            </h2>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
              />
            </div>
          </div>

          <SectionCard>
            {content()}
          </SectionCard>
        </div>
      </div>

      {/* Edit/Create Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-lg border border-gray-200 dark:border-slate-700 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">{modal.title}</h2>
              <button onClick={() => setModal(null)} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
              {modal.fields.map(f => (
                <div key={f.key}>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{f.label}</label>
                  {f.type === 'textarea' ? (
                    <textarea
                      value={modal.values[f.key] || ''}
                      onChange={e => setModal({ ...modal, values: { ...modal.values, [f.key]: e.target.value } })}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                      rows={3}
                    />
                  ) : f.type === 'select' ? (
                    <select
                      value={modal.values[f.key] || ''}
                      onChange={e => setModal({ ...modal, values: { ...modal.values, [f.key]: e.target.value } })}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                    >
                      {f.options?.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : f.type === 'checkbox' ? (
                    <input
                      type="checkbox"
                      checked={!!modal.values[f.key]}
                      onChange={e => setModal({ ...modal, values: { ...modal.values, [f.key]: e.target.checked } })}
                      className="w-4 h-4 rounded border-gray-300"
                    />
                  ) : (
                    <input
                      type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                      value={modal.values[f.key] ?? ''}
                      onChange={e => setModal({ ...modal, values: { ...modal.values, [f.key]: e.target.value } })}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-3 pt-4 mt-4 border-t border-gray-200 dark:border-slate-700">
              <button onClick={async () => { await modal.onSave(modal.values); }} disabled={modal.saving} className={button.primary}>
                {modal.saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
              </button>
              <button onClick={() => setModal(null)} className={button.secondary}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-md border border-gray-200 dark:border-slate-700">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="w-8 h-8 text-[var(--color-danger)]" />
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Delete {deleteTarget.name}?</h2>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">This action cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={handleDelete} disabled={deleting} className={button.primary}>
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Delete'}
              </button>
              <button onClick={() => setDeleteTarget(null)} className={button.secondary}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
