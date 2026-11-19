/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Laundry Interface module — docs/Housekeeping Portal new.md §13.
 * Pickup Requests, Delivery Status, Guest Laundry Tracking, Uniform Laundry,
 * Linen Laundry, Laundry Exceptions.
 *
 * DB-integrated: fetches and persists via /api/hk-portal/laundry/*.
 *   GET  /laundry/:propertyId          → { jobs, summary }
 *   POST /laundry                       → create a new pickup request
 *   PUT  /laundry/:id/advance           → advance job to next status
 *   PUT  /laundry/:id/resolve-exception → clear the exception note
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useERP } from '../../context/ERPContext';
import {
  HandPlatter,
  Truck,
  User,
  Shirt,
  Layers,
  AlertTriangle,
  Plus,
  Search,
  Package,
  Loader2,
  ServerCrash,
  RefreshCw,
  X,
  CheckCircle2,
  Droplet,
  Trash2,
  FlaskConical,
  type LucideIcon,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';

type LaundryCategory = 'Guest' | 'Uniform' | 'Linen';
type LaundryStatus = 'Pickup Requested' | 'Collected' | 'Washing' | 'Drying' | 'Ironing' | 'Ready' | 'Delivered';
type ServiceType = 'Wash' | 'Dry Clean' | 'Iron' | 'Express Service';

const CATEGORY_LIST: LaundryCategory[] = ['Guest', 'Uniform', 'Linen'];
const SERVICE_LIST: ServiceType[] = ['Wash', 'Dry Clean', 'Iron', 'Express Service'];
const STATUS_FLOW: LaundryStatus[] = ['Pickup Requested', 'Collected', 'Washing', 'Drying', 'Ironing', 'Ready', 'Delivered'];

interface LaundryJob {
  id: string;
  category: LaundryCategory;
  serviceType: ServiceType;
  pieces: number;
  status: LaundryStatus;
  guestName?: string;
  roomNumber?: string;
  staff?: string;
  requestedAt: string;
  eta?: string;
  exception?: string;
  updatedAt: string;
}

interface LaundrySummary {
  pickupRequests: number;
  inDelivery: number;
  guest: number;
  uniform: number;
  linen: number;
  exceptions: number;
}

interface LaundryData {
  propertyId: string;
  jobs: LaundryJob[];
  summary: LaundrySummary;
  generatedAt: string;
}

type ConsumptionCategory = 'Chemical' | 'Utility' | 'Supply';

interface ConsumptionEntry {
  id: string;
  propertyId: string;
  jobId?: string;
  supplyName: string;
  category: ConsumptionCategory;
  unit: string;
  quantity: number;
  recordedBy?: string;
  note?: string;
  recordedAt: string;
}

interface ConsumptionSummary {
  totalEntries: number;
  bySupply: { supplyName: string; category: ConsumptionCategory; unit: string; total: number }[];
  byCategory: { category: ConsumptionCategory; total: number }[];
}

interface ConsumptionData {
  propertyId: string;
  entries: ConsumptionEntry[];
  summary: ConsumptionSummary;
  generatedAt: string;
}

const categoryMeta: Record<LaundryCategory, { icon: LucideIcon; color: string; bg: string }> = {
  Guest: { icon: User, color: 'text-indigo-500', bg: 'bg-indigo-50 dark:bg-indigo-500/10' },
  Uniform: { icon: Shirt, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-500/10' },
  Linen: { icon: Layers, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
};

const STATUS_TONE: Record<LaundryStatus, StatusTone> = {
  'Pickup Requested': 'warning',
  Collected: 'info',
  Washing: 'info',
  Drying: 'info',
  Ironing: 'accent',
  Ready: 'neutral',
  Delivered: 'success',
};

// ── Sub-tab definitions ────────────────────────────────────────────────

type SubTab = 'jobs' | 'exceptions' | 'consumption';

const SUB_TABS: { id: SubTab; label: string; icon: LucideIcon }[] = [
  { id: 'jobs', label: 'Laundry Jobs', icon: HandPlatter },
  { id: 'exceptions', label: 'Exceptions', icon: AlertTriangle },
  { id: 'consumption', label: 'Consumption', icon: Droplet },
];

const CONSUMPTION_CATEGORIES: ConsumptionCategory[] = ['Chemical', 'Utility', 'Supply'];

// ── Helpers ────────────────────────────────────────────────────────────

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return '—'; }
}

// ── New Pickup modal ───────────────────────────────────────────────────

interface PickupForm {
  category: LaundryCategory;
  serviceType: ServiceType;
  pieces: number;
  guestName: string;
  roomNumber: string;
  staff: string;
  eta: string;
}

function NewPickupModal({
  open,
  onClose,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (form: PickupForm) => Promise<void>;
  submitting: boolean;
}) {
  const [form, setForm] = useState<PickupForm>({
    category: 'Guest',
    serviceType: 'Wash',
    pieces: 1,
    guestName: '',
    roomNumber: '',
    staff: '',
    eta: '',
  });

  useEffect(() => {
    if (open) {
      setForm({ category: 'Guest', serviceType: 'Wash', pieces: 1, guestName: '', roomNumber: '', staff: '', eta: '' });
    }
  }, [open]);

  if (!open) return null;

  const isGuest = form.category === 'Guest';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <HandPlatter size={18} className="text-[var(--color-accent-operations)]" />
            <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">New Pickup Request</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Category */}
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Category</label>
            <div className="grid grid-cols-3 gap-2">
              {CATEGORY_LIST.map(c => {
                const meta = categoryMeta[c];
                const Icon = meta.icon;
                const active = form.category === c;
                return (
                  <button
                    key={c}
                    onClick={() => setForm(f => ({ ...f, category: c }))}
                    className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl border transition-all ${
                      active ? `${meta.bg} ${meta.color} border-current` : 'border-slate-200 dark:border-slate-800 text-slate-500 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <Icon size={14} />
                    <span className="text-[10px] font-bold">{c}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Service + Pieces */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Service Type</label>
              <select
                value={form.serviceType}
                onChange={e => setForm(f => ({ ...f, serviceType: e.target.value as ServiceType }))}
                className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none cursor-pointer"
              >
                {SERVICE_LIST.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Pieces</label>
              <input
                type="number"
                min={1}
                value={form.pieces}
                onChange={e => setForm(f => ({ ...f, pieces: Math.max(1, parseInt(e.target.value) || 1) }))}
                className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Guest fields OR staff field */}
          {isGuest ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Guest Name</label>
                <input
                  type="text"
                  value={form.guestName}
                  onChange={e => setForm(f => ({ ...f, guestName: e.target.value }))}
                  placeholder="J. Smith"
                  className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Room Number</label>
                <input
                  type="text"
                  value={form.roomNumber}
                  onChange={e => setForm(f => ({ ...f, roomNumber: e.target.value }))}
                  placeholder="204"
                  className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Staff / Team</label>
              <input
                type="text"
                value={form.staff}
                onChange={e => setForm(f => ({ ...f, staff: e.target.value }))}
                placeholder="Housekeeping Team, Linen Room…"
                className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          )}

          {/* ETA */}
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">ETA (optional)</label>
            <input
              type="text"
              value={form.eta}
              onChange={e => setForm(f => ({ ...f, eta: e.target.value }))}
              placeholder="11:00 AM"
              className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-5 border-t border-slate-100 dark:border-slate-800">
          <button onClick={onClose} className={button.secondary}>Cancel</button>
          <button
            onClick={() => onSubmit(form)}
            disabled={submitting}
            className={button.primary + ' flex items-center gap-1.5 disabled:opacity-50'}
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Create Request
          </button>
        </div>
      </div>
    </div>
  );
}

// ── New Consumption modal ──────────────────────────────────────────────

interface ConsumptionForm {
  supplyName: string;
  category: ConsumptionCategory;
  unit: string;
  quantity: string;
  jobId: string;
  note: string;
}

const COMMON_SUPPLIES = ['Detergent', 'Softener', 'Bleach', 'Stain Remover', 'Water', 'Electricity', 'Gas'];
const COMMON_UNITS = ['L', 'mL', 'kg', 'g', 'kWh', 'pcs'];

function NewConsumptionModal({
  open,
  onClose,
  onSubmit,
  submitting,
  jobs,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (form: ConsumptionForm) => Promise<void>;
  submitting: boolean;
  jobs: LaundryJob[];
}) {
  const [form, setForm] = useState<ConsumptionForm>({
    supplyName: 'Detergent',
    category: 'Chemical',
    unit: 'L',
    quantity: '1',
    jobId: '',
    note: '',
  });

  useEffect(() => {
    if (open) {
      setForm({ supplyName: 'Detergent', category: 'Chemical', unit: 'L', quantity: '1', jobId: '', note: '' });
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <Droplet size={18} className="text-[var(--color-accent-operations)]" />
            <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">Log Consumption</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Supply name + category */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Supply</label>
              <input
                type="text"
                list="laundry-supply-list"
                value={form.supplyName}
                onChange={e => setForm(f => ({ ...f, supplyName: e.target.value }))}
                placeholder="Detergent"
                className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <datalist id="laundry-supply-list">
                {COMMON_SUPPLIES.map(s => <option key={s} value={s} />)}
              </datalist>
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Category</label>
              <select
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value as ConsumptionCategory }))}
                className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none cursor-pointer"
              >
                {CONSUMPTION_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Unit + quantity */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Unit</label>
              <input
                type="text"
                list="laundry-unit-list"
                value={form.unit}
                onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                placeholder="L"
                className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <datalist id="laundry-unit-list">
                {COMMON_UNITS.map(u => <option key={u} value={u} />)}
              </datalist>
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Quantity</label>
              <input
                type="number"
                min={0}
                step="any"
                value={form.quantity}
                onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Optional job link */}
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Linked Job (optional)</label>
            <select
              value={form.jobId}
              onChange={e => setForm(f => ({ ...f, jobId: e.target.value }))}
              className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none cursor-pointer"
            >
              <option value="">— None —</option>
              {jobs.map(j => (
                <option key={j.id} value={j.id}>
                  {j.id} · {j.category} · {j.serviceType} ({j.status})
                </option>
              ))}
            </select>
          </div>

          {/* Note */}
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Note (optional)</label>
            <input
              type="text"
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              placeholder="Spill, calibration, top-up…"
              className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-5 border-t border-slate-100 dark:border-slate-800">
          <button onClick={onClose} className={button.secondary}>Cancel</button>
          <button
            onClick={() => onSubmit(form)}
            disabled={submitting}
            className={button.primary + ' flex items-center gap-1.5 disabled:opacity-50'}
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Log Entry
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────

export default function LaundryModule() {
  const { currentPropertyId, addNotification } = useERP();
  const [data, setData] = useState<LaundryData | null>(null);
  const [consumption, setConsumption] = useState<ConsumptionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catFilter, setCatFilter] = useState<'All' | LaundryCategory>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | LaundryStatus>('All');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [consumptionModalOpen, setConsumptionModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<SubTab>('jobs');

  const fetchLaundry = useCallback(async () => {
    if (!currentPropertyId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/hk-portal/laundry/${currentPropertyId}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load laundry data (${res.status})`);
      const json = (await res.json()) as LaundryData;
      setData(json);
    } catch (e: any) {
      setError(e?.message || 'Failed to load laundry data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  const fetchConsumption = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hk-portal/laundry/consumption/${currentPropertyId}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load consumption data (${res.status})`);
      const json = (await res.json()) as ConsumptionData;
      setConsumption(json);
    } catch (e: any) {
      // Non-fatal — consumption sub-tab just shows empty state.
      setConsumption(null);
    }
  }, [currentPropertyId]);

  useEffect(() => { fetchLaundry(); }, [fetchLaundry]);
  useEffect(() => { fetchConsumption(); }, [fetchConsumption]);

  const jobs = data?.jobs || [];

  // Recompute the summary locally from the current jobs so the StatCards
  // stay in sync after optimistic mutations (advance / resolve / new pickup)
  // without waiting for a full refetch.
  const summary: LaundrySummary = useMemo(() => ({
    pickupRequests: jobs.filter(j => j.status === 'Pickup Requested').length,
    inDelivery: jobs.filter(j => j.status === 'Ready' || j.status === 'Delivered').length,
    guest: jobs.filter(j => j.category === 'Guest').length,
    uniform: jobs.filter(j => j.category === 'Uniform').length,
    linen: jobs.filter(j => j.category === 'Linen').length,
    exceptions: jobs.filter(j => j.exception).length,
  }), [jobs]);

  const filtered = useMemo(
    () =>
      jobs.filter(j => {
        const matchesCat = catFilter === 'All' || j.category === catFilter;
        const matchesStatus = statusFilter === 'All' || j.status === statusFilter;
        const matchesSearch =
          (j.guestName?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
          (j.roomNumber?.includes(search) ?? false) ||
          (j.staff?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
          j.id.toLowerCase().includes(search.toLowerCase());
        return matchesCat && matchesStatus && matchesSearch;
      }),
    [jobs, catFilter, statusFilter, search]
  );

  const exceptions = useMemo(() => jobs.filter(j => j.exception), [jobs]);

  // ── Actions ──────────────────────────────────────────────────────────

  const advance = async (id: string) => {
    setActionLoading(`advance-${id}`);
    try {
      const res = await fetch(`/api/hk-portal/laundry/${id}/advance`, { method: 'PUT', headers: authHeaders(true) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to advance job (${res.status})`);
      }
      const result = (await res.json()) as { job: LaundryJob };
      setData(prev => prev ? { ...prev, jobs: prev.jobs.map(j => j.id === id ? result.job : j) } : prev);
      addNotification(`Job ${id} advanced to ${result.job.status}`, 'info', 'Housekeeping');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to advance job', 'danger', 'Housekeeping');
    } finally {
      setActionLoading(null);
    }
  };

  const handleResolveException = async (id: string) => {
    setActionLoading(`resolve-${id}`);
    try {
      const res = await fetch(`/api/hk-portal/laundry/${id}/resolve-exception`, { method: 'PUT', headers: authHeaders(true) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to resolve exception (${res.status})`);
      }
      const result = (await res.json()) as { job: LaundryJob };
      setData(prev => prev ? { ...prev, jobs: prev.jobs.map(j => j.id === id ? result.job : j) } : prev);
      addNotification(`Exception for ${id} resolved`, 'success', 'Housekeeping');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to resolve exception', 'danger', 'Housekeeping');
    } finally {
      setActionLoading(null);
    }
  };

  const handleNewPickup = async (form: PickupForm) => {
    if (!currentPropertyId) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/hk-portal/laundry', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          propertyId: currentPropertyId,
          category: form.category,
          serviceType: form.serviceType,
          pieces: form.pieces,
          guestName: form.guestName || undefined,
          roomNumber: form.roomNumber || undefined,
          staff: form.staff || undefined,
          eta: form.eta || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to create pickup request (${res.status})`);
      }
      const result = (await res.json()) as { job: LaundryJob };
      setData(prev => prev ? { ...prev, jobs: [result.job, ...prev.jobs] } : prev);
      addNotification(`Pickup request ${result.job.id} created`, 'success', 'Housekeeping');
      setModalOpen(false);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create pickup request', 'danger', 'Housekeeping');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogConsumption = async (form: ConsumptionForm) => {
    if (!currentPropertyId) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/hk-portal/laundry/consumption', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          propertyId: currentPropertyId,
          jobId: form.jobId || undefined,
          supplyName: form.supplyName,
          category: form.category,
          unit: form.unit,
          quantity: Number(form.quantity) || 0,
          note: form.note || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to log consumption (${res.status})`);
      }
      const result = (await res.json()) as { entry: ConsumptionEntry };
      setConsumption(prev => prev
        ? { ...prev, entries: [result.entry, ...prev.entries] }
        : { propertyId: currentPropertyId, entries: [result.entry], summary: { totalEntries: 1, bySupply: [], byCategory: [] }, generatedAt: new Date().toISOString() }
      );
      addNotification(`Consumption logged: ${result.entry.supplyName} (${result.entry.quantity} ${result.entry.unit})`, 'success', 'Housekeeping');
      setConsumptionModalOpen(false);
      // Refetch to refresh the aggregated summary.
      fetchConsumption();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to log consumption', 'danger', 'Housekeeping');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteConsumption = async (id: string) => {
    setActionLoading(`del-cons-${id}`);
    try {
      const res = await fetch(`/api/hk-portal/laundry/consumption/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to delete entry (${res.status})`);
      }
      setConsumption(prev => prev ? { ...prev, entries: prev.entries.filter(e => e.id !== id) } : prev);
      addNotification(`Consumption entry ${id} deleted`, 'info', 'Housekeeping');
      fetchConsumption();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete consumption entry', 'danger', 'Housekeeping');
    } finally {
      setActionLoading(null);
    }
  };

  // ── Loading / Error states ───────────────────────────────────────────

  if (loading && !data) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Laundry Interface" subtitle="Pickups, delivery & exceptions." icon={HandPlatter} />
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="animate-spin text-[var(--color-accent-operations)]" size={32} />
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Loading laundry data…</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Laundry Interface" subtitle="Pickups, delivery & exceptions." icon={HandPlatter} />
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <ServerCrash className="text-rose-500" size={32} />
          <p className="text-xs font-bold text-rose-500 uppercase tracking-wider">{error}</p>
          <button onClick={fetchLaundry} className={`mt-3 ${button.secondary}`}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Laundry Interface"
        subtitle="Pickups, delivery, guest/uniform/linen laundry & exceptions."
        icon={HandPlatter}
        actions={
          <div className="flex items-center gap-3">
            {data?.generatedAt && (
              <span className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500 font-medium">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                Updated {formatDateTime(data.generatedAt)}
              </span>
            )}
            <button onClick={fetchLaundry} disabled={loading} className={button.secondary + ' flex items-center gap-1.5'}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button onClick={() => setModalOpen(true)} className={button.primary + ' flex items-center gap-1.5'}>
              <Plus size={14} /> New Pickup Request
            </button>
          </div>
        }
      />

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard title="Pickup Requests" value={summary.pickupRequests} icon={HandPlatter} tone="warning" />
        <StatCard title="In Delivery" value={summary.inDelivery} icon={Truck} tone="success" />
        <StatCard title="Guest Laundry" value={summary.guest} icon={User} tone="info" />
        <StatCard title="Uniform Laundry" value={summary.uniform} icon={Shirt} tone="accent" />
        <StatCard title="Linen Laundry" value={summary.linen} icon={Layers} tone="neutral" />
        <StatCard title="Exceptions" value={summary.exceptions} icon={AlertTriangle} tone="danger" />
      </div>

      {/* Sub-tab navigation */}
      <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto">
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all whitespace-nowrap ${
              subTab === t.id
                ? 'bg-white dark:bg-slate-700 text-[var(--color-accent-operations)] shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <t.icon className="w-4 h-4" />
            <span className="text-sm font-medium">{t.label}</span>
            {t.id === 'exceptions' && exceptions.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-bold bg-[var(--color-danger)]/15 text-[var(--color-danger)]">{exceptions.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Exceptions sub-tab ───────────────────────────────────────── */}
      {subTab === 'exceptions' && (
        <SectionCard
          title="Laundry Exceptions"
          subtitle="Jobs with outstanding issues requiring attention"
          icon={AlertTriangle}
          tone="danger"
          pad="md"
        >
          {exceptions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <CheckCircle2 className="text-emerald-500" size={28} />
              <p className="text-xs font-bold text-slate-400 uppercase">No exceptions — all jobs are on track.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {exceptions.map(e => {
                const meta = categoryMeta[e.category];
                const Icon = meta.icon;
                return (
                  <div key={e.id} className="flex items-center justify-between bg-white dark:bg-slate-900 rounded-2xl p-3 border border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`p-2 rounded-xl ${meta.bg} ${meta.color} shrink-0`}>
                        <Icon size={14} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-black text-slate-900 dark:text-white">{e.id} · {e.category} Laundry</p>
                        <p className="text-[10px] text-slate-500 font-bold truncate">{e.exception}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleResolveException(e.id)}
                      disabled={actionLoading === `resolve-${e.id}`}
                      className="px-3 py-1.5 bg-rose-600 text-white rounded-lg text-[9px] font-black uppercase hover:bg-rose-700 transition disabled:opacity-50 flex items-center gap-1.5 shrink-0"
                    >
                      {actionLoading === `resolve-${e.id}` ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                      Resolve
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      )}

      {/* ── Laundry Jobs sub-tab ─────────────────────────────────────── */}
      {subTab === 'jobs' && (
        <>
          {/* Filters */}
          <SectionCard pad="md">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <select
                  value={catFilter}
                  onChange={e => setCatFilter(e.target.value as 'All' | LaundryCategory)}
                  className="bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-[10px] font-bold text-slate-600 dark:text-slate-200 outline-none cursor-pointer"
                >
                  <option value="All">All Categories</option>
                  {CATEGORY_LIST.map(c => <option key={c} value={c}>{c} Laundry</option>)}
                </select>
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value as 'All' | LaundryStatus)}
                  className="bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-[10px] font-bold text-slate-600 dark:text-slate-200 outline-none cursor-pointer"
                >
                  <option value="All">All Statuses</option>
                  {STATUS_FLOW.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="relative w-full max-w-xs">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  placeholder="Search guest, room, staff, ID..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl text-xs outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
                />
              </div>
            </div>
          </SectionCard>

          {/* Jobs list */}
          <SectionCard pad="none" bodyClassName="divide-y divide-slate-50 dark:divide-slate-800">
            {filtered.map(j => {
              const meta = categoryMeta[j.category];
              const Icon = meta.icon;
              return (
                <div key={j.id} className="p-4 flex flex-col md:flex-row md:items-center gap-4">
                  <div className="flex items-center gap-3 md:w-56 shrink-0">
                    <div className={`p-2 rounded-xl ${meta.bg} ${meta.color}`}><Icon size={16} /></div>
                    <div>
                      <h4 className="text-[11px] font-black text-slate-900 dark:text-white uppercase">{j.category} Laundry</h4>
                      <p className="text-[9px] text-slate-400 font-mono">{j.id} · {j.serviceType}</p>
                    </div>
                  </div>
                  <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-3 text-[10px] font-mono">
                    <div>
                      <span className="block text-[8px] font-black text-slate-400 uppercase">Refers To</span>
                      <span className="font-bold text-slate-700 dark:text-slate-200">{j.guestName ? `${j.guestName} (Rm ${j.roomNumber})` : j.staff || '—'}</span>
                    </div>
                    <div>
                      <span className="block text-[8px] font-black text-slate-400 uppercase">Pieces</span>
                      <span className="font-bold text-slate-700 dark:text-slate-200">{j.pieces}</span>
                    </div>
                    <div>
                      <span className="block text-[8px] font-black text-slate-400 uppercase">Requested</span>
                      <span className="font-bold text-slate-700 dark:text-slate-200">{j.requestedAt || '—'}</span>
                    </div>
                    <div>
                      <span className="block text-[8px] font-black text-slate-400 uppercase">ETA</span>
                      <span className="font-bold text-slate-700 dark:text-slate-200">{j.eta || '—'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 md:w-44 shrink-0">
                    <Badge tone={STATUS_TONE[j.status]} variant="soft">{j.status}</Badge>
                    {j.status !== 'Delivered' && (
                      <button
                        onClick={() => advance(j.id)}
                        disabled={actionLoading === `advance-${j.id}`}
                        className="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-600 hover:text-white rounded-lg text-[9px] font-black uppercase transition disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {actionLoading === `advance-${j.id}` ? <Loader2 size={11} className="animate-spin" /> : <Package size={11} />}
                        Advance
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && <div className="p-8 text-center text-[10px] font-bold text-slate-400 uppercase">No laundry jobs match the filters.</div>}
          </SectionCard>
        </>
      )}

      {/* ── Consumption sub-tab ──────────────────────────────────────── */}
      {subTab === 'consumption' && (
        <>
          {/* Summary by supply */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {consumption?.summary.byCategory.map(c => (
              <StatCard
                key={c.category}
                title={c.category}
                value={c.total}
                icon={c.category === 'Utility' ? Droplet : FlaskConical}
                tone={c.category === 'Chemical' ? 'info' : c.category === 'Utility' ? 'accent' : 'neutral'}
              />
            ))}
            {consumption?.summary.byCategory.length === 0 && (
              <div className="col-span-full text-center text-[10px] font-bold text-slate-400 uppercase py-6">
                No consumption recorded yet.
              </div>
            )}
          </div>

          {/* Per-supply breakdown */}
          {consumption && consumption.summary.bySupply.length > 0 && (
            <SectionCard title="Supply Breakdown" subtitle="Total quantity consumed per supply" icon={FlaskConical} pad="md">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {consumption.summary.bySupply.map(s => (
                  <div key={`${s.supplyName}-${s.unit}`} className="flex items-center justify-between bg-slate-50 dark:bg-slate-850 rounded-xl px-3 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <Droplet size={14} className="text-[var(--color-accent-operations)] shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[11px] font-black text-slate-900 dark:text-white truncate">{s.supplyName}</p>
                        <p className="text-[9px] text-slate-400 font-bold uppercase">{s.category}</p>
                      </div>
                    </div>
                    <span className="text-[11px] font-mono font-bold text-slate-700 dark:text-slate-200 shrink-0">{s.total} {s.unit}</span>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {/* Consumption log */}
          <SectionCard
            title="Consumption Log"
            subtitle="Supplies consumed by the laundry operation"
            icon={Droplet}
            pad="none"
            actions={
              <button onClick={() => setConsumptionModalOpen(true)} className={button.primary + ' flex items-center gap-1.5'}>
                <Plus size={14} /> Log Consumption
              </button>
            }
            bodyClassName="divide-y divide-slate-50 dark:divide-slate-800"
          >
            {(consumption?.entries || []).map(e => (
              <div key={e.id} className="p-4 flex flex-col md:flex-row md:items-center gap-4">
                <div className="flex items-center gap-3 md:w-56 shrink-0">
                  <div className="p-2 rounded-xl bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]">
                    <Droplet size={16} />
                  </div>
                  <div>
                    <h4 className="text-[11px] font-black text-slate-900 dark:text-white uppercase">{e.supplyName}</h4>
                    <p className="text-[9px] text-slate-400 font-mono">{e.id} · {e.category}</p>
                  </div>
                </div>
                <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-3 text-[10px] font-mono">
                  <div>
                    <span className="block text-[8px] font-black text-slate-400 uppercase">Quantity</span>
                    <span className="font-bold text-slate-700 dark:text-slate-200">{e.quantity} {e.unit}</span>
                  </div>
                  <div>
                    <span className="block text-[8px] font-black text-slate-400 uppercase">Linked Job</span>
                    <span className="font-bold text-slate-700 dark:text-slate-200">{e.jobId || '—'}</span>
                  </div>
                  <div>
                    <span className="block text-[8px] font-black text-slate-400 uppercase">Recorded</span>
                    <span className="font-bold text-slate-700 dark:text-slate-200">{formatDateTime(e.recordedAt)}</span>
                  </div>
                  <div>
                    <span className="block text-[8px] font-black text-slate-400 uppercase">Note</span>
                    <span className="font-bold text-slate-700 dark:text-slate-200 truncate">{e.note || '—'}</span>
                  </div>
                </div>
                <div className="flex items-center md:w-20 shrink-0 justify-end">
                  <button
                    onClick={() => handleDeleteConsumption(e.id)}
                    disabled={actionLoading === `del-cons-${e.id}`}
                    className="px-3 py-1.5 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-600 hover:text-white rounded-lg text-[9px] font-black uppercase transition disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {actionLoading === `del-cons-${e.id}` ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                    Delete
                  </button>
                </div>
              </div>
            ))}
            {(consumption?.entries || []).length === 0 && (
              <div className="p-8 text-center text-[10px] font-bold text-slate-400 uppercase">No consumption entries yet. Click "Log Consumption" to add one.</div>
            )}
          </SectionCard>
        </>
      )}

      <NewPickupModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleNewPickup}
        submitting={submitting}
      />
      <NewConsumptionModal
        open={consumptionModalOpen}
        onClose={() => setConsumptionModalOpen(false)}
        onSubmit={handleLogConsumption}
        submitting={submitting}
        jobs={jobs}
      />
    </div>
  );
}
