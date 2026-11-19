import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FileText,
  Plus,
  Search,
  ArrowRightLeft,
  History,
  Settings,
  ChevronDown,
  Eye,
  Download,
  Filter,
  CheckCircle2,
  Clock,
  ShieldCheck,
  UserCheck,
  AlertCircle,
  Send,
  RotateCcw,
  Play,
  DollarSign,
  Calendar,
  Loader2,
  ServerCrash,
  MoreVertical,
  Trash2,
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  Printer,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { ModalSystem } from '../Shared/ModalSystem';
import { DataTable, Column } from '../Shared/DataTable';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import StatCard from '../FrontOffice/StatCard';
import {
  fetchJournals as apiFetchJournals,
  createJournal as apiCreateJournal,
  updateJournal as apiUpdateJournal,
  postJournal as apiPostJournal,
  reverseJournal as apiReverseJournal,
  deleteJournal as apiDeleteJournal,
  fetchChartOfAccounts as apiFetchCoa,
  fetchTrialBalance as apiFetchTrialBalance,
  fetchRecurringTemplates as apiFetchRecurring,
  updateRecurringTemplate as apiUpdateRecurring,
  deleteRecurringTemplate as apiDeleteRecurring,
  runRecurringTemplate as apiRunRecurring,
  fetchInvoices as apiFetchInvoices,
  fetchPeriods as apiFetchPeriods,
  updatePeriod as apiUpdatePeriod,
  fetchReversingEntries as apiFetchReversing,
  updateReversingEntry as apiUpdateReversing,
  deleteReversingEntry as apiDeleteReversing,
  fetchAdjustingEntries as apiFetchAdjusting,
  updateAdjustingEntry as apiUpdateAdjusting,
  deleteAdjustingEntry as apiDeleteAdjusting,
  fetchClosingEntries as apiFetchClosing,
  updateClosingEntry as apiUpdateClosing,
  deleteClosingEntry as apiDeleteClosing,
  fetchAuditTrail as apiFetchAudit,
  type JournalEntryFE,
  type ChartOfAccountFE,
  type TrialBalance,
  type RecurringTemplateFE,
  type InvoiceFE,
  type AccountingPeriodFE,
  type ReversingEntryFE,
  type AdjustingEntryFE,
  type ClosingEntryFE,
  type AuditTrailFE,
} from '../../services/financePortalService';

