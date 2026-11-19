/**
 * External Vendor Management Module
 * Manage tour operators, restaurants, taxi companies, and service providers.
 *
 * DB-integrated: reads/writes the shared `vendors` table via
 * /api/concierge/vendors. Supports create, edit, hold/reactivate,
 * category + status filters, and search.
 */

import { conciergeFetch } from '../conciergeApi';
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Building2,
  Phone,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Pencil,
  PauseCircle,
  PlayCircle,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Star,
  Wallet,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';

interface Vendor {
  id: string;
  name: string;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  tax_id?: string | null;
  category: string;
  status: string;
  withholding_rate?: number | null;
  balance?: number | null;
  rating?: number | null;
  below_min_rating?: boolean;
  created_at: string;
}

const STATUS_TONE: Record<string, StatusTone> = {
  Active: 'success',
  Inactive: 'neutral',
  Hold: 'warning',
};

const CATEGORIES = ['Operations', 'Transportation', 'Food & Beverage', 'Tours', 'Medical', 'Entertainment'];
const STATUSES = ['Active', 'Inactive', 'Hold'];

const EMPTY_FORM = {
  name: '',
  contact_name: '',
  email: '',
  phone: '',
  address: '',
  category: 'Tours',
  status: 'Active',
  withholding_rate: 0,
  rating: '' as number | '',
};

