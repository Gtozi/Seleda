/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Equipment Registry — Engineering Portal
 * (/erp/maintenance/equipment-registry).
 *
 * DB-integrated: fetches and persists via /api/eng-portal/assets (fixed_assets table).
 * UI aligned with WorkOrderManagement — PageHeader, SectionCard, StatCard, Badge,
 * brandTheme tokens, list rows, detail/create modal, loading/error/retry.
 * Multi-property scoping via useERP(). ERP notifications on create/update/delete.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Box, Plus, Search, ArrowRight, Loader2, ServerCrash, MoreVertical,
  Eye, Trash2, X, Zap, Thermometer, Droplets, ArrowUpDown, Utensils,
  Car, Factory, MapPin, ShieldCheck, AlertTriangle, QrCode, Barcode,
  Wrench, Calendar, FileText,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchAssets, createAsset, updateAsset, deleteAsset,
  type Asset,
} from '../../services/engineeringService';

// ── Static registries ────────────────────────────────────────────────────
const CATEGORY_OPTIONS = [
  'Power Systems', 'HVAC', 'Water Systems', 'Vertical Transport',
  'Kitchen Equipment', 'Laundry Equipment', 'IT Equipment', 'Other',
] as const;

const STATUS_OPTIONS = [
  'Active', 'Under Maintenance', 'Disposal Pending', 'Disposed', 'Written Off',
] as const;

const CRITICALITY_OPTIONS = ['Low', 'Medium', 'High', 'Critical'] as const;

const CATEGORY_ICON: Record<string, React.ComponentType<{ className?: string; size?: number }>> = {
  'Power Systems': Zap,
  'HVAC': Thermometer,
  'Water Systems': Droplets,
  'Vertical Transport': ArrowUpDown,
  'Kitchen Equipment': Utensils,
  'Laundry Equipment': Car,
  'IT Equipment': Factory,
  'Other': Box,
};

const STATUS_TONE: Record<string, StatusTone> = {
  'Active': 'success',
  'Under Maintenance': 'warning',
  'Disposal Pending': 'warning',
  'Disposed': 'neutral',
  'Written Off': 'danger',
};

const CRITICALITY_TONE: Record<string, StatusTone> = {
  Low: 'neutral',
  Medium: 'info',
  High: 'warning',
  Critical: 'danger',
};

