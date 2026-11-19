/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Linen Management Interface — docs/Housekeeping Portal new.md §12.
 * Tracks linen types, stock levels, and the Issue / Return / Damaged / Lost /
 * Linen Count operations. Distinct from the Laundry Interface (§13), which
 * handles the wash/dry/iron production cycle.
 *
 * DB-integrated: fetches and persists via /api/hk-portal/linen/*.
 *   GET  /linen/:propertyId        → { stock, log, totals }
 *   POST /linen/operation          → applies an operation (updates stock + log)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useERP } from '../../context/ERPContext';
import {
  BedDouble,
  Layers,
  Wind,
  Bath,
  Hand,
  Droplet,
  Footprints,
  Shirt,
  Waves,
  Plus,
  ArrowDownToLine,
  ArrowUpFromLine,
  AlertTriangle,
  XCircle,
  ClipboardCheck,
  Search,
  Loader2,
  ServerCrash,
  RefreshCw,
  X,
  Pencil,
  Trash2,
  Settings2,
  type LucideIcon,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';

// Linen types are user-defined (any non-empty string). The default list
// below is used as a seed for the type dropdown and the icon/color map, but
// admins can add new types through the Par Catalog sub-tab.
type LinenType = string;

type Operation = 'Issue Linen' | 'Return Linen' | 'Damaged Linen' | 'Lost Linen' | 'Linen Count';

const DEFAULT_LINEN_TYPES: LinenType[] = [
  'Bed Sheets', 'Pillowcases', 'Duvet Covers', 'Blankets',
  'Bath Towels', 'Hand Towels', 'Face Towels', 'Bath Mats',
  'Robes', 'Pool Towels',
];

// Kept for backward compatibility with code that references LINEN_TYPE_LIST.
// Now a mutable array seeded with the defaults; new types added via the
// catalog are appended at runtime (see component body).
const LINEN_TYPE_LIST: LinenType[] = [...DEFAULT_LINEN_TYPES];

const OPERATION_LIST: Operation[] = [
  'Issue Linen', 'Return Linen', 'Damaged Linen', 'Lost Linen', 'Linen Count',
];

interface LinenStock {
  id: string;
  type: LinenType;
  par: number;
  inStock: number;
  inUse: number;
  atLaundry: number;
  damaged: number;
  lost: number;
  inventoryItemId?: string | null;
  updatedAt: string;
}

interface LinenLogEntry {
  id: string;
  operation: Operation;
  type: LinenType;
  quantity: number;
  location: string;
  staff: string;
  notes?: string;
  createdAt: string;
}

interface LinenTotals {
  par: number;
  inStock: number;
  inUse: number;
  atLaundry: number;
  damaged: number;
  lost: number;
}

interface LinenCatalogItem {
  id: string;
  type: LinenType;
  parLevel: number;
  active: boolean;
  updatedAt?: string;
}

interface LinenData {
  propertyId: string;
  stock: LinenStock[];
  log: LinenLogEntry[];
  catalog: LinenCatalogItem[];
  totals: LinenTotals;
  generatedAt: string;
}

const LINEN_META: Record<string, { icon: LucideIcon; color: string }> = {
  'Bed Sheets': { icon: BedDouble, color: 'text-indigo-500' },
  Pillowcases: { icon: Layers, color: 'text-blue-500' },
  'Duvet Covers': { icon: Wind, color: 'text-purple-500' },
  Blankets: { icon: Layers, color: 'text-amber-500' },
  'Bath Towels': { icon: Bath, color: 'text-emerald-500' },
  'Hand Towels': { icon: Hand, color: 'text-teal-500' },
  'Face Towels': { icon: Droplet, color: 'text-cyan-500' },
  'Bath Mats': { icon: Footprints, color: 'text-slate-500' },
  Robes: { icon: Shirt, color: 'text-rose-500' },
  'Pool Towels': { icon: Waves, color: 'text-sky-500' },
};

// Fallback icon/color for user-added linen types not in LINEN_META.
const DEFAULT_LINEN_META = { icon: Layers, color: 'text-slate-500' };
const linenMeta = (type: string) => LINEN_META[type] || DEFAULT_LINEN_META;

const OP_META: Record<Operation, { icon: LucideIcon; color: string; bg: string }> = {
  'Issue Linen': { icon: ArrowUpFromLine, color: 'text-indigo-600', bg: 'bg-indigo-50 dark:bg-indigo-500/10' },
  'Return Linen': { icon: ArrowDownToLine, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
  'Damaged Linen': { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-500/10' },
  'Lost Linen': { icon: XCircle, color: 'text-rose-600', bg: 'bg-rose-50 dark:bg-rose-500/10' },
  'Linen Count': { icon: ClipboardCheck, color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-500/10' },
};

const OP_TONE: Record<Operation, StatusTone> = {
  'Issue Linen': 'info',
  'Return Linen': 'success',
  'Damaged Linen': 'warning',
  'Lost Linen': 'danger',
  'Linen Count': 'neutral',
};

const stockTone = (pct: number): StatusTone => (pct < 40 ? 'danger' : pct < 70 ? 'warning' : 'success');

// ── Sub-tab definitions ────────────────────────────────────────────────

type SubTab = 'inventory' | 'operations' | 'catalog';

const SUB_TABS: { id: SubTab; label: string; icon: LucideIcon }[] = [
  { id: 'inventory', label: 'Inventory', icon: Layers },
  { id: 'operations', label: 'Operations Log', icon: ClipboardCheck },
  { id: 'catalog', label: 'Par Catalog', icon: Settings2 },
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

// ── Operation modal ────────────────────────────────────────────────────

interface OperationForm {
  operation: Operation;
  type: LinenType;
  quantity: number;
  location: string;
  staff: string;
  notes: string;
}

function OperationModal({
  open,
  onClose,
  onSubmit,
  submitting,
  stock,
  types,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (form: OperationForm) => Promise<void>;
  submitting: boolean;
  stock: LinenStock[];
  types: LinenType[];
}) {
  const [form, setForm] = useState<OperationForm>({
    operation: 'Issue Linen',
    type: 'Bath Towels',
    quantity: 10,
    location: 'Floor 1',
    staff: '',
    notes: '',
  });

  // Reset to sensible defaults when reopened.
  useEffect(() => {
    if (open) {
      setForm({
        operation: 'Issue Linen',
        type: stock[0]?.type || types[0] || 'Bath Towels',
        quantity: 10,
        location: 'Floor 1',
        staff: '',
        notes: '',
      });
    }
  }, [open, stock, types]);

  if (!open) return null;

  const isCount = form.operation === 'Linen Count';
  const selected = stock.find(s => s.type === form.type);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            {(() => {
              const Icon = OP_META[form.operation].icon;
              return <Icon size={18} className={OP_META[form.operation].color} />;
            })()}
            <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">New Linen Operation</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Operation */}
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Operation</label>
            <div className="grid grid-cols-5 gap-2">
              {OPERATION_LIST.map(op => {
                const meta = OP_META[op];
                const Icon = meta.icon;
                const active = form.operation === op;
                return (
                  <button
                    key={op}
                    onClick={() => setForm(f => ({ ...f, operation: op }))}
                    className={`flex flex-col items-center gap-1.5 py-2.5 rounded-xl border transition-all ${
                      active
                        ? `${meta.bg} ${meta.color} border-current`
                        : 'border-slate-200 dark:border-slate-800 text-slate-500 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <Icon size={16} />
                    <span className="text-[9px] font-bold text-center leading-tight">{op.replace(' Linen', '')}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Type + Quantity */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Linen Type</label>
              <select
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none cursor-pointer"
              >
                {types.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">
                {isCount ? 'Counted Qty' : 'Quantity'}
              </label>
              <input
                type="number"
                min={0}
                value={form.quantity}
                onChange={e => setForm(f => ({ ...f, quantity: Math.max(0, parseInt(e.target.value) || 0) }))}
                className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Current stock hint */}
          {selected && (
            <div className="text-[10px] font-mono text-slate-400 bg-slate-50 dark:bg-slate-850 rounded-lg px-3 py-2">
              Current — Stock: {selected.inStock} · In Use: {selected.inUse} · Laundry: {selected.atLaundry}
              {!isCount && form.operation === 'Issue Linen' && form.quantity > selected.inStock && (
                <span className="text-amber-500 font-bold ml-2">⚠ exceeds available stock</span>
              )}
            </div>
          )}

          {/* Location + Staff */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Location</label>
              <input
                type="text"
                value={form.location}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                placeholder="Floor 1, Room 410, Linen Room…"
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

          {/* Notes */}
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Notes (optional)</label>
            <input
              type="text"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Torn seams, guest departure…"
              className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-5 border-t border-slate-100 dark:border-slate-800">
          <button onClick={onClose} className={button.secondary}>Cancel</button>
          <button
            onClick={() => onSubmit(form)}
            disabled={submitting || form.quantity < 0}
            className={button.primary + ' flex items-center gap-1.5 disabled:opacity-50'}
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Apply Operation
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Catalog edit modal (admin-only par level editor) ───────────────────

interface CatalogForm {
  type: LinenType;
  parLevel: number;
  active: boolean;
}

function CatalogEditModal({
  open,
  onClose,
  onSubmit,
  submitting,
  editing,
  existingTypes,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (form: CatalogForm, id?: string) => Promise<void>;
  submitting: boolean;
  editing: LinenCatalogItem | null;
  existingTypes: Set<LinenType>;
}) {
  const [form, setForm] = useState<CatalogForm>({
    type: 'Bath Towels',
    parLevel: 100,
    active: true,
  });
  // Toggle between picking a known type vs. typing a new one.
  const [customType, setCustomType] = useState(false);

  useEffect(() => {
    if (open) {
      if (editing) {
        setForm({ type: editing.type, parLevel: editing.parLevel, active: editing.active });
        setCustomType(false);
      } else {
        const firstUnused = LINEN_TYPE_LIST.find(t => !existingTypes.has(t));
        setForm({ type: firstUnused || '', parLevel: 100, active: true });
        // If every default type is already in the catalog, start in custom mode
        // so the user can type a brand-new linen type.
        setCustomType(!firstUnused);
      }
    }
  }, [open, editing, existingTypes]);

  if (!open) return null;

  const availableTypes = editing
    ? [editing.type]
    : LINEN_TYPE_LIST.filter(t => !existingTypes.has(t));

  const trimmedType = form.type.trim();
  const typeIsNew = !editing && trimmedType && !existingTypes.has(trimmedType);
  const typeIsValid = trimmedType.length > 0 && trimmedType.length <= 80;
  const canSubmit = typeIsValid && (!editing || true);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <Settings2 size={18} className="text-[var(--color-accent-operations)]" />
            <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">
              {editing ? 'Edit Par Level' : 'Add Catalog Entry'}
            </h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800">
            <X size={16} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Linen Type</label>
            {editing ? (
              // When editing, the type is fixed — show as a disabled input.
              <input
                type="text"
                value={form.type}
                disabled
                className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none opacity-60"
              />
            ) : customType ? (
              // Free-text entry for a brand-new linen type.
              <div className="space-y-2">
                <input
                  type="text"
                  value={form.type}
                  onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                  placeholder="e.g. Table Cloths, Napkins, Bed Pads…"
                  maxLength={80}
                  className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
                />
                {trimmedType && existingTypes.has(trimmedType) && (
                  <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400">"{trimmedType}" already exists in the catalog.</div>
                )}
                {availableTypes.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { setCustomType(false); setForm(f => ({ ...f, type: availableTypes[0] })); }}
                    className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    ← Pick from known types instead
                  </button>
                )}
              </div>
            ) : (
              // Dropdown of default types not yet in the catalog.
              <div className="space-y-2">
                <select
                  value={form.type}
                  onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                  className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none cursor-pointer"
                >
                  {availableTypes.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => { setCustomType(true); setForm(f => ({ ...f, type: '' })); }}
                  className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  + Add a new linen type not listed
                </button>
              </div>
            )}
            {typeIsNew && typeIsValid && (
              <div className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 mt-1.5">
                New type — will be added to the catalog.
              </div>
            )}
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Par Level</label>
            <input
              type="number"
              min={0}
              value={form.parLevel}
              onChange={e => setForm(f => ({ ...f, parLevel: Math.max(0, parseInt(e.target.value) || 0) }))}
              className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <div className="text-[10px] font-mono text-slate-400 mt-1.5">
              Par level = target on-hand stock for this linen type. Stock health bars compare against this value.
            </div>
          </div>
          {editing && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.active}
                onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
                className="rounded border-slate-300 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Active</span>
            </label>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 p-5 border-t border-slate-100 dark:border-slate-800">
          <button onClick={onClose} className={button.secondary}>Cancel</button>
          <button
            onClick={() => onSubmit({ ...form, type: trimmedType }, editing?.id)}
            disabled={submitting || !canSubmit || (!editing && existingTypes.has(trimmedType))}
            className={button.primary + ' flex items-center gap-1.5 disabled:opacity-50'}
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {editing ? 'Save' : 'Add Entry'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────

// NOTE: Catalog edit access is currently open to all authenticated users.
// Re-introduce a role check (FULL_ACCESS_ROLES) here once the admin portal's
// permission configuration UI is wired up.
export default function LinenManagementModule() {
  const { currentPropertyId, addNotification } = useERP();
  const canManageCatalog = true;
  const [data, setData] = useState<LinenData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opFilter, setOpFilter] = useState<'All' | Operation>('All');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [subTab, setSubTab] = useState<SubTab>('inventory');
  const [catalogEditing, setCatalogEditing] = useState<LinenCatalogItem | null>(null);
  const [catalogSubmitting, setCatalogSubmitting] = useState(false);
  const [catalogDeleting, setCatalogDeleting] = useState<string | null>(null);
  const [linkableItems, setLinkableItems] = useState<{ id: string; name: string }[]>([]);
  const [linking, setLinking] = useState<string | null>(null);

  const fetchLinkableItems = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(
        `/api/hk-portal/inventory/linkable/${currentPropertyId}?category=LINENS`,
        { headers: authHeaders() }
      );
      if (res.ok) {
        const json = await res.json();
        setLinkableItems(json.items || []);
      }
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  useEffect(() => { fetchLinkableItems(); }, [fetchLinkableItems]);

  const fetchLinen = useCallback(async () => {
    if (!currentPropertyId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/hk-portal/linen/${currentPropertyId}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load linen data (${res.status})`);
      const json = (await res.json()) as LinenData;
      setData(json);
    } catch (e: any) {
      setError(e?.message || 'Failed to load linen data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { fetchLinen(); }, [fetchLinen]);

  const stock = data?.stock || [];
  const log = data?.log || [];
  const catalog = data?.catalog || [];
  const totals = data?.totals || { par: 0, inStock: 0, inUse: 0, atLaundry: 0, damaged: 0, lost: 0 };
  const catalogTypes = useMemo(() => new Set(catalog.map(c => c.type)), [catalog]);

  // Combined, deduped type list for the Operation modal: catalog types first
  // (source of truth), then any stock types not in the catalog, then the
  // default seed list as a fallback so the dropdown is never empty.
  const allLinenTypes = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of catalog) if (!seen.has(c.type)) { seen.add(c.type); out.push(c.type); }
    for (const s of stock) if (!seen.has(s.type)) { seen.add(s.type); out.push(s.type); }
    for (const t of DEFAULT_LINEN_TYPES) if (!seen.has(t)) { seen.add(t); out.push(t); }
    return out;
  }, [catalog, stock]);

  const filteredLog = useMemo(
    () =>
      log.filter(e => {
        const matchesOp = opFilter === 'All' || e.operation === opFilter;
        const matchesSearch =
          e.type.toLowerCase().includes(search.toLowerCase()) ||
          e.location.toLowerCase().includes(search.toLowerCase()) ||
          e.staff.toLowerCase().includes(search.toLowerCase());
        return matchesOp && matchesSearch;
      }),
    [log, opFilter, search]
  );

  const applyOperation = async (form: OperationForm) => {
    if (!currentPropertyId) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/hk-portal/linen/operation', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          propertyId: currentPropertyId,
          operation: form.operation,
          type: form.type,
          quantity: form.quantity,
          location: form.location,
          staff: form.staff,
          notes: form.notes || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to apply operation (${res.status})`);
      }
      const result = (await res.json()) as { stock: LinenStock; log: LinenLogEntry; inventoryWarning?: string };
      // Optimistically update local state.
      setData(prev => prev ? {
        ...prev,
        stock: prev.stock.map(s => s.type === result.stock.type ? result.stock : s),
        log: [result.log, ...prev.log],
        totals: {
          par: prev.totals.par,
          inStock: prev.stock.reduce((sum, s) => sum + (s.type === result.stock.type ? result.stock.inStock : s.inStock), 0),
          inUse: prev.stock.reduce((sum, s) => sum + (s.type === result.stock.type ? result.stock.inUse : s.inUse), 0),
          atLaundry: prev.stock.reduce((sum, s) => sum + (s.type === result.stock.type ? result.stock.atLaundry : s.atLaundry), 0),
          damaged: prev.stock.reduce((sum, s) => sum + (s.type === result.stock.type ? result.stock.damaged : s.damaged), 0),
          lost: prev.stock.reduce((sum, s) => sum + (s.type === result.stock.type ? result.stock.lost : s.lost), 0),
        },
      } : prev);
      addNotification(`${form.operation}: ${form.quantity} ${form.type} @ ${form.location}`, 'info', 'Housekeeping');
      // Surface the HK-store linkage warning so stock drift is never silent.
      if (result.inventoryWarning) addNotification(result.inventoryWarning, 'warning', 'Housekeeping');
      setModalOpen(false);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to apply operation', 'danger', 'Housekeeping');
    } finally {
      setSubmitting(false);
    }
  };

  const saveCatalogItem = async (form: CatalogForm, id?: string) => {
    if (!currentPropertyId) return;
    setCatalogSubmitting(true);
    try {
      const url = id ? `/api/hk-portal/linen/catalog/${id}` : '/api/hk-portal/linen/catalog';
      const method = id ? 'PUT' : 'POST';
      const body: any = { propertyId: currentPropertyId, type: form.type, parLevel: form.parLevel };
      if (id) { delete body.type; body.active = form.active; }
      const res = await fetch(url, {
        method,
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to save catalog entry (${res.status})`);
      }
      addNotification(id ? `Par level updated for ${form.type}` : `Catalog entry added: ${form.type}`, 'success', 'Housekeeping');
      setCatalogEditing(null);
      fetchLinen();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save catalog entry', 'danger', 'Housekeeping');
    } finally {
      setCatalogSubmitting(false);
    }
  };

  const deleteCatalogItem = async (item: LinenCatalogItem) => {
    setCatalogDeleting(item.id);
    try {
      const res = await fetch(`/api/hk-portal/linen/catalog/${item.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to delete (${res.status})`);
      }
      addNotification(`Catalog entry removed: ${item.type}`, 'info', 'Housekeeping');
      fetchLinen();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete catalog entry', 'danger', 'Housekeeping');
    } finally {
      setCatalogDeleting(null);
    }
  };

  const stockPct = (s: LinenStock) => s.par > 0 ? Math.round(((s.inStock + s.atLaundry) / s.par) * 100) : 0;

  // ── Loading / Error states ───────────────────────────────────────────

  if (loading && !data) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Linen Management" subtitle="Linen types, stock levels & operations." icon={Layers} />
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="animate-spin text-[var(--color-accent-operations)]" size={32} />
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Loading linen data…</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Linen Management" subtitle="Linen types, stock levels & operations." icon={Layers} />
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <ServerCrash className="text-rose-500" size={32} />
          <p className="text-xs font-bold text-rose-500 uppercase tracking-wider">{error}</p>
          <button onClick={fetchLinen} className={`mt-3 ${button.secondary}`}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Linen Management"
        subtitle="Linen types, stock levels & Issue / Return / Damaged / Lost / Count operations."
        icon={Layers}
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
            <button onClick={fetchLinen} disabled={loading} className={button.secondary + ' flex items-center gap-1.5'}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button onClick={() => setModalOpen(true)} className={button.primary + ' flex items-center gap-1.5'}>
              <Plus size={14} /> New Operation
            </button>
          </div>
        }
      />

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard title="Total Par Level" value={totals.par} icon={Layers} tone="neutral" />
        <StatCard title="In Stock" value={totals.inStock} icon={BedDouble} tone="success" />
        <StatCard title="In Use" value={totals.inUse} icon={Bath} tone="accent" />
        <StatCard title="At Laundry" value={totals.atLaundry} icon={Waves} tone="info" />
        <StatCard title="Damaged" value={totals.damaged} icon={AlertTriangle} tone="warning" />
        <StatCard title="Lost" value={totals.lost} icon={XCircle} tone="danger" />
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
            {t.id === 'operations' && log.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-bold bg-[var(--color-info)]/15 text-[var(--color-info)]">{log.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Inventory sub-tab ─────────────────────────────────────────── */}
      {subTab === 'inventory' && (
        <SectionCard
          title="Linen Inventory by Type"
          subtitle="Stock health vs. par level"
          icon={Layers}
          tone="accent"
          pad="none"
          bodyClassName="divide-y divide-slate-50 dark:divide-slate-800"
        >
          {stock.length === 0 && (
            <div className="py-10 text-center text-[10px] font-bold text-slate-400 uppercase">No linen stock records found.</div>
          )}
          {stock.map(s => {
            const meta = linenMeta(s.type);
            const Icon = meta.icon;
            const pct = stockPct(s);
            return (
              <div key={s.id} className="p-5 flex flex-col lg:flex-row lg:items-center gap-4">
                <div className="flex items-center gap-3 lg:w-56 shrink-0">
                  <div className={`p-2 rounded-xl bg-slate-50 dark:bg-slate-800 ${meta.color}`}>
                    <Icon size={16} />
                  </div>
                  <div>
                    <h4 className="text-[11px] font-black text-slate-900 dark:text-white uppercase tracking-tight">{s.type}</h4>
                    <p className="text-[9px] text-slate-400 font-mono">Par {s.par}</p>
                  </div>
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between text-[9px] font-mono mb-1.5">
                    <span className="text-slate-400 font-bold uppercase">
                      Stock {s.inStock} · In Use {s.inUse} · Laundry {s.atLaundry}
                    </span>
                    <span className={`font-black ${statusTone[stockTone(pct)].text}`}>{pct}%</span>
                  </div>
                  <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div className={`h-full transition-all duration-500 ${statusTone[stockTone(pct)].dot}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[9px] font-mono font-bold">
                  <span className="flex items-center gap-1 text-amber-500"><AlertTriangle size={11} /> {s.damaged}</span>
                  <span className="flex items-center gap-1 text-rose-500"><XCircle size={11} /> {s.lost}</span>
                </div>
                {/* Inventory linkage picker — migration 312 */}
                <div className="flex items-center gap-2 lg:w-48 shrink-0">
                  <select
                    value={s.inventoryItemId || ''}
                    disabled={linking === s.id}
                    onChange={async e => {
                      const newVal = e.target.value || null;
                      setLinking(s.id);
                      try {
                        const r = await fetch(`/api/hk-portal/linen/stock/${s.id}/link`, {
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
                    className="w-full text-[9px] font-mono border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 outline-none cursor-pointer disabled:opacity-50"
                  >
                    <option value="">No inventory link</option>
                    {linkableItems.map(it => (
                      <option key={it.id} value={it.id}>{it.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </SectionCard>
      )}

      {/* ── Operations Log sub-tab ────────────────────────────────────── */}
      {subTab === 'operations' && (
        <SectionCard
          title="Operations Log"
          subtitle="Issue · Return · Damaged · Lost · Count"
          icon={ClipboardCheck}
          tone="neutral"
          pad="md"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <select
                value={opFilter}
                onChange={e => setOpFilter(e.target.value as 'All' | Operation)}
                className="bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-[10px] font-bold text-slate-600 dark:text-slate-200 outline-none cursor-pointer"
              >
                <option value="All">All Operations</option>
                {OPERATION_LIST.map(o => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl text-xs outline-none focus:ring-1 focus:ring-indigo-500 font-sans w-48"
                />
              </div>
            </div>
          </div>

          <div className="divide-y divide-slate-50 dark:divide-slate-800">
            {filteredLog.map(e => {
              const op = OP_META[e.operation];
              const OpIcon = op.icon;
              return (
                <div key={e.id} className="py-3 flex items-center gap-4">
                  <div className={`p-2 rounded-xl ${op.bg} ${op.color} shrink-0`}>
                    <OpIcon size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge tone={OP_TONE[e.operation]} variant="soft">{e.operation}</Badge>
                      <span className="text-[9px] font-mono text-slate-400">{e.id}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 font-bold truncate mt-1">
                      {e.type} · {e.quantity} pcs · {e.location || '—'} · {e.staff || '—'}
                      {e.notes && ` · ${e.notes}`}
                    </p>
                  </div>
                  <span className="text-[9px] font-mono text-slate-400 shrink-0" title={e.createdAt}>{formatTime(e.createdAt)}</span>
                </div>
              );
            })}
            {filteredLog.length === 0 && (
              <div className="py-8 text-center text-[10px] font-bold text-slate-400 uppercase">No operations match the filters.</div>
            )}
          </div>
        </SectionCard>
      )}

      {/* ── Par Catalog sub-tab (admin-only) ─────────────────────────── */}
      {subTab === 'catalog' && (
        <SectionCard
          title="Linen Par Catalog"
          subtitle="Admin-editable par levels per linen type. Stock health bars compare against these values."
          icon={Settings2}
          tone="neutral"
          pad="md"
          actions={
            canManageCatalog ? (
              <button
                onClick={() => setCatalogEditing({ id: '', type: '', parLevel: 100, active: true })}
                className={button.primary + ' flex items-center gap-1.5 text-xs'}
                title="Add a new linen type or set par for an existing one"
              >
                <Plus size={12} /> Add Entry
              </button>
            ) : undefined
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-700 text-left">
                  <th className="py-2 px-3 font-black text-slate-400 uppercase tracking-wider">Linen Type</th>
                  <th className="py-2 px-3 font-black text-slate-400 uppercase tracking-wider text-center">Par Level</th>
                  <th className="py-2 px-3 font-black text-slate-400 uppercase tracking-wider text-center">Current Stock</th>
                  <th className="py-2 px-3 font-black text-slate-400 uppercase tracking-wider text-center">Status</th>
                  {canManageCatalog && (
                    <th className="py-2 px-3 font-black text-slate-400 uppercase tracking-wider text-right">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-700/50">
                {catalog.map(c => {
                  const stockRow = stock.find(s => s.type === c.type);
                  const pct = c.parLevel > 0 && stockRow ? Math.round(((stockRow.inStock + stockRow.atLaundry) / c.parLevel) * 100) : 0;
                  return (
                    <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="py-2.5 px-3 font-bold text-slate-700 dark:text-slate-200">{c.type}</td>
                      <td className="py-2.5 px-3 text-center font-mono font-bold text-slate-700 dark:text-slate-200">{c.parLevel}</td>
                      <td className="py-2.5 px-3 text-center font-mono text-slate-600 dark:text-slate-300">
                        {stockRow ? `${stockRow.inStock} + ${stockRow.atLaundry} laundry` : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {c.active ? (
                          <Badge tone={stockTone(pct)} variant="soft">{pct}%</Badge>
                        ) : (
                          <Badge tone="neutral" variant="soft">Inactive</Badge>
                        )}
                      </td>
                      {canManageCatalog && (
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setCatalogEditing(c)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10"
                              title="Edit par level"
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              onClick={() => deleteCatalogItem(c)}
                              disabled={catalogDeleting === c.id}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 disabled:opacity-40"
                              title="Delete"
                            >
                              {catalogDeleting === c.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {catalog.length === 0 && (
                  <tr>
                    <td colSpan={canManageCatalog ? 5 : 4} className="py-8 text-center text-[10px] font-bold text-slate-400 uppercase">
                      No catalog entries. Click "Add Entry" to set par levels.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      <OperationModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={applyOperation}
        submitting={submitting}
        stock={stock}
        types={allLinenTypes}
      />

      <CatalogEditModal
        open={catalogEditing !== null}
        onClose={() => setCatalogEditing(null)}
        onSubmit={saveCatalogItem}
        submitting={catalogSubmitting}
        editing={catalogEditing && catalogEditing.id ? catalogEditing : null}
        existingTypes={catalogTypes}
      />
    </div>
  );
}
