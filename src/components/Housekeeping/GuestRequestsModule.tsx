/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Guest Requests module — docs/Housekeeping Portal new.md §17.
 * Handles the 9 housekeeping guest request types listed in the doc.
 *
 * DB-integrated: reads from /api/front-office/guest-requests?department=HK
 * (the shared guest_requests table) and persists status changes back via PUT.
 * New requests are created with assigned_department='HK'.
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Bath,
  BedDouble,
  Layers,
  Baby,
  Shirt,
  HandPlatter,
  SprayCan,
  Moon,
  Gift,
  Plus,
  Search,
  Clock,
  CheckCircle2,
  PlayCircle,
  Bell,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';

type RequestType =
  | 'Extra Towels' | 'Extra Pillows' | 'Extra Blanket' | 'Baby Cot'
  | 'Iron & Iron Board' | 'Laundry Pickup' | 'Cleaning Request'
  | 'Turndown Request' | 'Special Amenities';

// DB status values: Open | In Progress | Completed (plus legacy: Pending, Acknowledged)
type RequestStatus = 'Pending' | 'In Progress' | 'Completed';

interface GuestRequest {
  id: string;
  type: RequestType;
  room: string;
  guest: string;
  qty?: number;
  status: RequestStatus;
  requestedAt: string;
  priority: 'Normal' | 'Urgent';
  assignedTo?: string;
}

const TYPE_ICON: Record<RequestType, LucideIcon> = {
  'Extra Towels': Bath,
  'Extra Pillows': BedDouble,
  'Extra Blanket': Layers,
  'Baby Cot': Baby,
  'Iron & Iron Board': Shirt,
  'Laundry Pickup': HandPlatter,
  'Cleaning Request': SprayCan,
  'Turndown Request': Moon,
  'Special Amenities': Gift,
};

const ALL_TYPES = Object.keys(TYPE_ICON) as RequestType[];

const STATUS_TONE: Record<RequestStatus, StatusTone> = {
  Pending: 'warning',
  'In Progress': 'info',
  Completed: 'success',
};

const PRIORITY_TONE: Record<'Normal' | 'Urgent', StatusTone> = {
  Normal: 'neutral',
  Urgent: 'danger',
};

// ── Auth headers ───────────────────────────────────────────────────────
function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

