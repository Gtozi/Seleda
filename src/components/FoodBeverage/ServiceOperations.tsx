/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 *
 * Service Operations module — F&B Portal.
 * Owns Outlet Operations, Table Management, Reservations, Waitlist,
 * Service Standards, and Guest Requests.
 * Per spec §18 (Reservations), §19 (Table Management), §20 (Guest Experience).
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Utensils,
  Table2,
  CalendarCheck,
  Clock,
  ShieldCheck,
  ConciergeBell,
  Plus,
  Pencil,
  Trash2,
  Search,
  Users,
  CheckCircle2,
  AlertTriangle,
  X,
  Phone,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';

type SubTab = 'outlet-ops' | 'tables' | 'reservations' | 'waitlist' | 'service-standards' | 'guest-requests';

interface TableInfo {
  id: string;
  table_number: string;
  outlet_id: string;
  outlet_name: string | null;
  section: string;
  seats: number;
  shape: string;
  status: 'available' | 'occupied' | 'reserved' | 'dirty' | 'out_of_service';
  current_order_id: string | null;
  turn_start_time: string | null;
}

interface TableReservation {
  id: string;
  table_id: string;
  guest_name: string;
  party_size: number;
  arrival_time: string;
  status: 'confirmed' | 'seated' | 'no_show' | 'cancelled';
  special_requests: string | null;
}

interface WaitlistEntry {
  id: string;
  guest_name: string;
  party_size: number;
  contact_phone: string | null;
  estimated_wait_time: number;
  queued_at: string | null;
  seated: boolean;
  cancelled: boolean;
  status: 'waiting' | 'seated' | 'left';
}

interface ServiceStandard {
  id: string;
  name: string;
  target_value: string;
  actual_value: string;
  unit: string;
  status: 'Meeting' | 'Below' | 'Exceeded';
  outlet_id: string | null;
  measured_at: string;
}

interface GuestRequest {
  id: string;
  guest_name: string | null;
  room_number: string | null;
  outlet_id: string | null;
  outlet_name: string | null;
  request: string;
  priority: 'Low' | 'Medium' | 'High';
  status: 'Open' | 'In Progress' | 'Resolved';
  logged_at: string;
}

const SUB_TABS: { id: SubTab; label: string; icon: typeof Utensils }[] = [
  { id: 'outlet-ops', label: 'Outlet Operations', icon: Utensils },
  { id: 'tables', label: 'Table Management', icon: Table2 },
  { id: 'reservations', label: 'Reservations', icon: CalendarCheck },
  { id: 'waitlist', label: 'Waitlist', icon: Clock },
  { id: 'service-standards', label: 'Service Standards', icon: ShieldCheck },
  { id: 'guest-requests', label: 'Guest Requests', icon: ConciergeBell },
];

const TABLE_STATUS_TONE: Record<TableInfo['status'], 'success' | 'info' | 'warning' | 'accent' | 'neutral' | 'danger'> = {
  available: 'success',
  reserved: 'info',
  occupied: 'accent',
  dirty: 'neutral',
  'out_of_service': 'danger',
};

const RSV_STATUS_TONE: Record<TableReservation['status'], 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  confirmed: 'info',
  seated: 'success',
  'no_show': 'danger',
  cancelled: 'neutral',
};

const STANDARD_TONE: Record<ServiceStandard['status'], 'success' | 'danger' | 'warning'> = {
  Meeting: 'success',
  Below: 'danger',
  Exceeded: 'success',
};

const PRIORITY_TONE: Record<GuestRequest['priority'], 'danger' | 'warning' | 'neutral'> = {
  High: 'danger',
  Medium: 'warning',
  Low: 'neutral',
};

const REQ_STATUS_TONE: Record<GuestRequest['status'], 'warning' | 'info' | 'success'> = {
  Open: 'warning',
  'In Progress': 'info',
  Resolved: 'success',
};

