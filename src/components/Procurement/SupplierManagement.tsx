/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Supplier Management — Supply Chain & Procurement Portal (/erp/procurement/suppliers).
 * Supplier directory, onboarding, qualification, performance, and risk management.
 *
 * DB-integrated: fetches and persists via /api/proc-portal/suppliers.
 * UI follows the Engineering portal design language.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Users,
  Plus,
  Search,
  RefreshCw,
  MoreVertical,
  Loader2,
  Star,
  AlertTriangle,
  CheckCircle2,
  Shield,
  FileText,
  ArrowRight,
  Clock,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchSuppliers,
  createSupplier,
  updateSupplier,
  fetchSupplierPerformance,
  fetchSupplierRisk,
  type Supplier,
  type SupplierStatus,
  type SupplierType,
  type RiskLevel,
} from '../../services/procurementService';

const STATUS_TONE: Record<SupplierStatus, typeof statusTone[keyof typeof statusTone]> = {
  Application: 'neutral',
  'Under Review': 'info',
  'Pending Approval': 'warning',
  Active: 'success',
  Preferred: 'accent',
  Restricted: 'warning',
  Suspended: 'danger',
  Disqualified: 'danger',
  Inactive: 'neutral',
};

// Spec section 24: Supplier status flow
const STATUS_FLOW: SupplierStatus[] = [
  'Application', 'Under Review', 'Pending Approval', 'Active', 'Preferred',
];
const ALT_STATUSES: SupplierStatus[] = ['Restricted', 'Suspended', 'Disqualified', 'Inactive'];

// Spec section 23: All 12 supplier categories (departments)
const SUPPLIER_CATEGORIES = [
  'Food & Beverage', 'Kitchen', 'Housekeeping', 'Engineering & Maintenance',
  'Spa & Wellness', 'Banquet & Events', 'Transportation & Fleet',
  'Human Resources', 'Administration', 'Security & Risk', 'IT', 'Other',
];

const RISK_TONE: Record<RiskLevel, typeof statusTone[keyof typeof statusTone]> = {
  Low: 'success',
  Medium: 'warning',
  High: 'danger',
  Critical: 'danger',
};

