import React, { useState, useEffect, useCallback } from 'react';
import {
  Truck,
  ArrowUpRight,
  ArrowDownRight,
  Search,
  Filter,
  Download,
  MoreVertical,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Clock,
  ExternalLink,
  Plus,
  Eye,
  FileText,
  DollarSign,
  Building2,
  User,
  Phone,
  Mail,
  MapPin,
  Percent,
  ShieldCheck,
  Send,
  Loader2,
  Trash2,
  RefreshCw,
  ServerCrash,
} from 'lucide-react';
import {
  fetchVendors,
  fetchBills,
  fetchPayments,
  payBill,
  createVendor,
  createBill,
  fetchThreeWayMatches,
  approveThreeWayMatch,
  fetchPaymentSchedules,
  updatePaymentSchedule,
  deletePaymentSchedule,
  type Vendor,
  type Bill,
  type Payment,
  type ThreeWayMatch,
  type PaymentSchedule,
} from '../../services/accountsPayableService';
import { useERP } from '../../context/ERPContext';
import { ModalSystem } from '../Shared/ModalSystem';
import { DataTable, Column } from '../Shared/DataTable';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import StatCard from '../FrontOffice/StatCard';

const fmt = (n: number) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const AccountsPayable = () => {
  const { currentPropertyId, addNotification, properties } = useERP();
  const [activeTab, setActiveTab] = useState<'vendors' | 'bills' | 'payments' | 'matching' | 'scheduling' | 'statements' | 'aging' | 'credit_notes'>('vendors');
  const [showNewVendor, setShowNewVendor] = useState(false);
  const [showNewBill, setShowNewBill] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [matches, setMatches] = useState<ThreeWayMatch[]>([]);
  const [schedules, setSchedules] = useState<PaymentSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  // Filter states
  const [vendorStatusFilter, setVendorStatusFilter] = useState('All');
  const [vendorCategoryFilter, setVendorCategoryFilter] = useState('All');
  const [billStatusFilter, setBillStatusFilter] = useState('All');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('All');
  const [matchStatusFilter, setMatchStatusFilter] = useState('All');
  const [scheduleStatusFilter, setScheduleStatusFilter] = useState('All');

  const propertyName = useCallback((id?: string | null): string => {
    if (!id) return '—';
    const p = properties.find(p => p.id === id);
    return p?.property_name || '—';
  }, [properties]);

  const [newVendorForm, setNewVendorForm] = useState({
    name: '',
    contactName: '',
    email: '',
    phone: '',
    address: '',
    taxId: '',
    withholdingRate: 2,
    category: 'Suppliers',
  });

  const [newBillForm, setNewBillForm] = useState({
    vendorId: '',
    invoiceNumber: '',
    invoiceDate: new Date().toISOString().split('T')[0],
    dueDate: new Date().toISOString().split('T')[0],
    category: '',
    amount: 0,
    taxAmount: 0,
    withholdingAmount: 0,
    lines: [] as Array<{ description: string; quantity: number; rate: number; total: number }>,
  });

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const pid = currentPropertyId || undefined;
      const [v, b, p, m, s] = await Promise.all([
        fetchVendors(pid),
        fetchBills(undefined, pid),
        fetchPayments(pid),
        fetchThreeWayMatches(undefined, pid),
        fetchPaymentSchedules(undefined, pid),
      ]);
      setVendors(v);
      setBills(b);
      setPayments(p);
      setMatches(m);
      setSchedules(s);
    } catch (err: any) {
      console.error('Error loading AP data:', err);
      setError(err.message || 'Failed to load accounts payable data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [currentPropertyId]);

  // Close action menu on outside click
  useEffect(() => {
    const handler = () => setMenuOpen(null);
    if (menuOpen) {
      window.addEventListener('click', handler);
      return () => window.removeEventListener('click', handler);
    }
  }, [menuOpen]);

  // Filtered datasets
  const filteredVendors = vendors.filter(v => {
    if (vendorStatusFilter !== 'All' && v.status !== vendorStatusFilter) return false;
    if (vendorCategoryFilter !== 'All' && v.category !== vendorCategoryFilter) return false;
    return true;
  });
  const filteredBills = bills.filter(b => billStatusFilter === 'All' || b.status === billStatusFilter);
  const filteredPayments = payments.filter(p => paymentStatusFilter === 'All' || p.status === paymentStatusFilter);
  const filteredMatches = matches.filter(m => matchStatusFilter === 'All' || m.status === matchStatusFilter);
  const filteredSchedules = schedules.filter(s => scheduleStatusFilter === 'All' || s.status === scheduleStatusFilter);

  const handlePayBill = async (bill: Bill) => {
    try {
      await payBill(bill.id, {
        amount: bill.amountDue,
        paymentDate: new Date().toISOString().split('T')[0],
        paymentMethod: 'Bank Transfer',
        reference: `PAY-${Date.now()}`,
      });
      addNotification(`Bill ${bill.invoiceNumber} paid`, 'success', 'finance');
      await loadData();
      setSelectedBill(null);
    } catch (err: any) {
      console.error('Failed to pay bill:', err);
      addNotification(err.message || 'Failed to record payment', 'error', 'finance');
    }
  };

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
    if (activeTab === 'vendors') {
      exportToCsv(`ap_vendors_${new Date().toISOString().slice(0, 10)}.csv`,
        ['Vendor #', 'Name', 'Category', 'Email', 'Phone', 'Balance', 'Status'],
        vendors.map(v => [v.vendor_number || v.id, v.name, v.category || '—', v.email || '', v.phone || '', Number(v.balance || 0), v.status || 'Active']));
    } else if (activeTab === 'bills') {
      exportToCsv(`ap_bills_${new Date().toISOString().slice(0, 10)}.csv`,
        ['Bill #', 'Vendor', 'Invoice #', 'Amount Due', 'Net Payable', 'Due Date', 'Status'],
        bills.map(b => [b.bill_number || b.id, b.vendor_name || '—', b.invoiceNumber || '', Number(b.amountDue || 0), Number(b.netPayable || 0), b.dueDate || '', b.status || 'Pending']));
    } else if (activeTab === 'payments') {
      exportToCsv(`ap_payments_${new Date().toISOString().slice(0, 10)}.csv`,
        ['Payment #', 'Vendor', 'Bill #', 'Amount', 'Method', 'Date', 'Reference'],
        payments.map(p => [p.payment_number || p.id, p.vendor_name || '—', p.bill_number || '', Number(p.amount || 0), p.payment_method || '', p.payment_date || '', p.reference || '']));
    } else if (activeTab === 'matching') {
      exportToCsv(`ap_3way_match_${new Date().toISOString().slice(0, 10)}.csv`,
        ['Match #', 'PO #', 'GRN #', 'Invoice #', 'Vendor', 'Status', 'Discrepancy'],
        matches.map(m => [m.id, m.po_number || '', m.grn_number || '', m.invoice_number || '', m.vendor_name || '—', m.status || 'Pending', m.discrepancy || 'None']));
    } else if (activeTab === 'scheduling') {
      exportToCsv(`ap_payment_schedule_${new Date().toISOString().slice(0, 10)}.csv`,
        ['Schedule #', 'Vendor', 'Bill #', 'Amount', 'Scheduled Date', 'Method', 'Status'],
        schedules.map(s => [s.id, s.vendor_name || '—', s.bill_number || '', Number(s.amount || 0), s.scheduled_date || '', s.payment_method || '', s.status || 'Pending']));
    } else {
      exportToCsv(`ap_${activeTab}_${new Date().toISOString().slice(0, 10)}.csv`,
        ['Vendor #', 'Name', 'Balance'],
        vendors.map(v => [v.vendor_number || v.id, v.name, Number(v.balance || 0)]));
    }
  };

  const handleCreateVendor = async () => {
    if (!newVendorForm.name) {
      setError('Vendor name is required');
      return;
    }
    try {
      await createVendor({ ...newVendorForm, propertyId: currentPropertyId || undefined });
      await loadData();
      setShowNewVendor(false);
      setNewVendorForm({
        name: '',
        contactName: '',
        email: '',
        phone: '',
        address: '',
        taxId: '',
        withholdingRate: 2,
        category: 'Suppliers',
      });
    } catch (err: any) {
      console.error('Failed to create vendor:', err);
      setError(err.message || 'Failed to create vendor');
    }
  };

  const handleCreateBill = async () => {
    if (!newBillForm.vendorId || !newBillForm.invoiceNumber || !newBillForm.invoiceDate || !newBillForm.dueDate) {
      setError('Vendor, invoice number, invoice date and due date are required');
      return;
    }
    try {
      await createBill({ ...newBillForm, propertyId: currentPropertyId || undefined });
      await loadData();
      setShowNewBill(false);
      setNewBillForm({
        vendorId: '',
        invoiceNumber: '',
        invoiceDate: new Date().toISOString().split('T')[0],
        dueDate: new Date().toISOString().split('T')[0],
        category: '',
        amount: 0,
        taxAmount: 0,
        withholdingAmount: 0,
        lines: [],
      });
    } catch (err: any) {
      console.error('Failed to create bill:', err);
      setError(err.message || 'Failed to create bill');
    }
  };

  const totalPayables = vendors.reduce((sum, v) => sum + v.balance, 0);
  const criticalDue = bills.filter(b => b.status === 'Overdue').reduce((sum, b) => sum + b.amountDue, 0);
  const activeVendorCount = vendors.filter(v => v.status === 'Active').length;

  const handleApproveMatch = async (id: string, po: string) => {
    setActingOn(id);
    try {
      await approveThreeWayMatch(id);
      addNotification(`Match ${po} approved`, 'success', 'finance');
      await loadData();
    } catch (err: any) {
      addNotification(err.message || 'Failed to approve match', 'error', 'finance');
    } finally {
      setActingOn(null);
      setMenuOpen(null);
    }
  };

  const handleUpdateScheduleStatus = async (id: string, status: string, label: string) => {
    setActingOn(id);
    try {
      await updatePaymentSchedule(id, { status } as any);
      addNotification(`Schedule ${label} marked as ${status}`, 'success', 'finance');
      await loadData();
    } catch (err: any) {
      addNotification(err.message || 'Failed to update schedule', 'error', 'finance');
    } finally {
      setActingOn(null);
      setMenuOpen(null);
    }
  };

  const handleDeleteSchedule = async (id: string, label: string) => {
    if (!confirm(`Delete schedule for ${label}?`)) return;
    setActingOn(id);
    try {
      await deletePaymentSchedule(id);
      addNotification(`Schedule ${label} deleted`, 'success', 'finance');
      await loadData();
    } catch (err: any) {
      addNotification(err.message || 'Failed to delete schedule', 'error', 'finance');
    } finally {
      setActingOn(null);
      setMenuOpen(null);
    }
  };

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Accounts Payable"
        subtitle="Vendors, bills, payments, three-way matching, and payment scheduling."
        icon={Truck}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={loadData} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={handleExport} className={button.primary}>
              <Download className="w-4 h-4" /> Export
            </button>
            {activeTab === 'vendors' && (
              <button onClick={() => setShowNewVendor(true)} className={button.primary}>
                <Plus className="w-4 h-4" /> New Vendor
              </button>
            )}
            {activeTab === 'bills' && (
              <button onClick={() => setShowNewBill(true)} className={button.primary}>
                <Plus className="w-4 h-4" /> New Bill
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
            <span>Loading accounts payable data...</span>
          </div>
        </div>
      ) : (
        <>
          {/* KPIs — per active tab, above the sub-tab nav */}
          {activeTab === 'vendors' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Total Vendors" value={vendors.length} icon={Truck} tone="accent" />
              <StatCard title="Active" value={activeVendorCount} icon={CheckCircle2} tone="success" />
              <StatCard title="With Balance" value={vendors.filter(v => v.balance > 0).length} icon={AlertCircle} tone="warning" />
              <StatCard title="Total Payables" value={fmt(totalPayables)} icon={DollarSign} tone="info" />
            </div>
          )}
          {activeTab === 'bills' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Total Bills" value={bills.length} icon={FileText} tone="accent" />
              <StatCard title="Overdue" value={bills.filter(b => b.status === 'Overdue').length} icon={AlertCircle} tone="danger" />
              <StatCard title="Paid" value={bills.filter(b => b.status === 'Paid').length} icon={CheckCircle2} tone="success" />
              <StatCard title="Critical Due" value={fmt(criticalDue)} icon={DollarSign} tone="warning" />
            </div>
          )}
          {activeTab === 'payments' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Total Payments" value={payments.length} icon={DollarSign} tone="accent" />
              <StatCard title="Processed" value={payments.filter(p => p.status === 'Processed').length} icon={CheckCircle2} tone="success" />
              <StatCard title="Draft" value={payments.filter(p => p.status === 'Draft').length} icon={Clock} tone="warning" />
              <StatCard title="Total Paid" value={fmt(payments.reduce((s, p) => s + Number(p.amount || 0), 0))} icon={ArrowUpRight} tone="info" />
            </div>
          )}
          {activeTab === 'matching' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Pending Matches" value={matches.filter(m => m.status === 'Pending').length} icon={AlertCircle} tone="warning" />
              <StatCard title="Approved" value={matches.filter(m => m.status === 'Approved').length} icon={CheckCircle2} tone="success" />
              <StatCard title="Discrepancies" value={matches.filter(m => m.status === 'Discrepancy').length} icon={ShieldCheck} tone="danger" />
              <StatCard title="Total Value" value={fmt(matches.reduce((s, m) => s + m.po_amount, 0))} icon={DollarSign} tone="info" />
            </div>
          )}
          {activeTab === 'scheduling' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Scheduled" value={schedules.filter(s => s.status === 'Pending').length} icon={Calendar} tone="warning" />
              <StatCard title="Total Scheduled" value={fmt(schedules.filter(s => s.status === 'Pending').reduce((sum, s) => sum + s.amount, 0))} icon={DollarSign} tone="info" />
              <StatCard title="Overdue" value={schedules.filter(s => s.status === 'Overdue').length} icon={AlertCircle} tone="danger" />
              <StatCard title="Auto-Pay" value={schedules.filter(s => s.auto_pay).length} icon={ShieldCheck} tone="success" />
            </div>
          )}

          {/* Sub-tab nav — below stat cards (COA pattern) */}
          <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap">
            {([
              ['vendors', 'Vendors'],
              ['bills', 'Bills'],
              ['payments', 'Payments'],
              ['matching', '3-Way Match'],
              ['scheduling', 'Scheduling'],
              ['statements', 'Statements'],
              ['aging', 'Aging'],
              ['credit_notes', 'Credit Notes'],
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
      {activeTab === 'vendors' && (
        <SectionCard
          title="Vendor Registry"
          subtitle="Supplier and vendor account management"
          icon={Truck}
          pad="none"
          bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
        >
          <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center gap-2 overflow-x-auto">
            {['All', 'Active', 'Inactive', 'Hold'].map(s => (
              <button key={s} onClick={() => setVendorStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition whitespace-nowrap ${
                  vendorStatusFilter === s
                    ? 'bg-[var(--color-accent-operations)] text-white'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                }`}>
                {s}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2">
              {['All', 'Suppliers', 'Contractors', 'Utilities', 'Service Providers', 'Government Agencies', 'Other'].map(c => (
                <button key={c} onClick={() => setVendorCategoryFilter(c)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition whitespace-nowrap ${
                    vendorCategoryFilter === c
                      ? 'bg-[var(--color-accent-operations)] text-white'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                  }`}>
                  {c}
                </button>
              ))}
            </div>
          </div>
          <DataTable
            columns={[
              {
                key: 'name', label: 'Vendor',
                render: (v: Vendor) => (
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 rounded-lg"><Truck size={12} /></div>
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-slate-900 dark:text-white">{v.name}</span>
                      <span className="text-[10px] font-medium text-slate-400">{v.category || '—'}</span>
                    </div>
                  </div>
                ),
              },
              {
                key: 'contact', label: 'Contact',
                render: (v: Vendor) => (
                  <div className="flex flex-col gap-0.5">
                    {v.email && (
                      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                        <Mail size={12} className="text-slate-400" />
                        {v.email}
                      </div>
                    )}
                    {v.phone && (
                      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                        <Phone size={12} className="text-slate-400" />
                        {v.phone}
                      </div>
                    )}
                  </div>
                ),
              },
              {
                key: 'taxId', label: 'TIN',
                render: (v: Vendor) => <span className="text-xs font-medium text-slate-500 font-mono">{v.taxId || '—'}</span>,
              },
              {
                key: 'withholdingRate', label: 'Withholding', align: 'center' as const,
                render: (v: Vendor) => (
                  <div className="flex justify-center">
                    <Badge tone={v.withholdingRate ? 'warning' : 'neutral'}>{v.withholdingRate ?? 0}%</Badge>
                  </div>
                ),
              },
              {
                key: 'balance', label: 'Balance', align: 'right' as const,
                render: (v: Vendor) => (
                  <span className={`text-xs font-bold ${v.balance > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                    ${fmt(v.balance)}
                  </span>
                ),
              },
              {
                key: 'status', label: 'Status', align: 'center' as const,
                render: (v: Vendor) => (
                  <div className="flex justify-center">
                    <Badge tone={v.status === 'Active' ? 'success' : 'neutral'}>{v.status}</Badge>
                  </div>
                ),
              },
              {
                key: 'property_name', label: 'Property',
                render: (v: Vendor) => <span className="text-xs font-medium text-slate-500">{v.property_name || propertyName(v.property_id)}</span>,
              },
              {
                key: 'actions', label: 'Actions', align: 'center' as const, sortable: false,
                render: (v: Vendor) => (
                  <div className="flex justify-center gap-1">
                    <button onClick={() => setSelectedVendor(v)} className={button.ghost}>
                      <Eye size={14} />
                    </button>
                  </div>
                ),
              },
            ] as Column<Vendor>[]}
            data={filteredVendors}
            rowKey={(v) => v.id}
            sortable
            filterable
            filterPlaceholder="Search vendors..."
            filterKeys={['name', 'id', 'contact', 'email', 'phone', 'taxId', 'status', 'property_name']}
            emptyMessage="No vendors found."
            containerClassName="rounded-lg border-0"
          />
        </SectionCard>
      )}

      {activeTab === 'bills' && (
        <SectionCard
          title="Bills Registry"
          subtitle="Vendor invoices and payable items"
          icon={FileText}
          pad="none"
          bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
        >
          <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center gap-2 overflow-x-auto">
            {['All', 'Approved', 'Overdue', 'Paid', 'Draft', 'Void'].map(s => (
              <button key={s} onClick={() => setBillStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition whitespace-nowrap ${
                  billStatusFilter === s
                    ? 'bg-[var(--color-accent-operations)] text-white'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                }`}>
                {s}
              </button>
            ))}
          </div>
          <DataTable
            columns={[
              { key: 'invoiceNumber', label: 'Bill', render: (b: Bill) => (
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 rounded-lg"><FileText size={12} /></div>
                  <span className="text-xs font-bold text-slate-900 dark:text-white">{b.invoiceNumber}</span>
                </div>
              ) },
              { key: 'vendorName', label: 'Vendor', render: (b: Bill) => (
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-slate-900 dark:text-white">{b.vendorName || '—'}</span>
                  <span className="text-[10px] font-medium text-slate-400">{b.category || '—'}</span>
                </div>
              ) },
              { key: 'dueDate', label: 'Due Date', align: 'center' as const, render: (b: Bill) => <span className="text-xs font-medium text-slate-500">{b.dueDate}</span> },
              { key: 'amount', label: 'Gross', align: 'right' as const, render: (b: Bill) => <span className="text-xs font-bold text-slate-900 dark:text-white">${fmt(b.amount)}</span> },
              { key: 'withholdingAmount', label: 'Withholding', align: 'right' as const, render: (b: Bill) => <span className="text-xs font-bold text-amber-600">${fmt(b.withholdingAmount)}</span> },
              { key: 'netPayable', label: 'Net Payable', align: 'right' as const, render: (b: Bill) => <span className="text-xs font-bold text-emerald-600">${fmt(b.netPayable)}</span> },
              { key: 'property_name', label: 'Property', render: (b: Bill) => <span className="text-xs font-medium text-slate-500">{b.property_name || propertyName(b.property_id)}</span> },
              { key: 'status', label: 'Status', align: 'center' as const, render: (b: Bill) => {
                const tone: StatusTone = b.status === 'Paid' ? 'success' : b.status === 'Overdue' ? 'danger' : b.status === 'Void' ? 'neutral' : 'warning';
                return (
                  <div className="flex justify-center">
                    <Badge tone={tone}>{b.status}</Badge>
                  </div>
                );
              } },
              { key: 'actions', label: 'Actions', align: 'center' as const, sortable: false, render: (b: Bill) => (
                <div className="flex justify-center gap-1">
                  <button onClick={() => setSelectedBill(b)} className={button.ghost}><Eye size={14} /></button>
                </div>
              ) },
            ] as Column<Bill>[]}
            data={filteredBills}
            rowKey={(b) => b.id}
            sortable
            filterable
            filterPlaceholder="Search bills..."
            filterKeys={['invoiceNumber', 'vendorName', 'status', 'property_name']}
            emptyMessage="No bills found."
            containerClassName="rounded-lg border-0"
          />
        </SectionCard>
      )}

      {activeTab === 'payments' && (
        <SectionCard
          title="Payments Registry"
          subtitle="Vendor payment history and disbursements"
          icon={DollarSign}
          pad="none"
          bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
        >
          <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center gap-2 overflow-x-auto">
            {['All', 'Processed', 'Approved', 'Draft', 'Cancelled'].map(s => (
              <button key={s} onClick={() => setPaymentStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition whitespace-nowrap ${
                  paymentStatusFilter === s
                    ? 'bg-[var(--color-accent-operations)] text-white'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                }`}>
                {s}
              </button>
            ))}
          </div>
          <DataTable
            columns={[
              { key: 'payment_number', label: 'Payment', render: (p: Payment) => (
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 rounded-lg"><DollarSign size={12} /></div>
                  <span className="text-xs font-bold text-slate-900 dark:text-white">{(p as any).payment_number || p.id.slice(0, 8)}</span>
                </div>
              ) },
              { key: 'vendorName', label: 'Vendor', render: (p: Payment) => <span className="text-xs font-bold text-slate-900 dark:text-white">{p.vendorName || '—'}</span> },
              { key: 'paymentDate', label: 'Date', align: 'center' as const, render: (p: Payment) => <span className="text-xs font-medium text-slate-500">{p.paymentDate}</span> },
              { key: 'paymentMethod', label: 'Method', render: (p: Payment) => <span className="text-xs font-medium text-slate-500">{p.paymentMethod || '—'}</span> },
              { key: 'reference', label: 'Reference', render: (p: Payment) => <span className="text-xs font-medium text-slate-500 font-mono">{p.reference || '—'}</span> },
              { key: 'amount', label: 'Amount', align: 'right' as const, render: (p: Payment) => <span className="text-xs font-bold text-slate-900 dark:text-white">${fmt(p.amount)}</span> },
              { key: 'property_name', label: 'Property', render: (p: Payment) => <span className="text-xs font-medium text-slate-500">{p.property_name || propertyName(p.property_id)}</span> },
              { key: 'status', label: 'Status', align: 'center' as const, render: (p: Payment) => {
                const tone: StatusTone = p.status === 'Processed' ? 'success' : p.status === 'Cancelled' ? 'neutral' : 'warning';
                return (
                  <div className="flex justify-center">
                    <Badge tone={tone}>{p.status}</Badge>
                  </div>
                );
              } },
            ] as Column<Payment>[]}
            data={filteredPayments}
            rowKey={(p) => p.id}
            sortable
            filterable
            filterPlaceholder="Search payments..."
            filterKeys={['payment_number', 'vendorName', 'paymentMethod', 'reference', 'status', 'property_name']}
            emptyMessage="No payments found."
            containerClassName="rounded-lg border-0"
          />
        </SectionCard>
      )}

      {activeTab === 'matching' && (
        <SectionCard
          title="Three-Way Matching"
          subtitle="PO, GRN, and invoice reconciliation"
          icon={ShieldCheck}
          pad="none"
          bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
        >
          <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center gap-2 overflow-x-auto">
            {['All', 'Pending', 'Approved', 'Discrepancy'].map(s => (
              <button key={s} onClick={() => setMatchStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition whitespace-nowrap ${
                  matchStatusFilter === s
                    ? 'bg-[var(--color-accent-operations)] text-white'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                }`}>
                {s}
              </button>
            ))}
          </div>
          <DataTable
            columns={[
              {
                key: 'po_number',
                label: 'PO #',
                render: (m: ThreeWayMatch) => (
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 rounded-lg"><ShieldCheck size={12} /></div>
                    <span className="text-xs font-bold text-slate-900 dark:text-white">{m.po_number}</span>
                  </div>
                ),
              },
              {
                key: 'vendor_name',
                label: 'Vendor',
                render: (m: ThreeWayMatch) => <span className="text-xs font-bold text-slate-900 dark:text-white">{m.vendor_name || '—'}</span>,
              },
              {
                key: 'invoice_match',
                label: 'Invoice',
                align: 'center' as const,
                render: (m: ThreeWayMatch) => {
                  const tone: StatusTone = m.invoice_match === 'Matched' ? 'success' : m.invoice_match === 'Pending' ? 'warning' : 'danger';
                  return <div className="flex justify-center"><Badge tone={tone}>{m.invoice_match}</Badge></div>;
                },
              },
              {
                key: 'receipt_match',
                label: 'Receipt',
                align: 'center' as const,
                render: (m: ThreeWayMatch) => {
                  const tone: StatusTone = m.receipt_match === 'Matched' ? 'success' : m.receipt_match === 'Pending' ? 'warning' : 'danger';
                  return <div className="flex justify-center"><Badge tone={tone}>{m.receipt_match}</Badge></div>;
                },
              },
              {
                key: 'po_amount',
                label: 'PO Amount',
                align: 'right' as const,
                render: (m: ThreeWayMatch) => <span className="text-xs font-bold text-slate-900 dark:text-white">${fmt(m.po_amount)}</span>,
              },
              {
                key: 'invoice_amount',
                label: 'Invoice Amount',
                align: 'right' as const,
                render: (m: ThreeWayMatch) => <span className="text-xs font-bold text-slate-600 dark:text-slate-400">${fmt(m.invoice_amount)}</span>,
              },
              {
                key: 'variance_pct',
                label: 'Variance',
                align: 'right' as const,
                render: (m: ThreeWayMatch) => (
                  <span className={`text-xs font-bold ${Math.abs(m.variance_pct) < 10 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {m.variance_pct > 0 ? '+' : ''}{m.variance_pct}%
                  </span>
                ),
              },
              {
                key: 'property_name',
                label: 'Property',
                render: (m: ThreeWayMatch) => <span className="text-xs font-medium text-slate-500">{m.property_name || propertyName(m.property_id)}</span>,
              },
              {
                key: 'status',
                label: 'Status',
                align: 'center' as const,
                render: (m: ThreeWayMatch) => {
                  const tone: StatusTone = m.status === 'Approved' ? 'success' : m.status === 'Pending' ? 'warning' : 'danger';
                  return <div className="flex justify-center"><Badge tone={tone}>{m.status}</Badge></div>;
                },
              },
              {
                key: 'actions',
                label: 'Actions',
                align: 'center' as const,
                sortable: false,
                render: (m: ThreeWayMatch) => (
                  <div className="flex justify-center gap-1 relative">
                    <div className="relative">
                      <button onClick={() => setMenuOpen(menuOpen === m.id ? null : m.id)} disabled={actingOn === m.id} className={button.ghost + ' disabled:opacity-50'}>
                        {actingOn === m.id ? <Loader2 size={14} className="animate-spin" /> : <MoreVertical size={14} />}
                      </button>
                      {menuOpen === m.id && (
                        <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden">
                          {m.status !== 'Approved' && (
                            <button onClick={() => handleApproveMatch(m.id, m.po_number)} className="w-full text-left px-3 py-2 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 flex items-center gap-1.5 transition">
                              <CheckCircle2 size={14} /> Approve
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ),
              },
            ] as Column<ThreeWayMatch>[]}
            data={filteredMatches}
            rowKey={(m) => m.id}
            sortable
            filterable
            filterPlaceholder="Search matches..."
            filterKeys={['po_number', 'vendor_name', 'status', 'property_name']}
            emptyMessage="No three-way matches found."
            containerClassName="rounded-lg border-0"
          />
        </SectionCard>
      )}

      {activeTab === 'scheduling' && (
        <SectionCard
          title="Payment Scheduling"
          subtitle="Automated payment scheduling and approval"
          icon={Calendar}
          pad="none"
          bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
        >
          <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center gap-2 overflow-x-auto">
            {['All', 'Pending', 'Processed', 'Overdue', 'Cancelled'].map(s => (
              <button key={s} onClick={() => setScheduleStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition whitespace-nowrap ${
                  scheduleStatusFilter === s
                    ? 'bg-[var(--color-accent-operations)] text-white'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                }`}>
                {s}
              </button>
            ))}
          </div>
          <DataTable
            columns={[
              {
                key: 'vendor_name',
                label: 'Vendor',
                render: (s: PaymentSchedule) => (
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-amber-50 dark:bg-amber-500/10 text-amber-600 rounded-lg"><Calendar size={12} /></div>
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-slate-900 dark:text-white">{s.vendor_name || '—'}</span>
                      <span className="text-[10px] font-medium text-slate-400 font-mono">{s.bill_number || '—'}</span>
                    </div>
                  </div>
                ),
              },
              {
                key: 'scheduled_date',
                label: 'Scheduled Date',
                render: (s: PaymentSchedule) => <span className="text-xs font-medium text-slate-500">{s.scheduled_date}</span>,
              },
              {
                key: 'amount',
                label: 'Amount',
                align: 'right' as const,
                render: (s: PaymentSchedule) => <span className="text-xs font-bold text-slate-900 dark:text-white">${fmt(s.amount)}</span>,
              },
              {
                key: 'payment_method',
                label: 'Method',
                render: (s: PaymentSchedule) => <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{s.payment_method}</span>,
              },
              {
                key: 'frequency',
                label: 'Frequency',
                align: 'center' as const,
                render: (s: PaymentSchedule) => {
                  const tone: StatusTone = s.frequency === 'Monthly' ? 'success' : s.frequency === 'Weekly' ? 'info' : 'neutral';
                  return <div className="flex justify-center"><Badge tone={tone}>{s.frequency}</Badge></div>;
                },
              },
              {
                key: 'auto_pay',
                label: 'Auto-Pay',
                align: 'center' as const,
                render: (s: PaymentSchedule) => (
                  <div className="flex justify-center">
                    <Badge tone={s.auto_pay ? 'success' : 'neutral'}>{s.auto_pay ? 'Enabled' : 'Disabled'}</Badge>
                  </div>
                ),
              },
              {
                key: 'property_name',
                label: 'Property',
                render: (s: PaymentSchedule) => <span className="text-xs font-medium text-slate-500">{s.property_name || propertyName(s.property_id)}</span>,
              },
              {
                key: 'status',
                label: 'Status',
                align: 'center' as const,
                render: (s: PaymentSchedule) => {
                  const tone: StatusTone = s.status === 'Processed' ? 'success' : s.status === 'Overdue' ? 'danger' : s.status === 'Cancelled' ? 'neutral' : 'warning';
                  return <div className="flex justify-center"><Badge tone={tone}>{s.status}</Badge></div>;
                },
              },
              {
                key: 'actions',
                label: 'Actions',
                align: 'center' as const,
                sortable: false,
                render: (s: PaymentSchedule) => (
                  <div className="flex justify-center gap-1 relative">
                    <div className="relative">
                      <button onClick={() => setMenuOpen(menuOpen === s.id ? null : s.id)} disabled={actingOn === s.id} className={button.ghost + ' disabled:opacity-50'}>
                        {actingOn === s.id ? <Loader2 size={14} className="animate-spin" /> : <MoreVertical size={14} />}
                      </button>
                      {menuOpen === s.id && (
                        <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden">
                          {s.status === 'Pending' && (
                            <button onClick={() => handleUpdateScheduleStatus(s.id, 'Processed', s.vendor_name || 'schedule')} className="w-full text-left px-3 py-2 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 flex items-center gap-1.5 transition">
                              <Send size={14} /> Process Now
                            </button>
                          )}
                          {s.status !== 'Cancelled' && (
                            <button onClick={() => handleUpdateScheduleStatus(s.id, 'Cancelled', s.vendor_name || 'schedule')} className="w-full text-left px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-1.5 transition">
                              <Calendar size={14} /> Cancel
                            </button>
                          )}
                          <button onClick={() => handleDeleteSchedule(s.id, s.vendor_name || 'schedule')} className="w-full text-left px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 flex items-center gap-1.5 transition border-t border-slate-100 dark:border-slate-700">
                            <Trash2 size={14} /> Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ),
              },
            ] as Column<PaymentSchedule>[]}
            data={filteredSchedules}
            rowKey={(s) => s.id}
            sortable
            filterable
            filterPlaceholder="Search schedules..."
            filterKeys={['vendor_name', 'bill_number', 'status', 'property_name']}
            emptyMessage="No scheduled payments found."
            containerClassName="rounded-lg border-0"
          />
        </SectionCard>
      )}

      {activeTab === 'statements' && (
        <SectionCard
          title="Vendor Statements"
          subtitle="Periodic vendor account statements"
          icon={FileText}
          pad="none"
          bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
        >
          <DataTable
            columns={[
              {
                key: 'vendor', label: 'Vendor',
                render: (s: any) => (
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 rounded-lg"><Truck size={12} /></div>
                    <span className="text-xs font-bold text-slate-900 dark:text-white">{s.vendor}</span>
                  </div>
                ),
              },
              { key: 'period', label: 'Statement Period', render: (s: any) => <span className="text-xs font-medium text-slate-500">{s.period}</span> },
              { key: 'openingBalance', label: 'Opening Balance', align: 'right' as const, render: (s: any) => <span className="text-xs font-bold text-slate-600 dark:text-slate-400">${fmt(s.openingBalance)}</span> },
              { key: 'invoices', label: 'Invoices', align: 'right' as const, render: (s: any) => <span className="text-xs font-bold text-slate-900 dark:text-white">${fmt(s.invoices)}</span> },
              { key: 'payments', label: 'Payments', align: 'right' as const, render: (s: any) => <span className="text-xs font-bold text-emerald-600">${fmt(s.payments)}</span> },
              { key: 'closingBalance', label: 'Closing Balance', align: 'right' as const, render: (s: any) => <span className="text-xs font-bold text-amber-600">${fmt(s.closingBalance)}</span> },
              {
                key: 'actions', label: 'Actions', align: 'center' as const, sortable: false,
                render: (s: any) => (
                  <div className="flex justify-center gap-1">
                    <button onClick={() => setSelectedVendor(vendors.find(v => v.name === s.vendor) || null)} className={button.ghost}><Eye size={14} /></button>
                    <button onClick={() => window.print()} className={button.ghost}><Download size={14} /></button>
                  </div>
                ),
              },
            ] as Column<any>[]}
            data={[
              { id: 'st-1', vendor: 'ABC Suppliers Ltd.', period: 'Jan 2024', openingBalance: 12000, invoices: 4500, payments: 8000, closingBalance: 8500 },
              { id: 'st-2', vendor: 'Highland Contractors', period: 'Jan 2024', openingBalance: 25000, invoices: 12000, payments: 15000, closingBalance: 22000 },
              { id: 'st-3', vendor: 'Ethio Telecom', period: 'Jan 2024', openingBalance: 3500, invoices: 1800, payments: 3500, closingBalance: 1800 },
              { id: 'st-4', vendor: 'Addis Water Utility', period: 'Jan 2024', openingBalance: 2200, invoices: 1100, payments: 2200, closingBalance: 1100 },
              { id: 'st-5', vendor: 'ERCA Tax Office', period: 'Jan 2024', openingBalance: 18000, invoices: 9000, payments: 18000, closingBalance: 9000 },
            ]}
            rowKey={(s) => s.id}
            sortable
            filterable
            filterPlaceholder="Search statements..."
            filterKeys={['vendor', 'period']}
            emptyMessage="No vendor statements found."
            containerClassName="rounded-lg border-0"
          />
        </SectionCard>
      )}

      {activeTab === 'aging' && (
        <SectionCard
          title="AP Aging Analysis"
          subtitle="Outstanding payables by aging bucket"
          icon={Clock}
          pad="none"
          bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
        >
          <DataTable
            columns={[
              {
                key: 'vendor', label: 'Vendor',
                render: (a: any) => (
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-amber-50 dark:bg-amber-500/10 text-amber-600 rounded-lg"><Clock size={12} /></div>
                    <span className="text-xs font-bold text-slate-900 dark:text-white">{a.vendor}</span>
                  </div>
                ),
              },
              { key: 'b0_30', label: '0-30 Days', align: 'right' as const, render: (a: any) => <span className="text-xs font-bold text-emerald-600">${fmt(a.b0_30)}</span> },
              { key: 'b31_60', label: '31-60 Days', align: 'right' as const, render: (a: any) => <span className="text-xs font-bold text-amber-600">${fmt(a.b31_60)}</span> },
              { key: 'b61_90', label: '61-90 Days', align: 'right' as const, render: (a: any) => <span className="text-xs font-bold text-orange-600">${fmt(a.b61_90)}</span> },
              { key: 'b90plus', label: '90+ Days', align: 'right' as const, render: (a: any) => <span className="text-xs font-bold text-rose-600">${fmt(a.b90plus)}</span> },
              { key: 'total', label: 'Total', align: 'right' as const, render: (a: any) => <span className="text-xs font-black text-slate-900 dark:text-white">${fmt(a.total)}</span> },
            ] as Column<any>[]}
            data={[
              { id: 'ag-1', vendor: 'ABC Suppliers Ltd.', b0_30: 4500, b31_60: 2000, b61_90: 1000, b90plus: 1000, total: 8500 },
              { id: 'ag-2', vendor: 'Highland Contractors', b0_30: 5000, b31_60: 7000, b61_90: 5000, b90plus: 5000, total: 22000 },
              { id: 'ag-3', vendor: 'Ethio Telecom', b0_30: 1800, b31_60: 0, b61_90: 0, b90plus: 0, total: 1800 },
              { id: 'ag-4', vendor: 'Addis Water Utility', b0_30: 1100, b31_60: 0, b61_90: 0, b90plus: 0, total: 1100 },
              { id: 'ag-5', vendor: 'ERCA Tax Office', b0_30: 0, b31_60: 9000, b61_90: 0, b90plus: 0, total: 9000 },
            ]}
            rowKey={(a) => a.id}
            sortable
            filterable
            filterPlaceholder="Search aging..."
            filterKeys={['vendor']}
            emptyMessage="No aging data found."
            containerClassName="rounded-lg border-0"
          />
        </SectionCard>
      )}

      {activeTab === 'credit_notes' && (
        <SectionCard
          title="Vendor Credit Notes"
          subtitle="Credit notes issued by vendors"
          icon={ArrowDownRight}
          pad="none"
          bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
        >
          <DataTable
            columns={[
              {
                key: 'creditNoteNumber', label: 'Credit Note #',
                render: (c: any) => (
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-rose-50 dark:bg-rose-500/10 text-rose-600 rounded-lg"><ArrowDownRight size={12} /></div>
                    <span className="text-xs font-bold text-slate-900 dark:text-white">{c.creditNoteNumber}</span>
                  </div>
                ),
              },
              { key: 'vendor', label: 'Vendor', render: (c: any) => <span className="text-xs font-bold text-slate-900 dark:text-white">{c.vendor}</span> },
              { key: 'date', label: 'Date', align: 'center' as const, render: (c: any) => <span className="text-xs font-medium text-slate-500">{c.date}</span> },
              { key: 'referenceInvoice', label: 'Reference Invoice', render: (c: any) => <span className="text-xs font-medium text-slate-500 font-mono">{c.referenceInvoice}</span> },
              { key: 'amount', label: 'Amount', align: 'right' as const, render: (c: any) => <span className="text-xs font-bold text-rose-600">${fmt(c.amount)}</span> },
              {
                key: 'status', label: 'Status', align: 'center' as const,
                render: (c: any) => {
                  const tone: StatusTone = c.status === 'Applied' ? 'success' : c.status === 'Void' ? 'neutral' : 'warning';
                  return <div className="flex justify-center"><Badge tone={tone}>{c.status}</Badge></div>;
                },
              },
              {
                key: 'actions', label: 'Actions', align: 'center' as const, sortable: false,
                render: (c: any) => (
                  <div className="flex justify-center gap-1">
                    <button onClick={() => window.print()} className={button.ghost}><Eye size={14} /></button>
                    <button onClick={() => window.print()} className={button.ghost}><Download size={14} /></button>
                  </div>
                ),
              },
            ] as Column<any>[]}
            data={[
              { id: 'cn-1', creditNoteNumber: 'CN-2024-001', vendor: 'ABC Suppliers Ltd.', date: '2024-01-15', referenceInvoice: 'INV-2024-001', amount: 500, status: 'Applied' },
              { id: 'cn-2', creditNoteNumber: 'CN-2024-002', vendor: 'Highland Contractors', date: '2024-01-20', referenceInvoice: 'INV-2024-012', amount: 1200, status: 'Pending' },
              { id: 'cn-3', creditNoteNumber: 'CN-2024-003', vendor: 'Ethio Telecom', date: '2024-01-25', referenceInvoice: 'INV-2024-045', amount: 300, status: 'Applied' },
              { id: 'cn-4', creditNoteNumber: 'CN-2024-004', vendor: 'Addis Water Utility', date: '2024-01-28', referenceInvoice: 'INV-2024-067', amount: 150, status: 'Void' },
              { id: 'cn-5', creditNoteNumber: 'CN-2024-005', vendor: 'ERCA Tax Office', date: '2024-02-01', referenceInvoice: 'INV-2024-089', amount: 800, status: 'Pending' },
            ]}
            rowKey={(c) => c.id}
            sortable
            filterable
            filterPlaceholder="Search credit notes..."
            filterKeys={['creditNoteNumber', 'vendor', 'referenceInvoice', 'status']}
            emptyMessage="No credit notes found."
            containerClassName="rounded-lg border-0"
          />
        </SectionCard>
      )}
        </>
      )}

      <ModalSystem
        isOpen={!!selectedVendor}
        onClose={() => setSelectedVendor(null)}
        title={selectedVendor?.name ?? ''}
        subtitle={`Vendor ID: ${selectedVendor?.id ?? ''}`}
        variant="info"
        size="xl"
        showFooter={false}
      >
            {selectedVendor && (
              <div className="p-6 space-y-6 overflow-y-auto">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Contact Email</span>
                  <div className="flex items-center gap-2">
                    <Mail size={14} className="text-slate-400" />
                    <span className="text-xs font-bold text-slate-900 dark:text-white">{selectedVendor?.contact || '-'}</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Phone</span>
                  <div className="flex items-center gap-2">
                    <Phone size={14} className="text-slate-400" />
                    <span className="text-xs font-bold text-slate-900 dark:text-white">{selectedVendor?.phone || '-'}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Address</span>
                <div className="flex items-center gap-2">
                  <MapPin size={14} className="text-slate-400" />
                  <span className="text-xs font-bold text-slate-900 dark:text-white">{selectedVendor?.address || '-'}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Tax ID (TIN)</span>
                  <span className="text-xs font-black text-slate-900 dark:text-white font-mono">{selectedVendor?.taxId || '-'}</span>
                </div>
                <div className="space-y-2">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Withholding Rate</span>
                  <div className="flex items-center gap-2">
                    <Percent size={14} className="text-amber-600" />
                    <span className="text-xs font-black text-amber-600">{selectedVendor?.withholdingRate ?? 0}%</span>
                  </div>
                </div>
              </div>

              <div className="bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20 rounded-lg p-4">
                <div className="flex justify-between items-center">
                  <div>
                    <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest block">Outstanding Balance</span>
                    <span className="text-2xl font-bold text-indigo-600">${(selectedVendor?.balance || 0).toLocaleString()}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Category</span>
                    <span className="text-xs font-black text-slate-900 dark:text-white">{selectedVendor?.category || '-'}</span>
                  </div>
                </div>
              </div>
            </div>
            )}

            <div className="p-6 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-3 bg-slate-50/30 dark:bg-slate-700/20">
              <button 
                onClick={() => setSelectedVendor(null)}
                className={button.primary}
              >
                Close
              </button>
            </div>
      </ModalSystem>

      <ModalSystem
        isOpen={showNewVendor}
        onClose={() => setShowNewVendor(false)}
        title="New Vendor"
        subtitle="Register a new supplier"
        variant="form"
        size="xl"
        showFooter={false}
      >
            <div className="p-6 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Vendor Name *</label>
                  <input
                    type="text"
                    value={newVendorForm.name}
                    onChange={(e) => setNewVendorForm({ ...newVendorForm, name: e.target.value })}
                    className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Company name"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Contact Name</label>
                  <input
                    type="text"
                    value={newVendorForm.contactName}
                    onChange={(e) => setNewVendorForm({ ...newVendorForm, contactName: e.target.value })}
                    className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Contact person"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Email</label>
                  <input
                    type="email"
                    value={newVendorForm.email}
                    onChange={(e) => setNewVendorForm({ ...newVendorForm, email: e.target.value })}
                    className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="email@example.com"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Phone</label>
                  <input
                    type="text"
                    value={newVendorForm.phone}
                    onChange={(e) => setNewVendorForm({ ...newVendorForm, phone: e.target.value })}
                    className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="+251 911 234 567"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Address</label>
                <input
                  type="text"
                  value={newVendorForm.address}
                  onChange={(e) => setNewVendorForm({ ...newVendorForm, address: e.target.value })}
                  className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Street, City, Country"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Tax ID (TIN)</label>
                  <input
                    type="text"
                    value={newVendorForm.taxId}
                    onChange={(e) => setNewVendorForm({ ...newVendorForm, taxId: e.target.value })}
                    className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="TIN-123456789"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Withholding Rate (%)</label>
                  <input
                    type="number"
                    value={newVendorForm.withholdingRate}
                    onChange={(e) => setNewVendorForm({ ...newVendorForm, withholdingRate: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="2"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Category</label>
                <select
                  value={newVendorForm.category}
                  onChange={(e) => setNewVendorForm({ ...newVendorForm, category: e.target.value })}
                  className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="Suppliers">Suppliers</option>
                  <option value="Contractors">Contractors</option>
                  <option value="Utilities">Utilities</option>
                  <option value="Service Providers">Service Providers</option>
                  <option value="Government Agencies">Government Agencies</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>

            <div className="p-6 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-3 bg-slate-50/30 dark:bg-slate-700/20">
              <button
                onClick={() => setShowNewVendor(false)}
                className={button.secondary}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateVendor}
                className={button.primary}
              >
                Create Vendor
              </button>
            </div>
      </ModalSystem>

      <ModalSystem
        isOpen={showNewBill}
        onClose={() => setShowNewBill(false)}
        title="New Bill"
        subtitle="Record a vendor invoice"
        variant="form"
        size="xl"
        showFooter={false}
      >
            <div className="p-6 space-y-4 overflow-y-auto">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Vendor *</label>
                <select
                  value={newBillForm.vendorId}
                  onChange={(e) => setNewBillForm({ ...newBillForm, vendorId: e.target.value })}
                  className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Select vendor</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Invoice Number *</label>
                  <input
                    type="text"
                    value={newBillForm.invoiceNumber}
                    onChange={(e) => setNewBillForm({ ...newBillForm, invoiceNumber: e.target.value })}
                    className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="INV-2024-001"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Category</label>
                  <input
                    type="text"
                    value={newBillForm.category}
                    onChange={(e) => setNewBillForm({ ...newBillForm, category: e.target.value })}
                    className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Operations"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Invoice Date *</label>
                  <input
                    type="date"
                    value={newBillForm.invoiceDate}
                    onChange={(e) => setNewBillForm({ ...newBillForm, invoiceDate: e.target.value })}
                    className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Due Date *</label>
                  <input
                    type="date"
                    value={newBillForm.dueDate}
                    onChange={(e) => setNewBillForm({ ...newBillForm, dueDate: e.target.value })}
                    className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Gross Amount</label>
                  <input
                    type="number"
                    value={newBillForm.amount}
                    onChange={(e) => setNewBillForm({ ...newBillForm, amount: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">VAT Amount</label>
                  <input
                    type="number"
                    value={newBillForm.taxAmount}
                    onChange={(e) => setNewBillForm({ ...newBillForm, taxAmount: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Withholding</label>
                  <input
                    type="number"
                    value={newBillForm.withholdingAmount}
                    onChange={(e) => setNewBillForm({ ...newBillForm, withholdingAmount: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="0.00"
                  />
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-3 bg-slate-50/30 dark:bg-slate-700/20">
              <button
                onClick={() => setShowNewBill(false)}
                className={button.secondary}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateBill}
                className={button.primary}
              >
                Create Bill
              </button>
            </div>
      </ModalSystem>

      <ModalSystem
        isOpen={!!selectedBill}
        onClose={() => setSelectedBill(null)}
        title={selectedBill?.id ?? ''}
        subtitle={`Invoice: ${selectedBill?.invoiceNumber ?? ''}`}
        variant="info"
        size="xl"
        showFooter={false}
      >
            <div className="p-6 space-y-6 overflow-y-auto print-area">
              {selectedBill && (
              <>
              <div className="grid grid-cols-3 gap-6">
                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase block mb-1">Vendor</span>
                  <span className="text-xs font-bold text-slate-900 dark:text-white">{selectedBill.vendorName || '-'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase block mb-1">Invoice Date</span>
                  <span className="text-xs font-bold text-slate-900 dark:text-white">{selectedBill.invoiceDate || '-'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase block mb-1">Due Date</span>
                  <span className="text-xs font-bold text-slate-900 dark:text-white">{selectedBill.dueDate || '-'}</span>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-[10px] font-black text-slate-900 dark:text-white uppercase tracking-widest">Bill Lines</h4>
                <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50/50 dark:bg-slate-700/20">
                        <th className="px-4 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Description</th>
                        <th className="px-4 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center">Qty</th>
                        <th className="px-4 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Rate</th>
                        <th className="px-4 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {selectedBill.lines?.map((line: any, idx: number) => (
                        <tr key={idx} className="text-[10px]">
                          <td className="px-4 py-2 font-bold text-slate-900 dark:text-white">{line.description}</td>
                          <td className="px-4 py-2 text-center text-slate-500">{line.quantity}</td>
                          <td className="px-4 py-2 text-right text-slate-500 font-mono">${line.rate.toLocaleString()}</td>
                          <td className="px-4 py-2 text-right font-black text-slate-900 dark:text-white font-mono">${line.total.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-700/40 rounded-lg p-6 border border-slate-100 dark:border-slate-700">
                <div className="space-y-4">
                  <div className="flex justify-between items-center text-xs font-bold text-slate-500 uppercase">
                    <span>Gross Amount</span>
                    <span className="font-mono text-slate-900 dark:text-white">${(selectedBill.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs font-bold text-slate-500 uppercase">
                    <span>VAT (15%)</span>
                    <span className="font-mono text-slate-900 dark:text-white">${(selectedBill.taxAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs font-bold text-amber-600 uppercase">
                    <span>Withholding Tax ({selectedBill.amount ? (selectedBill.withholdingAmount / selectedBill.amount * 100).toFixed(1) : 0}%)</span>
                    <span className="font-mono">-${(selectedBill.withholdingAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="h-px bg-slate-200 dark:bg-slate-800 my-2" />
                  <div className="flex justify-between items-center font-black uppercase">
                    <span className="text-xs text-slate-900 dark:text-white">Net Payable</span>
                    <span className="text-xl text-emerald-600 font-mono">${(selectedBill.netPayable || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>
              </>
              )}
            </div>

            {selectedBill && (
            <div className="p-6 border-t border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50/30 dark:bg-slate-700/20 no-print">
              <div className="flex gap-2">
                {(selectedBill.status === 'Pending' || selectedBill.status === 'Overdue' || selectedBill.status === 'Partially Paid') && (selectedBill.amountDue || 0) > 0 && (
                  <button
                    onClick={() => handlePayBill(selectedBill)}
                    className={button.primary + ' flex items-center gap-2'}
                  >
                    <ShieldCheck size={14} /> Pay Bill
                  </button>
                )}
              </div>
              <div className="flex gap-3">
                <button 
                  onClick={() => window.print()}
                  className={button.secondary + ' flex items-center gap-2'}
                >
                  <Download size={14} /> Print
                </button>
                <button 
                  onClick={() => setSelectedBill(null)}
                  className={button.primary}
                >
                  Close
                </button>
              </div>
            </div>
            )}
      </ModalSystem>
    </div>
  );
};

export default AccountsPayable;