export default function ServiceOperations() {
  const { addNotification } = useERP();
  const [subTab, setSubTab] = useState<SubTab>('outlet-ops');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);

  const [tables, setTables] = useState<TableInfo[]>([]);
  const [tableReservations, setTableReservations] = useState<TableReservation[]>([]);
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [serviceStandards, setServiceStandards] = useState<ServiceStandard[]>([]);
  const [guestRequests, setGuestRequests] = useState<GuestRequest[]>([]);
  const [loading, setLoading] = useState(false);

  // Modal / editing state
  const [editingTable, setEditingTable] = useState<TableInfo | null>(null);
  const [editingReservation, setEditingReservation] = useState<TableReservation | null>(null);
  const [seatingWaitlist, setSeatingWaitlist] = useState<WaitlistEntry | null>(null);
  const [editingStandard, setEditingStandard] = useState<ServiceStandard | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [tablesRes, resRes, waitRes, ssRes, grRes] = await Promise.all([
        fetch('/api/fb/tables'),
        fetch('/api/fb/table-reservations'),
        fetch('/api/fb/waitlist'),
        fetch('/api/fb/service-standards'),
        fetch('/api/fb/guest-requests'),
      ]);
      if (tablesRes.ok && tablesRes.headers.get('content-type')?.includes('json')) setTables(await tablesRes.json());
      if (resRes.ok && resRes.headers.get('content-type')?.includes('json')) setTableReservations(await resRes.json());
      if (waitRes.ok && waitRes.headers.get('content-type')?.includes('json')) setWaitlist(await waitRes.json());
      if (ssRes.ok && ssRes.headers.get('content-type')?.includes('json')) setServiceStandards(await ssRes.json());
      if (grRes.ok && grRes.headers.get('content-type')?.includes('json')) setGuestRequests(await grRes.json());
    } catch (err) {
      console.error('Failed to fetch service ops data:', err);
      addNotification('Failed to load service operations data', 'warning', 'F&B');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const stats = useMemo(() => {
    const occupiedTables = tables.filter(t => t.status === 'occupied').length;
    const occupiedSeats = tables.filter(t => t.status === 'occupied').reduce((s, t) => s + t.seats, 0);
    return {
      openTables: occupiedTables,
      totalTables: tables.length,
      occupancy: tables.length ? Math.round((tables.filter(t => t.status === 'occupied').length / tables.length) * 100) : 0,
      seatedCovers: occupiedSeats,
      reservations: tableReservations.filter(r => r.status === 'confirmed' || r.status === 'seated').length,
      waiting: waitlist.filter(w => w.status === 'waiting').length,
      openRequests: guestRequests.filter(g => g.status !== 'Resolved').length,
    };
  }, [tables, tableReservations, waitlist, guestRequests]);

  const outletOps = useMemo(() => {
    const outletStats: Record<string, { covers: number; orders: number; capacity: number; status: string; reservations: number; name: string }> = {};
    tables.forEach(t => {
      if (!outletStats[t.outlet_id]) outletStats[t.outlet_id] = { covers: 0, orders: 0, capacity: 0, status: 'Closed', reservations: 0, name: t.outlet_name || t.outlet_id.substring(0, 8) };
      if (t.status === 'occupied') outletStats[t.outlet_id].covers += t.seats;
      if (t.current_order_id) outletStats[t.outlet_id].orders += 1;
      outletStats[t.outlet_id].capacity += t.seats;
      outletStats[t.outlet_id].status = 'Open';
    });
    tableReservations.forEach(r => {
      const table = tables.find(t => t.id === r.table_id);
      if (table && !outletStats[table.outlet_id]) outletStats[table.outlet_id] = { covers: 0, orders: 0, capacity: 0, status: 'Closed', reservations: 0, name: table.outlet_name || table.outlet_id.substring(0, 8) };
      if (table) outletStats[table.outlet_id].reservations += 1;
      if (table) outletStats[table.outlet_id].status = 'Open';
    });
    return Object.entries(outletStats).map(([outletId, stats]) => {
      return { outletId, outlet: stats.name, ...stats };
    });
  }, [tables, tableReservations]);

  const filteredTables = tables.filter(t => t.table_number.toLowerCase().includes(search.toLowerCase()));
  const filteredReservations = tableReservations.filter(r => r.guest_name.toLowerCase().includes(search.toLowerCase()));
  const filteredWaitlist = waitlist.filter(w => w.guest_name.toLowerCase().includes(search.toLowerCase()));
  const filteredRequests = guestRequests.filter(g => g.guest_name?.toLowerCase().includes(search.toLowerCase()) || g.request.toLowerCase().includes(search.toLowerCase()));

  const handleDelete = async (id: string, type: string) => {
    if (!confirm('Are you sure you want to delete this item?')) return;
    try {
      const endpoint = `/api/fb/${type}/${id}`;
      const res = await fetch(endpoint, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      addNotification('Deleted successfully', 'success', 'F&B');
      fetchData();
    } catch (err) {
      console.error('Delete error:', err);
      addNotification('Failed to delete', 'warning', 'F&B');
    }
  };

  // ── Table actions ──────────────────────────────────────────────────
  const handleCleanTable = async (t: TableInfo) => {
    try {
      const res = await fetch(`/api/fb/tables/${t.id}/clean`, { method: 'PUT' });
      if (!res.ok) throw new Error('Failed to clean table');
      addNotification(`Table ${t.table_number} marked clean`, 'success', 'F&B');
      fetchData();
    } catch (err) {
      console.error('Clean table error:', err);
      addNotification('Failed to clean table', 'warning', 'F&B');
    }
  };

  const handleSaveTable = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingTable) return;
    const form = e.target as HTMLFormElement;
    const seats = parseInt((form.elements.namedItem('seats') as HTMLInputElement).value);
    const section = (form.elements.namedItem('section') as HTMLInputElement).value;
    const status = (form.elements.namedItem('status') as HTMLSelectElement).value as TableInfo['status'];
    const shape = (form.elements.namedItem('shape') as HTMLInputElement).value;
    try {
      const res = await fetch(`/api/fb/tables/${editingTable.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seats, section, status, shape }),
      });
      if (!res.ok) throw new Error('Failed to update table');
      addNotification(`Table ${editingTable.table_number} updated`, 'success', 'F&B');
      setEditingTable(null);
      fetchData();
    } catch (err) {
      console.error('Update table error:', err);
      addNotification('Failed to update table', 'warning', 'F&B');
    }
  };

  // ── Reservation actions ────────────────────────────────────────────
  const handleSeatReservation = async (r: TableReservation) => {
    const table = tables.find(t => t.id === r.table_id);
    try {
      const res = await fetch(`/api/fb/table-reservations/${r.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'seated', seated_at: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error('Failed to seat reservation');
      addNotification(`Seated ${r.guest_name} at ${table?.table_number || 'table'}`, 'success', 'F&B');
      fetchData();
    } catch (err) {
      console.error('Seat reservation error:', err);
      addNotification('Failed to seat reservation', 'warning', 'F&B');
    }
  };

  const handleSaveReservation = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingReservation) return;
    const form = e.target as HTMLFormElement;
    const guestName = (form.elements.namedItem('guestName') as HTMLInputElement).value;
    const partySize = parseInt((form.elements.namedItem('partySize') as HTMLInputElement).value);
    const tableId = (form.elements.namedItem('tableId') as HTMLSelectElement).value;
    const status = (form.elements.namedItem('status') as HTMLSelectElement).value as TableReservation['status'];
    const specialRequests = (form.elements.namedItem('specialRequests') as HTMLInputElement).value;
    try {
      const res = await fetch(`/api/fb/table-reservations/${editingReservation.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guest_name: guestName, party_size: partySize, table_id: tableId, status, special_requests: specialRequests || null }),
      });
      if (!res.ok) throw new Error('Failed to update reservation');
      addNotification(`Reservation for ${guestName} updated`, 'success', 'F&B');
      setEditingReservation(null);
      fetchData();
    } catch (err) {
      console.error('Update reservation error:', err);
      addNotification('Failed to update reservation', 'warning', 'F&B');
    }
  };

  // ── Waitlist actions ───────────────────────────────────────────────
  const handleNotifyWaitlist = async (w: WaitlistEntry) => {
    try {
      const res = await fetch(`/api/fb/waitlist/${w.id}/notify`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to notify guest');
      addNotification(`Notified ${w.guest_name}`, 'info', 'F&B');
      fetchData();
    } catch (err) {
      console.error('Notify waitlist error:', err);
      addNotification('Failed to notify guest', 'warning', 'F&B');
    }
  };

  const handleCancelWaitlist = async (w: WaitlistEntry) => {
    if (!confirm(`Cancel waitlist entry for ${w.guest_name}?`)) return;
    try {
      const res = await fetch(`/api/fb/waitlist/${w.id}/cancel`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to cancel waitlist entry');
      addNotification(`${w.guest_name} removed from waitlist`, 'info', 'F&B');
      fetchData();
    } catch (err) {
      console.error('Cancel waitlist error:', err);
      addNotification('Failed to cancel waitlist entry', 'warning', 'F&B');
    }
  };

  const handleSeatWaitlist = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!seatingWaitlist) return;
    const form = e.target as HTMLFormElement;
    const tableId = (form.elements.namedItem('tableId') as HTMLSelectElement).value;
    try {
      const res = await fetch('/api/fb/waitlist/seat-next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId, partySize: seatingWaitlist.party_size }),
      });
      if (!res.ok) throw new Error('Failed to seat guest');
      addNotification(`Seated ${seatingWaitlist.guest_name}`, 'success', 'F&B');
      setSeatingWaitlist(null);
      fetchData();
    } catch (err) {
      console.error('Seat waitlist error:', err);
      addNotification('Failed to seat guest', 'warning', 'F&B');
    }
  };

  // ── Guest request actions ──────────────────────────────────────────
  const handleAdvanceGuestRequest = async (g: GuestRequest) => {
    const nextStatus: GuestRequest['status'] = g.status === 'Open' ? 'In Progress' : 'Resolved';
    try {
      const res = await fetch(`/api/fb/guest-requests/${g.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error('Failed to update guest request');
      addNotification(`Request "${g.request.substring(0, 30)}…" → ${nextStatus}`, 'info', 'F&B');
      fetchData();
    } catch (err) {
      console.error('Update guest request error:', err);
      addNotification('Failed to update guest request', 'warning', 'F&B');
    }
  };

  // ── Service standard actions ───────────────────────────────────────
  const handleSaveStandard = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingStandard) return;
    const form = e.target as HTMLFormElement;
    const name = (form.elements.namedItem('name') as HTMLInputElement).value;
    const targetValue = (form.elements.namedItem('targetValue') as HTMLInputElement).value;
    const actualValue = (form.elements.namedItem('actualValue') as HTMLInputElement).value;
    const unit = (form.elements.namedItem('unit') as HTMLInputElement).value;
    const status = (form.elements.namedItem('status') as HTMLSelectElement).value as ServiceStandard['status'];
    try {
      const res = await fetch(`/api/fb/service-standards/${editingStandard.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, targetValue, actualValue, unit, status }),
      });
      if (!res.ok) throw new Error('Failed to update service standard');
      addNotification(`Standard "${name}" updated`, 'success', 'F&B');
      setEditingStandard(null);
      fetchData();
    } catch (err) {
      console.error('Update standard error:', err);
      addNotification('Failed to update service standard', 'warning', 'F&B');
    }
  };

  return (
    <div className={['accent-fb', layout.sectionStack].join(' ')}>
      <PageHeader
        title="Service Operations"
        subtitle="Outlet operations, tables, reservations, waitlist, service standards, and guest requests"
        icon={Utensils}
        actions={
          <>
            <button onClick={() => { fetchData(); addNotification('Service ops refreshed', 'info', 'F&B'); }} className={button.secondary}>
              <Clock className="w-4 h-4" /> Refresh
            </button>
            <button onClick={() => setShowModal(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> New Reservation
            </button>
          </>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Occupancy" value={`${stats.occupancy}%`} icon={Users} tone="accent" caption={`${stats.openTables}/${stats.totalTables} tables`} />
        <StatCard title="Seated Covers" value={stats.seatedCovers} icon={Utensils} tone="info" />
        <StatCard title="Reservations" value={stats.reservations} icon={CalendarCheck} tone="success" />
        <StatCard title="Waiting / Requests" value={`${stats.waiting} / ${stats.openRequests}`} icon={Clock} tone="warning" />
      </div>

      <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto">
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => { setSubTab(t.id); setSearch(''); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all whitespace-nowrap ${
              subTab === t.id
                ? 'bg-white dark:bg-slate-700 text-[var(--color-accent-operations)] shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <t.icon className="w-4 h-4" />
            <span className="text-sm font-medium">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search..."
          className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
        />
      </div>

      {/* Outlet Operations */}
      {subTab === 'outlet-ops' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {loading ? (
            <div className="col-span-full text-center text-slate-500 py-8">Loading outlet operations...</div>
          ) : outletOps.length === 0 ? (
            <div className="col-span-full text-center text-slate-500 py-8">No outlet data available</div>
          ) : outletOps.map(o => {
            const occPct = o.capacity === 999 ? null : Math.round((o.covers / o.capacity) * 100);
            return (
              <div key={o.outletId} className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-5 card-shadow">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900 dark:text-white">{o.outlet}</h3>
                  <Badge tone={o.status === 'Open' ? 'success' : 'neutral'}>{o.status}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-xs text-slate-500">Covers</p><p className="font-semibold text-gray-900 dark:text-white">{o.covers}</p></div>
                  <div><p className="text-xs text-slate-500">Open Orders</p><p className="font-semibold text-gray-900 dark:text-white">{o.orders}</p></div>
                  <div><p className="text-xs text-slate-500">Reservations</p><p className="font-semibold text-gray-900 dark:text-white">{o.reservations}</p></div>
                  <div><p className="text-xs text-slate-500">Capacity</p><p className="font-semibold text-gray-900 dark:text-white">{o.capacity === 999 ? 'Unlimited' : o.capacity}</p></div>
                </div>
                {occPct !== null && (
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-slate-500 mb-1"><span>Occupancy</span><span>{occPct}%</span></div>
                    <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div className="h-full bg-[var(--color-accent-operations)] rounded-full" style={{ width: `${occPct}%` }} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Tables */}
      {subTab === 'tables' && (
        <SectionCard>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Table</th>
                  <th className="px-6 py-3 font-medium">Outlet</th>
                  <th className="px-6 py-3 font-medium">Section</th>
                  <th className="px-6 py-3 font-medium">Seats</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Order</th>
                  <th className="px-6 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {loading ? (
                  <tr><td colSpan={7} className="px-6 py-4 text-center text-slate-500">Loading...</td></tr>
                ) : filteredTables.length === 0 ? (
                  <tr><td colSpan={7} className="px-6 py-4 text-center text-slate-500">No tables found</td></tr>
                ) : filteredTables.map(t => (
                  <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{t.table_number}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{t.outlet_name || t.outlet_id.substring(0, 8)}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{t.section}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{t.seats}</td>
                    <td className="px-6 py-3"><Badge tone={TABLE_STATUS_TONE[t.status]}>{t.status}</Badge></td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{t.current_order_id || '—'}</td>
                    <td className="px-6 py-3 text-right">
                      <div className="inline-flex gap-2">
                        <button onClick={() => setEditingTable(t)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit table"><Pencil className="w-4 h-4" /></button>
                        {t.status === 'dirty' && (
                          <button onClick={() => handleCleanTable(t)} className="p-1 text-slate-400 hover:text-green-600" title="Mark clean"><CheckCircle2 className="w-4 h-4" /></button>
                        )}
                        {t.status !== 'available' && t.status !== 'out_of_service' && (
                          <button onClick={() => handleCleanTable(t)} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Clear / reset table"><Trash2 className="w-4 h-4" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* Reservations */}
      {subTab === 'reservations' && (
        <SectionCard>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Guest</th>
                  <th className="px-6 py-3 font-medium">Date</th>
                  <th className="px-6 py-3 font-medium">Time</th>
                  <th className="px-6 py-3 font-medium">Covers</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Notes</th>
                  <th className="px-6 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {loading ? (
                  <tr><td colSpan={7} className="px-6 py-4 text-center text-slate-500">Loading...</td></tr>
                ) : filteredReservations.length === 0 ? (
                  <tr><td colSpan={7} className="px-6 py-4 text-center text-slate-500">No reservations found</td></tr>
                ) : filteredReservations.map(r => {
                  const table = tables.find(t => t.id === r.table_id);
                  return (
                    <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{r.guest_name}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.arrival_time.split('T')[0]}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.arrival_time.split('T')[1]?.substring(0, 5) || '—'}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.party_size}</td>
                      <td className="px-6 py-3"><Badge tone={RSV_STATUS_TONE[r.status]}>{r.status}</Badge></td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.special_requests || '—'}</td>
                      <td className="px-6 py-3 text-right">
                        <div className="inline-flex gap-2">
                          {r.status === 'confirmed' && (
                            <button onClick={() => handleSeatReservation(r)} className="p-1 text-slate-400 hover:text-green-600" title="Seat guest"><CheckCircle2 className="w-4 h-4" /></button>
                          )}
                          <button onClick={() => setEditingReservation(r)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit reservation"><Pencil className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* Waitlist */}
      {subTab === 'waitlist' && (
        <SectionCard>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Guest</th>
                  <th className="px-6 py-3 font-medium">Party Size</th>
                  <th className="px-6 py-3 font-medium">Quoted Wait</th>
                  <th className="px-6 py-3 font-medium">Joined</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {loading ? (
                  <tr><td colSpan={6} className="px-6 py-4 text-center text-slate-500">Loading...</td></tr>
                ) : filteredWaitlist.length === 0 ? (
                  <tr><td colSpan={6} className="px-6 py-4 text-center text-slate-500">No waitlist entries found</td></tr>
                ) : filteredWaitlist.map(w => {
                  const status = w.seated ? 'seated' : w.cancelled ? 'left' : 'waiting';
                  return (
                    <tr key={w.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{w.guest_name}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{w.party_size}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{w.estimated_wait_time} min</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{w.queued_at ? w.queued_at.split('T')[1]?.substring(0, 5) : '—'}</td>
                      <td className="px-6 py-3"><Badge tone={status === 'waiting' ? 'warning' : status === 'seated' ? 'success' : 'neutral'}>{status}</Badge></td>
                      <td className="px-6 py-3 text-right">
                        <div className="inline-flex gap-2">
                          {status === 'waiting' && (
                            <button onClick={() => setSeatingWaitlist(w)} className="px-2 py-1 text-xs rounded-lg bg-[var(--color-accent-operations)] text-white">Seat</button>
                          )}
                          {status === 'waiting' && (
                            <button onClick={() => handleNotifyWaitlist(w)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Notify guest"><Phone className="w-4 h-4" /></button>
                          )}
                          {status !== 'left' && (
                            <button onClick={() => handleCancelWaitlist(w)} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Cancel / remove"><Trash2 className="w-4 h-4" /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* Service Standards */}
      {subTab === 'service-standards' && (
        <SectionCard>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Standard</th>
                  <th className="px-6 py-3 font-medium">Target</th>
                  <th className="px-6 py-3 font-medium">Actual</th>
                  <th className="px-6 py-3 font-medium">Performance</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {loading ? (
                  <tr><td colSpan={6} className="px-6 py-4 text-center text-slate-500">Loading...</td></tr>
                ) : serviceStandards.length === 0 ? (
                  <tr><td colSpan={6} className="px-6 py-4 text-center text-slate-500">No service standards found</td></tr>
                ) : serviceStandards.map(s => (
                  <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{s.name}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{s.target_value}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{s.actual_value}</td>
                    <td className="px-6 py-3">
                      {s.status === 'Meeting' && <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />}
                      {s.status === 'Below' && <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400" />}
                      {s.status === 'Exceeded' && <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />}
                    </td>
                    <td className="px-6 py-3"><Badge tone={STANDARD_TONE[s.status]}>{s.status}</Badge></td>
                    <td className="px-6 py-3 text-right">
                      <div className="inline-flex gap-2">
                        <button onClick={() => setEditingStandard(s)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit standard"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => handleDelete(s.id, 'service-standards')} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete standard"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* Guest Requests */}
      {subTab === 'guest-requests' && (
        <SectionCard>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Guest</th>
                  <th className="px-6 py-3 font-medium">Room</th>
                  <th className="px-6 py-3 font-medium">Outlet</th>
                  <th className="px-6 py-3 font-medium">Request</th>
                  <th className="px-6 py-3 font-medium">Priority</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Logged</th>
                  <th className="px-6 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {loading ? (
                  <tr><td colSpan={8} className="px-6 py-4 text-center text-slate-500">Loading...</td></tr>
                ) : filteredRequests.length === 0 ? (
                  <tr><td colSpan={8} className="px-6 py-4 text-center text-slate-500">No guest requests found</td></tr>
                ) : filteredRequests.map(g => (
                  <tr key={g.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{g.guest_name || '—'}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{g.room_number || '—'}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{g.outlet_name || '—'}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{g.request}</td>
                    <td className="px-6 py-3"><Badge tone={PRIORITY_TONE[g.priority]}>{g.priority}</Badge></td>
                    <td className="px-6 py-3"><Badge tone={REQ_STATUS_TONE[g.status]}>{g.status}</Badge></td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{g.logged_at ? g.logged_at.split('T')[1]?.substring(0, 5) : '—'}</td>
                    <td className="px-6 py-3 text-right">
                      {g.status !== 'Resolved' && (
                        <button onClick={() => handleAdvanceGuestRequest(g)} className="px-2 py-1 text-xs rounded-lg bg-[var(--color-accent-operations)] text-white" title={g.status === 'Open' ? 'Mark In Progress' : 'Mark Resolved'}>
                          {g.status === 'Open' ? 'Start' : 'Resolve'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-md border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">New Reservation</h2>
              <button onClick={() => setShowModal(false)} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              const form = e.target as HTMLFormElement;
              const guestName = (form.elements.namedItem('guestName') as HTMLInputElement).value;
              const date = (form.elements.namedItem('date') as HTMLInputElement).value;
              const time = (form.elements.namedItem('time') as HTMLInputElement).value;
              const covers = (form.elements.namedItem('covers') as HTMLInputElement).value;
              const tableId = (form.elements.namedItem('tableId') as HTMLSelectElement).value;
              const specialRequests = (form.elements.namedItem('specialRequests') as HTMLInputElement).value;
              try {
                const res = await fetch('/api/fb/table-reservations', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    table_id: tableId,
                    guest_name: guestName,
                    arrival_time: `${date}T${time}:00Z`,
                    party_size: parseInt(covers),
                    status: 'confirmed',
                    special_requests: specialRequests || null,
                  }),
                });
                if (!res.ok) throw new Error('Failed to create reservation');
                addNotification('Reservation created', 'success', 'F&B');
                setShowModal(false);
                fetchData();
              } catch (err) {
                console.error('Create reservation error:', err);
                addNotification('Failed to create reservation', 'warning', 'F&B');
              }
            }}>
              <div className="space-y-3">
                <input name="guestName" className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" placeholder="Guest name" required />
                <select name="tableId" className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" required defaultValue="">
                  <option value="" disabled>Select table…</option>
                  {tables.map(t => (
                    <option key={t.id} value={t.id}>{t.table_number} — {t.outlet_name || 'Outlet'} ({t.seats} seats)</option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-3">
                  <input name="date" type="date" className="px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" required />
                  <input name="time" type="time" className="px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" required />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input name="covers" type="number" min={1} className="px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" placeholder="Covers" required />
                  <input name="specialRequests" className="px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" placeholder="Special requests (optional)" />
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="submit" className={button.primary}>Create</button>
                  <button type="button" onClick={() => setShowModal(false)} className={button.secondary}>Cancel</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Table Modal */}
      {editingTable && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-md border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Edit Table {editingTable.table_number}</h2>
              <button onClick={() => setEditingTable(null)} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSaveTable}>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">Seats</label>
                    <input name="seats" type="number" min={1} defaultValue={editingTable.seats} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" required />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Section</label>
                    <input name="section" defaultValue={editingTable.section} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" required />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">Shape</label>
                    <input name="shape" defaultValue={editingTable.shape} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" required />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Status</label>
                    <select name="status" defaultValue={editingTable.status} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
                      <option value="available">Available</option>
                      <option value="occupied">Occupied</option>
                      <option value="reserved">Reserved</option>
                      <option value="dirty">Dirty</option>
                      <option value="out_of_service">Out of Service</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="submit" className={button.primary}>Save</button>
                  <button type="button" onClick={() => setEditingTable(null)} className={button.secondary}>Cancel</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Reservation Modal */}
      {editingReservation && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-md border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Edit Reservation</h2>
              <button onClick={() => setEditingReservation(null)} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSaveReservation}>
              <div className="space-y-3">
                <input name="guestName" defaultValue={editingReservation.guest_name} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" placeholder="Guest name" required />
                <select name="tableId" defaultValue={editingReservation.table_id} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" required>
                  {tables.map(t => (
                    <option key={t.id} value={t.id}>{t.table_number} — {t.outlet_name || 'Outlet'} ({t.seats} seats)</option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">Party Size</label>
                    <input name="partySize" type="number" min={1} defaultValue={editingReservation.party_size} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" required />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Status</label>
                    <select name="status" defaultValue={editingReservation.status} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
                      <option value="confirmed">Confirmed</option>
                      <option value="seated">Seated</option>
                      <option value="no_show">No Show</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                </div>
                <input name="specialRequests" defaultValue={editingReservation.special_requests || ''} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" placeholder="Special requests (optional)" />
                <div className="flex gap-3 pt-2">
                  <button type="submit" className={button.primary}>Save</button>
                  <button type="button" onClick={() => setEditingReservation(null)} className={button.secondary}>Cancel</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Seat Waitlist Modal */}
      {seatingWaitlist && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-md border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Seat {seatingWaitlist.guest_name}</h2>
              <button onClick={() => setSeatingWaitlist(null)} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSeatWaitlist}>
              <div className="space-y-3">
                <p className="text-sm text-slate-500">Party size: {seatingWaitlist.party_size} · Quoted wait: {seatingWaitlist.estimated_wait_time} min</p>
                <label className="text-xs text-slate-500">Assign to table</label>
                <select name="tableId" className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" required defaultValue="">
                  <option value="" disabled>Select available table…</option>
                  {tables.filter(t => t.status === 'available' && t.seats >= seatingWaitlist.party_size).map(t => (
                    <option key={t.id} value={t.id}>{t.table_number} — {t.outlet_name || 'Outlet'} ({t.seats} seats)</option>
                  ))}
                </select>
                {tables.filter(t => t.status === 'available' && t.seats >= seatingWaitlist.party_size).length === 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">No available tables with enough seats. Free up a table first or seat a smaller party.</p>
                )}
                <div className="flex gap-3 pt-2">
                  <button type="submit" className={button.primary}>Seat Guest</button>
                  <button type="button" onClick={() => setSeatingWaitlist(null)} className={button.secondary}>Cancel</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Service Standard Modal */}
      {editingStandard && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-md border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Edit Service Standard</h2>
              <button onClick={() => setEditingStandard(null)} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSaveStandard}>
              <div className="space-y-3">
                <input name="name" defaultValue={editingStandard.name} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" placeholder="Standard name" required />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">Target</label>
                    <input name="targetValue" defaultValue={editingStandard.target_value} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" required />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Actual</label>
                    <input name="actualValue" defaultValue={editingStandard.actual_value} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" required />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">Unit</label>
                    <input name="unit" defaultValue={editingStandard.unit} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" required />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Status</label>
                    <select name="status" defaultValue={editingStandard.status} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
                      <option value="Meeting">Meeting</option>
                      <option value="Below">Below</option>
                      <option value="Exceeded">Exceeded</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="submit" className={button.primary}>Save</button>
                  <button type="button" onClick={() => setEditingStandard(null)} className={button.secondary}>Cancel</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
