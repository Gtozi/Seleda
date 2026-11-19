/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HR Shift & Rostering — manager-facing scheduling module.
 *
 * DB-integrated via /api/hr-portal/shifts/* routes. Reuses hr_team_roster
 * for the weekly roster grid and adds hr_shift_types, hr_shift_templates
 * and hr_shift_swaps tables from migration 419.
 *
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Calendar,
  Clock,
  Users,
  Plus,
  Pencil,
  Trash2,
  Search,
  ChevronLeft,
  ChevronRight,
  ArrowLeftRight,
  RefreshCw,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  Check,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';

type Tab = 'roster' | 'shifts' | 'templates' | 'requests';

interface ShiftType {
  id: string;
  name: string;
  start_time: string | null;
  end_time: string | null;
  color: string;
  is_active: boolean;
}

interface ShiftTemplate {
  id: string;
  name: string;
  description: string | null;
  departments: string[];
  is_active: boolean;
}

interface SwapRequest {
  id: string;
  employee_id: string;
  employee_name: string;
  current_shift: string;
  requested_shift: string;
  reason: string | null;
  status: 'Pending' | 'Approved' | 'Rejected';
}

interface RosterEntry {
  id: string;
  employee_id: string;
  employee_name: string;
  department: string;
  roster_date: string;
  shift: string;
  role: string;
  is_published: boolean;
  shift_type_id: string | null;
}

interface Stats {
  scheduledThisWeek: number;
  shiftChanges: number;
  openShifts: number;
  coverageRate: number;
}

interface EmployeeOption {
  id: string;
  name: string;
  department: string;
  position: string;
  employee_number: string;
}

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'roster', label: 'Weekly Roster', icon: Calendar },
  { id: 'shifts', label: 'Shift Types', icon: Clock },
  { id: 'templates', label: 'Templates', icon: RefreshCw },
  { id: 'requests', label: 'Swap Requests', icon: ArrowLeftRight },
];

const DEPARTMENT_OPTIONS = ['All', 'Front Office', 'Housekeeping', 'Food & Beverage', 'Engineering', 'Security'];
const SHIFT_OPTIONS = ['Off', 'Morning', 'Evening', 'Night', 'Split Shift', 'Flexible', 'On Call'];

const SWAP_TONE: Record<string, statusTone.StatusTone> = { Pending: 'warning', Approved: 'success', Rejected: 'danger' };

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const inputCls = 'w-full px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 font-sans';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function LoadingRow() {
  return <div className="flex items-center justify-center py-10 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>;
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekDates(start: string) {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

function dayName(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long' });
}

function initials(name: string) {
  return name?.split(' ').filter(Boolean).map((n) => n[0]).join('').slice(0, 2).toUpperCase() || '—';
}

const ShiftRostering = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [activeTab, setActiveTab] = useState<Tab>('roster');
  const [weekStart, setWeekStart] = useState('2024-06-24');
  const [department, setDepartment] = useState('All');

  const [stats, setStats] = useState<Stats>({ scheduledThisWeek: 0, shiftChanges: 0, openShifts: 0, coverageRate: 0 });
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [swaps, setSwaps] = useState<SwapRequest[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const [typeModal, setTypeModal] = useState<{ mode: 'create' | 'edit'; t: ShiftType | null } | null>(null);
  const [templateModal, setTemplateModal] = useState<{ mode: 'create' | 'edit'; t: ShiftTemplate | null } | null>(null);
  const [swapModal, setSwapModal] = useState<{ mode: 'create' | 'edit'; s: SwapRequest | null } | null>(null);
  const [rosterModal, setRosterModal] = useState<{ mode: 'create' | 'edit'; r: RosterEntry | null } | null>(null);

  const [typeForm, setTypeForm] = useState({ name: '', startTime: '', endTime: '', color: 'bg-blue-500', isActive: true });
  const [templateForm, setTemplateForm] = useState({ name: '', description: '', departments: [] as string[], isActive: true });
  const [swapForm, setSwapForm] = useState({ employeeId: '', employeeName: '', currentShift: '', requestedShift: '', reason: '' });
  const [rosterForm, setRosterForm] = useState({
    employeeId: '', employeeName: '', department: 'Front Office', rosterDate: '2024-06-24',
    shift: 'Morning', role: '', shiftTypeId: '', isPublished: true,
  });

  const fetchStats = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/shifts/statistics/${currentPropertyId}/${weekStart}`, { headers: authHeaders() });
      if (res.ok) setStats(await res.json());
    } catch { /* non-fatal */ }
  }, [currentPropertyId, weekStart]);

  const fetchShiftTypes = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/shifts/types/${currentPropertyId}?active=true`, { headers: authHeaders() });
      if (res.ok) setShiftTypes(((await res.json()) as { types: ShiftType[] }).types || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchTemplates = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/shifts/templates/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setTemplates(((await res.json()) as { templates: ShiftTemplate[] }).templates || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchSwaps = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const qs = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
      const res = await fetch(`/api/hr-portal/shifts/swaps/${currentPropertyId}${qs}`, { headers: authHeaders() });
      if (res.ok) setSwaps(((await res.json()) as { swaps: SwapRequest[] }).swaps || []);
    } catch { /* non-fatal */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId, search]);

  const fetchRoster = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const qs = department !== 'All' ? `?department=${encodeURIComponent(department)}` : '';
      const res = await fetch(`/api/hr-portal/shifts/roster/${currentPropertyId}/${weekStart}${qs}`, { headers: authHeaders() });
      if (res.ok) setRoster(((await res.json()) as { roster: RosterEntry[] }).roster || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId, weekStart, department]);

  const fetchEmployees = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/shifts/employees/${currentPropertyId}${department !== 'All' ? `?department=${encodeURIComponent(department)}` : ''}`, { headers: authHeaders() });
      if (res.ok) setEmployees(((await res.json()) as { employees: EmployeeOption[] }).employees || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId, department]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchStats(), fetchShiftTypes(), fetchTemplates(), fetchSwaps(), fetchRoster(), fetchEmployees()]);
    setLoading(false);
  }, [fetchStats, fetchShiftTypes, fetchTemplates, fetchSwaps, fetchRoster, fetchEmployees]);

  useEffect(() => {
    if (currentPropertyId) refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId]);

  useEffect(() => {
    if (currentPropertyId) { fetchStats(); fetchRoster(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, department]);

  useEffect(() => {
    const t = setTimeout(() => { if (activeTab === 'requests') fetchSwaps(); }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, activeTab]);

  // ── Roster helpers ─────────────────────────────────────────────────────
  const dates = useMemo(() => weekDates(weekStart), [weekStart]);
  const employeesInRoster = useMemo(() => {
    const names = Array.from(new Set(roster.map((r) => r.employee_name)));
    return names;
  }, [roster]);

  const getShiftFor = (employee: string, date: string) => roster.find((r) => r.employee_name === employee && r.roster_date === date);
  const getShiftType = (name: string) => shiftTypes.find((s) => s.name === name);

  // ── Actions ────────────────────────────────────────────────────────────
  const publishRoster = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/shifts/roster/publish/${currentPropertyId}/${weekStart}`, { method: 'PUT', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      const data = await res.json();
      addNotification(`Published ${data.published} roster entries`, 'success', 'HR');
      fetchRoster(); fetchStats();
    } catch (e: any) { addNotification(e?.message || 'Failed to publish', 'danger', 'HR'); } finally { setSaving(false); }
  };

  // Shift Types
  const openTypeCreate = () => { setTypeForm({ name: '', startTime: '', endTime: '', color: 'bg-blue-500', isActive: true }); setTypeModal({ mode: 'create', t: null }); };
  const openTypeEdit = (t: ShiftType) => { setTypeForm({ name: t.name, startTime: t.start_time || '', endTime: t.end_time || '', color: t.color, isActive: t.is_active }); setTypeModal({ mode: 'edit', t }); };
  const saveType = async () => {
    if (!currentPropertyId || !typeForm.name.trim()) return;
    setSaving(true);
    try {
      const body = { propertyId: currentPropertyId, name: typeForm.name, startTime: typeForm.startTime || null, endTime: typeForm.endTime || null, color: typeForm.color, isActive: typeForm.isActive };
      const res = await fetch(typeModal?.mode === 'create' ? '/api/hr-portal/shifts/types' : `/api/hr-portal/shifts/types/${typeModal?.t?.id}`, {
        method: typeModal?.mode === 'create' ? 'POST' : 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Shift type saved', 'success', 'HR');
      setTypeModal(null); refreshAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };
  const deleteType = async (id: string) => {
    if (!confirm('Delete this shift type?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/shifts/types/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Shift type deleted', 'success', 'HR');
      refreshAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  // Templates
  const openTemplateCreate = () => { setTemplateForm({ name: '', description: '', departments: [], isActive: true }); setTemplateModal({ mode: 'create', t: null }); };
  const openTemplateEdit = (t: ShiftTemplate) => { setTemplateForm({ name: t.name, description: t.description || '', departments: t.departments || [], isActive: t.is_active }); setTemplateModal({ mode: 'edit', t }); };
  const saveTemplate = async () => {
    if (!currentPropertyId || !templateForm.name.trim()) return;
    setSaving(true);
    try {
      const body = { propertyId: currentPropertyId, name: templateForm.name, description: templateForm.description, departments: templateForm.departments, isActive: templateForm.isActive };
      const res = await fetch(templateModal?.mode === 'create' ? '/api/hr-portal/shifts/templates' : `/api/hr-portal/shifts/templates/${templateModal?.t?.id}`, {
        method: templateModal?.mode === 'create' ? 'POST' : 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Template saved', 'success', 'HR');
      setTemplateModal(null); fetchTemplates();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };
  const deleteTemplate = async (id: string) => {
    if (!confirm('Delete this template?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/shifts/templates/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Template deleted', 'success', 'HR');
      fetchTemplates();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  // Swaps
  const openSwapCreate = () => { setSwapForm({ employeeId: '', employeeName: '', currentShift: '', requestedShift: '', reason: '' }); setSwapModal({ mode: 'create', s: null }); };
  const openSwapEdit = (s: SwapRequest) => { setSwapForm({ employeeId: s.employee_id, employeeName: s.employee_name, currentShift: s.current_shift, requestedShift: s.requested_shift, reason: s.reason || '' }); setSwapModal({ mode: 'edit', s }); };
  const saveSwap = async () => {
    if (!currentPropertyId || !swapForm.employeeId || !swapForm.currentShift.trim() || !swapForm.requestedShift.trim()) return;
    setSaving(true);
    try {
      const body = { propertyId: currentPropertyId, employeeId: swapForm.employeeId, employeeName: swapForm.employeeName, currentShift: swapForm.currentShift, requestedShift: swapForm.requestedShift, reason: swapForm.reason };
      const res = await fetch('/api/hr-portal/shifts/swaps', { method: 'POST', headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Swap request created', 'success', 'HR');
      setSwapModal(null); fetchSwaps(); fetchStats();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };
  const approveSwap = async (s: SwapRequest, status: 'Approved' | 'Rejected') => {
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/shifts/swaps/${s.id}/approve`, { method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ status }) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(`Swap ${status.toLowerCase()}`, status === 'Approved' ? 'success' : 'danger', 'HR');
      fetchSwaps(); fetchStats();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };
  const deleteSwap = async (id: string) => {
    if (!confirm('Delete this swap request?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/shifts/swaps/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Swap request deleted', 'success', 'HR');
      fetchSwaps(); fetchStats();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  // Roster
  const openRosterCreate = (date?: string, employee?: EmployeeOption) => {
    setRosterForm({
      employeeId: employee?.id || '',
      employeeName: employee?.name || '',
      department: employee?.department || 'Front Office',
      rosterDate: date || weekStart,
      shift: 'Morning',
      role: employee?.position || '',
      shiftTypeId: '',
      isPublished: true,
    });
    setRosterModal({ mode: 'create', r: null });
  };
  const openRosterEdit = (r: RosterEntry) => {
    setRosterForm({
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      department: r.department,
      rosterDate: r.roster_date,
      shift: r.shift,
      role: r.role,
      shiftTypeId: r.shift_type_id || '',
      isPublished: r.is_published,
    });
    setRosterModal({ mode: 'edit', r });
  };
  const saveRoster = async () => {
    if (!currentPropertyId || !rosterForm.employeeId || !rosterForm.rosterDate || !rosterForm.department) return;
    setSaving(true);
    try {
      const body = { propertyId: currentPropertyId, employeeId: rosterForm.employeeId, employeeName: rosterForm.employeeName, department: rosterForm.department, rosterDate: rosterForm.rosterDate, shift: rosterForm.shift, role: rosterForm.role, shiftTypeId: rosterForm.shiftTypeId || null, isPublished: rosterForm.isPublished };
      const res = await fetch(rosterModal?.mode === 'create' ? '/api/hr-portal/shifts/roster' : `/api/hr-portal/shifts/roster/${rosterModal?.r?.id}`, {
        method: rosterModal?.mode === 'create' ? 'POST' : 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Roster entry saved', 'success', 'HR');
      setRosterModal(null); fetchRoster(); fetchStats();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };
  const deleteRoster = async (id: string) => {
    if (!confirm('Remove this roster entry?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/shifts/roster/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Roster entry removed', 'success', 'HR');
      fetchRoster(); fetchStats();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  useEffect(() => {
    const emp = employees.find((e) => e.id === rosterForm.employeeId);
    if (emp) setRosterForm((f) => ({ ...f, employeeName: emp.name, department: emp.department }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterForm.employeeId, employees]);

  useEffect(() => {
    const type = shiftTypes.find((s) => s.name === rosterForm.shift);
    setRosterForm((f) => ({ ...f, shiftTypeId: type?.id || '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterForm.shift, shiftTypes]);

  useEffect(() => {
    const emp = employees.find((e) => e.id === swapForm.employeeId);
    if (emp) setSwapForm((f) => ({ ...f, employeeName: emp.name }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapForm.employeeId, employees]);

  const autoGenerate = async () => {
    if (!currentPropertyId || employees.length === 0) return;
    setSaving(true);
    try {
      const types = shiftTypes.length ? shiftTypes : [{ name: 'Morning' }, { name: 'Evening' }, { name: 'Night' }];
      const entries = [];
      for (let i = 0; i < 7; i++) {
        const date = addDays(weekStart, i);
        employees.slice(0, 4).forEach((e, idx) => {
          const shift = types[idx % types.length]?.name || 'Morning';
          entries.push({
            propertyId: currentPropertyId,
            employeeId: e.employee_number || e.id,
            employeeName: e.name,
            department: e.department,
            rosterDate: date,
            shift,
            role: e.position || '-',
            shiftTypeId: shiftTypes.find((s) => s.name === shift)?.id || null,
            isPublished: false,
          });
        });
      }
      for (const body of entries) {
        await fetch('/api/hr-portal/shifts/roster', { method: 'POST', headers: authHeaders(true), body: JSON.stringify(body) });
      }
      addNotification(`Generated ${entries.length} roster entries`, 'success', 'HR');
      fetchRoster(); fetchStats();
    } catch (e: any) { addNotification(e?.message || 'Failed to generate', 'danger', 'HR'); } finally { setSaving(false); }
  };

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Shift & Rostering" subtitle="Manage staff schedules, shifts, and roster planning" icon={Calendar} />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Calendar className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">Select a property to view shift data.</p>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Shift & Rostering"
        subtitle="Manage staff schedules, shifts, and roster planning"
        icon={Calendar}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            {activeTab === 'roster' && (
              <>
                <button onClick={autoGenerate} className={button.secondary} disabled={saving}><Plus className="w-4 h-4" /> Auto-Generate</button>
                <button onClick={publishRoster} className={button.primary} disabled={saving}><Check className="w-4 h-4" /> Publish</button>
              </>
            )}
          </div>
        }
      />

      {/* Stats */}
      <div className={layout.kpiGrid}>
        <StatCard title="Scheduled This Week" value={stats.scheduledThisWeek} icon={Users} tone="accent" />
        <StatCard title="Shift Changes" value={stats.shiftChanges} icon={ArrowLeftRight} tone="warning" />
        <StatCard title="Open Shifts" value={stats.openShifts} icon={AlertCircle} tone="danger" />
        <StatCard title="Coverage Rate" value={`${stats.coverageRate}%`} icon={TrendingUp} tone="success" />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${
              activeTab === tab.id ? 'bg-white dark:bg-slate-700 text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <tab.icon size={14} /> {tab.label}
          </button>
        ))}
      </div>

      {/* Weekly Roster */}
      {activeTab === 'roster' && (
        <SectionCard pad="none">
          <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center gap-4 justify-between">
            <div className="flex items-center gap-2">
              <button onClick={() => setWeekStart((s) => addDays(s, -7))} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"><ChevronLeft size={20} className="text-slate-400" /></button>
              <span className="text-sm font-semibold text-slate-900 dark:text-white min-w-[140px] text-center">Week of {weekStart}</span>
              <button onClick={() => setWeekStart((s) => addDays(s, 7))} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"><ChevronRight size={20} className="text-slate-400" /></button>
            </div>
            <div className="flex items-center gap-2">
              <select value={department} onChange={(e) => setDepartment(e.target.value)} className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500">
                {DEPARTMENT_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <button onClick={() => openRosterCreate()} className={button.primary + ' text-xs'}><Plus size={14} /> Add Shift</button>
            </div>
          </div>

          {loading ? <LoadingRow /> : employeesInRoster.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Calendar className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No roster entries for this week.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                    <th className="px-4 py-4 text-xs font-medium text-slate-500 sticky left-0 bg-slate-50/50 dark:bg-slate-950/20 min-w-[160px]">Employee</th>
                    {dates.map((d) => (
                      <th key={d} className="px-4 py-4 text-xs font-medium text-slate-500 text-center min-w-[120px]">
                        <div>{dayName(d).substring(0, 3)}</div>
                        <div className="text-xs font-medium text-slate-400">{d.split('-')[2]}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {employeesInRoster.map((employee) => (
                    <tr key={employee} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-3 sticky left-0 bg-white dark:bg-slate-900">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 bg-indigo-50 dark:bg-indigo-500/20 rounded-lg flex items-center justify-center text-xs font-medium text-indigo-600 dark:text-indigo-400">
                            {initials(employee)}
                          </div>
                          <span className="text-xs font-medium text-slate-900 dark:text-white">{employee}</span>
                        </div>
                      </td>
                      {dates.map((d) => {
                        const entry = getShiftFor(employee, d);
                        const color = getShiftType(entry?.shift)?.color || 'bg-slate-200';
                        return (
                          <td key={d} className="px-4 py-3 text-center">
                            {entry ? (
                              <button onClick={() => openRosterEdit(entry)} className={`w-full p-2 rounded-lg ${color} text-white hover:opacity-90 transition ${!entry.is_published ? 'ring-1 ring-amber-300' : ''}`}>
                                <div className="text-xs font-medium uppercase">{entry.shift}</div>
                                <div className="text-xs opacity-80 truncate">{entry.role}</div>
                              </button>
                            ) : (
                              <button onClick={() => openRosterCreate(d)} className="w-full p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-400 hover:bg-slate-200 transition">
                                <div className="text-xs font-medium uppercase">Off</div>
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* Shift Types */}
      {activeTab === 'shifts' && (
        <SectionCard>
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Shift Types</h3>
            <button onClick={openTypeCreate} className={button.primary + ' text-xs'}><Plus size={14} /> Add Shift Type</button>
          </div>
          {loading ? <LoadingRow /> : shiftTypes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400"><Clock className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No shift types found.</p></div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {shiftTypes.map((shift) => (
                <div key={shift.id} className="bg-slate-50 dark:bg-slate-800 rounded-xl p-4 border border-slate-100 dark:border-slate-700">
                  <div className="flex items-center justify-between mb-3">
                    <div className={`w-8 h-8 ${shift.color} rounded-lg flex items-center justify-center`}>
                      <Clock className="text-white" size={16} />
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => openTypeEdit(shift)} className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                      <button onClick={() => deleteType(shift.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                    </div>
                  </div>
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">{shift.name}</h4>
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
                    <Clock size={12} />
                    <span>{shift.start_time || '—'} - {shift.end_time || '—'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* Templates */}
      {activeTab === 'templates' && (
        <SectionCard pad="none">
          <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Shift Templates</h3>
            <button onClick={openTemplateCreate} className={button.primary + ' text-xs'}><Plus size={14} /> Create Template</button>
          </div>
          {loading ? <LoadingRow /> : templates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400"><RefreshCw className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No templates found.</p></div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Template Name</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Description</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Departments</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Status</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {templates.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4 text-sm font-semibold text-slate-900 dark:text-white">{t.name}</td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-500">{t.description || '—'}</td>
                    <td className="px-6 py-4">
                      <div className="flex gap-1 flex-wrap">
                        {t.departments?.map((d) => <Badge key={d} tone="neutral">{d}</Badge>)}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center"><Badge tone={t.is_active ? 'success' : 'neutral'}>{t.is_active ? 'Active' : 'Inactive'}</Badge></td>
                    <td className="px-6 py-4">
                      <div className="flex justify-center gap-2">
                        <button onClick={() => openTemplateEdit(t)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                        <button onClick={() => deleteTemplate(t.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      )}

      {/* Swap Requests */}
      {activeTab === 'requests' && (
        <SectionCard pad="none">
          <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Shift Swap Requests</h3>
            <button onClick={openSwapCreate} className={button.primary + ' text-xs'}><Plus size={14} /> New Request</button>
          </div>
          {loading ? <LoadingRow /> : (
            <>
              <div className="p-4 border-b border-slate-50 dark:border-slate-800">
                <div className="relative max-w-xs">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                  <input
                    type="text"
                    placeholder="Search requests..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
                  />
                </div>
              </div>
              {swaps.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400"><ArrowLeftRight className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No swap requests found.</p></div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                      <th className="px-6 py-4 text-xs font-medium text-slate-500">Employee</th>
                      <th className="px-6 py-4 text-xs font-medium text-slate-500">Current Shift</th>
                      <th className="px-6 py-4 text-xs font-medium text-slate-500">Requested Shift</th>
                      <th className="px-6 py-4 text-xs font-medium text-slate-500">Reason</th>
                      <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Status</th>
                      <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                    {swaps.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="px-6 py-4 text-sm font-semibold text-slate-900 dark:text-white">{s.employee_name}</td>
                        <td className="px-6 py-4 text-sm font-medium text-slate-500">{s.current_shift}</td>
                        <td className="px-6 py-4 text-sm font-medium text-slate-500">{s.requested_shift}</td>
                        <td className="px-6 py-4 text-sm font-medium text-slate-500">{s.reason || '—'}</td>
                        <td className="px-6 py-4 text-center"><Badge tone={SWAP_TONE[s.status]}>{s.status}</Badge></td>
                        <td className="px-6 py-4">
                          <div className="flex justify-center gap-2">
                            {s.status === 'Pending' && (
                              <>
                                <button onClick={() => approveSwap(s, 'Approved')} disabled={saving} className="p-1.5 bg-emerald-500 text-white rounded-lg hover:shadow-md transition"><CheckCircle2 size={14} /></button>
                                <button onClick={() => approveSwap(s, 'Rejected')} disabled={saving} className="p-1.5 bg-rose-500 text-white rounded-lg hover:shadow-md transition"><XCircle size={14} /></button>
                              </>
                            )}
                            <button onClick={() => openSwapEdit(s)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                            <button onClick={() => deleteSwap(s.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </SectionCard>
      )}

      {/* Shift Type modal */}
      <ModalSystem
        isOpen={!!typeModal}
        onClose={() => setTypeModal(null)}
        onConfirm={saveType}
        title={typeModal?.mode === 'create' ? 'Add Shift Type' : 'Edit Shift Type'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name"><input className={inputCls} value={typeForm.name} onChange={(e) => setTypeForm(f => ({ ...f, name: e.target.value }))} placeholder="Morning" /></Field>
          <Field label="Color"><input className={inputCls} value={typeForm.color} onChange={(e) => setTypeForm(f => ({ ...f, color: e.target.value }))} placeholder="bg-blue-500" /></Field>
          <Field label="Start Time"><input className={inputCls} value={typeForm.startTime} onChange={(e) => setTypeForm(f => ({ ...f, startTime: e.target.value }))} placeholder="07:00" /></Field>
          <Field label="End Time"><input className={inputCls} value={typeForm.endTime} onChange={(e) => setTypeForm(f => ({ ...f, endTime: e.target.value }))} placeholder="15:00" /></Field>
          <div className="col-span-2 flex items-center gap-2 py-2">
            <input type="checkbox" checked={typeForm.isActive} onChange={(e) => setTypeForm(f => ({ ...f, isActive: e.target.checked }))} id="typeActive" />
            <label htmlFor="typeActive" className="text-sm text-slate-700 dark:text-slate-300">Active</label>
          </div>
        </div>
      </ModalSystem>

      {/* Template modal */}
      <ModalSystem
        isOpen={!!templateModal}
        onClose={() => setTemplateModal(null)}
        onConfirm={saveTemplate}
        title={templateModal?.mode === 'create' ? 'Create Template' : 'Edit Template'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><Field label="Name"><input className={inputCls} value={templateForm.name} onChange={(e) => setTemplateForm(f => ({ ...f, name: e.target.value }))} placeholder="Standard Week Pattern" /></Field></div>
          <div className="col-span-2"><Field label="Description"><textarea className={inputCls} rows={3} value={templateForm.description} onChange={(e) => setTemplateForm(f => ({ ...f, description: e.target.value }))} /></Field></div>
          <div className="col-span-2">
            <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Departments</span>
            <div className="flex flex-wrap gap-2">
              {DEPARTMENT_OPTIONS.filter(d => d !== 'All').map((d) => (
                <label key={d} className="flex items-center gap-1 text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-lg">
                  <input type="checkbox" checked={templateForm.departments.includes(d)} onChange={(e) => {
                    const arr = e.target.checked ? [...templateForm.departments, d] : templateForm.departments.filter(x => x !== d);
                    setTemplateForm(f => ({ ...f, departments: arr }));
                  }} />
                  {d}
                </label>
              ))}
            </div>
          </div>
          <div className="col-span-2 flex items-center gap-2 py-2">
            <input type="checkbox" checked={templateForm.isActive} onChange={(e) => setTemplateForm(f => ({ ...f, isActive: e.target.checked }))} id="tplActive" />
            <label htmlFor="tplActive" className="text-sm text-slate-700 dark:text-slate-300">Active</label>
          </div>
        </div>
      </ModalSystem>

      {/* Swap modal */}
      <ModalSystem
        isOpen={!!swapModal}
        onClose={() => setSwapModal(null)}
        onConfirm={saveSwap}
        title="New Shift Swap Request"
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Create'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Employee">
              <select className={inputCls} value={swapForm.employeeId} onChange={(e) => setSwapForm(f => ({ ...f, employeeId: e.target.value }))}>
                <option value="">Select employee</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.employee_number})</option>)}
              </select>
            </Field>
          </div>
          <Field label="Current Shift"><input className={inputCls} value={swapForm.currentShift} onChange={(e) => setSwapForm(f => ({ ...f, currentShift: e.target.value }))} placeholder="Morning (Jun 24)" /></Field>
          <Field label="Requested Shift"><input className={inputCls} value={swapForm.requestedShift} onChange={(e) => setSwapForm(f => ({ ...f, requestedShift: e.target.value }))} placeholder="Evening (Jun 24)" /></Field>
          <div className="col-span-2"><Field label="Reason"><textarea className={inputCls} rows={3} value={swapForm.reason} onChange={(e) => setSwapForm(f => ({ ...f, reason: e.target.value }))} /></Field></div>
        </div>
      </ModalSystem>

      {/* Roster modal */}
      <ModalSystem
        isOpen={!!rosterModal}
        onClose={() => setRosterModal(null)}
        onConfirm={saveRoster}
        title={rosterModal?.mode === 'create' ? 'Add Roster Shift' : 'Edit Roster Shift'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Employee">
              <select className={inputCls} value={rosterForm.employeeId} onChange={(e) => setRosterForm(f => ({ ...f, employeeId: e.target.value }))}>
                <option value="">Select employee</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.employee_number}) — {e.department}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Date"><input type="date" className={inputCls} value={rosterForm.rosterDate} onChange={(e) => setRosterForm(f => ({ ...f, rosterDate: e.target.value }))} /></Field>
          <Field label="Department"><input className={inputCls} value={rosterForm.department} onChange={(e) => setRosterForm(f => ({ ...f, department: e.target.value }))} /></Field>
          <Field label="Shift">
            <select className={inputCls} value={rosterForm.shift} onChange={(e) => setRosterForm(f => ({ ...f, shift: e.target.value }))}>
              {SHIFT_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Role"><input className={inputCls} value={rosterForm.role} onChange={(e) => setRosterForm(f => ({ ...f, role: e.target.value }))} placeholder="Reception" /></Field>
          <div className="col-span-2 flex items-center gap-2 py-2">
            <input type="checkbox" checked={rosterForm.isPublished} onChange={(e) => setRosterForm(f => ({ ...f, isPublished: e.target.checked }))} id="published" />
            <label htmlFor="published" className="text-sm text-slate-700 dark:text-slate-300">Published</label>
          </div>
        </div>
      </ModalSystem>
    </div>
  );
};

export default ShiftRostering;
