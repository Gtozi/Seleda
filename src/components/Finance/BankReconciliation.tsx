import React, { useState, useEffect, useCallback } from 'react';
import {
  Upload,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  XCircle,
  FileText,
  Banknote,
  Calendar,
  ArrowRight,
  ShieldCheck,
  Plus,
  Wallet,
  ArrowRightLeft,
  Coins,
  HandCoins,
  Loader2,
  ServerCrash,
  Landmark,
  Pencil,
  Trash2,
  AlertTriangle,
  Send,
  Building2,
  Receipt,
  Percent,
} from 'lucide-react';
import { ModalSystem } from '../Shared/ModalSystem';
import { DataTable, Column } from '../Shared/DataTable';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import StatCard from '../FrontOffice/StatCard';
import { useERP } from '../../context/ERPContext';
import {
  fetchBankAccounts,
  createBankAccount,
  fetchStatementLines,
  fetchReconciliationBatches,
  importStatementLines,
  matchStatementLine,
  importStatementLines,
  createReconciliationBatch,
  finalizeReconciliationBatch,
  fetchPettyCashFloats,
  createPettyCashFloat,
  fetchCashTransactions,
  createCashTransaction,
  updatePettyCashFloat,
  deletePettyCashFloat,
  type BankAccount,
  type StatementLine,
  type ReconciliationBatch,
  type PettyCashFloat,
  type CashTransaction,
  type CashTransactionType,
} from '../../services/bankReconciliationService';

