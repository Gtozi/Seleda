/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Minibar Operations module — docs/Housekeeping Portal new.md §15.
 * Refill, Consumption Recording, Missing Items, Stock Verification,
 * Charge Posting to PMS, and full operation audit log.
 *
 * DB-integrated: fetches and persists via /api/hk-portal/minibar/*.
 *   GET    /minibar/:propertyId           → { rooms, log, summary }
 *   POST   /minibar                        → create new minibar room task
 *   POST   /minibar/:id/advance            → advance room status (refill/record/verify/post-charge)
 *   POST   /minibar/:id/items              → add consumed item (recalculates total)
 *   DELETE /minibar/:id/items/:itemId      → remove consumed item
 *   PUT    /minibar/:id/missing-items      → set/clear missing items
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Wine,
  Search,
  CheckCircle2,
  XCircle,
  DollarSign,
  ClipboardCheck,
  RefreshCw,
  AlertTriangle,
  Loader2,
  ServerCrash,
  Plus,
  Trash2,
  Pencil,
  X,
  ClipboardList,
  Package,
  Clock,
  ArrowRight,
  Building2,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';

type MinibarStatus =
  | 'Pending Refill' | 'Refilled' | 'Consumption Recorded'
  | 'Stock Verified' | 'Charge Posted' | 'Missing Items';

type MinibarAction = 'refill' | 'record' | 'verify' | 'post-charge';

interface ConsumedItem {
  id: string;
  name: string;
  qty: number;
  price: number;
}

interface InventoryItem {
  catalogId: string;
  name: string;
  qty: number;
  parLevel: number;
  price: number;
}

interface CatalogItem {
  id: string;
  name: string;
  price: number;
  parLevel: number;
  inventoryItemId?: string | null;
  active: boolean;
}

interface MinibarRoom {
  id: string;
  room: string;
  floor: number;
  status: MinibarStatus;
  consumedItems: ConsumedItem[];
  inventory: InventoryItem[];
  missingItems: string[];
  posted: boolean;
  totalCharge: number;
  updatedAt: string;
}

interface MinibarLogEntry {
  id: string;
  roomId: string;
  room: string;
  action: string;
  detail: string;
  staff: string;
  createdAt: string;
}

interface MinibarSummary {
  pending: number;
  missing: number;
  verified: number;
  posted: number;
  revenue: number;
  lowStock: number;
}

interface FolioResult {
  folioId: string;
  folioLineId: string;
  reservationId: string;
  guestName: string;
  newBalance: number;
  isRouted: boolean;
}

interface MinibarData {
  propertyId: string;
  rooms: MinibarRoom[];
  log: MinibarLogEntry[];
  catalog: CatalogItem[];
  summary: MinibarSummary;
  generatedAt: string;
}

const STATUS_TONE: Record<MinibarStatus, StatusTone> = {
  'Pending Refill': 'warning',
  'Refilled': 'info',
  'Consumption Recorded': 'info',
  'Stock Verified': 'info',
  'Charge Posted': 'success',
  'Missing Items': 'danger',
};

const STATUS_LIST: MinibarStatus[] = [
  'Pending Refill', 'Refilled', 'Consumption Recorded',
  'Stock Verified', 'Charge Posted', 'Missing Items',
];

// Valid transitions for button disabling (must match backend MINIBAR_TRANSITIONS).
const VALID_NEXT_ACTIONS: Record<MinibarStatus, MinibarAction[]> = {
  'Pending Refill': ['refill'],
  'Refilled': ['record', 'verify'],
  'Consumption Recorded': ['verify', 'post-charge'],
  'Stock Verified': ['post-charge'],
  'Missing Items': [],
  'Charge Posted': [],
};

type SubTab = 'rooms' | 'log' | 'inventory';

const SUB_TABS: { id: SubTab; label: string; icon: typeof Wine }[] = [
  { id: 'rooms', label: 'Room Minibars', icon: Wine },
  { id: 'inventory', label: 'Inventory Catalog', icon: Package },
  { id: 'log', label: 'Operation Log', icon: ClipboardList },
];

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

function formatTime(iso: string): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch { return '—'; }
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  } catch { return ''; }
}

// ── Workflow Stepper ────────────────────────────────────────────────────

const WORKFLOW_STEPS: { status: MinibarStatus; label: string }[] = [
  { status: 'Pending Refill', label: 'Refill' },
  { status: 'Refilled', label: 'Filled' },
  { status: 'Consumption Recorded', label: 'Recorded' },
  { status: 'Stock Verified', label: 'Verified' },
  { status: 'Charge Posted', label: 'Posted' },
];

function WorkflowStepper({ status }: { status: MinibarStatus }) {
  const currentIndex = WORKFLOW_STEPS.findIndex(s => s.status === status);
  const isMissing = status === 'Missing Items';

  if (isMissing) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] font-bold text-rose-500 bg-rose-50 dark:bg-rose-500/10 rounded-lg px-2 py-1">
        <AlertTriangle size={11} /> Missing items — resolve to continue
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0.5">
      {WORKFLOW_STEPS.map((step, i) => {
        const isDone = i < currentIndex;
        const isActive = i === currentIndex;
        return (
          <div key={step.status} className="flex items-center">
            <div
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold transition-all ${
                isActive
                  ? 'bg-[var(--color-accent-operations)]/15 text-[var(--color-accent-operations)]'
                  : isDone
                  ? 'text-emerald-500'
                  : 'text-slate-300 dark:text-slate-600'
              }`}
              title={step.status}
            >
              {isDone ? <CheckCircle2 size={10} /> : isActive ? <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent-operations)] animate-pulse" /> : <div className="w-1.5 h-1.5 rounded-full bg-current opacity-40" />}
              <span>{step.label}</span>
            </div>
            {i < WORKFLOW_STEPS.length - 1 && (
              <div className={`w-2 h-px ${isDone ? 'bg-emerald-400' : 'bg-slate-200 dark:bg-slate-700'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Confirm Post Modal ──────────────────────────────────────────────────

function ConfirmPostModal({
  open,
  onClose,
  onConfirm,
  submitting,
  room,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  submitting: boolean;
  room: MinibarRoom | null;
}) {
  if (!open || !room) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <DollarSign size={18} className="text-emerald-500" />
            <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">Post to PMS</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800">
            <X size={16} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Post the minibar charge for <span className="font-bold text-slate-900 dark:text-white">Room {room.room}</span> to the guest's folio in the Front Office system.
          </p>
          <div className="bg-slate-50 dark:bg-slate-850 rounded-xl p-4 space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400 font-bold uppercase">Total Charge</span>
              <span className="font-black text-lg text-[var(--color-accent-operations)]">${room.totalCharge.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-400 font-bold uppercase">Items</span>
              <span className="font-bold text-slate-700 dark:text-slate-200">
                {room.consumedItems.length} {room.consumedItems.length === 1 ? 'item' : 'items'}
              </span>
            </div>
            {room.consumedItems.length > 0 && (
              <div className="text-[10px] font-mono text-slate-500 border-t border-slate-200 dark:border-slate-700 pt-2">
                {room.consumedItems.map(c => `${c.qty}× ${c.name}`).join(', ')}
              </div>
            )}
          </div>
          <div className="flex items-start gap-2 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 rounded-lg px-3 py-2">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            <span>This will create a real charge on the guest's folio. Ensure the room number matches a checked-in reservation. This action cannot be undone.</span>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 p-5 border-t border-slate-100 dark:border-slate-800">
          <button onClick={onClose} className={button.secondary}>Cancel</button>
          <button
            onClick={onConfirm}
            disabled={submitting || room.totalCharge <= 0}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <DollarSign size={14} />}
            Confirm & Post ${room.totalCharge.toFixed(2)}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── New Minibar Task Modal ─────────────────────────────────────────────

function NewTaskModal({
  open,
  onClose,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (form: { room: string; floor: number; staff: string }) => Promise<void>;
  submitting: boolean;
}) {
  const [form, setForm] = useState({ room: '', floor: 1, staff: '' });

  useEffect(() => { if (open) setForm({ room: '', floor: 1, staff: '' }); }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <Wine size={18} className="text-[var(--color-accent-operations)]" />
            <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">New Minibar Task</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Room Number</label>
            <input
              type="text"
              value={form.room}
              onChange={e => setForm(f => ({ ...f, room: e.target.value }))}
              placeholder="e.g. 204"
              className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Floor</label>
            <input
              type="number"
              min={0}
              value={form.floor}
              onChange={e => setForm(f => ({ ...f, floor: Math.max(0, parseInt(e.target.value) || 1) }))}
              className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Staff (optional)</label>
            <input
              type="text"
              value={form.staff}
              onChange={e => setForm(f => ({ ...f, staff: e.target.value }))}
              placeholder="e.g. Maria S."
              className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-5 border-t border-slate-100 dark:border-slate-800">
          <button onClick={onClose} className={button.secondary}>Cancel</button>
          <button
            onClick={() => onSubmit(form)}
            disabled={submitting || !form.room.trim()}
            className={button.primary + ' flex items-center gap-1.5 disabled:opacity-50'}
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Create Task
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add Item Modal ─────────────────────────────────────────────────────

function AddItemModal({
  open,
  onClose,
  onSubmit,
  submitting,
  roomLabel,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (form: { name: string; qty: number; price: number; staff: string }) => Promise<void>;
  submitting: boolean;
  roomLabel: string;
}) {
  const [form, setForm] = useState({ name: '', qty: 1, price: 0, staff: '' });

  useEffect(() => { if (open) setForm({ name: '', qty: 1, price: 0, staff: '' }); }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <Package size={18} className="text-[var(--color-accent-operations)]" />
            <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">Add Consumed Item — Room {roomLabel}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Item Name</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Sparkling Water"
              className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Quantity</label>
              <input
                type="number"
                min={1}
                value={form.qty}
                onChange={e => setForm(f => ({ ...f, qty: Math.max(1, parseInt(e.target.value) || 1) }))}
                className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Unit Price ($)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.price}
                onChange={e => setForm(f => ({ ...f, price: Math.max(0, parseFloat(e.target.value) || 0) }))}
                className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Staff (optional)</label>
            <input
              type="text"
              value={form.staff}
              onChange={e => setForm(f => ({ ...f, staff: e.target.value }))}
              placeholder="e.g. James L."
              className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          {form.name && (
            <div className="text-[10px] font-mono text-slate-400 bg-slate-50 dark:bg-slate-850 rounded-lg px-3 py-2">
              Line total: ${(form.qty * form.price).toFixed(2)}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-5 border-t border-slate-100 dark:border-slate-800">
          <button onClick={onClose} className={button.secondary}>Cancel</button>
          <button
            onClick={() => onSubmit(form)}
            disabled={submitting || !form.name.trim()}
            className={button.primary + ' flex items-center gap-1.5 disabled:opacity-50'}
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Add Item
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Missing Items Modal ────────────────────────────────────────────────

function MissingItemsModal({
  open,
  onClose,
  onSubmit,
  submitting,
  roomLabel,
  currentItems,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (items: string[], staff: string) => Promise<void>;
  submitting: boolean;
  roomLabel: string;
  currentItems: string[];
}) {
  const [items, setItems] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [staff, setStaff] = useState('');

  useEffect(() => { if (open) { setItems([...currentItems]); setInput(''); setStaff(''); } }, [open, currentItems]);

  if (!open) return null;

  const addItem = () => {
    const v = input.trim();
    if (v && !items.includes(v)) { setItems([...items, v]); setInput(''); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <AlertTriangle size={18} className="text-rose-500" />
            <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">Missing Items — Room {roomLabel}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
              placeholder="e.g. Chocolate Bar"
              className="flex-1 bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-rose-500"
            />
            <button onClick={addItem} className={button.secondary + ' text-xs'}>Add</button>
          </div>
          {items.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {items.map((it, i) => (
                <span key={i} className="inline-flex items-center gap-1 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 px-2.5 py-1 rounded-lg text-xs font-bold">
                  {it}
                  <button onClick={() => setItems(items.filter((_, idx) => idx !== i))} className="hover:text-rose-800 dark:hover:text-rose-300">
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Staff (optional)</label>
            <input
              type="text"
              value={staff}
              onChange={e => setStaff(e.target.value)}
              placeholder="e.g. Priya K."
              className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-5 border-t border-slate-100 dark:border-slate-800">
          <button onClick={onClose} className={button.secondary}>Cancel</button>
          <button
            onClick={() => onSubmit(items, staff)}
            disabled={submitting}
            className={button.primary + ' flex items-center gap-1.5 disabled:opacity-50'}
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Catalog Modal ────────────────────────────────────────────────────────
function CatalogModal({
  open,
  onClose,
  onSubmit,
  submitting,
  editing,
  linkableItems = [],
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (form: { name: string; price: number; parLevel: number; inventoryItemId?: string | null }, id?: string) => Promise<void>;
  submitting: boolean;
  editing: CatalogItem | null;
  linkableItems?: { id: string; name: string }[];
}) {
  const [form, setForm] = useState<{ name: string; price: number; parLevel: number; inventoryItemId: string }>({
    name: '',
    price: 0,
    parLevel: 2,
    inventoryItemId: '',
  });

  useEffect(() => {
    if (open) {
      setForm(editing
        ? { name: editing.name, price: editing.price, parLevel: editing.parLevel, inventoryItemId: editing.inventoryItemId || '' }
        : { name: '', price: 0, parLevel: 2, inventoryItemId: '' }
      );
    }
  }, [open, editing]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <Package size={18} className="text-[var(--color-accent-operations)]" />
            <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">
              {editing ? 'Edit Catalog Item' : 'Add Catalog Item'}
            </h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800">
            <X size={16} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Item Name</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Sparkling Water"
              className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Inventory Master Item (SKU Link)</label>
            <select
              value={form.inventoryItemId}
              onChange={e => {
                const selectedId = e.target.value;
                const match = linkableItems.find(it => it.id === selectedId);
                setForm(f => ({
                  ...f,
                  inventoryItemId: selectedId,
                  name: (!f.name || f.name === '') && match ? match.name : f.name,
                }));
              }}
              className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none cursor-pointer"
            >
              <option value="">No explicit inventory link (name matching)</option>
              {linkableItems.map(it => (
                <option key={it.id} value={it.id}>{it.name}</option>
              ))}
            </select>
            <p className="text-[9px] text-slate-400 mt-1">Links to Unified Beverage / Food inventory for automatic stock deduction.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Price ($)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.price}
                onChange={e => setForm(f => ({ ...f, price: Math.max(0, parseFloat(e.target.value) || 0) }))}
                className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
              />
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
            </div>
          </div>
          <div className="text-[10px] font-mono text-slate-400 bg-slate-50 dark:bg-slate-850 rounded-lg px-3 py-2">
            Par level = target stock per room on refill. New rooms auto-stock to this level.
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-5 border-t border-slate-100 dark:border-slate-800">
          <button onClick={onClose} className={button.secondary}>Cancel</button>
          <button
            onClick={() => onSubmit(form, editing?.id)}
            disabled={submitting || !form.name.trim()}
            className={button.primary + ' flex items-center gap-1.5 disabled:opacity-50'}
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {editing ? 'Save' : 'Add Item'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────

export default function MinibarOperationsModule() {
  const { currentPropertyId, addNotification } = useERP();
  const [data, setData] = useState<MinibarData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'All' | MinibarStatus>('All');
  const [search, setSearch] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<SubTab>('rooms');
  const [sortBy, setSortBy] = useState<'room' | 'charge' | 'status' | 'updated'>('room');
  const [groupByFloor, setGroupByFloor] = useState(false);

  // Modal state
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newTaskSubmitting, setNewTaskSubmitting] = useState(false);
  const [addItemFor, setAddItemFor] = useState<MinibarRoom | null>(null);
  const [addItemSubmitting, setAddItemSubmitting] = useState(false);
  const [missingFor, setMissingFor] = useState<MinibarRoom | null>(null);
  const [missingSubmitting, setMissingSubmitting] = useState(false);
  const [confirmPostFor, setConfirmPostFor] = useState<MinibarRoom | null>(null);
  const [postSubmitting, setPostSubmitting] = useState(false);
  const [catalogEditing, setCatalogEditing] = useState<CatalogItem | null>(null);
  const [catalogSubmitting, setCatalogSubmitting] = useState(false);

  const fetchMinibar = useCallback(async () => {
    if (!currentPropertyId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/hk-portal/minibar/${currentPropertyId}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load minibar data (${res.status})`);
      const json = (await res.json()) as MinibarData;
      setData(json);
    } catch (e: any) {
      setError(e?.message || 'Failed to load minibar data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { fetchMinibar(); }, [fetchMinibar]);

  const rooms = data?.rooms || [];
  const log = data?.log || [];
  const summary = data?.summary || { pending: 0, missing: 0, verified: 0, posted: 0, revenue: 0, lowStock: 0 };
  const catalog = data?.catalog || [];

  const filtered = useMemo(
    () => rooms.filter(r => {
      const matchesStatus = filter === 'All' || r.status === filter;
      const matchesSearch = r.room.includes(search) || r.id.toLowerCase().includes(search.toLowerCase());
      return matchesStatus && matchesSearch;
    }).sort((a, b) => {
      switch (sortBy) {
        case 'charge': return b.totalCharge - a.totalCharge;
        case 'status': return STATUS_LIST.indexOf(a.status) - STATUS_LIST.indexOf(b.status);
        case 'updated': return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        default: return a.room.localeCompare(b.room, undefined, { numeric: true });
      }
    }),
    [rooms, filter, search, sortBy]
  );

  // Group by floor for display.
  const groupedByFloor = useMemo(() => {
    if (!groupByFloor) return null;
    const groups: Record<number, MinibarRoom[]> = {};
    for (const r of filtered) {
      (groups[r.floor] = groups[r.floor] || []).push(r);
    }
    return Object.entries(groups).map(([floor, rs]) => ({ floor: Number(floor), rooms: rs })).sort((a, b) => a.floor - b.floor);
  }, [filtered, groupByFloor]);

  // Count rooms ready to post (Stock Verified or Consumption Recorded with items).
  const readyToPost = useMemo(
    () => rooms.filter(r => VALID_NEXT_ACTIONS[r.status]?.includes('post-charge') && r.totalCharge > 0),
    [rooms]
  );

  // Recompute summary from rooms after local mutations.
  const recomputeSummary = (rs: MinibarRoom[]): MinibarSummary => ({
    pending: rs.filter(r => r.status === 'Pending Refill').length,
    missing: rs.filter(r => r.status === 'Missing Items').length,
    verified: rs.filter(r => r.status === 'Stock Verified').length,
    posted: rs.filter(r => r.posted).length,
    revenue: rs.filter(r => r.posted).reduce((s, r) => s + r.totalCharge, 0),
    lowStock: rs.reduce((s, r) => s + (r.inventory || []).filter(i => i.qty < i.parLevel).length, 0),
  });

  // ── Actions ──────────────────────────────────────────────────────────

  const advance = async (id: string, action: MinibarAction, label: string) => {
    if (!currentPropertyId) return;
    setActionLoading(`${action}-${id}`);
    if (action === 'post-charge') setPostSubmitting(true);
    try {
      const res = await fetch(`/api/hk-portal/minibar/${id}/advance`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to ${label.toLowerCase()} (${res.status})`);
      }
      const result = (await res.json()) as { room: MinibarRoom; folio: FolioResult | null };
      setData(prev => prev ? {
        ...prev,
        rooms: prev.rooms.map(r => r.id === id ? result.room : r),
        summary: recomputeSummary(prev.rooms.map(r => r.id === id ? result.room : r)),
      } : prev);
      if (action === 'post-charge' && result.folio) {
        const f = result.folio;
        const routedTag = f.isRouted ? ' (routed)' : '';
        addNotification(
          `Charge posted to ${f.guestName}'s folio${routedTag} — New balance: $${f.newBalance.toFixed(2)}`,
          'success',
          'Housekeeping'
        );
        setConfirmPostFor(null);
      } else {
        addNotification(`Minibar ${label.toLowerCase()}`, 'success', 'Housekeeping');
      }
      // Refresh to get updated log.
      fetchMinibar();
    } catch (e: any) {
      addNotification(e?.message || `Failed to ${label.toLowerCase()}`, 'danger', 'Housekeeping');
    } finally {
      setActionLoading(null);
      setPostSubmitting(false);
    }
  };

  const confirmPost = async () => {
    if (!confirmPostFor) return;
    await advance(confirmPostFor.id, 'post-charge', 'Charge posted to PMS');
  };

  const saveCatalogItem = async (form: { name: string; price: number; parLevel: number }, id?: string) => {
    if (!currentPropertyId) return;
    setCatalogSubmitting(true);
    try {
      const url = id ? `/api/hk-portal/minibar/catalog/${id}` : '/api/hk-portal/minibar/catalog';
      const method = id ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: authHeaders(true),
        body: JSON.stringify({
          propertyId: currentPropertyId,
          name: form.name,
          price: form.price,
          parLevel: form.parLevel,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to save catalog item (${res.status})`);
      }
      addNotification(id ? `Catalog item updated: ${form.name}` : `Catalog item added: ${form.name}`, 'success', 'Housekeeping');
      setCatalogEditing(null);
      fetchMinibar();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save catalog item', 'danger', 'Housekeeping');
    } finally {
      setCatalogSubmitting(false);
    }
  };

  const deleteCatalogItem = async (id: string, name: string) => {
    setActionLoading(`delcat-${id}`);
    try {
      const res = await fetch(`/api/hk-portal/minibar/catalog/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to delete (${res.status})`);
      }
      addNotification(`Catalog item removed: ${name}`, 'info', 'Housekeeping');
      fetchMinibar();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete catalog item', 'danger', 'Housekeeping');
    } finally {
      setActionLoading(null);
    }
  };

  const createTask = async (form: { room: string; floor: number; staff: string }) => {
    if (!currentPropertyId) return;
    setNewTaskSubmitting(true);
    try {
      const res = await fetch('/api/hk-portal/minibar', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          propertyId: currentPropertyId,
          room: form.room,
          floor: form.floor,
          staff: form.staff || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to create task (${res.status})`);
      }
      addNotification(`Minibar task created for Room ${form.room}`, 'success', 'Housekeeping');
      setNewTaskOpen(false);
      fetchMinibar();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create task', 'danger', 'Housekeeping');
    } finally {
      setNewTaskSubmitting(false);
    }
  };

  const addItem = async (form: { name: string; qty: number; price: number; staff: string }) => {
    if (!addItemFor) return;
    const roomId = addItemFor.id;
    setAddItemSubmitting(true);
    try {
      const res = await fetch(`/api/hk-portal/minibar/${roomId}/items`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          name: form.name,
          qty: form.qty,
          price: form.price,
          staff: form.staff || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to add item (${res.status})`);
      }
      const result = (await res.json()) as { item: ConsumedItem; totalCharge: number };
      setData(prev => prev ? {
        ...prev,
        rooms: prev.rooms.map(r => r.id === roomId
          ? { ...r, consumedItems: [...r.consumedItems, result.item], totalCharge: result.totalCharge }
          : r),
        summary: recomputeSummary(prev.rooms.map(r => r.id === roomId
          ? { ...r, consumedItems: [...r.consumedItems, result.item], totalCharge: result.totalCharge }
          : r)),
      } : prev);
      addNotification(`Item added: ${form.qty}× ${form.name}`, 'success', 'Housekeeping');
      setAddItemFor(null);
      fetchMinibar();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to add item', 'danger', 'Housekeeping');
    } finally {
      setAddItemSubmitting(false);
    }
  };

  const removeItem = async (roomId: string, itemId: string, itemName: string) => {
    setActionLoading(`remove-${itemId}`);
    try {
      const res = await fetch(`/api/hk-portal/minibar/${roomId}/items/${itemId}`, {
        method: 'DELETE',
        headers: authHeaders(true),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to remove item (${res.status})`);
      }
      const result = (await res.json()) as { totalCharge: number };
      setData(prev => prev ? {
        ...prev,
        rooms: prev.rooms.map(r => r.id === roomId
          ? { ...r, consumedItems: r.consumedItems.filter(c => c.id !== itemId), totalCharge: result.totalCharge }
          : r),
        summary: recomputeSummary(prev.rooms.map(r => r.id === roomId
          ? { ...r, consumedItems: r.consumedItems.filter(c => c.id !== itemId), totalCharge: result.totalCharge }
          : r)),
      } : prev);
      addNotification(`Item removed: ${itemName}`, 'info', 'Housekeeping');
      fetchMinibar();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to remove item', 'danger', 'Housekeeping');
    } finally {
      setActionLoading(null);
    }
  };

  const saveMissingItems = async (items: string[], staff: string) => {
    if (!missingFor) return;
    const roomId = missingFor.id;
    setMissingSubmitting(true);
    try {
      const res = await fetch(`/api/hk-portal/minibar/${roomId}/missing-items`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({ items, staff: staff || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to update missing items (${res.status})`);
      }
      const result = (await res.json()) as { room: MinibarRoom };
      setData(prev => prev ? {
        ...prev,
        rooms: prev.rooms.map(r => r.id === roomId ? result.room : r),
        summary: recomputeSummary(prev.rooms.map(r => r.id === roomId ? result.room : r)),
      } : prev);
      addNotification(items.length > 0 ? `${items.length} missing items set` : 'Missing items cleared', 'info', 'Housekeeping');
      setMissingFor(null);
      fetchMinibar();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update missing items', 'danger', 'Housekeeping');
    } finally {
      setMissingSubmitting(false);
    }
  };

  // ── Room card renderer ──────────────────────────────────────────────

  const renderRoomCard = (r: MinibarRoom) => {
    const tone = STATUS_TONE[r.status];
    const validActions = VALID_NEXT_ACTIONS[r.status] || [];
    const isPosted = r.status === 'Charge Posted';
    const canPost = validActions.includes('post-charge') && r.totalCharge > 0;
    return (
      <div key={r.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 card-shadow smooth-transition overflow-hidden">
        <div className={`h-1 ${statusTone[tone].dot}`} />
        <div className="p-5">
          {/* Header: room + status + total */}
          <div className="flex justify-between items-start mb-3">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]">
                <Wine className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900 dark:text-white">Room {r.room}</h3>
                <p className="text-xs text-gray-500 flex items-center gap-1">
                  {r.id} · Floor {r.floor}
                  {r.updatedAt && (
                    <span className="text-slate-400 flex items-center gap-0.5">
                      <Clock size={9} /> {timeAgo(r.updatedAt)}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Badge tone={tone}>{r.status}</Badge>
              {r.posted && (
                <span className="text-[9px] font-bold text-emerald-500 flex items-center gap-0.5">
                  <CheckCircle2 size={10} /> Folio
                </span>
              )}
            </div>
          </div>

          {/* Workflow stepper */}
          <div className="mb-3">
            <WorkflowStepper status={r.status} />
          </div>

          {/* Inventory stock levels */}
          {r.inventory && r.inventory.length > 0 && (
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Stock Levels</p>
                <span className="text-[10px] text-slate-400">
                  {r.inventory.filter(i => i.qty < i.parLevel).length} low
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {r.inventory.map(i => {
                  const isLow = i.qty < i.parLevel;
                  const isOut = i.qty === 0;
                  return (
                    <span
                      key={i.catalogId}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-bold ${
                        isOut
                          ? 'bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400'
                          : isLow
                          ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                      }`}
                      title={`${i.name} — ${i.qty}/${i.parLevel} (par)`}
                    >
                      {i.name.slice(0, 12)}{i.name.length > 12 ? '…' : ''}
                      <span className="font-black">{i.qty}/{i.parLevel}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Prominent total charge */}
          {r.totalCharge > 0 && (
            <div className="mb-3 flex items-center justify-between bg-slate-50 dark:bg-slate-850 rounded-xl px-3 py-2">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Total Charge</span>
              <span className={`text-lg font-black ${isPosted ? 'text-emerald-500' : 'text-[var(--color-accent-operations)]'}`}>
                ${r.totalCharge.toFixed(2)}
              </span>
            </div>
          )}

          {/* Consumption items */}
          {r.consumedItems.length > 0 && (
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Consumption ({r.consumedItems.length})</p>
                {!isPosted && (
                  <button
                    onClick={() => setAddItemFor(r)}
                    className="text-[10px] font-bold text-[var(--color-accent-operations)] hover:underline flex items-center gap-0.5"
                  >
                    <Plus size={10} /> Add
                  </button>
                )}
              </div>
              <div className="space-y-1">
                {r.consumedItems.map(c => (
                  <div key={c.id} className="flex justify-between text-xs font-mono items-center group">
                    <span className="font-medium text-gray-700 dark:text-gray-200">{c.qty}× {c.name}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-gray-500">${(c.qty * c.price).toFixed(2)}</span>
                      {!isPosted && (
                        <button
                          onClick={() => removeItem(r.id, c.id, c.name)}
                          disabled={actionLoading === `remove-${c.id}`}
                          className="opacity-0 group-hover:opacity-100 text-rose-400 hover:text-rose-600 transition-opacity"
                        >
                          {actionLoading === `remove-${c.id}` ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {r.consumedItems.length === 0 && !isPosted && (
            <button
              onClick={() => setAddItemFor(r)}
              className="mb-3 w-full text-xs font-bold text-slate-400 hover:text-[var(--color-accent-operations)] border border-dashed border-slate-200 dark:border-slate-700 rounded-lg py-2 flex items-center justify-center gap-1"
            >
              <Plus size={12} /> Add consumed item
            </button>
          )}

          {/* Missing items */}
          {r.missingItems.length > 0 && (
            <button
              onClick={() => setMissingFor(r)}
              className="w-full text-left text-xs text-[var(--color-danger)] font-medium bg-[var(--color-danger)]/10 rounded-lg px-2 py-1.5 mb-3 flex items-start gap-1.5 hover:bg-[var(--color-danger)]/15"
            >
              <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> Missing: {r.missingItems.join(', ')}
            </button>
          )}

          {/* Action buttons */}
          <div className="pt-3 border-t border-gray-100 dark:border-slate-700 flex flex-wrap gap-2">
            <button
              onClick={() => advance(r.id, 'refill', 'Refilled')}
              disabled={!validActions.includes('refill') || actionLoading === `refill-${r.id}`}
              className={button.ghost + ' text-xs flex items-center gap-1 disabled:opacity-40'}
            >
              {actionLoading === `refill-${r.id}` ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Refill
            </button>
            <button
              onClick={() => advance(r.id, 'record', 'Consumption recorded')}
              disabled={!validActions.includes('record') || actionLoading === `record-${r.id}`}
              className={button.ghost + ' text-xs flex items-center gap-1 disabled:opacity-40'}
            >
              {actionLoading === `record-${r.id}` ? <Loader2 size={12} className="animate-spin" /> : null}
              Record
            </button>
            <button
              onClick={() => advance(r.id, 'verify', 'Stock verified')}
              disabled={!validActions.includes('verify') || actionLoading === `verify-${r.id}`}
              className={button.ghost + ' text-xs flex items-center gap-1 disabled:opacity-40'}
            >
              {actionLoading === `verify-${r.id}` ? <Loader2 size={12} className="animate-spin" /> : <ClipboardCheck className="w-3 h-3" />}
              Verify
            </button>
            <button
              onClick={() => setConfirmPostFor(r)}
              disabled={!canPost || actionLoading === `post-charge-${r.id}`}
              className="text-xs flex items-center gap-1 rounded-xl px-3 py-1.5 font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 disabled:opacity-40 transition-colors"
            >
              {actionLoading === `post-charge-${r.id}` ? <Loader2 size={12} className="animate-spin" /> : <DollarSign className="w-3 h-3" />}
              Post to PMS
            </button>
            {!isPosted && (
              <button
                onClick={() => setMissingFor(r)}
                className={button.ghost + ' text-xs flex items-center gap-1'}
              >
                <AlertTriangle className="w-3 h-3" />
                {r.missingItems.length > 0 ? 'Edit Missing' : 'Mark Missing'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ── Loading / Error states ───────────────────────────────────────────

  if (loading && !data) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Minibar Operations" subtitle="Refill, consumption, missing items, verification & PMS charge posting." icon={Wine} />
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="animate-spin text-[var(--color-accent-operations)]" size={32} />
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Loading minibar data…</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Minibar Operations" subtitle="Refill, consumption, missing items, verification & PMS charge posting." icon={Wine} />
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <ServerCrash className="text-rose-500" size={32} />
          <p className="text-xs font-bold text-rose-500 uppercase tracking-wider">{error}</p>
          <button onClick={fetchMinibar} className={`mt-3 ${button.secondary}`}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Minibar Operations"
        subtitle="Refill, consumption, missing items, verification & PMS charge posting."
        icon={Wine}
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
            <button onClick={fetchMinibar} disabled={loading} className={button.secondary + ' flex items-center gap-1.5'}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button onClick={() => setNewTaskOpen(true)} className={button.primary + ' flex items-center gap-1.5'}>
              <Plus size={14} /> New Minibar Task
            </button>
          </div>
        }
      />

      {/* Summary tiles */}
      <div className={layout.kpiGrid}>
        <StatCard title="Pending Refill" value={summary.pending} icon={RefreshCw} tone="warning" />
        <StatCard title="Missing Items" value={summary.missing} icon={AlertTriangle} tone="danger" />
        <StatCard title="Stock Verified" value={summary.verified} icon={ClipboardCheck} tone="info" />
        <StatCard title="Charges Posted" value={summary.posted} icon={CheckCircle2} tone="success" />
        <StatCard title="Revenue Posted" value={`$${summary.revenue.toFixed(2)}`} icon={DollarSign} tone="accent" />
        <StatCard title="Low Stock Items" value={summary.lowStock} icon={Package} tone="warning" />
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
            {t.id === 'log' && log.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-bold bg-[var(--color-info)]/15 text-[var(--color-info)]">{log.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Rooms sub-tab ─────────────────────────────────────────────── */}
      {subTab === 'rooms' && (
        <>
          {/* Ready to Post banner */}
          {readyToPost.length > 0 && (
            <div className="flex items-center gap-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-2xl px-4 py-3 smooth-transition">
              <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 shrink-0">
                <DollarSign size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
                  {readyToPost.length} {readyToPost.length === 1 ? 'room is' : 'rooms are'} ready to post to PMS
                </p>
                <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                  Total pending revenue: ${readyToPost.reduce((s, r) => s + r.totalCharge, 0).toFixed(2)} · Rooms: {readyToPost.map(r => r.room).join(', ')}
                </p>
              </div>
              {readyToPost.length === 1 && (
                <button
                  onClick={() => setConfirmPostFor(readyToPost[0])}
                  className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors shrink-0"
                >
                  <DollarSign size={12} /> Post Now
                </button>
              )}
            </div>
          )}

          {/* Filters + Sort + Grouping */}
          <SectionCard pad="md">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Filter chips */}
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => setFilter('All')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    filter === 'All'
                      ? 'bg-[var(--color-accent-operations)] text-white'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                  }`}
                >
                  All
                </button>
                {STATUS_LIST.map(s => {
                  const count = rooms.filter(r => r.status === s).length;
                  if (count === 0) return null;
                  return (
                    <button
                      key={s}
                      onClick={() => setFilter(s)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                        filter === s
                          ? 'bg-[var(--color-accent-operations)] text-white'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                      }`}
                    >
                      {s}
                      <span className={`inline-flex items-center justify-center min-w-[1.1rem] h-4 px-1 rounded-full text-[9px] ${
                        filter === s ? 'bg-white/25' : 'bg-slate-200 dark:bg-slate-600'
                      }`}>{count}</span>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2">
                {/* Group by floor toggle */}
                <button
                  onClick={() => setGroupByFloor(g => !g)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                    groupByFloor
                      ? 'bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'
                  }`}
                  title="Group rooms by floor"
                >
                  <Building2 size={12} /> Floor
                </button>

                {/* Sort dropdown */}
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as typeof sortBy)}
                  className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-bold text-gray-700 dark:text-gray-200 outline-none cursor-pointer"
                >
                  <option value="room">Sort: Room</option>
                  <option value="charge">Sort: Charge</option>
                  <option value="status">Sort: Status</option>
                  <option value="updated">Sort: Recent</option>
                </select>

                {/* Search */}
                <div className="relative w-full max-w-[180px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input
                    placeholder="Search room..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 text-xs border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
                  />
                </div>
              </div>
            </div>
          </SectionCard>

          {/* Room cards — optionally grouped by floor */}
          {groupByFloor && groupedByFloor ? (
            <div className="space-y-6">
              {groupedByFloor.map(group => (
                <div key={group.floor}>
                  <div className="flex items-center gap-2 mb-3">
                    <Building2 size={14} className="text-slate-400" />
                    <h3 className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">Floor {group.floor}</h3>
                    <span className="text-[10px] font-bold text-slate-400 bg-slate-100 dark:bg-slate-700 rounded-full px-2 py-0.5">{group.rooms.length}</span>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {group.rooms.map(r => renderRoomCard(r))}
                  </div>
                </div>
              ))}
              {groupedByFloor.length === 0 && (
                <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 p-8 rounded-2xl text-center text-sm text-gray-500">
                  No minibar rooms match the filters.
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {filtered.map(r => renderRoomCard(r))}
              </div>
              {filtered.length === 0 && (
                <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 p-8 rounded-2xl text-center text-sm text-gray-500">
                  No minibar rooms match the filters.
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── Operation Log sub-tab ─────────────────────────────────────── */}
      {subTab === 'log' && (
        <SectionCard
          title="Operation Log"
          subtitle="All minibar status changes, item additions, and missing-item updates"
          icon={ClipboardList}
          tone="neutral"
          pad="md"
        >
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {log.map(e => {
              const isItemOp = e.action === 'Item Added' || e.action === 'Item Removed';
              const isMissing = e.action === 'Missing Items Set' || e.action === 'Missing Items Cleared';
              const isCreated = e.action === 'Created';
              const iconColor = isCreated ? 'text-indigo-600' : isItemOp ? 'text-amber-600' : isMissing ? 'text-rose-600' : e.action === 'Charge Posted' ? 'text-emerald-600' : 'text-slate-600';
              const iconBg = isCreated ? 'bg-indigo-50 dark:bg-indigo-500/10' : isItemOp ? 'bg-amber-50 dark:bg-amber-500/10' : isMissing ? 'bg-rose-50 dark:bg-rose-500/10' : e.action === 'Charge Posted' ? 'bg-emerald-50 dark:bg-emerald-500/10' : 'bg-slate-100 dark:bg-slate-700';
              return (
                <div key={e.id} className="py-3 flex items-center gap-4">
                  <div className={`p-2 rounded-xl shrink-0 ${iconBg} ${iconColor}`}>
                    {isItemOp ? <Package size={14} /> : isMissing ? <AlertTriangle size={14} /> : isCreated ? <Plus size={14} /> : e.action === 'Charge Posted' ? <DollarSign size={14} /> : <ClipboardCheck size={14} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge tone={isMissing ? 'danger' : isCreated ? 'info' : e.action === 'Charge Posted' ? 'success' : 'neutral'} variant="soft">{e.action}</Badge>
                      <span className="text-xs font-bold text-gray-700 dark:text-gray-200">Room {e.room}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 font-medium truncate mt-1">
                      {e.detail}{e.staff && ` · ${e.staff}`}
                    </p>
                  </div>
                  <span className="text-[9px] font-mono text-slate-400 shrink-0" title={e.createdAt}>{formatDateTime(e.createdAt)}</span>
                </div>
              );
            })}
            {log.length === 0 && (
              <div className="py-8 text-center text-[10px] font-bold text-slate-400 uppercase">No operations recorded.</div>
            )}
          </div>
        </SectionCard>
      )}

      {/* ── Sub-Tab: Catalog & Pricing ────────────────────────────────── */}
      {subTab === 'catalog' && (
        <SectionCard
          title="Minibar Catalog & Pricing"
          subtitle="Define master minibar SKUs, guest pricing, target room par levels, and explicit unified inventory linkages."
          actions={
            <button
              onClick={() => setCatalogEditing({ id: '', name: '', price: 0, parLevel: 2, active: true })}
              className={button.primary + ' flex items-center gap-1.5 text-xs'}
            >
              <Plus size={14} />
              Add Item
            </button>
          }
        >
          {/* Catalog table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-700 text-left">
                  <th className="py-2 px-3 font-black text-slate-400 uppercase tracking-wider">Item</th>
                  <th className="py-2 px-3 font-black text-slate-400 uppercase tracking-wider">Inventory Master Link (SKU)</th>
                  <th className="py-2 px-3 font-black text-slate-400 uppercase tracking-wider text-right">Price</th>
                  <th className="py-2 px-3 font-black text-slate-400 uppercase tracking-wider text-center">Par Level</th>
                  <th className="py-2 px-3 font-black text-slate-400 uppercase tracking-wider text-center">Rooms Low</th>
                  <th className="py-2 px-3 font-black text-slate-400 uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-700/50">
                {catalog.map(c => {
                  const roomsLow = rooms.filter(r =>
                    (r.inventory || []).some(i => i.catalogId === c.id && i.qty < i.parLevel)
                  ).length;
                  const linkedItem = linkableItems.find(it => it.id === c.inventoryItemId);

                  return (
                    <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="py-2.5 px-3 font-bold text-slate-700 dark:text-slate-200">{c.name}</td>
                      <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400 font-mono text-[10px]">
                        {linkedItem ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold">
                            <CheckCircle2 size={11} /> {linkedItem.name}
                          </span>
                        ) : c.inventoryItemId ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-bold">Linked SKU</span>
                        ) : (
                          <span className="text-amber-500 font-medium">Unlinked (Name Match)</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-600 dark:text-slate-300">${c.price.toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-center font-mono font-bold text-slate-700 dark:text-slate-200">{c.parLevel}</td>
                      <td className="py-2.5 px-3 text-center">
                        {roomsLow > 0 ? (
                          <span className="inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400">
                            {roomsLow}
                          </span>
                        ) : (
                          <CheckCircle2 size={14} className="inline text-emerald-500" />
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setCatalogEditing(c)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10"
                            title="Edit"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            onClick={() => deleteCatalogItem(c.id, c.name)}
                            disabled={actionLoading === `delcat-${c.id}`}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 disabled:opacity-40"
                            title="Delete"
                          >
                            {actionLoading === `delcat-${c.id}` ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {catalog.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-[10px] font-bold text-slate-400 uppercase">
                      No catalog items. Click "Add Item" to create the minibar catalog.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* ── Modals ────────────────────────────────────────────────────── */}
      <NewTaskModal
        open={newTaskOpen}
        onClose={() => setNewTaskOpen(false)}
        onSubmit={createTask}
        submitting={newTaskSubmitting}
      />
      <AddItemModal
        open={addItemFor !== null}
        onClose={() => setAddItemFor(null)}
        onSubmit={addItem}
        submitting={addItemSubmitting}
        roomLabel={addItemFor?.room || ''}
      />
      <MissingItemsModal
        open={missingFor !== null}
        onClose={() => setMissingFor(null)}
        onSubmit={saveMissingItems}
        submitting={missingSubmitting}
        roomLabel={missingFor?.room || ''}
        currentItems={missingFor?.missingItems || []}
      />
      <ConfirmPostModal
        open={confirmPostFor !== null}
        onClose={() => setConfirmPostFor(null)}
        onConfirm={confirmPost}
        submitting={postSubmitting}
        room={confirmPostFor}
      />
      <CatalogModal
        open={catalogEditing !== null}
        onClose={() => setCatalogEditing(null)}
        onSubmit={saveCatalogItem}
        submitting={catalogSubmitting}
        editing={catalogEditing && catalogEditing.id ? catalogEditing : null}
        linkableItems={linkableItems}
      />
    </div>
  );
}