const GeneralLedger = () => {
  const { currentSystemDate, formatAmount, currentPropertyId, addNotification, properties } = useERP();

  /** Map property_id â†’ property_name using the ERP properties list. */
  const propertyName = useCallback((id?: string | null): string => {
    if (!id) return 'â€”';
    return properties.find(p => p.id === id)?.property_name || 'â€”';
  }, [properties]);
  const [activeTab, setActiveTab] = useState<'journals' | 'coa' | 'ledger' | 'invoices' | 'recurring' | 'periods' | 'reversing' | 'adjusting' | 'closing' | 'automatic' | 'trial_balance' | 'audit_trail'>('journals');
  const [showNewJournal, setShowNewJournal] = useState(false);
  const [selectedJournal, setSelectedJournal] = useState<JournalEntryFE | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceFE | null>(null);

  // â”€â”€ DB-backed data state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [journals, setJournals] = useState<JournalEntryFE[]>([]);
  const [coa, setCoa] = useState<ChartOfAccountFE[]>([]);
  const [trialBalance, setTrialBalance] = useState<TrialBalance | null>(null);
  const [recurring, setRecurring] = useState<RecurringTemplateFE[]>([]);
  const [invoices, setInvoices] = useState<InvoiceFE[]>([]);
  const [periods, setPeriods] = useState<AccountingPeriodFE[]>([]);
  const [reversing, setReversing] = useState<ReversingEntryFE[]>([]);
  const [adjusting, setAdjusting] = useState<AdjustingEntryFE[]>([]);
  const [closing, setClosing] = useState<ClosingEntryFE[]>([]);
  const [auditTrail, setAuditTrail] = useState<AuditTrailFE[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [selectedLedgerAccount, setSelectedLedgerAccount] = useState<string>('1010');

  // â”€â”€ Load all GL data from DB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const exportToCsv = (filename: string, headers: string[], rows: (string | number)[][]) => {
    const escape = (val: string | number) => {
      const s = String(val ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const csv = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    addNotification(`Exported ${rows.length} record${rows.length !== 1 ? 's' : ''} to ${filename}.`, 'success', 'Finance');
  };

  const handleExportTrialBalance = () => {
    if (!trialBalance) return;
    const headers = ['Account Code', 'Account Name', 'Type', 'Debit', 'Credit', 'Balance'];
    const rows = trialBalance.rows.map(r => [r.accountCode, r.accountName, r.accountType, r.debit, r.credit, r.balance]);
    exportToCsv(`trial_balance_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  const handlePrintTrialBalance = () => {
    if (!trialBalance) return;
    const html = `
      <html><head><title>Trial Balance</title>
      <style>body{font-family:Arial,sans-serif;padding:24px}h2{margin-bottom:8px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #ccc;padding:8px;text-align:left}td:nth-child(4),td:nth-child(5),td:nth-child(6){text-align:right}</style>
      </head><body>
      <h2>Trial Balance Report</h2>
      <p>Generated: ${new Date().toLocaleString()}</p>
      <table><thead><tr><th>Account Code</th><th>Account Name</th><th>Type</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead><tbody>
      ${trialBalance.rows.map(r => `<tr><td>${r.accountCode}</td><td>${r.accountName}</td><td>${r.accountType}</td><td>${r.debit}</td><td>${r.credit}</td><td>${r.balance}</td></tr>`).join('')}
      </tbody></table>
      <p><strong>Total Debit:</strong> ${trialBalance.totalDebit} | <strong>Total Credit:</strong> ${trialBalance.totalCredit} | <strong>Balanced:</strong> ${trialBalance.balanced ? 'Yes' : 'No'}</p>
      </body></html>`;
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    } else {
      addNotification('Could not open print window.', 'warning', 'Finance');
    }
  };

  const handleExportAuditTrail = () => {
    const headers = ['ID', 'Occurred At', 'Journal ID', 'Action', 'Description', 'Amount', 'User', 'IP Address', 'Property'];
    const rows = auditTrail.map(a => [a.id, a.occurred_at, a.journal_id, a.action, a.description || '', a.amount, a.user_name || '', a.ip_address || '', a.property_name || propertyName(a.property_id)]);
    exportToCsv(`journal_audit_trail_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [j, c, inv, rec, per, rev, adj, clo, aud] = await Promise.all([
        apiFetchJournals({ propertyId: currentPropertyId || undefined }),
        apiFetchCoa(),
        apiFetchInvoices({ propertyId: currentPropertyId || undefined }),
        apiFetchRecurring({ propertyId: currentPropertyId || undefined }),
        apiFetchPeriods({ propertyId: currentPropertyId || undefined }),
        apiFetchReversing({ propertyId: currentPropertyId || undefined }),
        apiFetchAdjusting({ propertyId: currentPropertyId || undefined }),
        apiFetchClosing({ propertyId: currentPropertyId || undefined }),
        apiFetchAudit({ propertyId: currentPropertyId || undefined }),
      ]);
      setJournals(j);
      setCoa(c);
      setInvoices(inv);
      setRecurring(rec);
      setPeriods(per);
      setReversing(rev);
      setAdjusting(adj);
      setClosing(clo);
      setAuditTrail(aud);
    } catch (e: any) {
      setError(e?.message || 'Failed to load General Ledger data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Load trial balance lazily when the tab is opened
  const loadTrialBalance = useCallback(async () => {
    try {
      const tb = await apiFetchTrialBalance();
      setTrialBalance(tb);
    } catch (e: any) {
      setTrialBalance({ rows: [], totalDebit: 0, totalCredit: 0, balanced: false });
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'trial_balance' && !trialBalance) loadTrialBalance();
  }, [activeTab, trialBalance, loadTrialBalance]);

  // Derive ledger transactions for the selected account from DB-backed journals
  const ledgerEntries = useMemo(() => {
    const account = coa?.find(a => a.code === selectedLedgerAccount);
    const entries: any[] = [];

    journals.forEach(j => {
      const lines: any[] = Array.isArray(j.lines) ? j.lines : [];
      lines.forEach(line => {
        if (line.accountId === selectedLedgerAccount) {
          entries.push({
            date: j.entry_date,
            reference: j.reference,
            description: line.description || j.description,
            debit: Number(line.debit) || 0,
            credit: Number(line.credit) || 0,
            id: j.id
          });
        }
      });
    });

    const sorted = [...entries].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let running = 0;
    return sorted.map(entry => {
      const isAssetOrExpense = account?.account_type === 'Asset' || account?.account_type === 'Expense';
      if (isAssetOrExpense) {
        running += (entry.debit - entry.credit);
      } else {
        running += (entry.credit - entry.debit);
      }
      return { ...entry, runningBalance: running };
    });
  }, [selectedLedgerAccount, journals, coa]);

  const selectedAccountDetails = useMemo(() => coa?.find(a => a.code === selectedLedgerAccount), [coa, selectedLedgerAccount]);

  // Journal Filters
  const [journalSearch, setJournalSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');

  /** Derive a human-readable journal type from the entry's `source` metadata. */
  const journalType = useCallback((j: JournalEntryFE): string => {
    const src = (j.source || '').toLowerCase();
    if (!src) return 'Manual';
    if (src.includes('recurring')) return 'Recurring';
    if (src.includes('revers')) return 'Reversing';
    if (src.includes('adjust')) return 'Adjusting';
    if (src.includes('closing') || src.includes('close')) return 'Closing';
    if (src.includes('auto') || src.includes('system')) return 'Automatic';
    return 'Manual';
  }, []);

  // COA Filter
  const [coaCategoryFilter, setCoaCategoryFilter] = useState<string>('All');

  // Tab filter states â€” all include 'All' as the first option
  const [invoiceTypeFilter, setInvoiceTypeFilter] = useState<string>('All');
  const [invoiceGlFilter, setInvoiceGlFilter] = useState<string>('All');
  const [recurringStatusFilter, setRecurringStatusFilter] = useState<string>('All');
  const [periodStatusFilter, setPeriodStatusFilter] = useState<string>('All');
  const [reversingStatusFilter, setReversingStatusFilter] = useState<string>('All');
  const [adjustingTypeFilter, setAdjustingTypeFilter] = useState<string>('All');
  const [adjustingStatusFilter, setAdjustingStatusFilter] = useState<string>('All');
  const [closingTypeFilter, setClosingTypeFilter] = useState<string>('All');
  const [closingStatusFilter, setClosingStatusFilter] = useState<string>('All');
  const [auditActionFilter, setAuditActionFilter] = useState<string>('All');

  const [newJournalLines, setNewJournalLines] = useState([
    { accountId: '', description: '', debit: 0, credit: 0 },
    { accountId: '', description: '', debit: 0, credit: 0 },
  ]);

  const [entryDate, setEntryDate] = useState(currentSystemDate);
  const [refNum, setRefNum] = useState('');
  const [mainDesc, setMainDesc] = useState('');

  const handleSaveJournal = async () => {
    if (!isBalanced) return;
    try {
      await apiCreateJournal({
        date: entryDate,
        reference: refNum,
        description: mainDesc,
        lines: newJournalLines.map((line, idx) => ({
          id: `JL-${Date.now()}-${idx}`,
          accountId: line.accountId,
          accountName: coa?.find(a => a.code === line.accountId)?.name || 'Unknown',
          description: line.description || mainDesc,
          debit: line.debit,
          credit: line.credit
        })),
        propertyId: currentPropertyId || undefined,
      });
      addNotification?.(`Journal entry created for ${entryDate}.`, 'task', 'Finance');
      setShowNewJournal(false);
      setNewJournalLines([{ accountId: '', description: '', debit: 0, credit: 0 }, { accountId: '', description: '', debit: 0, credit: 0 }]);
      setRefNum('');
      setMainDesc('');
      loadAll();
    } catch (e: any) {
      addNotification?.(e?.message || 'Failed to create journal entry', 'warning', 'Finance');
    }
  };

  const handleSubmitForApproval = async (journal: JournalEntryFE) => {
    setActingOn(journal.id);
    setMenuOpen(null);
    try {
      await apiUpdateJournal(journal.id, { status: 'Pending' });
      addNotification?.(`Journal ${journal.id} submitted for approval.`, 'task', 'Finance');
      loadAll();
    } catch (e: any) {
      addNotification?.(e?.message || 'Failed to submit for approval', 'warning', 'Finance');
    } finally {
      setActingOn(null);
    }
  };

  const handleApproveJournal = async (journal: JournalEntryFE) => {
    setActingOn(journal.id);
    setMenuOpen(null);
    try {
      await apiUpdateJournal(journal.id, { status: 'Approved' });
      addNotification?.(`Journal ${journal.id} approved.`, 'task', 'Finance');
      loadAll();
    } catch (e: any) {
      addNotification?.(e?.message || 'Failed to approve journal', 'warning', 'Finance');
    } finally {
      setActingOn(null);
    }
  };

  const handlePostJournal = async (journal: JournalEntryFE) => {
    setActingOn(journal.id);
    setMenuOpen(null);
    try {
      await apiPostJournal(journal.id);
      addNotification?.(`Journal ${journal.id} posted to GL.`, 'task', 'Finance');
      loadAll();
    } catch (e: any) {
      addNotification?.(e?.message || 'Failed to post journal', 'warning', 'Finance');
    } finally {
      setActingOn(null);
    }
  };

  const handleReverseJournal = async (journal: JournalEntryFE) => {
    setActingOn(journal.id);
    setMenuOpen(null);
    try {
      await apiReverseJournal(journal.id);
      addNotification?.(`Journal ${journal.id} reversed.`, 'task', 'Finance');
      loadAll();
    } catch (e: any) {
      addNotification?.(e?.message || 'Failed to reverse journal', 'warning', 'Finance');
    } finally {
      setActingOn(null);
    }
  };

  const handleDeleteJournal = async (id: string) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      await apiDeleteJournal(id);
      addNotification?.(`Journal ${id} deleted.`, 'task', 'Finance');
      loadAll();
    } catch (e: any) {
      addNotification?.(e?.message || 'Failed to delete journal', 'warning', 'Finance');
    } finally {
      setActingOn(null);
    }
  };

  const addJournalLine = () => {
    setNewJournalLines([...newJournalLines, { accountId: '', description: '', debit: 0, credit: 0 }]);
  };

  const removeJournalLine = (index: number) => {
    setNewJournalLines(newJournalLines.filter((_, i) => i !== index));
  };

  const updateJournalLine = (index: number, field: string, value: any) => {
    const updatedLines = [...newJournalLines];
    updatedLines[index] = { ...updatedLines[index], [field]: value };
    setNewJournalLines(updatedLines);
  };

  const totalDebit = newJournalLines.reduce((sum, line) => sum + (line.debit || 0), 0);
  const totalCredit = newJournalLines.reduce((sum, line) => sum + (line.credit || 0), 0);
  const isBalanced = totalDebit === totalCredit && totalDebit > 0;

  const filteredJournals = journals.filter(j => {
    const q = journalSearch.toLowerCase();
    const matchSearch = !q ||
                       j.id.toLowerCase().includes(q) ||
                       (j.reference || '').toLowerCase().includes(q) ||
                       j.description.toLowerCase().includes(q);
    // "Automatic" is a journal *type* filter; other options filter by status.
    const matchStatus = statusFilter === 'All' ||
                        (statusFilter === 'Automatic' ? journalType(j) === 'Automatic' : j.status === statusFilter);
    return matchSearch && matchStatus;
  });

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="General Ledger"
        subtitle="Double-entry journals, chart of accounts, periods, and financial close."
        icon={FileText}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={loadAll} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={() => setShowNewJournal(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> New Journal
            </button>
          </div>
        }
      />

      {/* Tab bar */}
      <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap">
        {([
          ['journals', 'Journal Entries'],
          ['coa', 'Chart of Accounts'],
          ['ledger', 'Ledger View'],
          ['invoices', 'Invoices'],
          ['recurring', 'Recurring'],
          ['periods', 'Periods'],
          ['reversing', 'Reversing'],
          ['adjusting', 'Adjusting'],
          ['closing', 'Closing'],
          ['automatic', 'Automatic'],
          ['trial_balance', 'Trial Balance'],
          ['audit_trail', 'Audit Trail'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={[
              'px-4 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap',
              activeTab === key
                ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={loadAll} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      <ModalSystem
        isOpen={showNewJournal}
        onClose={() => setShowNewJournal(false)}
        title="New Journal Entry"
        subtitle="Double-entry architectural matching"
        variant="form"
        size="xl"
        showFooter={false}
      >
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                 <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-2">
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Entry Date</label>
                       <input 
                        type="date" 
                        value={entryDate}
                        onChange={(e) => setEntryDate(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-3 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all font-sans"
                       />
                    </div>
                    <div className="space-y-2">
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Reference Number</label>
                       <input 
                        type="text" 
                        placeholder="e.g. JV-2026-X"
                        value={refNum}
                        onChange={(e) => setRefNum(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-3 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all uppercase placeholder:normal-case font-mono"
                       />
                    </div>
                    <div className="space-y-2">
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Description</label>
                       <input 
                        type="text" 
                        placeholder="Internal notes..."
                        value={mainDesc}
                        onChange={(e) => setMainDesc(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-3 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
                       />
                    </div>
                 </div>

                 <div className="space-y-4">
                    <div className="flex justify-between items-center px-1">
                       <h4 className="text-[10px] font-black text-slate-900 dark:text-white uppercase tracking-widest">General Ledger Lines</h4>
                       <button 
                        onClick={addJournalLine}
                        className="flex items-center gap-1 text-[10px] font-black text-indigo-600 uppercase hover:underline"
                       >
                          <Plus size={12} /> Add Line
                       </button>
                    </div>

                    <div className="space-y-3">
                       {newJournalLines.map((line, idx) => (
                          <div key={idx} className="grid grid-cols-12 gap-3 items-start animate-fade-in">
                             <div className="col-span-4 space-y-1">
                                <select 
                                 value={line.accountId}
                                 onChange={(e) => updateJournalLine(idx, 'accountId', e.target.value)}
                                 className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-[11px] font-bold outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
                                >
                                   <option value="">Select Account...</option>
                                   {coa?.map(acc => (
                                      <option key={acc.code} value={acc.code}>{acc.code} - {acc.name}</option>
                                   ))}
                                </select>
                             </div>
                             <div className="col-span-4">
                                <input 
                                 type="text" 
                                 placeholder="Line description..."
                                 value={line.description}
                                 onChange={(e) => updateJournalLine(idx, 'description', e.target.value)}
                                 className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-[11px] font-bold outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
                                />
                             </div>
                             <div className="col-span-2">
                                <input 
                                 type="number" 
                                 placeholder="Debit"
                                 value={line.debit || ''}
                                 onChange={(e) => updateJournalLine(idx, 'debit', parseFloat(e.target.value) || 0)}
                                 className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-[11px] font-black text-right outline-none focus:ring-1 focus:ring-emerald-500 transition-all font-mono"
                                />
                             </div>
                             <div className="col-span-2 relative">
                                <input 
                                 type="number" 
                                 placeholder="Credit"
                                 value={line.credit || ''}
                                 onChange={(e) => updateJournalLine(idx, 'credit', parseFloat(e.target.value) || 0)}
                                 className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-[11px] font-black text-right outline-none focus:ring-1 focus:ring-rose-500 transition-all font-mono"
                                />
                                {newJournalLines.length > 2 && (
                                   <button 
                                    onClick={() => removeJournalLine(idx)}
                                    className="absolute -right-6 top-1/2 -translate-y-1/2 text-slate-300 hover:text-rose-500 transition p-1"
                                   >
                                      <Plus size={14} className="rotate-45" />
                                   </button>
                                )}
                             </div>
                          </div>
                       ))}
                    </div>
                 </div>
              </div>

              <div className="p-6 border-t border-slate-100 dark:border-slate-700 bg-slate-50/30 dark:bg-slate-700/20 sm:flex sm:items-center sm:justify-between space-y-4 sm:space-y-0">
                 <div className="flex gap-6 items-center">
                    <div className="text-right">
                       <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Total Debits</span>
                       <span className="text-sm font-black text-emerald-600 font-mono">${totalDebit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="text-right">
                       <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Total Credits</span>
                       <span className="text-sm font-black text-rose-600 font-mono">${totalCredit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    {totalDebit > 0 && (
                       <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all animate-fade-in ${
                         isBalanced ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-rose-50 text-rose-600 border-rose-100'
                       }`}>
                          {isBalanced ? 'Balanced' : `Difference: $${Math.abs(totalDebit - totalCredit).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                       </div>
                    )}
                 </div>
                 <div className="flex gap-3">
                    <button 
                      onClick={() => setShowNewJournal(false)}
                      className="px-6 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 transition"
                    >
                       Discard
                    </button>
                    <button 
                      disabled={!isBalanced}
                      onClick={handleSaveJournal}
                      className="px-8 py-2.5 bg-blue-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest disabled:opacity-50 transition shadow-lg shadow-indigo-600/20"
                    >
                       Save as Draft
                    </button>
                 </div>
              </div>
      </ModalSystem>

      {activeTab === 'journals' && (
        <div className={layout.sectionStack}>
           {/* KPIs */}
           <div className={layout.kpiGrid}>
             <StatCard title="Total Journals" value={journals.length} icon={FileText} tone="accent" />
             <StatCard title="Pending Approval" value={journals.filter(j => j.status === 'Pending').length} icon={Clock} tone="warning" />
             <StatCard title="Posted" value={journals.filter(j => j.status === 'Posted').length} icon={CheckCircle2} tone="success" />
             <StatCard title="Reversed" value={journals.filter(j => j.status === 'Reversed').length} icon={RotateCcw} tone="neutral" />
           </div>

           {/* Filter + search */}
           <SectionCard pad="md">
             <div className="flex flex-wrap items-center justify-between gap-4">
               <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap">
                 {['All', 'Draft', 'Pending', 'Approved', 'Posted', 'Reversed', 'Automatic'].map(f => (
                   <button
                     key={f}
                     onClick={() => setStatusFilter(f)}
                     className={[
                       'px-4 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap',
                       statusFilter === f
                         ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                         : 'text-gray-500 hover:text-gray-700',
                     ].join(' ')}
                   >
                     {f}
                   </button>
                 ))}
               </div>
               <div className="relative w-full max-w-xs">
                 <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                 <input
                   placeholder="Search ID, ref, descriptionâ€¦"
                   value={journalSearch}
                   onChange={e => setJournalSearch(e.target.value)}
                   className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
                 />
               </div>
             </div>
           </SectionCard>

           {/* Journals table */}
           <SectionCard pad="none" bodyClassName="divide-y divide-gray-100 dark:divide-slate-700">
             {loading && (
               <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500">
                 <Loader2 className="w-5 h-5 animate-spin" /> Loading journalsâ€¦
               </div>
             )}
             {!loading && !error && filteredJournals.length === 0 && (
               <div className="p-8 text-center text-sm text-gray-500">
                 {journals.length === 0 ? 'No journal entries yet.' : 'No journals match the filters.'}
               </div>
             )}
             {!loading && !error && filteredJournals.length > 0 && (
               <DataTable
                 columns={[
                   { key: 'id', label: 'Journal ID', render: (j: JournalEntryFE) => (
                     <div className="flex items-center gap-2">
                       <div className="p-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 rounded-lg"><FileText size={12} /></div>
                       <span className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-tighter">{j.reference || j.id}</span>
                     </div>
                   ) },
                   { key: 'entry_date', label: 'Date', render: (j: JournalEntryFE) => <span className="text-xs font-bold text-slate-500">{j.entry_date}</span> },
                   { key: 'description', label: 'Description', render: (j: JournalEntryFE) => (
                     <div className="flex flex-col">
                       <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{j.description}</span>
                       <span className="text-[9px] font-black text-slate-400 uppercase tracking-tight">{j.department || 'â€”'}</span>
                     </div>
                   ) },
                   { key: 'amount', label: 'Amount', align: 'right' as const, render: (j: JournalEntryFE) => <span className="text-xs font-black text-slate-900 dark:text-white">{formatAmount ? formatAmount(Number(j.amount) || 0) : `$${Number(j.amount || 0).toLocaleString()}`}</span> },
                   { key: 'property_name', label: 'Property', render: (j: JournalEntryFE) => <span className="text-[10px] font-bold text-slate-500">{j.property_name || propertyName(j.property_id)}</span> },
                  { key: 'journal_type', label: 'Type', render: (j: JournalEntryFE) => {
                    const type = journalType(j);
                    const tone: StatusTone =
                      type === 'Automatic' ? 'info' :
                      type === 'Recurring' ? 'success' :
                      type === 'Reversing' ? 'warning' :
                      type === 'Adjusting' ? 'warning' :
                      type === 'Closing' ? 'danger' : 'neutral';
                    return <Badge tone={tone}>{type}</Badge>;
                  } },
                  { key: 'created_by', label: 'Created By', render: (j: JournalEntryFE) => <span className="text-xs font-bold text-slate-500">{j.created_by || 'â€”'}</span> },
                   { key: 'status', label: 'Status', render: (j: JournalEntryFE) => {
                     const tone: StatusTone =
                       j.status === 'Posted' ? 'success' :
                       j.status === 'Approved' ? 'info' :
                       j.status === 'Pending' ? 'warning' :
                       j.status === 'Reversed' ? 'neutral' : 'neutral';
                     return <Badge tone={tone}>{j.status}</Badge>;
                   } },
                   { key: 'actions', label: 'Actions', align: 'center' as const, sortable: false, render: (j: JournalEntryFE) => {
                     const isMenuOpen = menuOpen === j.id;
                     return (
                       <div className="flex justify-center gap-1 relative">
                         <button onClick={() => setSelectedJournal(j)} className="p-1.5 text-slate-400 hover:text-indigo-600 transition"><Eye size={14} /></button>
                         <div className="relative">
                           <button
                             onClick={() => setMenuOpen(isMenuOpen ? null : j.id)}
                             disabled={actingOn === j.id}
                             className={button.ghost + ' disabled:opacity-50'}
                           >
                             {actingOn === j.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MoreVertical className="w-4 h-4" />}
                           </button>
                           {isMenuOpen && (
                             <div className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden">
                               {j.status === 'Draft' && (
                                 <button onClick={() => handleSubmitForApproval(j)} className="w-full text-left px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition">
                                   <Send className="w-3.5 h-3.5 inline mr-1" /> Submit for Approval
                                 </button>
                               )}
                               {j.status === 'Pending' && (
                                 <button onClick={() => handleApproveJournal(j)} className="w-full text-left px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition">
                                   <UserCheck className="w-3.5 h-3.5 inline mr-1" /> Approve Journal
                                 </button>
                               )}
                               {j.status === 'Approved' && (
                                 <button onClick={() => handlePostJournal(j)} className="w-full text-left px-3 py-2 text-xs font-medium text-[var(--color-success)] hover:bg-slate-100 dark:hover:bg-slate-700 transition">
                                   <ShieldCheck className="w-3.5 h-3.5 inline mr-1" /> Post to GL
                                 </button>
                               )}
                               {j.status === 'Posted' && (
                                 <button onClick={() => handleReverseJournal(j)} className="w-full text-left px-3 py-2 text-xs font-medium text-[var(--color-danger)] hover:bg-slate-100 dark:hover:bg-slate-700 transition">
                                   <RotateCcw className="w-3.5 h-3.5 inline mr-1" /> Reverse Journal
                                 </button>
                               )}
                               <button onClick={() => handleDeleteJournal(j.id)} className="w-full text-left px-3 py-2 text-xs font-medium text-[var(--color-danger)] hover:bg-red-50 dark:hover:bg-red-900/20 transition border-t border-gray-100 dark:border-slate-700">
                                 <Trash2 className="w-3.5 h-3.5 inline mr-1" /> Delete
                               </button>
                             </div>
                           )}
                         </div>
                       </div>
                     );
                   } },
                 ] as Column<JournalEntryFE>[]}
                 data={filteredJournals}
                 rowKey={(j) => j.id}
                 sortable
                 containerClassName="rounded-lg border-0"
               />
             )}
           </SectionCard>
        </div>
      )}

      {activeTab === 'coa' && (
        <div className={layout.sectionStack}>
           <div className={layout.kpiGrid}>
             <StatCard title="Total Accounts" value={coa.length} icon={FileText} tone="accent" />
             <StatCard title="Active" value={coa.filter(a => a.is_active !== false).length} icon={CheckCircle2} tone="success" />
             <StatCard title="Assets" value={coa.filter(a => a.account_type === 'Asset').length} icon={ArrowUpRight} tone="info" />
             <StatCard title="Liabilities" value={coa.filter(a => a.account_type === 'Liability').length} icon={ArrowDownRight} tone="warning" />
           </div>

           <SectionCard
             title="Enterprise Chart of Accounts"
             subtitle="Multi-level double entry matching structure"
             icon={FileText}
             pad="none"
             bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
           >
              {/* Category filter */}
              <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center gap-2 overflow-x-auto">
                {['All', 'Asset', 'Liability', 'Equity', 'Revenue', 'Expense'].map(cat => (
                  <button
                    key={cat}
                    onClick={() => setCoaCategoryFilter(cat)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition whitespace-nowrap ${
                      coaCategoryFilter === cat
                        ? 'bg-[var(--color-accent-operations)] text-white'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {loading && (
                <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500">
                  <Loader2 className="w-5 h-5 animate-spin" /> Loading chart of accountsâ€¦
                </div>
              )}
              {!loading && coa.length === 0 && (
                <div className="p-8 text-center text-sm text-gray-500">No accounts found.</div>
              )}
              {!loading && coa.length > 0 && (
             <DataTable
               columns={[
                 { key: 'code', label: 'Account Code', render: (acc: ChartOfAccountFE) => <span className="text-xs font-black text-indigo-600 font-mono italic">{acc.code}</span> },
                 { key: 'name', label: 'Account Name', render: (acc: ChartOfAccountFE) => <span className="text-xs font-black text-slate-900 dark:text-white">{acc.name}</span> },
                 { key: 'account_type', label: 'Category', render: (acc: ChartOfAccountFE) => {
                   const tone: StatusTone =
                     acc.account_type === 'Asset' ? 'info' :
                     acc.account_type === 'Liability' ? 'warning' :
                     acc.account_type === 'Revenue' ? 'success' :
                     acc.account_type === 'Expense' ? 'danger' : 'neutral';
                   return <Badge tone={tone}>{acc.account_type}</Badge>;
                 } },
                 { key: 'parent_code', label: 'Parent Code', render: (acc: ChartOfAccountFE) => <span className="text-xs font-bold text-slate-500">{acc.parent_code || 'â€”'}</span> },
                 { key: 'balance', label: 'Balance', align: 'right' as const, render: (acc: ChartOfAccountFE) => <span className="text-xs font-black text-slate-900 dark:text-white">{formatAmount ? formatAmount(Number(acc.balance) || 0) : `$${Number(acc.balance || 0).toLocaleString()}`}</span> },
                 { key: 'is_active', label: 'Status', align: 'center' as const, sortable: false, render: (acc: ChartOfAccountFE) => (
                   <div className={`flex justify-center items-center gap-1.5 ${acc.is_active === false ? 'text-slate-400' : 'text-emerald-500'}`}>
                     <div className={`w-1.5 h-1.5 rounded-full ${acc.is_active === false ? 'bg-slate-400' : 'bg-emerald-500'}`} />
                     <span className="text-[9px] font-black uppercase">{acc.is_active === false ? 'Inactive' : 'Active'}</span>
                   </div>
                 ) },
                 { key: 'actions', label: 'Actions', align: 'center' as const, sortable: false, render: (acc: ChartOfAccountFE) => {
                   const isMenuOpen = menuOpen === acc.code;
                   const handleViewInLedger = () => {
                     setMenuOpen(null);
                     setSelectedLedgerAccount(acc.code);
                     setActiveTab('ledger');
                   };
                   return (
                     <div className="flex justify-center gap-1 relative">
                       <div className="relative">
                         <button onClick={() => setMenuOpen(isMenuOpen ? null : acc.code)} className={button.ghost}>
                           <MoreVertical className="w-4 h-4" />
                         </button>
                         {isMenuOpen && (
                           <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden">
                             <button onClick={handleViewInLedger} className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition">
                               <Eye className="w-3.5 h-3.5 inline mr-1" /> View in Ledger
                             </button>
                           </div>
                         )}
                       </div>
                     </div>
                   );
                 } },
               ] as Column<ChartOfAccountFE>[]}
               data={coaCategoryFilter === 'All' ? coa : coa.filter(a => a.account_type === coaCategoryFilter)}
               rowKey={(acc) => acc.code}
               sortable
               filterable
               filterPlaceholder="Search accounts..."
               filterKeys={['code', 'name', 'account_type']}
               containerClassName="rounded-lg border-0"
             />
           )}
           </SectionCard>
        </div>
      )}

      {activeTab === 'ledger' && (
        <div className={layout.sectionStack}>
           <SectionCard
             title="General Ledger Inquiry"
             subtitle="Account-level transaction history and balances"
             icon={History}
             pad="md"
           >
              <div className="flex flex-col md:flex-row md:items-end gap-6">
                 <div className="flex-1 space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Selected General Ledger Account</label>
                    <div className="relative">
                      <select
                       value={selectedLedgerAccount}
                       onChange={(e) => setSelectedLedgerAccount(e.target.value)}
                       className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-3 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all appearance-none cursor-pointer pr-10"
                      >
                         {coa?.map(acc => (
                            <option key={acc.code} value={acc.code}>{acc.code} - {acc.name} ({acc.account_type})</option>
                         ))}
                      </select>
                      <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
                    </div>
                 </div>
                 <div className="flex gap-4">
                    <div className="bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-700 p-4 rounded-lg text-left min-w-[160px]">
                       <span className="text-[8px] font-black text-slate-400 uppercase block mb-1">Account Type</span>
                       <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${
                         selectedAccountDetails?.account_type === 'Asset' ? 'bg-blue-100 text-blue-700' :
                         selectedAccountDetails?.account_type === 'Liability' ? 'bg-amber-100 text-amber-700' :
                         selectedAccountDetails?.account_type === 'Revenue' ? 'bg-emerald-100 text-emerald-700' :
                         'bg-slate-100 text-slate-700'
                       }`}>
                         {selectedAccountDetails?.account_type || 'â€”'}
                       </span>
                    </div>
                    <div className="bg-blue-600 border border-indigo-500 p-4 rounded-lg text-left min-w-[200px] shadow-lg shadow-indigo-600/20">
                       <span className="text-[8px] font-black text-indigo-200 uppercase block mb-1">Functional Balance</span>
                       <span className="text-lg font-black text-white font-mono leading-none">
                         {formatAmount ? formatAmount(Number(selectedAccountDetails?.balance || 0)) : `$${Number(selectedAccountDetails?.balance || 0).toLocaleString()}`}
                       </span>
                    </div>
                 </div>
              </div>
           </SectionCard>

           <SectionCard
             title="General Ledger Activity Log"
             subtitle="Period: All Time (Live Audit)"
             icon={History}
             actions={<button className="flex items-center gap-1 text-[9px] font-black text-indigo-600 uppercase tracking-widest hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition"><Download size={14} /> Export XLS</button>}
             pad="none"
             bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
           >
              {loading && (
                <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500">
                  <Loader2 className="w-5 h-5 animate-spin" /> Loading ledgerâ€¦
                </div>
              )}
              {!loading && ledgerEntries.length === 0 && (
                <div className="p-8 text-center text-sm text-gray-500">No transaction activity recorded for this account.</div>
              )}
              {!loading && ledgerEntries.length > 0 && (
                <DataTable
                  columns={[
                    { key: 'date', label: 'Entry Date', render: (trx: any) => (
                      <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap">
                        {new Date(trx.date).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </span>
                    ) },
                    { key: 'id', label: 'ID / Ref', render: (trx: any) => (
                      <div className="flex flex-col">
                        <span className="text-[10px] font-black text-slate-900 dark:text-white uppercase tracking-tighter">{trx.id}</span>
                        <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight">Ref: {trx.reference}</span>
                      </div>
                    ) },
                    { key: 'description', label: 'Description', render: (trx: any) => (
                      <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 max-w-[240px] truncate" title={trx.description}>{trx.description}</span>
                    ) },
                    { key: 'debit', label: 'Debit (+)', align: 'right' as const, render: (trx: any) => (
                      <span className="text-[10px] font-black text-emerald-600 font-mono">{trx.debit > 0 ? (formatAmount ? formatAmount(trx.debit) : `$${trx.debit.toLocaleString()}`) : '-'}</span>
                    ) },
                    { key: 'credit', label: 'Credit (-)', align: 'right' as const, render: (trx: any) => (
                      <span className="text-[10px] font-black text-rose-600 font-mono">{trx.credit > 0 ? (formatAmount ? formatAmount(trx.credit) : `$${trx.credit.toLocaleString()}`) : '-'}</span>
                    ) },
                    { key: 'runningBalance', label: 'Running Balance', align: 'right' as const, render: (trx: any) => (
                      <span className="text-[11px] font-black text-slate-900 dark:text-white font-mono bg-slate-50/30 dark:bg-slate-700/20">{formatAmount ? formatAmount(trx.runningBalance) : `$${trx.runningBalance.toLocaleString()}`}</span>
                    ) },
                  ] as Column<any>[]}
                  data={ledgerEntries}
                  rowKey={(trx: any, i: number) => trx.id + '-' + i}
                  sortable
                  filterable
                  filterPlaceholder="Search ledger entries..."
                  filterKeys={['id', 'reference', 'description']}
                  containerClassName="rounded-lg border-0"
                />
              )}
           </SectionCard>
        </div>
      )}
      {activeTab === 'invoices' && (
        <div className={layout.sectionStack}>
           <div className={layout.kpiGrid}>
             <StatCard title="Total Invoices" value={invoices.length} icon={FileText} tone="accent" />
             <StatCard title="Posted to GL" value={invoices.filter(i => i.gl_status === 'Posted').length} icon={CheckCircle2} tone="success" />
             <StatCard title="Pending" value={invoices.filter(i => i.gl_status === 'Pending').length} icon={Clock} tone="warning" />
             <StatCard title="Draft" value={invoices.filter(i => i.gl_status === 'Draft').length} icon={AlertCircle} tone="neutral" />
           </div>

           <SectionCard
             title="Document Audit Registry"
             subtitle="Billed transactions pending journal posting"
             icon={FileText}
             pad="none"
             bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
           >
              {/* Filters */}
              <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 flex flex-wrap items-center gap-2">
                {['All', 'Guest Folio', 'Vendor Invoice', 'AP Voucher'].map(f => (
                  <button key={f} onClick={() => setInvoiceTypeFilter(f)} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition whitespace-nowrap ${invoiceTypeFilter === f ? 'bg-[var(--color-accent-operations)] text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>{f}</button>
                ))}
                <div className="w-px h-5 bg-gray-200 dark:bg-slate-600 mx-1" />
                {['All', 'Draft', 'Pending', 'Posted'].map(f => (
                  <button key={f} onClick={() => setInvoiceGlFilter(f)} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition whitespace-nowrap ${invoiceGlFilter === f ? 'bg-[var(--color-accent-operations)] text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>{f}</button>
                ))}
              </div>

              {loading && (
                <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500">
                  <Loader2 className="w-5 h-5 animate-spin" /> Loading invoicesâ€¦
                </div>
              )}
              {!loading && invoices.length === 0 && (
                <div className="p-8 text-center text-sm text-gray-500">No invoices found.</div>
              )}
              {!loading && invoices.length > 0 && (
                <DataTable
                  columns={[
                    { key: 'invoice_number', label: 'Document #', render: (inv: InvoiceFE) => <span className="text-xs font-black text-indigo-600 uppercase tracking-tighter">{inv.invoice_number}</span> },
                    { key: 'type', label: 'Type', render: (inv: InvoiceFE) => {
                      const tone: StatusTone = inv.type === 'Guest Folio' ? 'success' : 'neutral';
                      return <Badge tone={tone}>{inv.type}</Badge>;
                    } },
                    { key: 'entity', label: 'Client / Vendor', render: (inv: InvoiceFE) => <span className="text-xs font-bold text-slate-900 dark:text-white uppercase">{inv.entity}</span> },
                    { key: 'issue_date', label: 'Issued Date', render: (inv: InvoiceFE) => <span className="text-xs font-bold text-slate-500">{inv.issue_date}</span> },
                    { key: 'net_amount', label: 'Net Amount', align: 'right' as const, render: (inv: InvoiceFE) => <span className="text-xs font-black text-slate-900 dark:text-white font-mono">{formatAmount ? formatAmount(Number(inv.net_amount)) : `$${Number(inv.net_amount).toLocaleString()}`}</span> },
                    { key: 'tax_amount', label: 'Tax', align: 'right' as const, render: (inv: InvoiceFE) => <span className="text-xs font-bold text-slate-400 font-mono">{formatAmount ? formatAmount(Number(inv.tax_amount)) : `$${Number(inv.tax_amount).toLocaleString()}`}</span> },
                    { key: 'gl_status', label: 'GL Status', render: (inv: InvoiceFE) => (
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone={inv.gl_status === 'Posted' ? 'success' : inv.gl_status === 'Pending' ? 'warning' : 'neutral'} variant={inv.gl_status === 'Posted' ? 'solid' : 'soft'}>{inv.gl_status}</Badge>
                        {inv.gl_ref && inv.gl_ref !== '-' && <span className="text-[7px] font-black text-slate-400 uppercase tracking-widest">{inv.gl_ref}</span>}
                      </div>
                    ) },
                    { key: 'property_name', label: 'Property', render: (inv: InvoiceFE) => <span className="text-[10px] font-bold text-slate-500">{inv.property_name || propertyName(inv.property_id)}</span> },
                  ] as Column<InvoiceFE>[]}
                  data={invoices.filter(inv => (invoiceTypeFilter === 'All' || inv.type === invoiceTypeFilter) && (invoiceGlFilter === 'All' || inv.gl_status === invoiceGlFilter))}
                  rowKey={(inv) => inv.id}
                  sortable
                  filterable
                  filterPlaceholder="Search documents..."
                  filterKeys={['invoice_number', 'type', 'entity', 'gl_status', 'property_name']}
                  onRowClick={(inv) => setSelectedInvoice(inv)}
                  containerClassName="rounded-lg border-0"
                />
              )}
           </SectionCard>
        </div>
      )}

      {activeTab === 'recurring' && (
        <div className={layout.sectionStack}>
           <div className={layout.kpiGrid}>
             <StatCard title="Active Templates" value={recurring.filter(r => r.status === 'Active').length} icon={RotateCcw} tone="success" />
             <StatCard title="Paused" value={recurring.filter(r => r.status === 'Paused').length} icon={Clock} tone="warning" />
             <StatCard title="Total Templates" value={recurring.length} icon={FileText} tone="accent" />
             <StatCard title="Monthly Value" value={formatAmount ? formatAmount(recurring.filter(r => r.status === 'Active').reduce((s, r) => s + Number(r.amount || 0), 0)) : `$${recurring.filter(r => r.status === 'Active').reduce((s, r) => s + Number(r.amount || 0), 0).toLocaleString()}`} icon={DollarSign} tone="info" />
           </div>

           <SectionCard
             title="Recurring Journal Templates"
             subtitle="Automated periodic transaction schedules"
             icon={RotateCcw}
             pad="none"
             bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
           >
              {/* Filters */}
              <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 flex flex-wrap items-center gap-2">
                {['All', 'Active', 'Paused'].map(f => (
                  <button key={f} onClick={() => setRecurringStatusFilter(f)} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition whitespace-nowrap ${recurringStatusFilter === f ? 'bg-[var(--color-accent-operations)] text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>{f}</button>
                ))}
              </div>

              {loading && (
                <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500">
                  <Loader2 className="w-5 h-5 animate-spin" /> Loading templatesâ€¦
                </div>
              )}
              {!loading && recurring.length === 0 && (
                <div className="p-8 text-center text-sm text-gray-500">No recurring templates found.</div>
              )}
              {!loading && recurring.length > 0 && (
                <DataTable
                  columns={[
                    { key: 'template_number', label: 'Template ID', render: (rj: RecurringTemplateFE) => <span className="text-xs font-black text-indigo-600 uppercase tracking-tighter">{rj.template_number}</span> },
                    { key: 'name', label: 'Template Name', render: (rj: RecurringTemplateFE) => (
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{rj.name}</span>
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-tight">{rj.description || 'â€”'}</span>
                      </div>
                    ) },
                    { key: 'frequency', label: 'Frequency', render: (rj: RecurringTemplateFE) => {
                      const tone: StatusTone = rj.frequency === 'Weekly' ? 'success' : rj.frequency === 'Quarterly' ? 'warning' : 'info';
                      return <Badge tone={tone}>{rj.frequency}</Badge>;
                    } },
                    { key: 'next_run', label: 'Next Run', render: (rj: RecurringTemplateFE) => <span className="text-xs font-bold text-slate-500">{rj.next_run}</span> },
                    { key: 'amount', label: 'Amount', align: 'right' as const, render: (rj: RecurringTemplateFE) => <span className="text-xs font-black text-slate-900 dark:text-white font-mono">{formatAmount ? formatAmount(Number(rj.amount)) : `$${Number(rj.amount).toLocaleString()}`}</span> },
                    { key: 'status', label: 'Status', render: (rj: RecurringTemplateFE) => (
                      <Badge tone={rj.status === 'Active' ? 'success' : 'neutral'}>{rj.status}</Badge>
                    ) },
                    { key: 'property_name', label: 'Property', render: (rj: RecurringTemplateFE) => <span className="text-[10px] font-bold text-slate-500">{rj.property_name || propertyName(rj.property_id)}</span> },
                    { key: 'actions', label: 'Actions', align: 'center' as const, sortable: false, render: (rj: RecurringTemplateFE) => {
                      const isMenuOpen = menuOpen === rj.id;
                      const handleRun = async () => {
                        setActingOn(rj.id); setMenuOpen(null);
                        try {
                          await apiRunRecurring(rj.id);
                          addNotification?.(`Recurring template ${rj.template_number} run.`, 'task', 'Finance');
                          loadAll();
                        } catch (e: any) { addNotification?.(e?.message || 'Failed to run template', 'warning', 'Finance'); }
                        finally { setActingOn(null); }
                      };
                      const handleToggle = async () => {
                        setActingOn(rj.id); setMenuOpen(null);
                        try {
                          await apiUpdateRecurring(rj.id, { status: rj.status === 'Active' ? 'Paused' : 'Active' });
                          addNotification?.(`Template ${rj.template_number} ${rj.status === 'Active' ? 'paused' : 'activated'}.`, 'task', 'Finance');
                          loadAll();
                        } catch (e: any) { addNotification?.(e?.message || 'Failed to update template', 'warning', 'Finance'); }
                        finally { setActingOn(null); }
                      };
                      const handleDelete = async () => {
                        setActingOn(rj.id); setMenuOpen(null);
                        try {
                          await apiDeleteRecurring(rj.id);
                          addNotification?.(`Template ${rj.template_number} deleted.`, 'task', 'Finance');
                          loadAll();
                        } catch (e: any) { addNotification?.(e?.message || 'Failed to delete template', 'warning', 'Finance'); }
                        finally { setActingOn(null); }
                      };
                      return (
                        <div className="flex justify-center gap-1 relative">
                          <div className="relative">
                            <button onClick={() => setMenuOpen(isMenuOpen ? null : rj.id)} disabled={actingOn === rj.id} className={button.ghost + ' disabled:opacity-50'}>
                              {actingOn === rj.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MoreVertical className="w-4 h-4" />}
                            </button>
                            {isMenuOpen && (
                              <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden">
                                <button onClick={handleRun} className="w-full text-left px-3 py-2 text-xs font-medium text-[var(--color-success)] hover:bg-slate-100 dark:hover:bg-slate-700 transition">
                                  <Play className="w-3.5 h-3.5 inline mr-1" /> Run Now
                                </button>
                                <button onClick={handleToggle} className="w-full text-left px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition">
                                  {rj.status === 'Active' ? 'Pause' : 'Activate'}
                                </button>
                                <button onClick={handleDelete} className="w-full text-left px-3 py-2 text-xs font-medium text-[var(--color-danger)] hover:bg-red-50 dark:hover:bg-red-900/20 transition border-t border-gray-100 dark:border-slate-700">
                                  <Trash2 className="w-3.5 h-3.5 inline mr-1" /> Delete
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    } },
                  ] as Column<RecurringTemplateFE>[]}
                  data={recurring.filter(rj => recurringStatusFilter === 'All' || rj.status === recurringStatusFilter)}
                  rowKey={(rj) => rj.id}
                  sortable
                  filterable
                  filterPlaceholder="Search templates..."
                  filterKeys={['template_number', 'name', 'description', 'frequency', 'status', 'property_name']}
                  containerClassName="rounded-lg border-0"
                />
              )}
           </SectionCard>
        </div>
      )}

      {activeTab === 'periods' && (
        <div className={layout.sectionStack}>
           <div className={layout.kpiGrid}>
             <StatCard title="Open Periods" value={periods.filter(p => p.status === 'Open').length} icon={Clock} tone="success" />
             <StatCard title="Closing" value={periods.filter(p => p.status === 'Closing').length} icon={AlertCircle} tone="warning" />
             <StatCard title="Closed" value={periods.filter(p => p.status === 'Closed').length} icon={ShieldCheck} tone="neutral" />
             <StatCard title="Total Periods" value={periods.length} icon={Calendar} tone="accent" />
           </div>

           <SectionCard
             title="Accounting Periods"
             subtitle="Accounting period open/close controls"
             icon={Calendar}
             pad="none"
             bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
           >
              {/* Filters */}
              <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 flex flex-wrap items-center gap-2">
                {['All', 'Open', 'Closing', 'Closed'].map(f => (
                  <button key={f} onClick={() => setPeriodStatusFilter(f)} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition whitespace-nowrap ${periodStatusFilter === f ? 'bg-[var(--color-accent-operations)] text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>{f}</button>
                ))}
              </div>

              {loading && (
                <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500">
                  <Loader2 className="w-5 h-5 animate-spin" /> Loading periodsâ€¦
                </div>
              )}
              {!loading && periods.length === 0 && (
                <div className="p-8 text-center text-sm text-gray-500">No accounting periods found.</div>
              )}
              {!loading && periods.length > 0 && (
                <DataTable
                  columns={[
                    { key: 'period_name', label: 'Period Name', render: (p: AccountingPeriodFE) => <span className="text-xs font-bold text-slate-900 dark:text-white">{p.period_name}</span> },
                    { key: 'period_start', label: 'Start Date', render: (p: AccountingPeriodFE) => <span className="text-xs font-bold text-slate-500">{p.period_start}</span> },
                    { key: 'period_end', label: 'End Date', render: (p: AccountingPeriodFE) => <span className="text-xs font-bold text-slate-500">{p.period_end}</span> },
                    { key: 'status', label: 'Status', render: (p: AccountingPeriodFE) => {
                      const tone: StatusTone = p.status === 'Open' ? 'success' : p.status === 'Closing' ? 'warning' : 'neutral';
                      return <Badge tone={tone}>{p.status}</Badge>;
                    } },
                    { key: 'journal_count', label: 'Journals', align: 'right' as const, render: (p: AccountingPeriodFE) => <span className="text-xs font-black text-slate-900 dark:text-white">{p.journal_count}</span> },
                    { key: 'property_name', label: 'Property', render: (p: AccountingPeriodFE) => <span className="text-[10px] font-bold text-slate-500">{p.property_name || propertyName(p.property_id)}</span> },
                    { key: 'actions', label: 'Actions', align: 'center' as const, sortable: false, render: (p: AccountingPeriodFE) => {
                      const isMenuOpen = menuOpen === p.id;
                      const handleStatus = async (newStatus: 'Open' | 'Closing' | 'Closed') => {
                        setActingOn(p.id); setMenuOpen(null);
                        try {
                          await apiUpdatePeriod(p.id, newStatus);
                          addNotification?.(`Period ${p.period_name} marked ${newStatus}.`, 'task', 'Finance');
                          loadAll();
                        } catch (e: any) { addNotification?.(e?.message || 'Failed to update period', 'warning', 'Finance'); }
                        finally { setActingOn(null); }
                      };
                      return (
                        <div className="flex justify-center gap-1 relative">
                          <div className="relative">
                            <button onClick={() => setMenuOpen(isMenuOpen ? null : p.id)} disabled={actingOn === p.id} className={button.ghost + ' disabled:opacity-50'}>
                              {actingOn === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MoreVertical className="w-4 h-4" />}
                            </button>
                            {isMenuOpen && (
                              <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden">
                                {p.status === 'Open' && (
                                  <button onClick={() => handleStatus('Closing')} className="w-full text-left px-3 py-2 text-xs font-medium text-[var(--color-warning)] hover:bg-slate-100 dark:hover:bg-slate-700 transition">
                                    <AlertCircle className="w-3.5 h-3.5 inline mr-1" /> Start Close
                                  </button>
                                )}
                                {p.status === 'Closing' && (
                                  <button onClick={() => handleStatus('Closed')} className="w-full text-left px-3 py-2 text-xs font-medium text-[var(--color-danger)] hover:bg-slate-100 dark:hover:bg-slate-700 transition">
                                    <ShieldCheck className="w-3.5 h-3.5 inline mr-1" /> Close Period
                                  </button>
                                )}
                                {p.status === 'Closed' && (
                                  <button onClick={() => handleStatus('Open')} className="w-full text-left px-3 py-2 text-xs font-medium text-[var(--color-success)] hover:bg-slate-100 dark:hover:bg-slate-700 transition">
                                    <Clock className="w-3.5 h-3.5 inline mr-1" /> Reopen
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    } },
                  ] as Column<AccountingPeriodFE>[]}
                  data={periods.filter(p => periodStatusFilter === 'All' || p.status === periodStatusFilter)}
                  rowKey={(p) => p.id}
                  sortable
                  filterable
                  filterPlaceholder="Search periods..."
                  filterKeys={['period_name', 'status', 'property_name']}
                  containerClassName="rounded-lg border-0"
                />
              )}
           </SectionCard>
        </div>
      )}

      {activeTab === 'reversing' && (
        <div className={layout.sectionStack}>
           <div className={layout.kpiGrid}>
             <StatCard title="Pending" value={reversing.filter(r => r.status === 'Pending').length} icon={Clock} tone="warning" />
             <StatCard title="Posted" value={reversing.filter(r => r.status === 'Posted').length} icon={CheckCircle2} tone="success" />
             <StatCard title="Total" value={reversing.length} icon={RotateCcw} tone="accent" />
             <StatCard title="Total Value" value={formatAmount ? formatAmount(reversing.reduce((s, r) => s + Number(r.amount || 0), 0)) : `$${reversing.reduce((s, r) => s + Number(r.amount || 0), 0).toLocaleString()}`} icon={DollarSign} tone="info" />
           </div>

           <SectionCard
             title="Reversing Journals"
             subtitle="Transaction reversal entries and corrections"
             icon={RotateCcw}
             pad="none"
             bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
           >
              {/* Filters */}
              <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 flex flex-wrap items-center gap-2">
                {['All', 'Pending', 'Posted'].map(f => (
                  <button key={f} onClick={() => setReversingStatusFilter(f)} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition whitespace-nowrap ${reversingStatusFilter === f ? 'bg-[var(--color-accent-operations)] text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>{f}</button>
                ))}
              </div>

              {loading && (
                <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500">
                  <Loader2 className="w-5 h-5 animate-spin" /> Loading reversing entriesâ€¦
                </div>
              )}
              {!loading && reversing.length === 0 && (
                <div className="p-8 text-center text-sm text-gray-500">No reversing entries found.</div>
              )}
              {!loading && reversing.length > 0 && (
                <DataTable
                  columns={[
                    { key: 'entry_number', label: 'Entry ID', render: (rj: ReversingEntryFE) => <span className="text-xs font-black text-indigo-600 uppercase tracking-tighter">{rj.entry_number}</span> },
                    { key: 'original_journal', label: 'Original Journal', render: (rj: ReversingEntryFE) => <span className="text-xs font-bold text-slate-600 dark:text-slate-400">{rj.original_journal}</span> },
                    { key: 'reason', label: 'Reversal Reason', render: (rj: ReversingEntryFE) => <span className="text-xs font-bold text-slate-900 dark:text-white">{rj.reason}</span> },
                    { key: 'reversal_date', label: 'Reversal Date', render: (rj: ReversingEntryFE) => <span className="text-xs font-bold text-slate-500">{rj.reversal_date}</span> },
                    { key: 'amount', label: 'Amount', align: 'right' as const, render: (rj: ReversingEntryFE) => <span className="text-xs font-black text-slate-900 dark:text-white font-mono">{formatAmount ? formatAmount(Number(rj.amount)) : `$${Number(rj.amount).toLocaleString()}`}</span> },
                    { key: 'status', label: 'Status', render: (rj: ReversingEntryFE) => (
                      <Badge tone={rj.status === 'Posted' ? 'success' : rj.status === 'Pending' ? 'warning' : 'neutral'}>{rj.status}</Badge>
                    ) },
                    { key: 'property_name', label: 'Property', render: (rj: ReversingEntryFE) => <span className="text-[10px] font-bold text-slate-500">{rj.property_name || propertyName(rj.property_id)}</span> },
                    { key: 'actions', label: 'Actions', align: 'center' as const, sortable: false, render: (rj: ReversingEntryFE) => {
                      const isMenuOpen = menuOpen === rj.id;
                      const handlePost = async () => {
                        setActingOn(rj.id); setMenuOpen(null);
                        try {
                          await apiUpdateReversing(rj.id, { status: 'Posted' });
                          addNotification?.(`Reversal ${rj.entry_number} posted.`, 'task', 'Finance');
                          loadAll();
                        } catch (e: any) { addNotification?.(e?.message || 'Failed to post reversal', 'warning', 'Finance'); }
                        finally { setActingOn(null); }
                      };
                      const handleDelete = async () => {
                        setActingOn(rj.id); setMenuOpen(null);
                        try {
                          await apiDeleteReversing(rj.id);
                          addNotification?.(`Reversal ${rj.entry_number} deleted.`, 'task', 'Finance');
                          loadAll();
                        } catch (e: any) { addNotification?.(e?.message || 'Failed to delete reversal', 'warning', 'Finance'); }
                        finally { setActingOn(null); }
                      };
                      return (
                        <div className="flex justify-center gap-1 relative">
                          <div className="relative">
                            <button onClick={() => setMenuOpen(isMenuOpen ? null : rj.id)} disabled={actingOn === rj.id} className={button.ghost + ' disabled:opacity-50'}>
                              {actingOn === rj.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MoreVertical className="w-4 h-4" />}
                            </button>
                            {isMenuOpen && (
                              <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden">
                                {rj.status === 'Pending' && (
                                  <button onClick={handlePost} className="w-full text-left px-3 py-2 text-xs font-medium text-[var(--color-success)] hover:bg-slate-100 dark:hover:bg-slate-700 transition">
                                    <Send className="w-3.5 h-3.5 inline mr-1" /> Post Now
                                  </button>
                                )}
                                <button onClick={handleDelete} className="w-full text-left px-3 py-2 text-xs font-medium text-[var(--color-danger)] hover:bg-red-50 dark:hover:bg-red-900/20 transition border-t border-gray-100 dark:border-slate-700">
                                  <Trash2 className="w-3.5 h-3.5 inline mr-1" /> Delete
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    } },
                  ] as Column<ReversingEntryFE>[]}
                  data={reversing.filter(rj => reversingStatusFilter === 'All' || rj.status === reversingStatusFilter)}
                  rowKey={(rj) => rj.id}
                  sortable
                  filterable
                  filterPlaceholder="Search reversals..."
                  filterKeys={['entry_number', 'original_journal', 'reason', 'status', 'property_name']}
                  containerClassName="rounded-lg border-0"
                />
              )}
           </SectionCard>
        </div>
      )}

      {activeTab === 'adjusting' && (
        <div className={layout.sectionStack}>
           <div className={layout.kpiGrid}>
             <StatCard title="Pending" value={adjusting.filter(a => a.status === 'Pending').length} icon={AlertCircle} tone="warning" />
             <StatCard title="Posted" value={adjusting.filter(a => a.status === 'Posted').length} icon={CheckCircle2} tone="success" />
             <StatCard title="Total" value={adjusting.length} icon={Settings} tone="accent" />
             <StatCard title="Total Value" value={formatAmount ? formatAmount(adjusting.reduce((s, a) => s + Number(a.amount || 0), 0)) : `$${adjusting.reduce((s, a) => s + Number(a.amount || 0), 0).toLocaleString()}`} icon={DollarSign} tone="info" />
           </div>

           <SectionCard
             title="Adjusting Journals"
             subtitle="Period-end adjustments and accruals"
             icon={Settings}
             pad="none"
             bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
           >
              {/* Filters */}
              <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 flex flex-wrap items-center gap-2">
                {['All', 'Accrual', 'Deferral', 'Estimate', 'Correction'].map(f => (
                  <button key={f} onClick={() => setAdjustingTypeFilter(f)} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition whitespace-nowrap ${adjustingTypeFilter === f ? 'bg-[var(--color-accent-operations)] text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>{f}</button>
                ))}
                <div className="w-px h-5 bg-gray-200 dark:bg-slate-600 mx-1" />
                {['All', 'Pending', 'Posted'].map(f => (
                  <button key={f} onClick={() => setAdjustingStatusFilter(f)} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition whitespace-nowrap ${adjustingStatusFilter === f ? 'bg-[var(--color-accent-operations)] text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>{f}</button>
                ))}
              </div>

              {loading && (
                <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500">
                  <Loader2 className="w-5 h-5 animate-spin" /> Loading adjusting entriesâ€¦
                </div>
              )}
              {!loading && adjusting.length === 0 && (
                <div className="p-8 text-center text-sm text-gray-500">No adjusting entries found.</div>
              )}
              {!loading && adjusting.length > 0 && (
                <DataTable
                  columns={[
                    { key: 'entry_number', label: 'Entry ID', render: (aj: AdjustingEntryFE) => <span className="text-xs font-black text-indigo-600 uppercase tracking-tighter">{aj.entry_number}</span> },
                    { key: 'description', label: 'Description', render: (aj: AdjustingEntryFE) => <span className="text-xs font-bold text-slate-900 dark:text-white">{aj.description}</span> },
                    { key: 'adjustment_type', label: 'Type', render: (aj: AdjustingEntryFE) => {
                      const tone: StatusTone = aj.adjustment_type === 'Accrual' ? 'info' : aj.adjustment_type === 'Deferral' ? 'warning' : 'neutral';
                      return <Badge tone={tone}>{aj.adjustment_type}</Badge>;
                    } },
                    { key: 'amount', label: 'Amount', align: 'right' as const, render: (aj: AdjustingEntryFE) => <span className="text-xs font-black text-slate-900 dark:text-white font-mono">{formatAmount ? formatAmount(Number(aj.amount)) : `$${Number(aj.amount).toLocaleString()}`}</span> },
                    { key: 'created_by', label: 'Created By', render: (aj: AdjustingEntryFE) => <span className="text-xs font-bold text-slate-500">{aj.created_by || 'â€”'}</span> },
                    { key: 'status', label: 'Status', render: (aj: AdjustingEntryFE) => (
                      <Badge tone={aj.status === 'Posted' ? 'success' : aj.status === 'Pending' ? 'warning' : 'neutral'}>{aj.status}</Badge>
                    ) },
                    { key: 'property_name', label: 'Property', render: (aj: AdjustingEntryFE) => <span className="text-[10px] font-bold text-slate-500">{aj.property_name || propertyName(aj.property_id)}</span> },
                    { key: 'actions', label: 'Actions', align: 'center' as const, sortable: false, render: (aj: AdjustingEntryFE) => {
                      const isMenuOpen = menuOpen === aj.id;
                      const handlePost = async () => {
                        setActingOn(aj.id); setMenuOpen(null);
                        try {
                          await apiUpdateAdjusting(aj.id, { status: 'Posted' });
                          addNotification?.(`Adjustment ${aj.entry_number} posted.`, 'task', 'Finance');
                          loadAll();
                        } catch (e: any) { addNotification?.(e?.message || 'Failed to post adjustment', 'warning', 'Finance'); }
                        finally { setActingOn(null); }
                      };
                      const handleDelete = async () => {
                        setActingOn(aj.id); setMenuOpen(null);
                        try {
                          await apiDeleteAdjusting(aj.id);
                          addNotification?.(`Adjustment ${aj.entry_number} deleted.`, 'task', 'Finance');
                          loadAll();
                        } catch (e: any) { addNotification?.(e?.message || 'Failed to delete adjustment', 'warning', 'Finance'); }
                        finally { setActingOn(null); }
                      };
                      return (
                        <div className="flex justify-center gap-1 relative">
                          <div className="relative">
                            <button onClick={() => setMenuOpen(isMenuOpen ? null : aj.id)} disabled={actingOn === aj.id} className={button.ghost + ' disabled:opacity-50'}>
                              {actingOn === aj.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MoreVertical className="w-4 h-4" />}
                            </button>
                            {isMenuOpen && (
                              <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden">
                                {aj.status === 'Pending' && (
                                  <button onClick={handlePost} className="w-full text-left px-3 py-2 text-xs font-medium text-[var(--color-success)] hover:bg-slate-100 dark:hover:bg-slate-700 transition">
                                    <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" /> Post
                                  </button>
                                )}
                                <button onClick={handleDelete} className="w-full text-left px-3 py-2 text-xs font-medium text-[var(--color-danger)] hover:bg-red-50 dark:hover:bg-red-900/20 transition border-t border-gray-100 dark:border-slate-700">
                                  <Trash2 className="w-3.5 h-3.5 inline mr-1" /> Delete
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    } },
                  ] as Column<AdjustingEntryFE>[]}
                  data={adjusting.filter(aj => (adjustingTypeFilter === 'All' || aj.adjustment_type === adjustingTypeFilter) && (adjustingStatusFilter === 'All' || aj.status === adjustingStatusFilter))}
                  rowKey={(aj) => aj.id}
                  sortable
                  filterable
                  filterPlaceholder="Search adjustments..."
                  filterKeys={['entry_number', 'description', 'adjustment_type', 'status', 'property_name']}
                  containerClassName="rounded-lg border-0"
                />
              )}
           </SectionCard>
        </div>
      )}

      {activeTab === 'closing' && (
        <div className={layout.sectionStack}>
           <div className={layout.kpiGrid}>
             <StatCard title="Pending" value={closing.filter(c => c.status === 'Pending').length} icon={Clock} tone="warning" />
             <StatCard title="Posted" value={closing.filter(c => c.status === 'Posted').length} icon={ShieldCheck} tone="success" />
             <StatCard title="Total" value={closing.length} icon={FileText} tone="accent" />
             <StatCard title="Net Income" value={formatAmount ? formatAmount(closing.reduce((s, c) => s + Number(c.net_income || 0), 0)) : `$${closing.reduce((s, c) => s + Number(c.net_income || 0), 0).toLocaleString()}`} icon={DollarSign} tone="info" />
           </div>

           <SectionCard
             title="Closing Journals"
             subtitle="Fiscal year close and reset procedures"
             icon={ShieldCheck}
             pad="none"
             bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
           >
              {/* Filters */}
              <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 flex flex-wrap items-center gap-2">
                {['All', 'Month-End', 'Quarter-End', 'Year-End'].map(f => (
                  <button key={f} onClick={() => setClosingTypeFilter(f)} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition whitespace-nowrap ${closingTypeFilter === f ? 'bg-[var(--color-accent-operations)] text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>{f}</button>
                ))}
                <div className="w-px h-5 bg-gray-200 dark:bg-slate-600 mx-1" />
                {['All', 'Pending', 'Posted'].map(f => (
                  <button key={f} onClick={() => setClosingStatusFilter(f)} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition whitespace-nowrap ${closingStatusFilter === f ? 'bg-[var(--color-accent-operations)] text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>{f}</button>
                ))}
              </div>

              {loading && (
                <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500">
                  <Loader2 className="w-5 h-5 animate-spin" /> Loading closing entriesâ€¦
                </div>
              )}
              {!loading && closing.length === 0 && (
                <div className="p-8 text-center text-sm text-gray-500">No closing entries found.</div>
              )}
              {!loading && closing.length > 0 && (
                <DataTable
                  columns={[
                    { key: 'entry_number', label: 'Entry ID', render: (cj: ClosingEntryFE) => <span className="text-xs font-black text-indigo-600 uppercase tracking-tighter">{cj.entry_number}</span> },
                    { key: 'period', label: 'Period', render: (cj: ClosingEntryFE) => <span className="text-xs font-bold text-slate-900 dark:text-white">{cj.period}</span> },
                    { key: 'closing_type', label: 'Closing Type', render: (cj: ClosingEntryFE) => {
                      const tone: StatusTone = cj.closing_type === 'Month-End' ? 'info' : cj.closing_type === 'Quarter-End' ? 'warning' : 'success';
                      return <Badge tone={tone}>{cj.closing_type}</Badge>;
                    } },
                    { key: 'revenue_closed', label: 'Revenue Closed', align: 'right' as const, render: (cj: ClosingEntryFE) => <span className="text-xs font-black text-emerald-600 font-mono">{formatAmount ? formatAmount(Number(cj.revenue_closed)) : `$${Number(cj.revenue_closed).toLocaleString()}`}</span> },
                    { key: 'expense_closed', label: 'Expense Closed', align: 'right' as const, render: (cj: ClosingEntryFE) => <span className="text-xs font-black text-rose-600 font-mono">{formatAmount ? formatAmount(Number(cj.expense_closed)) : `$${Number(cj.expense_closed).toLocaleString()}`}</span> },
                    { key: 'net_income', label: 'Net Income', align: 'right' as const, render: (cj: ClosingEntryFE) => <span className="text-xs font-black text-indigo-600 font-mono">{formatAmount ? formatAmount(Number(cj.net_income)) : `$${Number(cj.net_income).toLocaleString()}`}</span> },
                    { key: 'status', label: 'Status', render: (cj: ClosingEntryFE) => (
                      <Badge tone={cj.status === 'Posted' ? 'success' : 'warning'}>{cj.status}</Badge>
                    ) },
                    { key: 'property_name', label: 'Property', render: (cj: ClosingEntryFE) => <span className="text-[10px] font-bold text-slate-500">{cj.property_name || propertyName(cj.property_id)}</span> },
                    { key: 'actions', label: 'Actions', align: 'center' as const, sortable: false, render: (cj: ClosingEntryFE) => {
                      const isMenuOpen = menuOpen === cj.id;
                      const handlePost = async () => {
                        setActingOn(cj.id); setMenuOpen(null);
                        try {
                          await apiUpdateClosing(cj.id, { status: 'Posted' });
                          addNotification?.(`Closing entry ${cj.entry_number} posted.`, 'task', 'Finance');
                          loadAll();
                        } catch (e: any) { addNotification?.(e?.message || 'Failed to post closing entry', 'warning', 'Finance'); }
                        finally { setActingOn(null); }
                      };
                      const handleDelete = async () => {
                        setActingOn(cj.id); setMenuOpen(null);
                        try {
                          await apiDeleteClosing(cj.id);
                          addNotification?.(`Closing entry ${cj.entry_number} deleted.`, 'task', 'Finance');
                          loadAll();
                        } catch (e: any) { addNotification?.(e?.message || 'Failed to delete closing entry', 'warning', 'Finance'); }
                        finally { setActingOn(null); }
                      };
                      return (
                        <div className="flex justify-center gap-1 relative">
                          <div className="relative">
                            <button onClick={() => setMenuOpen(isMenuOpen ? null : cj.id)} disabled={actingOn === cj.id} className={button.ghost + ' disabled:opacity-50'}>
                              {actingOn === cj.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MoreVertical className="w-4 h-4" />}
                            </button>
                            {isMenuOpen && (
                              <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden">
                                {cj.status === 'Pending' && (
                                  <button onClick={handlePost} className="w-full text-left px-3 py-2 text-xs font-medium text-[var(--color-success)] hover:bg-slate-100 dark:hover:bg-slate-700 transition">
                                    <Send className="w-3.5 h-3.5 inline mr-1" /> Post
                                  </button>
                                )}
                                <button onClick={handleDelete} className="w-full text-left px-3 py-2 text-xs font-medium text-[var(--color-danger)] hover:bg-red-50 dark:hover:bg-red-900/20 transition border-t border-gray-100 dark:border-slate-700">
                                  <Trash2 className="w-3.5 h-3.5 inline mr-1" /> Delete
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    } },
                  ] as Column<ClosingEntryFE>[]}
                  data={closing.filter(cj => (closingTypeFilter === 'All' || cj.closing_type === closingTypeFilter) && (closingStatusFilter === 'All' || cj.status === closingStatusFilter))}
                  rowKey={(cj) => cj.id}
                  sortable
                  filterable
                  filterPlaceholder="Search closing entries..."
                  filterKeys={['entry_number', 'period', 'closing_type', 'status', 'property_name']}
                  containerClassName="rounded-lg border-0"
                />
              )}
           </SectionCard>
        </div>
      )}

      {activeTab === 'automatic' && (
        <div className={layout.sectionStack}>
           <div className={layout.kpiGrid}>
             <StatCard title="Automatic Journals" value={journals.filter(j => journalType(j) === 'Automatic').length} icon={FileText} tone="accent" />
             <StatCard title="Posted" value={journals.filter(j => journalType(j) === 'Automatic' && j.status === 'Posted').length} icon={CheckCircle2} tone="success" />
             <StatCard title="Pending" value={journals.filter(j => journalType(j) === 'Automatic' && j.status === 'Pending').length} icon={Clock} tone="warning" />
             <StatCard title="Total Value" value={formatAmount ? formatAmount(journals.filter(j => journalType(j) === 'Automatic').reduce((s, j) => s + Number(j.amount || 0), 0)) : `$${journals.filter(j => journalType(j) === 'Automatic').reduce((s, j) => s + Number(j.amount || 0), 0).toLocaleString()}`} icon={DollarSign} tone="info" />
           </div>

           <SectionCard
             title="Automatic Journals"
             subtitle="System-generated journal entries from integrated modules"
             icon={Settings}
             pad="none"
             bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
           >
              {loading && (
                <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500">
                  <Loader2 className="w-5 h-5 animate-spin" /> Loading automatic journals…
                </div>
              )}
              {!loading && journals.filter(j => journalType(j) === 'Automatic').length === 0 && (
                <div className="p-8 text-center text-sm text-gray-500">No automatic journals found.</div>
              )}
              {!loading && journals.filter(j => journalType(j) === 'Automatic').length > 0 && (
                <DataTable
                  columns={[
                    { key: 'id', label: 'Journal #', render: (j: JournalEntryFE) => (
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 rounded-lg"><FileText size={12} /></div>
                        <span className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-tighter">{j.reference || j.id}</span>
                      </div>
                    ) },
                    { key: 'entry_date', label: 'Date', render: (j: JournalEntryFE) => <span className="text-xs font-bold text-slate-500">{j.entry_date}</span> },
                    { key: 'source', label: 'Source Module', render: (j: JournalEntryFE) => <span className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase">{j.source || 'System'}</span> },
                    { key: 'description', label: 'Description', render: (j: JournalEntryFE) => <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{j.description}</span> },
                    { key: 'total_debit', label: 'Debit', align: 'right' as const, render: (j: JournalEntryFE) => <span className="text-xs font-black text-emerald-600 font-mono">{formatAmount ? formatAmount(Number(j.total_debit) || 0) : `$${Number(j.total_debit || 0).toLocaleString()}`}</span> },
                    { key: 'total_credit', label: 'Credit', align: 'right' as const, render: (j: JournalEntryFE) => <span className="text-xs font-black text-rose-600 font-mono">{formatAmount ? formatAmount(Number(j.total_credit) || 0) : `$${Number(j.total_credit || 0).toLocaleString()}`}</span> },
                    { key: 'status', label: 'Status', render: (j: JournalEntryFE) => {
                      const tone: StatusTone =
                        j.status === 'Posted' ? 'success' :
                        j.status === 'Approved' ? 'info' :
                        j.status === 'Pending' ? 'warning' : 'neutral';
                      return <Badge tone={tone}>{j.status}</Badge>;
                    } },
                    { key: 'actions', label: 'Actions', align: 'center' as const, sortable: false, render: (j: JournalEntryFE) => (
                      <div className="flex justify-center gap-1">
                        <button onClick={() => setSelectedJournal(j)} className="p-1.5 text-slate-400 hover:text-indigo-600 transition"><Eye size={14} /></button>
                      </div>
                    ) },
                  ] as Column<JournalEntryFE>[]}
                  data={journals.filter(j => journalType(j) === 'Automatic')}
                  rowKey={(j) => j.id}
                  sortable
                  filterable
                  filterPlaceholder="Search automatic journals..."
                  filterKeys={['id', 'reference', 'source', 'description', 'status']}
                  containerClassName="rounded-lg border-0"
                />
              )}
           </SectionCard>
        </div>
      )}

      {activeTab === 'trial_balance' && (
        <div className={layout.sectionStack}>
           <div className={layout.kpiGrid}>
             <StatCard title="Total Debits" value={formatAmount ? formatAmount(Number(trialBalance?.totalDebit || 0)) : `$${Number(trialBalance?.totalDebit || 0).toLocaleString()}`} icon={ArrowUpRight} tone="success" />
             <StatCard title="Total Credits" value={formatAmount ? formatAmount(Number(trialBalance?.totalCredit || 0)) : `$${Number(trialBalance?.totalCredit || 0).toLocaleString()}`} icon={ArrowDownRight} tone="info" />
             <StatCard title="Net Balance" value={formatAmount ? formatAmount(Number(trialBalance?.totalDebit || 0) - Number(trialBalance?.totalCredit || 0)) : `$${(Number(trialBalance?.totalDebit || 0) - Number(trialBalance?.totalCredit || 0)).toLocaleString()}`} icon={CheckCircle2} tone={trialBalance?.balanced ? 'success' : 'warning'} />
             <StatCard title="Accounts" value={trialBalance?.rows.length || 0} icon={FileText} tone="neutral" />
           </div>

           <SectionCard
             title="Trial Balance Report"
             subtitle="Debit and credit balance verification"
             icon={FileText}
             actions={
               <div className="flex items-center gap-2">
                 <button onClick={handleExportTrialBalance} className={button.secondary}><Download className="w-3.5 h-3.5" /> Export</button>
                 <button onClick={handlePrintTrialBalance} className={button.primary}><Printer className="w-3.5 h-3.5" /> Print</button>
               </div>
             }
             pad="none"
             bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
           >
              {!trialBalance && (
                <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500">
                  <Loader2 className="w-5 h-5 animate-spin" /> Calculating trial balanceâ€¦
                </div>
              )}
              {trialBalance && trialBalance.rows.length === 0 && (
                <div className="p-8 text-center text-sm text-gray-500">No posted journal activity to report.</div>
              )}
              {trialBalance && trialBalance.rows.length > 0 && (
                <DataTable
                  columns={[
                    { key: 'accountCode', label: 'Account Code', render: (tb: any) => <span className="text-xs font-mono text-slate-500">{tb.accountCode}</span> },
                    { key: 'accountName', label: 'Account Name', render: (tb: any) => <span className="text-xs font-bold text-slate-900 dark:text-white">{tb.accountName}</span> },
                    { key: 'accountType', label: 'Type', render: (tb: any) => {
                      const tone: StatusTone =
                        tb.accountType === 'Asset' ? 'success' :
                        tb.accountType === 'Liability' ? 'danger' :
                        tb.accountType === 'Equity' ? 'info' :
                        tb.accountType === 'Revenue' ? 'warning' : 'neutral';
                      return <Badge tone={tone}>{tb.accountType}</Badge>;
                    } },
                    { key: 'debit', label: 'Debit', align: 'right' as const, render: (tb: any) => <span className="text-xs font-black text-emerald-600 font-mono">{Number(tb.debit) > 0 ? (formatAmount ? formatAmount(Number(tb.debit)) : `$${Number(tb.debit).toLocaleString()}`) : '-'}</span> },
                    { key: 'credit', label: 'Credit', align: 'right' as const, render: (tb: any) => <span className="text-xs font-black text-rose-600 font-mono">{Number(tb.credit) > 0 ? (formatAmount ? formatAmount(Number(tb.credit)) : `$${Number(tb.credit).toLocaleString()}`) : '-'}</span> },
                    { key: 'balance', label: 'Balance', align: 'right' as const, render: (tb: any) => <span className="text-xs font-black text-indigo-600 font-mono">{formatAmount ? formatAmount(Number(tb.balance)) : `$${Number(tb.balance).toLocaleString()}`}</span> },
                  ] as Column<any>[]}
                  data={trialBalance.rows}
                  rowKey={(tb: any) => tb.accountCode}
                  sortable
                  filterable
                  filterPlaceholder="Search accounts..."
                  filterKeys={['accountCode', 'accountName', 'accountType']}
                  containerClassName="rounded-lg border-0"
                />
              )}
           </SectionCard>
        </div>
      )}

      {activeTab === 'audit_trail' && (
        <div className={layout.sectionStack}>
           <div className={layout.kpiGrid}>
             <StatCard title="Total Events" value={auditTrail.length} icon={FileText} tone="accent" />
             <StatCard title="Created" value={auditTrail.filter(a => a.action === 'Created').length} icon={CheckCircle2} tone="success" />
             <StatCard title="Posted" value={auditTrail.filter(a => a.action === 'Posted').length} icon={Send} tone="info" />
             <StatCard title="Reversed" value={auditTrail.filter(a => a.action === 'Reversed').length} icon={RotateCcw} tone="warning" />
           </div>

           <SectionCard
             title="Journal Audit Trail"
             subtitle="Complete transaction history and changes"
             icon={History}
             actions={
               <div className="flex items-center gap-2">
                 <button className={button.secondary}><Filter className="w-3.5 h-3.5" /> Filter</button>
                 <button onClick={handleExportAuditTrail} className={button.primary}><Download className="w-3.5 h-3.5" /> Export</button>
               </div>
             }
             pad="none"
             bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
           >
              {/* Filters */}
              <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 flex flex-wrap items-center gap-2">
                {['All', 'Created', 'Posted', 'Modified', 'Reversed'].map(f => (
                  <button key={f} onClick={() => setAuditActionFilter(f)} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition whitespace-nowrap ${auditActionFilter === f ? 'bg-[var(--color-accent-operations)] text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>{f}</button>
                ))}
              </div>

              {loading && (
                <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500">
                  <Loader2 className="w-5 h-5 animate-spin" /> Loading audit trailâ€¦
                </div>
              )}
              {!loading && auditTrail.length === 0 && (
                <div className="p-8 text-center text-sm text-gray-500">No audit events recorded.</div>
              )}
              {!loading && auditTrail.length > 0 && (
                <DataTable
                  columns={[
                    { key: 'occurred_at', label: 'Timestamp', render: (at: AuditTrailFE) => <span className="text-xs font-bold text-slate-500">{at.occurred_at}</span> },
                    { key: 'journal_id', label: 'Journal ID', render: (at: AuditTrailFE) => <span className="text-xs font-black text-indigo-600 uppercase tracking-tighter">{at.journal_id}</span> },
                    { key: 'action', label: 'Action', render: (at: AuditTrailFE) => {
                      const tone: StatusTone =
                        at.action === 'Created' ? 'success' :
                        at.action === 'Posted' ? 'info' :
                        at.action === 'Modified' ? 'warning' :
                        at.action === 'Reversed' ? 'danger' : 'neutral';
                      return <Badge tone={tone}>{at.action}</Badge>;
                    } },
                    { key: 'description', label: 'Description', render: (at: AuditTrailFE) => <span className="text-xs font-bold text-slate-900 dark:text-white">{at.description}</span> },
                    { key: 'amount', label: 'Amount', align: 'right' as const, render: (at: AuditTrailFE) => <span className="text-xs font-black text-slate-900 dark:text-white font-mono">{formatAmount ? formatAmount(Number(at.amount)) : `$${Number(at.amount).toLocaleString()}`}</span> },
                    { key: 'user_name', label: 'User', render: (at: AuditTrailFE) => <span className="text-xs font-bold text-slate-500">{at.user_name || 'â€”'}</span> },
                    { key: 'ip_address', label: 'IP Address', render: (at: AuditTrailFE) => <span className="text-[10px] font-mono text-slate-400">{at.ip_address || 'â€”'}</span> },
                    { key: 'property_name', label: 'Property', render: (at: AuditTrailFE) => <span className="text-[10px] font-bold text-slate-500">{at.property_name || propertyName(at.property_id)}</span> },
                  ] as Column<AuditTrailFE>[]}
                  data={auditTrail.filter(at => auditActionFilter === 'All' || at.action === auditActionFilter)}
                  rowKey={(at) => at.id}
                  sortable
                  filterable
                  filterPlaceholder="Search audit trail..."
                  filterKeys={['journal_id', 'action', 'description', 'user_name', 'property_name']}
                  containerClassName="rounded-lg border-0"
                />
              )}
           </SectionCard>
        </div>
      )}

      <ModalSystem
        isOpen={!!selectedJournal}
        onClose={() => setSelectedJournal(null)}
        title={selectedJournal?.reference || selectedJournal?.id || ''}
        subtitle={`Reference: ${selectedJournal?.reference ?? ''}`}
        variant="info"
        size="xl"
        showFooter={false}
      >
              <div className="p-6 space-y-6 overflow-y-auto print-area">
                 <div className="grid grid-cols-3 gap-6 text-[11px]">
                    <div>
                       <span className="text-slate-400 uppercase font-black block mb-1">Entry Date</span>
                       <span className="font-bold text-slate-900 dark:text-white">{selectedJournal?.entry_date || '-'}</span>
                    </div>
                    <div>
                       <span className="text-slate-400 uppercase font-black block mb-1">Created By</span>
                       <span className="font-bold text-slate-900 dark:text-white">{selectedJournal?.created_by || '-'}</span>
                    </div>
                    <div className="text-right">
                       <span className="text-slate-400 uppercase font-black block mb-1">Total Amount</span>
                       <span className="font-black text-indigo-600">{formatAmount ? formatAmount(Number(selectedJournal?.amount || 0)) : `$${Number(selectedJournal?.amount || 0).toLocaleString()}`}</span>
                    </div>
                 </div>

                 {/* Approval Workflow Info */}
                 {selectedJournal && (selectedJournal.status === 'Approved' || selectedJournal.status === 'Posted') && (
                   <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-3">
                         <UserCheck size={16} className="text-blue-600" />
                         <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest">Approval Information</span>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-[10px]">
                         <div>
                            <span className="text-slate-500 uppercase font-black block mb-1">Approved By</span>
                            <span className="font-bold text-slate-900 dark:text-white">{selectedJournal.approved_by || 'Finance Manager'}</span>
                         </div>
                         <div>
                            <span className="text-slate-500 uppercase font-black block mb-1">Approved At</span>
                            <span className="font-bold text-slate-900 dark:text-white">
                              {selectedJournal.approved_at ? new Date(selectedJournal.approved_at).toLocaleString() : '-'}
                            </span>
                         </div>
                      </div>
                   </div>
                 )}

                 {selectedJournal && selectedJournal.status === 'Posted' && (
                   <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-3">
                         <ShieldCheck size={16} className="text-emerald-600" />
                         <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Posting Information</span>
                      </div>
                      <div className="text-[10px]">
                         <span className="text-slate-500 uppercase font-black block mb-1">Posted At</span>
                         <span className="font-bold text-slate-900 dark:text-white">
                           {selectedJournal.posted_at ? new Date(selectedJournal.posted_at).toLocaleString() : '-'}
                         </span>
                      </div>
                   </div>
                 )}

                 {selectedJournal && (
                   <div className="space-y-4">
                      <h4 className="text-[10px] font-black text-slate-900 dark:text-white uppercase tracking-widest">Entry Description</h4>
                      <p className="text-xs font-bold text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-700 p-4 rounded-lg border border-slate-100 dark:border-slate-700">
                         {selectedJournal.description || '-'}
                      </p>
                   </div>
                 )}

                 {selectedJournal && (
                   <div className="space-y-4">
                      <h4 className="text-[10px] font-black text-slate-900 dark:text-white uppercase tracking-widest">Ledger Lines</h4>
                      <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden shadow-sm">
                         <table className="w-full text-left border-collapse">
                            <thead>
                               <tr className="bg-slate-50/50 dark:bg-slate-700/20">
                                  <th className="px-4 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Account</th>
                                  <th className="px-4 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Description</th>
                                  <th className="px-4 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Debit</th>
                                  <th className="px-4 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Credit</th>
                               </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                               {Array.isArray(selectedJournal.lines) && selectedJournal.lines.length > 0 ? selectedJournal.lines.map((line: any, idx: number) => (
                                  <tr key={idx} className="text-[10px]">
                                     <td className="px-4 py-3 font-bold text-indigo-600">{line.accountId} - {line.accountName}</td>
                                     <td className="px-4 py-3 font-bold text-slate-600 dark:text-slate-400">{line.description}</td>
                                     <td className="px-4 py-3 font-black text-emerald-600 text-right">{Number(line.debit) > 0 ? (formatAmount ? formatAmount(Number(line.debit)) : `$${Number(line.debit).toLocaleString()}`) : '-'}</td>
                                     <td className="px-4 py-3 font-black text-rose-600 text-right">{Number(line.credit) > 0 ? (formatAmount ? formatAmount(Number(line.credit)) : `$${Number(line.credit).toLocaleString()}`) : '-'}</td>
                                  </tr>
                               )) : (
                                  <tr>
                                     <td colSpan={4} className="px-4 py-6 text-center text-slate-400 font-bold uppercase text-[9px]">No breakdown available for this entry</td>
                                  </tr>
                               )}
                            </tbody>
                            <tfoot className="bg-slate-50/50 dark:bg-slate-700/20 border-t border-slate-200 dark:border-slate-700">
                               <tr className="text-[10px] font-black">
                                  <td colSpan={2} className="px-4 py-3 uppercase">Total</td>
                                  <td className="px-4 py-3 text-right text-indigo-600">{formatAmount ? formatAmount(Number(selectedJournal.amount || 0)) : `$${Number(selectedJournal.amount || 0).toLocaleString()}`}</td>
                                  <td className="px-4 py-3 text-right text-indigo-600">{formatAmount ? formatAmount(Number(selectedJournal.amount || 0)) : `$${Number(selectedJournal.amount || 0).toLocaleString()}`}</td>
                               </tr>
                            </tfoot>
                         </table>
                      </div>
                   </div>
                 )}
              </div>

              <div className="p-6 border-t border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50/30 dark:bg-slate-700/20 no-print">
                 <div className="flex gap-2">
                    {selectedJournal && selectedJournal.status === 'Draft' && (
                      <button 
                        onClick={() => handleSubmitForApproval(selectedJournal)}
                        className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition flex items-center gap-2"
                      >
                        <Send size={14} /> Submit for Approval
                      </button>
                    )}
                    {selectedJournal && selectedJournal.status === 'Pending' && (
                      <button
                        onClick={() => handleApproveJournal(selectedJournal)}
                        className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition flex items-center gap-2"
                      >
                        <UserCheck size={14} /> Approve Journal
                      </button>
                    )}
                    {selectedJournal && selectedJournal.status === 'Approved' && (
                      <button 
                        onClick={() => handlePostJournal(selectedJournal)}
                        className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition flex items-center gap-2"
                      >
                        <ShieldCheck size={14} /> Post to GL
                      </button>
                    )}
                    {selectedJournal && selectedJournal.status === 'Posted' && (
                      <button
                        onClick={() => handleReverseJournal(selectedJournal)}
                        className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition flex items-center gap-2"
                      >
                        <RotateCcw size={14} /> Reverse Journal
                      </button>
                    )}
                 </div>
                 <div className="flex gap-3">
                    <button 
                      onClick={() => window.print()}
                      className="px-6 py-2.5 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition flex items-center gap-2"
                    >
                      <Download size={14} /> Print Voucher
                    </button>
                    <button 
                      onClick={() => setSelectedJournal(null)}
                      className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition"
                    >
                      Close View
                    </button>
                 </div>
              </div>
      </ModalSystem>

      <ModalSystem
        isOpen={!!selectedInvoice}
        onClose={() => setSelectedInvoice(null)}
        title={selectedInvoice?.invoice_number ?? ''}
        subtitle={`Document Audit Trail â€¢ Issued ${selectedInvoice?.issue_date ?? ''}`}
        variant="info"
        size="xl"
        showFooter={false}
      >
            {selectedInvoice && (
              <div className="p-8 space-y-8">
              <div className="grid grid-cols-2 gap-8">
                <div>
                   <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Entity Description</span>
                   <p className="text-sm font-black text-slate-900 dark:text-white uppercase leading-none">{selectedInvoice?.entity || '-'}</p>
                   <p className="text-[10px] text-slate-500 font-bold mt-1 uppercase">Primary Billing Recipient</p>
                </div>
                <div className="text-right">
                   <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">GL Posting Status</span>
                   <div className="flex flex-col items-end gap-1">
                      <span className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase ${
                        selectedInvoice?.gl_status === 'Posted' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {selectedInvoice?.gl_status || '-'}
                      </span>
                      {selectedInvoice?.gl_ref && selectedInvoice.gl_ref !== '-' && <span className="text-[9px] font-black text-indigo-600 font-mono italic">Ref: {selectedInvoice.gl_ref}</span>}
                   </div>
                </div>
              </div>

              <div className="space-y-4">
                 <div className="flex justify-between items-center px-1">
                    <h4 className="text-[10px] font-black text-slate-800 dark:text-white uppercase tracking-widest">Document Line Breakdown</h4>
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{Array.isArray(selectedInvoice.items) ? selectedInvoice.items.length : 0} Items</span>
                 </div>
                 <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-lg overflow-hidden shadow-sm">
                    <table className="w-full text-left border-collapse">
                       <thead>
                          <tr className="bg-slate-50/50 dark:bg-slate-700/20 border-b border-slate-100 dark:border-slate-700">
                             <th className="px-4 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Item Description</th>
                             <th className="px-4 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center">Qty</th>
                             <th className="px-4 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Unit Rate</th>
                             <th className="px-4 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Total</th>
                          </tr>
                       </thead>
                       <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                          {Array.isArray(selectedInvoice.items) && selectedInvoice.items.map((item: any, idx: number) => (
                             <tr key={idx} className="group hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                                <td className="px-4 py-2.5 text-xs font-bold text-slate-900 dark:text-white uppercase tracking-tight">{item.desc}</td>
                                <td className="px-4 py-2.5 text-xs font-bold text-slate-500 text-center">{item.qty}</td>
                                <td className="px-4 py-2.5 text-xs font-bold text-slate-500 text-right font-mono">${Number(item.rate).toLocaleString()}</td>
                                <td className="px-4 py-2.5 text-xs font-black text-slate-900 dark:text-white text-right font-mono">${Number(item.total).toLocaleString()}</td>
                             </tr>
                          ))}
                       </tbody>
                    </table>
                 </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-700/40 rounded-lg p-6 border border-slate-100 dark:border-slate-700">
                 <div className="space-y-4">
                    <div className="flex justify-between items-center text-xs font-bold text-slate-500 uppercase">
                       <span>Net Transaction Amount</span>
                       <span className="font-mono text-slate-900 dark:text-white">${Number(selectedInvoice?.net_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs font-bold text-slate-500 uppercase">
                       <span>Sales Tax / VAT (15%)</span>
                       <span className="font-mono text-slate-900 dark:text-white">${Number(selectedInvoice?.tax_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="h-px bg-slate-200 dark:bg-slate-800 my-2" />
                    <div className="flex justify-between items-center font-black uppercase">
                       <span className="text-xs text-slate-900 dark:text-white">Gross Revenue Impact</span>
                       <span className="text-xl text-indigo-600 font-mono">${(Number(selectedInvoice?.net_amount || 0) + Number(selectedInvoice?.tax_amount || 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                 </div>
              </div>

              <div className="flex gap-4">
                 <button className="flex-1 py-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-lg text-[10px] font-black uppercase tracking-widest transition hover:opacity-90 shadow-xl shadow-slate-900/20 dark:shadow-none flex items-center justify-center gap-2">
                    <Download size={14} /> Download PDF
                 </button>
                 <button className="flex-1 py-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition hover:bg-slate-50 flex items-center justify-center gap-2">
                    <ArrowRightLeft size={14} /> View GL Entry
                 </button>
              </div>
            </div>
            )}
      </ModalSystem>
    </div>
  );
};

export default GeneralLedger;
