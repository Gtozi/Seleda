/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Amenities Management module — docs/Housekeeping Portal new.md §14.
 * Guest amenities (12 types) with Consumption Recording, Replenishment,
 * and Shortage Reporting.
 *
 * DB-integrated: fetches and persists via /api/hk-portal/amenities/*.
 *   GET  /amenities/:propertyId   → { stock, log, totals, shortages }
 *   POST /amenities/consume        → record consumption (decrement stock)
 *   POST /amenities/replenish      → replenish to par level
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  SoapDispenserDroplet,
  Droplet,
  FlaskConical,
  ShowerHead,
  Hand,
  BrushCleaning,
  Scissors,
  PenTool,
  Footprints,
  GlassWater,
  Coffee,
  PenLine,
  Plus,
  Search,
  ArrowDownToLine,
  AlertTriangle,
  TrendingDown,
  Loader2,
  ServerCrash,
  RefreshCw,
  X,
  ClipboardList,
  type LucideIcon,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';

type AmenityType =
  | 'Soap' | 'Shampoo' | 'Conditioner' | 'Body Wash' | 'Lotion'
  | 'Toothbrush Kit' | 'Shaving Kit' | 'Sewing Kit' | 'Slippers'
  | 'Water Bottles' | 'Tea & Coffee' | 'Stationery';

const AMENITY_LIST: AmenityType[] = [
  'Soap', 'Shampoo', 'Conditioner', 'Body Wash', 'Lotion',
  'Toothbrush Kit', 'Shaving Kit', 'Sewing Kit', 'Slippers',
  'Water Bottles', 'Tea & Coffee', 'Stationery',
];

interface AmenityStock {
  id: string;
  type: AmenityType;
  par: number;
  inStock: number;
  consumedToday: number;
  inventoryItemId?: string | null;
  updatedAt: string;
}

interface AmenityLogEntry {
  id: string;
  action: 'Consumption' | 'Replenishment';
  type: AmenityType;
  quantity: number;
  room: string;
  staff: string;
  createdAt: string;
}

interface AmenityTotals {
  par: number;
  inStock: number;
  consumedToday: number;
}

interface AmenityData {
  propertyId: string;
  stock: AmenityStock[];
  log: AmenityLogEntry[];
  totals: AmenityTotals;
  shortages: number;
  generatedAt: string;
}

const AMENITY_META: Record<AmenityType, { icon: LucideIcon }> = {
  Soap: { icon: SoapDispenserDroplet },
  Shampoo: { icon: Droplet },
  Conditioner: { icon: FlaskConical },
  'Body Wash': { icon: ShowerHead },
  Lotion: { icon: Hand },
  'Toothbrush Kit': { icon: BrushCleaning },
  'Shaving Kit': { icon: Scissors },
  'Sewing Kit': { icon: PenTool },
  Slippers: { icon: Footprints },
  'Water Bottles': { icon: GlassWater },
  'Tea & Coffee': { icon: Coffee },
  Stationery: { icon: PenLine },
};

// ── Sub-tab definitions ────────────────────────────────────────────────

type SubTab = 'inventory' | 'log';

const SUB_TABS: { id: SubTab; label: string; icon: LucideIcon }[] = [
  { id: 'inventory', label: 'Inventory', icon: SoapDispenserDroplet },
  { id: 'log', label: 'Consumption Log', icon: ClipboardList },
];

// ── Helpers ────────────────────────────────────────────────────────────

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

function formatTime(iso: string): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch { return '—'; }
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return '—'; }
}

// ── Consumption modal ──────────────────────────────────────────────────

interface ConsumptionForm {
  type: AmenityType;
  quantity: number;
  room: string;
  staff: string;
}

function ConsumptionModal({
  open,
  onClose,
  onSubmit,
  submitting,
  stock,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (form: ConsumptionForm) => Promise<void>;
  submitting: boolean;
  stock: AmenityStock[];
}) {
  const [form, setForm] = useState<ConsumptionForm>({
    type: 'Water Bottles',
    quantity: 1,
    room: '',
    staff: '',
  });

  useEffect(() => {
    if (open) {
      setForm({ type: stock[0]?.type || 'Water Bottles', quantity: 1, room: '', staff: '' });
    }
  }, [open, stock]);

  if (!open) return null;

  const selected = stock.find(s => s.type === form.type);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <TrendingDown size={18} className="text-amber-500" />
            <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">Record Consumption</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Amenity Type</label>
            <select
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value as AmenityType }))}
              className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none cursor-pointer"
            >
              {AMENITY_LIST.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {selected && (
            <div className="text-[10px] font-mono text-slate-400 bg-slate-50 dark:bg-slate-850 rounded-lg px-3 py-2">
              Current stock: {selected.inStock} / {selected.par} · Consumed today: {selected.consumedToday}
              {form.quantity > selected.inStock && (
                <span className="text-amber-500 font-bold ml-2">⚠ exceeds available stock</span>
              )}
            </div>
          )}

          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Quantity</label>
            <input
              type="number"
              min={1}
              value={form.quantity}
              onChange={e => setForm(f => ({ ...f, quantity: Math.max(1, parseInt(e.target.value) || 1) }))}
              className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Room</label>
              <input
                type="text"
                value={form.room}
                onChange={e => setForm(f => ({ ...f, room: e.target.value }))}
                placeholder="204"
                className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Staff</label>
              <input
                type="text"
                value={form.staff}
                onChange={e => setForm(f => ({ ...f, staff: e.target.value }))}
                placeholder="Maria S."
                className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
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
            Record
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────

export default function GuestAmenitiesModule() {
  const { currentPropertyId, addNotification } = useERP();
  const [data, setData] = useState<AmenityData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<SubTab>('inventory');
  const [linkableItems, setLinkableItems] = useState<{ id: string; name: string }[]>([]);
  const [linking, setLinking] = useState<string | null>(null);

  const fetchLinkableItems = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(
        `/api/hk-portal/inventory/linkable/${currentPropertyId}?category=AMEN`,
        { headers: authHeaders() }
      );
      if (res.ok) {
        const json = await res.json();
        setLinkableItems(json.items || []);
      }
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  useEffect(() => { fetchLinkableItems(); }, [fetchLinkableItems]);

  const fetchAmenities = useCallback(async () => {
    if (!currentPropertyId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/hk-portal/amenities/${currentPropertyId}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load amenities data (${res.status})`);
      const json = (await res.json()) as AmenityData;
      setData(json);
    } catch (e: any) {
      setError(e?.message || 'Failed to load amenities data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { fetchAmenities(); }, [fetchAmenities]);

  const stock = data?.stock || [];
  const log = data?.log || [];
  const totals = data?.totals || { par: 0, inStock: 0, consumedToday: 0 };
  const shortagesCount = data?.shortages || 0;

  const shortages = useMemo(() => stock.filter(s => s.par > 0 && s.inStock < s.par * 0.5), [stock]);

  const filteredStock = useMemo(
    () => stock.filter(s => s.type.toLowerCase().includes(search.toLowerCase())),
    [stock, search]
  );

  // ── Actions ──────────────────────────────────────────────────────────

  const recordConsumption = async (form: ConsumptionForm) => {
    if (!currentPropertyId) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/hk-portal/amenities/consume', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          propertyId: currentPropertyId,
          type: form.type,
          quantity: form.quantity,
          room: form.room || undefined,
          staff: form.staff || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to record consumption (${res.status})`);
      }
      const result = (await res.json()) as { stock: AmenityStock; log: AmenityLogEntry; inventoryWarning?: string };
      setData(prev => prev ? {
        ...prev,
        stock: prev.stock.map(s => s.type === result.stock.type ? result.stock : s),
        log: [result.log, ...prev.log],
        totals: {
          par: prev.totals.par,
          inStock: prev.stock.reduce((sum, s) => sum + (s.type === result.stock.type ? result.stock.inStock : s.inStock), 0),
          consumedToday: prev.stock.reduce((sum, s) => sum + (s.type === result.stock.type ? result.stock.consumedToday : s.consumedToday), 0),
        },
        shortages: prev.stock.filter(s => s.par > 0 && (s.type === result.stock.type ? result.stock.inStock : s.inStock) < s.par * 0.5).length,
      } : prev);
      addNotification(`Consumption recorded: ${form.quantity}× ${form.type}`, 'info', 'Housekeeping');
      // Surface the HK-store linkage warning so stock drift is never silent.
      if (result.inventoryWarning) addNotification(result.inventoryWarning, 'warning', 'Housekeeping');
      setModalOpen(false);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to record consumption', 'danger', 'Housekeeping');
    } finally {
      setSubmitting(false);
    }
  };

  const replenish = async (type: AmenityType) => {
    if (!currentPropertyId) return;
    setActionLoading(`replenish-${type}`);
    try {
      const res = await fetch('/api/hk-portal/amenities/replenish', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ propertyId: currentPropertyId, type }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to replenish (${res.status})`);
      }
      const result = (await res.json()) as { stock: AmenityStock; log: AmenityLogEntry; inventoryWarning?: string };
      setData(prev => prev ? {
        ...prev,
        stock: prev.stock.map(s => s.type === type ? result.stock : s),
        log: [result.log, ...prev.log],
        totals: {
          par: prev.totals.par,
          inStock: prev.stock.reduce((sum, s) => sum + (s.type === type ? result.stock.inStock : s.inStock), 0),
          consumedToday: prev.totals.consumedToday,
        },
        shortages: prev.stock.filter(s => s.par > 0 && (s.type === type ? result.stock.inStock : s.inStock) < s.par * 0.5).length,
      } : prev);
      addNotification(`${type} replenished to par level`, 'success', 'Housekeeping');
      // Surface the HK-store linkage warning so stock drift is never silent.
      if (result.inventoryWarning) addNotification(result.inventoryWarning, 'warning', 'Housekeeping');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to replenish', 'danger', 'Housekeeping');
    } finally {
      setActionLoading(null);
    }
  };

  // ── Loading / Error states ───────────────────────────────────────────

  if (loading && !data) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Amenities Management" subtitle="Guest amenities — consumption, replenishment & shortages." icon={SoapDispenserDroplet} />
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="animate-spin text-[var(--color-accent-operations)]" size={32} />
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Loading amenities data…</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Amenities Management" subtitle="Guest amenities — consumption, replenishment & shortages." icon={SoapDispenserDroplet} />
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <ServerCrash className="text-rose-500" size={32} />
          <p className="text-xs font-bold text-rose-500 uppercase tracking-wider">{error}</p>
          <button onClick={fetchAmenities} className={`mt-3 ${button.secondary}`}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Amenities Management"
        subtitle="Guest amenities — consumption, replenishment & shortages."
        icon={SoapDispenserDroplet}
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
            <button onClick={fetchAmenities} disabled={loading} className={button.secondary + ' flex items-center gap-1.5'}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button onClick={() => setModalOpen(true)} className={button.primary + ' flex items-center gap-1.5'}>
              <Plus size={14} /> Record Consumption
            </button>
          </div>
        }
      />

      {/* Summary tiles */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Par" value={totals.par} icon={Plus} tone="neutral" />
        <StatCard title="In Stock" value={totals.inStock} icon={ArrowDownToLine} tone="success" />
        <StatCard title="Consumed Today" value={totals.consumedToday} icon={TrendingDown} tone="warning" />
        <StatCard title="Shortages" value={shortagesCount} icon={AlertTriangle} tone="danger" />
      </div>

      {/* Shortage reporting */}
      {shortages.length > 0 && (
        <SectionCard title="Shortage Report" subtitle="Amenities below 50% of par level" icon={AlertTriangle} tone="danger" pad="md">
          <div className="flex flex-wrap gap-2">
            {shortages.map(s => (
              <Badge key={s.type} tone="danger" variant="soft">{s.type} — {s.inStock}/{s.par}</Badge>
            ))}
          </div>
        </SectionCard>
      )}

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
            {t.id === 'log' && log.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-bold bg-[var(--color-info)]/15 text-[var(--color-info)]">{log.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Inventory sub-tab ─────────────────────────────────────────── */}
      {subTab === 'inventory' && (
        <>
          {/* Search */}
          <SectionCard pad="md">
            <div className="flex items-center justify-between gap-4">
              <div className="relative w-full max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  placeholder="Search amenities..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
                />
              </div>
            </div>
          </SectionCard>

          {/* Amenity cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredStock.map(s => {
              const meta = AMENITY_META[s.type];
              const Icon = meta.icon;
              const pct = s.par > 0 ? Math.round((s.inStock / s.par) * 100) : 0;
              const low = pct < 50;
              const tone: StatusTone = low ? 'danger' : 'success';
              return (
                <div key={s.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 card-shadow smooth-transition overflow-hidden">
                  <div className={`h-1 ${statusTone[tone].dot}`} />
                  <div className="p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <div className={`p-2 rounded-xl ${statusTone[tone].soft}`}><Icon className="w-4 h-4" /></div>
                      <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase leading-tight flex-1">{s.type}</h3>
                      {low && <AlertTriangle className="w-3.5 h-3.5 text-[var(--color-danger)]" />}
                    </div>
                    <div className="flex items-center justify-between text-xs font-mono mb-1.5">
                      <span className="text-gray-500 font-medium">Stock {s.inStock} / {s.par}</span>
                      <span className={`font-bold ${statusTone[tone].text}`}>{pct}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden mb-3">
                      <div className={`h-full ${statusTone[tone].dot}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                    <p className="text-xs text-gray-500 mb-3">Consumed today: {s.consumedToday}</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setModalOpen(true)}
                        className={button.secondary + ' flex-1 text-xs'}
                      >
                        Consume
                      </button>
                      <button
                        onClick={() => replenish(s.type)}
                        disabled={actionLoading === `replenish-${s.type}`}
                        className={button.ghost + ' flex-1 text-xs flex items-center justify-center gap-1 disabled:opacity-50'}
                      >
                        {actionLoading === `replenish-${s.type}` ? <Loader2 size={12} className="animate-spin" /> : <ArrowDownToLine className="w-3 h-3" />}
                        Replenish
                      </button>
                    </div>
                    {/* Inventory linkage picker — migration 312 */}
                    <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
                      <label className="block text-[9px] font-black uppercase text-gray-400 mb-1">Inventory Link</label>
                      <select
                        value={s.inventoryItemId || ''}
                        disabled={linking === s.id}
                        onChange={async e => {
                          const newVal = e.target.value || null;
                          setLinking(s.id);
                          try {
                            const r = await fetch(`/api/hk-portal/amenities/stock/${s.id}/link`, {
                              method: 'PUT',
                              headers: authHeaders(true),
                              body: JSON.stringify({ inventoryItemId: newVal }),
                            });
                            if (!r.ok) throw new Error(`Failed (${r.status})`);
                            const result = await r.json();
                            setData(prev => prev ? {
                              ...prev,
                              stock: prev.stock.map(x => x.id === s.id ? result.stock : x),
                            } : prev);
                            addNotification(`${s.type} ${newVal ? 'linked to inventory item' : 'unlinked'}`, 'info', 'Housekeeping');
                          } catch (err: any) {
                            addNotification(err.message || 'Failed to link item', 'warning', 'Housekeeping');
                          } finally {
                            setLinking(null);
                          }
                        }}
                        className="w-full text-[10px] font-mono border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 outline-none cursor-pointer disabled:opacity-50"
                      >
                        <option value="">No inventory link</option>
                        {linkableItems.map(it => (
                          <option key={it.id} value={it.id}>{it.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              );
            })}
            {filteredStock.length === 0 && (
              <div className="col-span-full py-8 text-center text-[10px] font-bold text-slate-400 uppercase">No amenities match the search.</div>
            )}
          </div>
        </>
      )}

      {/* ── Consumption Log sub-tab ───────────────────────────────────── */}
      {subTab === 'log' && (
        <SectionCard
          title="Consumption & Replenishment Log"
          subtitle="All stock movements"
          icon={ClipboardList}
          tone="neutral"
          pad="md"
        >
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {log.map(e => {
              const isReplenish = e.action === 'Replenishment';
              return (
                <div key={e.id} className="py-3 flex items-center gap-4">
                  <div className={`p-2 rounded-xl shrink-0 ${isReplenish ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600' : 'bg-amber-50 dark:bg-amber-500/10 text-amber-600'}`}>
                    {isReplenish ? <ArrowDownToLine size={14} /> : <TrendingDown size={14} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge tone={isReplenish ? 'success' : 'warning'} variant="soft">{e.action}</Badge>
                      <span className="text-[9px] font-mono text-slate-400">{e.id}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 font-bold truncate mt-1">
                      {e.type} · {e.quantity} pcs{e.room && ` · Room ${e.room}`}{e.staff && ` · ${e.staff}`}
                    </p>
                  </div>
                  <span className="text-[9px] font-mono text-slate-400 shrink-0" title={e.createdAt}>{formatTime(e.createdAt)}</span>
                </div>
              );
            })}
            {log.length === 0 && (
              <div className="py-8 text-center text-[10px] font-bold text-slate-400 uppercase">No stock movements recorded.</div>
            )}
          </div>
        </SectionCard>
      )}

      <ConsumptionModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={recordConsumption}
        submitting={submitting}
        stock={stock}
      />
    </div>
  );
}
