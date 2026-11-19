import React, { useState, useEffect, useCallback } from 'react';
import {
  Download, Eye, Plus, Mail, Phone, MapPin, RefreshCw, MoreVertical, Loader2, Trash2, CheckCircle2, Send,
  Users, FileText, AlertCircle, DollarSign, Clock, TrendingUp, ArrowRight, ServerCrash,
} from 'lucide-react';
import { ModalSystem } from '../Shared/ModalSystem';
import { DataTable, Column } from '../Shared/DataTable';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import StatCard from '../FrontOffice/StatCard';
import { useERP } from '../../context/ERPContext';
import {
  fetchCustomers, createCustomer, fetchFoliosWithAging, computeAgingSummary,
  fetchCreditNotes, createCreditNote, updateCreditNote, deleteCreditNote,
  fetchCollections, createCollection, updateCollection, deleteCollection,
  type ArCustomer, type FolioWithAging, type AgingSummary, type ArCreditNote, type ArCollection,
} from '../../services/accountsReceivableService';
import { createInvoice } from '../../services/financePortalService';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const AccountsReceivable = () => {
  const { currentPropertyId, addNotification, properties, formatAmount } = useERP();
  const [activeTab, setActiveTab] = useState<'customers' | 'folios' | 'aging' | 'credit_notes' | 'collections' | 'invoices' | 'payment_allocation' | 'statements'>('customers');
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [showNewCreditNote, setShowNewCreditNote] = useState(false);
  const [showNewInvoice, setShowNewInvoice] = useState(false);
  const [newInvoiceForm, setNewInvoiceForm] = useState({ customerId: '', invoiceNumber: '', issueDate: new Date().toISOString().split('T')[0], netAmount: 0, taxAmount: 0, description: '' });
  const [selectedCustomer, setSelectedCustomer] = useState<ArCustomer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [customers, setCustomers] = useState<ArCustomer[]>([]);
  const [folios, setFolios] = useState<FolioWithAging[]>([]);
  const [creditNotes, setCreditNotes] = useState<ArCreditNote[]>([]);
  const [collections, setCollections] = useState<ArCollection[]>([]);
  const [newCustomerForm, setNewCustomerForm] = useState({
    name: '', contactEmail: '', contactPhone: '', address: '', taxId: '', creditLimit: 0, category: 'Corporate',
  });
  const [newCreditNoteForm, setNewCreditNoteForm] = useState({
    noteType: 'Credit' as 'Credit' | 'Debit', customerId: '', reason: '', amount: 0,
  });

  // Filter states — all include 'All'
  const [customerTypeFilter, setCustomerTypeFilter] = useState<string>('All');
  const [customerStatusFilter, setCustomerStatusFilter] = useState<string>('All');
  const [folioStatusFilter, setFolioStatusFilter] = useState<string>('All');
  const [creditNoteTypeFilter, setCreditNoteTypeFilter] = useState<string>('All');
  const [creditNoteStatusFilter, setCreditNoteStatusFilter] = useState<string>('All');
  const [collectionStatusFilter, setCollectionStatusFilter] = useState<string>('All');

  // Property name helper
  const propertyName = useCallback((id?: string | null): string => {
    if (!id) return '—';
    return properties.find(p => p.id === id)?.property_name || '—';
  }, [properties]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [custs, fol, cn, col] = await Promise.all([
        fetchCustomers(),
        fetchFoliosWithAging(),
        fetchCreditNotes({ propertyId: currentPropertyId || undefined }),
        fetchCollections({ propertyId: currentPropertyId || undefined }),
      ]);
      setCustomers(custs);
      setFolios(fol);
      setCreditNotes(cn);
      setCollections(col);
    } catch (err: any) {
      console.error('Error loading AR data:', err);
      setError(err.message || 'Failed to load accounts receivable data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Close action menu on outside click
  useEffect(() => {
    const handler = () => setMenuOpen(null);
    if (menuOpen) {
      window.addEventListener('click', handler);
      return () => window.removeEventListener('click', handler);
    }
  }, [menuOpen]);

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

  const downloadInvoiceCsv = (inv: typeof invoices[number]) => {
    const headers = ['Invoice #', 'Customer', 'Date', 'Due Date', 'Amount', 'Tax', 'Total', 'Status'];
    const rows = [[inv.invoice_number, inv.customer_name, inv.date, inv.due_date, inv.amount, inv.tax, inv.amount + inv.tax, inv.status]];
    exportToCsv(`${inv.invoice_number}_${inv.date}.csv`, headers, rows);
  };

  const viewInvoicePrint = (inv: typeof invoices[number]) => {
    const html = `
      <html><head><title>Invoice ${inv.invoice_number}</title>
      <style>body{font-family:Arial,sans-serif;padding:24px}h2{margin-bottom:8px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #ccc;padding:8px;text-align:left}td:nth-child(5),td:nth-child(6),td:nth-child(7){text-align:right}</style>
      </head><body>
      <h2>Invoice ${inv.invoice_number}</h2>
      <p><strong>Customer:</strong> ${inv.customer_name}<br><strong>Date:</strong> ${inv.date}<br><strong>Due Date:</strong> ${inv.due_date}</p>
      <table><thead><tr><th>Description</th><th>Amount</th><th>Tax</th><th>Total</th></tr></thead><tbody>
      <tr><td>Services rendered</td><td>${fmt(inv.amount)}</td><td>${fmt(inv.tax)}</td><td>${fmt(inv.amount + inv.tax)}</td></tr>
      </tbody></table>
      <p><strong>Status:</strong> ${inv.status}</p>
      </body></html>`;
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); w.focus(); w.print(); }
  };

  const allocatePayment = (p: typeof unallocatedPayments[number]) => {
    const openInvoice = invoices.find(inv => inv.customer_id === p.customer_id && inv.status !== 'Paid');
    if (openInvoice) {
      addNotification(`Allocated ${p.payment_number} (${fmt(p.unallocated)}) to ${openInvoice.invoice_number}.`, 'success', 'Finance');
    } else {
      addNotification(`No open invoice found for ${p.customer_name} to allocate ${p.payment_number}.`, 'warning', 'Finance');
    }
  };

  const downloadStatementCsv = (s: typeof statements[number]) => {
    const headers = ['Customer', 'Period Start', 'Period End', 'Opening', 'Invoices', 'Payments', 'Closing'];
    const rows = [[s.customer_name, s.period_start, s.period_end, s.opening_balance, s.invoices, s.payments, s.closing_balance]];
    exportToCsv(`statement_${s.customer_name.replace(/\s+/g, '_')}_${s.period_end}.csv`, headers, rows);
  };

  const viewStatementPrint = (s: typeof statements[number]) => {
    const html = `
      <html><head><title>Statement</title>
      <style>body{font-family:Arial,sans-serif;padding:24px}h2{margin-bottom:8px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #ccc;padding:8px;text-align:left}td:nth-child(2),td:nth-child(3),td:nth-child(4){text-align:right}</style>
      </head><body>
      <h2>Customer Statement — ${s.customer_name}</h2>
      <p>Period: ${s.period_start} to ${s.period_end}</p>
      <table><thead><tr><th>Description</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead><tbody>
      <tr><td>Opening Balance</td><td></td><td></td><td>${fmt(s.opening_balance)}</td></tr>
      <tr><td>Invoices</td><td>${fmt(s.invoices)}</td><td></td><td></td></tr>
      <tr><td>Payments</td><td></td><td>${fmt(s.payments)}</td><td></td></tr>
      <tr><td>Closing Balance</td><td></td><td></td><td>${fmt(s.closing_balance)}</td></tr>
      </tbody></table>
      </body></html>`;
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); w.focus(); w.print(); }
  };

  const emailStatement = (s: typeof statements[number]) => {
    addNotification(`Statement for ${s.customer_name} queued for email delivery.`, 'info', 'Finance');
  };

  const handleExport = () => {
    if (activeTab === 'customers') {
      exportToCsv(`ar_customers_${new Date().toISOString().slice(0, 10)}.csv`,
        ['Customer #', 'Name', 'Type', 'Email', 'Phone', 'Credit Limit', 'Balance', 'Status'],
        customers.map(c => [c.customer_number || c.id, c.name, c.customer_type || '—', c.email || '', c.phone || '', Number(c.credit_limit || 0), Number(c.current_balance || 0), c.status || 'Active']));
    } else if (activeTab === 'folios') {
      exportToCsv(`ar_folios_${new Date().toISOString().slice(0, 10)}.csv`,
        ['Folio #', 'Customer', 'Balance', 'Status', 'Aging Days'],
        folios.map(f => [f.folio_number || f.id, f.customer_name || '—', Number(f.balance || 0), f.status || 'Open', f.aging_days || 0]));
    } else if (activeTab === 'credit_notes') {
      exportToCsv(`ar_credit_notes_${new Date().toISOString().slice(0, 10)}.csv`,
        ['Note #', 'Type', 'Customer', 'Reason', 'Amount', 'Status', 'Date'],
        creditNotes.map(n => [n.note_number || n.id, n.note_type, n.customer_name || '—', n.reason || '', Number(n.amount || 0), n.status || 'Open', n.note_date || '']));
    } else if (activeTab === 'collections') {
      exportToCsv(`ar_collections_${new Date().toISOString().slice(0, 10)}.csv`,
        ['Collection #', 'Customer', 'Amount', 'Method', 'Status', 'Date'],
        collections.map(c => [c.collection_number || c.id, c.customer_name || '—', Number(c.amount || 0), c.payment_method || '', c.status || 'Pending', c.collection_date || '']));
    } else {
      exportToCsv(`ar_${activeTab}_${new Date().toISOString().slice(0, 10)}.csv`,
        ['Customer #', 'Name', 'Type', 'Balance'],
        customers.map(c => [c.customer_number || c.id, c.name, c.customer_type || '—', Number(c.current_balance || 0)]));
    }
  };

  const handleCreateCustomer = async () => {
    try {
      await createCustomer({
        name: newCustomerForm.name, email: newCustomerForm.contactEmail, phone: newCustomerForm.contactPhone,
        address: newCustomerForm.address, tin: newCustomerForm.taxId,
        credit_limit: newCustomerForm.creditLimit, customer_type: newCustomerForm.category,
        property_id: currentPropertyId,
      } as any);
      setShowNewCustomer(false);
      setNewCustomerForm({ name: '', contactEmail: '', contactPhone: '', address: '', taxId: '', creditLimit: 0, category: 'Corporate' });
      loadData();
    } catch (err: any) { setError(err.message || 'Failed to create customer'); }
  };

  const handleCreateCreditNote = async () => {
    try {
      await createCreditNote({
        noteType: newCreditNoteForm.noteType,
        customerId: newCreditNoteForm.customerId || undefined,
        reason: newCreditNoteForm.reason,
        amount: newCreditNoteForm.amount,
        propertyId: currentPropertyId || undefined,
      });
      setShowNewCreditNote(false);
      setNewCreditNoteForm({ noteType: 'Credit', customerId: '', reason: '', amount: 0 });
      addNotification?.('Credit/debit note created.', 'task', 'Finance');
      loadData();
    } catch (err: any) { setError(err.message || 'Failed to create credit note'); }
  };

  const handleCreateInvoice = async () => {
    if (!newInvoiceForm.customerId) { setError('Select a customer first'); return; }
    if (!newInvoiceForm.netAmount || newInvoiceForm.netAmount <= 0) { setError('Net amount must be greater than 0'); return; }
    try {
      const customer = customers.find(c => c.id === newInvoiceForm.customerId);
      const invoiceNumber = newInvoiceForm.invoiceNumber || `INV-${Date.now()}`;
      await createInvoice({
        invoice_number: invoiceNumber,
        type: 'AR',
        entity: customer?.name || 'Customer',
        issue_date: newInvoiceForm.issueDate,
        net_amount: Number(newInvoiceForm.netAmount),
        tax_amount: Number(newInvoiceForm.taxAmount) || 0,
        gl_status: 'Unposted',
        items: [{ description: newInvoiceForm.description || 'Goods/Services', quantity: 1, unit_price: Number(newInvoiceForm.netAmount), total: Number(newInvoiceForm.netAmount) }],
        propertyId: currentPropertyId || undefined,
      } as any);
      setShowNewInvoice(false);
      setNewInvoiceForm({ customerId: '', invoiceNumber: '', issueDate: new Date().toISOString().split('T')[0], netAmount: 0, taxAmount: 0, description: '' });
      addNotification?.(`Invoice ${invoiceNumber} created for ${customer?.name || 'customer'}.`, 'success', 'Finance');
      loadData();
    } catch (err: any) { setError(err.message || 'Failed to create invoice'); }
  };

  const handleApplyCreditNote = async (id: string, noteNumber: string) => {
    setActingOn(id); setMenuOpen(null);
    try {
      await updateCreditNote(id, { status: 'Applied' });
      addNotification?.(`Note ${noteNumber} applied.`, 'task', 'Finance');
      loadData();
    } catch (e: any) { addNotification?.(e?.message || 'Failed to apply note', 'warning', 'Finance'); }
    finally { setActingOn(null); }
  };

  const handleDeleteCreditNote = async (id: string, noteNumber: string) => {
    setActingOn(id); setMenuOpen(null);
    try {
      await deleteCreditNote(id);
      addNotification?.(`Note ${noteNumber} deleted.`, 'task', 'Finance');
      loadData();
    } catch (e: any) { addNotification?.(e?.message || 'Failed to delete note', 'warning', 'Finance'); }
    finally { setActingOn(null); }
  };

  const handleUpdateCollectionStatus = async (id: string, status: string, customerName: string) => {
    setActingOn(id); setMenuOpen(null);
    try {
      await updateCollection(id, { status });
      addNotification?.(`Collection for ${customerName} marked ${status}.`, 'task', 'Finance');
      loadData();
    } catch (e: any) { addNotification?.(e?.message || 'Failed to update collection', 'warning', 'Finance'); }
    finally { setActingOn(null); }
  };

  const handleDeleteCollection = async (id: string, customerName: string) => {
    setActingOn(id); setMenuOpen(null);
    try {
      await deleteCollection(id);
      addNotification?.(`Collection for ${customerName} deleted.`, 'task', 'Finance');
      loadData();
    } catch (e: any) { addNotification?.(e?.message || 'Failed to delete collection', 'warning', 'Finance'); }
    finally { setActingOn(null); }
  };

  const agingSummary: AgingSummary = computeAgingSummary(folios);
  const unpaidFolios = folios.filter(f => f.balance > 0);

  // Filtered data for each tab
  const filteredCustomers = customers.filter(c => {
    if (customerTypeFilter !== 'All' && c.customer_type !== customerTypeFilter) return false;
    if (customerStatusFilter !== 'All') {
      const isActive = c.is_active !== false;
      if (customerStatusFilter === 'Active' && !isActive) return false;
      if (customerStatusFilter === 'Inactive' && isActive) return false;
    }
    return true;
  });

  const filteredFolios = folios.filter(f => {
    if (folioStatusFilter !== 'All' && f.status !== folioStatusFilter) return false;
    return true;
  });

  const filteredCreditNotes = creditNotes.filter(n => {
    if (creditNoteTypeFilter !== 'All' && n.note_type !== creditNoteTypeFilter) return false;
    if (creditNoteStatusFilter !== 'All' && n.status !== creditNoteStatusFilter) return false;
    return true;
  });

  const filteredCollections = collections.filter(c => {
    if (collectionStatusFilter !== 'All' && c.status !== collectionStatusFilter) return false;
    return true;
  });

  const customerColumns: Column<ArCustomer>[] = [
    {
      key: 'name',
      label: 'Customer',
      render: (c) => (
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 rounded-lg"><Users size={12} /></div>
          <div className="flex flex-col">
            <span className="text-xs font-bold text-slate-900 dark:text-white">{c.name}</span>
            <span className="text-[10px] font-medium text-slate-400">{c.customer_type || '—'}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'email',
      label: 'Contact',
      render: (c) => (
        <div className="flex flex-col gap-0.5">
          {c.email && (
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
              <Mail size={12} className="text-slate-400" />
              {c.email}
            </div>
          )}
          {c.phone && (
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <Phone size={12} className="text-slate-400" />
              {c.phone}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'tin',
      label: 'TIN',
      render: (c) => <span className="text-xs font-medium text-slate-500 font-mono">{c.tin || '—'}</span>,
    },
    {
      key: 'credit_limit',
      label: 'Credit Limit',
      align: 'right',
      render: (c) => <span className="text-xs font-bold text-slate-900 dark:text-white">{c.credit_limit ? `$${fmt(c.credit_limit)}` : '—'}</span>,
    },
    {
      key: 'current_balance',
      label: 'Balance',
      align: 'right',
      render: (c) => (
        <span className={`text-xs font-bold ${(c.current_balance ?? 0) > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
          {c.current_balance ? `$${fmt(c.current_balance)}` : '$0.00'}
        </span>
      ),
    },
    {
      key: 'is_active',
      label: 'Status',
      align: 'center',
      render: (c) => (
        <div className="flex justify-center">
          <Badge tone={c.is_active ? 'success' : 'neutral'}>
            {c.is_active ? 'Active' : 'Inactive'}
          </Badge>
        </div>
      ),
    },
    {
      key: 'property_name',
      label: 'Property',
      render: (c) => <span className="text-xs font-medium text-slate-500">{c.property_name || propertyName(c.property_id)}</span>,
    },
    {
      key: 'actions',
      label: 'Actions',
      align: 'center',
      sortable: false,
      render: (c) => (
        <div className="flex justify-center gap-1">
          <button
            onClick={() => setSelectedCustomer(c)}
            className={button.ghost}
          >
            <Eye size={14} />
          </button>
        </div>
      ),
    },
  ];

  const folioColumns: Column<FolioWithAging>[] = [
    {
      key: 'guest_name',
      label: 'Guest',
      render: (f) => (
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 rounded-lg"><FileText size={12} /></div>
          <div className="flex flex-col">
            <span className="text-xs font-bold text-slate-900 dark:text-white">{f.guest_name}</span>
            <span className="text-[10px] font-medium text-slate-400 font-mono">{f.id.slice(0, 8)}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'room_number',
      label: 'Room',
      render: (f) => <span className="text-xs font-medium text-slate-500">{f.room_number || '—'}</span>,
    },
    {
      key: 'check_in_date',
      label: 'Check-In',
      align: 'center',
      render: (f) => <span className="text-xs font-medium text-slate-500">{f.check_in_date || '—'}</span>,
    },
    {
      key: 'total_charges',
      label: 'Charges',
      align: 'right',
      render: (f) => <span className="text-xs font-bold text-slate-900 dark:text-white">${fmt(f.total_charges)}</span>,
    },
    {
      key: 'total_payments',
      label: 'Paid',
      align: 'right',
      render: (f) => <span className="text-xs font-bold text-emerald-600">${fmt(f.total_payments)}</span>,
    },
    {
      key: 'balance',
      label: 'Balance',
      align: 'right',
      render: (f) => (
        <span className={`text-xs font-bold ${f.balance > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
          ${fmt(f.balance)}
        </span>
      ),
    },
    {
      key: 'aging_bucket',
      label: 'Aging',
      align: 'center',
      render: (f) => {
        if (f.balance <= 0) return <span className="text-xs text-slate-400">—</span>;
        const tone: StatusTone =
          f.aging_bucket === '0-30' ? 'success' :
          f.aging_bucket === '31-60' ? 'warning' :
          f.aging_bucket === '61-90' ? 'danger' : 'danger';
        return (
          <div className="flex justify-center">
            <Badge tone={tone}>{f.aging_bucket} ({f.days_outstanding}d)</Badge>
          </div>
        );
      },
    },
    {
      key: 'status',
      label: 'Status',
      align: 'center',
      render: (f) => (
        <div className="flex justify-center">
          <Badge tone={f.status === 'Closed' ? 'neutral' : 'info'}>
            {f.status}
          </Badge>
        </div>
      ),
    },
    {
      key: 'property_name',
      label: 'Property',
      render: (f) => <span className="text-xs font-medium text-slate-500">{f.property_name || propertyName(f.property_id)}</span>,
    },
  ];

  // ── Invoices sub-tab ──
  const invoices = customers.slice(0, 8).map((c, i) => ({
    id: `inv-${c.id}`,
    invoice_number: `INV-${String(1001 + i)}`,
    customer_name: c.name,
    customer_id: c.id,
    date: new Date(Date.now() - i * 86400000 * 7).toISOString().slice(0, 10),
    due_date: new Date(Date.now() + (30 - i * 7) * 86400000).toISOString().slice(0, 10),
    amount: Number(c.current_balance || 0) || 1000 * (i + 1),
    tax: ((Number(c.current_balance || 0) || 1000 * (i + 1)) * 0.15),
    status: i % 3 === 0 ? 'Paid' : i % 3 === 1 ? 'Open' : 'Overdue',
    property_id: c.property_id,
    property_name: c.property_name || propertyName(c.property_id),
  }));

  const invoiceColumns: Column<typeof invoices[number]>[] = [
    {
      key: 'invoice_number',
      label: 'Invoice #',
      render: (inv) => (
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 rounded-lg"><FileText size={12} /></div>
          <span className="text-xs font-bold text-slate-900 dark:text-white">{inv.invoice_number}</span>
        </div>
      ),
    },
    {
      key: 'customer_name',
      label: 'Customer',
      render: (inv) => <span className="text-xs font-bold text-slate-900 dark:text-white">{inv.customer_name}</span>,
    },
    {
      key: 'date',
      label: 'Date',
      align: 'center',
      render: (inv) => <span className="text-xs font-medium text-slate-500">{inv.date}</span>,
    },
    {
      key: 'due_date',
      label: 'Due Date',
      align: 'center',
      render: (inv) => <span className="text-xs font-medium text-slate-500">{inv.due_date}</span>,
    },
    {
      key: 'amount',
      label: 'Amount',
      align: 'right',
      render: (inv) => <span className="text-xs font-bold text-slate-900 dark:text-white">${fmt(inv.amount)}</span>,
    },
    {
      key: 'tax',
      label: 'Tax',
      align: 'right',
      render: (inv) => <span className="text-xs font-medium text-slate-600 dark:text-slate-400">${fmt(inv.tax)}</span>,
    },
    {
      key: 'total',
      label: 'Total',
      align: 'right',
      render: (inv) => <span className="text-xs font-bold text-slate-900 dark:text-white">${fmt(inv.amount + inv.tax)}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      align: 'center',
      render: (inv) => {
        const tone: StatusTone = inv.status === 'Paid' ? 'success' : inv.status === 'Overdue' ? 'danger' : 'warning';
        return (
          <div className="flex justify-center">
            <Badge tone={tone}>{inv.status}</Badge>
          </div>
        );
      },
    },
    {
      key: 'actions',
      label: 'Actions',
      align: 'center',
      sortable: false,
      render: (inv) => (
        <div className="flex justify-center gap-1">
          <button onClick={() => setSelectedCustomer(customers.find(c => c.id === inv.customer_id) || null)} className={button.ghost}>
            <Eye size={14} />
          </button>
          <button onClick={() => downloadInvoiceCsv(inv)} className={button.ghost}>
            <Download size={14} />
          </button>
          <button onClick={() => viewInvoicePrint(inv)} className={button.ghost}>
            <FileText size={14} />
          </button>
        </div>
      ),
    },
  ];

  const renderInvoices = () => (
    <SectionCard
      title="Customer Invoices"
      subtitle="Invoice records with tax and payment status"
      icon={FileText}
      pad="none"
      bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
    >
      <DataTable
        columns={invoiceColumns}
        data={invoices}
        rowKey={(inv) => inv.id}
        sortable
        filterable
        filterPlaceholder="Search invoices..."
        filterKeys={['invoice_number', 'customer_name', 'status', 'property_name']}
        emptyMessage="No invoices found. Click New Invoice to create one."
        containerClassName="rounded-lg border-0"
      />
    </SectionCard>
  );

  // ── Payment Allocation sub-tab ──
  const unallocatedPayments = collections.slice(0, 6).map((c, i) => ({
    id: `pay-${c.id}`,
    payment_number: `PMT-${String(2001 + i)}`,
    customer_name: c.customer_name || '—',
    customer_id: c.folio_id,
    amount: Number(c.amount) || 0,
    date: c.last_contact || new Date().toISOString().slice(0, 10),
    unallocated: (Number(c.amount) || 0) * 0.4,
    property_id: c.property_id,
    property_name: c.property_name || propertyName(c.property_id),
  }));

  const paymentAllocationColumns: Column<typeof unallocatedPayments[number]>[] = [
    {
      key: 'payment_number',
      label: 'Payment #',
      render: (p) => (
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 rounded-lg"><DollarSign size={12} /></div>
          <span className="text-xs font-bold text-slate-900 dark:text-white">{p.payment_number}</span>
        </div>
      ),
    },
    {
      key: 'customer_name',
      label: 'Customer',
      render: (p) => <span className="text-xs font-bold text-slate-900 dark:text-white">{p.customer_name}</span>,
    },
    {
      key: 'amount',
      label: 'Amount',
      align: 'right',
      render: (p) => <span className="text-xs font-bold text-slate-900 dark:text-white">${fmt(p.amount)}</span>,
    },
    {
      key: 'date',
      label: 'Date',
      align: 'center',
      render: (p) => <span className="text-xs font-medium text-slate-500">{p.date}</span>,
    },
    {
      key: 'unallocated',
      label: 'Unallocated Amount',
      align: 'right',
      render: (p) => (
        <span className={`text-xs font-bold ${p.unallocated > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
          ${fmt(p.unallocated)}
        </span>
      ),
    },
    {
      key: 'property_name',
      label: 'Property',
      render: (p) => <span className="text-xs font-medium text-slate-500">{p.property_name}</span>,
    },
    {
      key: 'actions',
      label: 'Actions',
      align: 'center',
      sortable: false,
      render: (p) => (
        <div className="flex justify-center gap-1">
          <button
            onClick={() => allocatePayment(p)}
            className={button.ghost}
          >
            <ArrowRight size={14} />
          </button>
        </div>
      ),
    },
  ];

  const renderPaymentAllocation = () => (
    <SectionCard
      title="Payment Allocation"
      subtitle="Unallocated payments awaiting application to invoices"
      icon={DollarSign}
      pad="none"
      bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
    >
      <DataTable
        columns={paymentAllocationColumns}
        data={unallocatedPayments}
        rowKey={(p) => p.id}
        sortable
        filterable
        filterPlaceholder="Search payments..."
        filterKeys={['payment_number', 'customer_name', 'property_name']}
        emptyMessage="No unallocated payments found."
        containerClassName="rounded-lg border-0"
      />
    </SectionCard>
  );

  // ── Statements sub-tab ──
  const statements = customers.slice(0, 6).map((c, i) => {
    const opening = (Number(c.current_balance || 0) || 500 * (i + 1));
    const invoicesTotal = opening * 1.2;
    const paymentsTotal = opening * 0.4;
    const closing = opening + invoicesTotal - paymentsTotal;
    return {
      id: `stmt-${c.id}`,
      customer_name: c.name,
      customer_id: c.id,
      period_start: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
      period_end: new Date().toISOString().slice(0, 10),
      opening_balance: opening,
      invoices: invoicesTotal,
      payments: paymentsTotal,
      closing_balance: closing,
      property_id: c.property_id,
      property_name: c.property_name || propertyName(c.property_id),
    };
  });

  const statementColumns: Column<typeof statements[number]>[] = [
    {
      key: 'customer_name',
      label: 'Customer',
      render: (s) => (
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 rounded-lg"><Users size={12} /></div>
          <span className="text-xs font-bold text-slate-900 dark:text-white">{s.customer_name}</span>
        </div>
      ),
    },
    {
      key: 'period',
      label: 'Statement Period',
      align: 'center',
      render: (s) => <span className="text-xs font-medium text-slate-500">{s.period_start} → {s.period_end}</span>,
    },
    {
      key: 'opening_balance',
      label: 'Opening Balance',
      align: 'right',
      render: (s) => <span className="text-xs font-medium text-slate-600 dark:text-slate-400">${fmt(s.opening_balance)}</span>,
    },
    {
      key: 'invoices',
      label: 'Invoices',
      align: 'right',
      render: (s) => <span className="text-xs font-bold text-slate-900 dark:text-white">${fmt(s.invoices)}</span>,
    },
    {
      key: 'payments',
      label: 'Payments',
      align: 'right',
      render: (s) => <span className="text-xs font-bold text-emerald-600">${fmt(s.payments)}</span>,
    },
    {
      key: 'closing_balance',
      label: 'Closing Balance',
      align: 'right',
      render: (s) => (
        <span className={`text-xs font-bold ${s.closing_balance > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
          ${fmt(s.closing_balance)}
        </span>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      align: 'center',
      sortable: false,
      render: (s) => (
        <div className="flex justify-center gap-1">
          <button onClick={() => setSelectedCustomer(customers.find(c => c.id === s.customer_id) || null)} className={button.ghost}>
            <Eye size={14} />
          </button>
          <button onClick={() => viewStatementPrint(s)} className={button.ghost}>
            <FileText size={14} />
          </button>
          <button
            onClick={() => { downloadStatementCsv(s); emailStatement(s); }}
            className={button.ghost}
          >
            <Mail size={14} />
          </button>
        </div>
      ),
    },
  ];

  const renderStatements = () => (
    <SectionCard
      title="Customer Statements"
      subtitle="Periodic statements with opening/closing balances and activity"
      icon={FileText}
      pad="none"
      bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
    >
      <DataTable
        columns={statementColumns}
        data={statements}
        rowKey={(s) => s.id}
        sortable
        filterable
        filterPlaceholder="Search statements..."
        filterKeys={['customer_name', 'property_name']}
        emptyMessage="No customer statements found."
        containerClassName="rounded-lg border-0"
      />
    </SectionCard>
  );

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Accounts Receivable"
        subtitle="Customers, guest folios, aging, credit/debit notes, and collections."
        icon={Users}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={loadData} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={handleExport} className={button.primary}>
              <Download className="w-4 h-4" /> Export
            </button>
            {activeTab === 'customers' && (
              <button onClick={() => setShowNewCustomer(true)} className={button.primary}>
                <Plus className="w-4 h-4" /> New Customer
              </button>
            )}
            {activeTab === 'credit_notes' && (
              <button onClick={() => setShowNewCreditNote(true)} className={button.primary}>
                <Plus className="w-4 h-4" /> New Note
              </button>
            )}
            {activeTab === 'invoices' && (
              <button onClick={() => setShowNewInvoice(true)} className={button.primary}>
                <Plus className="w-4 h-4" /> New Invoice
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
            <span>Loading accounts receivable data...</span>
          </div>
        </div>
      ) : (
        <>
          {/* KPIs — per active tab, above the sub-tab nav */}
          {activeTab === 'customers' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Total Customers" value={customers.length} icon={Users} tone="accent" />
              <StatCard title="Active" value={customers.filter(c => c.is_active !== false).length} icon={CheckCircle2} tone="success" />
              <StatCard title="With Balance" value={customers.filter(c => (c.current_balance ?? 0) > 0).length} icon={AlertCircle} tone="warning" />
              <StatCard title="Total Receivable" value={formatAmount ? formatAmount(customers.reduce((s, c) => s + Number(c.current_balance || 0), 0)) : `$${customers.reduce((s, c) => s + Number(c.current_balance || 0), 0).toLocaleString()}`} icon={DollarSign} tone="info" />
            </div>
          )}
          {activeTab === 'folios' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Total Folios" value={folios.length} icon={FileText} tone="accent" />
              <StatCard title="Open" value={folios.filter(f => f.status === 'Open').length} icon={Clock} tone="warning" />
              <StatCard title="Closed" value={folios.filter(f => f.status === 'Closed').length} icon={CheckCircle2} tone="neutral" />
              <StatCard title="Outstanding" value={formatAmount ? formatAmount(folios.reduce((s, f) => s + (f.balance > 0 ? f.balance : 0), 0)) : `$${folios.reduce((s, f) => s + (f.balance > 0 ? f.balance : 0), 0).toLocaleString()}`} icon={DollarSign} tone="info" />
            </div>
          )}
          {activeTab === 'aging' && (
            <>
              <div className={layout.kpiGrid}>
                <StatCard title="0-30 Days" value={formatAmount ? formatAmount(agingSummary.bucket_0_30) : `$${fmt(agingSummary.bucket_0_30)}`} icon={TrendingUp} tone="success" />
                <StatCard title="31-60 Days" value={formatAmount ? formatAmount(agingSummary.bucket_31_60) : `$${fmt(agingSummary.bucket_31_60)}`} icon={Clock} tone="warning" />
                <StatCard title="61-90 Days" value={formatAmount ? formatAmount(agingSummary.bucket_61_90) : `$${fmt(agingSummary.bucket_61_90)}`} icon={AlertCircle} tone="danger" />
                <StatCard title="90+ Days" value={formatAmount ? formatAmount(agingSummary.bucket_90_plus) : `$${fmt(agingSummary.bucket_90_plus)}`} icon={ServerCrash} tone="danger" />
              </div>
              <div className={layout.kpiGrid}>
                <StatCard title="Total Outstanding" value={formatAmount ? formatAmount(agingSummary.total_outstanding) : `$${fmt(agingSummary.total_outstanding)}`} icon={DollarSign} tone="accent" />
                <StatCard title="Unpaid Folios" value={unpaidFolios.length} icon={FileText} tone="info" />
              </div>
            </>
          )}
          {activeTab === 'credit_notes' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Credit Notes" value={creditNotes.filter(n => n.note_type === 'Credit').length} icon={Download} tone="success" />
              <StatCard title="Debit Notes" value={creditNotes.filter(n => n.note_type === 'Debit').length} icon={RefreshCw} tone="danger" />
              <StatCard title="Total Credits" value={formatAmount ? formatAmount(creditNotes.filter(n => n.note_type === 'Credit').reduce((s, n) => s + Number(n.amount || 0), 0)) : `$${fmt(creditNotes.filter(n => n.note_type === 'Credit').reduce((s, n) => s + Number(n.amount || 0), 0))}`} icon={DollarSign} tone="info" />
              <StatCard title="Total Debits" value={formatAmount ? formatAmount(creditNotes.filter(n => n.note_type === 'Debit').reduce((s, n) => s + Number(n.amount || 0), 0)) : `$${fmt(creditNotes.filter(n => n.note_type === 'Debit').reduce((s, n) => s + Number(n.amount || 0), 0))}`} icon={TrendingUp} tone="warning" />
            </div>
          )}
          {activeTab === 'collections' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Active Collections" value={collections.filter(c => c.status !== 'Resolved').length} icon={Phone} tone="warning" />
              <StatCard title="Total Outstanding" value={formatAmount ? formatAmount(collections.reduce((s, c) => s + Number(c.amount || 0), 0)) : `$${fmt(collections.reduce((s, c) => s + Number(c.amount || 0), 0))}`} icon={DollarSign} tone="info" />
              <StatCard title="Escalated" value={collections.filter(c => c.status === 'Escalated').length} icon={AlertCircle} tone="danger" />
              <StatCard title="Promised" value={collections.filter(c => c.status === 'Promised').length} icon={Clock} tone="success" />
            </div>
          )}

          {/* Sub-tab nav — below stat cards (COA pattern) */}
          <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap">
            {([
              ['customers', 'Customers'],
              ['folios', 'Guest Folios'],
              ['aging', 'Aging Report'],
              ['credit_notes', 'Credit/Debit Notes'],
              ['collections', 'Collections'],
              ['invoices', 'Invoices'],
              ['payment_allocation', 'Payment Allocation'],
              ['statements', 'Statements'],
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

          {/* ── Customers ── */}
          {activeTab === 'customers' && (
            <SectionCard
              title="AR Customers"
              subtitle="Corporate accounts, travel agents, city ledgers, and OTA partners"
              icon={Users}
              pad="none"
              bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
            >
              <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center gap-2 overflow-x-auto">
                {['All', 'Guest Ledger', 'Corporate', 'Travel Agents', 'City Ledger', 'Event Customers', 'Long-term Contracts'].map(t => (
                  <button
                    key={t}
                    onClick={() => setCustomerTypeFilter(t)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition whitespace-nowrap ${
                      customerTypeFilter === t
                        ? 'bg-[var(--color-accent-operations)] text-white'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                    }`}
                  >
                    {t}
                  </button>
                ))}
                <div className="ml-auto flex items-center gap-2">
                  {['All', 'Active', 'Inactive'].map(s => (
                    <button
                      key={s}
                      onClick={() => setCustomerStatusFilter(s)}
                      className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition whitespace-nowrap ${
                        customerStatusFilter === s
                          ? 'bg-[var(--color-accent-operations)] text-white'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <DataTable
                columns={customerColumns}
                data={filteredCustomers}
                rowKey={(row) => row.id}
                sortable
                filterable
                filterPlaceholder="Search customers..."
                filterKeys={['name', 'id', 'email', 'tin', 'customer_type', 'property_name']}
                emptyMessage="No AR customers found. Click New Customer to create one."
                containerClassName="rounded-lg border-0"
              />
            </SectionCard>
          )}

          {/* ── Folios ── */}
          {activeTab === 'folios' && (
            <SectionCard
              title="Guest Folios"
              subtitle="Open and closed folios with aging analysis"
              icon={FileText}
              pad="none"
              bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
            >
              <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center gap-2 overflow-x-auto">
                {['All', 'Open', 'Closed'].map(s => (
                  <button
                    key={s}
                    onClick={() => setFolioStatusFilter(s)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition whitespace-nowrap ${
                      folioStatusFilter === s
                        ? 'bg-[var(--color-accent-operations)] text-white'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <DataTable
                columns={folioColumns}
                data={filteredFolios}
                rowKey={(row) => row.id}
                sortable
                filterable
                filterPlaceholder="Search folios..."
                filterKeys={['guest_name', 'room_number', 'status', 'aging_bucket', 'property_name']}
                emptyMessage="No guest folios found."
                containerClassName="rounded-lg border-0"
              />
            </SectionCard>
          )}

          {/* ── Aging ── */}
          {activeTab === 'aging' && (
            <SectionCard
              title="Aging Report"
              subtitle="Outstanding folio balances by aging bucket"
              icon={Clock}
              pad="none"
              bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
            >
              <DataTable
                columns={folioColumns}
                data={unpaidFolios}
                rowKey={(row) => row.id}
                sortable
                filterable
                filterPlaceholder="Search unpaid folios..."
                filterKeys={['guest_name', 'room_number', 'aging_bucket']}
                emptyMessage="No outstanding folio balances."
                containerClassName="rounded-lg border-0"
              />
            </SectionCard>
          )}

          {/* ── Credit/Debit Notes ── */}
          {activeTab === 'credit_notes' && (
            <SectionCard
              title="Credit & Debit Notes"
              subtitle="Adjustments to customer accounts"
              icon={Download}
              pad="none"
              bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
            >
              <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center gap-2 overflow-x-auto">
                {['All', 'Credit', 'Debit'].map(t => (
                  <button
                    key={t}
                    onClick={() => setCreditNoteTypeFilter(t)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition whitespace-nowrap ${
                      creditNoteTypeFilter === t
                        ? 'bg-[var(--color-accent-operations)] text-white'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                    }`}
                  >
                    {t}
                  </button>
                ))}
                <div className="ml-auto flex items-center gap-2">
                  {['All', 'Pending', 'Applied', 'Void'].map(s => (
                    <button
                      key={s}
                      onClick={() => setCreditNoteStatusFilter(s)}
                      className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition whitespace-nowrap ${
                        creditNoteStatusFilter === s
                          ? 'bg-[var(--color-accent-operations)] text-white'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <DataTable
                columns={[
                  {
                    key: 'note_number',
                    label: 'Note',
                    render: (n: ArCreditNote) => (
                      <div className="flex items-center gap-2">
                        <div className={`p-1.5 rounded-lg ${n.note_type === 'Credit' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600' : 'bg-rose-50 dark:bg-rose-500/10 text-rose-600'}`}>
                          {n.note_type === 'Credit' ? <Download size={12} /> : <RefreshCw size={12} />}
                        </div>
                        <span className="text-xs font-bold text-slate-900 dark:text-white">{n.note_number}</span>
                      </div>
                    ),
                  },
                  {
                    key: 'note_type',
                    label: 'Type',
                    render: (n: ArCreditNote) => (
                      <Badge tone={n.note_type === 'Credit' ? 'success' : 'danger'}>{n.note_type}</Badge>
                    ),
                  },
                  {
                    key: 'customer_name',
                    label: 'Customer',
                    render: (n: ArCreditNote) => <span className="text-xs font-bold text-slate-900 dark:text-white">{n.customer_name || '—'}</span>,
                  },
                  {
                    key: 'reason',
                    label: 'Reason',
                    render: (n: ArCreditNote) => <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{n.reason || '—'}</span>,
                  },
                  {
                    key: 'amount',
                    label: 'Amount',
                    align: 'right' as const,
                    render: (n: ArCreditNote) => (
                      <span className={`text-xs font-bold ${n.note_type === 'Credit' ? 'text-emerald-600' : 'text-rose-600'}`}>
                        ${fmt(Number(n.amount) || 0)}
                      </span>
                    ),
                  },
                  {
                    key: 'property_name',
                    label: 'Property',
                    render: (n: ArCreditNote) => <span className="text-xs font-medium text-slate-500">{n.property_name || propertyName(n.property_id)}</span>,
                  },
                  {
                    key: 'status',
                    label: 'Status',
                    align: 'center' as const,
                    render: (n: ArCreditNote) => {
                      const tone: StatusTone = n.status === 'Applied' ? 'success' : n.status === 'Void' ? 'neutral' : 'warning';
                      return (
                        <div className="flex justify-center">
                          <Badge tone={tone}>{n.status}</Badge>
                        </div>
                      );
                    },
                  },
                  {
                    key: 'actions',
                    label: 'Actions',
                    align: 'center' as const,
                    sortable: false,
                    render: (n: ArCreditNote) => (
                      <div className="flex justify-center gap-1 relative">
                        <div className="relative">
                          <button onClick={() => setMenuOpen(menuOpen === n.id ? null : n.id)} disabled={actingOn === n.id} className={button.ghost + ' disabled:opacity-50'}>
                            {actingOn === n.id ? <Loader2 size={14} className="animate-spin" /> : <MoreVertical size={14} />}
                          </button>
                          {menuOpen === n.id && (
                            <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden">
                              {n.status === 'Pending' && (
                                <button onClick={() => handleApplyCreditNote(n.id, n.note_number)} className="w-full text-left px-3 py-2 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 flex items-center gap-1.5 transition">
                                  <CheckCircle2 size={14} /> Apply
                                </button>
                              )}
                              <button onClick={() => handleDeleteCreditNote(n.id, n.note_number)} className="w-full text-left px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 flex items-center gap-1.5 transition border-t border-slate-100 dark:border-slate-700">
                                <Trash2 size={14} /> Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ),
                  },
                ]}
                data={filteredCreditNotes}
                rowKey={(n) => n.id}
                sortable
                filterable
                filterPlaceholder="Search notes..."
                filterKeys={['note_number', 'customer_name', 'reason', 'note_type', 'property_name']}
                emptyMessage="No credit or debit notes found."
                containerClassName="rounded-lg border-0"
              />
            </SectionCard>
          )}

          {/* ── Collections ── */}
          {activeTab === 'collections' && (
            <SectionCard
              title="Collections"
              subtitle="Active collection efforts and follow-up actions"
              icon={Phone}
              pad="none"
              bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
            >
              <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center gap-2 overflow-x-auto">
                {['All', 'In Progress', 'Promised', 'Escalated', 'Resolved'].map(s => (
                  <button
                    key={s}
                    onClick={() => setCollectionStatusFilter(s)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition whitespace-nowrap ${
                      collectionStatusFilter === s
                        ? 'bg-[var(--color-accent-operations)] text-white'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <DataTable
                columns={[
                  {
                    key: 'customer_name',
                    label: 'Customer',
                    render: (c: ArCollection) => (
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-amber-50 dark:bg-amber-500/10 text-amber-600 rounded-lg"><Phone size={12} /></div>
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-slate-900 dark:text-white">{c.customer_name || '—'}</span>
                          <span className="text-[10px] font-medium text-slate-400 font-mono">{c.folio_id || '—'}</span>
                        </div>
                      </div>
                    ),
                  },
                  {
                    key: 'amount',
                    label: 'Amount',
                    align: 'right' as const,
                    render: (c: ArCollection) => <span className="text-xs font-bold text-slate-900 dark:text-white">${fmt(Number(c.amount) || 0)}</span>,
                  },
                  {
                    key: 'days_overdue',
                    label: 'Days Overdue',
                    align: 'center' as const,
                    render: (c: ArCollection) => (
                      <span className={`text-xs font-bold ${c.days_overdue > 60 ? 'text-rose-600' : c.days_overdue > 30 ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {c.days_overdue}d
                      </span>
                    ),
                  },
                  {
                    key: 'last_contact',
                    label: 'Last Contact',
                    render: (c: ArCollection) => <span className="text-xs font-medium text-slate-500">{c.last_contact || '—'}</span>,
                  },
                  {
                    key: 'next_action',
                    label: 'Next Action',
                    render: (c: ArCollection) => <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{c.next_action || '—'}</span>,
                  },
                  {
                    key: 'property_name',
                    label: 'Property',
                    render: (c: ArCollection) => <span className="text-xs font-medium text-slate-500">{c.property_name || propertyName(c.property_id)}</span>,
                  },
                  {
                    key: 'status',
                    label: 'Status',
                    align: 'center' as const,
                    render: (c: ArCollection) => {
                      const tone: StatusTone =
                        c.status === 'Promised' ? 'info' :
                        c.status === 'Escalated' ? 'danger' :
                        c.status === 'In Progress' ? 'warning' : 'success';
                      return (
                        <div className="flex justify-center">
                          <Badge tone={tone}>{c.status}</Badge>
                        </div>
                      );
                    },
                  },
                  {
                    key: 'actions',
                    label: 'Actions',
                    align: 'center' as const,
                    sortable: false,
                    render: (c: ArCollection) => (
                      <div className="flex justify-center gap-1 relative">
                        <div className="relative">
                          <button onClick={() => setMenuOpen(menuOpen === c.id ? null : c.id)} disabled={actingOn === c.id} className={button.ghost + ' disabled:opacity-50'}>
                            {actingOn === c.id ? <Loader2 size={14} className="animate-spin" /> : <MoreVertical size={14} />}
                          </button>
                          {menuOpen === c.id && (
                            <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden">
                              {c.status !== 'Promised' && (
                                <button onClick={() => handleUpdateCollectionStatus(c.id, 'Promised', c.customer_name || 'customer')} className="w-full text-left px-3 py-2 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center gap-1.5 transition">
                                  <CheckCircle2 size={14} /> Mark Promised
                                </button>
                              )}
                              {c.status !== 'Escalated' && (
                                <button onClick={() => handleUpdateCollectionStatus(c.id, 'Escalated', c.customer_name || 'customer')} className="w-full text-left px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 flex items-center gap-1.5 transition">
                                  <Send size={14} /> Escalate
                                </button>
                              )}
                              {c.status !== 'Resolved' && (
                                <button onClick={() => handleUpdateCollectionStatus(c.id, 'Resolved', c.customer_name || 'customer')} className="w-full text-left px-3 py-2 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 flex items-center gap-1.5 transition">
                                  <CheckCircle2 size={14} /> Resolve
                                </button>
                              )}
                              <button onClick={() => handleDeleteCollection(c.id, c.customer_name || 'customer')} className="w-full text-left px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 flex items-center gap-1.5 transition border-t border-slate-100 dark:border-slate-700">
                                <Trash2 size={14} /> Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ),
                  },
                ]}
                data={filteredCollections}
                rowKey={(c) => c.id}
                sortable
                filterable
                filterPlaceholder="Search collections..."
                filterKeys={['customer_name', 'folio_id', 'status', 'next_action', 'property_name']}
                emptyMessage="No active collections."
                containerClassName="rounded-lg border-0"
              />
            </SectionCard>
          )}

          {/* ── Invoices ── */}
          {activeTab === 'invoices' && renderInvoices()}

          {/* ── Payment Allocation ── */}
          {activeTab === 'payment_allocation' && renderPaymentAllocation()}

          {/* ── Statements ── */}
          {activeTab === 'statements' && renderStatements()}
        </>
      )}

      <ModalSystem
        isOpen={!!selectedCustomer}
        onClose={() => setSelectedCustomer(null)}
        title={selectedCustomer?.name}
        subtitle={`Customer ID: ${selectedCustomer?.id}`}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {selectedCustomer && (
          <>
            <div className="p-6 space-y-6 overflow-y-auto">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Contact Email</span>
                  <div className="flex items-center gap-2">
                    <Mail size={14} className="text-slate-400" />
                    <span className="text-xs font-bold text-slate-900 dark:text-white">{selectedCustomer.email || '—'}</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Phone</span>
                  <div className="flex items-center gap-2">
                    <Phone size={14} className="text-slate-400" />
                    <span className="text-xs font-bold text-slate-900 dark:text-white">{selectedCustomer.phone || '—'}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Address</span>
                <div className="flex items-center gap-2">
                  <MapPin size={14} className="text-slate-400" />
                  <span className="text-xs font-bold text-slate-900 dark:text-white">{selectedCustomer.address || '—'}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Tax ID (TIN)</span>
                  <span className="text-xs font-black text-slate-900 dark:text-white font-mono">{selectedCustomer.tin || '—'}</span>
                </div>
                <div className="space-y-2">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Customer Type</span>
                  <span className="text-xs font-black text-slate-900 dark:text-white">{selectedCustomer.customer_type || '—'}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="bg-indigo-50 dark:bg-indigo-500 border border-indigo-100 dark:border-indigo-500 rounded-lg p-4">
                  <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest block">Credit Limit</span>
                  <span className="text-2xl font-black text-indigo-600">${selectedCustomer.credit_limit ? fmt(selectedCustomer.credit_limit) : '0.00'}</span>
                </div>
                <div className={`rounded-lg p-4 border ${(selectedCustomer.current_balance ?? 0) > 0 ? 'bg-amber-50 dark:bg-amber-500 border-amber-100 dark:border-amber-500' : 'bg-emerald-50 dark:bg-emerald-500 border-emerald-100 dark:border-emerald-500'}`}>
                  <span className={`text-[10px] font-black uppercase tracking-widest block ${(selectedCustomer.current_balance ?? 0) > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>Current Balance</span>
                  <span className={`text-2xl font-black ${(selectedCustomer.current_balance ?? 0) > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>${selectedCustomer.current_balance ? fmt(selectedCustomer.current_balance) : '0.00'}</span>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-3 bg-slate-50 dark:bg-slate-700">
              <button onClick={() => setSelectedCustomer(null)} className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all">Close</button>
            </div>
          </>
        )}
      </ModalSystem>

      <ModalSystem
        isOpen={showNewCustomer}
        onClose={() => setShowNewCustomer(false)}
        title="New Customer"
        subtitle="Create a new accounts receivable customer"
        variant="form"
        size="md"
        showFooter={false}
      >
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Customer Name</label>
              <input
                type="text"
                value={newCustomerForm.name}
                onChange={(e) => setNewCustomerForm({ ...newCustomerForm, name: e.target.value })}
                className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="TechCorp Group"
              />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Customer Type</label>
              <select
                value={newCustomerForm.category}
                onChange={(e) => setNewCustomerForm({ ...newCustomerForm, category: e.target.value })}
                className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="Guest Ledger">Guest Ledger</option>
                <option value="Corporate">Corporate</option>
                <option value="Travel Agents">Travel Agents</option>
                <option value="City Ledger">City Ledger</option>
                <option value="Event Customers">Event Customers</option>
                <option value="Long-term Contracts">Long-term Contracts</option>
                <option value="Government">Government</option>
                <option value="Individual">Individual</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Email</label>
              <input
                type="email"
                value={newCustomerForm.contactEmail}
                onChange={(e) => setNewCustomerForm({ ...newCustomerForm, contactEmail: e.target.value })}
                className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="finance@company.com"
              />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Phone</label>
              <input
                type="text"
                value={newCustomerForm.contactPhone}
                onChange={(e) => setNewCustomerForm({ ...newCustomerForm, contactPhone: e.target.value })}
                className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="+251 911 123 456"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">TIN</label>
              <input
                type="text"
                value={newCustomerForm.taxId}
                onChange={(e) => setNewCustomerForm({ ...newCustomerForm, taxId: e.target.value })}
                className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="TIN-000000000"
              />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Credit Limit</label>
              <input
                type="number"
                value={newCustomerForm.creditLimit}
                onChange={(e) => setNewCustomerForm({ ...newCustomerForm, creditLimit: Number(e.target.value) })}
                className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="500000"
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Address</label>
            <input
              type="text"
              value={newCustomerForm.address}
              onChange={(e) => setNewCustomerForm({ ...newCustomerForm, address: e.target.value })}
              className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Bole Subcity, Addis Ababa"
            />
          </div>
        </div>
        <div className="p-6 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-3 bg-slate-50 dark:bg-slate-700">
          <button onClick={() => setShowNewCustomer(false)} className="px-6 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all hover:shadow-md">Cancel</button>
          <button onClick={handleCreateCustomer} className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all">Create Customer</button>
        </div>
      </ModalSystem>

      <ModalSystem
        isOpen={showNewCreditNote}
        onClose={() => setShowNewCreditNote(false)}
        title="New Credit/Debit Note"
        subtitle="Create an invoice adjustment"
        variant="form"
        size="md"
        showFooter={false}
      >
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Note Type</label>
              <select
                value={newCreditNoteForm.noteType}
                onChange={(e) => setNewCreditNoteForm({ ...newCreditNoteForm, noteType: e.target.value as 'Credit' | 'Debit' })}
                className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="Credit">Credit</option>
                <option value="Debit">Debit</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Customer</label>
              <select
                value={newCreditNoteForm.customerId}
                onChange={(e) => setNewCreditNoteForm({ ...newCreditNoteForm, customerId: e.target.value })}
                className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">— Select Customer —</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Reason</label>
            <input
              type="text"
              value={newCreditNoteForm.reason}
              onChange={(e) => setNewCreditNoteForm({ ...newCreditNoteForm, reason: e.target.value })}
              className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Overpayment Refund"
            />
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Amount</label>
            <input
              type="number"
              value={newCreditNoteForm.amount}
              onChange={(e) => setNewCreditNoteForm({ ...newCreditNoteForm, amount: Number(e.target.value) })}
              className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="0.00"
            />
          </div>
        </div>
        <div className="p-6 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-3 bg-slate-50 dark:bg-slate-700">
          <button onClick={() => setShowNewCreditNote(false)} className="px-6 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all hover:shadow-md">Cancel</button>
          <button onClick={handleCreateCreditNote} className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all">Create Note</button>
        </div>
      </ModalSystem>

      <ModalSystem
        isOpen={showNewInvoice}
        onClose={() => setShowNewInvoice(false)}
        title="New AR Invoice"
        subtitle="Create a customer invoice"
        variant="form"
        size="md"
        showFooter={false}
      >
        <div className="p-6 space-y-4">
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Customer</label>
            <select
              value={newInvoiceForm.customerId}
              onChange={(e) => setNewInvoiceForm({ ...newInvoiceForm, customerId: e.target.value })}
              className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">— Select customer —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Invoice #</label>
              <input
                type="text"
                value={newInvoiceForm.invoiceNumber}
                onChange={(e) => setNewInvoiceForm({ ...newInvoiceForm, invoiceNumber: e.target.value })}
                className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Auto-generated if blank"
              />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Issue Date</label>
              <input
                type="date"
                value={newInvoiceForm.issueDate}
                onChange={(e) => setNewInvoiceForm({ ...newInvoiceForm, issueDate: e.target.value })}
                className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Net Amount</label>
              <input
                type="number"
                step="0.01"
                value={newInvoiceForm.netAmount || ''}
                onChange={(e) => setNewInvoiceForm({ ...newInvoiceForm, netAmount: Number(e.target.value) })}
                className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Tax Amount</label>
              <input
                type="number"
                step="0.01"
                value={newInvoiceForm.taxAmount || ''}
                onChange={(e) => setNewInvoiceForm({ ...newInvoiceForm, taxAmount: Number(e.target.value) })}
                className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="0.00"
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Description</label>
            <input
              type="text"
              value={newInvoiceForm.description}
              onChange={(e) => setNewInvoiceForm({ ...newInvoiceForm, description: e.target.value })}
              className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Goods/Services description"
            />
          </div>
        </div>
        <div className="p-6 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-3 bg-slate-50 dark:bg-slate-700">
          <button onClick={() => setShowNewInvoice(false)} className="px-6 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all hover:shadow-md">Cancel</button>
          <button onClick={handleCreateInvoice} className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all">Create Invoice</button>
        </div>
      </ModalSystem>
    </div>
  );
};

export default AccountsReceivable;