// ── Field helper ─────────────────────────────────────────────────────────
const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtCost(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function isWarrantyValid(a: Asset): boolean {
  if (!a.warranty_end) return false;
  return new Date(a.warranty_end) > new Date();
}

// ── Component ────────────────────────────────────────────────────────────
const EquipmentRegistry: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const [categoryFilter, setCategoryFilter] = useState<'All' | string>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | string>('All');
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState<{
    assetCode: string;
    assetName: string;
    assetCategory: string;
    description: string;
    location: string;
    manufacturer: string;
    modelNumber: string;
    serialNumber: string;
    purchaseDate: string;
    purchaseCost: string;
    salvageValue: string;
    usefulLifeYears: string;
    warrantyStart: string;
    warrantyEnd: string;
    warrantyProvider: string;
    criticality: string;
  }>({
    assetCode: '', assetName: '', assetCategory: 'Other', description: '', location: '',
    manufacturer: '', modelNumber: '', serialNumber: '',
    purchaseDate: new Date().toISOString().split('T')[0],
    purchaseCost: '0', salvageValue: '0', usefulLifeYears: '10',
    warrantyStart: '', warrantyEnd: '', warrantyProvider: '',
    criticality: 'Medium',
  });

  const [detailId, setDetailId] = useState<string | null>(null);
  const detailAsset = assets.find(a => a.id === detailId) || null;

  // ── Load ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAssets({ propertyId: currentPropertyId || undefined });
      setAssets(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load equipment');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  // ── Derived lists ─────────────────────────────────────────────────────
  const filtered = useMemo(
    () =>
      assets.filter(a => {
        const matchesCategory = categoryFilter === 'All' || a.asset_category === categoryFilter;
        const matchesStatus = statusFilter === 'All' || a.status === statusFilter;
        const q = search.trim().toLowerCase();
        const matchesSearch =
          !q ||
          (a.asset_code || '').toLowerCase().includes(q) ||
          (a.asset_name || '').toLowerCase().includes(q) ||
          (a.manufacturer || '').toLowerCase().includes(q) ||
          (a.serial_number || '').toLowerCase().includes(q) ||
          (a.location || '').toLowerCase().includes(q);
        return matchesCategory && matchesStatus && matchesSearch;
      }),
    [assets, categoryFilter, statusFilter, search]
  );

  const counts = {
    total: assets.length,
    active: assets.filter(a => a.status === 'Active').length,
    underWarranty: assets.filter(a => isWarrantyValid(a)).length,
    warrantyExpired: assets.filter(a => a.warranty_end && !isWarrantyValid(a)).length,
  };

  // ── Actions ───────────────────────────────────────────────────────────
  const submitCreate = async () => {
    if (!form.assetCode.trim() || !form.assetName.trim()) return;
    setSubmitting(true);
    try {
      await createAsset({
        assetCode: form.assetCode.trim(),
        assetName: form.assetName.trim(),
        assetCategory: form.assetCategory,
        description: form.description.trim() || undefined,
        location: form.location.trim() || undefined,
        manufacturer: form.manufacturer.trim() || undefined,
        modelNumber: form.modelNumber.trim() || undefined,
        serialNumber: form.serialNumber.trim() || undefined,
        purchaseDate: form.purchaseDate,
        purchaseCost: parseFloat(form.purchaseCost) || 0,
        salvageValue: parseFloat(form.salvageValue) || 0,
        usefulLifeYears: parseInt(form.usefulLifeYears) || 10,
        warrantyStart: form.warrantyStart || undefined,
        warrantyEnd: form.warrantyEnd || undefined,
        warrantyProvider: form.warrantyProvider.trim() || undefined,
        criticality: form.criticality,
        propertyId: currentPropertyId || undefined,
      });
      addNotification(`Equipment "${form.assetName.trim()}" registered.`, 'task', 'Maintenance');
      setShowCreate(false);
      setForm({
        assetCode: '', assetName: '', assetCategory: 'Other', description: '', location: '',
        manufacturer: '', modelNumber: '', serialNumber: '',
        purchaseDate: new Date().toISOString().split('T')[0],
        purchaseCost: '0', salvageValue: '0', usefulLifeYears: '10',
        warrantyStart: '', warrantyEnd: '', warrantyProvider: '',
        criticality: 'Medium',
      });
      load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to register equipment', 'warning', 'Maintenance');
    } finally {
      setSubmitting(false);
    }
  };

  const changeStatus = async (id: string, status: string) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      await updateAsset(id, { status });
      setAssets(prev => prev.map(a => (a.id === id ? { ...a, status } : a)));
      addNotification(`Equipment status → ${status}.`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || `Failed to update status to ${status}`, 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const removeAsset = async (id: string) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      await deleteAsset(id);
      setAssets(prev => prev.filter(a => a.id !== id));
      addNotification(`Equipment deleted.`, 'task', 'Maintenance');
      setDetailId(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete equipment', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const saveDetail = async (patch: any) => {
    if (!detailAsset) return;
    setActingOn(detailAsset.id);
    try {
      await updateAsset(detailAsset.id, patch);
      setAssets(prev => prev.map(a => (a.id === detailAsset.id ? { ...a, ...patch } : a)));
      addNotification(`Equipment "${detailAsset.asset_name}" updated.`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update equipment', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────
  const categoryFilters: ('All' | string)[] = ['All', ...CATEGORY_OPTIONS];
  const statusFilters: ('All' | string)[] = ['All', ...STATUS_OPTIONS];

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Equipment Registry"
        subtitle="Asset registration, specifications, warranty tracking & documentation."
        icon={Box}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={() => setShowCreate(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> Register Equipment
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Equipment" value={counts.total} icon={Box} tone="info" />
        <StatCard title="Active" value={counts.active} icon={ShieldCheck} tone="success" />
        <StatCard title="Under Warranty" value={counts.underWarranty} icon={ShieldCheck} tone="accent" />
        <StatCard title="Warranty Expired" value={counts.warrantyExpired} icon={AlertTriangle} tone="danger" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {/* Filters section */}
      <SectionCard
        title="Equipment"
        subtitle="Registered fixed assets and equipment"
        icon={Box}
        pad="md"
      >
        {/* Category filter */}
        <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap mb-3">
          {categoryFilters.map(f => {
            const Icon = f === 'All' ? Box : CATEGORY_ICON[f] ?? Box;
            return (
              <button
                key={f}
                onClick={() => setCategoryFilter(f)}
                className={[
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap flex items-center gap-1.5',
                  categoryFilter === f
                    ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-700',
                ].join(' ')}
              >
                <Icon className="w-3 h-3" />
                {f}
              </button>
            );
          })}
        </div>

        {/* Status filter + search */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap">
            {statusFilters.map(f => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={[
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap',
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
              placeholder="Search code, name, serial, location…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
            />
          </div>
        </div>
      </SectionCard>

      {/* Equipment list */}
      <SectionCard pad="none" bodyClassName="divide-y divide-gray-100 dark:divide-slate-700">
        {loading && (
          <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading equipment…
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-500">
            {assets.length === 0 ? 'No equipment registered yet.' : 'No equipment matches the filters.'}
          </div>
        )}

        {!loading && !error && filtered.map(a => {
          const tone = STATUS_TONE[a.status] ?? 'neutral';
          const criticalityTone = CRITICALITY_TONE[a.criticality] ?? 'neutral';
          const warrantyValid = isWarrantyValid(a);
          const CategoryIcon = CATEGORY_ICON[a.asset_category || 'Other'] ?? Box;
          const isMenuOpen = menuOpen === a.id;

          return (
            <div key={a.id} className="p-4 flex flex-col md:flex-row md:items-center gap-4">
              {/* Identity */}
              <div className="flex items-center gap-3 md:w-64 shrink-0">
                <div className={`p-2 rounded-xl ${statusTone[tone].soft}`}>
                  <CategoryIcon className={`w-4 h-4 ${statusTone[tone].text}`} />
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-gray-900 dark:text-white truncate">{a.asset_name || '—'}</h4>
                  <p className="text-xs text-gray-500 font-mono truncate">
                    {a.asset_code || '—'} · {a.asset_category || 'Other'}
                  </p>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  {a.location && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5" /> {a.location}
                    </span>
                  )}
                  {a.manufacturer && (
                    <>
                      <span>·</span>
                      <span>{a.manufacturer}{a.model_number ? ` ${a.model_number}` : ''}</span>
                    </>
                  )}
                  {a.serial_number && (
                    <>
                      <span>·</span>
                      <span className="font-mono">SN: {a.serial_number}</span>
                    </>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  {warrantyValid ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-success)]">
                      <ShieldCheck className="w-3 h-3" /> Warranty until {fmtDate(a.warranty_end)}
                    </span>
                  ) : a.warranty_end ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-danger)]">
                      <AlertTriangle className="w-3 h-3" /> Warranty expired {fmtDate(a.warranty_end)}
                    </span>
                  ) : null}
                </div>
              </div>

              {/* Status + criticality */}
              <div className="md:w-48 shrink-0">
                <div className="flex items-center justify-between text-xs">
                  <Badge tone={tone}>{a.status}</Badge>
                  <Badge tone={criticalityTone} variant="solid">{a.criticality}</Badge>
                </div>
              </div>

              {/* Actions */}
              <div className="md:w-36 shrink-0 flex justify-end items-center gap-1.5">
                <button
                  onClick={() => setDetailId(a.id)}
                  className={button.ghost}
                  title="View details"
                >
                  <Eye className="w-4 h-4" />
                </button>
                <div className="relative">
                  <button
                    onClick={() => setMenuOpen(isMenuOpen ? null : a.id)}
                    disabled={actingOn === a.id}
                    className={button.ghost + ' disabled:opacity-50'}
                  >
                    {actingOn === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoreVertical className="w-4 h-4" />}
                  </button>
                  {isMenuOpen && (
                    <div className="absolute right-0 top-full mt-2 w-52 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden">
                      {STATUS_OPTIONS.filter(s => s !== a.status).map(s => (
                        <button
                          key={s}
                          onClick={() => changeStatus(a.id, s)}
                          className="w-full text-left px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                        >
                          Set status: {s}
                        </button>
                      ))}
                      <button
                        onClick={() => removeAsset(a.id)}
                        className="w-full text-left px-3 py-2 text-xs font-medium text-[var(--color-danger)] hover:bg-red-50 dark:hover:bg-red-900/20 transition border-t border-gray-100 dark:border-slate-700"
                      >
                        <Trash2 className="w-3.5 h-3.5 inline mr-1" /> Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </SectionCard>

      {/* ── Create modal ─────────────────────────────────────────────── */}
      <ModalSystem
        isOpen={showCreate}
        onClose={() => (submitting ? undefined : setShowCreate(false))}
        title="Register Equipment"
        subtitle="Add a new equipment asset to the registry."
        variant="form"
        size="lg"
        loading={submitting}
        confirmLabel={submitting ? 'Submitting…' : 'Register'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitCreate}
        showFooter
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Asset Code">
              <input
                value={form.assetCode}
                onChange={e => setForm(f => ({ ...f, assetCode: e.target.value }))}
                placeholder="e.g. GEN-01"
                className={inputClass}
              />
            </Field>
            <Field label="Asset Name">
              <input
                value={form.assetName}
                onChange={e => setForm(f => ({ ...f, assetName: e.target.value }))}
                placeholder="e.g. Backup Generator 500kVA"
                className={inputClass}
              />
            </Field>
            <Field label="Category">
              <select
                value={form.assetCategory}
                onChange={e => setForm(f => ({ ...f, assetCategory: e.target.value }))}
                className={inputClass}
              >
                {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Criticality">
              <select
                value={form.criticality}
                onChange={e => setForm(f => ({ ...f, criticality: e.target.value }))}
                className={inputClass}
              >
                {CRITICALITY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Location">
              <input
                value={form.location}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                placeholder="e.g. Plant Room 1"
                className={inputClass}
              />
            </Field>
            <Field label="Manufacturer">
              <input
                value={form.manufacturer}
                onChange={e => setForm(f => ({ ...f, manufacturer: e.target.value }))}
                placeholder="e.g. Cummins Power"
                className={inputClass}
              />
            </Field>
            <Field label="Model Number">
              <input
                value={form.modelNumber}
                onChange={e => setForm(f => ({ ...f, modelNumber: e.target.value }))}
                placeholder="e.g. C500D5"
                className={inputClass}
              />
            </Field>
            <Field label="Serial Number">
              <input
                value={form.serialNumber}
                onChange={e => setForm(f => ({ ...f, serialNumber: e.target.value }))}
                placeholder="e.g. CUM-2022-GEN-001"
                className={inputClass}
              />
            </Field>
            <Field label="Purchase Date">
              <input
                type="date"
                value={form.purchaseDate}
                onChange={e => setForm(f => ({ ...f, purchaseDate: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Purchase Cost">
              <input
                type="number"
                step="0.01"
                value={form.purchaseCost}
                onChange={e => setForm(f => ({ ...f, purchaseCost: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Salvage Value">
              <input
                type="number"
                step="0.01"
                value={form.salvageValue}
                onChange={e => setForm(f => ({ ...f, salvageValue: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Useful Life (years)">
              <input
                type="number"
                value={form.usefulLifeYears}
                onChange={e => setForm(f => ({ ...f, usefulLifeYears: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Warranty Start">
              <input
                type="date"
                value={form.warrantyStart}
                onChange={e => setForm(f => ({ ...f, warrantyStart: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Warranty End">
              <input
                type="date"
                value={form.warrantyEnd}
                onChange={e => setForm(f => ({ ...f, warrantyEnd: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Warranty Provider">
              <input
                value={form.warrantyProvider}
                onChange={e => setForm(f => ({ ...f, warrantyProvider: e.target.value }))}
                placeholder="e.g. Cummins Power Systems"
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Description">
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Equipment description, capacity, power rating, etc."
              rows={3}
              className={inputClass}
            />
          </Field>
        </div>
      </ModalSystem>

      {/* ── Detail modal ─────────────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!detailId}
        onClose={() => setDetailId(null)}
        title={detailAsset?.asset_name || 'Equipment'}
        subtitle={detailAsset?.asset_code}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {detailAsset && (
          <div className="space-y-5">
            {/* Status + criticality + category */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[detailAsset.status] ?? 'neutral'}>{detailAsset.status}</Badge>
              <Badge tone={CRITICALITY_TONE[detailAsset.criticality] ?? 'neutral'} variant="solid">{detailAsset.criticality}</Badge>
              <Badge tone="info">{detailAsset.asset_category || 'Other'}</Badge>
              {isWarrantyValid(detailAsset) ? (
                <Badge tone="success" icon={ShieldCheck}>Warranty Active</Badge>
              ) : detailAsset.warranty_end ? (
                <Badge tone="danger" icon={AlertTriangle}>Warranty Expired</Badge>
              ) : null}
            </div>

            {/* Description */}
            {detailAsset.description && (
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Description</p>
                <p className="text-sm text-gray-700 dark:text-gray-200">{detailAsset.description}</p>
              </div>
            )}

            {/* Metadata grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Location</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{detailAsset.location || '—'}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Manufacturer</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{detailAsset.manufacturer || '—'}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Model</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{detailAsset.model_number || '—'}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Serial Number</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white font-mono">{detailAsset.serial_number || '—'}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Purchase Date</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{fmtDate(detailAsset.purchase_date)}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Purchase Cost</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{fmtCost(detailAsset.purchase_cost)}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Net Book Value</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{fmtCost(detailAsset.net_book_value)}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Useful Life</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{detailAsset.useful_life_years || '—'} yrs</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Warranty Start</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{fmtDate(detailAsset.warranty_start)}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Warranty End</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{fmtDate(detailAsset.warranty_end)}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Warranty Provider</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{detailAsset.warranty_provider || '—'}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Created</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{fmtDate(detailAsset.created_at)}</p>
              </div>
            </div>

            {/* QR / Barcode identifiers */}
            <div className="border border-gray-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <QrCode className="w-4 h-4 text-[var(--color-accent-operations)]" />
                <span className="text-xs font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wide">Asset Identifiers</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900/40 rounded-lg p-2">
                  <QrCode className="w-4 h-4 text-[var(--color-accent-operations)]" />
                  <div>
                    <p className="text-[10px] font-bold text-gray-500 uppercase">Asset Code</p>
                    <p className="text-sm font-bold text-gray-900 dark:text-white font-mono">{detailAsset.asset_code || '—'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900/40 rounded-lg p-2">
                  <Barcode className="w-4 h-4 text-purple-500" />
                  <div>
                    <p className="text-[10px] font-bold text-gray-500 uppercase">Serial Number</p>
                    <p className="text-sm font-bold text-gray-900 dark:text-white font-mono">{detailAsset.serial_number || '—'}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Editable fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-gray-100 dark:border-slate-700">
              <Field label="Status">
                <select
                  value={detailAsset.status}
                  onChange={e => saveDetail({ status: e.target.value })}
                  className={inputClass}
                  disabled={actingOn === detailAsset.id}
                >
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Criticality">
                <select
                  value={detailAsset.criticality}
                  onChange={e => saveDetail({ criticality: e.target.value })}
                  className={inputClass}
                  disabled={actingOn === detailAsset.id}
                >
                  {CRITICALITY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Location">
                <input
                  defaultValue={detailAsset.location || ''}
                  onBlur={e => saveDetail({ location: e.target.value })}
                  className={inputClass}
                  disabled={actingOn === detailAsset.id}
                />
              </Field>
              <Field label="Manufacturer">
                <input
                  defaultValue={detailAsset.manufacturer || ''}
                  onBlur={e => saveDetail({ manufacturer: e.target.value })}
                  className={inputClass}
                  disabled={actingOn === detailAsset.id}
                />
              </Field>
              <Field label="Model Number">
                <input
                  defaultValue={detailAsset.model_number || ''}
                  onBlur={e => saveDetail({ modelNumber: e.target.value })}
                  className={inputClass}
                  disabled={actingOn === detailAsset.id}
                />
              </Field>
              <Field label="Serial Number">
                <input
                  defaultValue={detailAsset.serial_number || ''}
                  onBlur={e => saveDetail({ serialNumber: e.target.value })}
                  className={inputClass}
                  disabled={actingOn === detailAsset.id}
                />
              </Field>
              <Field label="Warranty Start">
                <input
                  type="date"
                  defaultValue={detailAsset.warranty_start || ''}
                  onBlur={e => saveDetail({ warrantyStart: e.target.value || null })}
                  className={inputClass}
                  disabled={actingOn === detailAsset.id}
                />
              </Field>
              <Field label="Warranty End">
                <input
                  type="date"
                  defaultValue={detailAsset.warranty_end || ''}
                  onBlur={e => saveDetail({ warrantyEnd: e.target.value || null })}
                  className={inputClass}
                  disabled={actingOn === detailAsset.id}
                />
              </Field>
              <Field label="Warranty Provider">
                <input
                  defaultValue={detailAsset.warranty_provider || ''}
                  onBlur={e => saveDetail({ warrantyProvider: e.target.value })}
                  className={inputClass}
                  disabled={actingOn === detailAsset.id}
                />
              </Field>
              <Field label="Description">
                <textarea
                  defaultValue={detailAsset.description || ''}
                  onBlur={e => saveDetail({ description: e.target.value })}
                  rows={2}
                  className={inputClass}
                  disabled={actingOn === detailAsset.id}
                />
              </Field>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100 dark:border-slate-700">
              <button
                onClick={() => { removeAsset(detailAsset.id); }}
                disabled={actingOn === detailAsset.id}
                className={button.ghost + ' text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 ml-auto disabled:opacity-50'}
              >
                <Trash2 className="w-4 h-4 inline mr-1" /> Delete
              </button>
            </div>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default EquipmentRegistry;
