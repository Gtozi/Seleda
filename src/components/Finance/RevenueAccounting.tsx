import React, { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp, DollarSign, Receipt, RefreshCw, Download, Loader2, ServerCrash,
  BedDouble, UtensilsCrossed, Sparkles, WashingMachine, Car, ShoppingBag,
  PartyPopper, Package, Calendar, Clock, CheckCircle2, Layers, Percent, Plus,
} from 'lucide-react';
import { DataTable, Column } from '../Shared/DataTable';
import { ModalSystem } from '../Shared/ModalSystem';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import StatCard from '../FrontOffice/StatCard';
import { useERP } from '../../context/ERPContext';
import {
  fetchRevenueEntries, fetchDeferredRevenue, fetchDailyPostings, fetchPackageAllocations,
  createRevenueEntry, updateRevenueEntryStatus,
  createDeferredRevenue, recognizeDeferredRevenue,
  createDailyPosting, postDailyPosting,
  createPackageAllocation, updatePackageAllocation,
  type RevenueEntry, type DeferredRevenue, type DailyPostingSummary, type PackageAllocation,
} from '../../services/revenueAccountingService';

const fmt = (n: number) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const SOURCE_META: Record<string, { label: string; icon: React.ComponentType<{ size?: number }> }> = {
  room:     { label: 'Room Revenue',      icon: BedDouble },
  f_b:      { label: 'Food & Beverage',   icon: UtensilsCrossed },
  spa:      { label: 'Spa',               icon: Sparkles },
  laundry:  { label: 'Laundry',           icon: WashingMachine },
  transport:{ label: 'Transport',         icon: Car },
  retail:   { label: 'Retail Shop',       icon: ShoppingBag },
  events:   { label: 'Events',            icon: PartyPopper },
  misc:     { label: 'Miscellaneous Income', icon: Package },
};

