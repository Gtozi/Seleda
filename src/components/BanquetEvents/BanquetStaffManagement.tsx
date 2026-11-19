/**
 * BanquetStaffManagement — Staff Management for the Banquet & Events department.
 * Mirrors the Sales Staff Management pattern: assignments, attendance, shifts,
 * staffing, training, and productivity — all DB-backed and property-scoped.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useERP } from '../../context/ERPContext';
import {
  Users, IdCard, CalendarDays, GraduationCap, Gauge,
  Plus, Pencil, Trash2, Search, RefreshCw,
  Loader2, CalendarCheck, ChevronUp, ChevronDown, ChevronsUpDown,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';

const API_BASE = '/api/banquet-events';
const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem('hotel_erp_session')}`,
  'X-Property-Id': localStorage.getItem('erp_property_id') || '',
});

async function apiRequest(url: string, options?: RequestInit) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(options?.headers || {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// ── Types ────────────────────────────────────────────────────────────
interface BanquetStaff {
  id: string;
  employee_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  shift: string;
  function_area: string;
  status: string;
  workload: number;
  events_handled: number;
  ytd_revenue: number;
  property_id: string | null;
  created_at: string;
  updated_at: string;
}

interface BanquetStaffAttendance {
  id: string;
  staff_id: string;
  attendance_date: string;
  status: string;
  check_in: string | null;
  check_out: string | null;
  hours_worked: number;
  overtime_hours: number;
  notes: string | null;
  banquet_staff?: { name: string; role: string };
}

interface BanquetStaffTraining {
  id: string;
  staff_id: string;
  course: string;
  due_date: string | null;
  status: string;
  banquet_staff?: { name: string; role: string };
}

interface BanquetStaffProductivity {
  id: string;
  staff_id: string;
  period: string;
  events_worked: number;
  setup_hours: number;
  service_hours: number;
  guest_satisfaction: number;
  revenue: number;
  banquet_staff?: { name: string; role: string };
}

interface BanquetStaffShiftReq {
  id: string;
  role: string;
  shift: string;
  required_count: number;
  assigned_count: number;
}

interface BanquetStaffStaffingReq {
  id: string;
  function_area: string;
  role: string;
  required_count: number;
  assigned_count: number;
}

// ── Constants ────────────────────────────────────────────────────────
type SubTab = 'assignments' | 'attendance' | 'shifts' | 'staffing' | 'training' | 'productivity';
type Shift = 'Morning' | 'Evening' | 'Night';
type Role = 'Banquet Manager' | 'Event Coordinator' | 'Catering Manager' | 'Setup Supervisor' | 'Banquet Server' | 'Audio/Visual Technician';

const ROLES: Role[] = ['Banquet Manager', 'Event Coordinator', 'Catering Manager', 'Setup Supervisor', 'Banquet Server', 'Audio/Visual Technician'];
const SHIFTS: Shift[] = ['Morning', 'Evening', 'Night'];
const FUNCTION_AREAS = ['Ballroom', 'Conference Rooms', 'Outdoor Venues', 'Kitchen', 'Setup', 'Audio/Visual'];
const STATUSES = ['Active Duty', 'Off Duty', 'On Leave', 'Training', 'Suspended'];
const ATTENDANCE_STATUSES = ['Present', 'Late', 'Absent', 'On Leave', 'Sick', 'Day Off'];
const TRAIN_STATUSES = ['Not Started', 'In Progress', 'Completed', 'Overdue'];

const SUB_TABS: { id: SubTab; label: string; icon: any }[] = [
  { id: 'assignments', label: 'Staff Assignment', icon: IdCard },
  { id: 'attendance', label: 'Attendance', icon: CalendarCheck },
  { id: 'shifts', label: 'Shift Requirements', icon: CalendarDays },
  { id: 'staffing', label: 'Staffing', icon: Users },
  { id: 'training', label: 'Training', icon: GraduationCap },
  { id: 'productivity', label: 'Productivity', icon: Gauge },
];

const ROLE_TONE: Record<string, StatusTone> = {
  'Banquet Manager': 'success',
  'Event Coordinator': 'accent',
  'Catering Manager': 'info',
  'Setup Supervisor': 'warning',
  'Banquet Server': 'neutral',
  'Audio/Visual Technician': 'info',
};

const STATUS_TONE: Record<string, StatusTone> = {
  'Active Duty': 'success',
  'Off Duty': 'neutral',
  'On Leave': 'warning',
  'Training': 'info',
  'Suspended': 'danger',
};

const ATT_STATUS_TONE: Record<string, StatusTone> = {
  Present: 'success', Late: 'warning', Absent: 'danger', 'On Leave': 'info', Sick: 'neutral', 'Day Off': 'neutral',
};

const TRAIN_TONE: Record<string, StatusTone> = {
  'Not Started': 'info', 'In Progress': 'warning', Completed: 'success', Overdue: 'danger',
};

const fmt = (n: number) => (n ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '0');

// ── Shared DataTable ─────────────────────────────────────────────────
type ColumnAlign = 'left' | 'center' | 'right';

interface Column<T> {
  key: string;
  label: string;
  align?: ColumnAlign;
  sortable?: boolean;
  sortAccessor?: (row: T) => string | number;
  render?: (row: T, index: number) => React.ReactNode;
}

function StaffDataTable<T extends Record<string, any>>({
  columns, data, filterable = false, filterPlaceholder = 'Search...', sortable = false, emptyMessage = 'No records found',
}: {
  columns: Column<T>[]; data: T[]; filterable?: boolean; filterPlaceholder?: string; sortable?: boolean; emptyMessage?: string;
}) {
  const [filter, setFilter] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const filtered = useMemo(() => {
    if (!filterable || !filter.trim()) return data;
    const q = filter.toLowerCase();
    return data.filter(row => columns.some(col => {
      const val = col.render ? undefined : row[col.key];
      if (val === null || val === undefined) return false;
      return String(val).toLowerCase().includes(q);
    }));
  }, [data, filter, filterable, columns]);

  const sorted = useMemo(() => {
    if (!sortable || !sortKey) return filtered;
    const col = columns.find(c => c.key === sortKey);
    if (!col) return filtered;
    const accessor = col.sortAccessor || ((row: T) => row[sortKey]);
    return [...filtered].sort((a, b) => {
      const aVal = accessor(a);
      const bVal = accessor(b);
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      if (typeof aVal === 'number' && typeof bVal === 'number') return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      return sortDir === 'asc' ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
    });
  }, [filtered, sortKey, sortDir, sortable, columns]);

  const handleSort = (key: string) => {
    if (!sortable) return;
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const alignClass: Record<ColumnAlign, string> = { left: 'text-left', center: 'text-center', right: 'text-right' };

  return (
    <div>
      {filterable && (
        <div className="relative max-w-xs mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder={filterPlaceholder} value={filter} onChange={e => setFilter(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:border-indigo-500" />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
            <tr>
              {columns.map(col => {
                const isSortable = sortable && col.sortable !== false;
                const active = sortKey === col.key;
                return (
                  <th key={col.key} onClick={() => isSortable && handleSort(col.key)}
                    className={[`px-6 py-3 font-medium ${alignClass[col.align || 'left']}`, isSortable ? 'cursor-pointer select-none hover:text-slate-700 dark:hover:text-slate-300' : ''].join(' ')}>
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {isSortable && (active ? (sortDir === 'asc' ? <ChevronUp size={12} className="text-indigo-500" /> : <ChevronDown size={12} className="text-indigo-500" />) : <ChevronsUpDown size={12} className="text-slate-300 dark:text-slate-600" />)}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
            {sorted.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-6 py-8 text-center text-slate-400">{emptyMessage}</td></tr>
            ) : sorted.map((row, i) => (
              <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                {columns.map(col => (
                  <td key={col.key} className={`px-6 py-3 ${alignClass[col.align || 'left']} text-slate-600 dark:text-slate-400`}>
                    {col.render ? col.render(row, i) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────
export default function BanquetStaffManagement() {
  const { currentPropertyId, addNotification } = useERP();

  const [subTab, setSubTab] = useState<SubTab>('assignments');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [staff, setStaff] = useState<BanquetStaff[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<BanquetStaffAttendance[]>([]);
  const [training, setTraining] = useState<BanquetStaffTraining[]>([]);
  const [productivity, setProductivity] = useState<BanquetStaffProductivity[]>([]);
  const [shiftReqs, setShiftReqs] = useState<BanquetStaffShiftReq[]>([]);
  const [staffingReqs, setStaffingReqs] = useState<BanquetStaffStaffingReq[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalKind, setModalKind] = useState<SubTab | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);

  // Forms
  const [assignForm, setAssignForm] = useState({
    employeeId: '', name: '', email: '', phone: '', role: 'Banquet Server' as Role, shift: 'Morning' as Shift,
    functionArea: 'Ballroom', status: 'Active Duty', workload: 0, eventsHandled: 0, ytdRevenue: 0, linkMode: 'new' as 'new' | 'existing',
  });
  const [attForm, setAttForm] = useState({ staffId: '', attendanceDate: new Date().toISOString().split('T')[0], status: 'Present', checkIn: '', checkOut: '', hoursWorked: 0, overtimeHours: 0, notes: '' });
  const [trainForm, setTrainForm] = useState({ staffId: '', course: '', dueDate: '', status: 'Not Started' });
  const [prodForm, setProdForm] = useState({ staffId: '', period: 'MTD', eventsWorked: 0, setupHours: 0, serviceHours: 0, guestSatisfaction: 0, revenue: 0 });
  const [countForm, setCountForm] = useState({ requiredCount: 0, assignedCount: 0 });

  const staffOptions = useMemo(() => staff.map(s => ({ value: s.id, label: `${s.name} · ${s.role}` })), [staff]);

  const loadAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const [s, a, t, p, sr, st, e] = await Promise.all([
        apiRequest(`${API_BASE}/staff`),
        apiRequest(`${API_BASE}/staff/attendance`),
        apiRequest(`${API_BASE}/staff/training`),
        apiRequest(`${API_BASE}/staff/productivity`),
        apiRequest(`${API_BASE}/staff/shift-reqs`),
        apiRequest(`${API_BASE}/staff/staffing-reqs`),
        currentPropertyId ? apiRequest(`${API_BASE}/staff/employees/${currentPropertyId}`).catch(() => []) : Promise.resolve([]),
      ]);
      setStaff(s); setAttendance(a); setTraining(t); setProductivity(p);
      setShiftReqs(sr); setStaffingReqs(st); setEmployees(e);
    } catch (e: any) {
      addNotification(e.message || 'Failed to load staff data', 'warning', 'Banquet & Events');
    } finally {
      setRefreshing(false); setLoading(false);
    }
  }, [addNotification, currentPropertyId]);

  useEffect(() => { setLoading(true); loadAll(); }, [loadAll]);

  const stats = useMemo(() => ({
    total: staff.length,
    active: staff.filter(s => s.status === 'Active Duty').length,
    onLeave: staff.filter(s => s.status === 'On Leave').length,
    revenue: staff.reduce((sum, s) => sum + Number(s.ytd_revenue || 0), 0),
    workload: staff.length ? staff.reduce((sum, s) => sum + Number(s.workload || 0), 0) / staff.length : 0,
  }), [staff]);

  const openModal = (kind: SubTab, row?: any) => {
    setModalKind(kind); setEditing(row || null);
    if (kind === 'assignments') {
      setAssignForm(row ? {
        employeeId: row.employee_id || '', name: row.name, email: row.email || '', phone: row.phone || '', role: row.role as Role,
        shift: row.shift as Shift, functionArea: row.function_area, status: row.status, workload: Number(row.workload || 0),
        eventsHandled: Number(row.events_handled || 0), ytdRevenue: Number(row.ytd_revenue || 0), linkMode: row.employee_id ? 'existing' : 'new',
      } : { employeeId: '', name: '', email: '', phone: '', role: 'Banquet Server', shift: 'Morning', functionArea: 'Ballroom', status: 'Active Duty', workload: 0, eventsHandled: 0, ytdRevenue: 0, linkMode: 'new' });
    } else if (kind === 'attendance') {
      setAttForm(row ? {
        staffId: row.staff_id, attendanceDate: row.attendance_date, status: row.status,
        checkIn: row.check_in ? new Date(row.check_in).toISOString().slice(0, 16) : '',
        checkOut: row.check_out ? new Date(row.check_out).toISOString().slice(0, 16) : '',
        hoursWorked: Number(row.hours_worked || 0), overtimeHours: Number(row.overtime_hours || 0), notes: row.notes || '',
      } : { staffId: '', attendanceDate: new Date().toISOString().split('T')[0], status: 'Present', checkIn: '', checkOut: '', hoursWorked: 0, overtimeHours: 0, notes: '' });
    } else if (kind === 'training') {
      setTrainForm(row ? { staffId: row.staff_id, course: row.course, dueDate: row.due_date || '', status: row.status } : { staffId: '', course: '', dueDate: '', status: 'Not Started' });
    } else if (kind === 'productivity') {
      setProdForm(row ? { staffId: row.staff_id, period: row.period, eventsWorked: row.events_worked, setupHours: row.setup_hours, serviceHours: row.service_hours, guestSatisfaction: row.guest_satisfaction, revenue: Number(row.revenue || 0) } : { staffId: '', period: 'MTD', eventsWorked: 0, setupHours: 0, serviceHours: 0, guestSatisfaction: 0, revenue: 0 });
    } else if (kind === 'shifts' || kind === 'staffing') {
      setCountForm(row ? { requiredCount: row.required_count, assignedCount: row.assigned_count } : { requiredCount: 0, assignedCount: 0 });
    }
    setModalOpen(true);
  };

  const closeModal = () => { setModalOpen(false); setModalKind(null); setEditing(null); };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (modalKind === 'assignments') {
        const payload = {
          employeeId: assignForm.linkMode === 'existing' ? assignForm.employeeId : null,
          name: assignForm.name, email: assignForm.email || null, phone: assignForm.phone || null,
          role: assignForm.role, shift: assignForm.shift, functionArea: assignForm.functionArea,
          status: assignForm.status, workload: assignForm.workload, eventsHandled: assignForm.eventsHandled,
          ytdRevenue: assignForm.ytdRevenue, propertyId: currentPropertyId,
        };
        if (editing) await apiRequest(`${API_BASE}/staff/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        else await apiRequest(`${API_BASE}/staff`, { method: 'POST', body: JSON.stringify(payload) });
        addNotification(`Staff ${editing ? 'updated' : 'added'}`, 'success', 'Banquet & Events');
      } else if (modalKind === 'attendance') {
        const payload = { staffId: attForm.staffId, attendanceDate: attForm.attendanceDate, status: attForm.status, checkIn: attForm.checkIn || null, checkOut: attForm.checkOut || null, hoursWorked: attForm.hoursWorked, overtimeHours: attForm.overtimeHours, notes: attForm.notes || null };
        if (editing) await apiRequest(`${API_BASE}/staff/attendance/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        else await apiRequest(`${API_BASE}/staff/attendance`, { method: 'POST', body: JSON.stringify(payload) });
        addNotification('Attendance saved', 'success', 'Banquet & Events');
      } else if (modalKind === 'training') {
        const payload = { staffId: trainForm.staffId, course: trainForm.course, dueDate: trainForm.dueDate || null, status: trainForm.status };
        if (editing) await apiRequest(`${API_BASE}/staff/training/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        else await apiRequest(`${API_BASE}/staff/training`, { method: 'POST', body: JSON.stringify(payload) });
        addNotification('Training record saved', 'success', 'Banquet & Events');
      } else if (modalKind === 'productivity') {
        const payload = { staffId: prodForm.staffId, period: prodForm.period, eventsWorked: prodForm.eventsWorked, setupHours: prodForm.setupHours, serviceHours: prodForm.serviceHours, guestSatisfaction: prodForm.guestSatisfaction, revenue: prodForm.revenue };
        if (editing) await apiRequest(`${API_BASE}/staff/productivity/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        else await apiRequest(`${API_BASE}/staff/productivity`, { method: 'POST', body: JSON.stringify(payload) });
        addNotification('Productivity record saved', 'success', 'Banquet & Events');
      } else if (modalKind === 'shifts') {
        await apiRequest(`${API_BASE}/staff/shift-reqs/${editing.id}`, { method: 'PATCH', body: JSON.stringify({ requiredCount: countForm.requiredCount, assignedCount: countForm.assignedCount }) });
        addNotification('Shift requirement updated', 'success', 'Banquet & Events');
      } else if (modalKind === 'staffing') {
        await apiRequest(`${API_BASE}/staff/staffing-reqs/${editing.id}`, { method: 'PATCH', body: JSON.stringify({ requiredCount: countForm.requiredCount, assignedCount: countForm.assignedCount }) });
        addNotification('Staffing requirement updated', 'success', 'Banquet & Events');
      }
      closeModal(); loadAll();
    } catch (e: any) {
      addNotification(e.message || 'Save failed', 'warning', 'Banquet & Events');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (kind: SubTab, id: string, label?: string) => {
    if (!confirm(`Delete ${label || 'record'}?`)) return;
    try {
      if (kind === 'assignments') await apiRequest(`${API_BASE}/staff/${id}`, { method: 'DELETE' });
      else if (kind === 'attendance') await apiRequest(`${API_BASE}/staff/attendance/${id}`, { method: 'DELETE' });
      else if (kind === 'training') await apiRequest(`${API_BASE}/staff/training/${id}`, { method: 'DELETE' });
      else if (kind === 'productivity') await apiRequest(`${API_BASE}/staff/productivity/${id}`, { method: 'DELETE' });
      addNotification('Deleted', 'info', 'Banquet & Events');
      loadAll();
    } catch (e: any) { addNotification(e.message || 'Delete failed', 'warning', 'Banquet & Events'); }
  };

  const onSelectEmployee = (empId: string) => {
    const emp = employees.find(e => e.id === empId);
    if (emp) setAssignForm(prev => ({ ...prev, employeeId: empId, name: emp.name, email: emp.email || '', phone: emp.phone || '' }));
  };

  const actionButtons = (kind: SubTab, row: any, label?: string) => (
    <div className="flex gap-2 justify-end">
      <button onClick={() => openModal(kind, row)} className={button.ghost}><Pencil className="w-4 h-4" /></button>
      <button onClick={() => handleDelete(kind, row.id, label)} className={button.ghost}><Trash2 className="w-4 h-4 text-rose-600" /></button>
    </div>
  );

  // ── Column definitions ─────────────────────────────────────────────
  const staffColumns: Column<BanquetStaff>[] = [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'role', label: 'Role', render: s => <Badge tone={ROLE_TONE[s.role] || 'accent'}>{s.role}</Badge> },
    { key: 'shift', label: 'Shift' },
    { key: 'function_area', label: 'Function Area' },
    { key: 'status', label: 'Status', render: s => <Badge tone={STATUS_TONE[s.status] || 'neutral'}>{s.status}</Badge> },
    { key: 'workload', label: 'Workload %', align: 'right', render: s => `${s.workload}%` },
    { key: 'events_handled', label: 'Events', align: 'right' },
    { key: 'ytd_revenue', label: 'YTD Revenue', align: 'right', render: s => `$${fmt(Number(s.ytd_revenue))}` },
    { key: 'actions', label: '', align: 'right', render: s => actionButtons('assignments', s, s.name) },
  ];

  const attColumns: Column<BanquetStaffAttendance>[] = [
    { key: 'staff', label: 'Staff', render: a => a.banquet_staff ? `${a.banquet_staff.name} · ${a.banquet_staff.role}` : a.staff_id },
    { key: 'attendance_date', label: 'Date' },
    { key: 'status', label: 'Status', render: a => <Badge tone={ATT_STATUS_TONE[a.status] || 'neutral'}>{a.status}</Badge> },
    { key: 'check_in', label: 'Check In', render: a => a.check_in ? new Date(a.check_in).toLocaleString() : '—' },
    { key: 'check_out', label: 'Check Out', render: a => a.check_out ? new Date(a.check_out).toLocaleString() : '—' },
    { key: 'hours_worked', label: 'Hours', align: 'right' },
    { key: 'overtime_hours', label: 'OT', align: 'right' },
    { key: 'actions', label: '', align: 'right', render: a => actionButtons('attendance', a) },
  ];

  const trainColumns: Column<BanquetStaffTraining>[] = [
    { key: 'staff', label: 'Staff', render: t => t.banquet_staff ? `${t.banquet_staff.name} · ${t.banquet_staff.role}` : t.staff_id },
    { key: 'course', label: 'Course' },
    { key: 'due_date', label: 'Due Date', render: t => t.due_date || '—' },
    { key: 'status', label: 'Status', render: t => <Badge tone={TRAIN_TONE[t.status] || 'neutral'}>{t.status}</Badge> },
    { key: 'actions', label: '', align: 'right', render: t => actionButtons('training', t) },
  ];

  const prodColumns: Column<BanquetStaffProductivity>[] = [
    { key: 'staff', label: 'Staff', render: p => p.banquet_staff ? `${p.banquet_staff.name} · ${p.banquet_staff.role}` : p.staff_id },
    { key: 'period', label: 'Period' },
    { key: 'events_worked', label: 'Events', align: 'right' },
    { key: 'setup_hours', label: 'Setup Hrs', align: 'right' },
    { key: 'service_hours', label: 'Service Hrs', align: 'right' },
    { key: 'guest_satisfaction', label: 'Guest Sat', align: 'right', render: p => p.guest_satisfaction ? `${Number(p.guest_satisfaction).toFixed(1)}★` : '—' },
    { key: 'revenue', label: 'Revenue', align: 'right', render: p => `$${fmt(Number(p.revenue))}` },
    { key: 'actions', label: '', align: 'right', render: p => actionButtons('productivity', p) },
  ];

  const shiftColumns: Column<BanquetStaffShiftReq>[] = [
    { key: 'role', label: 'Role' },
    { key: 'shift', label: 'Shift' },
    { key: 'required_count', label: 'Required', align: 'right' },
    { key: 'assigned_count', label: 'Assigned', align: 'right' },
    { key: 'gap', label: 'Gap', align: 'right', render: r => <span className={r.assigned_count >= r.required_count ? 'text-emerald-600' : 'text-rose-600'}>{r.assigned_count - r.required_count}</span> },
    { key: 'actions', label: '', align: 'right', render: r => <button onClick={() => openModal('shifts', r)} className={button.ghost}><Pencil className="w-4 h-4" /></button> },
  ];

  const staffingColumns: Column<BanquetStaffStaffingReq>[] = [
    { key: 'function_area', label: 'Function Area' },
    { key: 'role', label: 'Role' },
    { key: 'required_count', label: 'Required', align: 'right' },
    { key: 'assigned_count', label: 'Assigned', align: 'right' },
    { key: 'gap', label: 'Gap', align: 'right', render: r => <span className={r.assigned_count >= r.required_count ? 'text-emerald-600' : 'text-rose-600'}>{r.assigned_count - r.required_count}</span> },
    { key: 'actions', label: '', align: 'right', render: r => <button onClick={() => openModal('staffing', r)} className={button.ghost}><Pencil className="w-4 h-4" /></button> },
  ];

  const renderTab = () => {
    if (loading) return <div className="px-6 py-10 text-center text-slate-500"><Loader2 className="w-5 h-5 animate-spin inline-block mr-2" /> Loading…</div>;
    switch (subTab) {
      case 'assignments': return (
        <SectionCard title="Banquet Staff Assignments" subtitle={`${staff.length} staff member(s)`} icon={IdCard} tone="accent" actions={<button onClick={() => openModal('assignments')} className={button.primary}><Plus className="w-4 h-4" /> Add Staff</button>}>
          <StaffDataTable columns={staffColumns} data={staff} sortable filterable filterPlaceholder="Search staff..." />
        </SectionCard>
      );
      case 'attendance': return (
        <SectionCard title="Attendance" subtitle={`${attendance.length} record(s)`} icon={CalendarCheck} tone="info" actions={<button onClick={() => openModal('attendance')} className={button.primary}><Plus className="w-4 h-4" /> Check In</button>}>
          <StaffDataTable columns={attColumns} data={attendance} sortable />
        </SectionCard>
      );
      case 'shifts': return (
        <SectionCard title="Shift Requirements" icon={CalendarDays} tone="warning">
          <StaffDataTable columns={shiftColumns} data={shiftReqs} sortable />
        </SectionCard>
      );
      case 'staffing': return (
        <SectionCard title="Staffing Requirements" icon={Users} tone="accent">
          <StaffDataTable columns={staffingColumns} data={staffingReqs} sortable />
        </SectionCard>
      );
      case 'training': return (
        <SectionCard title="Training" subtitle={`${training.length} course(s)`} icon={GraduationCap} tone="info" actions={<button onClick={() => openModal('training')} className={button.primary}><Plus className="w-4 h-4" /> Add Course</button>}>
          <StaffDataTable columns={trainColumns} data={training} sortable />
        </SectionCard>
      );
      case 'productivity': return (
        <SectionCard title="Productivity" subtitle={`${productivity.length} record(s)`} icon={Gauge} tone="success" actions={<button onClick={() => openModal('productivity')} className={button.primary}><Plus className="w-4 h-4" /> Add Record</button>}>
          <StaffDataTable columns={prodColumns} data={productivity} sortable />
        </SectionCard>
      );
      default: return null;
    }
  };

  const renderModal = () => {
    if (!modalOpen || !modalKind) return null;
    const inputCls = 'w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500';
    const labelCls = 'block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5';
    const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
      <label className="block"><span className={labelCls}>{label}</span>{children}</label>
    );

    if (modalKind === 'assignments') return (
      <div className="space-y-4">
        <Field label="Link to HR Employee">
          <select value={assignForm.employeeId} onChange={e => { onSelectEmployee(e.target.value); setAssignForm(prev => ({ ...prev, linkMode: e.target.value ? 'existing' : 'new' })); }} className={inputCls}>
            <option value="">New / Manual</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name} · {e.department} · {e.position}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name"><input value={assignForm.name} onChange={e => setAssignForm({ ...assignForm, name: e.target.value, linkMode: 'new' })} className={inputCls} /></Field>
          <Field label="Email"><input value={assignForm.email} onChange={e => setAssignForm({ ...assignForm, email: e.target.value })} className={inputCls} /></Field>
        </div>
        <Field label="Phone"><input value={assignForm.phone} onChange={e => setAssignForm({ ...assignForm, phone: e.target.value })} className={inputCls} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Role"><select value={assignForm.role} onChange={e => setAssignForm({ ...assignForm, role: e.target.value as Role })} className={inputCls}>{ROLES.map(r => <option key={r} value={r}>{r}</option>)}</select></Field>
          <Field label="Shift"><select value={assignForm.shift} onChange={e => setAssignForm({ ...assignForm, shift: e.target.value as Shift })} className={inputCls}>{SHIFTS.map(s => <option key={s} value={s}>{s}</option>)}</select></Field>
          <Field label="Function Area"><select value={assignForm.functionArea} onChange={e => setAssignForm({ ...assignForm, functionArea: e.target.value })} className={inputCls}>{FUNCTION_AREAS.map(t => <option key={t} value={t}>{t}</option>)}</select></Field>
          <Field label="Status"><select value={assignForm.status} onChange={e => setAssignForm({ ...assignForm, status: e.target.value })} className={inputCls}>{STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select></Field>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Workload %"><input type="number" value={assignForm.workload} onChange={e => setAssignForm({ ...assignForm, workload: Number(e.target.value) })} className={inputCls} /></Field>
          <Field label="Events Handled"><input type="number" value={assignForm.eventsHandled} onChange={e => setAssignForm({ ...assignForm, eventsHandled: Number(e.target.value) })} className={inputCls} /></Field>
          <Field label="YTD Revenue"><input type="number" value={assignForm.ytdRevenue} onChange={e => setAssignForm({ ...assignForm, ytdRevenue: Number(e.target.value) })} className={inputCls} /></Field>
        </div>
      </div>
    );

    if (modalKind === 'attendance') return (
      <div className="space-y-4">
        <Field label="Staff"><select value={attForm.staffId} onChange={e => setAttForm({ ...attForm, staffId: e.target.value })} className={inputCls}><option value="">Select staff</option>{staffOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
        <Field label="Date"><input type="date" value={attForm.attendanceDate} onChange={e => setAttForm({ ...attForm, attendanceDate: e.target.value })} className={inputCls} /></Field>
        <Field label="Status"><select value={attForm.status} onChange={e => setAttForm({ ...attForm, status: e.target.value })} className={inputCls}>{ATTENDANCE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Check In"><input type="datetime-local" value={attForm.checkIn} onChange={e => setAttForm({ ...attForm, checkIn: e.target.value })} className={inputCls} /></Field>
          <Field label="Check Out"><input type="datetime-local" value={attForm.checkOut} onChange={e => setAttForm({ ...attForm, checkOut: e.target.value })} className={inputCls} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Hours Worked"><input type="number" value={attForm.hoursWorked} onChange={e => setAttForm({ ...attForm, hoursWorked: Number(e.target.value) })} className={inputCls} /></Field>
          <Field label="Overtime Hours"><input type="number" value={attForm.overtimeHours} onChange={e => setAttForm({ ...attForm, overtimeHours: Number(e.target.value) })} className={inputCls} /></Field>
        </div>
        <Field label="Notes"><input value={attForm.notes} onChange={e => setAttForm({ ...attForm, notes: e.target.value })} className={inputCls} /></Field>
      </div>
    );

    if (modalKind === 'training') return (
      <div className="space-y-4">
        <Field label="Staff"><select value={trainForm.staffId} onChange={e => setTrainForm({ ...trainForm, staffId: e.target.value })} className={inputCls}><option value="">Select staff</option>{staffOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
        <Field label="Course"><input value={trainForm.course} onChange={e => setTrainForm({ ...trainForm, course: e.target.value })} className={inputCls} /></Field>
        <Field label="Due Date"><input type="date" value={trainForm.dueDate} onChange={e => setTrainForm({ ...trainForm, dueDate: e.target.value })} className={inputCls} /></Field>
        <Field label="Status"><select value={trainForm.status} onChange={e => setTrainForm({ ...trainForm, status: e.target.value })} className={inputCls}>{TRAIN_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select></Field>
      </div>
    );

    if (modalKind === 'productivity') return (
      <div className="space-y-4">
        <Field label="Staff"><select value={prodForm.staffId} onChange={e => setProdForm({ ...prodForm, staffId: e.target.value })} className={inputCls}><option value="">Select staff</option>{staffOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
        <Field label="Period"><input value={prodForm.period} onChange={e => setProdForm({ ...prodForm, period: e.target.value })} className={inputCls} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Events Worked"><input type="number" value={prodForm.eventsWorked} onChange={e => setProdForm({ ...prodForm, eventsWorked: Number(e.target.value) })} className={inputCls} /></Field>
          <Field label="Setup Hours"><input type="number" value={prodForm.setupHours} onChange={e => setProdForm({ ...prodForm, setupHours: Number(e.target.value) })} className={inputCls} /></Field>
          <Field label="Service Hours"><input type="number" value={prodForm.serviceHours} onChange={e => setProdForm({ ...prodForm, serviceHours: Number(e.target.value) })} className={inputCls} /></Field>
          <Field label="Guest Satisfaction (0-5)"><input type="number" step="0.1" min="0" max="5" value={prodForm.guestSatisfaction} onChange={e => setProdForm({ ...prodForm, guestSatisfaction: Number(e.target.value) })} className={inputCls} /></Field>
        </div>
        <Field label="Revenue"><input type="number" value={prodForm.revenue} onChange={e => setProdForm({ ...prodForm, revenue: Number(e.target.value) })} className={inputCls} /></Field>
      </div>
    );

    if (modalKind === 'shifts' || modalKind === 'staffing') return (
      <div className="space-y-4">
        <Field label="Required Count"><input type="number" value={countForm.requiredCount} onChange={e => setCountForm({ ...countForm, requiredCount: Number(e.target.value) })} className={inputCls} /></Field>
        <Field label="Assigned Count"><input type="number" value={countForm.assignedCount} onChange={e => setCountForm({ ...countForm, assignedCount: Number(e.target.value) })} className={inputCls} /></Field>
      </div>
    );
    return null;
  };

  return (
    <div className={[layout.sectionStack].join(' ')}>
      <PageHeader
        title="Staff Management"
        subtitle="Manage banquet team assignments, attendance, shifts, staffing, training and productivity — linked to HR."
        icon={Users}
        actions={
          <button onClick={loadAll} disabled={refreshing} className={[button.ghost, 'flex items-center gap-2'].join(' ')}>
            <RefreshCw className={refreshing ? 'w-4 h-4 animate-spin' : 'w-4 h-4'} /> Refresh
          </button>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Total Staff" value={stats.total} icon={Users} tone="accent" />
        <StatCard title="Active Duty" value={stats.active} icon={IdCard} tone="success" />
        <StatCard title="On Leave" value={stats.onLeave} icon={CalendarDays} tone="warning" />
        <StatCard title="YTD Revenue" value={`$${fmt(stats.revenue)}`} icon={Gauge} tone="info" />
      </div>

      <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto">
        {SUB_TABS.map(t => {
          const Icon = t.icon;
          const active = subTab === t.id;
          return (
            <button key={t.id} onClick={() => setSubTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all whitespace-nowrap ${
                active ? 'bg-white dark:bg-slate-700 text-[var(--color-accent-operations)] shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}>
              <Icon className="w-4 h-4" />
              <span className="text-sm font-medium">{t.label}</span>
            </button>
          );
        })}
      </div>

      {renderTab()}

      <ModalSystem
        isOpen={modalOpen}
        onClose={closeModal}
        title={editing ? 'Edit' : 'Add'}
        subtitle={modalKind ? `${modalKind.charAt(0).toUpperCase() + modalKind.slice(1)} record` : ''}
        variant="form"
        loading={saving}
        showFooter
        cancelLabel="Cancel"
        confirmLabel={editing ? 'Save Changes' : 'Create'}
        onConfirm={handleSave}
      >
        {renderModal()}
      </ModalSystem>
    </div>
  );
}
