/**
 * Reservations & Allocations — /erp/inventory/reservations-allocations
 *
 * DB-backed inventory reservations:
 *   - KPI StatCards (Active, Released this period, Cancelled, Total Reserved Qty)
 *   - Segmented status filter (All / Active / Released / Cancelled / Fulfilled) + search
 *   - Reservations table with per-row actions (Edit, Release, Cancel, Delete)
 *   - New / Edit modal (item, store, quantity, department, reference, required_date, expiry_date, notes)
 *   - Multi-property scoping via currentPropertyId from useERP()
 */
import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Package, Plus, Search, Clock, Loader2, ServerCrash, MoreVertical, Trash2, Edit3, Check, X, CalendarClock } from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchReservations, createReservation, updateReservation, deleteReservation,
  fetchItems, fetchStores,
  type UinvReservation, type UinvItem, type UinvStore,
} from '../../services/inventoryService';
import InventoryTable, { IdentityCell, OpsCell, IconButton } from './InventoryTable';

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

const STATUS_FILTERS = ['All', 'Active', 'Released', 'Cancelled', 'Fulfilled'] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

function statusToneFor(status: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (['Released', 'Fulfilled'].includes(status)) return 'success';
  if (['Active'].includes(status)) return 'warning';
  if (['Cancelled'].includes(status)) return 'danger';
  return 'neutral';
}