const VendorManagementModule: React.FC = () => {
  const { addNotification, formatAmount } = useERP();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const parseJson = async (response: Response) => {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(`Unexpected response (${response.status})`);
    }
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  };

  const fetchVendors = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await conciergeFetch('/api/concierge/vendors?limit=200');
      setVendors(await parseJson(response));
    } catch (e: any) {
      setError(e?.message || 'Failed to load vendors');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVendors();
  }, [fetchVendors]);

  const stats = useMemo(() => ({
    total: vendors.length,
    active: vendors.filter((v) => v.status === 'Active').length,
    onHold: vendors.filter((v) => v.status === 'Hold').length,
    outstanding: vendors.reduce((s, v) => s + Number(v.balance || 0), 0),
  }), [vendors]);

  const categories = useMemo(() => {
    const set = new Set(vendors.map((v) => v.category).filter(Boolean));
    return [...set].sort();
  }, [vendors]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return vendors.filter((v) => {
      const matchesCategory = !filterCategory || v.category === filterCategory;
      const matchesStatus = !filterStatus || v.status === filterStatus;
      const matchesSearch =
        !q ||
        v.name.toLowerCase().includes(q) ||
        (v.contact_name || '').toLowerCase().includes(q) ||
        (v.email || '').toLowerCase().includes(q);
      return matchesCategory && matchesStatus && matchesSearch;
    });
  }, [vendors, filterCategory, filterStatus, searchQuery]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (vendor: Vendor) => {
    setEditingId(vendor.id);
    setForm({
      name: vendor.name,
      contact_name: vendor.contact_name || '',
      email: vendor.email || '',
      phone: vendor.phone || '',
      address: vendor.address || '',
      category: vendor.category || 'Operations',
      status: vendor.status || 'Active',
      withholding_rate: Number(vendor.withholding_rate || 0),
      rating: vendor.rating ?? '',
    });
    setFormError(null);
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setFormError('Company name is required');
      return;
    }
    try {
      setSubmitting(true);
      setFormError(null);
      const body = {
        name: form.name.trim(),
        contact_name: form.contact_name.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        category: form.category,
        status: form.status,
        withholding_rate: Number(form.withholding_rate) || 0,
        rating: form.rating === '' ? null : Number(form.rating),
      };
      const response = await conciergeFetch(
        editingId ? `/api/concierge/vendors/${editingId}` : '/api/concierge/vendors',
        { method: editingId ? 'PUT' : 'POST', json: true, body: JSON.stringify(body) }
      );
      await parseJson(response);
      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      addNotification(editingId ? 'Vendor updated' : 'Vendor added', 'success', 'Concierge');
      fetchVendors();
    } catch (e: any) {
      setFormError(e?.message || 'Failed to save vendor');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (vendor: Vendor) => {
    const next = vendor.status === 'Active' ? 'Hold' : 'Active';
    try {
      const response = await conciergeFetch(`/api/concierge/vendors/${vendor.id}`, {
        method: 'PUT',
        json: true,
        body: JSON.stringify({ status: next }),
      });
      await parseJson(response);
      addNotification(`Vendor ${next === 'Hold' ? 'put on hold' : 'reactivated'}`, 'success', 'Concierge');
      fetchVendors();
    } catch (e: any) {
      setError(e?.message || 'Failed to update vendor status');
    }
  };

  const inputClass =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white';
  const labelClass = 'mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300';

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="External Vendor Management"
        subtitle="Manage tour operators, restaurants, taxi companies, and service providers"
        icon={Building2}
        actions={
          <div className="flex items-center gap-2">
            <button type="button" onClick={fetchVendors} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button type="button" onClick={openCreate} className={button.primary}>
              <Plus size={16} />
              Add Vendor
            </button>
          </div>
        }
      />

      {/* KPI row */}
      <div className={layout.kpiGrid}>
        <StatCard title="Vendors" value={stats.total} icon={Building2} tone="accent" />
        <StatCard title="Active" value={stats.active} icon={CheckCircle2} tone="success" />
        <StatCard title="On Hold" value={stats.onHold} icon={PauseCircle} tone="warning" />
        <StatCard title="Outstanding Balance" value={formatAmount(stats.outstanding)} icon={Wallet} tone="info" />
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* Add / edit form */}
      {showForm && (
        <SectionCard
          title={editingId ? 'Edit Vendor' : 'Add New Vendor'}
          subtitle="Guest-facing service provider details"
          icon={editingId ? Pencil : Plus}
          tone="accent"
          pad="md"
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <label className={labelClass}>Company Name</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} placeholder="e.g. Lalibela Heritage Tours" />
            </div>
            <div>
              <label className={labelClass}>Contact Person</label>
              <input type="text" value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} className={inputClass} placeholder="Contact name" />
            </div>
            <div>
              <label className={labelClass}>Email</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} placeholder="bookings@vendor.et" />
            </div>
            <div>
              <label className={labelClass}>Phone</label>
              <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputClass} placeholder="+251 …" />
            </div>
            <div>
              <label className={labelClass}>Category</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputClass}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Status</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inputClass}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Withholding Rate (%)</label>
              <input type="number" min="0" max="100" step="0.5" value={form.withholding_rate} onChange={(e) => setForm({ ...form, withholding_rate: Number(e.target.value) })} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Rating (0–5)</label>
              <input
                type="number"
                min="0"
                max="5"
                step="0.1"
                value={form.rating}
                onChange={(e) => setForm({ ...form, rating: e.target.value === '' ? '' : Number(e.target.value) })}
                className={inputClass}
                placeholder="Optional"
              />
            </div>
            <div className="md:col-span-2 lg:col-span-3">
              <label className={labelClass}>Address</label>
              <input type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={inputClass} placeholder="Street / district, Addis Ababa" />
            </div>
          </div>
          {formError && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
              <AlertTriangle size={14} />
              {formError}
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className={button.secondary}>
              Cancel
            </button>
            <button type="button" onClick={handleSubmit} disabled={submitting} className={button.primary}>
              {submitting ? 'Saving…' : editingId ? 'Save Changes' : 'Add Vendor'}
            </button>
          </div>
        </SectionCard>
      )}

      {/* Vendor directory */}
      <SectionCard
        title="Vendor Directory"
        subtitle={`${filtered.length} of ${vendors.length} vendors`}
        icon={Building2}
        tone="info"
        pad="none"
        actions={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search vendors…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-48 rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-sm text-slate-900 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
            <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
              <option value="">All Statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        }
      >
        {loading && vendors.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            <Building2 size={40} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">No vendors found</p>
            <p className="mt-1 text-xs text-slate-400">Try a different filter or add a vendor above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Company</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Contact</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Category</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Status</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Balance</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {filtered.map((vendor) => (
                  <tr key={vendor.id} className="transition hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="shrink-0 rounded-lg bg-indigo-100 p-2 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300">
                          <Building2 size={16} />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-slate-900 dark:text-white">{vendor.name}</div>
                          {vendor.address && (
                            <div className="max-w-xs truncate text-xs text-slate-400">{vendor.address}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      {vendor.contact_name && (
                        <div className="text-sm text-slate-700 dark:text-slate-300">{vendor.contact_name}</div>
                      )}
                      <div className="mt-0.5 space-y-0.5 text-xs text-slate-400">
                        {vendor.email && (
                          <div className="flex items-center gap-1">
                            <Mail size={11} />
                            {vendor.email}
                          </div>
                        )}
                        {vendor.phone && (
                          <div className="flex items-center gap-1">
                            <Phone size={11} />
                            {vendor.phone}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <Badge tone="neutral">{vendor.category}</Badge>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`h-1.5 w-1.5 rounded-full ${statusTone[STATUS_TONE[vendor.status] || 'neutral'].dot}`} />
                        <Badge tone={STATUS_TONE[vendor.status] || 'neutral'}>{vendor.status}</Badge>
                        {vendor.rating != null && (
                          <span className="inline-flex items-center gap-0.5 text-xs text-slate-500 dark:text-slate-400">
                            <Star size={11} className="fill-amber-400 text-amber-400" />
                            {vendor.rating}
                          </span>
                        )}
                        {vendor.below_min_rating && (
                          <Badge tone="warning">Below min</Badge>
                        )}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-sm font-medium text-slate-700 dark:text-slate-300">
                      {formatAmount(Number(vendor.balance || 0))}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEdit(vendor)}
                          title="Edit vendor"
                          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-900/30"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(vendor)}
                          title={vendor.status === 'Active' ? 'Put on hold' : 'Reactivate'}
                          className={`rounded-lg p-1.5 transition ${
                            vendor.status === 'Active'
                              ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/30'
                              : 'text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/30'
                          }`}
                        >
                          {vendor.status === 'Active' ? <PauseCircle size={15} /> : <PlayCircle size={15} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
};

export default VendorManagementModule;