const fmt = (n: number) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const BankReconciliation = () => {
  const { currentPropertyId, addNotification, properties } = useERP();
  const [activeTab, setActiveTab] = useState<'overview' | 'cash_ops' | 'import' | 'match' | 'finalize'>('overview');
  const [selectedBank, setSelectedBank] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [statementLines, setStatementLines] = useState<StatementLine[]>([]);
  const [reconciliationBatches, setReconciliationBatches] = useState<ReconciliationBatch[]>([]);
  const [pettyCashFloats, setPettyCashFloats] = useState<PettyCashFloat[]>([]);
  const [cashTransactions, setCashTransactions] = useState<CashTransaction[]>([]);

  // Filter states
  const [statementStatusFilter, setStatementStatusFilter] = useState('All');
  const [cashTxTypeFilter, setCashTxTypeFilter] = useState('All');

  // Import state
  const [importBankAccountId, setImportBankAccountId] = useState<string>('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);

  const [showNewAccount, setShowNewAccount] = useState(false);
  const [newAccountForm, setNewAccountForm] = useState({
    accountNumber: '',
    accountName: '',
    bankName: '',
    currency: 'ETB',
  });

  // Petty cash management modal state
  const [pettyModal, setPettyModal] = useState<{ mode: 'create' | 'edit'; open: boolean; saving: boolean; id?: string }>({ mode: 'create', open: false, saving: false });
  const [pettyForm, setPettyForm] = useState({
    department: '',
    floatCode: '',
    floatAmount: '',
    currentBalance: '',
    custodian: '',
    status: 'Active',
  });
  const [pettyDelete, setPettyDelete] = useState<{ id: string; department: string } | null>(null);
  const [pettyDeleting, setPettyDeleting] = useState(false);

  const openPettyCreate = () => {
    setPettyForm({ department: '', floatCode: '', floatAmount: '', currentBalance: '', custodian: '', status: 'Active' });
    setPettyModal({ mode: 'create', open: true, saving: false });
  };

  const openPettyEdit = (pc: PettyCashFloat) => {
    setPettyForm({
      department: pc.department || '',
      floatCode: pc.float_code || '',
      floatAmount: String(pc.float_amount || 0),
      currentBalance: String(pc.current_balance || 0),
      custodian: pc.custodian || '',
      status: pc.status || 'Active',
    });
    setPettyModal({ mode: 'edit', open: true, saving: false, id: pc.id });
  };

  const closePettyModal = () => setPettyModal(prev => ({ ...prev, open: false, saving: false }));

  const handlePettySave = async () => {
    if (!pettyForm.department) {
      addNotification('Department is required', 'warning', 'finance');
      return;
    }
    setPettyModal(prev => ({ ...prev, saving: true }));
    try {
      const pid = currentPropertyId || undefined;
      if (pettyModal.mode === 'create') {
        await createPettyCashFloat({
          department: pettyForm.department,
          float_code: pettyForm.floatCode || undefined,
          float_amount: Number(pettyForm.floatAmount) || 0,
          current_balance: Number(pettyForm.currentBalance) || Number(pettyForm.floatAmount) || 0,
          custodian: pettyForm.custodian || undefined,
          status: pettyForm.status,
          propertyId: pid,
        });
        addNotification('Petty cash float created', 'success', 'finance');
      } else if (pettyModal.id) {
        await updatePettyCashFloat(pettyModal.id, {
          department: pettyForm.department,
          float_code: pettyForm.floatCode || undefined,
          float_amount: Number(pettyForm.floatAmount) || 0,
          current_balance: Number(pettyForm.currentBalance) || 0,
          custodian: pettyForm.custodian || undefined,
          status: pettyForm.status,
        });
        addNotification('Petty cash float updated', 'success', 'finance');
      }
      await loadData();
      closePettyModal();
    } catch (err: any) {
      addNotification(err.message || 'Failed to save petty cash float', 'warning', 'finance');
    } finally {
      setPettyModal(prev => ({ ...prev, saving: false }));
    }
  };

  const handlePettyDelete = async () => {
    if (!pettyDelete) return;
    setPettyDeleting(true);
    try {
      await deletePettyCashFloat(pettyDelete.id);
      addNotification('Petty cash float deleted', 'info', 'finance');
      setPettyDelete(null);
      await loadData();
    } catch (err: any) {
      addNotification(err.message || 'Failed to delete petty cash float', 'warning', 'finance');
    } finally {
      setPettyDeleting(false);
    }
  };

  const handleFinalizeReconciliation = async () => {
    const openBatch = reconciliationBatches.find(b => b.status === 'Open' || b.status === 'In Progress');
    if (!openBatch) {
      addNotification('No open reconciliation batch to finalize.', 'warning', 'finance');
      return;
    }
    try {
      await finalizeReconciliationBatch(openBatch.id);
      addNotification('Reconciliation finalized successfully.', 'success', 'finance');
      await loadData();
    } catch (err: any) {
      addNotification(err.message || 'Failed to finalize reconciliation', 'warning', 'finance');
    }
  };

  const parseCsvFile = (text: string): Array<{ statement_date: string; transaction_date: string; description?: string; reference?: string; debit?: number; credit?: number; balance?: number }> => {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return [];
    // Detect delimiter and header
    const delim = lines[0].includes(';') ? ';' : ',';
    const header = lines[0].split(delim).map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
    const dateIdx = header.findIndex(h => h.includes('date'));
    const descIdx = header.findIndex(h => h.includes('desc') || h.includes('narr'));
    const refIdx = header.findIndex(h => h.includes('ref'));
    const debitIdx = header.findIndex(h => h.includes('debit') || h.includes('withdraw') || h.includes('dr'));
    const creditIdx = header.findIndex(h => h.includes('credit') || h.includes('deposit') || h.includes('cr'));
    const amountIdx = header.findIndex(h => h.includes('amount'));
    const balanceIdx = header.findIndex(h => h.includes('balance'));
    const out: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(delim).map(c => c.trim().replace(/^"|"$/g, ''));
      const date = dateIdx >= 0 ? cols[dateIdx] : '';
      const amount = amountIdx >= 0 ? Number(cols[amountIdx].replace(/[^0-9.-]/g, '')) || 0 : 0;
      const debit = debitIdx >= 0 ? Number(cols[debitIdx].replace(/[^0-9.-]/g, '')) || 0 : (amount < 0 ? Math.abs(amount) : 0);
      const credit = creditIdx >= 0 ? Number(cols[creditIdx].replace(/[^0-9.-]/g, '')) || 0 : (amount > 0 ? amount : 0);
      out.push({
        statement_date: date,
        transaction_date: date,
        description: descIdx >= 0 ? cols[descIdx] : '',
        reference: refIdx >= 0 ? cols[refIdx] : '',
        debit,
        credit,
        balance: balanceIdx >= 0 ? Number(cols[balanceIdx].replace(/[^0-9.-]/g, '')) || 0 : undefined,
      });
    }
    return out;
  };

  const handleImportStatement = async () => {
    if (!importBankAccountId) {
      addNotification('Select a bank account first.', 'warning', 'finance');
      return;
    }
    if (!importFile) {
      addNotification('Choose a CSV file to import.', 'warning', 'finance');
      return;
    }
    setImporting(true);
    try {
      const text = await importFile.text();
      const lines = parseCsvFile(text);
      if (lines.length === 0) {
        addNotification('No statement lines found in the file. Ensure the CSV has a header row with Date, Description, Amount columns.', 'warning', 'finance');
        return;
      }
      await importStatementLines(importBankAccountId, lines);
      addNotification(`Imported ${lines.length} statement line${lines.length !== 1 ? 's' : ''}.`, 'success', 'finance');
      setImportFile(null);
      await loadData();
    } catch (err: any) {
      addNotification(err.message || 'Failed to import statement', 'warning', 'finance');
    } finally {
      setImporting(false);
    }
  };

  const handleAutoMatchAll = async () => {
    const unmatched = statementLines.filter(s => s.status !== 'Matched' && s.status !== 'Excluded');
    if (unmatched.length === 0) {
      addNotification('No unmatched statement lines to auto-match.', 'info', 'finance');
      return;
    }
    let matchedCount = 0;
    for (const line of unmatched) {
      // Try to find a cash transaction with the same amount
      const amount = Number(line.credit || line.debit || 0);
      if (amount === 0) continue;
      const candidate = cashTransactions.find(ct => {
        const ctAmount = Math.abs(Number(ct.amount || 0));
        return ctAmount === amount && (!line.bank_account_id || ct.bank_account_id === line.bank_account_id);
      });
      if (candidate) {
        try {
          await matchStatementLine(line.id, candidate.id);
          matchedCount++;
        } catch { /* skip on error, continue matching others */ }
      }
    }
    addNotification(`Auto-matched ${matchedCount} of ${unmatched.length} statement line${unmatched.length !== 1 ? 's' : ''}.`, matchedCount > 0 ? 'success' : 'warning', 'finance');
    await loadData();
  };

  const handleManualMatch = async (lineId: string) => {
    // Find best candidate by amount
    const line = statementLines.find(s => s.id === lineId);
    if (!line) return;
    const amount = Number(line.credit || line.debit || 0);
    const candidate = cashTransactions.find(ct => Math.abs(Number(ct.amount || 0)) === amount);
    if (!candidate) {
      addNotification('No matching ledger entry found by amount. Try importing more transactions or adjust the statement line.', 'warning', 'finance');
      return;
    }
    try {
      await matchStatementLine(lineId, candidate.id);
      addNotification('Statement line matched to ledger entry.', 'success', 'finance');
      await loadData();
    } catch (err: any) {
      addNotification(err.message || 'Failed to match statement line', 'warning', 'finance');
    }
  };

  // Cash action modal state
  type CashActionType = 'receipt' | 'payment' | 'transfer' | 'replenish' | 'electronic_payment' | 'bank_transfer' | 'bank_charges' | 'interest_income';
  const [cashModal, setCashModal] = useState<{ type: CashActionType; open: boolean; saving: boolean }>({ type: 'receipt', open: false, saving: false });
  const [cashForm, setCashForm] = useState({
    amount: '',
    description: '',
    reference: '',
    department: '',
    transactionDate: new Date().toISOString().split('T')[0],
    pettyCashId: '',
    fromAccount: '',
    toAccount: '',
    // Bank operation fields
    bankAccountId: '',
    recipient: '',
    paymentMethod: 'Wire',
    chargeType: 'Monthly Fee',
    interestPeriod: '',
    fromBankAccount: '',
    toBankAccount: '',
  });

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
    addNotification(`Exported ${rows.length} record${rows.length !== 1 ? 's' : ''} to ${filename}.`, 'success', 'finance');
  };

  const handleExport = () => {
    if (activeTab === 'cash_ops') {
      exportToCsv(`cash_transactions_${new Date().toISOString().slice(0, 10)}.csv`,
        ['Txn #', 'Date', 'Type', 'Description', 'Amount', 'Bank Account', 'Reference'],
        cashTransactions.map(t => [t.id, t.transaction_date || '', t.type, t.description || '', Number(t.amount || 0), t.bank_account_id || '', t.reference || '']));
    } else if (activeTab === 'finalize') {
      exportToCsv(`reconciliation_batches_${new Date().toISOString().slice(0, 10)}.csv`,
        ['Batch #', 'Bank Account', 'Statement Date', 'Statement Balance', 'Book Balance', 'Status'],
        reconciliationBatches.map(b => [b.id, b.bank_account_id || '', b.statement_date || '', Number(b.statement_balance || 0), Number(b.book_balance || 0), b.status || 'Open']));
    } else {
      exportToCsv(`bank_accounts_${new Date().toISOString().slice(0, 10)}.csv`,
        ['Account #', 'Bank', 'Account Name', 'Currency', 'Balance', 'Status'],
        bankAccounts.map(a => [a.id, a.bank_name || '', a.account_name || '', a.currency || '', Number(a.current_balance || 0), a.status || 'Active']));
    }
  };

  const openCashModal = (type: CashActionType) => {
    setCashForm({
      amount: '',
      description: '',
      reference: '',
      department: '',
      transactionDate: new Date().toISOString().split('T')[0],
      pettyCashId: pettyCashFloats[0]?.id || '',
      fromAccount: bankAccounts[0]?.id || '',
      toAccount: bankAccounts[0]?.id || '',
      bankAccountId: bankAccounts[0]?.id || '',
      recipient: '',
      paymentMethod: 'Wire',
      chargeType: 'Monthly Fee',
      interestPeriod: '',
      fromBankAccount: bankAccounts[0]?.id || '',
      toBankAccount: bankAccounts[1]?.id || bankAccounts[0]?.id || '',
    });
    setCashModal({ type, open: true, saving: false });
  };

  const closeCashModal = () => setCashModal(prev => ({ ...prev, open: false, saving: false }));

  const handleCashAction = async () => {
    const amount = Number(cashForm.amount);
    if (!amount || amount <= 0) {
      addNotification('A positive amount is required', 'warning', 'finance');
      return;
    }
    // Bank operations require a bank account
    if (['electronic_payment', 'bank_transfer', 'bank_charges', 'interest_income'].includes(cashModal.type)) {
      if (cashModal.type === 'bank_transfer') {
        if (!cashForm.fromBankAccount || !cashForm.toBankAccount) {
          addNotification('Select both source and destination bank accounts', 'warning', 'finance');
          return;
        }
        if (cashForm.fromBankAccount === cashForm.toBankAccount) {
          addNotification('Source and destination accounts must differ', 'warning', 'finance');
          return;
        }
      } else if (!cashForm.bankAccountId) {
        addNotification('Select a bank account', 'warning', 'finance');
        return;
      }
    }
    setCashModal(prev => ({ ...prev, saving: true }));
    try {
      const pid = currentPropertyId || undefined;
      if (cashModal.type === 'receipt') {
        await createCashTransaction({
          type: 'Receipt',
          description: cashForm.description || 'Cash receipt',
          amount,
          transaction_date: cashForm.transactionDate,
          reference: cashForm.reference || undefined,
          department: cashForm.department || undefined,
          propertyId: pid,
        });
        addNotification('Cash receipt recorded', 'success', 'finance');
      } else if (cashModal.type === 'payment') {
        await createCashTransaction({
          type: 'Payment',
          description: cashForm.description || 'Cash payment',
          amount: -amount,
          transaction_date: cashForm.transactionDate,
          reference: cashForm.reference || undefined,
          department: cashForm.department || undefined,
          propertyId: pid,
        });
        addNotification('Cash payment recorded', 'success', 'finance');
      } else if (cashModal.type === 'transfer') {
        await createCashTransaction({
          type: 'Transfer',
          description: cashForm.description || `Cash transfer ${cashForm.fromAccount} → ${cashForm.toAccount}`,
          amount: -amount,
          transaction_date: cashForm.transactionDate,
          reference: cashForm.reference || undefined,
          department: cashForm.department || undefined,
          propertyId: pid,
        });
        addNotification('Cash transfer recorded', 'success', 'finance');
      } else if (cashModal.type === 'replenish') {
        const float = pettyCashFloats.find(f => f.id === cashForm.pettyCashId);
        if (!float) {
          addNotification('Select a petty cash float to replenish', 'warning', 'finance');
          setCashModal(prev => ({ ...prev, saving: false }));
          return;
        }
        await updatePettyCashFloat(float.id, {
          current_balance: (float.current_balance || 0) + amount,
        });
        await createCashTransaction({
          type: 'Transfer',
          description: `Petty cash replenishment — ${float.department}`,
          amount,
          transaction_date: cashForm.transactionDate,
          reference: cashForm.reference || undefined,
          department: float.department || undefined,
          propertyId: pid,
        });
        addNotification('Petty cash replenished', 'success', 'finance');
      } else if (cashModal.type === 'electronic_payment') {
        const bank = bankAccounts.find(b => b.id === cashForm.bankAccountId);
        await createCashTransaction({
          type: 'Electronic Payment' as CashTransactionType,
          description: cashForm.description || `Electronic payment to ${cashForm.recipient || 'recipient'}`,
          amount: -amount,
          transaction_date: cashForm.transactionDate,
          reference: cashForm.reference || undefined,
          bank_account_id: cashForm.bankAccountId || undefined,
          recipient: cashForm.recipient || undefined,
          payment_method: cashForm.paymentMethod || undefined,
          propertyId: pid,
        });
        addNotification(`Electronic payment (${cashForm.paymentMethod}) recorded for ${bank?.account_name || 'account'}`, 'success', 'finance');
      } else if (cashModal.type === 'bank_transfer') {
        const fromBank = bankAccounts.find(b => b.id === cashForm.fromBankAccount);
        const toBank = bankAccounts.find(b => b.id === cashForm.toBankAccount);
        // Outbound leg (debit from source account)
        await createCashTransaction({
          type: 'Bank Transfer' as CashTransactionType,
          description: cashForm.description || `Bank transfer ${fromBank?.account_name || '—'} → ${toBank?.account_name || '—'}`,
          amount: -amount,
          transaction_date: cashForm.transactionDate,
          reference: cashForm.reference || undefined,
          from_account: cashForm.fromBankAccount || undefined,
          to_account: cashForm.toBankAccount || undefined,
          bank_account_id: cashForm.fromBankAccount || undefined,
          propertyId: pid,
        });
        // Inbound leg (credit to destination account)
        await createCashTransaction({
          type: 'Bank Transfer' as CashTransactionType,
          description: `Bank transfer received from ${fromBank?.account_name || '—'} → ${toBank?.account_name || '—'}`,
          amount,
          transaction_date: cashForm.transactionDate,
          reference: cashForm.reference || undefined,
          from_account: cashForm.fromBankAccount || undefined,
          to_account: cashForm.toBankAccount || undefined,
          bank_account_id: cashForm.toBankAccount || undefined,
          propertyId: pid,
        });
        addNotification('Bank transfer recorded (two-sided)', 'success', 'finance');
      } else if (cashModal.type === 'bank_charges') {
        const bank = bankAccounts.find(b => b.id === cashForm.bankAccountId);
        await createCashTransaction({
          type: 'Bank Charges' as CashTransactionType,
          description: cashForm.description || `Bank charge — ${cashForm.chargeType}`,
          amount: -amount,
          transaction_date: cashForm.transactionDate,
          reference: cashForm.reference || undefined,
          bank_account_id: cashForm.bankAccountId || undefined,
          charge_type: cashForm.chargeType || undefined,
          propertyId: pid,
        });
        addNotification(`Bank charge (${cashForm.chargeType}) recorded for ${bank?.account_name || 'account'}`, 'success', 'finance');
      } else if (cashModal.type === 'interest_income') {
        const bank = bankAccounts.find(b => b.id === cashForm.bankAccountId);
        await createCashTransaction({
          type: 'Interest Income' as CashTransactionType,
          description: cashForm.description || `Interest income${cashForm.interestPeriod ? ` — ${cashForm.interestPeriod}` : ''}`,
          amount,
          transaction_date: cashForm.transactionDate,
          reference: cashForm.reference || undefined,
          bank_account_id: cashForm.bankAccountId || undefined,
          interest_period: cashForm.interestPeriod || undefined,
          propertyId: pid,
        });
        addNotification(`Interest income recorded for ${bank?.account_name || 'account'}`, 'success', 'finance');
      }
      await loadData();
      closeCashModal();
    } catch (err: any) {
      addNotification(err.message || 'Failed to record cash action', 'warning', 'finance');
    } finally {
      setCashModal(prev => ({ ...prev, saving: false }));
    }
  }

  const propertyName = useCallback((id?: string | null): string => {
    if (!id) return '—';
    const p = properties.find(p => p.id === id);
    return p?.property_name || '—';
  }, [properties]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const pid = currentPropertyId || undefined;
      const [accounts, lines, batches, pettyCash, cashTx] = await Promise.all([
        fetchBankAccounts(pid),
        fetchStatementLines(undefined, undefined, pid),
        fetchReconciliationBatches(),
        fetchPettyCashFloats(pid),
        fetchCashTransactions(undefined, pid),
      ]);
      setBankAccounts(accounts);
      setStatementLines(lines);
      setReconciliationBatches(batches);
      setPettyCashFloats(pettyCash);
      setCashTransactions(cashTx);
    } catch (err: any) {
      console.error('Error loading bank reconciliation data:', err);
      setError(err.message || 'Failed to load bank reconciliation data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [currentPropertyId]);

  const handleCreateAccount = async () => {
    if (!newAccountForm.accountNumber || !newAccountForm.accountName || !newAccountForm.bankName) {
      setError('Account number, name and bank name are required');
      return;
    }
    try {
      await createBankAccount({
        account_number: newAccountForm.accountNumber,
        account_name: newAccountForm.accountName,
        bank_name: newAccountForm.bankName,
        currency: newAccountForm.currency,
        propertyId: currentPropertyId || undefined,
      });
      addNotification('Bank account created', 'success', 'finance');
      await loadData();
      setShowNewAccount(false);
      setNewAccountForm({ accountNumber: '', accountName: '', bankName: '', currency: 'ETB' });
    } catch (err: any) {
      console.error('Failed to create bank account:', err);
      addNotification(err.message || 'Failed to create bank account', 'warning', 'finance');
    }
  };

  // Filtered datasets
  const filteredStatementLines = statementLines.filter(l => statementStatusFilter === 'All' || l.status === statementStatusFilter);
  const filteredCashTransactions = cashTransactions.filter(t => cashTxTypeFilter === 'All' || t.type === cashTxTypeFilter);

  const handleCreateBatch = async (batch: Omit<ReconciliationBatch, 'id' | 'total_debits' | 'total_credits' | 'status' | 'reconciled_by' | 'reconciled_at' | 'created_at' | 'bank_accounts'>) => {
    try {
      await createReconciliationBatch(batch);
      await loadData();
    } catch (err: any) {
      console.error('Failed to create reconciliation batch:', err);
      setError(err.message || 'Failed to create reconciliation batch');
    }
  };

  const unmatchedCount = statementLines.filter(l => l.status === 'Unmatched').length;
  const matchedCount = statementLines.filter(l => l.status === 'Matched').length;
  const varianceCount = statementLines.filter(l => l.status === 'Partially Matched').length;

  const renderOverview = () => (
    <div className={layout.sectionStack}>
      <SectionCard
          title="Bank Accounts"
          subtitle="Operating, payroll, and reserve accounts"
          icon={Landmark}
          pad="none"
          bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
        >
          <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 flex justify-end">
            <button
              onClick={() => setShowNewAccount(true)}
              className={button.ghost + ' text-xs'}
            >
              <Plus className="w-3.5 h-3.5" /> Add Account
            </button>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {bankAccounts.map((bank) => (
              <div key={bank.id} className="px-4 py-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600">
                    <Landmark size={16} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-900 dark:text-white">{bank.account_name}</p>
                    <p className="text-[10px] text-slate-500 font-medium">{bank.account_number} • {bank.bank_name} • {bank.property_name || propertyName(bank.property_id)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-sm font-bold text-slate-900 dark:text-white">{fmt(bank.balance)}</p>
                    <p className="text-[9px] text-slate-400 uppercase font-medium">{bank.currency}</p>
                  </div>
                  <Badge tone={bank.status === 'Active' ? 'success' : 'warning'}>{bank.status}</Badge>
                </div>
              </div>
            ))}
            {bankAccounts.length === 0 && (
              <div className="p-8 text-center text-slate-500 text-xs font-medium">
                No bank accounts configured. Click "Add Account" to create one.
              </div>
            )}
          </div>
        </SectionCard>
    </div>
  );

  const renderImport = () => (
    <div className={layout.sectionStack}>
      <SectionCard
        title="Import Bank Statement"
        subtitle="Upload CSV, OFX, QFX, or PDF statements"
        icon={Upload}
      >
        {bankAccounts.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs font-medium">
            No bank accounts configured. Add an account in the Overview tab first.
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">Select Bank Account</label>
                <select
                  value={importBankAccountId}
                  onChange={e => setImportBankAccountId(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium text-slate-900 dark:text-white"
                >
                  <option value="">— Select account —</option>
                  {bankAccounts.map(bank => (
                    <option key={bank.id} value={bank.id}>{bank.account_name} ({bank.account_number})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">Statement File</label>
                <input
                  type="file"
                  accept=".csv,.ofx,.qfx,.txt"
                  onChange={e => setImportFile(e.target.files?.[0] || null)}
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium text-slate-900 dark:text-white"
                />
                {importFile && (
                  <p className="text-[10px] text-emerald-600 font-bold mt-1">Selected: {importFile.name} ({(importFile.size / 1024).toFixed(1)} KB)</p>
                )}
              </div>
            </div>

            <div
              className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-12 text-center hover:border-indigo-400 transition-colors cursor-pointer"
              onDragOver={e => { e.preventDefault(); }}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) setImportFile(f); }}
              onClick={() => document.getElementById('bank-statement-file-input')?.click()}
            >
              <Upload size={32} className="mx-auto text-slate-400 mb-4" />
              <p className="text-sm font-bold text-slate-900 dark:text-white mb-2">Drop your bank statement file here</p>
              <p className="text-[10px] text-slate-500 font-medium mb-4">Supports CSV, OFX, QFX formats</p>
              <input
                id="bank-statement-file-input"
                type="file"
                accept=".csv,.ofx,.qfx,.txt"
                className="hidden"
                onChange={e => setImportFile(e.target.files?.[0] || null)}
              />
              <button
                onClick={(e) => { e.stopPropagation(); document.getElementById('bank-statement-file-input')?.click(); }}
                className={button.primary}
              >
                Browse Files
              </button>
            </div>
            <div className="flex justify-end">
              <button
                onClick={handleImportStatement}
                disabled={importing || !importFile || !importBankAccountId}
                className={button.primary + ' disabled:opacity-50'}
              >
                {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {importing ? 'Importing…' : 'Import Statement'}
              </button>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Recent Imports"
        subtitle="Recently imported statement lines"
        icon={FileText}
        pad="none"
        bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
      >
        {statementLines.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs font-medium">
            No statement lines imported yet.
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {statementLines.slice(0, 8).map((line) => (
              <div key={line.id} className="px-4 py-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-500">
                    <FileText size={14} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-900 dark:text-white">{line.description || line.reference || 'No description'}</p>
                    <p className="text-[10px] text-slate-500 font-medium">{line.transaction_date} • {line.bank_account_name || '—'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 font-mono">{line.credit > 0 ? fmt(line.credit) : fmt(line.debit)}</span>
                  <Badge tone={line.status === 'Matched' ? 'success' : line.status === 'Partially Matched' ? 'warning' : 'danger'}>
                    {line.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );

  const renderMatch = () => (
    <SectionCard
      title="Statement Matching"
      subtitle="Match bank statement lines to ledger entries"
      icon={RefreshCw}
      pad="none"
      bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
    >
      <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center gap-2 overflow-x-auto">
        {['All', 'Unmatched', 'Matched', 'Partially Matched', 'Excluded'].map(s => (
          <button key={s} onClick={() => setStatementStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition whitespace-nowrap ${
              statementStatusFilter === s
                ? 'bg-[var(--color-accent-operations)] text-white'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
            }`}>
            {s}
          </button>
        ))}
        <div className="ml-auto">
          <button onClick={handleAutoMatchAll} className={button.primary + ' text-xs'}>
            <RefreshCw size={12} /> Auto-Match All
          </button>
        </div>
      </div>
      <DataTable
        columns={[
          {
            key: 'transaction_date',
            label: 'Date',
            render: (item: StatementLine) => (
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-slate-100 dark:bg-slate-700 text-slate-500 rounded-lg"><Calendar size={12} /></div>
                <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{item.transaction_date}</span>
              </div>
            ),
          },
          {
            key: 'description',
            label: 'Description',
            render: (item: StatementLine) => (
              <div className="flex flex-col">
                <span className="text-xs font-bold text-slate-900 dark:text-white">{item.description || item.reference || '-'}</span>
                <span className="text-[10px] text-slate-400 font-medium">{item.reference || '—'}</span>
              </div>
            ),
          },
          {
            key: 'bank_account_name',
            label: 'Bank Account',
            render: (item: StatementLine) => <span className="text-xs font-medium text-slate-500">{item.bank_account_name || '—'}</span>,
          },
          {
            key: 'credit',
            label: 'Credit',
            align: 'right' as const,
            render: (item: StatementLine) => <span className="text-xs font-mono text-emerald-600 font-bold">{item.credit > 0 ? fmt(item.credit) : '—'}</span>,
          },
          {
            key: 'debit',
            label: 'Debit',
            align: 'right' as const,
            render: (item: StatementLine) => <span className="text-xs font-mono text-rose-600 font-bold">{item.debit > 0 ? fmt(item.debit) : '—'}</span>,
          },
          {
            key: 'balance',
            label: 'Balance',
            align: 'right' as const,
            render: (item: StatementLine) => (
              <span className="text-xs font-mono font-bold text-slate-900 dark:text-white">{fmt(item.balance)}</span>
            ),
          },
          {
            key: 'property_name',
            label: 'Property',
            render: (item: StatementLine) => <span className="text-xs font-medium text-slate-500">{item.property_name || propertyName(item.property_id)}</span>,
          },
          {
            key: 'status',
            label: 'Status',
            align: 'center' as const,
            render: (item: StatementLine) => {
              const tone: StatusTone = item.status === 'Matched' ? 'success' : item.status === 'Partially Matched' ? 'warning' : item.status === 'Excluded' ? 'neutral' : 'danger';
              return <div className="flex justify-center"><Badge tone={tone}>{item.status}</Badge></div>;
            },
          },
          {
            key: 'actions',
            label: 'Actions',
            align: 'center' as const,
            sortable: false,
            render: (item: StatementLine) => (
              <div className="flex justify-center gap-1">
                {item.status !== 'Matched' && (
                  <button onClick={() => handleManualMatch(item.id)} className={button.ghost} title="Match to ledger">
                    <ArrowRight size={14} />
                  </button>
                )}
              </div>
            ),
          },
        ] as Column<StatementLine>[]}
        data={filteredStatementLines}
        rowKey={(item) => item.id}
        sortable
        filterable
        filterPlaceholder="Search transactions..."
        filterKeys={['transaction_date', 'description', 'reference', 'status', 'bank_account_name', 'property_name']}
        emptyMessage="No statement lines found."
        containerClassName="rounded-lg border-0"
      />
    </SectionCard>
  );

  const renderCashOps = () => (
    <div className={layout.sectionStack}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionCard
          title="Petty Cash Floats"
          subtitle="Departmental petty cash balances"
          icon={Wallet}
          pad="none"
          bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
          actions={
            <button onClick={openPettyCreate} className={button.primary + ' text-xs'}>
              <Plus size={12} /> New Float
            </button>
          }
        >
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {pettyCashFloats.map((pc) => (
              <div key={pc.id} className="px-4 py-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-600">
                    <Wallet size={14} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-900 dark:text-white">{pc.department}</p>
                    <p className="text-[10px] text-slate-400 font-mono">{pc.float_code || '—'} • {pc.custodian || '—'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-xs font-bold text-slate-900 dark:text-white">{fmt(pc.current_balance)}</p>
                    <p className="text-[9px] text-slate-400 uppercase font-medium">Float: {fmt(pc.float_amount)}</p>
                  </div>
                  <Badge tone={pc.status === 'Active' ? 'success' : pc.status === 'Replenished' ? 'info' : 'neutral'}>{pc.status}</Badge>
                  <div className="flex gap-1">
                    <button onClick={() => openPettyEdit(pc)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit">
                      <Pencil size={12} />
                    </button>
                    <button onClick={() => setPettyDelete({ id: pc.id, department: pc.department })} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {pettyCashFloats.length === 0 && (
              <div className="p-8 text-center text-slate-500 text-xs font-medium">No petty cash floats configured. Click "New Float" to create one.</div>
            )}
          </div>
        </SectionCard>

        <SectionCard
          title="Recent Cash Transactions"
          subtitle="Receipts, payments, and transfers"
          icon={HandCoins}
          pad="none"
          bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
        >
          <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center gap-2 overflow-x-auto">
            {['All', 'Receipt', 'Payment', 'Transfer', 'Electronic Payment', 'Bank Transfer', 'Bank Charges', 'Interest Income'].map(t => (
              <button key={t} onClick={() => setCashTxTypeFilter(t)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition whitespace-nowrap ${
                  cashTxTypeFilter === t
                    ? 'bg-[var(--color-accent-operations)] text-white'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                }`}>
                {t}
              </button>
            ))}
          </div>
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {filteredCashTransactions.slice(0, 10).map((tx) => {
              const TxIcon =
                tx.type === 'Receipt' ? HandCoins :
                tx.type === 'Payment' ? ArrowRightLeft :
                tx.type === 'Electronic Payment' ? Send :
                tx.type === 'Bank Transfer' ? Building2 :
                tx.type === 'Bank Charges' ? Receipt :
                tx.type === 'Interest Income' ? Percent :
                ArrowRight;
              const iconTone =
                tx.type === 'Receipt' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600' :
                tx.type === 'Interest Income' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600' :
                tx.type === 'Payment' ? 'bg-rose-50 dark:bg-rose-500/10 text-rose-600' :
                tx.type === 'Electronic Payment' ? 'bg-rose-50 dark:bg-rose-500/10 text-rose-600' :
                tx.type === 'Bank Charges' ? 'bg-rose-50 dark:bg-rose-500/10 text-rose-600' :
                'bg-blue-50 dark:bg-blue-500/10 text-blue-600';
              return (
                <div key={tx.id} className="px-4 py-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${iconTone}`}>
                      <TxIcon size={14} />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-900 dark:text-white">{tx.description || '—'}</p>
                      <p className="text-[10px] text-slate-400 font-mono">{tx.type} • {tx.transaction_date} • {tx.property_name || propertyName(tx.property_id)}</p>
                    </div>
                  </div>
                  <span className={`text-xs font-bold ${tx.amount > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {tx.amount > 0 ? '+' : ''}{fmt(Math.abs(tx.amount))}
                  </span>
                </div>
              );
            })}
            {filteredCashTransactions.length === 0 && (
              <div className="p-8 text-center text-slate-500 text-xs font-medium">No cash transactions found.</div>
            )}
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Cash Management Actions"
        subtitle="Record cash movements, bank operations, and replenish floats"
        icon={Coins}
      >
        <div className="flex flex-wrap gap-2">
          <button onClick={() => openCashModal('receipt')} className={button.secondary + ' text-xs'}>
            <HandCoins size={12} /> Record Cash Receipt
          </button>
          <button onClick={() => openCashModal('payment')} className={button.secondary + ' text-xs'}>
            <ArrowRightLeft size={12} /> Record Cash Payment
          </button>
          <button onClick={() => openCashModal('transfer')} className={button.secondary + ' text-xs'}>
            <ArrowRight size={12} /> Cash Transfer
          </button>
          <button onClick={() => openCashModal('replenish')} className={button.secondary + ' text-xs'}>
            <Coins size={12} /> Replenish Petty Cash
          </button>
          <button onClick={() => openCashModal('electronic_payment')} className={button.secondary + ' text-xs'}>
            <Send size={12} /> Electronic Payment
          </button>
          <button onClick={() => openCashModal('bank_transfer')} className={button.secondary + ' text-xs'}>
            <Building2 size={12} /> Bank Transfer
          </button>
          <button onClick={() => openCashModal('bank_charges')} className={button.secondary + ' text-xs'}>
            <Receipt size={12} /> Bank Charges
          </button>
          <button onClick={() => openCashModal('interest_income')} className={button.secondary + ' text-xs'}>
            <Percent size={12} /> Interest Income
          </button>
        </div>
      </SectionCard>

      {/* Cash action modal */}
      <ModalSystem
        isOpen={cashModal.open}
        onClose={closeCashModal}
        onConfirm={handleCashAction}
        title={
          cashModal.type === 'receipt' ? 'Record Cash Receipt' :
          cashModal.type === 'payment' ? 'Record Cash Payment' :
          cashModal.type === 'transfer' ? 'Cash Transfer' :
          cashModal.type === 'replenish' ? 'Replenish Petty Cash' :
          cashModal.type === 'electronic_payment' ? 'Electronic Payment' :
          cashModal.type === 'bank_transfer' ? 'Bank Transfer' :
          cashModal.type === 'bank_charges' ? 'Bank Charges' :
          'Interest Income'
        }
        subtitle="Record a cash or bank movement"
        variant="form"
        size="md"
        loading={cashModal.saving}
        confirmLabel="Record"
        confirmColor="indigo"
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Amount</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={cashForm.amount}
              onChange={e => setCashForm({ ...cashForm, amount: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
              placeholder="0.00"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Date</label>
            <input
              type="date"
              value={cashForm.transactionDate}
              onChange={e => setCashForm({ ...cashForm, transactionDate: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Description</label>
            <input
              type="text"
              value={cashForm.description}
              onChange={e => setCashForm({ ...cashForm, description: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
              placeholder="Optional description"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Reference</label>
            <input
              type="text"
              value={cashForm.reference}
              onChange={e => setCashForm({ ...cashForm, reference: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
              placeholder="Optional reference #"
            />
          </div>
          {cashModal.type === 'replenish' ? (
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Petty Cash Float</label>
              <select
                value={cashForm.pettyCashId}
                onChange={e => setCashForm({ ...cashForm, pettyCashId: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
              >
                <option value="">Select a float…</option>
                {pettyCashFloats.map(f => (
                  <option key={f.id} value={f.id}>
                    {f.department} — Balance: {fmt(f.current_balance)}
                  </option>
                ))}
              </select>
              {pettyCashFloats.length === 0 && (
                <p className="text-xs text-amber-500 mt-1">No petty cash floats available. Create one first.</p>
              )}
            </div>
          ) : cashModal.type === 'electronic_payment' ? (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Bank Account *</label>
                <select
                  value={cashForm.bankAccountId}
                  onChange={e => setCashForm({ ...cashForm, bankAccountId: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                >
                  <option value="">Select a bank account…</option>
                  {bankAccounts.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.account_name} ({b.account_number})
                    </option>
                  ))}
                </select>
                {bankAccounts.length === 0 && (
                  <p className="text-xs text-amber-500 mt-1">No bank accounts available. Create one in the Overview tab.</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Recipient</label>
                <input
                  type="text"
                  value={cashForm.recipient}
                  onChange={e => setCashForm({ ...cashForm, recipient: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                  placeholder="Payee / beneficiary name"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Payment Method</label>
                <select
                  value={cashForm.paymentMethod}
                  onChange={e => setCashForm({ ...cashForm, paymentMethod: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                >
                  <option value="Wire">Wire</option>
                  <option value="ACH">ACH</option>
                  <option value="RTGS">RTGS</option>
                  <option value="SWIFT">SWIFT</option>
                </select>
              </div>
            </>
          ) : cashModal.type === 'bank_transfer' ? (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">From Account *</label>
                <select
                  value={cashForm.fromBankAccount}
                  onChange={e => setCashForm({ ...cashForm, fromBankAccount: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                >
                  <option value="">Select source account…</option>
                  {bankAccounts.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.account_name} ({b.account_number}) — {fmt(b.balance)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">To Account *</label>
                <select
                  value={cashForm.toBankAccount}
                  onChange={e => setCashForm({ ...cashForm, toBankAccount: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                >
                  <option value="">Select destination account…</option>
                  {bankAccounts.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.account_name} ({b.account_number}) — {fmt(b.balance)}
                    </option>
                  ))}
                </select>
                {bankAccounts.length < 2 && (
                  <p className="text-xs text-amber-500 mt-1">At least two bank accounts are required for a transfer.</p>
                )}
              </div>
            </>
          ) : cashModal.type === 'bank_charges' ? (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Bank Account *</label>
                <select
                  value={cashForm.bankAccountId}
                  onChange={e => setCashForm({ ...cashForm, bankAccountId: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                >
                  <option value="">Select a bank account…</option>
                  {bankAccounts.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.account_name} ({b.account_number})
                    </option>
                  ))}
                </select>
                {bankAccounts.length === 0 && (
                  <p className="text-xs text-amber-500 mt-1">No bank accounts available. Create one in the Overview tab.</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Charge Type</label>
                <select
                  value={cashForm.chargeType}
                  onChange={e => setCashForm({ ...cashForm, chargeType: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                >
                  <option value="Monthly Fee">Monthly Fee</option>
                  <option value="Transaction Fee">Transaction Fee</option>
                  <option value="Wire Fee">Wire Fee</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </>
          ) : cashModal.type === 'interest_income' ? (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Bank Account *</label>
                <select
                  value={cashForm.bankAccountId}
                  onChange={e => setCashForm({ ...cashForm, bankAccountId: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                >
                  <option value="">Select a bank account…</option>
                  {bankAccounts.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.account_name} ({b.account_number})
                    </option>
                  ))}
                </select>
                {bankAccounts.length === 0 && (
                  <p className="text-xs text-amber-500 mt-1">No bank accounts available. Create one in the Overview tab.</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Period</label>
                <input
                  type="text"
                  value={cashForm.interestPeriod}
                  onChange={e => setCashForm({ ...cashForm, interestPeriod: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                  placeholder="e.g. June 2024"
                />
              </div>
            </>
          ) : (
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Department</label>
              <input
                type="text"
                value={cashForm.department}
                onChange={e => setCashForm({ ...cashForm, department: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                placeholder="Optional department"
              />
            </div>
          )}
        </div>
      </ModalSystem>

      {/* Petty cash create/edit modal */}
      <ModalSystem
        isOpen={pettyModal.open}
        onClose={closePettyModal}
        onConfirm={handlePettySave}
        title={pettyModal.mode === 'create' ? 'New Petty Cash Float' : 'Edit Petty Cash Float'}
        subtitle="Configure a departmental petty cash float"
        variant="form"
        size="md"
        loading={pettyModal.saving}
        confirmLabel={pettyModal.mode === 'create' ? 'Create' : 'Save'}
        confirmColor="indigo"
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Department *</label>
            <input
              type="text"
              value={pettyForm.department}
              onChange={e => setPettyForm({ ...pettyForm, department: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
              placeholder="e.g. Front Office"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Float Code</label>
            <input
              type="text"
              value={pettyForm.floatCode}
              onChange={e => setPettyForm({ ...pettyForm, floatCode: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
              placeholder="e.g. PC-FO-001"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Float Amount</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={pettyForm.floatAmount}
                onChange={e => setPettyForm({ ...pettyForm, floatAmount: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Current Balance</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={pettyForm.currentBalance}
                onChange={e => setPettyForm({ ...pettyForm, currentBalance: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                placeholder="0.00"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Custodian</label>
            <input
              type="text"
              value={pettyForm.custodian}
              onChange={e => setPettyForm({ ...pettyForm, custodian: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
              placeholder="Person responsible"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Status</label>
            <select
              value={pettyForm.status}
              onChange={e => setPettyForm({ ...pettyForm, status: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
            >
              <option value="Active">Active</option>
              <option value="Replenished">Replenished</option>
              <option value="Closed">Closed</option>
            </select>
          </div>
        </div>
      </ModalSystem>

      {/* Petty cash delete confirmation */}
      <ModalSystem
        isOpen={!!pettyDelete}
        onClose={() => setPettyDelete(null)}
        onConfirm={handlePettyDelete}
        title="Delete Petty Cash Float"
        subtitle={`Delete "${pettyDelete?.department}"? This cannot be undone.`}
        variant="confirm"
        size="sm"
        loading={pettyDeleting}
        confirmLabel="Delete"
        confirmColor="rose"
      />
    </div>
  );

  const renderFinalize = () => (
    <div className={layout.sectionStack}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SectionCard
          title="Reconciliation Checklist"
          subtitle="Pre-finalization verification"
          icon={ShieldCheck}
          className="md:col-span-2"
        >
          <div className="space-y-3">
            {[
              { label: 'All transactions matched', checked: matchedCount === statementLines.length && statementLines.length > 0 },
              { label: 'Variances reviewed and approved', checked: varianceCount === 0 },
              { label: 'Unmatched items investigated', checked: unmatchedCount === 0 },
              { label: 'Bank fees accounted for', checked: true },
              { label: 'Opening balance verified', checked: true },
              { label: 'Closing balance verified', checked: reconciliationBatches.some(b => b.status === 'Completed') },
            ].map((item, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/40 rounded-lg">
                <span className="text-xs font-medium text-slate-900 dark:text-white">{item.label}</span>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center ${item.checked ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`}>
                  {item.checked && <CheckCircle2 size={12} className="text-white" />}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <div className={layout.sectionStack}>
          <SectionCard
            title="Finalize"
            subtitle="Complete the reconciliation period"
            icon={CheckCircle2}
          >
            <div className="space-y-3">
              <div className="px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs font-medium flex items-center gap-2">
                <ShieldCheck size={14} />
                <span>Ready to finalize when all checklist items pass.</span>
              </div>
              <button onClick={handleFinalizeReconciliation} className={button.primary + ' w-full justify-center'}>
                <CheckCircle2 size={14} /> Finalize Reconciliation
              </button>
              <button onClick={handleExport} className={button.secondary + ' w-full justify-center'}>
                <Download size={14} /> Export Report
              </button>
            </div>
          </SectionCard>
        </div>
      </div>

      <SectionCard
        title="Reconciliation Batches"
        subtitle="Historical and in-progress reconciliation periods"
        icon={Calendar}
        pad="none"
        bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
      >
        <DataTable
          columns={[
            {
              key: 'period_start',
              label: 'Period',
              render: (b: ReconciliationBatch) => (
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 rounded-lg"><Calendar size={12} /></div>
                  <span className="text-xs font-bold text-slate-900 dark:text-white">{b.period_start} → {b.period_end}</span>
                </div>
              ),
            },
            {
              key: 'bank_accounts',
              label: 'Bank Account',
              render: (b: ReconciliationBatch) => (
                <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                  {b.bank_accounts?.account_name || '—'} <span className="text-slate-400">({b.bank_accounts?.account_number || '—'})</span>
                </span>
              ),
            },
            {
              key: 'opening_balance',
              label: 'Opening',
              align: 'right' as const,
              render: (b: ReconciliationBatch) => <span className="text-xs font-mono text-slate-600 dark:text-slate-300">{fmt(b.opening_balance)}</span>,
            },
            {
              key: 'closing_balance',
              label: 'Closing',
              align: 'right' as const,
              render: (b: ReconciliationBatch) => <span className="text-xs font-mono font-bold text-slate-900 dark:text-white">{fmt(b.closing_balance)}</span>,
            },
            {
              key: 'total_debits',
              label: 'Debits',
              align: 'right' as const,
              render: (b: ReconciliationBatch) => <span className="text-xs font-mono text-rose-600">{fmt(b.total_debits)}</span>,
            },
            {
              key: 'total_credits',
              label: 'Credits',
              align: 'right' as const,
              render: (b: ReconciliationBatch) => <span className="text-xs font-mono text-emerald-600">{fmt(b.total_credits)}</span>,
            },
            {
              key: 'reconciled_by',
              label: 'Reconciled By',
              render: (b: ReconciliationBatch) => <span className="text-xs font-medium text-slate-500">{b.reconciled_by || '—'}</span>,
            },
            {
              key: 'status',
              label: 'Status',
              align: 'center' as const,
              render: (b: ReconciliationBatch) => {
                const tone: StatusTone = b.status === 'Completed' ? 'success' : b.status === 'Cancelled' ? 'neutral' : 'warning';
                return <div className="flex justify-center"><Badge tone={tone}>{b.status}</Badge></div>;
              },
            },
          ] as Column<ReconciliationBatch>[]}
          data={reconciliationBatches}
          rowKey={(b) => b.id}
          sortable
          filterable
          filterPlaceholder="Search batches..."
          filterKeys={['status', 'reconciled_by', 'period_start', 'period_end']}
          emptyMessage="No reconciliation batches found."
          containerClassName="rounded-lg border-0"
        />
      </SectionCard>
    </div>
  );

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Cash & Bank"
        subtitle="Bank accounts, statement reconciliation, petty cash, and cash transactions."
        icon={Landmark}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={loadData} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={handleExport} className={button.primary}>
              <Download className="w-4 h-4" /> Export
            </button>
            {activeTab === 'overview' && (
              <button onClick={() => setShowNewAccount(true)} className={button.primary}>
                <Plus className="w-4 h-4" /> New Account
              </button>
            )}
          </div>
        }
      />

      {/* Error banner */}
      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={loadData} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {loading ? (
        <div className="p-12 text-center text-slate-500 text-sm">
          <div className="flex items-center justify-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Loading cash & bank data...</span>
          </div>
        </div>
      ) : (
        <>
          {/* KPIs — per active tab, above the sub-tab nav */}
          {activeTab === 'overview' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Bank Accounts" value={bankAccounts.length} icon={Landmark} tone="accent" />
              <StatCard title="Total Balance" value={fmt(bankAccounts.reduce((s, b) => s + Number(b.balance || 0), 0))} icon={Banknote} tone="info" />
              <StatCard title="Unmatched" value={unmatchedCount} icon={XCircle} tone="danger" />
              <StatCard title="Matched" value={matchedCount} icon={CheckCircle2} tone="success" />
            </div>
          )}
          {activeTab === 'cash_ops' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Cash Receipts" value={fmt(cashTransactions.filter(t => t.type === 'Receipt').reduce((s, t) => s + Math.abs(t.amount), 0))} icon={HandCoins} tone="success" />
              <StatCard title="Cash Payments" value={fmt(cashTransactions.filter(t => t.type === 'Payment').reduce((s, t) => s + Math.abs(t.amount), 0))} icon={ArrowRightLeft} tone="danger" />
              <StatCard title="Petty Cash" value={fmt(pettyCashFloats.reduce((s, p) => s + p.current_balance, 0))} icon={Wallet} tone="warning" />
              <StatCard title="Transfers" value={cashTransactions.filter(t => t.type === 'Transfer').length} icon={ArrowRight} tone="info" />
            </div>
          )}
          {activeTab === 'import' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Statement Lines" value={statementLines.length} icon={FileText} tone="accent" />
              <StatCard title="Matched" value={matchedCount} icon={CheckCircle2} tone="success" />
              <StatCard title="Unmatched" value={unmatchedCount} icon={XCircle} tone="danger" />
              <StatCard title="Variance" value={varianceCount} icon={AlertCircle} tone="warning" />
            </div>
          )}
          {activeTab === 'match' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Total Lines" value={statementLines.length} icon={FileText} tone="accent" />
              <StatCard title="Matched" value={matchedCount} icon={CheckCircle2} tone="success" />
              <StatCard title="Unmatched" value={unmatchedCount} icon={XCircle} tone="danger" />
              <StatCard title="Variance" value={varianceCount} icon={AlertCircle} tone="warning" />
            </div>
          )}
          {activeTab === 'finalize' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Reconciliation Batches" value={reconciliationBatches.length} icon={ShieldCheck} tone="accent" />
              <StatCard title="Completed" value={reconciliationBatches.filter(b => b.status === 'Completed').length} icon={CheckCircle2} tone="success" />
              <StatCard title="Draft" value={reconciliationBatches.filter(b => b.status === 'Draft').length} icon={Calendar} tone="warning" />
              <StatCard title="Cancelled" value={reconciliationBatches.filter(b => b.status === 'Cancelled').length} icon={XCircle} tone="neutral" />
            </div>
          )}

          {/* Sub-tab nav — below stat cards (COA pattern) */}
          <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap">
            {([
              ['overview', 'Overview'],
              ['cash_ops', 'Cash Ops'],
              ['import', 'Import'],
              ['match', 'Match'],
              ['finalize', 'Finalize'],
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

          {activeTab === 'overview' && renderOverview()}
          {activeTab === 'cash_ops' && renderCashOps()}
          {activeTab === 'import' && renderImport()}
          {activeTab === 'match' && renderMatch()}
          {activeTab === 'finalize' && renderFinalize()}
        </>
      )}

      <ModalSystem
        isOpen={showNewAccount}
        onClose={() => setShowNewAccount(false)}
        title="New Bank Account"
        subtitle="Add a bank account for reconciliation"
        variant="form"
        size="md"
        showFooter={false}
      >
            <div className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Account Number *</label>
                <input
                  type="text"
                  value={newAccountForm.accountNumber}
                  onChange={(e) => setNewAccountForm({ ...newAccountForm, accountNumber: e.target.value })}
                  className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Account number"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Account Name *</label>
                <input
                  type="text"
                  value={newAccountForm.accountName}
                  onChange={(e) => setNewAccountForm({ ...newAccountForm, accountName: e.target.value })}
                  className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Operating Account"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Bank Name *</label>
                <input
                  type="text"
                  value={newAccountForm.bankName}
                  onChange={(e) => setNewAccountForm({ ...newAccountForm, bankName: e.target.value })}
                  className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Commercial Bank of Ethiopia"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Currency</label>
                <select
                  value={newAccountForm.currency}
                  onChange={(e) => setNewAccountForm({ ...newAccountForm, currency: e.target.value })}
                  className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="ETB">ETB - Ethiopian Birr</option>
                  <option value="USD">USD - US Dollar</option>
                  <option value="EUR">EUR - Euro</option>
                </select>
              </div>
            </div>

            <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3 bg-slate-50/30 dark:bg-slate-950/20">
              <button
                onClick={() => setShowNewAccount(false)}
                className={button.secondary}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateAccount}
                className={button.primary}
              >
                Create Account
              </button>
            </div>
      </ModalSystem>
    </div>
  );
};

export default BankReconciliation;
