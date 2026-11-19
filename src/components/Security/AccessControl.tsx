/**
 * Access Control — /erp/security/access-control.
 *
 * DB-integrated via /api/sec-portal/access-grants routes (migration 604).
 * This is the access *permissions* register (who can open which doors) —
 * distinct from sec_access_events, which remains the SOC event log and feeds
 * the "Flagged Events" KPI here.
 *
 * UI follows the HK StaffManagementModule / F&B StaffOperations pattern:
 * PageHeader, StatCard KPIs, SectionCard + DataTable, Badge status pills,
 * ModalSystem forms, ERP notifications on mutations.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Lock, Plus, Search, CheckCircle2, Eye, Pencil, Trash2, Tag, Shield,
  DoorOpen, Key, AlertTriangle, Ban, RefreshCw, Loader2,
  ServerCrash, Filter, Clock,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import {
  fetchSecAccessGrants, createSecAccessGrant, updateSecAccessGrant,
  deleteSecAccessGrant, fetchSecAccessEvents, fetchSecStaff,
  type SecAccessGrant, type SecAccessGrantStatus, type SecAccessType,
  type SecAccessSchedule, type SecStaff,
} from '../../services/securityService';

// ── Static registries ────────────────────────────────────────────────────

const ACCESS_TYPES: SecAccessType[] = [
  'Employee Access', 'Guest Access', 'Contractor Access', 'Temporary Access', 'Emergency Access',
];

const GRANT_STATUSES: SecAccessGrantStatus[] = [
  'Active', 'Inactive', 'Suspended', 'Expired', 'Revoked',
];

const ZONES = [
  'All Public Areas', 'Guest Floors', 'Security Office', 'Maintenance Area',
  'Server Room', 'Loading Dock', 'Pool Area', 'Garden',
];

const SCHEDULES: { value: SecAccessSchedule; label: string }[] = [
  { value: '24-7', label: '24/7 Access' },
  { value: 'business', label: 'Business Hours Only' },
  { value: 'dayshift', label: 'Day Shift (6AM-6PM)' },
  { value: 'nightshift', label: 'Night Shift (6PM-6AM)' },
  { value: 'custom', label: 'Custom Schedule' },
];

const TYPE_TONE: Record<SecAccessType, StatusTone> = {
  'Employee Access': 'info',
  'Guest Access': 'success',
  'Contractor Access': 'warning',
  'Temporary Access': 'accent',
  'Emergency Access': 'danger',
};

const STATUS_TONE: Record<SecAccessGrantStatus, StatusTone> = {
  Active: 'success',
  Inactive: 'neutral',
  Suspended: 'warning',
  Expired: 'warning',
  Revoked: 'danger',
};

// ── UI helpers ───────────────────────────────────────────────────────────

const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

const filterSelect =
  'bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-1.5 text-[10px] font-black uppercase text-slate-600 dark:text-slate-300 outline-none cursor-pointer';

const inlineStatusSelect =
  'bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-lg px-2 py-1 text-[9px] font-bold text-slate-600 dark:text-slate-300 outline-none cursor-pointer disabled:opacity-50';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function scheduleLabel(value: SecAccessSchedule): string {
  return SCHEDULES.find(s => s.value === value)?.label || value;
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
            <tr><td colSpan={emptyColSpan} className="px-6 py-8 text-center text-slate-400">No access grants found.</td></tr>
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

// ── Component ────────────────────────────────────────────────────────────

const AccessControl: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [grants, setGrants] = useState<SecAccessGrant[]>([]);
  const [staff, setStaff] = useState<SecStaff[]>([]);
  const [flaggedEvents, setFlaggedEvents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | SecAccessGrantStatus>('all');
  const [filterType, setFilterType] = useState<'all' | SecAccessType>('all');

  // Modals
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SecAccessGrant | null>(null);
  const [detail, setDetail] = useState<SecAccessGrant | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SecAccessGrant | null>(null);

  const emptyForm = {
    userRef: '', userName: '', accessType: 'Employee Access' as SecAccessType,
    role: '', zones: [] as string[], schedule: '24-7' as SecAccessSchedule,
    validFrom: '', validUntil: '',
  };
  const [form, setForm] = useState({ ...emptyForm });

  // ── Data loading ───────────────────────────────────────────────────────

  const loadGrants = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setGrants(await fetchSecAccessGrants(currentPropertyId));
    } catch (e: any) {
      setError(e?.message || 'Failed to load access grants');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  const loadAux = useCallback(async () => {
    try {
      const [stf, events] = await Promise.all([
        fetchSecStaff(currentPropertyId),
        fetchSecAccessEvents(currentPropertyId),
      ]);
      setStaff(stf);
      setFlaggedEvents(events.filter(e => e.status === 'Flagged').length);
    } catch { /* non-fatal — datalist/KPI fall back */ }
  }, [currentPropertyId]);

  useEffect(() => { loadGrants(); loadAux(); }, [loadGrants, loadAux]);

  const refreshAll = async () => {
    await Promise.all([loadGrants(), loadAux()]);
    addNotification('Access grants refreshed', 'task', 'Security');
  };

  // ── Derived data ───────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    active: grants.filter(g => g.status === 'Active').length,
    doors: grants.filter(g => g.status === 'Active').reduce((sum, g) => sum + g.door_count, 0),
    suspended: grants.filter(g => g.status === 'Suspended' || g.status === 'Revoked').length,
  }), [grants]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return grants.filter(g => {
      const matchesStatus = filterStatus === 'all' || g.status === filterStatus;
      const matchesType = filterType === 'all' || g.access_type === filterType;
      const matchesSearch = !q ||
        g.id.toLowerCase().includes(q) ||
        g.user_name.toLowerCase().includes(q) ||
        (g.user_ref?.toLowerCase().includes(q) ?? false) ||
        (g.role?.toLowerCase().includes(q) ?? false) ||
        g.zones.some(z => z.toLowerCase().includes(q));
      return matchesStatus && matchesType && matchesSearch;
    });
  }, [grants, filterStatus, filterType, search]);

  // ── Mutations ──────────────────────────────────────────────────────────

  const openNew = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  };

  const openEdit = (g: SecAccessGrant) => {
    setEditing(g);
    setForm({
      userRef: g.user_ref || '',
      userName: g.user_name,
      accessType: g.access_type,
      role: g.role || '',
      zones: [...g.zones],
      schedule: g.schedule,
      validFrom: g.valid_from ? g.valid_from.slice(0, 10) : '',
      validUntil: g.valid_until ? g.valid_until.slice(0, 10) : '',
    });
    setShowForm(true);
  };

  const toggleZone = (zone: string) => {
    setForm(f => ({
      ...f,
      zones: f.zones.includes(zone) ? f.zones.filter(z => z !== zone) : [...f.zones, zone],
    }));
  };

  const saveGrant = async () => {
    if (!form.userName.trim()) {
      addNotification('User name is required', 'warning', 'Security');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        userRef: form.userRef || null,
        userName: form.userName.trim(),
        accessType: form.accessType,
        role: form.role || null,
        zones: form.zones,
        schedule: form.schedule,
        validFrom: form.validFrom || null,
        validUntil: form.validUntil || null,
      };
      if (editing) {
        const res = await updateSecAccessGrant(editing.id, payload);
        setGrants(prev => prev.map(g => (g.id === editing.id ? res.grant : g)));
        if (detail?.id === editing.id) setDetail(res.grant);
        addNotification(`Access grant ${editing.id} updated`, 'task', 'Security');
      } else {
        const created = await createSecAccessGrant({ propertyId: currentPropertyId, ...payload });
        setGrants(prev => [created, ...prev]);
        addNotification(`Access granted to ${created.user_name} (${created.id})`, 'task', 'Security');
      }
      setShowForm(false);
      setEditing(null);
      setForm({ ...emptyForm });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save access grant', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const setStatus = async (g: SecAccessGrant, status: SecAccessGrantStatus) => {
    setActingOn(g.id);
    try {
      const res = await updateSecAccessGrant(g.id, { status });
      setGrants(prev => prev.map(x => (x.id === g.id ? res.grant : x)));
      if (detail?.id === g.id) setDetail(res.grant);
      addNotification(`${g.user_name} access → ${status}`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Status update failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const removeGrant = async () => {
    if (!deleteTarget) return;
    setActingOn(deleteTarget.id);
    try {
      await deleteSecAccessGrant(deleteTarget.id);
      setGrants(prev => prev.filter(g => g.id !== deleteTarget.id));
      if (detail?.id === deleteTarget.id) setDetail(null);
      addNotification(`Access grant ${deleteTarget.id} deleted`, 'task', 'Security');
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
        title="Access Control"
        subtitle="Manage access permissions, zones, and door credentials"
        icon={Lock}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={openNew} className={button.primary}>
              <Plus className="w-4 h-4" /> Grant Access
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Active Grants" value={stats.active} icon={CheckCircle2} tone="success" />
        <StatCard title="Doors Covered" value={stats.doors} icon={DoorOpen} tone="info" />
        <StatCard title="Flagged Events" value={flaggedEvents} icon={AlertTriangle} tone="warning" />
        <StatCard title="Suspended / Revoked" value={stats.suspended} icon={Ban} tone="danger" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={loadGrants} className={button.ghost + ' ml-auto'}>Retry</button>
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
              placeholder="Search user, role, zone, ID…"
              className={inputClass + ' pl-9'}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Filter size={12} className="text-slate-400" />
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} className={filterSelect}>
              <option value="all">All Status</option>
              {GRANT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <Tag size={12} className="text-slate-400" />
            <select value={filterType} onChange={e => setFilterType(e.target.value as any)} className={filterSelect}>
              <option value="all">All Types</option>
              {ACCESS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
      </SectionCard>

      {/* Access register */}
      <SectionCard title="Access Grants" subtitle="User · Type · Zones · Validity · Status" icon={Key} tone="accent" pad="none">
        {loading ? <LoadingRow /> : (
          <DataTable
            headers={['User', 'Type', 'Role', 'Zones', 'Doors', 'Valid Until', 'Status', '']}
            rows={filtered.map(g => [
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[var(--color-accent-operations)]/10 flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-black text-[var(--color-accent-operations)]">
                    {g.user_name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0">
                  <button onClick={() => setDetail(g)} className="font-medium text-slate-900 dark:text-white hover:text-[var(--color-accent-operations)]">{g.user_name}</button>
                  <div className="text-[10px] text-slate-400 font-mono">{g.id}{g.user_ref ? ` · ${g.user_ref}` : ''}</div>
                </div>
              </div>,
              <Badge tone={TYPE_TONE[g.access_type]}>{g.access_type}</Badge>,
              g.role || <span className="text-slate-400">—</span>,
              <span title={g.zones.join(', ')}>{g.zones.length} zone{g.zones.length === 1 ? '' : 's'}</span>,
              <span className="flex items-center gap-1"><DoorOpen size={11} className="text-slate-400" />{g.door_count}</span>,
              <span className="text-xs text-slate-500">{fmtDate(g.valid_until)}</span>,
              <select
                value={g.status}
                onChange={e => setStatus(g, e.target.value as SecAccessGrantStatus)}
                disabled={actingOn === g.id}
                className={inlineStatusSelect}
              >
                {GRANT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>,
              <div className="inline-flex gap-2">
                <button onClick={() => setDetail(g)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="View"><Eye className="w-4 h-4" /></button>
                <button onClick={() => openEdit(g)} disabled={actingOn === g.id} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => setDeleteTarget(g)} disabled={actingOn === g.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete">
                  {actingOn === g.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>,
            ])}
            empty={filtered.length === 0}
            emptyColSpan={8}
          />
        )}
      </SectionCard>

      {/* Grant / Edit access modal */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        onConfirm={saveGrant}
        title={editing ? `Modify ${editing.id}` : 'Grant New Access'}
        subtitle={editing ? `Access for ${editing.user_name}` : 'Assign zones and validity to a user'}
        variant="form"
        loading={submitting}
        confirmLabel={editing ? 'Save Changes' : 'Grant Access'}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="User">
              <input className={inputClass} list="sec-user-list" value={form.userName} onChange={e => {
                const name = e.target.value;
                const match = staff.find(s => s.name === name);
                setForm(f => ({ ...f, userName: name, userRef: match?.employee_id || f.userRef, role: match?.role || f.role }));
              }} placeholder="Name or company" />
              <datalist id="sec-user-list">
                {staff.map(s => <option key={s.id} value={s.name}>{s.role}</option>)}
              </datalist>
            </Field>
            <Field label="User Ref">
              <input className={inputClass} value={form.userRef} onChange={e => setForm(f => ({ ...f, userRef: e.target.value }))} placeholder="e.g. EMP-001" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Access Type">
              <select className={inputClass} value={form.accessType} onChange={e => setForm(f => ({ ...f, accessType: e.target.value as SecAccessType }))}>
                {ACCESS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Role">
              <input className={inputClass} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} placeholder="e.g. Security Officer" />
            </Field>
          </div>
          <Field label={`Access Zones (${form.zones.length} selected)`}>
            <div className="grid grid-cols-2 gap-2">
              {ZONES.map(zone => (
                <label key={zone} className="flex items-center gap-2 p-2 border border-gray-200 dark:border-slate-700 rounded-lg cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800">
                  <input type="checkbox" checked={form.zones.includes(zone)} onChange={() => toggleZone(zone)} className="rounded accent-[var(--color-accent-operations)]" />
                  <span className="text-sm text-slate-700 dark:text-slate-300">{zone}</span>
                </label>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Valid From">
              <input type="date" className={inputClass} value={form.validFrom} onChange={e => setForm(f => ({ ...f, validFrom: e.target.value }))} />
            </Field>
            <Field label="Valid Until">
              <input type="date" className={inputClass} value={form.validUntil} onChange={e => setForm(f => ({ ...f, validUntil: e.target.value }))} />
            </Field>
            <Field label="Schedule">
              <select className={inputClass} value={form.schedule} onChange={e => setForm(f => ({ ...f, schedule: e.target.value as SecAccessSchedule }))}>
                {SCHEDULES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>
          </div>
        </div>
      </ModalSystem>

      {/* Grant detail modal */}
      <ModalSystem
        isOpen={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `Access Grant ${detail.id}` : ''}
        subtitle={detail ? `${detail.user_name} · ${detail.access_type}` : ''}
        variant="info"
        showFooter={false}
      >
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge tone={TYPE_TONE[detail.access_type]}>{detail.access_type}</Badge>
              <Badge tone={STATUS_TONE[detail.status]}>{detail.status}</Badge>
              <Badge tone="neutral">{scheduleLabel(detail.schedule)}</Badge>
            </div>

            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Access Zones</p>
              <div className="flex flex-wrap gap-2">
                {detail.zones.map((zone, i) => (
                  <Badge key={i} tone="neutral">{zone}</Badge>
                ))}
                {detail.zones.length === 0 && <span className="text-sm text-slate-400">No zones assigned</span>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Role</p>
                <p className="font-medium text-slate-900 dark:text-white">{detail.role || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">User Ref</p>
                <p className="font-medium text-slate-900 dark:text-white font-mono">{detail.user_ref || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Valid From</p>
                <p className="font-medium text-slate-900 dark:text-white">{fmtDate(detail.valid_from)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Valid Until</p>
                <p className="font-medium text-slate-900 dark:text-white">{fmtDate(detail.valid_until)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Doors Accessible</p>
                <p className="font-medium text-slate-900 dark:text-white">{detail.door_count}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Total Access Count</p>
                <p className="font-medium text-slate-900 dark:text-white">{detail.access_count}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Last Access</p>
                <p className="font-medium text-slate-900 dark:text-white flex items-center gap-1"><Clock size={11} />{fmtDateTime(detail.last_access_at)}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              {detail.status === 'Active' && (
                <>
                  <button onClick={() => setStatus(detail, 'Suspended')} disabled={actingOn === detail.id} className={button.secondary + ' text-amber-600'}>
                    <Ban className="w-4 h-4" /> Suspend
                  </button>
                  <button onClick={() => setStatus(detail, 'Revoked')} disabled={actingOn === detail.id} className={button.secondary + ' text-[var(--color-danger)]'}>
                    <Shield className="w-4 h-4" /> Revoke
                  </button>
                </>
              )}
              {(detail.status === 'Suspended' || detail.status === 'Revoked' || detail.status === 'Inactive' || detail.status === 'Expired') && (
                <button onClick={() => setStatus(detail, 'Active')} disabled={actingOn === detail.id} className={button.primary + ' disabled:opacity-50'}>
                  <CheckCircle2 className="w-4 h-4" /> Reactivate
                </button>
              )}
              <button onClick={() => { setDetail(null); openEdit(detail); }} className={button.secondary}>
                <Pencil className="w-4 h-4" /> Modify
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
        onConfirm={removeGrant}
        title="Delete Access Grant"
        subtitle={deleteTarget ? `Permanently delete access grant ${deleteTarget.id} for ${deleteTarget.user_name}?` : ''}
        variant="confirm"
        loading={actingOn === deleteTarget?.id}
        confirmLabel="Delete"
        confirmColor="rose"
      />
    </div>
  );
};

export default AccessControl;