// Normalize a DB row (snake_case) into the module's camelCase contract.
function shapeRequest(row: any): GuestRequest {
  // Map DB status to the 3-state UI contract.
  const rawStatus = String(row.status || 'Open');
  let status: RequestStatus = 'Pending';
  if (rawStatus === 'In Progress' || rawStatus === 'assigned' || rawStatus === 'Acknowledged') {
    status = 'In Progress';
  } else if (rawStatus === 'Completed' || rawStatus === 'completed') {
    status = 'Completed';
  } else {
    status = 'Pending'; // Open / Pending
  }

  const priority: 'Normal' | 'Urgent' =
    row.priority === 'Urgent' || row.priority === 'High' ? 'Urgent' : 'Normal';

  // requestedAt: prefer submitted_at (ISO), format to time label.
  let requestedAt = '';
  if (row.submitted_at) {
    const d = new Date(row.submitted_at);
    requestedAt = isNaN(d.getTime()) ? String(row.submitted_at) : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (row.created_at) {
    const d = new Date(row.created_at);
    requestedAt = isNaN(d.getTime()) ? String(row.created_at) : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return {
    id: row.id,
    type: (row.request_type || 'Cleaning Request') as RequestType,
    room: row.room_number || '',
    guest: row.guest_name || '',
    qty: row.quantity ? Number(row.quantity) : undefined,
    status,
    requestedAt,
    priority,
    assignedTo: row.assigned_to || undefined,
  };
}

const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

export default function GuestRequestsModule() {
  const { currentPropertyId, addNotification } = useERP();
  const [requests, setRequests] = useState<GuestRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'All' | RequestStatus>('All');
  const [typeFilter, setTypeFilter] = useState<'All' | RequestType>('All');
  const [search, setSearch] = useState('');
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    type: 'Extra Towels' as RequestType,
    room: '',
    guest: '',
    qty: '',
    priority: 'Normal' as 'Normal' | 'Urgent',
  });

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch HK-department requests from the shared guest_requests table.
      const res = await fetch('/api/front-office/guest-requests?department=HK', { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load guest requests (${res.status})`);
      const data = await res.json();
      const shaped = (data.requests || []).map(shapeRequest);
      setRequests(shaped);
    } catch (e: any) {
      setError(e?.message || 'Failed to load guest requests');
      console.error('[hk-guest-requests] fetch failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const filtered = useMemo(
    () =>
      requests.filter(r => {
        const matchesStatus = filter === 'All' || r.status === filter;
        const matchesType = typeFilter === 'All' || r.type === typeFilter;
        const matchesSearch =
          r.room.toLowerCase().includes(search.toLowerCase()) ||
          r.guest.toLowerCase().includes(search.toLowerCase()) ||
          r.type.toLowerCase().includes(search.toLowerCase());
        return matchesStatus && matchesType && matchesSearch;
      }),
    [requests, filter, typeFilter, search]
  );

  const advance = async (id: string, current: RequestStatus) => {
    setActingOn(id);
    try {
      const nextStatus = current === 'Pending' ? 'In Progress' : 'Completed';
      const body: any = { status: nextStatus, assignedDepartment: 'HK' };
      if (nextStatus === 'In Progress' && !requests.find(r => r.id === id)?.assignedTo) {
        body.assignedTo = 'Dispatched Attendant';
      }
      const res = await fetch(`/api/front-office/guest-requests/${id}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to update (${res.status})`);
      }
      setRequests(prev => prev.map(r => r.id === id ? {
        ...r,
        status: nextStatus,
        assignedTo: r.assignedTo ?? (nextStatus === 'In Progress' ? 'Dispatched Attendant' : undefined),
      } : r));
      addNotification(`Guest request ${id} ${nextStatus === 'In Progress' ? 'dispatched' : 'completed'}`, nextStatus === 'In Progress' ? 'info' : 'success', 'Housekeeping');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update request', 'error', 'Housekeeping');
    } finally {
      setActingOn(null);
    }
  };

  const submitRequest = async () => {
    if (!form.room.trim() || !form.guest.trim()) return;
    setActingOn('new');
    try {
      const description = `${form.type}${form.qty ? ` (x${form.qty})` : ''}`;
      const body: any = {
        guestName: form.guest.trim(),
        roomNumber: form.room.trim(),
        requestType: form.type,
        description,
        priority: form.priority,
        assignedDepartment: 'HK',
      };
      if (currentPropertyId) body.propertyId = currentPropertyId;
      const res = await fetch('/api/front-office/guest-requests', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to create (${res.status})`);
      }
      const created = await res.json();
      setRequests(prev => [shapeRequest(created), ...prev]);
      addNotification('Guest request logged', 'success', 'Housekeeping');
      setShowForm(false);
      setForm({ type: 'Extra Towels', room: '', guest: '', qty: '', priority: 'Normal' });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create request', 'error', 'Housekeeping');
    } finally {
      setActingOn(null);
    }
  };

  const counts = {
    pending: requests.filter(r => r.status === 'Pending').length,
    inProgress: requests.filter(r => r.status === 'In Progress').length,
    completed: requests.filter(r => r.status === 'Completed').length,
    urgent: requests.filter(r => r.priority === 'Urgent').length,
  };

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Guest Requests"
        subtitle="Housekeeping guest request dispatch & tracking."
        icon={Bell}
        actions={
          <button onClick={() => setShowForm(s => !s)} className={button.primary}>
            <Plus className="w-4 h-4" /> Log Request
          </button>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Pending" value={counts.pending} icon={Clock} tone="warning" />
        <StatCard title="In Progress" value={counts.inProgress} icon={PlayCircle} tone="info" />
        <StatCard title="Completed" value={counts.completed} icon={CheckCircle2} tone="success" />
        <StatCard title="Urgent" value={counts.urgent} icon={Bell} tone="danger" />
      </div>

      {showForm && (
        <SectionCard title="Log New Request" icon={Plus} tone="accent" pad="md">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="block">
              <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Type</span>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as RequestType }))} className={inputClass}>
                {ALL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Room</span>
              <input placeholder="e.g. 204" value={form.room} onChange={e => setForm(f => ({ ...f, room: e.target.value }))} className={inputClass} />
            </label>
            <label className="block">
              <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Guest</span>
              <input placeholder="Guest name" value={form.guest} onChange={e => setForm(f => ({ ...f, guest: e.target.value }))} className={inputClass} />
            </label>
            <label className="block">
              <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Qty</span>
              <input placeholder="e.g. 4" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} className={inputClass} />
            </label>
            <label className="block">
              <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Priority</span>
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value as 'Normal' | 'Urgent' }))} className={inputClass}>
                <option value="Normal">Normal</option>
                <option value="Urgent">Urgent</option>
              </select>
            </label>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={submitRequest} disabled={actingOn === 'new' || !form.room.trim() || !form.guest.trim()} className={button.primary + ' disabled:opacity-50'}>
              {actingOn === 'new' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Submit
            </button>
            <button onClick={() => setShowForm(false)} className={button.ghost}>Cancel</button>
          </div>
        </SectionCard>
      )}

      {/* Request type quick reference */}
      <SectionCard title="Request Types" subtitle="Click to filter by type" pad="md">
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
          {ALL_TYPES.map(t => {
            const Icon = TYPE_ICON[t];
            const count = requests.filter(r => r.type === t && r.status !== 'Completed').length;
            return (
              <button
                key={t}
                onClick={() => setTypeFilter(typeFilter === t ? 'All' : t)}
                className={`p-2.5 rounded-xl border text-center transition-all ${typeFilter === t ? 'border-[var(--color-accent-operations)] ring-1 ring-[var(--color-accent-operations)]/30 bg-[var(--color-accent-operations)]/10' : 'border-gray-200 dark:border-slate-700 hover:border-[var(--color-accent-operations)]/50'}`}
              >
                <Icon className="w-4 h-4 mx-auto text-[var(--color-accent-operations)] mb-1" />
                <p className="text-[10px] font-bold uppercase leading-tight text-gray-700 dark:text-gray-300">{t}</p>
                {count > 0 && <span className="block text-[10px] font-bold text-[var(--color-danger)] mt-1">{count} open</span>}
              </button>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard pad="md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1">
            {(['All', 'Pending', 'In Progress', 'Completed'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)} className={`px-4 py-1.5 rounded-lg text-xs font-medium transition ${filter === f ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{f}</button>
            ))}
          </div>
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input placeholder="Search room, guest, type..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>
        </div>
      </SectionCard>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
          {error}
        </div>
      )}

      <SectionCard pad="none">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" />
            Loading guest requests…
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {filtered.map(r => {
              const Icon = TYPE_ICON[r.type] ?? Bell;
              return (
                <div key={r.id} className="p-4 flex flex-col md:flex-row md:items-center gap-4">
                  <div className="flex items-center gap-3 md:w-64 shrink-0">
                    <div className="p-2 rounded-xl bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]"><Icon className="w-4 h-4" /></div>
                    <div>
                      <h4 className="text-sm font-bold text-gray-900 dark:text-white uppercase">{r.type}</h4>
                      <p className="text-xs text-gray-500">{r.id.slice(0, 12)} · Room {r.room} · {r.guest}{r.qty ? ` · ${r.qty} pcs` : ''}</p>
                    </div>
                  </div>
                  <div className="flex-1 flex flex-wrap items-center gap-3 text-xs">
                    <span className="text-gray-500">Requested {r.requestedAt}</span>
                    {r.priority === 'Urgent' && <Badge tone={PRIORITY_TONE[r.priority]} variant="solid">Urgent</Badge>}
                    {r.assignedTo && <span className="text-gray-500">→ {r.assignedTo}</span>}
                  </div>
                  <div className="flex items-center gap-3 md:w-44 shrink-0">
                    <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                    {r.status !== 'Completed' && (
                      <button
                        onClick={() => advance(r.id, r.status)}
                        disabled={actingOn === r.id}
                        className={button.ghost + ' text-xs disabled:opacity-50'}
                      >
                        {actingOn === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                        {r.status === 'Pending' ? 'Dispatch' : 'Complete'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && <div className="p-8 text-center text-sm text-gray-500">No guest requests match the filters.</div>}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
