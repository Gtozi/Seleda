/**
 * Visitor Management — /erp/security/visitors.
 *
 * DB-integrated via /api/sec-portal/visitors routes (migration 603).
 * Check-in/check-out transitions stamp timestamps server-side and log a
 * sec_access_events row so visitor movements surface in the SOC feed.
 *
 * UI follows the HK StaffManagementModule / F&B StaffOperations pattern:
 * PageHeader, StatCard KPIs, SectionCard + DataTable, Badge status pills,
 * ModalSystem forms, ERP notifications on mutations.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Users, Plus, Search, Clock, CheckCircle2, Eye, Pencil, Trash2, Tag,
  Building2, IdCard, LogIn, LogOut, RefreshCw, Loader2,
  ServerCrash, Filter, Ban, Phone, Mail, CalendarDays,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import {
  fetchSecVisitors, createSecVisitor, updateSecVisitor, deleteSecVisitor,
  fetchSecStaff,
  type SecVisitor, type SecVisitorStatus, type SecVisitorType, type SecStaff,
} from '../../services/securityService';

// ── Static registries ────────────────────────────────────────────────────

const VISITOR_TYPES: SecVisitorType[] = [
  'Contractor', 'Vendor', 'Interview Candidate', 'Delivery Personnel',
  'Government Official', 'VIP Visitor', 'General Visitor',
];

const VISITOR_STATUSES: SecVisitorStatus[] = [
  'Pre-registered', 'Checked In', 'Checked Out', 'Blacklisted', 'Expired',
];

const TYPE_TONE: Record<SecVisitorType, StatusTone> = {
  'Contractor': 'info',
  'Vendor': 'success',
  'Interview Candidate': 'accent',
  'Delivery Personnel': 'warning',
  'Government Official': 'danger',
  'VIP Visitor': 'danger',
  'General Visitor': 'neutral',
};

const STATUS_TONE: Record<SecVisitorStatus, StatusTone> = {
  'Pre-registered': 'neutral',
  'Checked In': 'success',
  'Checked Out': 'info',
  'Blacklisted': 'danger',
  'Expired': 'warning',
};

// ── UI helpers ───────────────────────────────────────────────────────────

const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

const filterSelect =
  'bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-1.5 text-[10px] font-black uppercase text-slate-600 dark:text-slate-300 outline-none cursor-pointer';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function isToday(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function DataTable({ headers, rows, empty, emptyColSpan }: {
  headers: string[];
  rows: ReactNode[][];
  empty: boolean;
  emptyColSpan: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
          <tr>{headers.map((h, i) => <th key={i} className="px-6 py-3 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
          {rows.map((row, ri) => (
            <tr key={ri} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
              {row.map((cell, ci) => <td key={ci} className="px-6 py-3 text-slate-600 dark:text-slate-400">{cell}</td>)}
            </tr>
          ))}
          {empty && (
            <tr><td colSpan={emptyColSpan} className="px-6 py-8 text-center text-slate-400">No visitors found.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function LoadingRow() {
  return (
    <div className="flex items-center justify-center py-10 text-slate-400">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
    </div>
  );
}

const actionBtn = 'px-3 py-1 rounded-lg text-xs font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed';

// ── Component ────────────────────────────────────────────────────────────

const VisitorManagement: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [visitors, setVisitors] = useState<SecVisitor[]>([]);
  const [staff, setStaff] = useState<SecStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | SecVisitorStatus>('all');
  const [filterType, setFilterType] = useState<'all' | SecVisitorType>('all');

  // Modals
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SecVisitor | null>(null);
  const [detail, setDetail] = useState<SecVisitor | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SecVisitor | null>(null);

  const emptyForm = {
    name: '', company: '', visitorType: 'General Visitor' as SecVisitorType,
    host: '', purpose: '', phone: '', email: '',
    expectedArrivalAt: '', expectedDepartureAt: '',
  };
  const [form, setForm] = useState({ ...emptyForm });

  // ── Data loading ───────────────────────────────────────────────────────

  const loadVisitors = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setVisitors(await fetchSecVisitors(currentPropertyId));
    } catch (e: any) {
      setError(e?.message || 'Failed to load visitors');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  const loadStaff = useCallback(async () => {
    try {
      setStaff(await fetchSecStaff(currentPropertyId));
    } catch { /* non-fatal — host datalist stays empty */ }
  }, [currentPropertyId]);

  useEffect(() => { loadVisitors(); loadStaff(); }, [loadVisitors, loadStaff]);

  const refreshAll = async () => {
    await Promise.all([loadVisitors(), loadStaff()]);
    addNotification('Visitor register refreshed', 'task', 'Security');
  };

  // ── Derived data ───────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    onSite: visitors.filter(v => v.status === 'Checked In').length,
    today: visitors.filter(v => isToday(v.check_in_at) || isToday(v.expected_arrival_at) || isToday(v.created_at)).length,
    badges: visitors.filter(v => v.badge_number).length,
    blacklisted: visitors.filter(v => v.blacklist_status !== 'Clear' || v.status === 'Blacklisted').length,
  }), [visitors]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return visitors.filter(v => {
      const matchesStatus = filterStatus === 'all' || v.status === filterStatus;
      const matchesType = filterType === 'all' || v.visitor_type === filterType;
      const matchesSearch = !q ||
        v.id.toLowerCase().includes(q) ||
        v.name.toLowerCase().includes(q) ||
        (v.company?.toLowerCase().includes(q) ?? false) ||
        (v.host?.toLowerCase().includes(q) ?? false) ||
        (v.badge_number?.toLowerCase().includes(q) ?? false);
      return matchesStatus && matchesType && matchesSearch;
    });
  }, [visitors, filterStatus, filterType, search]);

  // ── Mutations ──────────────────────────────────────────────────────────

  const openNew = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  };

  const openEdit = (v: SecVisitor) => {
    setEditing(v);
    setForm({
      name: v.name,
      company: v.company || '',
      visitorType: v.visitor_type,
      host: v.host || '',
      purpose: v.purpose || '',
      phone: v.phone || '',
      email: v.email || '',
      expectedArrivalAt: v.expected_arrival_at ? v.expected_arrival_at.slice(0, 16) : '',
      expectedDepartureAt: v.expected_departure_at ? v.expected_departure_at.slice(0, 16) : '',
    });
    setShowForm(true);
  };

  const saveVisitor = async () => {
    if (!form.name.trim()) {
      addNotification('Visitor name is required', 'warning', 'Security');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name: form.name.trim(),
        company: form.company || null,
        visitorType: form.visitorType,
        host: form.host || null,
        purpose: form.purpose || null,
        phone: form.phone || null,
        email: form.email || null,
        expectedArrivalAt: form.expectedArrivalAt ? new Date(form.expectedArrivalAt).toISOString() : null,
        expectedDepartureAt: form.expectedDepartureAt ? new Date(form.expectedDepartureAt).toISOString() : null,
      };
      if (editing) {
        const res = await updateSecVisitor(editing.id, payload);
        setVisitors(prev => prev.map(v => (v.id === editing.id ? res.visitor : v)));
        if (detail?.id === editing.id) setDetail(res.visitor);
        addNotification(`Visitor ${editing.id} updated`, 'task', 'Security');
      } else {
        const created = await createSecVisitor({ propertyId: currentPropertyId, ...payload });
        setVisitors(prev => [created, ...prev]);
        addNotification(`Visitor ${created.name} registered — badge ${created.badge_number}`, 'task', 'Security');
      }
      setShowForm(false);
      setEditing(null);
      setForm({ ...emptyForm });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save visitor', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const setStatus = async (v: SecVisitor, status: SecVisitorStatus, blacklistStatus?: string) => {
    setActingOn(v.id);
    try {
      const res = await updateSecVisitor(v.id, { status, ...(blacklistStatus !== undefined ? { blacklistStatus } : {}) });
      setVisitors(prev => prev.map(x => (x.id === v.id ? res.visitor : x)));
      if (detail?.id === v.id) setDetail(res.visitor);
      const verb = status === 'Checked In' ? 'checked in' : status === 'Checked Out' ? 'checked out' : `marked ${status}`;
      addNotification(`${v.name} ${verb}`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Status update failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const removeVisitor = async () => {
    if (!deleteTarget) return;
    setActingOn(deleteTarget.id);
    try {
      await deleteSecVisitor(deleteTarget.id);
      setVisitors(prev => prev.filter(v => v.id !== deleteTarget.id));
      if (detail?.id === deleteTarget.id) setDetail(null);
      addNotification(`Visitor ${deleteTarget.id} deleted`, 'task', 'Security');
      setDeleteTarget(null);
    } catch (e: any) {
      addNotification(e?.message || 'Delete failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Visitor Management"
        subtitle="Register, check in, and track visitors on property"
        icon={IdCard}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={openNew} className={button.primary}>
              <Plus className="w-4 h-4" /> Register Visitor
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Currently On Site" value={stats.onSite} icon={LogIn} tone="success" />
        <StatCard title="Expected / Today" value={stats.today} icon={CalendarDays} tone="info" />
        <StatCard title="Badges Issued" value={stats.badges} icon={IdCard} tone="accent" />
        <StatCard title="Blacklisted" value={stats.blacklisted} icon={Ban} tone="danger" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={loadVisitors} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {/* Filters */}
      <SectionCard pad="md">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, company, host, badge…"
              className={inputClass + ' pl-9'}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Filter size={12} className="text-slate-400" />
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} className={filterSelect}>
              <option value="all">All Status</option>
              {VISITOR_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <Tag size={12} className="text-slate-400" />
            <select value={filterType} onChange={e => setFilterType(e.target.value as any)} className={filterSelect}>
              <option value="all">All Types</option>
              {VISITOR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
      </SectionCard>

      {/* Visitor register */}
      <SectionCard title="Visitor Register" subtitle="Visitor · Type · Host · Badge · Status" icon={Users} tone="accent" pad="none">
        {loading ? <LoadingRow /> : (
          <DataTable
            headers={['Visitor', 'Type', 'Host', 'Purpose', 'Badge', 'Status', 'Check-in', '']}
            rows={filtered.map(v => [
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[var(--color-accent-operations)]/10 flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-black text-[var(--color-accent-operations)]">
                    {v.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0">
                  <button onClick={() => setDetail(v)} className="font-medium text-slate-900 dark:text-white hover:text-[var(--color-accent-operations)]">{v.name}</button>
                  <div className="text-[10px] text-slate-400 flex items-center gap-1">
                    {v.company && <><Building2 size={9} />{v.company} · </>}<span className="font-mono">{v.id}</span>
                  </div>
                </div>
              </div>,
              <Badge tone={TYPE_TONE[v.visitor_type]}>{v.visitor_type}</Badge>,
              v.host || <span className="text-slate-400">—</span>,
              <span className="max-w-[180px] truncate inline-block align-middle">{v.purpose || '—'}</span>,
              <span className="font-mono text-xs">{v.badge_number || '—'}</span>,
              <Badge tone={STATUS_TONE[v.status]}>{v.status}</Badge>,
              <span className="text-xs text-slate-500 flex items-center gap-1"><Clock size={11} />{fmtDateTime(v.check_in_at)}</span>,
              <div className="inline-flex items-center gap-2">
                {v.status === 'Pre-registered' && (
                  <button
                    onClick={() => setStatus(v, 'Checked In')}
                    disabled={actingOn === v.id}
                    className={`${actionBtn} bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300`}
                  >
                    {actingOn === v.id ? '…' : 'Check In'}
                  </button>
                )}
                {v.status === 'Checked In' && (
                  <button
                    onClick={() => setStatus(v, 'Checked Out')}
                    disabled={actingOn === v.id}
                    className={`${actionBtn} bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300`}
                  >
                    {actingOn === v.id ? '…' : 'Check Out'}
                  </button>
                )}
                <button onClick={() => setDetail(v)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="View"><Eye className="w-4 h-4" /></button>
                <button onClick={() => openEdit(v)} disabled={actingOn === v.id} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => setDeleteTarget(v)} disabled={actingOn === v.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete">
                  {actingOn === v.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>,
            ])}
            empty={filtered.length === 0}
            emptyColSpan={8}
          />
        )}
      </SectionCard>

      {/* Register / Edit visitor modal */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        onConfirm={saveVisitor}
        title={editing ? `Edit ${editing.name}` : 'Register New Visitor'}
        subtitle={editing ? `Visitor ${editing.id} · Badge ${editing.badge_number || '—'}` : 'A badge number is assigned automatically'}
        variant="form"
        loading={submitting}
        confirmLabel={editing ? 'Save Changes' : 'Register Visitor'}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Full Name">
              <input className={inputClass} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Visitor name" />
            </Field>
            <Field label="Company">
              <input className={inputClass} value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} placeholder="Company name" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Visitor Type">
              <select className={inputClass} value={form.visitorType} onChange={e => setForm(f => ({ ...f, visitorType: e.target.value as SecVisitorType }))}>
                {VISITOR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Host">
              <input className={inputClass} list="sec-host-list" value={form.host} onChange={e => setForm(f => ({ ...f, host: e.target.value }))} placeholder="Host or department" />
              <datalist id="sec-host-list">
                {staff.map(s => <option key={s.id} value={s.name}>{s.role}</option>)}
              </datalist>
            </Field>
          </div>
          <Field label="Purpose of Visit">
            <textarea className={inputClass} rows={2} value={form.purpose} onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))} placeholder="Purpose of visit" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Expected Arrival">
              <input type="datetime-local" className={inputClass} value={form.expectedArrivalAt} onChange={e => setForm(f => ({ ...f, expectedArrivalAt: e.target.value }))} />
            </Field>
            <Field label="Expected Departure">
              <input type="datetime-local" className={inputClass} value={form.expectedDepartureAt} onChange={e => setForm(f => ({ ...f, expectedDepartureAt: e.target.value }))} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Phone">
              <input type="tel" className={inputClass} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="Contact number" />
            </Field>
            <Field label="Email">
              <input type="email" className={inputClass} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="Email address" />
            </Field>
          </div>
        </div>
      </ModalSystem>

      {/* Visitor detail modal */}
      <ModalSystem
        isOpen={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `Visitor ${detail.id}` : ''}
        subtitle={detail ? `${detail.name} · ${detail.visitor_type}` : ''}
        variant="info"
        showFooter={false}
      >
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge tone={TYPE_TONE[detail.visitor_type]}>{detail.visitor_type}</Badge>
              <Badge tone={STATUS_TONE[detail.status]}>{detail.status}</Badge>
              <Badge tone={detail.blacklist_status === 'Clear' ? 'success' : 'danger'}>
                {detail.blacklist_status === 'Clear' ? 'Clear' : detail.blacklist_status}
              </Badge>
            </div>

            {/* Badge card */}
            <div className="rounded-xl border-2 border-dashed border-gray-300 dark:border-slate-600 p-4 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-[var(--color-accent-operations)]/10 flex items-center justify-center">
                <IdCard className="w-6 h-6 text-[var(--color-accent-operations)]" />
              </div>
              <div>
                <p className="font-mono text-lg font-bold text-slate-900 dark:text-white">{detail.badge_number || 'NO BADGE'}</p>
                <p className="text-xs text-slate-500">{detail.name} · {detail.company || 'Visitor'}</p>
              </div>
            </div>

            {detail.purpose && <p className="text-sm text-slate-700 dark:text-slate-300">{detail.purpose}</p>}

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Host</p>
                <p className="font-medium text-slate-900 dark:text-white">{detail.host || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Expected Departure</p>
                <p className="font-medium text-slate-900 dark:text-white">{fmtDateTime(detail.expected_departure_at)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Check-in</p>
                <p className="font-medium text-slate-900 dark:text-white">{fmtDateTime(detail.check_in_at)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Check-out</p>
                <p className="font-medium text-slate-900 dark:text-white">{fmtDateTime(detail.check_out_at)}</p>
              </div>
              {(detail.phone || detail.email) && (
                <div className="col-span-2">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Contact</p>
                  <p className="font-medium text-slate-900 dark:text-white flex items-center gap-3">
                    {detail.phone && <span className="flex items-center gap-1"><Phone size={11} />{detail.phone}</span>}
                    {detail.email && <span className="flex items-center gap-1"><Mail size={11} />{detail.email}</span>}
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              {detail.status === 'Pre-registered' && (
                <button onClick={() => setStatus(detail, 'Checked In')} disabled={actingOn === detail.id} className={button.primary + ' disabled:opacity-50'}>
                  <LogIn className="w-4 h-4" /> Check In
                </button>
              )}
              {detail.status === 'Checked In' && (
                <button onClick={() => setStatus(detail, 'Checked Out')} disabled={actingOn === detail.id} className={button.primary + ' disabled:opacity-50'}>
                  <LogOut className="w-4 h-4" /> Check Out
                </button>
              )}
              {detail.status !== 'Blacklisted' && (
                <button onClick={() => setStatus(detail, 'Blacklisted', 'Blacklisted - Manual flag')} disabled={actingOn === detail.id} className={button.secondary + ' text-[var(--color-danger)]'}>
                  <Ban className="w-4 h-4" /> Blacklist
                </button>
              )}
              {detail.status === 'Blacklisted' && (
                <button onClick={() => setStatus(detail, 'Expired', 'Clear')} disabled={actingOn === detail.id} className={button.secondary}>
                  <CheckCircle2 className="w-4 h-4" /> Clear Blacklist
                </button>
              )}
              <button onClick={() => { setDetail(null); openEdit(detail); }} className={button.secondary}>
                <Pencil className="w-4 h-4" /> Edit
              </button>
              <button onClick={() => setDeleteTarget(detail)} className={button.secondary + ' text-[var(--color-danger)]'}>
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* Delete confirm */}
      <ModalSystem
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={removeVisitor}
        title="Delete Visitor"
        subtitle={deleteTarget ? `Permanently delete visitor ${deleteTarget.id} (${deleteTarget.name})?` : ''}
        variant="confirm"
        loading={actingOn === deleteTarget?.id}
        confirmLabel="Delete"
        confirmColor="rose"
      />
    </div>
  );
};

export default VisitorManagement;
