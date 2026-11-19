/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HR Attendance Management — daily attendance registry.
 *
 * DB-integrated via /api/hr-portal/attendance/* routes. Reads and updates
 * the shared staff_attendance table with the extended spec:
 *   * Sources (Biometric, RFID, Mobile, Web, Manual)
 *   * Approval workflow (Pending, Approved, Rejected)
 *   * Missing Punch and Early Departure flags
 *   * Manual entry, corrections, CSV export
 *
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, Calendar, UserCheck, UserX, MapPin, Search, Filter, RefreshCw, Loader2, Pencil, ChevronLeft, ChevronRight, Plus, FileDown, CheckCircle2, XCircle, Download } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';

interface AttendanceRecord {
  id: string;
  staff_name: string;
  department_scope: string;
  attendance_date: string;
  shift: string;
  check_in: string | null;
  check_out: string | null;
  status: string;
  hours_worked: number;
  overtime_hours: number;
  notes: string | null;
  source: 'Biometric' | 'RFID' | 'Mobile' | 'Web' | 'Manual';
  approval_status: 'Pending' | 'Approved' | 'Rejected';
  early_departure: boolean;
  missing_punch: boolean;
  approved_by: string | null;
  approved_at: string | null;
}

interface Stats {
  onDuty: number;
  absent: number;
  late: number;
  total: number;
  missingPunch: number;
  pendingApproval: number;
  avgCheckIn: string;
  locationSync: string;
}

interface EmployeeOption {
  id: string;
  name: string;
  department: string;
  position: string;
  employee_number: string;
}

const DEPARTMENT_OPTIONS = ['All', 'FO', 'HK', 'FB', 'ENG'];
const STATUS_OPTIONS = ['All', 'Present', 'Late', 'Absent', 'On Leave', 'Sick', 'Half Day'];
const SOURCE_OPTIONS = ['All', 'Biometric', 'RFID', 'Mobile', 'Web', 'Manual'];
const APPROVAL_OPTIONS = ['All', 'Pending', 'Approved', 'Rejected'];

const STATUS_TONE: Record<string, statusTone.StatusTone> = {
  Present: 'success',
  Late: 'warning',
  Absent: 'danger',
  'On Leave': 'info',
  Sick: 'info',
  'Half Day': 'warning',
  'Day Off': 'neutral',
  'Public Holiday': 'neutral',
  'Work From Home': 'accent',
  Mission: 'info',
  'Training Day': 'accent',
};

const APPROVAL_TONE: Record<string, statusTone.StatusTone> = {
  Pending: 'warning',
  Approved: 'success',
  Rejected: 'danger',
};

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const inputCls = 'w-full px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 font-sans';

function formatTime(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function parseLocalTimeForInput(timeStr: string) {
  if (!timeStr || timeStr === '—') return '';
  const d = new Date(timeStr);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function combineDateAndTime(date: string, time: string) {
  return `${date}T${time}:00`;
}

function buildRegistryUrl(propertyId: string, date: string, params: Record<string, string>) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v && v !== 'All') qs.append(k, v); });
  const query = qs.toString();
  return `/api/hr-portal/attendance/registry/${propertyId}/${date}${query ? `?${query}` : ''}`;
}

const AttendanceManagement = () => {
  const { currentPropertyId, addNotification } = useERP();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [date, setDate] = useState('2024-05-30');
  const [registry, setRegistry] = useState<AttendanceRecord[]>([]);
  const [stats, setStats] = useState<Stats>({ onDuty: 0, absent: 0, late: 0, total: 0, missingPunch: 0, pendingApproval: 0, avgCheckIn: '08:04 AM', locationSync: 'Active' });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState('All');
  const [deptFilter, setDeptFilter] = useState('All');
  const [sourceFilter, setSourceFilter] = useState('All');
  const [approvalFilter, setApprovalFilter] = useState('All');
  const [search, setSearch] = useState('');

  const [editRecord, setEditRecord] = useState<AttendanceRecord | null>(null);
  const [editForm, setEditForm] = useState({ checkIn: '', checkOut: '', status: 'Present', overtimeHours: 0, earlyDeparture: false, missingPunch: false, source: 'Manual', notes: '' });

  const [newModal, setNewModal] = useState(false);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [newForm, setNewForm] = useState({
    employeeId: '', staffId: '', staffName: '', department: 'FO', attendanceDate: '2024-05-30',
    shift: 'Morning', checkIn: '', checkOut: '', status: 'Present', hoursWorked: '',
    overtimeHours: 0, source: 'Manual', notes: '',
  });

  const fetchData = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoading(true);
    try {
      const params: Record<string, string> = {
        status: statusFilter,
        department: deptFilter,
        source: sourceFilter,
        approval: approvalFilter,
        search,
      };
      const [sRes, rRes] = await Promise.all([
        fetch(`/api/hr-portal/attendance/statistics/${currentPropertyId}/${date}`, { headers: authHeaders() }),
        fetch(buildRegistryUrl(currentPropertyId, date, params), { headers: authHeaders() }),
      ]);
      if (sRes.ok) setStats(await sRes.json());
      if (rRes.ok) setRegistry(((await rRes.json()) as { registry: AttendanceRecord[] }).registry || []);
    } catch { /* non-fatal */ }
    setLoading(false);
  }, [currentPropertyId, date, statusFilter, deptFilter, sourceFilter, approvalFilter, search]);

  useEffect(() => {
    if (currentPropertyId) fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId, date, statusFilter, deptFilter, sourceFilter, approvalFilter, search]);

  const openEdit = (r: AttendanceRecord) => {
    setEditForm({
      checkIn: parseLocalTimeForInput(r.check_in) || '',
      checkOut: parseLocalTimeForInput(r.check_out) || '',
      status: r.status,
      overtimeHours: r.overtime_hours || 0,
      earlyDeparture: r.early_departure,
      missingPunch: r.missing_punch,
      source: r.source,
      notes: r.notes || '',
    });
    setEditRecord(r);
  };

  const saveRecord = async () => {
    if (!editRecord) return;
    setSaving(true);
    try {
      const body = {
        checkIn: editForm.checkIn ? combineDateAndTime(editRecord.attendance_date, editForm.checkIn) : null,
        checkOut: editForm.checkOut ? combineDateAndTime(editRecord.attendance_date, editForm.checkOut) : null,
        status: editForm.status,
        overtimeHours: Number(editForm.overtimeHours) || 0,
        earlyDeparture: Boolean(editForm.earlyDeparture),
        missingPunch: Boolean(editForm.missingPunch),
        source: editForm.source,
        notes: editForm.notes.trim(),
      };
      const res = await fetch(`/api/hr-portal/attendance/registry/${editRecord.id}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Attendance updated', 'success', 'HR');
      setEditRecord(null);
      fetchData();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update attendance', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const approveRecord = async (r: AttendanceRecord, approvalStatus: 'Approved' | 'Rejected') => {
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/attendance/registry/${r.id}/approve`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({ approvalStatus }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification(`Attendance ${approvalStatus.toLowerCase()}`, approvalStatus === 'Approved' ? 'success' : 'danger', 'HR');
      fetchData();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update approval', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const openNewModal = async () => {
    if (!currentPropertyId) return;
    setNewForm(prev => ({ ...prev, attendanceDate: date }));
    setNewModal(true);
    try {
      const res = await fetch(`/api/hr-portal/attendance/employees/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setEmployees(((await res.json()) as { employees: EmployeeOption[] }).employees || []);
    } catch { /* non-fatal */ }
  };

  const createRecord = async () => {
    if (!currentPropertyId || !newForm.employeeId || !newForm.staffName || !newForm.department) return;
    setSaving(true);
    try {
      const body = {
        propertyId: currentPropertyId,
        staffId: newForm.staffId || newForm.employeeId,
        staffName: newForm.staffName,
        departmentScope: newForm.department,
        attendanceDate: newForm.attendanceDate,
        shift: newForm.shift,
        checkIn: newForm.checkIn ? combineDateAndTime(newForm.attendanceDate, newForm.checkIn) : null,
        checkOut: newForm.checkOut ? combineDateAndTime(newForm.attendanceDate, newForm.checkOut) : null,
        status: newForm.status,
        hoursWorked: newForm.hoursWorked ? Number(newForm.hoursWorked) : null,
        overtimeHours: Number(newForm.overtimeHours) || 0,
        source: newForm.source,
        notes: newForm.notes.trim(),
      };
      const res = await fetch('/api/hr-portal/attendance/registry', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Attendance record created', 'success', 'HR');
      setNewModal(false);
      fetchData();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create attendance', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = () => {
    if (!currentPropertyId) return;
    const params: Record<string, string> = {
      status: statusFilter,
      department: deptFilter,
      source: sourceFilter,
      approval: approvalFilter,
      search,
    };
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v && v !== 'All') qs.append(k, v); });
    const query = qs.toString();
    const url = `/api/hr-portal/attendance/export/${currentPropertyId}/${date}${query ? `?${query}` : ''}`;
    window.open(url, '_blank');
  };

  const changeDate = (days: number) => {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + days);
    setDate(d.toISOString().slice(0, 10));
  };

  useEffect(() => {
    if (!newModal || !currentPropertyId) return;
    const emp = employees.find((e) => e.id === newForm.employeeId);
    if (emp) {
      setNewForm(prev => ({
        ...prev,
        staffName: emp.name,
        staffId: emp.employee_number || emp.id,
        department: deptFromEmployee(emp.department),
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newForm.employeeId, employees]);

  function deptFromEmployee(dept: string) {
    if (dept === 'Front Office') return 'FO';
    if (dept === 'Housekeeping') return 'HK';
    if (dept === 'Food & Beverage') return 'FB';
    if (dept === 'Engineering') return 'ENG';
    return dept;
  }

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Attendance Management" subtitle="Track daily check-ins, absences, missing punches and approvals" icon={Clock} />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Clock className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">Select a property to view attendance data.</p>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Attendance Management"
        subtitle="Track daily check-ins, absences, missing punches and approvals"
        icon={Clock}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={exportCsv} className={button.secondary}>
              <FileDown className="w-4 h-4" /> Export CSV
            </button>
            <button onClick={openNewModal} className={button.primary}>
              <Plus className="w-4 h-4" /> Manual Entry
            </button>
            <button onClick={fetchData} className={button.ghost}>
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="On Duty" value={stats.onDuty} icon={UserCheck} tone="success" />
        <StatCard title="Absent" value={stats.absent} icon={UserX} tone="danger" />
        <StatCard title="Missing Punch" value={stats.missingPunch} icon={Clock} tone="warning" />
        <StatCard title="Pending Approval" value={stats.pendingApproval} icon={CheckCircle2} tone="info" />
        <StatCard title="Avg. Check-in" value={stats.avgCheckIn} icon={Clock} tone="accent" />
        <StatCard title="Location Sync" value={stats.locationSync} icon={MapPin} tone="info" />
      </div>

      {/* Date & filters */}
      <SectionCard>
        <div className="flex flex-col xl:flex-row xl:items-center gap-4 justify-between">
          <div className="flex items-center gap-2">
            <button onClick={() => changeDate(-1)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"><ChevronLeft size={18} className="text-slate-500" /></button>
            <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800 rounded-xl text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Calendar size={14} /> {formatDate(date)}
            </div>
            <button onClick={() => changeDate(1)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"><ChevronRight size={18} className="text-slate-500" /></button>
            <button onClick={() => setDate(today)} className="ml-2 px-3 py-2 text-xs font-medium bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100 transition">Today</button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input
                type="text"
                placeholder="Search employee..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-44 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
              />
            </div>
            <FilterSelect value={statusFilter} options={STATUS_OPTIONS} onChange={setStatusFilter} label="Status" />
            <FilterSelect value={deptFilter} options={DEPARTMENT_OPTIONS} onChange={setDeptFilter} label="Dept" />
            <FilterSelect value={sourceFilter} options={SOURCE_OPTIONS} onChange={setSourceFilter} label="Source" />
            <FilterSelect value={approvalFilter} options={APPROVAL_OPTIONS} onChange={setApprovalFilter} label="Approval" />
          </div>
        </div>
      </SectionCard>

      {/* Registry */}
      <SectionCard pad="none">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
        ) : registry.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <Clock className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-sm">No attendance records for this date.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Employee</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Dept</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Check-In</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Check-Out</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Hours</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">OT</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Status</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Source</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Approval</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Flags</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {registry.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4 text-sm font-semibold text-slate-900 dark:text-white">{r.staff_name}</td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-500">{r.department_scope}</td>
                    <td className="px-6 py-4 text-center text-sm font-semibold text-slate-900 dark:text-white">{formatTime(r.check_in)}</td>
                    <td className="px-6 py-4 text-center text-sm font-semibold text-slate-400 font-mono">{formatTime(r.check_out)}</td>
                    <td className="px-6 py-4 text-center text-xs font-bold text-slate-900 dark:text-white">{r.hours_worked ?? '—'}</td>
                    <td className="px-6 py-4 text-center text-xs font-medium text-indigo-500">{(r.overtime_hours || 0).toFixed(1)}h</td>
                    <td className="px-6 py-4 text-center"><Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status}</Badge></td>
                    <td className="px-6 py-4 text-center"><Badge tone="neutral">{r.source}</Badge></td>
                    <td className="px-6 py-4 text-center"><Badge tone={APPROVAL_TONE[r.approval_status] ?? 'neutral'}>{r.approval_status}</Badge></td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex justify-center gap-1">
                        {r.missing_punch && <Badge tone="warning">Missing</Badge>}
                        {r.early_departure && <Badge tone="accent">Early</Badge>}
                        {!r.missing_punch && !r.early_departure && <span className="text-xs text-slate-400">—</span>}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-center gap-1">
                        {r.approval_status === 'Pending' && (
                          <>
                            <button onClick={() => approveRecord(r, 'Approved')} disabled={saving} className="p-1.5 bg-emerald-500 text-white rounded-lg hover:shadow-md transition"><CheckCircle2 size={14} /></button>
                            <button onClick={() => approveRecord(r, 'Rejected')} disabled={saving} className="p-1.5 bg-rose-500 text-white rounded-lg hover:shadow-md transition"><XCircle size={14} /></button>
                          </>
                        )}
                        <button onClick={() => openEdit(r)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Edit modal */}
      <ModalSystem
        isOpen={!!editRecord}
        onClose={() => setEditRecord(null)}
        onConfirm={saveRecord}
        title={`Update Attendance — ${editRecord?.staff_name}`}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Check-in</span>
            <input type="time" className={inputCls} value={editForm.checkIn} onChange={(e) => setEditForm(f => ({ ...f, checkIn: e.target.value }))} />
          </label>
          <label className="block">
            <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Check-out</span>
            <input type="time" className={inputCls} value={editForm.checkOut} onChange={(e) => setEditForm(f => ({ ...f, checkOut: e.target.value }))} />
          </label>
          <label className="block">
            <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Status</span>
            <select className={inputCls} value={editForm.status} onChange={(e) => setEditForm(f => ({ ...f, status: e.target.value }))}>
              {STATUS_OPTIONS.filter(s => s !== 'All').map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Source</span>
            <select className={inputCls} value={editForm.source} onChange={(e) => setEditForm(f => ({ ...f, source: e.target.value }))}>
              {SOURCE_OPTIONS.filter(s => s !== 'All').map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Overtime (h)</span>
            <input type="number" step="0.1" min={0} className={inputCls} value={editForm.overtimeHours} onChange={(e) => setEditForm(f => ({ ...f, overtimeHours: Number(e.target.value) }))} />
          </label>
          <div className="flex items-center gap-4 py-4">
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={editForm.missingPunch} onChange={(e) => setEditForm(f => ({ ...f, missingPunch: e.target.checked }))} />
              Missing Punch
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={editForm.earlyDeparture} onChange={(e) => setEditForm(f => ({ ...f, earlyDeparture: e.target.checked }))} />
              Early Departure
            </label>
          </div>
          <label className="col-span-2 block">
            <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Notes</span>
            <textarea className={inputCls} rows={3} value={editForm.notes} onChange={(e) => setEditForm(f => ({ ...f, notes: e.target.value }))} />
          </label>
        </div>
      </ModalSystem>

      {/* New manual entry modal */}
      <ModalSystem
        isOpen={newModal}
        onClose={() => setNewModal(false)}
        onConfirm={createRecord}
        title="Manual Attendance Entry"
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Create'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block">
              <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Employee</span>
              <select className={inputCls} value={newForm.employeeId} onChange={(e) => setNewForm(f => ({ ...f, employeeId: e.target.value }))}>
                <option value="">Select employee</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.employee_number}) — {e.department}</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Date</span>
            <input type="date" className={inputCls} value={newForm.attendanceDate} onChange={(e) => setNewForm(f => ({ ...f, attendanceDate: e.target.value }))} />
          </label>
          <label className="block">
            <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Shift</span>
            <select className={inputCls} value={newForm.shift} onChange={(e) => setNewForm(f => ({ ...f, shift: e.target.value }))}>
              <option value="Morning">Morning</option>
              <option value="Evening">Evening</option>
              <option value="Night">Night</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Check-in</span>
            <input type="time" className={inputCls} value={newForm.checkIn} onChange={(e) => setNewForm(f => ({ ...f, checkIn: e.target.value }))} />
          </label>
          <label className="block">
            <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Check-out</span>
            <input type="time" className={inputCls} value={newForm.checkOut} onChange={(e) => setNewForm(f => ({ ...f, checkOut: e.target.value }))} />
          </label>
          <label className="block">
            <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Status</span>
            <select className={inputCls} value={newForm.status} onChange={(e) => setNewForm(f => ({ ...f, status: e.target.value }))}>
              {STATUS_OPTIONS.filter(s => s !== 'All').map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Source</span>
            <select className={inputCls} value={newForm.source} onChange={(e) => setNewForm(f => ({ ...f, source: e.target.value }))}>
              {SOURCE_OPTIONS.filter(s => s !== 'All').map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Hours Worked</span>
            <input type="number" step="0.1" min={0} className={inputCls} value={newForm.hoursWorked} onChange={(e) => setNewForm(f => ({ ...f, hoursWorked: e.target.value }))} />
          </label>
          <label className="block">
            <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Overtime (h)</span>
            <input type="number" step="0.1" min={0} className={inputCls} value={newForm.overtimeHours} onChange={(e) => setNewForm(f => ({ ...f, overtimeHours: Number(e.target.value) }))} />
          </label>
          <label className="col-span-2 block">
            <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Notes</span>
            <textarea className={inputCls} rows={3} value={newForm.notes} onChange={(e) => setNewForm(f => ({ ...f, notes: e.target.value }))} />
          </label>
        </div>
      </ModalSystem>
    </div>
  );
};

function FilterSelect({ value, options, onChange, label }: { value: string; options: string[]; onChange: (v: string) => void; label: string }) {
  return (
    <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2">
      <Filter size={14} className="text-slate-400" />
      <select value={value} onChange={(e) => onChange(e.target.value)} className="bg-transparent text-xs text-slate-700 dark:text-slate-300 outline-none">
        {options.map((o) => <option key={o} value={o}>{label}: {o}</option>)}
      </select>
    </div>
  );
}

export default AttendanceManagement;