const RevenueAccounting = () => {
  const { currentPropertyId, properties, addNotification } = useERP();
  const [activeTab, setActiveTab] = useState<'recognition' | 'deferred' | 'daily' | 'allocation'>('recognition');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [entries, setEntries] = useState<RevenueEntry[]>([]);
  const [deferred, setDeferred] = useState<DeferredRevenue[]>([]);
  const [dailyPostings, setDailyPostings] = useState<DailyPostingSummary[]>([]);
  const [packages, setPackages] = useState<PackageAllocation[]>([]);

  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<'entry' | 'deferred' | 'daily' | 'package' | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<PackageAllocation | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [entryForm, setEntryForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    source: 'room' as RevenueEntry['source'],
    amount: 0,
    tax_amount: 0,
    service_charge: 0,
    account_code: '',
    department: '',
    description: '',
    status: 'recognized' as RevenueEntry['status'],
  });
  const [deferredForm, setDeferredForm] = useState({
    description: '',
    original_amount: 0,
    recognition_start: new Date().toISOString().slice(0, 10),
    recognition_end: '',
    recognition_schedule: 'Monthly',
  });
  const [dailyForm, setDailyForm] = useState({
    posting_date: new Date().toISOString().slice(0, 10),
    total_revenue: 0,
    total_tax: 0,
    total_service_charge: 0,
    entry_count: 1,
  });
  const [packageForm, setPackageForm] = useState({
    package_name: '',
    total_amount: 0,
    room_portion: 0,
    fb_portion: 0,
    spa_portion: 0,
    other_portion: 0,
    allocation_method: 'Fixed Percentage',
  });

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
      const [e, d, dp, pk] = await Promise.all([
        fetchRevenueEntries(pid),
        fetchDeferredRevenue(pid),
        fetchDailyPostings(pid),
        fetchPackageAllocations(pid),
      ]);
      setEntries(e);
      setDeferred(d);
      setDailyPostings(dp);
      setPackages(pk);
    } catch (err: any) {
      console.error('Error loading revenue data:', err);
      setError(err.message || 'Failed to load revenue data');
    } finally {
      setLoading(false);
    }
  };

  // ── CSV export helper ───────────────────────────────────────────────────
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

  const handleExport = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    let filename = `revenue_${activeTab}_${stamp}.csv`;
    let headers: string[] = [];
    let rows: (string | number)[][] = [];
    if (activeTab === 'recognition') {
      headers = ['ID', 'Date', 'Source', 'Department', 'Account Code', 'Amount', 'Tax', 'Service Charge', 'Net', 'Status', 'Property'];
      rows = entries.map(e => [e.id, e.date, e.source, e.department || '', e.account_code || '', e.amount, e.tax_amount, e.service_charge, e.net_amount, e.status, e.property_name || propertyName(e.property_id)]);
    } else if (activeTab === 'deferred') {
      headers = ['ID', 'Description', 'Original', 'Recognized', 'Remaining', 'Start', 'End', 'Status', 'Property'];
      rows = deferred.map(d => [d.id, d.description || '', d.original_amount, d.recognized_amount, d.remaining_amount, d.recognition_start || '', d.recognition_end || '', d.status, d.property_name || propertyName(d.property_id)]);
    } else if (activeTab === 'daily') {
      headers = ['ID', 'Posting Date', 'Gross', 'Tax', 'Service Charge', 'Net', 'Entries', 'Status', 'Posted By', 'Property'];
      rows = dailyPostings.map(d => [d.id, d.posting_date, d.total_revenue, d.total_tax, d.total_service_charge, d.total_net, d.entry_count, d.status, d.posted_by || '', d.property_name || propertyName(d.property_id)]);
    } else if (activeTab === 'allocation') {
      headers = ['ID', 'Package', 'Total', 'Room', 'F&B', 'Spa', 'Other', 'Method', 'Status', 'Property'];
      rows = packages.map(p => [p.id, p.package_name, p.total_amount, p.room_portion, p.fb_portion, p.spa_portion, p.other_portion, p.allocation_method, p.status, p.property_name || propertyName(p.property_id)]);
    }
    exportToCsv(filename, headers, rows);
  };

  const openCreateModal = (type: 'entry' | 'deferred' | 'daily' | 'package') => {
    setModalType(type);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setModalType(null);
  };

  const handleCreateEntry = async () => {
    setSubmitting(true);
    try {
      const net = entryForm.amount - entryForm.tax_amount - entryForm.service_charge;
      const created = await createRevenueEntry({ ...entryForm, net_amount: net, propertyId: currentPropertyId || undefined });
      setEntries(prev => [...prev, created]);
      addNotification('Revenue entry created.', 'success', 'Finance');
      closeModal();
    } catch (err: any) {
      addNotification(err?.message || 'Failed to create revenue entry', 'error', 'Finance');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateDeferred = async () => {
    setSubmitting(true);
    try {
      const created = await createDeferredRevenue({ ...deferredForm, remaining_amount: deferredForm.original_amount, propertyId: currentPropertyId || undefined });
      setDeferred(prev => [...prev, created]);
      addNotification('Deferred revenue schedule created.', 'success', 'Finance');
      closeModal();
    } catch (err: any) {
      addNotification(err?.message || 'Failed to create deferred revenue', 'error', 'Finance');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateDaily = async () => {
    setSubmitting(true);
    try {
      const total_net = dailyForm.total_revenue - dailyForm.total_tax - dailyForm.total_service_charge;
      const created = await createDailyPosting({ ...dailyForm, total_net, status: 'Draft', propertyId: currentPropertyId || undefined });
      setDailyPostings(prev => [...prev, created]);
      addNotification('Daily posting summary created.', 'success', 'Finance');
      closeModal();
    } catch (err: any) {
      addNotification(err?.message || 'Failed to create daily posting', 'error', 'Finance');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreatePackage = async () => {
    setSubmitting(true);
    try {
      const created = await createPackageAllocation({ ...packageForm, status: 'Active', propertyId: currentPropertyId || undefined });
      setPackages(prev => [...prev, created]);
      addNotification('Package allocation created.', 'success', 'Finance');
      closeModal();
    } catch (err: any) {
      addNotification(err?.message || 'Failed to create package allocation', 'error', 'Finance');
    } finally {
      setSubmitting(false);
    }
  };

  const openEditPackage = (p: PackageAllocation) => {
    setSelectedPackage(p);
    setPackageForm({
      package_name: p.package_name,
      total_amount: p.total_amount,
      room_portion: p.room_portion,
      fb_portion: p.fb_portion,
      spa_portion: p.spa_portion,
      other_portion: p.other_portion,
      allocation_method: p.allocation_method,
    });
    setShowEditModal(true);
  };

  const closeEditModal = () => {
    setShowEditModal(false);
    setSelectedPackage(null);
  };

  const handleUpdatePackage = async () => {
    if (!selectedPackage) return;
    setSubmitting(true);
    try {
      const updated = await updatePackageAllocation(selectedPackage.id, { ...packageForm });
      setPackages(prev => prev.map(p => (p.id === updated.id ? updated : p)));
      addNotification('Package allocation updated.', 'success', 'Finance');
      closeEditModal();
    } catch (err: any) {
      addNotification(err?.message || 'Failed to update package allocation', 'error', 'Finance');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => { loadData(); }, [currentPropertyId]);

  // ── Derived KPIs ────────────────────────────────────────────────────────
  const totalRevenue = entries.reduce((s, e) => s + e.net_amount, 0);
  const totalTax = entries.reduce((s, e) => s + e.tax_amount, 0);
  const totalServiceCharge = entries.reduce((s, e) => s + e.service_charge, 0);
  const recognizedCount = entries.filter(e => e.status === 'recognized').length;
  const deferredCount = entries.filter(e => e.status === 'deferred').length;
  const accruedCount = entries.filter(e => e.status === 'accrued').length;

  const totalOriginalDeferred = deferred.reduce((s, d) => s + d.original_amount, 0);
  const totalRecognizedDeferred = deferred.reduce((s, d) => s + d.recognized_amount, 0);
  const totalRemainingDeferred = deferred.reduce((s, d) => s + d.remaining_amount, 0);

  const totalPostedRevenue = dailyPostings.filter(d => d.status === 'Posted').reduce((s, d) => s + d.total_net, 0);
  const draftCount = dailyPostings.filter(d => d.status === 'Draft').length;
  const postedCount = dailyPostings.filter(d => d.status === 'Posted').length;

  const totalPackageAmount = packages.reduce((s, p) => s + p.total_amount, 0);
  const activePackages = packages.filter(p => p.status === 'Active').length;

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Revenue Accounting"
        subtitle="Revenue recognition, deferred revenue, daily posting, and package allocation."
        icon={Receipt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={loadData} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={handleExport} className={button.primary}>
              <Download className="w-4 h-4" /> Export
            </button>
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
            <span>Loading revenue data...</span>
          </div>
        </div>
      ) : (
        <>
          {/* KPIs — per active tab */}
          {activeTab === 'recognition' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Total Net Revenue" value={fmt(totalRevenue)} icon={DollarSign} tone="success" />
              <StatCard title="Total Tax" value={fmt(totalTax)} icon={Receipt} tone="info" />
              <StatCard title="Service Charge" value={fmt(totalServiceCharge)} icon={Percent} tone="accent" />
              <StatCard title="Entries" value={entries.length} icon={Layers} tone="neutral" />
            </div>
          )}
          {activeTab === 'deferred' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Original Amount" value={fmt(totalOriginalDeferred)} icon={DollarSign} tone="info" />
              <StatCard title="Recognized" value={fmt(totalRecognizedDeferred)} icon={CheckCircle2} tone="success" />
              <StatCard title="Remaining" value={fmt(totalRemainingDeferred)} icon={Clock} tone="warning" />
              <StatCard title="Active Schedules" value={deferred.filter(d => d.status === 'Active').length} icon={Calendar} tone="accent" />
            </div>
          )}
          {activeTab === 'daily' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Posted Revenue" value={fmt(totalPostedRevenue)} icon={TrendingUp} tone="success" />
              <StatCard title="Posted Days" value={postedCount} icon={CheckCircle2} tone="info" />
              <StatCard title="Draft Days" value={draftCount} icon={Clock} tone="warning" />
              <StatCard title="Total Entries" value={dailyPostings.reduce((s, d) => s + d.entry_count, 0)} icon={Layers} tone="neutral" />
            </div>
          )}
          {activeTab === 'allocation' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Total Package Value" value={fmt(totalPackageAmount)} icon={Package} tone="accent" />
              <StatCard title="Active Packages" value={activePackages} icon={CheckCircle2} tone="success" />
              <StatCard title="Inactive Packages" value={packages.filter(p => p.status === 'Inactive').length} icon={Clock} tone="neutral" />
              <StatCard title="Total Packages" value={packages.length} icon={Layers} tone="info" />
            </div>
          )}

          {/* Sub-tab nav */}
          <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap">
            {([
              ['recognition', 'Revenue Recognition'],
              ['deferred', 'Deferred Revenue'],
              ['daily', 'Daily Posting'],
              ['allocation', 'Package Allocation'],
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

          {/* ── Revenue Recognition ── */}
          {activeTab === 'recognition' && (
            <SectionCard
              title="Revenue Entries"
              subtitle="Recognized, deferred, and accrued revenue by source"
              icon={Receipt}
              pad="none"
              bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
              actions={
                <button onClick={() => openCreateModal('entry')}
                  className={button.primary}>
                  <Plus className="w-4 h-4" /> New Recognition Entry
                </button>
              }
            >
              <DataTable
                columns={[
                  { key: 'date', label: 'Date', render: (e: RevenueEntry) => (
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-slate-100 dark:bg-slate-700 text-slate-500 rounded-lg"><Calendar size={12} /></div>
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{e.date}</span>
                    </div>
                  ) },
                  { key: 'source', label: 'Source', render: (e: RevenueEntry) => {
                    const meta = SOURCE_META[e.source];
                    const Icon = meta?.icon || Package;
                    return (
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 rounded-lg"><Icon size={12} /></div>
                        <span className="text-xs font-bold text-slate-900 dark:text-white">{meta?.label || e.source}</span>
                      </div>
                    );
                  } },
                  { key: 'department', label: 'Department', render: (e: RevenueEntry) => <span className="text-xs font-medium text-slate-500">{e.department || '—'}</span> },
                  { key: 'account_code', label: 'Account', render: (e: RevenueEntry) => <span className="text-[10px] font-mono text-slate-400">{e.account_code || '—'}</span> },
                  { key: 'amount', label: 'Gross', align: 'right' as const, render: (e: RevenueEntry) => <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{fmt(e.amount)}</span> },
                  { key: 'tax_amount', label: 'Tax', align: 'right' as const, render: (e: RevenueEntry) => <span className="text-xs font-medium text-slate-500">{fmt(e.tax_amount)}</span> },
                  { key: 'service_charge', label: 'Service', align: 'right' as const, render: (e: RevenueEntry) => <span className="text-xs font-medium text-slate-500">{fmt(e.service_charge)}</span> },
                  { key: 'net_amount', label: 'Net', align: 'right' as const, render: (e: RevenueEntry) => <span className="text-xs font-bold text-emerald-600">{fmt(e.net_amount)}</span> },
                  { key: 'status', label: 'Status', align: 'center' as const, render: (e: RevenueEntry) => {
                    const tone: StatusTone = e.status === 'recognized' ? 'success' : e.status === 'deferred' ? 'info' : 'warning';
                    return <div className="flex justify-center"><Badge tone={tone}>{e.status}</Badge></div>;
                  } },
                  { key: 'property_name', label: 'Property', render: (e: RevenueEntry) => <span className="text-xs font-medium text-slate-500">{e.property_name || propertyName(e.property_id)}</span> },
                  { key: 'actions', label: 'Actions', align: 'center' as const, sortable: false, render: (e: RevenueEntry) => (
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={async () => {
                          try {
                            await updateRevenueEntryStatus(e.id, 'recognized');
                            addNotification(`Revenue entry ${e.id} marked as recognized.`, 'success', 'Finance');
                            await loadData();
                          } catch (err: any) { addNotification(err?.message || 'Failed to update entry', 'warning', 'Finance'); }
                        }}
                        className={button.ghost + ' text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-xs px-2 py-1'}
                        disabled={e.status === 'recognized'}
                      >
                        Recognize
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            await updateRevenueEntryStatus(e.id, 'deferred');
                            addNotification(`Revenue entry ${e.id} deferred.`, 'info', 'Finance');
                            await loadData();
                          } catch (err: any) { addNotification(err?.message || 'Failed to update entry', 'warning', 'Finance'); }
                        }}
                        className={button.ghost + ' text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-xs px-2 py-1'}
                        disabled={e.status === 'deferred'}
                      >
                        Defer
                      </button>
                    </div>
                  ) },
                ] as Column<RevenueEntry>[]}
                data={entries}
                rowKey={(e) => e.id}
                sortable
                filterable
                filterPlaceholder="Search entries..."
                filterKeys={['date', 'source', 'department', 'status', 'account_code', 'property_name']}
                emptyMessage="No revenue entries found."
                containerClassName="rounded-lg border-0"
              />
            </SectionCard>
          )}

          {/* ── Deferred Revenue ── */}
          {activeTab === 'deferred' && (
            <SectionCard
              title="Deferred Revenue Schedules"
              subtitle="Recognition schedules for prepaid and deferred revenue"
              icon={Clock}
              pad="none"
              bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
              actions={
                <button onClick={() => openCreateModal('deferred')}
                  className={button.primary}>
                  <Plus className="w-4 h-4" /> New Deferred Revenue
                </button>
              }
            >
              <DataTable
                columns={[
                  { key: 'description', label: 'Description', render: (d: DeferredRevenue) => (
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-blue-50 dark:bg-blue-500/10 text-blue-600 rounded-lg"><Clock size={12} /></div>
                      <span className="text-xs font-bold text-slate-900 dark:text-white">{d.description || '—'}</span>
                    </div>
                  ) },
                  { key: 'original_amount', label: 'Original', align: 'right' as const, render: (d: DeferredRevenue) => <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{fmt(d.original_amount)}</span> },
                  { key: 'recognized_amount', label: 'Recognized', align: 'right' as const, render: (d: DeferredRevenue) => <span className="text-xs font-bold text-emerald-600">{fmt(d.recognized_amount)}</span> },
                  { key: 'remaining_amount', label: 'Remaining', align: 'right' as const, render: (d: DeferredRevenue) => <span className="text-xs font-bold text-blue-600">{fmt(d.remaining_amount)}</span> },
                  { key: 'recognition_start', label: 'Start', render: (d: DeferredRevenue) => <span className="text-xs font-medium text-slate-500">{d.recognition_start || '—'}</span> },
                  { key: 'recognition_end', label: 'End', render: (d: DeferredRevenue) => <span className="text-xs font-medium text-slate-500">{d.recognition_end || '—'}</span> },
                  { key: 'progress', label: 'Progress', align: 'center' as const, sortable: false, render: (d: DeferredRevenue) => {
                    const pct = d.original_amount > 0 ? (d.recognized_amount / d.original_amount) * 100 : 0;
                    return (
                      <div className="flex items-center gap-2 min-w-[100px]">
                        <div className="flex-1 bg-slate-200 dark:bg-slate-700 rounded-full h-1.5">
                          <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[10px] font-bold text-slate-500">{pct.toFixed(0)}%</span>
                      </div>
                    );
                  } },
                  { key: 'status', label: 'Status', align: 'center' as const, render: (d: DeferredRevenue) => {
                    const tone: StatusTone = d.status === 'Active' ? 'info' : d.status === 'Fully Recognized' ? 'success' : 'neutral';
                    return <div className="flex justify-center"><Badge tone={tone}>{d.status}</Badge></div>;
                  } },
                  { key: 'property_name', label: 'Property', render: (d: DeferredRevenue) => <span className="text-xs font-medium text-slate-500">{d.property_name || propertyName(d.property_id)}</span> },
                  { key: 'actions', label: 'Actions', align: 'center' as const, sortable: false, render: (d: DeferredRevenue) => (
                    <div className="flex items-center justify-center">
                      <button
                        onClick={async () => {
                          try {
                            const periodAmount = d.original_amount > 0 ? Math.round(d.original_amount / 12) : 0;
                            await recognizeDeferredRevenue(d.id, periodAmount || d.remaining_amount);
                            addNotification(`Deferred revenue ${d.id}: recognition posted for current period.`, 'success', 'Finance');
                            await loadData();
                          } catch (err: any) { addNotification(err?.message || 'Failed to post recognition', 'warning', 'Finance'); }
                        }}
                        className={button.ghost + ' text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-xs px-2 py-1'}
                        disabled={d.status === 'Fully Recognized'}
                      >
                        Recognize
                      </button>
                    </div>
                  ) },
                ] as Column<DeferredRevenue>[]}
                data={deferred}
                rowKey={(d) => d.id}
                sortable
                filterable
                filterPlaceholder="Search deferred revenue..."
                filterKeys={['description', 'status', 'property_name']}
                emptyMessage="No deferred revenue schedules found."
                containerClassName="rounded-lg border-0"
              />
            </SectionCard>
          )}

          {/* ── Daily Posting ── */}
          {activeTab === 'daily' && (
            <SectionCard
              title="Daily Posting Summaries"
              subtitle="Automated daily revenue posting records"
              icon={Calendar}
              pad="none"
              bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
              actions={
                <button onClick={() => openCreateModal('daily')}
                  className={button.primary}>
                  <Plus className="w-4 h-4" /> New Daily Posting
                </button>
              }
            >
              <DataTable
                columns={[
                  { key: 'posting_date', label: 'Date', render: (d: DailyPostingSummary) => (
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 rounded-lg"><Calendar size={12} /></div>
                      <span className="text-xs font-bold text-slate-900 dark:text-white">{d.posting_date}</span>
                    </div>
                  ) },
                  { key: 'total_revenue', label: 'Gross', align: 'right' as const, render: (d: DailyPostingSummary) => <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{fmt(d.total_revenue)}</span> },
                  { key: 'total_tax', label: 'Tax', align: 'right' as const, render: (d: DailyPostingSummary) => <span className="text-xs font-medium text-slate-500">{fmt(d.total_tax)}</span> },
                  { key: 'total_service_charge', label: 'Service', align: 'right' as const, render: (d: DailyPostingSummary) => <span className="text-xs font-medium text-slate-500">{fmt(d.total_service_charge)}</span> },
                  { key: 'total_net', label: 'Net', align: 'right' as const, render: (d: DailyPostingSummary) => <span className="text-xs font-bold text-emerald-600">{fmt(d.total_net)}</span> },
                  { key: 'entry_count', label: 'Entries', align: 'right' as const, render: (d: DailyPostingSummary) => <span className="text-xs font-medium text-slate-500">{d.entry_count}</span> },
                  { key: 'posted_by', label: 'Posted By', render: (d: DailyPostingSummary) => <span className="text-xs font-medium text-slate-500">{d.posted_by || '—'}</span> },
                  { key: 'status', label: 'Status', align: 'center' as const, render: (d: DailyPostingSummary) => {
                    const tone: StatusTone = d.status === 'Posted' ? 'success' : d.status === 'Draft' ? 'warning' : 'danger';
                    return <div className="flex justify-center"><Badge tone={tone}>{d.status}</Badge></div>;
                  } },
                  { key: 'property_name', label: 'Property', render: (d: DailyPostingSummary) => <span className="text-xs font-medium text-slate-500">{d.property_name || propertyName(d.property_id)}</span> },
                  { key: 'actions', label: 'Actions', align: 'center' as const, sortable: false, render: (d: DailyPostingSummary) => (
                    <div className="flex items-center justify-center">
                      <button
                        onClick={async () => {
                          try {
                            await postDailyPosting(d.id);
                            addNotification(`Daily posting for ${d.posting_date} posted successfully.`, 'success', 'Finance');
                            await loadData();
                          } catch (err: any) { addNotification(err?.message || 'Failed to post', 'warning', 'Finance'); }
                        }}
                        className={button.ghost + ' text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-xs px-2 py-1'}
                        disabled={d.status === 'Posted'}
                      >
                        Post
                      </button>
                    </div>
                  ) },
                ] as Column<DailyPostingSummary>[]}
                data={dailyPostings}
                rowKey={(d) => d.id}
                sortable
                filterable
                filterPlaceholder="Search daily postings..."
                filterKeys={['posting_date', 'status', 'posted_by', 'property_name']}
                emptyMessage="No daily posting summaries found."
                containerClassName="rounded-lg border-0"
              />
            </SectionCard>
          )}

          {/* ── Package Allocation ── */}
          {activeTab === 'allocation' && (
            <SectionCard
              title="Package Allocations"
              subtitle="Revenue allocation rules for package rates"
              icon={Package}
              pad="none"
              bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
              actions={
                <button onClick={() => openCreateModal('package')}
                  className={button.primary}>
                  <Plus className="w-4 h-4" /> New Package Allocation
                </button>
              }
            >
              <DataTable
                columns={[
                  { key: 'package_name', label: 'Package', render: (p: PackageAllocation) => (
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 rounded-lg"><Package size={12} /></div>
                      <span className="text-xs font-bold text-slate-900 dark:text-white">{p.package_name}</span>
                    </div>
                  ) },
                  { key: 'total_amount', label: 'Total', align: 'right' as const, render: (p: PackageAllocation) => <span className="text-xs font-bold text-slate-900 dark:text-white">{fmt(p.total_amount)}</span> },
                  { key: 'room_portion', label: 'Room', align: 'right' as const, render: (p: PackageAllocation) => <span className="text-xs font-medium text-indigo-600">{fmt(p.room_portion)}</span> },
                  { key: 'fb_portion', label: 'F&B', align: 'right' as const, render: (p: PackageAllocation) => <span className="text-xs font-medium text-amber-600">{fmt(p.fb_portion)}</span> },
                  { key: 'spa_portion', label: 'Spa', align: 'right' as const, render: (p: PackageAllocation) => <span className="text-xs font-medium text-pink-600">{fmt(p.spa_portion)}</span> },
                  { key: 'other_portion', label: 'Other', align: 'right' as const, render: (p: PackageAllocation) => <span className="text-xs font-medium text-slate-500">{fmt(p.other_portion)}</span> },
                  { key: 'allocation_method', label: 'Method', align: 'center' as const, render: (p: PackageAllocation) => <span className="text-[10px] font-medium text-slate-500">{p.allocation_method}</span> },
                  { key: 'status', label: 'Status', align: 'center' as const, render: (p: PackageAllocation) => {
                    const tone: StatusTone = p.status === 'Active' ? 'success' : 'neutral';
                    return <div className="flex justify-center"><Badge tone={tone}>{p.status}</Badge></div>;
                  } },
                  { key: 'property_name', label: 'Property', render: (p: PackageAllocation) => <span className="text-xs font-medium text-slate-500">{p.property_name || propertyName(p.property_id)}</span> },
                  { key: 'actions', label: 'Actions', align: 'center' as const, sortable: false, render: (p: PackageAllocation) => (
                    <div className="flex items-center justify-center">
                      <button
                        onClick={() => openEditPackage(p)}
                        className={button.ghost + ' text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 text-xs px-2 py-1'}
                      >
                        Edit Allocation
                      </button>
                    </div>
                  ) },
                ] as Column<PackageAllocation>[]}
                data={packages}
                rowKey={(p) => p.id}
                sortable
                filterable
                filterPlaceholder="Search packages..."
                filterKeys={['package_name', 'status', 'allocation_method', 'property_name']}
                emptyMessage="No package allocations found."
                containerClassName="rounded-lg border-0"
              />
            </SectionCard>
          )}
        </>
      )}

      <ModalSystem
        isOpen={showModal}
        onClose={closeModal}
        title={
          modalType === 'entry' ? 'New Revenue Recognition Entry' :
          modalType === 'deferred' ? 'New Deferred Revenue Schedule' :
          modalType === 'daily' ? 'New Daily Posting Summary' :
          modalType === 'package' ? 'New Package Allocation' : 'Create'
        }
        subtitle="Fill the required fields and save to persist."
        variant="form"
        size="lg"
        showFooter={false}
      >
        <div className="p-6 space-y-4">
          {modalType === 'entry' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Date</label>
                  <input type="date" value={entryForm.date} onChange={e => setEntryForm(f => ({ ...f, date: e.target.value }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Source</label>
                  <select value={entryForm.source} onChange={e => setEntryForm(f => ({ ...f, source: e.target.value as RevenueEntry['source'] }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs">
                    {Object.keys(SOURCE_META).map(s => <option key={s} value={s}>{SOURCE_META[s].label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Amount</label>
                  <input type="number" value={entryForm.amount} onChange={e => setEntryForm(f => ({ ...f, amount: Number(e.target.value) }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Tax</label>
                  <input type="number" value={entryForm.tax_amount} onChange={e => setEntryForm(f => ({ ...f, tax_amount: Number(e.target.value) }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Service Charge</label>
                  <input type="number" value={entryForm.service_charge} onChange={e => setEntryForm(f => ({ ...f, service_charge: Number(e.target.value) }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Status</label>
                  <select value={entryForm.status} onChange={e => setEntryForm(f => ({ ...f, status: e.target.value as RevenueEntry['status'] }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs">
                    <option value="recognized">recognized</option>
                    <option value="deferred">deferred</option>
                    <option value="accrued">accrued</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Account Code</label>
                  <input type="text" value={entryForm.account_code} onChange={e => setEntryForm(f => ({ ...f, account_code: e.target.value }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Department</label>
                  <input type="text" value={entryForm.department} onChange={e => setEntryForm(f => ({ ...f, department: e.target.value }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Description</label>
                <input type="text" value={entryForm.description} onChange={e => setEntryForm(f => ({ ...f, description: e.target.value }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs" />
              </div>
            </>
          )}

          {modalType === 'deferred' && (
            <>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Description</label>
                <input type="text" value={deferredForm.description} onChange={e => setDeferredForm(f => ({ ...f, description: e.target.value }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Original Amount</label>
                  <input type="number" value={deferredForm.original_amount} onChange={e => setDeferredForm(f => ({ ...f, original_amount: Number(e.target.value) }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Recognition Schedule</label>
                  <select value={deferredForm.recognition_schedule} onChange={e => setDeferredForm(f => ({ ...f, recognition_schedule: e.target.value }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs">
                    <option value="Monthly">Monthly</option>
                    <option value="Quarterly">Quarterly</option>
                    <option value="Annually">Annually</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Start Date</label>
                  <input type="date" value={deferredForm.recognition_start} onChange={e => setDeferredForm(f => ({ ...f, recognition_start: e.target.value }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">End Date</label>
                  <input type="date" value={deferredForm.recognition_end} onChange={e => setDeferredForm(f => ({ ...f, recognition_end: e.target.value }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs" />
                </div>
              </div>
            </>
          )}

          {modalType === 'daily' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Posting Date</label>
                  <input type="date" value={dailyForm.posting_date} onChange={e => setDailyForm(f => ({ ...f, posting_date: e.target.value }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Entry Count</label>
                  <input type="number" value={dailyForm.entry_count} onChange={e => setDailyForm(f => ({ ...f, entry_count: Number(e.target.value) }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Total Revenue</label>
                  <input type="number" value={dailyForm.total_revenue} onChange={e => setDailyForm(f => ({ ...f, total_revenue: Number(e.target.value) }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Total Tax</label>
                  <input type="number" value={dailyForm.total_tax} onChange={e => setDailyForm(f => ({ ...f, total_tax: Number(e.target.value) }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Total Service Charge</label>
                  <input type="number" value={dailyForm.total_service_charge} onChange={e => setDailyForm(f => ({ ...f, total_service_charge: Number(e.target.value) }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs" />
                </div>
              </div>
            </>
          )}

          {modalType === 'package' && (
            <>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Package Name</label>
                <input type="text" value={packageForm.package_name} onChange={e => setPackageForm(f => ({ ...f, package_name: e.target.value }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Total Amount</label>
                  <input type="number" value={packageForm.total_amount} onChange={e => setPackageForm(f => ({ ...f, total_amount: Number(e.target.value) }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Allocation Method</label>
                  <select value={packageForm.allocation_method} onChange={e => setPackageForm(f => ({ ...f, allocation_method: e.target.value }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs">
                    <option value="Fixed Percentage">Fixed Percentage</option>
                    <option value="Nightly Allocation">Nightly Allocation</option>
                    <option value="Manual">Manual</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Room Portion</label>
                  <input type="number" value={packageForm.room_portion} onChange={e => setPackageForm(f => ({ ...f, room_portion: Number(e.target.value) }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">F&B Portion</label>
                  <input type="number" value={packageForm.fb_portion} onChange={e => setPackageForm(f => ({ ...f, fb_portion: Number(e.target.value) }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Spa Portion</label>
                  <input type="number" value={packageForm.spa_portion} onChange={e => setPackageForm(f => ({ ...f, spa_portion: Number(e.target.value) }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Other Portion</label>
                  <input type="number" value={packageForm.other_portion} onChange={e => setPackageForm(f => ({ ...f, other_portion: Number(e.target.value) }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs" />
                </div>
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <button onClick={closeModal} className={button.ghost + ' text-xs uppercase font-black'}>Cancel</button>
            <button
              onClick={
                modalType === 'entry' ? handleCreateEntry :
                modalType === 'deferred' ? handleCreateDeferred :
                modalType === 'daily' ? handleCreateDaily :
                handleCreatePackage
              }
              disabled={submitting}
              className={button.primary + ' text-xs uppercase font-black'}
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
            </button>
          </div>
        </div>
      </ModalSystem>

      <ModalSystem
        isOpen={showEditModal}
        onClose={closeEditModal}
        title="Edit Package Allocation"
        subtitle={selectedPackage ? selectedPackage.package_name : ''}
        variant="form"
        size="lg"
        showFooter={false}
      >
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Package Name</label>
            <input type="text" value={packageForm.package_name} onChange={e => setPackageForm(f => ({ ...f, package_name: e.target.value }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Total Amount</label>
              <input type="number" value={packageForm.total_amount} onChange={e => setPackageForm(f => ({ ...f, total_amount: Number(e.target.value) }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs" />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Allocation Method</label>
              <select value={packageForm.allocation_method} onChange={e => setPackageForm(f => ({ ...f, allocation_method: e.target.value }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs">
                <option value="Fixed Percentage">Fixed Percentage</option>
                <option value="Nightly Allocation">Nightly Allocation</option>
                <option value="Manual">Manual</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Room Portion</label>
              <input type="number" value={packageForm.room_portion} onChange={e => setPackageForm(f => ({ ...f, room_portion: Number(e.target.value) }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs" />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">F&B Portion</label>
              <input type="number" value={packageForm.fb_portion} onChange={e => setPackageForm(f => ({ ...f, fb_portion: Number(e.target.value) }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs" />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Spa Portion</label>
              <input type="number" value={packageForm.spa_portion} onChange={e => setPackageForm(f => ({ ...f, spa_portion: Number(e.target.value) }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs" />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Other Portion</label>
              <input type="number" value={packageForm.other_portion} onChange={e => setPackageForm(f => ({ ...f, other_portion: Number(e.target.value) }))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <button onClick={closeEditModal} className={button.ghost + ' text-xs uppercase font-black'}>Cancel</button>
            <button onClick={handleUpdatePackage} disabled={submitting} className={button.primary + ' text-xs uppercase font-black'}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Update'}
            </button>
          </div>
        </div>
      </ModalSystem>
    </div>
  );
};

export default RevenueAccounting;