const ReservationsModule: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [reservations, setReservations] = useState<UinvReservation[]>([]);
  const [stores, setStores] = useState<UinvStore[]>([]);
  const [items, setItems] = useState<UinvItem[]>([]);

  // Form
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<UinvReservation>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const propertyId = currentPropertyId || undefined;
      const [res, st, it] = await Promise.all([
        fetchReservations({ propertyId }),
        fetchStores({ propertyId, active: 'true' }),
        fetchItems({ propertyId, active: 'true' }),
      ]);
      setReservations(res);
      setStores(st);
      setItems(it);
    } catch (e: any) {
      setError(e?.message || 'Failed to load reservations data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const itemLabel = (id?: string | null) => {
    if (!id) return '—';
    return items.find(i => i.id === id)?.item_name || reservations.find(r => r.item_id === id)?.item?.item_name || id;
  };
  const storeLabel = (id?: string | null) => {
    if (!id) return '—';
    return stores.find(s => s.id === id)?.store_name || reservations.find(r => r.store_id === id)?.store?.store_name || id;
  };

  const kpis = useMemo(() => {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    return {
      active: reservations.filter(r => r.status === 'Active').length,
      released: reservations.filter(r => r.status === 'Released' && r.updated_at && r.updated_at >= periodStart).length,
      cancelled: reservations.filter(r => r.status === 'Cancelled').length,
      totalReservedQty: reservations
        .filter(r => r.status === 'Active')
        .reduce((sum, r) => sum + (Number(r.quantity) || 0), 0),
    };
  }, [reservations]);

  const matchSearch = (s: string | null | undefined) => !search || (s || '').toLowerCase().includes(search.toLowerCase());

  const filtered = useMemo(() => {
    return reservations.filter(r => {
      if (statusFilter !== 'All' && r.status !== statusFilter) return false;
      return matchSearch(r.reservation_number) || matchSearch(r.department) || matchSearch(r.reference);
    });
  }, [reservations, statusFilter, search]);

  // ── Form actions ──
  const openCreateForm = () => {
    setEditingId(null);
    setForm({
      property_id: currentPropertyId,
      status: 'Active',
      quantity: 0,
      required_date: new Date().toISOString().slice(0, 10),
    });
    setShowForm(true);
  };

  const openEditForm = (r: UinvReservation) => {
    setEditingId(r.id);
    setForm({ ...r });
    setShowForm(true);
    setMenuOpen(null);
  };

  const submitForm = async () => {
    if (!form.item_id || !form.store_id || !form.quantity) {
      addNotification('Item, store and quantity are required.', 'warning', 'Inventory');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        ...form,
        property_id: currentPropertyId,
        quantity: Number(form.quantity),
        required_date: form.required_date || null,
        expiry_date: form.expiry_date || null,
        department: form.department || null,
        reference: form.reference || null,
        notes: form.notes || null,
      };
      if (editingId) {
        await updateReservation(editingId, payload);
        addNotification('Reservation updated.', 'success', 'Inventory');
      } else {
        await createReservation(payload);
        addNotification('Reservation created.', 'success', 'Inventory');
      }
      setShowForm(false);
      setEditingId(null);
      load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save reservation', 'warning', 'Inventory');
    } finally {
      setSubmitting(false);
    }
  };

  const releaseReservation = async (r: UinvReservation) => {
    if (!r.id) return;
    setActingOn(r.id);
    try {
      await updateReservation(r.id, { status: 'Released' });
      addNotification(`Reservation ${r.reservation_number} released.`, 'success', 'Inventory');
      load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to release reservation', 'warning', 'Inventory');
    } finally {
      setActingOn(null);
      setMenuOpen(null);
    }
  };

  const cancelReservation = async (r: UinvReservation) => {
    if (!r.id) return;
    setActingOn(r.id);
    try {
      await updateReservation(r.id, { status: 'Cancelled' });
      addNotification(`Reservation ${r.reservation_number} cancelled.`, 'task', 'Inventory');
      load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to cancel reservation', 'warning', 'Inventory');
    } finally {
      setActingOn(null);
      setMenuOpen(null);
    }
  };

  const removeReservation = async (id: string) => {
    setActingOn(id);
    try {
      await deleteReservation(id);
      addNotification('Reservation deleted.', 'task', 'Inventory');
      load();
    } catch (e: any) {
      addNotification(e?.message || 'Delete failed', 'warning', 'Inventory');
    } finally {
      setActingOn(null);
      setMenuOpen(null);
    }
  };

  const renderMenu = (id: string, children: ReactNode) => (
    <div className="relative">
      <IconButton title="Actions" onClick={() => setMenuOpen(menuOpen === id ? null : id)}>
        <MoreVertical className="w-4 h-4" />
      </IconButton>
      {menuOpen === id && (
        <div className="absolute right-0 top-full mt-1 z-10 w-44 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg py-1" onMouseLeave={() => setMenuOpen(null)}>
          {children}
        </div>
      )}
    </div>
  );

  const itemSelect = (value: string, onChange: (v: string) => void) => (
    <select className={inputClass} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">Select item…</option>
      {items.map(i => <option key={i.id} value={i.id}>{i.item_name}</option>)}
    </select>
  );
  const storeSelect = (value: string, onChange: (v: string) => void) => (
    <select className={inputClass} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">Select store…</option>
      {stores.map(s => <option key={s.id} value={s.id}>{s.store_name}</option>)}
    </select>
  );

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Reservations & Allocations"
        subtitle="Reserve stock for departments, events and references. Track active, released, cancelled and fulfilled reservations."
        icon={CalendarClock}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />} Refresh
            </button>
            <button onClick={openCreateForm} className={button.primary}><Plus className="w-4 h-4" /> New Reservation</button>
          </div>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Active Reservations" value={kpis.active} icon={CalendarClock} tone="warning" />
        <StatCard title="Released (This Period)" value={kpis.released} icon={Check} tone="success" />
        <StatCard title="Cancelled" value={kpis.cancelled} icon={X} tone="danger" />
        <StatCard title="Total Reserved Qty" value={kpis.totalReservedQty} icon={Package} tone="info" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      <SectionCard pad="md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1">
            {STATUS_FILTERS.map(f => (
              <button key={f} onClick={() => { setStatusFilter(f); setMenuOpen(null); }}
                className={['px-3 py-1.5 rounded-lg text-xs font-medium transition',
                  statusFilter === f ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'].join(' ')}>
                {f}
              </button>
            ))}
          </div>
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input placeholder="Search reservation #, dept, ref…" value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>
        </div>
      </SectionCard>

      <InventoryTable
        rows={filtered}
        rowKey={r => r.id}
        loading={loading}
        error={error}
        onRetry={load}
        emptyMessage="No reservations found. Create one to reserve stock for a department or reference."
        columns={[
          { key: 'number', header: 'Reservation #', widthClass: 'md:w-40 shrink-0', render: r => <span className="font-medium text-slate-900 dark:text-white">{r.reservation_number}</span> },
          { key: 'item', header: 'Item', widthClass: 'md:w-56 shrink-0', render: r => <span className="text-sm text-slate-700 dark:text-slate-300">{itemLabel(r.item_id)}</span> },
          { key: 'store', header: 'Store', widthClass: 'md:w-40 shrink-0', render: r => <span className="text-sm text-slate-600">{storeLabel(r.store_id)}</span> },
          { key: 'qty', header: 'Qty', widthClass: 'md:w-24 shrink-0', align: 'right', render: r => <span className="text-sm font-medium">{r.quantity}</span> },
          { key: 'dept', header: 'Department', widthClass: 'md:w-36 shrink-0', render: r => <span className="text-sm text-slate-600">{r.department || '—'}</span> },
          { key: 'ref', header: 'Reference', widthClass: 'md:w-36 shrink-0', render: r => <span className="text-sm text-slate-600 dark:text-slate-400 truncate max-w-xs">{r.reference || '—'}</span> },
          { key: 'required', header: 'Required Date', widthClass: 'md:w-32 shrink-0', render: r => <span className="text-xs text-slate-500">{r.required_date ? r.required_date.slice(0, 10) : '—'}</span> },
          { key: 'expiry', header: 'Expiry Date', widthClass: 'md:w-32 shrink-0', render: r => <span className="text-xs text-slate-500">{r.expiry_date ? r.expiry_date.slice(0, 10) : '—'}</span> },
          { key: 'status', header: 'Status', widthClass: 'md:w-28 shrink-0', render: r => <Badge tone={statusToneFor(r.status)} variant="solid">{r.status}</Badge> },
          { key: 'ops', header: 'Ops', widthClass: 'md:w-40 shrink-0', align: 'right', render: r => (
            <OpsCell>
              {r.status === 'Active' && <IconButton onClick={() => releaseReservation(r)} title="Release"><Check className="w-4 h-4" /></IconButton>}
              {renderMenu(r.id, (
                <>
                  <button onClick={() => openEditForm(r)} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2">
                    <Edit3 className="w-4 h-4" /> Edit
                  </button>
                  {r.status === 'Active' && (
                    <button onClick={() => releaseReservation(r)} disabled={actingOn === r.id} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2 disabled:opacity-50">
                      {actingOn === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Release
                    </button>
                  )}
                  {r.status === 'Active' && (
                    <button onClick={() => cancelReservation(r)} disabled={actingOn === r.id} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2 disabled:opacity-50">
                      {actingOn === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />} Cancel
                    </button>
                  )}
                  <button onClick={() => removeReservation(r.id)} disabled={actingOn === r.id} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 disabled:opacity-50">
                    {actingOn === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete
                  </button>
                </>
              ))}
            </OpsCell>
          ) },
        ]}
      />

      {/* ── New / Edit Modal ── */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditingId(null); }}
        onConfirm={submitForm}
        title={editingId ? 'Edit Reservation' : 'New Reservation'}
        loading={submitting}
        confirmLabel={editingId ? 'Save' : 'Create'}
      >
        <div className="space-y-4">
          <Field label="Item *">{itemSelect(form.item_id || '', v => setForm({ ...form, item_id: v }))}</Field>
          <Field label="Store *">{storeSelect(form.store_id || '', v => setForm({ ...form, store_id: v }))}</Field>
          <Field label="Quantity *">
            <input type="number" className={inputClass} value={form.quantity ?? 0} onChange={e => setForm({ ...form, quantity: Number(e.target.value) })} />
          </Field>
          <Field label="Department">
            <input className={inputClass} value={form.department || ''} onChange={e => setForm({ ...form, department: e.target.value || null })} placeholder="e.g. F&B, Housekeeping" />
          </Field>
          <Field label="Reference">
            <input className={inputClass} value={form.reference || ''} onChange={e => setForm({ ...form, reference: e.target.value || null })} placeholder="e.g. Event #, PO #" />
          </Field>
          <Field label="Required Date">
            <input type="date" className={inputClass} value={form.required_date ? form.required_date.slice(0, 10) : ''} onChange={e => setForm({ ...form, required_date: e.target.value || null })} />
          </Field>
          <Field label="Expiry Date">
            <input type="date" className={inputClass} value={form.expiry_date ? form.expiry_date.slice(0, 10) : ''} onChange={e => setForm({ ...form, expiry_date: e.target.value || null })} />
          </Field>
          <Field label="Notes">
            <textarea className={inputClass} rows={2} value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value || null })} />
          </Field>
        </div>
      </ModalSystem>
    </div>
  );
};

export default ReservationsModule;
