/**
 * Spa & Wellness Staff Management Module
 * Mirrors the Housekeeping Staff Management pattern (docs/Housekeeping Portal new.md §10)
 * adapted for spa operations:
 *   - Unified roster: therapists, stylists, estheticians, nail techs,
 *     barbers, fitness instructors, receptionists, supervisors — including
 *     the Beauty Salon stylists (moved here from the Salon module).
 *   - Sub-tabs: Roster, Attendance, Shift Requirements, Staffing,
 *     Training, Productivity.
 *   - HR-integrated: each staff member can link to an HR employee record.
 *
 * Backed by /api/spa-wellness (spa_therapists, spa_shift_requirements,
 * spa_staffing_requirements, spa_staff_training, spa_staff_productivity and
 * the shared staff_attendance table — migrations 473–476).
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useERP } from '../../../context/ERPContext';
import {
  Users,
  IdCard,
  CalendarDays,
  GraduationCap,
  Gauge,
  Plus,
  Pencil,
  Trash2,
  Search,
  CheckCircle2,
  Mail,
  Phone,
  Link2,
  Loader2,
  RefreshCw,
  CalendarCheck,
  LogIn,
  Star,
  BadgeCheck,
  type LucideIcon,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { ModalSystem } from '../../Shared/ModalSystem';
import { button, layout, statusTone, type StatusTone } from '../../FrontOffice/brandTheme';

interface TherapistManagementModuleProps {
  selectedTherapistId?: string;
  onClearSelectedTherapistId?: () => void;
}

type SubTab = 'roster' | 'attendance' | 'shifts' | 'staffing' | 'training' | 'productivity';
type Shift = 'Morning' | 'Evening' | 'Night';
type StaffRole = 'Therapist' | 'Stylist' | 'Esthetician' | 'Nail Technician' | 'Makeup Artist' | 'Barber' | 'Fitness Instructor' | 'Receptionist' | 'Supervisor';
type StaffStatus = 'Active' | 'On Leave' | 'Inactive';

const ROLES: StaffRole[] = ['Therapist', 'Stylist', 'Esthetician', 'Nail Technician', 'Makeup Artist', 'Barber', 'Fitness Instructor', 'Receptionist', 'Supervisor'];
const SHIFTS: Shift[] = ['Morning', 'Evening', 'Night'];
const WORK_AREAS = ['Spa Floor', 'Salon', 'Thermal Suite', 'Fitness Center', 'Reception'];
const STAFF_STATUSES: StaffStatus[] = ['Active', 'On Leave', 'Inactive'];
const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Contract'];
const TRAIN_STATUSES = ['Not Started', 'In Progress', 'Completed', 'Overdue'];
const ATT_STATUSES = ['Present', 'Late', 'Absent', 'On Leave', 'Sick', 'Half Day', 'Day Off', 'Public Holiday', 'Work From Home', 'Mission', 'Training Day'];

const SUB_TABS: { id: SubTab; label: string; icon: LucideIcon }[] = [
  { id: 'roster', label: 'Staff Roster', icon: IdCard },
  { id: 'attendance', label: 'Attendance', icon: CalendarCheck },
  { id: 'shifts', label: 'Shift Requirements', icon: CalendarDays },
  { id: 'staffing', label: 'Staffing', icon: Users },
  { id: 'training', label: 'Training', icon: GraduationCap },
  { id: 'productivity', label: 'Productivity', icon: Gauge },
];

const ROLE_TONE: Record<StaffRole, StatusTone> = {
  Therapist: 'accent',
  Stylist: 'info',
  Esthetician: 'info',
  'Nail Technician': 'warning',
  'Makeup Artist': 'warning',
  Barber: 'info',
  'Fitness Instructor': 'success',
  Receptionist: 'neutral',
  Supervisor: 'danger',
};

const STATUS_TONE: Record<StaffStatus, StatusTone> = {
  Active: 'success',
  'On Leave': 'warning',
  Inactive: 'neutral',
};

const TRAIN_TONE: Record<string, StatusTone> = {
  'Not Started': 'info',
  'In Progress': 'warning',
  Completed: 'success',
  Overdue: 'danger',
};

const ATT_TONE: Record<string, StatusTone> = {
  Present: 'success', Late: 'warning', Absent: 'danger',
  'On Leave': 'info', Sick: 'neutral', 'Half Day': 'info',
  'Day Off': 'neutral', 'Public Holiday': 'accent',
  'Work From Home': 'info', Mission: 'warning', 'Training Day': 'info',
};

const workloadTone = (w: number): StatusTone => (w > 80 ? 'danger' : w > 60 ? 'warning' : 'success');
const scoreTone = (s: number): StatusTone => (s >= 90 ? 'success' : s >= 75 ? 'warning' : 'danger');

// ── Helpers ───────────────────────────────────────────────────────

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

function initials(name: string): string {
  return name.split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

function fmtTime(t?: string | null): string {
  return t ? String(t).slice(0, 5) : '—';
}

const csv = (s: string) => s.split(',').map(v => v.trim()).filter(Boolean);

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

const inputCls = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-spa)]';
const inlineSelectCls = 'px-2.5 py-1 rounded-full text-xs font-medium border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-spa)]';

// ── F&B-style DataTable (same pattern as HK) ──────────────────────
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
            <tr><td colSpan={emptyColSpan} className="px-6 py-8 text-center text-slate-400">No records found.</td></tr>
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

// ── Interfaces ────────────────────────────────────────────────────
interface Staff {
  id: string;
  name: string;
  title: string;
  role: StaffRole;
  shift: Shift;
  workload: number;
  status: StaffStatus;
  employmentType: string;
  rating: number;
  specializations: string[];
  certifications: string[];
  languages: string[];
  email: string;
  phone: string;
  hireDate: string;
  employeeId: string | null;
  // live stats computed from spa_appointments
  totalAppointments: number;
  revenueGenerated: number;
  completionRate: number | null;
}

interface AvailableEmployee {
  id: string;
  name: string;
  email: string | null;
  position: string | null;
  hire_date: string | null;
}

interface ShiftReq {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  assigned_staff: number;
  required_staff: number;
}

interface StaffingReq {
  id: string;
  work_area: string | null;
  role: string;
  required_count: number;
  assigned_count: number;
  shift: string;
}

interface Training {
  id: string;
  course: string;
  employee_id: string | null;
  staff_id: string | null;
  due_date: string | null;
  status: string;
}

interface ProductivityRow {
  id: string;
  employee_id: string | null;
  staff_id: string | null;
  treatments_completed: number;
  hours: number;
  guest_satisfaction: number;
  productivity_score: number;
  period_date: string | null;
}

interface AttendanceRecord {
  id: string;
  staffId: string;
  staffName: string;
  employeeId: string | null;
  attendanceDate: string;
  shift: string;
  checkIn: string | null;
  checkOut: string | null;
  status: string;
  hoursWorked: number;
  overtimeHours: number;
  notes: string | null;
}

interface StaffAttendanceSummary {
  staffId: string;
  staffName: string;
  employeeId: string | null;
  records: AttendanceRecord[];
  present: number; late: number; absent: number; onLeave: number; sick: number; halfDay: number;
  dayOff: number; publicHoliday: number; workFromHome: number; mission: number; trainingDay: number;
  totalHours: number; totalOvertime: number; totalDays: number;
  attendanceRate: number;
}

const emptyStaffForm = {
  name: '', title: '', role: 'Therapist' as StaffRole, shift: 'Morning' as Shift,
  status: 'Active' as StaffStatus, employmentType: 'Full-time',
  rating: 4.5, workload: 0,
  specializations: '', certifications: '', languages: '',
  email: '', phone: '', hireDate: '',
  linkMode: 'new' as 'new' | 'existing' | 'none',
  employeeId: '',
};

const TherapistManagementModule: React.FC<TherapistManagementModuleProps> = ({
  selectedTherapistId,
  onClearSelectedTherapistId
}) => {
  const { currentPropertyId, addNotification } = useERP();

  const [subTab, setSubTab] = useState<SubTab>('roster');
  const [search, setSearch] = useState('');

  // Roster
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [shiftFilter, setShiftFilter] = useState<'All' | Shift>('All');
  const [roleFilter, setRoleFilter] = useState<'All' | StaffRole>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | StaffStatus>('All');

  const [showForm, setShowForm] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Staff | null>(null);
  const [form, setForm] = useState({ ...emptyStaffForm });

  // HR link
  const [availableEmployees, setAvailableEmployees] = useState<AvailableEmployee[]>([]);
  const [linkTarget, setLinkTarget] = useState<Staff | null>(null);
  const [linkEmployeeId, setLinkEmployeeId] = useState('');

  // Ops tables
  const [shifts, setShifts] = useState<ShiftReq[]>([]);
  const [loadingShifts, setLoadingShifts] = useState(true);
  const [staffing, setStaffing] = useState<StaffingReq[]>([]);
  const [loadingStaffing, setLoadingStaffing] = useState(true);
  const [training, setTraining] = useState<Training[]>([]);
  const [loadingTraining, setLoadingTraining] = useState(true);
  const [productivity, setProductivity] = useState<ProductivityRow[]>([]);
  const [loadingProductivity, setLoadingProductivity] = useState(true);

  // Attendance
  const [attSummary, setAttSummary] = useState<StaffAttendanceSummary[]>([]);
  const [loadingAttendance, setLoadingAttendance] = useState(true);
  const [attStatusFilter, setAttStatusFilter] = useState<'All' | string>('All');
  const [showAttModal, setShowAttModal] = useState(false);
  const [attEditing, setAttEditing] = useState<AttendanceRecord | null>(null);
  const [attForm, setAttForm] = useState({
    staffId: '', staffName: '', shift: 'Morning' as Shift, status: 'Present',
    checkIn: '', checkOut: '', hoursWorked: 0, overtimeHours: 0, notes: '',
  });
  const [calendarStaff, setCalendarStaff] = useState<StaffAttendanceSummary | null>(null);

  // Generic ops modal
  const [saving, setSaving] = useState(false);
  const [opsModal, setOpsModal] = useState<{ kind: 'shifts' | 'staffing' | 'training' | 'productivity'; row: any | null } | null>(null);
  const [opsForm, setOpsForm] = useState<Record<string, any>>({});

  // ── Fetchers ──────────────────────────────────────────────────────

  const fetchStaff = useCallback(async () => {
    setLoadingStaff(true); setError(null);
    try {
      const params = new URLSearchParams({ withStats: 'true' });
      if (currentPropertyId) params.append('propertyId', currentPropertyId);
      if (statusFilter !== 'All') params.append('status', statusFilter);
      if (roleFilter !== 'All') params.append('role', roleFilter);
      if (shiftFilter !== 'All') params.append('shift', shiftFilter);
      const res = await fetch(`/api/spa-wellness/therapists?${params}`, { headers: authHeaders(), credentials: 'include' });
      if (!res.ok) throw new Error(`Failed to load staff (${res.status})`);
      const data = await res.json();
      setStaff((data || []).map((r: any) => ({
        id: r.id,
        name: r.name,
        title: r.title || '',
        role: r.role || 'Therapist',
        shift: r.shift || 'Morning',
        workload: r.workload ?? 0,
        status: r.status || 'Active',
        employmentType: r.employment_type || 'Full-time',
        rating: Number(r.rating) || 0,
        specializations: r.specialties || [],
        certifications: r.certifications || [],
        languages: r.languages || [],
        email: r.email || '',
        phone: r.phone || '',
        hireDate: r.hire_date || '',
        employeeId: r.employee_id || null,
        totalAppointments: r.appointments_count ?? 0,
        revenueGenerated: Number(r.revenue_generated) || 0,
        completionRate: r.completion_rate ?? null,
      })));
    } catch (e: any) {
      setError(e?.message || 'Failed to load staff');
    } finally {
      setLoadingStaff(false);
    }
  }, [currentPropertyId, statusFilter, roleFilter, shiftFilter]);

  const fetchAvailableEmployees = useCallback(async () => {
    try {
      const res = await fetch('/api/spa-wellness/staff/available-employees', { headers: authHeaders(), credentials: 'include' });
      if (res.ok) setAvailableEmployees(((await res.json()).employees) || []);
    } catch { /* non-fatal */ }
  }, []);

  const fetchOps = useCallback(async (kind: 'shifts' | 'staffing' | 'training' | 'productivity') => {
    const setLoading = { shifts: setLoadingShifts, staffing: setLoadingStaffing, training: setLoadingTraining, productivity: setLoadingProductivity }[kind];
    const setData = { shifts: setShifts, staffing: setStaffing, training: setTraining, productivity: setProductivity }[kind];
    setLoading(true);
    try {
      const prop = currentPropertyId ? `?propertyId=${currentPropertyId}` : '';
      const res = await fetch(`/api/spa-wellness/staff/${kind}${prop}`, { headers: authHeaders(), credentials: 'include' });
      if (res.ok) setData(await res.json());
    } catch { /* non-fatal */ }
    finally { setLoading(false); }
  }, [currentPropertyId]);

  const fetchAttendance = useCallback(async () => {
    setLoadingAttendance(true);
    try {
      const prop = currentPropertyId ? `?propertyId=${currentPropertyId}` : '';
      const res = await fetch(`/api/spa-wellness/attendance/summary${prop}`, { headers: authHeaders(), credentials: 'include' });
      if (res.ok) setAttSummary(((await res.json()).summary) || []);
    } catch { /* non-fatal */ }
    finally { setLoadingAttendance(false); }
  }, [currentPropertyId]);

  // Load data for active sub-tab
  useEffect(() => {
    if (subTab === 'roster') fetchStaff();
    if (subTab === 'attendance') fetchAttendance();
    if (subTab === 'shifts') fetchOps('shifts');
    if (subTab === 'staffing') fetchOps('staffing');
    if (subTab === 'training') fetchOps('training');
    if (subTab === 'productivity') fetchOps('productivity');
  }, [subTab, fetchStaff, fetchAttendance, fetchOps]);

  // Deep-link: jump to roster and open edit for the selected staff member.
  useEffect(() => {
    if (!selectedTherapistId) return;
    setSubTab('roster');
    const existing = staff.find(s => s.id === selectedTherapistId);
    if (existing) {
      openEditStaff(existing);
      onClearSelectedTherapistId?.();
    }
  }, [selectedTherapistId, staff]);

  // ── Stats ─────────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    total: staff.length,
    active: staff.filter(s => s.status === 'Active').length,
    onLeave: staff.filter(s => s.status === 'On Leave').length,
    avgRating: staff.length ? (staff.reduce((s, x) => s + x.rating, 0) / staff.length).toFixed(1) : '—',
    understaffed: staffing.filter(s => s.assigned_count < s.required_count).length,
    overdueTraining: training.filter(t => t.status === 'Overdue').length,
    attPresent: attSummary.reduce((s, a) => s + a.present, 0),
    attLate: attSummary.reduce((s, a) => s + a.late, 0),
  }), [staff, staffing, training, attSummary]);

  // ── Filters ───────────────────────────────────────────────────────

  const filteredStaff = useMemo(() => {
    const q = search.toLowerCase();
    return staff.filter(s => !q ||
      s.name.toLowerCase().includes(q) ||
      s.title.toLowerCase().includes(q) ||
      s.role.toLowerCase().includes(q) ||
      s.specializations.some(x => x.toLowerCase().includes(q)));
  }, [staff, search]);

  const filteredAttSummary = useMemo(() => {
    const q = search.toLowerCase();
    return attSummary.filter(a => {
      const matchesStatus = attStatusFilter === 'All' ||
        (attStatusFilter === 'Present' && a.present > 0) ||
        (attStatusFilter === 'Late' && a.late > 0) ||
        (attStatusFilter === 'Absent' && a.absent > 0) ||
        (attStatusFilter === 'On Leave' && a.onLeave > 0) ||
        (attStatusFilter === 'Day Off' && a.dayOff > 0);
      return matchesStatus && (!q || a.staffName.toLowerCase().includes(q));
    });
  }, [attSummary, attStatusFilter, search]);

  const searchFilter = useCallback((rows: any[], fields: string[]) => {
    const q = search.toLowerCase();
    return rows.filter(r => !q || fields.some(f => String(r[f] ?? '').toLowerCase().includes(q)));
  }, [search]);

  // ── Staff CRUD ────────────────────────────────────────────────────

  const reassign = async (id: string, field: 'role' | 'shift' | 'status' | 'workload', value: string | number) => {
    setActingOn(id);
    try {
      const res = await fetch(`/api/spa-wellness/therapists/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: authHeaders(true), credentials: 'include',
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) throw new Error(`Update failed (${res.status})`);
      const updated = await res.json();
      setStaff(prev => prev.map(s => s.id === id ? { ...s, [field]: updated[field] ?? value } : s));
      addNotification(`Staff ${id} updated (${field})`, 'info', 'Spa');
    } catch (e: any) {
      addNotification(e?.message || 'Update failed', 'warning', 'Spa');
    } finally {
      setActingOn(null);
    }
  };

  function openEditStaff(s: Staff) {
    setEditingStaff(s);
    setForm({
      name: s.name, title: s.title, role: s.role, shift: s.shift,
      status: s.status, employmentType: s.employmentType,
      rating: s.rating, workload: s.workload,
      specializations: s.specializations.join(', '),
      certifications: s.certifications.join(', '),
      languages: s.languages.join(', '),
      email: s.email, phone: s.phone, hireDate: s.hireDate,
      linkMode: s.employeeId ? 'existing' : 'new',
      employeeId: s.employeeId || '',
    });
    setShowForm(true);
    fetchAvailableEmployees();
  }

  const saveStaff = async () => {
    if (!form.name.trim()) {
      addNotification('Name is required', 'warning', 'Spa');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        name: form.name, title: form.title || null, role: form.role, shift: form.shift,
        status: form.status, employment_type: form.employmentType,
        rating: form.rating, workload: form.workload,
        specialties: csv(form.specializations),
        certifications: csv(form.certifications),
        languages: csv(form.languages),
        email: form.email || null, phone: form.phone || null,
        hire_date: form.hireDate || null,
      };
      if (form.linkMode === 'existing' && form.employeeId) payload.employee_id = form.employeeId;

      const res = editingStaff
        ? await fetch(`/api/spa-wellness/therapists/${encodeURIComponent(editingStaff.id)}`, {
            method: 'PATCH', headers: authHeaders(true), credentials: 'include',
            body: JSON.stringify(payload),
          })
        : await fetch('/api/spa-wellness/therapists', {
            method: 'POST', headers: authHeaders(true), credentials: 'include',
            body: JSON.stringify({ ...payload, property_id: currentPropertyId }),
          });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Save failed (${res.status})`);
      }
      addNotification(editingStaff ? `${form.name} updated` : `${form.name} added`, 'success', 'Spa');
      setShowForm(false);
      setEditingStaff(null);
      setForm({ ...emptyStaffForm });
      fetchStaff();
    } catch (e: any) {
      addNotification(e?.message || 'Save failed', 'warning', 'Spa');
    } finally {
      setSaving(false);
    }
  };

  const linkEmployee = async () => {
    if (!linkTarget || !linkEmployeeId) return;
    setActingOn(linkTarget.id);
    try {
      const res = await fetch(`/api/spa-wellness/therapists/${encodeURIComponent(linkTarget.id)}`, {
        method: 'PATCH', headers: authHeaders(true), credentials: 'include',
        body: JSON.stringify({ employee_id: linkEmployeeId }),
      });
      if (!res.ok) throw new Error(`Link failed (${res.status})`);
      setStaff(prev => prev.map(s => s.id === linkTarget.id ? { ...s, employeeId: linkEmployeeId } : s));
      addNotification(`${linkTarget.name} linked to HR employee`, 'success', 'Spa');
      setLinkTarget(null); setLinkEmployeeId('');
    } catch (e: any) {
      addNotification(e?.message || 'Link failed', 'warning', 'Spa');
    } finally {
      setActingOn(null);
    }
  };

  const openLinkModal = async (s: Staff) => {
    setLinkTarget(s); setLinkEmployeeId('');
    await fetchAvailableEmployees();
  };

  const deleteStaff = async (s: Staff) => {
    setActingOn(s.id);
    try {
      const res = await fetch(`/api/spa-wellness/therapists/${encodeURIComponent(s.id)}`, {
        method: 'DELETE', headers: authHeaders(), credentials: 'include',
      });
      if (!res.ok) throw new Error(`Remove failed (${res.status})`);
      setStaff(prev => prev.filter(x => x.id !== s.id));
      addNotification(`${s.name} removed`, 'info', 'Spa');
      setDeleteTarget(null);
    } catch (e: any) {
      addNotification(e?.message || 'Delete failed', 'warning', 'Spa');
    } finally {
      setActingOn(null);
    }
  };

  // ── Attendance CRUD ───────────────────────────────────────────────

  const saveAttendance = async () => {
    if (!currentPropertyId || !attForm.staffId || !attForm.staffName) {
      addNotification('Staff member is required', 'warning', 'Spa');
      return;
    }
    setSaving(true);
    try {
      if (attEditing) {
        const res = await fetch(`/api/spa-wellness/attendance/${attEditing.id}`, {
          method: 'PUT', headers: authHeaders(true), credentials: 'include',
          body: JSON.stringify({
            status: attForm.status, shift: attForm.shift,
            checkIn: attForm.checkIn || null, checkOut: attForm.checkOut || null,
            hoursWorked: attForm.hoursWorked, overtimeHours: attForm.overtimeHours,
            notes: attForm.notes || null,
          }),
        });
        if (!res.ok) throw new Error('Failed to update attendance');
        addNotification(`${attForm.staffName} attendance updated`, 'success', 'Spa');
      } else {
        const res = await fetch('/api/spa-wellness/attendance', {
          method: 'POST', headers: authHeaders(true), credentials: 'include',
          body: JSON.stringify({
            propertyId: currentPropertyId, staffId: attForm.staffId, staffName: attForm.staffName,
            shift: attForm.shift, status: attForm.status,
            checkIn: attForm.checkIn || null, notes: attForm.notes || null,
          }),
        });
        if (!res.ok) throw new Error('Failed to check in');
        addNotification(`${attForm.staffName} checked in`, 'success', 'Spa');
      }
      setShowAttModal(false); setAttEditing(null);
      setAttForm({ staffId: '', staffName: '', shift: 'Morning', status: 'Present', checkIn: '', checkOut: '', hoursWorked: 0, overtimeHours: 0, notes: '' });
      fetchAttendance();
    } catch (e: any) {
      addNotification(e?.message || 'Attendance save failed', 'warning', 'Spa');
    } finally { setSaving(false); }
  };

  const quickCheckOut = async (rec: AttendanceRecord) => {
    const now = new Date().toISOString();
    const checkInTime = rec.checkIn ? new Date(rec.checkIn) : null;
    const hours = checkInTime ? Math.max(0, (Date.now() - checkInTime.getTime()) / 3600000) : 8;
    try {
      const res = await fetch(`/api/spa-wellness/attendance/${rec.id}`, {
        method: 'PUT', headers: authHeaders(true), credentials: 'include',
        body: JSON.stringify({ checkOut: now, hoursWorked: Number(hours.toFixed(2)) }),
      });
      if (!res.ok) throw new Error('Failed to check out');
      addNotification(`${rec.staffName} checked out`, 'success', 'Spa');
      fetchAttendance();
    } catch (e: any) {
      addNotification(e?.message || 'Check-out failed', 'warning', 'Spa');
    }
  };

  // ── Generic ops CRUD ──────────────────────────────────────────────

  const openOpsModal = (kind: 'shifts' | 'staffing' | 'training' | 'productivity', row: any | null) => {
    setOpsModal({ kind, row });
    setOpsForm(row ? { ...row } : {});
  };

  const saveOps = async () => {
    if (!opsModal) return;
    const { kind, row } = opsModal;
    setSaving(true);
    try {
      const res = await fetch(`/api/spa-wellness/staff/${kind}${row ? `/${row.id}` : ''}`, {
        method: row ? 'PUT' : 'POST',
        headers: authHeaders(true), credentials: 'include',
        body: JSON.stringify({ ...opsForm, property_id: currentPropertyId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Save failed (${res.status})`);
      }
      addNotification(`${kind} ${row ? 'updated' : 'created'}`, 'success', 'Spa');
      setOpsModal(null);
      fetchOps(kind);
    } catch (e: any) {
      addNotification(e?.message || 'Save failed', 'warning', 'Spa');
    } finally {
      setSaving(false);
    }
  };

  const deleteOps = async (kind: 'shifts' | 'staffing' | 'training' | 'productivity', id: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/spa-wellness/staff/${kind}/${id}`, {
        method: 'DELETE', headers: authHeaders(), credentials: 'include',
      });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      addNotification(`${kind} deleted`, 'info', 'Spa');
      if (kind === 'shifts') setShifts(a => a.filter(x => x.id !== id));
      if (kind === 'staffing') setStaffing(a => a.filter(x => x.id !== id));
      if (kind === 'training') setTraining(a => a.filter(x => x.id !== id));
      if (kind === 'productivity') setProductivity(a => a.filter(x => x.id !== id));
    } catch (e: any) {
      addNotification(e?.message || 'Delete failed', 'warning', 'Spa');
    } finally {
      setSaving(false);
    }
  };

  const markTrainingComplete = async (t: Training) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/spa-wellness/staff/training/${t.id}`, {
        method: 'PUT', headers: authHeaders(true), credentials: 'include',
        body: JSON.stringify({ status: 'Completed' }),
      });
      if (!res.ok) throw new Error('Update failed');
      addNotification(`${t.course} marked complete`, 'success', 'Spa');
      fetchOps('training');
    } catch (e: any) {
      addNotification(e?.message || 'Update failed', 'warning', 'Spa');
    } finally {
      setSaving(false);
    }
  };

  const staffName = (id: string | null) => staff.find(s => s.id === id)?.name || attSummary.find(a => a.staffId === id)?.staffName || '—';

  // ── Table row builders ────────────────────────────────────────────

  const rosterRows = useMemo(() => filteredStaff.map(s => [
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-full bg-[var(--color-accent-spa)]/15 flex items-center justify-center text-[11px] font-black text-[var(--color-accent-spa)] border border-[var(--color-accent-spa)]/30 shrink-0">
        {initials(s.name)}
      </div>
      <div className="min-w-0">
        <div className="font-bold text-slate-900 dark:text-white truncate">{s.name}</div>
        <div className="text-[10px] text-slate-400 font-mono">{s.id}{s.title ? ` · ${s.title}` : ''}</div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <Badge tone={ROLE_TONE[s.role] || 'neutral'}>{s.role}</Badge>
          {s.employeeId ? <Badge tone="success" icon={Link2}>HR</Badge> : (
            <button onClick={() => openLinkModal(s)} className="text-[8px] font-bold text-[var(--color-accent-spa)] hover:underline uppercase">Link HR</button>
          )}
        </div>
      </div>
    </div>,
    <select value={s.shift} onChange={e => reassign(s.id, 'shift', e.target.value)} disabled={actingOn === s.id} className={`${inlineSelectCls} ${statusTone.info.soft}`}>
      {SHIFTS.map(sh => <option key={sh} value={sh}>{sh}</option>)}
    </select>,
    <select value={s.role} onChange={e => reassign(s.id, 'role', e.target.value)} disabled={actingOn === s.id} className={`${inlineSelectCls} ${statusTone.accent.soft}`}>
      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
    </select>,
    <div className="w-24">
      <div className="flex items-center justify-between text-[9px] font-mono mb-1">
        <span className="font-black text-slate-700 dark:text-slate-200">{s.workload}%</span>
      </div>
      <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full ${statusTone[workloadTone(s.workload)].dot}`} style={{ width: `${Math.min(100, s.workload)}%` }} />
      </div>
    </div>,
    <div className="flex items-center gap-1">
      <Star size={13} className="text-[var(--color-warning)]" fill="currentColor" />
      <span className="font-semibold text-slate-900 dark:text-white">{s.rating}</span>
    </div>,
    <div className="space-y-0.5">
      <span className="font-bold text-slate-900 dark:text-white">{s.totalAppointments}</span>
      <div className="text-[9px] text-slate-400">appts · ${s.revenueGenerated.toLocaleString()}</div>
    </div>,
    <select value={s.status} onChange={e => reassign(s.id, 'status', e.target.value)} disabled={actingOn === s.id} className={`${inlineSelectCls} ${statusTone[STATUS_TONE[s.status]].soft}`}>
      {STAFF_STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
    </select>,
    <div className="space-y-0.5 max-w-[160px]">
      {s.email && <div className="flex items-center gap-1 text-[10px] truncate"><Mail size={10} className="text-slate-400 shrink-0" />{s.email}</div>}
      {s.phone && <div className="flex items-center gap-1 text-[10px]"><Phone size={10} className="text-slate-400 shrink-0" />{s.phone}</div>}
      {!s.email && !s.phone && <span className="text-xs text-slate-400">—</span>}
    </div>,
    <div className="inline-flex gap-1.5">
      <button onClick={() => openLinkModal(s)} disabled={actingOn === s.id} className="p-1 text-slate-400 hover:text-[var(--color-accent-spa)]" title="Link HR"><Link2 className="w-4 h-4" /></button>
      <button onClick={() => openEditStaff(s)} disabled={actingOn === s.id} className="p-1 text-slate-400 hover:text-[var(--color-accent-spa)]" title="Edit"><Pencil className="w-4 h-4" /></button>
      <button onClick={() => setDeleteTarget(s)} disabled={actingOn === s.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Remove">
        {actingOn === s.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 className="w-4 h-4" />}
      </button>
    </div>,
  ]), [filteredStaff, actingOn]);

  const attendanceRows = useMemo(() => filteredAttSummary.map(a => [
    <button onClick={() => setCalendarStaff(a)} className="flex items-center gap-3 group text-left">
      <div className="w-9 h-9 rounded-full bg-[var(--color-accent-spa)]/15 flex items-center justify-center text-[11px] font-black text-[var(--color-accent-spa)] border border-[var(--color-accent-spa)]/30 shrink-0">
        {initials(a.staffName)}
      </div>
      <div>
        <div className="font-bold text-slate-900 dark:text-white group-hover:text-[var(--color-accent-spa)] transition">{a.staffName}</div>
        <div className="text-[10px] text-slate-400 font-mono">{a.staffId}</div>
        {a.employeeId && <Badge tone="success" icon={Link2}>HR</Badge>}
      </div>
    </button>,
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${a.attendanceRate >= 80 ? 'bg-emerald-500' : a.attendanceRate >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${a.attendanceRate}%` }} />
      </div>
      <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{a.attendanceRate}%</span>
    </div>,
    <div className="flex flex-wrap gap-1.5">
      {a.present > 0 && <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold ${statusTone.success.text}`}><span className={`w-2 h-2 rounded-full ${statusTone.success.dot}`} />{a.present}</span>}
      {a.late > 0 && <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold ${statusTone.warning.text}`}><span className={`w-2 h-2 rounded-full ${statusTone.warning.dot}`} />{a.late}</span>}
      {a.absent > 0 && <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold ${statusTone.danger.text}`}><span className={`w-2 h-2 rounded-full ${statusTone.danger.dot}`} />{a.absent}</span>}
      {a.onLeave > 0 && <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold ${statusTone.info.text}`}><span className={`w-2 h-2 rounded-full ${statusTone.info.dot}`} />{a.onLeave}</span>}
      {a.dayOff > 0 && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-slate-400"><span className="w-2 h-2 rounded-full bg-slate-300" />{a.dayOff}</span>}
    </div>,
    <span className="font-bold text-slate-900 dark:text-white">{a.totalHours.toFixed(1)}h</span>,
    <span className="font-bold text-amber-600 dark:text-amber-400">{a.totalOvertime > 0 ? `${a.totalOvertime.toFixed(1)}h` : '—'}</span>,
    <div className="inline-flex gap-2">
      <button onClick={() => setCalendarStaff(a)} className="p-1 text-slate-400 hover:text-[var(--color-accent-spa)]" title="View records"><CalendarCheck className="w-4 h-4" /></button>
      <button onClick={() => { setAttEditing(null); setAttForm({ staffId: a.staffId, staffName: a.staffName, shift: 'Morning', status: 'Present', checkIn: '', checkOut: '', hoursWorked: 0, overtimeHours: 0, notes: '' }); setShowAttModal(true); }} className="p-1 text-slate-400 hover:text-[var(--color-accent-spa)]" title="Check in"><LogIn className="w-4 h-4" /></button>
    </div>,
  ]), [filteredAttSummary]);

  const shiftRows = useMemo(() => searchFilter(shifts, ['name']).map(s => {
    const pct = s.required_staff > 0 ? Math.round((s.assigned_staff / s.required_staff) * 100) : 0;
    return [
      <span className="font-medium text-slate-900 dark:text-white">{s.name}</span>,
      <span>{fmtTime(s.start_time)}</span>,
      <span>{fmtTime(s.end_time)}</span>,
      <span>{s.assigned_staff}</span>,
      <span>{s.required_staff}</span>,
      <div className="w-28">
        <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
          <div className={`h-full ${statusTone[pct >= 100 ? 'success' : pct >= 60 ? 'warning' : 'danger'].dot}`} style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <span className="text-[9px] font-mono text-slate-500">{pct}% covered</span>
      </div>,
      <div className="inline-flex gap-1.5">
        <button onClick={() => openOpsModal('shifts', s)} className="p-1 text-slate-400 hover:text-[var(--color-accent-spa)]"><Pencil className="w-4 h-4" /></button>
        <button onClick={() => deleteOps('shifts', s.id)} className="p-1 text-slate-400 hover:text-[var(--color-danger)]"><Trash2 className="w-4 h-4" /></button>
      </div>,
    ];
  }), [shifts, searchFilter]);

  const staffingRows = useMemo(() => searchFilter(staffing, ['role', 'work_area']).map(s => {
    const short = s.assigned_count < s.required_count;
    return [
      <span className="font-medium text-slate-900 dark:text-white">{s.work_area || 'All areas'}</span>,
      <Badge tone={ROLE_TONE[s.role as StaffRole] || 'neutral'}>{s.role}</Badge>,
      <Badge tone="info">{s.shift}</Badge>,
      <span>{s.required_count}</span>,
      <span className={short ? 'font-bold text-rose-500' : 'font-bold text-emerald-600'}>{s.assigned_count}</span>,
      short ? <Badge tone="danger">Understaffed</Badge> : <Badge tone="success">Covered</Badge>,
      <div className="inline-flex gap-1.5">
        <button onClick={() => openOpsModal('staffing', s)} className="p-1 text-slate-400 hover:text-[var(--color-accent-spa)]"><Pencil className="w-4 h-4" /></button>
        <button onClick={() => deleteOps('staffing', s.id)} className="p-1 text-slate-400 hover:text-[var(--color-danger)]"><Trash2 className="w-4 h-4" /></button>
      </div>,
    ];
  }), [staffing, searchFilter]);

  const trainingRows = useMemo(() => searchFilter(training, ['course']).map(t => [
    <span className="font-medium text-slate-900 dark:text-white">{t.course}</span>,
    <span>{staffName(t.staff_id)}</span>,
    <span>{t.due_date ? new Date(t.due_date).toLocaleDateString() : '—'}</span>,
    <Badge tone={TRAIN_TONE[t.status] || 'neutral'}>{t.status}</Badge>,
    <div className="inline-flex gap-1.5">
      {t.status !== 'Completed' && (
        <button onClick={() => markTrainingComplete(t)} className="p-1 text-slate-400 hover:text-[var(--color-success)]" title="Mark complete"><CheckCircle2 className="w-4 h-4" /></button>
      )}
      <button onClick={() => openOpsModal('training', t)} className="p-1 text-slate-400 hover:text-[var(--color-accent-spa)]"><Pencil className="w-4 h-4" /></button>
      <button onClick={() => deleteOps('training', t.id)} className="p-1 text-slate-400 hover:text-[var(--color-danger)]"><Trash2 className="w-4 h-4" /></button>
    </div>,
  ]), [training, searchFilter, staff]);

  const productivityRows = useMemo(() => searchFilter(productivity, ['staff_id']).map(p => [
    <span className="font-medium text-slate-900 dark:text-white">{staffName(p.staff_id)}</span>,
    <span>{p.period_date ? new Date(p.period_date).toLocaleDateString() : '—'}</span>,
    <span className="font-bold text-emerald-600 dark:text-emerald-400">{p.treatments_completed}</span>,
    <span>{Number(p.hours).toFixed(1)}h</span>,
    <span>{p.guest_satisfaction ? `${p.guest_satisfaction}%` : '—'}</span>,
    <Badge tone={scoreTone(Number(p.productivity_score))}>{Number(p.productivity_score).toFixed(1)}</Badge>,
    <div className="inline-flex gap-1.5">
      <button onClick={() => openOpsModal('productivity', p)} className="p-1 text-slate-400 hover:text-[var(--color-accent-spa)]"><Pencil className="w-4 h-4" /></button>
      <button onClick={() => deleteOps('productivity', p.id)} className="p-1 text-slate-400 hover:text-[var(--color-danger)]"><Trash2 className="w-4 h-4" /></button>
    </div>,
  ]), [productivity, searchFilter, staff]);

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Staff Management"
        subtitle="Roster, attendance, shifts, staffing, training and productivity for all spa & salon staff"
        icon={Users}
        actions={
          <button
            onClick={() => {
              if (subTab === 'roster') fetchStaff();
              else if (subTab === 'attendance') fetchAttendance();
              else fetchOps(subTab as 'shifts' | 'staffing' | 'training' | 'productivity');
            }}
            className={button.secondary}
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        }
      />

      {/* KPI strip */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Staff" value={stats.total} icon={Users} tone="accent" />
        <StatCard title="Active / On Leave" value={`${stats.active} / ${stats.onLeave}`} icon={BadgeCheck} tone="success" />
        <StatCard title="Understaffed Areas" value={stats.understaffed} icon={Gauge} tone={stats.understaffed ? 'warning' : 'success'} />
        <StatCard title="Overdue Training" value={stats.overdueTraining} icon={GraduationCap} tone={stats.overdueTraining ? 'danger' : 'success'} />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
          {error}
        </div>
      )}

      {/* Sub-tab bar */}
      <SectionCard pad="md">
        <div className="flex flex-wrap items-center gap-2">
          {SUB_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className={
                subTab === t.id
                  ? 'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold bg-[var(--color-accent-spa)] text-white transition'
                  : 'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition'
              }
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={inputCls + ' pl-9'}
            />
          </div>
          {subTab === 'roster' && (
            <>
              <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as any)} className={inputCls + ' w-auto'}>
                <option value="All">All Roles</option>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <select value={shiftFilter} onChange={(e) => setShiftFilter(e.target.value as any)} className={inputCls + ' w-auto'}>
                <option value="All">All Shifts</option>
                {SHIFTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className={inputCls + ' w-auto'}>
                <option value="All">All Status</option>
                {STAFF_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <button
                onClick={() => { setEditingStaff(null); setForm({ ...emptyStaffForm }); setShowForm(true); fetchAvailableEmployees(); }}
                className={button.primary}
              >
                <Plus className="w-4 h-4" /> Add Staff
              </button>
            </>
          )}
          {subTab === 'attendance' && (
            <select value={attStatusFilter} onChange={(e) => setAttStatusFilter(e.target.value)} className={inputCls + ' w-auto'}>
              <option value="All">All Status</option>
              {['Present', 'Late', 'Absent', 'On Leave', 'Day Off'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          {subTab !== 'roster' && subTab !== 'attendance' && (
            <button onClick={() => openOpsModal(subTab as any, null)} className={button.primary}>
              <Plus className="w-4 h-4" /> Add
            </button>
          )}
        </div>
      </SectionCard>

      {/* Roster */}
      {subTab === 'roster' && (
        <SectionCard title="Staff Roster" subtitle={`${filteredStaff.length} of ${staff.length} staff`} icon={IdCard} tone="accent" pad="none">
          {loadingStaff ? <LoadingRow /> : (
            <DataTable
              headers={['Staff', 'Shift', 'Role', 'Workload', 'Rating', 'Activity', 'Status', 'Contact', 'Actions']}
              rows={rosterRows}
              empty={filteredStaff.length === 0}
              emptyColSpan={9}
            />
          )}
        </SectionCard>
      )}

      {/* Attendance */}
      {subTab === 'attendance' && (
        <SectionCard title="Attendance" subtitle="Daily check-in / check-out summary per staff member" icon={CalendarCheck} tone="accent" pad="none">
          {loadingAttendance ? <LoadingRow /> : (
            <DataTable
              headers={['Staff', 'Rate', 'Status Counts', 'Hours', 'Overtime', 'Actions']}
              rows={attendanceRows}
              empty={filteredAttSummary.length === 0}
              emptyColSpan={6}
            />
          )}
        </SectionCard>
      )}

      {/* Shift requirements */}
      {subTab === 'shifts' && (
        <SectionCard title="Shift Requirements" subtitle="Named shift windows vs. required coverage" icon={CalendarDays} tone="accent" pad="none">
          {loadingShifts ? <LoadingRow /> : (
            <DataTable
              headers={['Shift', 'Start', 'End', 'Assigned', 'Required', 'Coverage', 'Actions']}
              rows={shiftRows}
              empty={shifts.length === 0}
              emptyColSpan={7}
            />
          )}
        </SectionCard>
      )}

      {/* Staffing requirements */}
      {subTab === 'staffing' && (
        <SectionCard title="Staffing Requirements" subtitle="Per work-area, per-role headcount requirements" icon={Users} tone="accent" pad="none">
          {loadingStaffing ? <LoadingRow /> : (
            <DataTable
              headers={['Work Area', 'Role', 'Shift', 'Required', 'Assigned', 'Status', 'Actions']}
              rows={staffingRows}
              empty={staffing.length === 0}
              emptyColSpan={7}
            />
          )}
        </SectionCard>
      )}

      {/* Training */}
      {subTab === 'training' && (
        <SectionCard title="Training" subtitle="Course assignments and completion tracking" icon={GraduationCap} tone="accent" pad="none">
          {loadingTraining ? <LoadingRow /> : (
            <DataTable
              headers={['Course', 'Staff', 'Due Date', 'Status', 'Actions']}
              rows={trainingRows}
              empty={training.length === 0}
              emptyColSpan={5}
            />
          )}
        </SectionCard>
      )}

      {/* Productivity */}
      {subTab === 'productivity' && (
        <SectionCard title="Productivity" subtitle="Treatments completed, hours and guest satisfaction per period" icon={Gauge} tone="accent" pad="none">
          {loadingProductivity ? <LoadingRow /> : (
            <DataTable
              headers={['Staff', 'Period', 'Treatments', 'Hours', 'Satisfaction', 'Score', 'Actions']}
              rows={productivityRows}
              empty={productivity.length === 0}
              emptyColSpan={7}
            />
          )}
        </SectionCard>
      )}

      {/* ── Add / Edit Staff modal ── */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditingStaff(null); setForm({ ...emptyStaffForm }); }}
        onConfirm={saveStaff}
        title={editingStaff ? `Edit ${editingStaff.name}` : 'Add Staff Member'}
        subtitle={editingStaff ? editingStaff.id : 'Creates roster entry; optionally links or creates an HR employee'}
        variant="form"
        size="lg"
        loading={saving}
        confirmLabel={editingStaff ? 'Save Changes' : 'Add Staff'}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Full Name *">
            <input className={inputCls} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Emily Chen" />
          </Field>
          <Field label="Job Title">
            <input className={inputCls} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Senior Massage Therapist" />
          </Field>
          <Field label="Role">
            <select className={inputCls} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as StaffRole }))}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Shift">
            <select className={inputCls} value={form.shift} onChange={e => setForm(f => ({ ...f, shift: e.target.value as Shift }))}>
              {SHIFTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className={inputCls} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as StaffStatus }))}>
              {STAFF_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Employment Type">
            <select className={inputCls} value={form.employmentType} onChange={e => setForm(f => ({ ...f, employmentType: e.target.value }))}>
              {EMPLOYMENT_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Email">
            <input className={inputCls} type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </Field>
          <Field label="Phone">
            <input className={inputCls} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
          </Field>
          <Field label="Hire Date">
            <input className={inputCls} type="date" value={form.hireDate} onChange={e => setForm(f => ({ ...f, hireDate: e.target.value }))} />
          </Field>
          <Field label="Rating (0–5)">
            <input className={inputCls} type="number" min={0} max={5} step={0.1} value={form.rating} onChange={e => setForm(f => ({ ...f, rating: Number(e.target.value) }))} />
          </Field>
          <Field label="Workload %">
            <input className={inputCls} type="number" min={0} max={100} value={form.workload} onChange={e => setForm(f => ({ ...f, workload: Number(e.target.value) }))} />
          </Field>
          <Field label="HR Employee Link">
            <select className={inputCls} value={form.linkMode} onChange={e => setForm(f => ({ ...f, linkMode: e.target.value as any }))}>
              <option value="new">Create HR record from contact info</option>
              <option value="existing">Link existing HR employee</option>
              <option value="none">No HR link</option>
            </select>
          </Field>
          {form.linkMode === 'existing' && (
            <Field label="HR Employee">
              <select className={inputCls} value={form.employeeId} onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))}>
                <option value="">Select employee…</option>
                {availableEmployees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.name} — {emp.position || emp.id}</option>
                ))}
                {editingStaff?.employeeId && !availableEmployees.some(e => e.id === editingStaff.employeeId) && (
                  <option value={editingStaff.employeeId}>{editingStaff.employeeId} (current)</option>
                )}
              </select>
            </Field>
          )}
          <div className="md:col-span-2">
            <Field label="Specializations">
              <input className={inputCls} value={form.specializations} onChange={e => setForm(f => ({ ...f, specializations: e.target.value }))} placeholder="Comma-separated, e.g. Swedish Massage, Hot Stone" />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Certifications">
              <input className={inputCls} value={form.certifications} onChange={e => setForm(f => ({ ...f, certifications: e.target.value }))} placeholder="Comma-separated, e.g. Licensed Massage Therapist (LMT)" />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Languages">
              <input className={inputCls} value={form.languages} onChange={e => setForm(f => ({ ...f, languages: e.target.value }))} placeholder="Comma-separated, e.g. English, Mandarin" />
            </Field>
          </div>
        </div>
      </ModalSystem>

      {/* ── Delete confirm ── */}
      <ModalSystem
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteStaff(deleteTarget)}
        title="Remove Staff Member"
        variant="confirm"
        size="sm"
        loading={actingOn === deleteTarget?.id}
        confirmLabel="Remove"
        confirmColor="rose"
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Remove <b>{deleteTarget?.name}</b> ({deleteTarget?.id}) from the roster? Appointments keep their record but lose the staff link.
        </p>
      </ModalSystem>

      {/* ── HR link modal ── */}
      <ModalSystem
        isOpen={!!linkTarget}
        onClose={() => setLinkTarget(null)}
        onConfirm={linkEmployee}
        title={`Link ${linkTarget?.name} to HR`}
        subtitle="Attach an existing HR employee record (Spa & Wellness dept)"
        variant="form"
        size="sm"
        loading={actingOn === linkTarget?.id}
        confirmLabel="Link"
      >
        <Field label="HR Employee">
          <select className={inputCls} value={linkEmployeeId} onChange={e => setLinkEmployeeId(e.target.value)}>
            <option value="">Select employee…</option>
            {availableEmployees.map(emp => (
              <option key={emp.id} value={emp.id}>{emp.name} — {emp.position || emp.id}</option>
            ))}
          </select>
        </Field>
      </ModalSystem>

      {/* ── Attendance check-in / edit modal ── */}
      <ModalSystem
        isOpen={showAttModal}
        onClose={() => { setShowAttModal(false); setAttEditing(null); }}
        onConfirm={saveAttendance}
        title={attEditing ? `Edit Attendance — ${attForm.staffName}` : `Check In — ${attForm.staffName}`}
        variant="form"
        size="md"
        loading={saving}
        confirmLabel={attEditing ? 'Save' : 'Check In'}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Shift">
            <select className={inputCls} value={attForm.shift} onChange={e => setAttForm(f => ({ ...f, shift: e.target.value as Shift }))}>
              {SHIFTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className={inputCls} value={attForm.status} onChange={e => setAttForm(f => ({ ...f, status: e.target.value }))}>
              {ATT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Check In">
            <input className={inputCls} type="datetime-local" value={attForm.checkIn} onChange={e => setAttForm(f => ({ ...f, checkIn: e.target.value }))} />
          </Field>
          <Field label="Check Out">
            <input className={inputCls} type="datetime-local" value={attForm.checkOut} onChange={e => setAttForm(f => ({ ...f, checkOut: e.target.value }))} />
          </Field>
          <Field label="Hours Worked">
            <input className={inputCls} type="number" min={0} step={0.25} value={attForm.hoursWorked} onChange={e => setAttForm(f => ({ ...f, hoursWorked: Number(e.target.value) }))} />
          </Field>
          <Field label="Overtime Hours">
            <input className={inputCls} type="number" min={0} step={0.25} value={attForm.overtimeHours} onChange={e => setAttForm(f => ({ ...f, overtimeHours: Number(e.target.value) }))} />
          </Field>
          <div className="col-span-2">
            <Field label="Notes">
              <input className={inputCls} value={attForm.notes} onChange={e => setAttForm(f => ({ ...f, notes: e.target.value }))} />
            </Field>
          </div>
        </div>
      </ModalSystem>

      {/* ── Attendance records detail modal ── */}
      <ModalSystem
        isOpen={!!calendarStaff}
        onClose={() => setCalendarStaff(null)}
        title={`${calendarStaff?.staffName} — Attendance Records`}
        subtitle={calendarStaff ? `${calendarStaff.totalDays} days · ${calendarStaff.attendanceRate}% rate` : ''}
        variant="info"
        size="lg"
        showFooter={false}
      >
        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {(calendarStaff?.records || []).map(r => (
            <div key={r.id} className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 text-sm">
              <div>
                <span className="font-medium text-slate-900 dark:text-white">{r.attendanceDate}</span>
                <span className="text-xs text-slate-500 ml-2">{r.shift}</span>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={ATT_TONE[r.status] || 'neutral'}>{r.status}</Badge>
                <span className="text-xs text-slate-500 w-20 text-right">{r.hoursWorked > 0 ? `${r.hoursWorked.toFixed(1)}h` : '—'}</span>
                {!r.checkOut && r.status === 'Present' && (
                  <button onClick={() => quickCheckOut(r)} className="text-[10px] font-bold text-[var(--color-accent-spa)] hover:underline uppercase">Check out</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </ModalSystem>

      {/* ── Generic ops modal (shifts / staffing / training / productivity) ── */}
      <ModalSystem
        isOpen={!!opsModal}
        onClose={() => setOpsModal(null)}
        onConfirm={saveOps}
        title={`${opsModal?.row ? 'Edit' : 'Add'} ${opsModal?.kind === 'shifts' ? 'Shift Requirement' : opsModal?.kind === 'staffing' ? 'Staffing Requirement' : opsModal?.kind === 'training' ? 'Training' : 'Productivity Record'}`}
        variant="form"
        size="md"
        loading={saving}
        confirmLabel={opsModal?.row ? 'Save' : 'Add'}
      >
        {opsModal?.kind === 'shifts' && (
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Field label="Shift Name *">
                <input className={inputCls} value={opsForm.name || ''} onChange={e => setOpsForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Morning Shift" />
              </Field>
            </div>
            <Field label="Start Time">
              <input className={inputCls} type="time" value={opsForm.start_time || ''} onChange={e => setOpsForm(f => ({ ...f, start_time: e.target.value }))} />
            </Field>
            <Field label="End Time">
              <input className={inputCls} type="time" value={opsForm.end_time || ''} onChange={e => setOpsForm(f => ({ ...f, end_time: e.target.value }))} />
            </Field>
            <Field label="Assigned Staff">
              <input className={inputCls} type="number" min={0} value={opsForm.assigned_staff ?? 0} onChange={e => setOpsForm(f => ({ ...f, assigned_staff: Number(e.target.value) }))} />
            </Field>
            <Field label="Required Staff">
              <input className={inputCls} type="number" min={0} value={opsForm.required_staff ?? 0} onChange={e => setOpsForm(f => ({ ...f, required_staff: Number(e.target.value) }))} />
            </Field>
          </div>
        )}
        {opsModal?.kind === 'staffing' && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Work Area">
              <select className={inputCls} value={opsForm.work_area || ''} onChange={e => setOpsForm(f => ({ ...f, work_area: e.target.value || null }))}>
                <option value="">All areas</option>
                {WORK_AREAS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
            <Field label="Role">
              <select className={inputCls} value={opsForm.role || 'Therapist'} onChange={e => setOpsForm(f => ({ ...f, role: e.target.value }))}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="Shift">
              <select className={inputCls} value={opsForm.shift || 'Morning'} onChange={e => setOpsForm(f => ({ ...f, shift: e.target.value }))}>
                {SHIFTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Required Count">
              <input className={inputCls} type="number" min={0} value={opsForm.required_count ?? 0} onChange={e => setOpsForm(f => ({ ...f, required_count: Number(e.target.value) }))} />
            </Field>
            <Field label="Assigned Count">
              <input className={inputCls} type="number" min={0} value={opsForm.assigned_count ?? 0} onChange={e => setOpsForm(f => ({ ...f, assigned_count: Number(e.target.value) }))} />
            </Field>
          </div>
        )}
        {opsModal?.kind === 'training' && (
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Field label="Course *">
                <input className={inputCls} value={opsForm.course || ''} onChange={e => setOpsForm(f => ({ ...f, course: e.target.value }))} placeholder="e.g. Hot Stone Therapy Recertification" />
              </Field>
            </div>
            <Field label="Staff Member">
              <select className={inputCls} value={opsForm.staff_id || ''} onChange={e => setOpsForm(f => ({ ...f, staff_id: e.target.value || null }))}>
                <option value="">Select staff…</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Due Date">
              <input className={inputCls} type="date" value={opsForm.due_date || ''} onChange={e => setOpsForm(f => ({ ...f, due_date: e.target.value || null }))} />
            </Field>
            <Field label="Status">
              <select className={inputCls} value={opsForm.status || 'Not Started'} onChange={e => setOpsForm(f => ({ ...f, status: e.target.value }))}>
                {TRAIN_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
        )}
        {opsModal?.kind === 'productivity' && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Staff Member">
              <select className={inputCls} value={opsForm.staff_id || ''} onChange={e => setOpsForm(f => ({ ...f, staff_id: e.target.value || null }))}>
                <option value="">Select staff…</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Period Date">
              <input className={inputCls} type="date" value={opsForm.period_date || ''} onChange={e => setOpsForm(f => ({ ...f, period_date: e.target.value || null }))} />
            </Field>
            <Field label="Treatments Completed">
              <input className={inputCls} type="number" min={0} value={opsForm.treatments_completed ?? 0} onChange={e => setOpsForm(f => ({ ...f, treatments_completed: Number(e.target.value) }))} />
            </Field>
            <Field label="Hours">
              <input className={inputCls} type="number" min={0} step={0.5} value={opsForm.hours ?? 0} onChange={e => setOpsForm(f => ({ ...f, hours: Number(e.target.value) }))} />
            </Field>
            <Field label="Guest Satisfaction %">
              <input className={inputCls} type="number" min={0} max={100} value={opsForm.guest_satisfaction ?? 0} onChange={e => setOpsForm(f => ({ ...f, guest_satisfaction: Number(e.target.value) }))} />
            </Field>
            <Field label="Productivity Score">
              <input className={inputCls} type="number" min={0} step={0.5} value={opsForm.productivity_score ?? 0} onChange={e => setOpsForm(f => ({ ...f, productivity_score: Number(e.target.value) }))} />
            </Field>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default TherapistManagementModule;