const SupplierManagement: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<'All' | SupplierStatus>('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [search, setSearch] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    supplierCode: '',
    legalName: '',
    tradingName: '',
    supplierType: 'Local' as SupplierType,
    supplierCategory: 'Food & Beverage',
    address: '',
    city: '',
    phone: '',
    email: '',
    website: '',
    // Compliance (spec section 23)
    taxRegistration: '',
    businessLicense: '',
    insurance: '',
    // Commercial (spec section 23)
    currency: 'ETB',
    paymentTerms: 30,
    deliveryTerms: '',
    leadTime: 7,
    minimumOrderQuantity: 0,
    contacts: [{ name: '', email: '', phone: '', role: '' }],
  });

  const [viewingId, setViewingId] = useState<string | null>(null);
  const [viewingTab, setViewingTab] = useState<'profile' | 'performance' | 'risk'>('profile');
  const [performanceData, setPerformanceData] = useState<any>(null);
  const [riskData, setRiskData] = useState<any>(null);

  const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSuppliers({
        status: statusFilter === 'All' ? undefined : statusFilter,
        category: categoryFilter === 'All' ? undefined : categoryFilter,
        propertyId: currentPropertyId || undefined,
      });
      setSuppliers(data.suppliers);
    } catch (e: any) {
      setError(e?.message || 'Failed to load suppliers');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, statusFilter, categoryFilter]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(
    () =>
      suppliers.filter((s) => {
        const q = search.trim().toLowerCase();
        return (
          !q ||
          s.legal_name.toLowerCase().includes(q) ||
          s.supplier_code.toLowerCase().includes(q) ||
          s.city?.toLowerCase().includes(q)
        );
      }),
    [suppliers, search]
  );

  const counts = {
    active: suppliers.filter((s) => s.status === 'Active').length,
    preferred: suppliers.filter((s) => s.status === 'Preferred').length,
    pending: suppliers.filter((s) => s.status === 'Application' || s.status === 'Under Review' || s.status === 'Pending Approval').length,
    highRisk: suppliers.filter((s) => s.risk_level === 'High' || s.risk_level === 'Critical').length,
  };

  const submitCreate = async () => {
    if (!form.supplierCode || !form.legalName || !form.supplierType || !form.supplierCategory) {
      addNotification('Please fill in all required fields', 'warning', 'Procurement');
      return;
    }
    setSubmitting(true);
    try {
      const created = await createSupplier({
        supplierCode: form.supplierCode,
        legalName: form.legalName,
        tradingName: form.tradingName,
        supplierType: form.supplierType,
        supplierCategory: form.supplierCategory,
        address: form.address,
        city: form.city,
        phone: form.phone,
        email: form.email,
        website: form.website,
        taxRegistration: form.taxRegistration,
        businessLicense: form.businessLicense,
        insurance: form.insurance,
        currency: form.currency,
        paymentTerms: form.paymentTerms,
        deliveryTerms: form.deliveryTerms,
        leadTime: form.leadTime,
        minimumOrderQuantity: form.minimumOrderQuantity,
        propertyId: currentPropertyId || undefined,
        contacts: form.contacts,
      });
      setSuppliers((prev) => [created.supplier, ...prev]);
      addNotification(`Supplier ${created.supplier.legal_name} added`, 'task', 'Procurement');
      setShowForm(false);
      setForm({
        supplierCode: '', legalName: '', tradingName: '', supplierType: 'Local',
        supplierCategory: 'Food & Beverage', address: '', city: '', phone: '', email: '', website: '',
        taxRegistration: '', businessLicense: '', insurance: '',
        currency: 'ETB', paymentTerms: 30, deliveryTerms: '', leadTime: 7, minimumOrderQuantity: 0,
        contacts: [{ name: '', email: '', phone: '', role: '' }],
      });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to add supplier', 'warning', 'Procurement');
    } finally {
      setSubmitting(false);
    }
  };

  const updateStatus = async (id: string, status: SupplierStatus) => {
    setActingOn(id);
    try {
      const { supplier } = await updateSupplier(id, { status });
      setSuppliers((prev) => prev.map((s) => (s.id === id ? supplier : s)));
      addNotification(`Supplier ${id} → ${status}.`, 'task', 'Procurement');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update supplier', 'warning', 'Procurement');
    } finally {
      setActingOn(null);
    }
  };

  const loadSupplierDetails = async (id: string) => {
    try {
      const [perf, risk] = await Promise.all([
        fetchSupplierPerformance(id),
        fetchSupplierRisk(id),
      ]);
      setPerformanceData(perf.performance);
      setRiskData(risk.risks);
    } catch (e: any) {
      addNotification('Failed to load supplier details', 'warning', 'Procurement');
    }
  };

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Suppliers"
        subtitle="Supplier directory, onboarding, qualification, performance, and risk management."
        icon={Users}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={() => setShowForm(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> Add Supplier
            </button>
          </div>
        }
      />

      {error && (
        <SectionCard tone="danger" pad="md">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </SectionCard>
      )}

      <div className={layout.kpiGrid}>
        <StatCard title="Active" value={counts.active} icon={CheckCircle2} tone="success" />
        <StatCard title="Preferred" value={counts.preferred} icon={Star} tone="accent" />
        <StatCard title="Pending Review" value={counts.pending} icon={Clock} tone="warning" />
        <StatCard title="High Risk" value={counts.highRisk} icon={AlertTriangle} tone="danger" />
      </div>

      {/* Status Flow (spec section 24) */}
      <SectionCard title="Supplier Status Lifecycle" subtitle="Per specification section 24" icon={ArrowRight} pad="md">
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

      <SectionCard pad="md">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input className={inputClass + ' pl-10'} placeholder="Search suppliers..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className={inputClass + ' max-w-[150px]'} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
            <option value="All">All Status</option>
            {Object.keys(STATUS_TONE).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className={inputClass + ' max-w-[150px]'} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="All">All Categories</option>
            {SUPPLIER_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </SectionCard>

      <SectionCard title="Suppliers" pad="none" className="min-h-[400px]">
        {loading ? (
          <div className="flex items-center justify-center p-12">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-gray-500">
            <Users className="w-12 h-12 mb-3 opacity-50" />
            <p className="text-sm">No suppliers found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {filtered.map((supplier) => (
              <div key={supplier.id} className="px-6 py-4 flex items-center justify-between gap-4 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors group">
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <Badge tone={STATUS_TONE[supplier.status]}>{supplier.status}</Badge>
                      <Badge tone={RISK_TONE[supplier.risk_level]}>{supplier.risk_level} Risk</Badge>
                    </div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{supplier.legal_name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{supplier.supplier_code} • {supplier.supplier_category}</p>
                    {supplier.city && <p className="text-xs text-gray-400">{supplier.city}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500 uppercase">Score</p>
                    <p className="text-lg font-bold text-indigo-600">{supplier.overall_score.toFixed(0)}</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setViewingId(supplier.id);
                    setViewingTab('profile');
                    loadSupplierDetails(supplier.id);
                  }}
                  className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  View Details
                </button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Create Modal */}
      <ModalSystem isOpen={showForm} onClose={() => setShowForm(false)} title="Add Supplier" size="lg" loading={submitting} confirmLabel="Add" onConfirm={submitCreate}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Supplier Code *</label>
              <input className={inputClass} value={form.supplierCode} onChange={(e) => setForm({ ...form, supplierCode: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Legal Name *</label>
              <input className={inputClass} value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Trading Name</label>
              <input className={inputClass} value={form.tradingName} onChange={(e) => setForm({ ...form, tradingName: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Supplier Type *</label>
              <select className={inputClass} value={form.supplierType} onChange={(e) => setForm({ ...form, supplierType: e.target.value as any })}>
                <option value="Local">Local</option>
                <option value="National">National</option>
                <option value="International">International</option>
                <option value="Strategic">Strategic</option>
                <option value="Preferred">Preferred</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Category *</label>
              <select className={inputClass} value={form.supplierCategory} onChange={(e) => setForm({ ...form, supplierCategory: e.target.value })}>
                {SUPPLIER_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">City</label>
              <input className={inputClass} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Email</label>
              <input className={inputClass} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Phone</label>
              <input className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Website</label>
              <input className={inputClass} value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="www.example.com" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Payment Terms (days)</label>
              <input className={inputClass} type="number" value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: parseInt(e.target.value) })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Lead Time (days)</label>
              <input className={inputClass} type="number" value={form.leadTime} onChange={(e) => setForm({ ...form, leadTime: parseInt(e.target.value) })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Currency</label>
              <select className={inputClass} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                <option value="ETB">ETB</option><option value="USD">USD</option><option value="EUR">EUR</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Delivery Terms</label>
              <input className={inputClass} value={form.deliveryTerms} onChange={(e) => setForm({ ...form, deliveryTerms: e.target.value })} placeholder="e.g. FOB Destination" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Minimum Order Qty</label>
              <input className={inputClass} type="number" value={form.minimumOrderQuantity} onChange={(e) => setForm({ ...form, minimumOrderQuantity: parseFloat(e.target.value) || 0 })} />
            </div>
          </div>

          {/* Compliance (spec section 23) */}
          <div className="p-3 rounded-xl bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700">
            <p className="text-xs font-bold text-gray-600 dark:text-gray-400 mb-2">Compliance (Spec §23)</p>
            <div className="grid grid-cols-3 gap-2">
              <input className={inputClass} placeholder="Tax Registration" value={form.taxRegistration} onChange={(e) => setForm({ ...form, taxRegistration: e.target.value })} />
              <input className={inputClass} placeholder="Business License" value={form.businessLicense} onChange={(e) => setForm({ ...form, businessLicense: e.target.value })} />
              <input className={inputClass} placeholder="Insurance" value={form.insurance} onChange={(e) => setForm({ ...form, insurance: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-2">Contacts</label>
            {form.contacts.map((contact, idx) => (
              <div key={idx} className="p-3 bg-gray-50 dark:bg-slate-800 rounded-xl space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input className={inputClass} placeholder="Name" value={contact.name} onChange={(e) => {
                    const newContacts = [...form.contacts];
                    newContacts[idx] = { ...newContacts[idx], name: e.target.value };
                    setForm({ ...form, contacts: newContacts });
                  }} />
                  <input className={inputClass} placeholder="Email" value={contact.email} onChange={(e) => {
                    const newContacts = [...form.contacts];
                    newContacts[idx] = { ...newContacts[idx], email: e.target.value };
                    setForm({ ...form, contacts: newContacts });
                  }} />
                  <input className={inputClass} placeholder="Phone" value={contact.phone} onChange={(e) => {
                    const newContacts = [...form.contacts];
                    newContacts[idx] = { ...newContacts[idx], phone: e.target.value };
                    setForm({ ...form, contacts: newContacts });
                  }} />
                  <input className={inputClass} placeholder="Role" value={contact.role} onChange={(e) => {
                    const newContacts = [...form.contacts];
                    newContacts[idx] = { ...newContacts[idx], role: e.target.value };
                    setForm({ ...form, contacts: newContacts });
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </ModalSystem>

      {/* View Detail Modal */}
      {viewingId && (
        <ModalSystem isOpen={!!viewingId} onClose={() => setViewingId(null)} title="Supplier Details" size="xl" showFooter={false}>
          {(() => {
            const supplier = suppliers.find((s) => s.id === viewingId);
            if (!supplier) return null;
            return (
              <div>
                <div className="flex border-b border-gray-200 dark:border-slate-700 mb-4">
                  <button onClick={() => setViewingTab('profile')} className={`px-4 py-2 text-sm font-medium ${viewingTab === 'profile' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500'}`}>Profile</button>
                  <button onClick={() => setViewingTab('performance')} className={`px-4 py-2 text-sm font-medium ${viewingTab === 'performance' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500'}`}>Performance</button>
                  <button onClick={() => setViewingTab('risk')} className={`px-4 py-2 text-sm font-medium ${viewingTab === 'risk' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500'}`}>Risk</button>
                </div>

                {viewingTab === 'profile' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-gray-500 uppercase">Supplier Code</p>
                        <p className="text-sm font-medium">{supplier.supplier_code}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 uppercase">Status</p>
                        <Badge tone={STATUS_TONE[supplier.status]}>{supplier.status}</Badge>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 uppercase">Legal Name</p>
                        <p className="text-sm font-medium">{supplier.legal_name}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 uppercase">Trading Name</p>
                        <p className="text-sm font-medium">{supplier.trading_name || '-'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 uppercase">Type</p>
                        <p className="text-sm font-medium">{supplier.supplier_type}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 uppercase">Category</p>
                        <p className="text-sm font-medium">{supplier.supplier_category}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 uppercase">City</p>
                        <p className="text-sm font-medium">{supplier.city || '-'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 uppercase">Email</p>
                        <p className="text-sm font-medium">{supplier.email || '-'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 uppercase">Phone</p>
                        <p className="text-sm font-medium">{supplier.phone || '-'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 uppercase">Payment Terms</p>
                        <p className="text-sm font-medium">{supplier.payment_terms} days</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 uppercase">Lead Time</p>
                        <p className="text-sm font-medium">{supplier.lead_time} days</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 uppercase">Overall Score</p>
                        <p className="text-lg font-bold text-indigo-600">{supplier.overall_score.toFixed(1)}</p>
                      </div>
                    </div>
                    {supplier.address && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase mb-1">Address</p>
                        <p className="text-sm">{supplier.address}</p>
                      </div>
                    )}
                  </div>
                )}

                {viewingTab === 'performance' && (
                  <div>
                    {performanceData && performanceData.length > 0 ? (
                      <div className="space-y-3">
                        {performanceData.map((perf: any) => (
                          <div key={perf.id} className="p-4 bg-gray-50 dark:bg-slate-800 rounded-xl">
                            <div className="flex justify-between items-center mb-2">
                              <p className="text-sm font-medium">{perf.period_start} to {perf.period_end}</p>
                              <Badge tone={perf.trend === 'improving' ? 'success' : perf.trend === 'declining' ? 'danger' : 'neutral'}>{perf.trend}</Badge>
                            </div>
                            <div className="grid grid-cols-4 gap-4 text-xs">
                              <div>
                                <p className="text-gray-500">On-Time Delivery</p>
                                <p className="font-medium">{perf.on_time_delivery_rate.toFixed(1)}%</p>
                              </div>
                              <div>
                                <p className="text-gray-500">Quality Score</p>
                                <p className="font-medium">{perf.quality_score.toFixed(1)}</p>
                              </div>
                              <div>
                                <p className="text-gray-500">Total Spend</p>
                                <p className="font-medium">${perf.total_spend.toLocaleString()}</p>
                              </div>
                              <div>
                                <p className="text-gray-500">Overall</p>
                                <p className="font-medium">{perf.overall_score.toFixed(1)}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">No performance data available</p>
                    )}
                  </div>
                )}

                {viewingTab === 'risk' && (
                  <div>
                    {riskData && riskData.length > 0 ? (
                      <div className="space-y-3">
                        {riskData.map((risk: any) => (
                          <div key={risk.id} className="p-4 border border-gray-200 dark:border-slate-700 rounded-xl">
                            <div className="flex justify-between items-start mb-2">
                              <div>
                                <p className="text-sm font-medium">{risk.risk_type}</p>
                                <p className="text-xs text-gray-500 mt-1">{risk.risk_description}</p>
                              </div>
                              <Badge tone={RISK_TONE[risk.risk_level]}>{risk.risk_level}</Badge>
                            </div>
                            {risk.mitigation_plan && (
                              <div>
                                <p className="text-xs text-gray-500 uppercase mb-1">Mitigation</p>
                                <p className="text-xs">{risk.mitigation_plan}</p>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">No risks registered</p>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </ModalSystem>
      )}
    </div>
  );
};

export default SupplierManagement;