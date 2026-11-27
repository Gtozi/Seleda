/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Front Office Staff Management module.
 * Tailored for Front Office operations — stations (Front Desk, Concierge
 * Desk, Bell Desk, Lobby), FO-specific roles, and FO productivity metrics
 * (check-ins, check-outs, guest satisfaction, upsell revenue, response time).
 *
 * DB-integrated via /api/front-office/staff/* routes.
 * HR-integrated: pulls employees from /api/hr/employees for training and
 * productivity linking.
 * Table style follows the F&B StaffOperations DataTable pattern.
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
  X,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  RefreshCw,
  DoorOpen,
  Headphones,
  Bell,
  Moon,
  Crown,
  CreditCard,
  Mail,
  Phone,
  Link2,
  ServerCrash,
  CalendarCheck,
  LogIn,
  LogOut,
  type LucideIcon,
} from 'lucide-react';
import StatCard from '../StatCard';
import { PageHeader, SectionCard, Badge } from '../ui';
import { button, layout, statusTone, type StatusTone } from '../brandTheme';

type SubTab = 'assignments' | 'attendance' | 'shifts' | 'staffing' | 'training' | 'productivity';
type Shift = 'Morning' | 'Evening' | 'Night';
type Role = 'Front Desk Agent' | 'Concierge' | 'Bell Attendant' | 'Night Auditor' | 'Guest Relations' | 'Cashier' | 'Supervisor';

const ROLES: Role[] = ['Front Desk Agent', 'Concierge', 'Bell Attendant', 'Night Auditor', 'Guest Relations', 'Cashier', 'Supervisor'];
const SHIFTS: Shift[] = ['Morning', 'Evening', 'Night'];
const STATIONS = ['Front Desk', 'Concierge Desk', 'Bell Desk', 'Lobby', 'PBX', 'Cashier'];
const TRAIN_STATUSES = ['Not Started', 'In Progress', 'Completed', 'Overdue'] as const;

const SUB_TABS: { id: SubTab; label: string; icon: LucideIcon }[] = [
  { id: 'assignments', label: 'Staff Assignment', icon: IdCard },
  { id: 'attendance', label: 'Attendance', icon: CalendarCheck },
  { id: 'shifts', label: 'Shift Requirements', icon: CalendarDays },
  { id: 'staffing', label: 'Staffing', icon: Users },
  { id: 'training', label: 'Training', icon: GraduationCap },
  { id: 'productivity', label: 'Productivity', icon: Gauge },
];

const ROLE_TONE: Record<Role, StatusTone> = {
  'Front Desk Agent': 'accent',
  Concierge: 'info',
  'Bell Attendant': 'warning',
  'Night Auditor': 'neutral',
  'Guest Relations': 'success',
  Cashier: 'warning',
  Supervisor: 'success',
};

const ROLE_ICON: Record<Role, LucideIcon> = {
  'Front Desk Agent': DoorOpen,
  Concierge: Headphones,
  'Bell Attendant': Bell,
  'Night Auditor': Moon,
  'Guest Relations': Crown,
  Cashier: CreditCard,
  Supervisor: Users,
};

const TRAIN_TONE: Record<string, StatusTone> = {
  'Not Started': 'info',
  'In Progress': 'warning',
  Completed: 'success',
  Overdue: 'danger',
};

const workloadTone = (w: number): StatusTone => (w > 80 ? 'danger' : w > 60 ? 'warning' : 'success');

// ── Auth headers ───────────────────────────────────────────────────────
function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

const inputCls = 'w-full px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 font-sans';

// ── F&B-style DataTable ───────────────────────────────────────────────
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

// ── Interfaces ────────────────────────────────────────────────────────
interface Employee {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  position: string | null;
  department: string | null;
  hire_date: string | null;
  salary: number | null;
}

interface StaffMember {
  id: string;
  name: string;
  avatar: string;
  role: Role;
  shift: Shift;
  station: string;
  checkIns: number;
  checkOuts: number;
  guestSatisfaction: number;
  upsellRevenue: number;
  avgResponseMin: number;
  workload: number;
  status: string;
  isActive: boolean;
  employeeId: string | null;
  email: string | null;
  phone: string | null;
  hireDate: string | null;
  salary: number | null;
  department: string;
  position: string;
}

interface AvailableEmployee {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  position: string | null;
  hire_date: string | null;
  salary: number | null;
}

interface AttendanceRecord {
  id: string;
  staffId: string;
  staffName: string;
  departmentScope: string;
  employeeId: string | null;
  attendanceDate: string;
  shift: string;
  checkIn: string | null;
  checkOut: string | null;
  status: string;
  hoursWorked: number;
  overtimeHours: number;
  notes: string | null;
  email: string | null;
  phone: string | null;
  department: string | null;
  position: string | null;
}

const ATT_STATUS_TONE: Record<string, StatusTone> = {
  Present: 'success', Late: 'warning', Absent: 'danger',
  'On Leave': 'info', Sick: 'neutral', 'Half Day': 'info',
  'Day Off': 'neutral', 'Public Holiday': 'accent',
  'Work From Home': 'info', Mission: 'warning', 'Training Day': 'info',
};

const ATT_STATUS_COLOR: Record<string, string> = {
  Present: 'bg-emerald-500', Late: 'bg-amber-500', Absent: 'bg-rose-500',
  'On Leave': 'bg-blue-500', Sick: 'bg-slate-400', 'Half Day': 'bg-cyan-500',
  'Day Off': 'bg-slate-300', 'Public Holiday': 'bg-indigo-500',
  'Work From Home': 'bg-teal-500', Mission: 'bg-orange-500', 'Training Day': 'bg-violet-500',
};

interface StaffAttendanceSummary {
  staffId: string;
  staffName: string;
  employeeId: string | null;
  records: AttendanceRecord[];
  present: number; late: number; absent: number; onLeave: number; sick: number; halfDay: number;
  dayOff: number; publicHoliday: number; workFromHome: number; mission: number; trainingDay: number;
  totalHours: number; totalOvertime: number; totalDays: number;
  email: string | null; phone: string | null; department: string | null; position: string | null;
  attendanceRate: number;
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
  station: string | null;
  role: string;
  required_count: number;
  assigned_count: number;
  shift: string;
}

interface Training {
  id: string;
  course: string;
  employee_id: string | null;
  due_date: string | null;
  status: string;
}

interface ProductivityRow {
  id: string;
  employee_id: string | null;
  check_ins: number;
  check_outs: number;
  guest_satisfaction: number;
  upsell_revenue: number;
  avg_response_min: number;
  hours: number;
  period_date: string | null;
}

export default function StaffManagement() {
  const { currentPropertyId, addNotification } = useERP();

  const [subTab, setSubTab] = useState<SubTab>('assignments');
  const [search, setSearch] = useState('');

  // Roster (Staff Assignment)
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [shiftFilter, setShiftFilter] = useState<'All' | Shift>('All');
  const [roleFilter, setRoleFilter] = useState<'All' | Role>('All');
  const [deleteTarget, setDeleteTarget] = useState<StaffMember | null>(null);
  const [linkTarget, setLinkTarget] = useState<StaffMember | null>(null);
  const [linkEmployeeId, setLinkEmployeeId] = useState('');
  const [availableEmployees, setAvailableEmployees] = useState<AvailableEmployee[]>([]);
  const [rosterForm, setRosterForm] = useState({
    name: '', role: 'Front Desk Agent' as Role, shift: 'Morning' as Shift,
    station: 'Front Desk', status: 'Active Duty',
    checkIns: 0, checkOuts: 0, guestSatisfaction: 0, upsellRevenue: 0, avgResponseMin: 0, workload: 0,
    linkMode: 'new' as 'new' | 'existing' | 'none',
    employeeId: '',
    email: '', phone: '', hireDate: '', salary: 0,
  });

  // Employees (HR)
  const [employees, setEmployees] = useState<Employee[]>([]);

  // Shifts
  const [shifts, setShifts] = useState<ShiftReq[]>([]);
  const [loadingShifts, setLoadingShifts] = useState(true);

  // Staffing
  const [staffing, setStaffing] = useState<StaffingReq[]>([]);
  const [loadingStaffing, setLoadingStaffing] = useState(true);

  // Training
  const [training, setTraining] = useState<Training[]>([]);
  const [loadingTraining, setLoadingTraining] = useState(true);

  // Productivity
  const [productivity, setProductivity] = useState<ProductivityRow[]>([]);
  const [loadingProductivity, setLoadingProductivity] = useState(true);

  // Attendance
  const [attSummary, setAttSummary] = useState<StaffAttendanceSummary[]>([]);
  const [loadingAttendance, setLoadingAttendance] = useState(true);
  const [attStatusFilter, setAttStatusFilter] = useState<'All' | string>('All');
  const [attEditing, setAttEditing] = useState<AttendanceRecord | null>(null);
  const [showAttModal, setShowAttModal] = useState(false);
  const [attForm, setAttForm] = useState({
    staffId: '', staffName: '', shift: 'Morning' as Shift, status: 'Present',
    checkIn: '', checkOut: '', hoursWorked: 0, overtimeHours: 0, notes: '',
  });
  const [calendarStaff, setCalendarStaff] = useState<StaffAttendanceSummary | null>(null);

  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showRosterModal, setShowRosterModal] = useState(false);
  const [editing, setEditing] = useState<{ kind: SubTab; row: any } | null>(null);

  // ── Fetchers ──────────────────────────────────────────────────────
  const fetchEmployees = useCallback(async () => {
    try {
      const res = await fetch('/api/hr/employees', { headers: authHeaders() });
      if (res.ok) {
        const data = (await res.json()) as Employee[];
        // Filter to Front Office department if available
        const fo = data.filter(e => !e.department || e.department.toLowerCase().includes('front') || e.department.toLowerCase().includes('front office') || e.department.toLowerCase().includes('fo'));
        setEmployees(fo.length > 0 ? fo : data);
      }
    } catch { /* non-fatal */ }
  }, []);

  // ── Roster fetchers ───────────────────────────────────────────────
  const fetchStaff = useCallback(async () => {
    if (!currentPropertyId) { setLoadingStaff(false); return; }
    setLoadingStaff(true); setStaffError(null);
    try {
      const res = await fetch(`/api/front-office/staff/${currentPropertyId}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load staff (${res.status})`);
      const data = (await res.json()) as { staff: StaffMember[] };
      setStaff(data.staff || []);
    } catch (e: any) {
      setStaffError(e?.message || 'Failed to load staff');
    } finally {
      setLoadingStaff(false);
    }
  }, [currentPropertyId]);

  const fetchAvailableEmployees = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/front-office/staff/available-employees/${currentPropertyId}`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = (await res.json()) as { employees: AvailableEmployee[] };
      setAvailableEmployees(data.employees || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchShifts = useCallback(async () => {
    if (!currentPropertyId) { setLoadingShifts(false); return; }
    setLoadingShifts(true);
    try {
      const res = await fetch(`/api/front-office/staff/shifts/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setShifts(await res.json());
    } catch { /* non-fatal */ }
    finally { setLoadingShifts(false); }
  }, [currentPropertyId]);

  const fetchStaffing = useCallback(async () => {
    if (!currentPropertyId) { setLoadingStaffing(false); return; }
    setLoadingStaffing(true);
    try {
      const res = await fetch(`/api/front-office/staff/staffing/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setStaffing(await res.json());
    } catch { /* non-fatal */ }
    finally { setLoadingStaffing(false); }
  }, [currentPropertyId]);

  const fetchTraining = useCallback(async () => {
    if (!currentPropertyId) { setLoadingTraining(false); return; }
    setLoadingTraining(true);
    try {
      const res = await fetch(`/api/front-office/staff/training/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setTraining(await res.json());
    } catch { /* non-fatal */ }
    finally { setLoadingTraining(false); }
  }, [currentPropertyId]);

  const fetchProductivity = useCallback(async () => {
    if (!currentPropertyId) { setLoadingProductivity(false); return; }
    setLoadingProductivity(true);
    try {
      const res = await fetch(`/api/front-office/staff/productivity/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setProductivity(await res.json());
    } catch { /* non-fatal */ }
    finally { setLoadingProductivity(false); }
  }, [currentPropertyId]);

  // ── Attendance fetcher + CRUD ─────────────────────────────────────
  const fetchAttendance = useCallback(async () => {
    if (!currentPropertyId) { setLoadingAttendance(false); return; }
    setLoadingAttendance(true);
    try {
      const res = await fetch(`/api/front-office/attendance/summary/${currentPropertyId}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load attendance (${res.status})`);
      const data = (await res.json()) as { summary: StaffAttendanceSummary[] };
      setAttSummary(data.summary || []);
    } catch { /* non-fatal */ }
    finally { setLoadingAttendance(false); }
  }, [currentPropertyId]);

  const saveAttendance = async () => {
    if (!currentPropertyId || !attForm.staffId || !attForm.staffName) {
      addNotification('Staff member is required', 'warning', 'Front Office');
      return;
    }
    setSaving(true);
    try {
      if (attEditing) {
        const res = await fetch(`/api/front-office/attendance/${attEditing.id}`, {
          method: 'PUT', headers: authHeaders(true),
          body: JSON.stringify({
            status: attForm.status, shift: attForm.shift,
            checkIn: attForm.checkIn || null, checkOut: attForm.checkOut || null,
            hoursWorked: attForm.hoursWorked, overtimeHours: attForm.overtimeHours,
            notes: attForm.notes || null,
          }),
        });
        if (!res.ok) throw new Error('Failed to update attendance');
        addNotification(`${attForm.staffName} attendance updated`, 'success', 'Front Office');
      } else {
        const res = await fetch('/api/front-office/attendance', {
          method: 'POST', headers: authHeaders(true),
          body: JSON.stringify({
            propertyId: currentPropertyId, staffId: attForm.staffId, staffName: attForm.staffName,
            shift: attForm.shift, status: attForm.status,
            checkIn: attForm.checkIn || null, notes: attForm.notes || null,
          }),
        });
        if (!res.ok) throw new Error('Failed to check in');
        addNotification(`${attForm.staffName} checked in`, 'success', 'Front Office');
      }
      setShowAttModal(false); setAttEditing(null);
      setAttForm({ staffId: '', staffName: '', shift: 'Morning', status: 'Present', checkIn: '', checkOut: '', hoursWorked: 0, overtimeHours: 0, notes: '' });
      fetchAttendance();
    } catch (e: any) {
      addNotification(e?.message || 'Attendance save failed', 'warning', 'Front Office');
    } finally { setSaving(false); }
  };

  const quickCheckOut = async (rec: AttendanceRecord) => {
    const now = new Date().toISOString();
    const checkInTime = rec.checkIn ? new Date(rec.checkIn) : null;
    const hours = checkInTime ? Math.max(0, (Date.now() - checkInTime.getTime()) / 3600000) : 8;
    try {
      const res = await fetch(`/api/front-office/attendance/${rec.id}`, {
        method: 'PUT', headers: authHeaders(true),
        body: JSON.stringify({ checkOut: now, hoursWorked: Number(hours.toFixed(2)) }),
      });
      if (!res.ok) throw new Error('Failed to check out');
      addNotification(`${rec.staffName} checked out`, 'success', 'Front Office');
      fetchAttendance();
    } catch (e: any) {
      addNotification(e?.message || 'Check-out failed', 'warning', 'Front Office');
    }
  };

  const deleteAttendance = async (rec: AttendanceRecord) => {
    try {
      const res = await fetch(`/api/front-office/attendance/${rec.id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) throw new Error('Failed to delete');
      addNotification(`${rec.staffName} attendance record deleted`, 'info', 'Front Office');
      fetchAttendance();
    } catch (e: any) {
      addNotification(e?.message || 'Delete failed', 'warning', 'Front Office');
    }
  };

  // Load data for active sub-tab
  useEffect(() => {
    if (subTab === 'assignments') fetchStaff();
    if (subTab === 'attendance') fetchAttendance();
    if (subTab === 'shifts') fetchShifts();
    if (subTab === 'staffing') fetchStaffing();
    if (subTab === 'training') fetchTraining();
    if (subTab === 'productivity') fetchProductivity();
  }, [subTab, fetchStaff, fetchAttendance, fetchShifts, fetchStaffing, fetchTraining, fetchProductivity]);

  // Load employees once
  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

  const refreshAll = useCallback(() => {
    fetchStaff(); fetchAttendance(); fetchShifts(); fetchStaffing(); fetchTraining(); fetchProductivity(); fetchEmployees();
    addNotification('Staff operations refreshed', 'info', 'Front Office');
  }, [fetchStaff, fetchAttendance, fetchShifts, fetchStaffing, fetchTraining, fetchProductivity, fetchEmployees, addNotification]);

  // ── Helpers ───────────────────────────────────────────────────────
  const getEmployeeName = (empId: string | null) => {
    if (!empId) return 'Unassigned';
    const emp = employees.find(e => e.id === empId);
    return emp?.name || empId;
  };

  const stats = useMemo(() => ({
    totalStaff: staff.length,
    onDuty: staff.filter(s => s.status === 'Active Duty').length,
    totalShifts: shifts.length,
    understaffed: staffing.filter(s => s.assigned_count < s.required_count).length,
    overdueTraining: training.filter(t => t.status === 'Overdue').length,
    avgSatisfaction: productivity.length > 0
      ? (productivity.reduce((sum, p) => sum + Number(p.guest_satisfaction), 0) / productivity.length).toFixed(2)
      : '—',
    attPresent: attSummary.reduce((s, a) => s + a.present, 0),
    attLate: attSummary.reduce((s, a) => s + a.late, 0),
    attAbsent: attSummary.reduce((s, a) => s + a.absent, 0),
  }), [staff, shifts, staffing, training, productivity, attSummary]);

  // ── Filtered lists ─────────────────────────────────────────────────
  const filteredStaff = useMemo(() => {
    const q = search.toLowerCase();
    return staff.filter(s => {
      const matchesShift = shiftFilter === 'All' || s.shift === shiftFilter;
      const matchesRole = roleFilter === 'All' || s.role === roleFilter;
      const matchesSearch = !q ||
        s.name.toLowerCase().includes(q) ||
        s.role.toLowerCase().includes(q) ||
        s.station.toLowerCase().includes(q) ||
        (s.email?.toLowerCase().includes(q) ?? false);
      return matchesShift && matchesRole && matchesSearch;
    });
  }, [staff, shiftFilter, roleFilter, search]);

  const filteredShifts = useMemo(() => {
    const q = search.toLowerCase();
    return shifts.filter(s => !q || s.name.toLowerCase().includes(q));
  }, [shifts, search]);

  const filteredStaffing = useMemo(() => {
    const q = search.toLowerCase();
    return staffing.filter(s => !q || s.role.toLowerCase().includes(q) || (s.station?.toLowerCase().includes(q) ?? false));
  }, [staffing, search]);

  const filteredTraining = useMemo(() => {
    const q = search.toLowerCase();
    return training.filter(t => !q || t.course.toLowerCase().includes(q) || getEmployeeName(t.employee_id).toLowerCase().includes(q));
  }, [training, search, employees]);

  const filteredProd = useMemo(() => {
    const q = search.toLowerCase();
    return productivity.filter(p => !q || getEmployeeName(p.employee_id).toLowerCase().includes(q));
  }, [productivity, search, employees]);

  // ── Attendance: filtered summary rows (one per staff) ──────────────
  const filteredAttSummary = useMemo(() => {
    const q = search.toLowerCase();
    return attSummary.filter(a => {
      const matchesStatus = attStatusFilter === 'All' ||
        (attStatusFilter === 'Present' && a.present > 0) ||
        (attStatusFilter === 'Late' && a.late > 0) ||
        (attStatusFilter === 'Absent' && a.absent > 0) ||
        (attStatusFilter === 'On Leave' && a.onLeave > 0) ||
        (attStatusFilter === 'Sick' && a.sick > 0) ||
        (attStatusFilter === 'Half Day' && a.halfDay > 0) ||
        (attStatusFilter === 'Day Off' && a.dayOff > 0) ||
        (attStatusFilter === 'Public Holiday' && a.publicHoliday > 0) ||
        (attStatusFilter === 'Work From Home' && a.workFromHome > 0) ||
        (attStatusFilter === 'Mission' && a.mission > 0) ||
        (attStatusFilter === 'Training Day' && a.trainingDay > 0);
      const matchesSearch = !q || a.staffName.toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [attSummary, attStatusFilter, search]);

  const attendanceSummaryRows = useMemo(() => filteredAttSummary.map(a => [
    <button onClick={() => setCalendarStaff(a)} className="flex items-center gap-3 group text-left">
      <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-[11px] font-black text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 shrink-0">
        {a.staffName.split(' ').map(n => n[0]).join('')}
      </div>
      <div>
        <div className="font-bold text-slate-900 dark:text-white group-hover:text-indigo-600 transition">{a.staffName}</div>
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
    <div className="flex flex-wrap gap-1">
      {a.present > 0 && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-600"><span className="w-2 h-2 rounded-full bg-emerald-500" />{a.present}</span>}
      {a.late > 0 && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-600"><span className="w-2 h-2 rounded-full bg-amber-500" />{a.late}</span>}
      {a.absent > 0 && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-rose-600"><span className="w-2 h-2 rounded-full bg-rose-500" />{a.absent}</span>}
      {a.sick > 0 && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-slate-500"><span className="w-2 h-2 rounded-full bg-slate-400" />{a.sick}</span>}
      {a.onLeave > 0 && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-blue-600"><span className="w-2 h-2 rounded-full bg-blue-500" />{a.onLeave}</span>}
      {a.dayOff > 0 && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-slate-400"><span className="w-2 h-2 rounded-full bg-slate-300" />{a.dayOff}</span>}
      {a.publicHoliday > 0 && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-indigo-600"><span className="w-2 h-2 rounded-full bg-indigo-500" />{a.publicHoliday}</span>}
      {a.halfDay > 0 && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-cyan-600"><span className="w-2 h-2 rounded-full bg-cyan-500" />{a.halfDay}</span>}
      {a.workFromHome > 0 && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-teal-600"><span className="w-2 h-2 rounded-full bg-teal-500" />{a.workFromHome}</span>}
      {a.mission > 0 && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-orange-600"><span className="w-2 h-2 rounded-full bg-orange-500" />{a.mission}</span>}
      {a.trainingDay > 0 && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-violet-600"><span className="w-2 h-2 rounded-full bg-violet-500" />{a.trainingDay}</span>}
    </div>,
    <span className="font-bold text-slate-900 dark:text-white">{a.totalHours.toFixed(1)}h</span>,
    <span className="font-bold text-amber-600 dark:text-amber-400">{a.totalOvertime > 0 ? `${a.totalOvertime.toFixed(1)}h` : '—'}</span>,
    a.employeeId ? (
      <div className="space-y-0.5">
        {a.position && <div className="text-[10px] font-bold text-slate-600 dark:text-slate-300">{a.position}</div>}
        {a.email && <div className="flex items-center gap-1 text-[10px]"><Mail size={10} className="text-slate-400" /> {a.email}</div>}
      </div>
    ) : <span className="text-xs text-slate-400">Not linked</span>,
    <div className="inline-flex gap-2">
      <button onClick={() => setCalendarStaff(a)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="View calendar"><CalendarCheck className="w-4 h-4" /></button>
      <button onClick={() => { setAttEditing(null); setAttForm({ staffId: a.staffId, staffName: a.staffName, shift: 'Morning' as Shift, status: 'Present', checkIn: '', checkOut: '', hoursWorked: 0, overtimeHours: 0, notes: '' }); setShowAttModal(true); }} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Check in"><LogIn className="w-4 h-4" /></button>
    </div>,
  ]), [filteredAttSummary]);

  // ── CRUD ──────────────────────────────────────────────────────────
  const apiCall = async (method: string, path: string, body?: any) => {
    const r = await fetch(`/api/front-office/staff${path}`, {
      method,
      headers: authHeaders(true),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || `Request failed (${r.status})`);
    }
    return r.status === 204 ? null : r.json();
  };

  // ── Roster CRUD ───────────────────────────────────────────────────
  const reassign = async (id: string, field: 'station' | 'shift' | 'role', value: string) => {
    setActingOn(id);
    try {
      const res = await fetch(`/api/front-office/staff/${id}`, { method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ [field]: value }) });
      if (!res.ok) throw new Error(`Failed to update (${res.status})`);
      const updated = (await res.json()) as StaffMember;
      setStaff(prev => prev.map(s => (s.id === id ? updated : s)));
      addNotification(`${updated.name} reassigned (${field})`, 'info', 'Front Office');
    } catch (e: any) {
      addNotification(e?.message || 'Reassign failed', 'warning', 'Front Office');
    } finally {
      setActingOn(null);
    }
  };

  const createStaff = async () => {
    if (!currentPropertyId || !rosterForm.name.trim()) {
      addNotification('Name is required', 'warning', 'Front Office');
      return;
    }
    setActingOn('new');
    try {
      const payload: Record<string, unknown> = {
        propertyId: currentPropertyId,
        name: rosterForm.name, role: rosterForm.role, shift: rosterForm.shift,
        station: rosterForm.station, status: rosterForm.status,
        checkIns: rosterForm.checkIns, checkOuts: rosterForm.checkOuts,
        guestSatisfaction: rosterForm.guestSatisfaction, upsellRevenue: rosterForm.upsellRevenue,
        avgResponseMin: rosterForm.avgResponseMin, workload: rosterForm.workload,
      };
      if (rosterForm.linkMode === 'existing' && rosterForm.employeeId) {
        payload.employeeId = rosterForm.employeeId;
      } else if (rosterForm.linkMode === 'new' && (rosterForm.email || rosterForm.phone || rosterForm.hireDate || rosterForm.salary)) {
        payload.email = rosterForm.email; payload.phone = rosterForm.phone;
        payload.hireDate = rosterForm.hireDate; payload.salary = rosterForm.salary;
      }
      const res = await fetch('/api/front-office/staff', { method: 'POST', headers: authHeaders(true), body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(`Failed to create (${res.status})`);
      const created = (await res.json()) as StaffMember;
      setStaff(prev => [...prev, created]);
      addNotification(`${created.name} added`, 'success', 'Front Office');
      setShowRosterModal(false);
      setRosterForm({ name: '', role: 'Front Desk Agent', shift: 'Morning', station: 'Front Desk', status: 'Active Duty',
        checkIns: 0, checkOuts: 0, guestSatisfaction: 0, upsellRevenue: 0, avgResponseMin: 0, workload: 0,
        linkMode: 'new', employeeId: '', email: '', phone: '', hireDate: '', salary: 0 });
    } catch (e: any) {
      addNotification(e?.message || 'Create failed', 'warning', 'Front Office');
    } finally {
      setActingOn(null);
    }
  };

  const linkEmployee = async () => {
    if (!linkTarget || !linkEmployeeId) return;
    setActingOn(linkTarget.id);
    try {
      const res = await fetch(`/api/front-office/staff/${linkTarget.id}`, { method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ employeeId: linkEmployeeId }) });
      if (!res.ok) throw new Error(`Failed to link (${res.status})`);
      const updated = (await res.json()) as StaffMember;
      setStaff(prev => prev.map(s => (s.id === linkTarget.id ? updated : s)));
      addNotification(`${updated.name} linked to HR employee`, 'success', 'Front Office');
      setLinkTarget(null); setLinkEmployeeId('');
    } catch (e: any) {
      addNotification(e?.message || 'Link failed', 'warning', 'Front Office');
    } finally {
      setActingOn(null);
    }
  };

  const openLinkModal = async (s: StaffMember) => {
    setLinkTarget(s); setLinkEmployeeId('');
    await fetchAvailableEmployees();
  };

  const deleteStaff = async (s: StaffMember) => {
    setActingOn(s.id);
    try {
      const res = await fetch(`/api/front-office/staff/${s.id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to remove (${res.status})`);
      setStaff(prev => prev.filter(x => x.id !== s.id));
      addNotification(`${s.name} removed`, 'info', 'Front Office');
      setDeleteTarget(null);
    } catch (e: any) {
      addNotification(e?.message || 'Delete failed', 'warning', 'Front Office');
    } finally {
      setActingOn(null);
    }
  };

  const handleSave = async (kind: SubTab, payload: any, id?: string) => {
    setSaving(true);
    try {
      const path = `/${kind}${id ? `/${id}` : ''}`;
      await apiCall(id ? 'PUT' : 'POST', path, payload);
      addNotification(`${kind} ${id ? 'updated' : 'created'}`, 'success', 'Front Office');
      setShowModal(false); setEditing(null);
      if (kind === 'shifts') fetchShifts();
      if (kind === 'staffing') fetchStaffing();
      if (kind === 'training') fetchTraining();
      if (kind === 'productivity') fetchProductivity();
    } catch (e: any) {
      addNotification(e.message || 'Save failed', 'warning', 'Front Office');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (kind: SubTab, id: string) => {
    setSaving(true);
    try {
      await apiCall('DELETE', `/${kind}/${id}`);
      addNotification(`${kind} deleted`, 'info', 'Front Office');
      if (kind === 'shifts') setShifts(a => a.filter(x => x.id !== id));
      if (kind === 'staffing') setStaffing(a => a.filter(x => x.id !== id));
      if (kind === 'training') setTraining(a => a.filter(x => x.id !== id));
      if (kind === 'productivity') setProductivity(a => a.filter(x => x.id !== id));
    } catch (e: any) {
      addNotification(e.message || 'Delete failed', 'warning', 'Front Office');
    } finally {
      setSaving(false);
    }
  };

  const handleMarkTrainingComplete = async (t: Training) => {
    setSaving(true);
    try {
      await apiCall('PUT', `/training/${t.id}`, { status: 'Completed' });
      addNotification(`${t.course} marked complete`, 'success', 'Front Office');
      fetchTraining();
    } catch (e: any) {
      addNotification(e.message || 'Update failed', 'warning', 'Front Office');
    } finally {
      setSaving(false);
    }
  };

  // ── Table row builders ─────────────────────────────────────────────
  const selectCls = 'bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-lg px-2 py-1 text-[9px] font-bold text-slate-600 dark:text-slate-300 outline-none cursor-pointer disabled:opacity-50';

  const assignmentRows = useMemo(() => filteredStaff.map(s => {
    const RoleIcon = ROLE_ICON[s.role] || Users;
    return [
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-[11px] font-black text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 shrink-0">
          {s.avatar || s.name.split(' ').map(n => n[0]).join('')}
        </div>
        <div className="min-w-0">
          <div className="font-bold text-slate-900 dark:text-white truncate">{s.name}</div>
          <div className="text-[10px] text-slate-400 font-mono">{s.id}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <RoleIcon className="w-3 h-3 text-slate-400" />
            <Badge tone={ROLE_TONE[s.role]}>{s.role}</Badge>
            {s.employeeId ? <Badge tone="success" icon={Link2}>HR</Badge> : (
              <button onClick={() => openLinkModal(s)} className="text-[8px] font-bold text-indigo-500 hover:text-indigo-700 uppercase underline">Link HR</button>
            )}
          </div>
        </div>
      </div>,
      <select value={s.shift} onChange={e => reassign(s.id, 'shift', e.target.value)} disabled={actingOn === s.id} className={selectCls}>
        {SHIFTS.map(sh => <option key={sh} value={sh}>{sh}</option>)}
      </select>,
      <select value={s.station} onChange={e => reassign(s.id, 'station', e.target.value)} disabled={actingOn === s.id} className={selectCls}>
        {STATIONS.map(st => <option key={st} value={st}>{st}</option>)}
      </select>,
      <span className="font-bold text-emerald-600 dark:text-emerald-400">{s.checkIns}</span>,
      <span className="font-bold text-blue-600 dark:text-blue-400">{s.checkOuts}</span>,
      <span className="font-bold text-purple-600 dark:text-purple-400">{Number(s.guestSatisfaction).toFixed(2)}★</span>,
      <span className="font-bold text-indigo-600 dark:text-indigo-400">${Number(s.upsellRevenue).toLocaleString()}</span>,
      <span>{Number(s.avgResponseMin).toFixed(1)}m</span>,
      <div className="w-28">
        <div className="flex items-center justify-between text-[9px] font-mono mb-1">
          <span className="font-black text-slate-700 dark:text-slate-200">{s.workload}%</span>
        </div>
        <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
          <div className={`h-full ${statusTone[workloadTone(s.workload)].dot}`} style={{ width: `${s.workload}%` }} />
        </div>
      </div>,
      s.employeeId ? (
        <div className="space-y-0.5">
          {s.email && <div className="flex items-center gap-1 text-[10px]"><Mail size={10} className="text-slate-400" /> {s.email}</div>}
          {s.phone && <div className="flex items-center gap-1 text-[10px]"><Phone size={10} className="text-slate-400" /> {s.phone}</div>}
          {s.hireDate && <div className="flex items-center gap-1 text-[10px]"><CalendarDays size={10} className="text-slate-400" /> {s.hireDate}</div>}
          {s.salary != null && s.salary > 0 && <div className="flex items-center gap-1 text-[10px]">${Number(s.salary).toLocaleString()}</div>}
        </div>
      ) : <span className="text-xs text-slate-400">Not linked</span>,
      <div className="inline-flex gap-2">
        <button onClick={() => openLinkModal(s)} disabled={actingOn === s.id} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Link HR"><Link2 className="w-4 h-4" /></button>
        <button onClick={() => setDeleteTarget(s)} disabled={actingOn === s.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Remove">
          {actingOn === s.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 className="w-4 h-4" />}
        </button>
      </div>,
    ];
  }), [filteredStaff, actingOn]);

  const shiftRows = useMemo(() => filteredShifts.map(s => {
    const pct = s.required_staff > 0 ? Math.round((s.assigned_staff / s.required_staff) * 100) : 0;
    return [
      <span className="font-medium text-slate-900 dark:text-white">{s.name}</span>,
      <span>{fmtTime(s.start_time)}</span>,
      <span>{fmtTime(s.end_time)}</span>,
      <span>{s.assigned_staff}</span>,
      <span>{s.required_staff}</span>,
      <div className="flex items-center gap-2">
        <div className="w-20 h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${pct >= 100 ? 'bg-[var(--color-success)]' : 'bg-[var(--color-warning)]'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <span className="text-xs text-slate-500">{pct}%</span>
      </div>,
      <div className="inline-flex gap-2">
        <button onClick={() => { setEditing({ kind: 'shifts', row: s }); setShowModal(true); }} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]"><Pencil className="w-4 h-4" /></button>
        <button onClick={() => handleDelete('shifts', s.id)} className="p-1 text-slate-400 hover:text-[var(--color-danger)]"><Trash2 className="w-4 h-4" /></button>
      </div>,
    ];
  }), [filteredShifts]);

  const staffingRows = useMemo(() => filteredStaffing.map(s => {
    const gap = s.required_count - s.assigned_count;
    const RoleIcon = ROLE_ICON[s.role as Role] || Users;
    return [
      <span className="font-medium text-slate-900 dark:text-white">{s.station || '—'}</span>,
      <div className="flex items-center gap-2">
        <RoleIcon className="w-4 h-4 text-slate-400" />
        <Badge tone={ROLE_TONE[s.role as Role] || 'neutral'}>{s.role}</Badge>
      </div>,
      <span>{s.shift}</span>,
      <span>{s.required_count}</span>,
      <span>{s.assigned_count}</span>,
      gap > 0 ? <span className="text-red-600 dark:text-red-400 font-medium">-{gap}</span> : <span className="text-green-600 dark:text-green-400">0</span>,
      <Badge tone={gap > 0 ? 'danger' : 'success'}>{gap > 0 ? 'Understaffed' : 'Covered'}</Badge>,
      <div className="inline-flex gap-2">
        <button onClick={() => { setEditing({ kind: 'staffing', row: s }); setShowModal(true); }} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]"><Pencil className="w-4 h-4" /></button>
        <button onClick={() => handleDelete('staffing', s.id)} className="p-1 text-slate-400 hover:text-[var(--color-danger)]"><Trash2 className="w-4 h-4" /></button>
      </div>,
    ];
  }), [filteredStaffing]);

  const trainingRows = useMemo(() => filteredTraining.map(t => [
    <span className="font-medium text-slate-900 dark:text-white">{t.course}</span>,
    <span>{getEmployeeName(t.employee_id)}</span>,
    <span>{t.due_date || '—'}</span>,
    <Badge tone={TRAIN_TONE[t.status] || 'neutral'}>{t.status}</Badge>,
    <div className="inline-flex gap-2">
      <button onClick={() => { setEditing({ kind: 'training', row: t }); setShowModal(true); }} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]"><Pencil className="w-4 h-4" /></button>
      {t.status !== 'Completed' && (
        <button onClick={() => handleMarkTrainingComplete(t)} className="px-2 py-1 text-xs rounded-lg bg-[var(--color-accent-operations)] text-white">Complete</button>
      )}
      <button onClick={() => handleDelete('training', t.id)} className="p-1 text-slate-400 hover:text-[var(--color-danger)]"><Trash2 className="w-4 h-4" /></button>
    </div>,
  ]), [filteredTraining, employees]);

  const prodRows = useMemo(() => filteredProd.map(p => [
    <span className="font-medium text-slate-900 dark:text-white">{getEmployeeName(p.employee_id)}</span>,
    <span className="font-bold text-emerald-600 dark:text-emerald-400">{p.check_ins}</span>,
    <span className="font-bold text-blue-600 dark:text-blue-400">{p.check_outs}</span>,
    <span className="font-bold text-purple-600 dark:text-purple-400">{Number(p.guest_satisfaction).toFixed(2)}★</span>,
    <span className="font-bold text-indigo-600 dark:text-indigo-400">${Number(p.upsell_revenue).toLocaleString()}</span>,
    <span>{Number(p.avg_response_min).toFixed(1)}m</span>,
    <span>{p.hours}h</span>,
    <span>{p.period_date || '—'}</span>,
    <div className="inline-flex gap-2">
      <button onClick={() => { setEditing({ kind: 'productivity', row: p }); setShowModal(true); }} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]"><Pencil className="w-4 h-4" /></button>
      <button onClick={() => handleDelete('productivity', p.id)} className="p-1 text-slate-400 hover:text-[var(--color-danger)]"><Trash2 className="w-4 h-4" /></button>
    </div>,
  ]), [filteredProd, employees]);

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Staff Management"
        subtitle="Front Office shift requirements, staffing, training, and productivity — integrated with HR."
        icon={Users}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} className={button.ghost} disabled={saving} title="Refresh">
              <RefreshCw size={16} />
            </button>
            <button onClick={() => {
              if (subTab === 'assignments') { setEditing(null); setShowRosterModal(true); fetchAvailableEmployees(); }
              else if (subTab === 'attendance') { setAttEditing(null); setAttForm({ staffId: '', staffName: '', shift: 'Morning', status: 'Present', checkIn: '', checkOut: '', hoursWorked: 0, overtimeHours: 0, notes: '' }); setShowAttModal(true); fetchAvailableEmployees(); }
              else { setEditing(null); setShowModal(true); }
            }} className={button.primary} disabled={saving}>
              <Plus size={16} /> {subTab === 'assignments' ? 'Add Staff' : subTab === 'attendance' ? 'Check In' : `Add ${subTab === 'shifts' ? 'Shift' : subTab === 'staffing' ? 'Staffing' : subTab === 'training' ? 'Training' : 'Productivity'}`}
            </button>
          </div>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Total Staff" value={stats.totalStaff} icon={Users} tone="accent" />
        <StatCard title="On Duty" value={stats.onDuty} icon={CheckCircle2} tone="success" />
        <StatCard title="Present Today" value={stats.attPresent} icon={CalendarCheck} tone="success" />
        <StatCard title="Late / Absent" value={stats.attLate + stats.attAbsent} icon={AlertTriangle} tone="warning" />
      </div>

      {/* Sub-tab navigation — F&B style */}
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

      {/* Search bar — F&B style */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search..."
          className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
        />
      </div>

      {/* Assignments sub-tab */}
      {subTab === 'assignments' && (
        <>
          {/* Extra filters for assignments */}
          <SectionCard pad="md">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl gap-1">
                {(['All', ...SHIFTS] as const).map(f => (
                  <button key={f} onClick={() => setShiftFilter(f)} className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${shiftFilter === f ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{f}</button>
                ))}
              </div>
              <select value={roleFilter} onChange={e => setRoleFilter(e.target.value as 'All' | Role)} className="bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-1.5 text-[10px] font-black uppercase text-slate-600 dark:text-slate-300 outline-none cursor-pointer">
                <option value="All">All Roles</option>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </SectionCard>

          <SectionCard title="Staff Assignments & Productivity" subtitle="Role · Station · Shift · Check-ins/out · Satisfaction · Upsell · Workload · HR Profile" icon={IdCard} tone="accent" pad="none">
            {staffError ? (
              <div className="flex items-center gap-3 text-[var(--color-danger)] px-6 py-4">
                <ServerCrash size={18} /><span className="text-sm font-bold">{staffError}</span>
                <button onClick={fetchStaff} className="ml-auto text-xs underline">Retry</button>
              </div>
            ) : loadingStaff ? <LoadingRow /> : (
              <DataTable
                headers={['Staff', 'Shift', 'Station', 'Check-Ins', 'Check-Outs', 'Satisfaction', 'Upsell', 'Response', 'Workload', 'HR Profile', '']}
                rows={assignmentRows}
                empty={filteredStaff.length === 0}
                emptyColSpan={11}
              />
            )}
          </SectionCard>
        </>
      )}

      {/* Attendance sub-tab */}
      {subTab === 'attendance' && (
        <>
          <SectionCard pad="md">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl gap-1 flex-wrap">
                {['All', 'Present', 'Late', 'Absent', 'On Leave', 'Sick', 'Day Off', 'Public Holiday', 'Half Day', 'Work From Home', 'Mission', 'Training Day'].map(f => (
                  <button key={f} onClick={() => setAttStatusFilter(f)} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${attStatusFilter === f ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{f}</button>
                ))}
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Staff Attendance Summary" subtitle="One row per staff · Click a row to view calendar detail" icon={CalendarCheck} tone="accent" pad="none">
            {loadingAttendance ? <LoadingRow /> : (
              <DataTable
                headers={['Staff', 'Attendance Rate', 'Status Breakdown', 'Total Hours', 'Overtime', 'HR Profile', '']}
                rows={attendanceSummaryRows}
                empty={filteredAttSummary.length === 0}
                emptyColSpan={7}
              />
            )}
          </SectionCard>
        </>
      )}

      {/* Shifts sub-tab */}
      {subTab === 'shifts' && (
        <SectionCard title="Shift Requirements" subtitle="Shift windows with coverage tracking" icon={CalendarDays} tone="accent" pad="none">
          {loadingShifts ? <LoadingRow /> : (
            <DataTable
              headers={['Shift', 'Start', 'End', 'Assigned', 'Required', 'Coverage', '']}
              rows={shiftRows}
              empty={filteredShifts.length === 0}
              emptyColSpan={7}
            />
          )}
        </SectionCard>
      )}

      {/* Staffing sub-tab */}
      {subTab === 'staffing' && (
        <SectionCard title="Staffing Requirements" subtitle="Per-station, per-role required vs. assigned headcount" icon={Users} tone="accent" pad="none">
          {loadingStaffing ? <LoadingRow /> : (
            <DataTable
              headers={['Station', 'Role', 'Shift', 'Required', 'Assigned', 'Gap', 'Status', '']}
              rows={staffingRows}
              empty={filteredStaffing.length === 0}
              emptyColSpan={8}
            />
          )}
        </SectionCard>
      )}

      {/* Training sub-tab */}
      {subTab === 'training' && (
        <SectionCard title="Training Requirements" subtitle="Course assignments and compliance" icon={GraduationCap} tone="accent" pad="none">
          {loadingTraining ? <LoadingRow /> : (
            <DataTable
              headers={['Course', 'Employee', 'Due Date', 'Status', '']}
              rows={trainingRows}
              empty={filteredTraining.length === 0}
              emptyColSpan={5}
            />
          )}
        </SectionCard>
      )}

      {/* Productivity sub-tab */}
      {subTab === 'productivity' && (
        <SectionCard title="Productivity" subtitle="Check-ins, check-outs, satisfaction, upsell revenue, response time" icon={Gauge} tone="accent" pad="none">
          {loadingProductivity ? <LoadingRow /> : (
            <DataTable
              headers={['Employee', 'Check-Ins', 'Check-Outs', 'Satisfaction', 'Upsell', 'Response', 'Hours', 'Period', '']}
              rows={prodRows}
              empty={filteredProd.length === 0}
              emptyColSpan={9}
            />
          )}
        </SectionCard>
      )}

      {/* ── Modal: Add/Edit (shifts/staffing/training/productivity) ── */}
      {showModal && (
        <StaffOperationsModal
          subTab={subTab}
          editing={editing}
          employees={employees}
          saving={saving}
          onClose={() => { setShowModal(false); setEditing(null); }}
          onSave={handleSave}
        />
      )}

      {/* ── Create staff modal (assignments) ─────────────────────────── */}
      {showRosterModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-lg border border-gray-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Add Front Office Staff</h2>
              <button onClick={() => setShowRosterModal(false)} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Field label="Name">
                  <input className={inputCls} value={rosterForm.name} onChange={e => setRosterForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Sarah J." />
                </Field>
              </div>
              <Field label="Role">
                <select className={inputCls} value={rosterForm.role} onChange={e => setRosterForm(f => ({ ...f, role: e.target.value as Role }))}>
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </Field>
              <Field label="Shift">
                <select className={inputCls} value={rosterForm.shift} onChange={e => setRosterForm(f => ({ ...f, shift: e.target.value as Shift }))}>
                  {SHIFTS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Station">
                <select className={inputCls} value={rosterForm.station} onChange={e => setRosterForm(f => ({ ...f, station: e.target.value }))}>
                  {STATIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Status">
                <input className={inputCls} value={rosterForm.status} onChange={e => setRosterForm(f => ({ ...f, status: e.target.value }))} placeholder="Active Duty" />
              </Field>
              <Field label="Check-Ins">
                <input type="number" min={0} className={inputCls} value={rosterForm.checkIns} onChange={e => setRosterForm(f => ({ ...f, checkIns: Number(e.target.value) }))} />
              </Field>
              <Field label="Check-Outs">
                <input type="number" min={0} className={inputCls} value={rosterForm.checkOuts} onChange={e => setRosterForm(f => ({ ...f, checkOuts: Number(e.target.value) }))} />
              </Field>
              <Field label="Guest Satisfaction (0-5)">
                <input type="number" min={0} max={5} step="0.01" className={inputCls} value={rosterForm.guestSatisfaction} onChange={e => setRosterForm(f => ({ ...f, guestSatisfaction: Number(e.target.value) }))} />
              </Field>
              <Field label="Upsell Revenue ($)">
                <input type="number" min={0} step="0.01" className={inputCls} value={rosterForm.upsellRevenue} onChange={e => setRosterForm(f => ({ ...f, upsellRevenue: Number(e.target.value) }))} />
              </Field>
              <Field label="Avg Response (min)">
                <input type="number" min={0} step="0.1" className={inputCls} value={rosterForm.avgResponseMin} onChange={e => setRosterForm(f => ({ ...f, avgResponseMin: Number(e.target.value) }))} />
              </Field>
              <Field label="Workload %">
                <input type="number" min={0} max={100} className={inputCls} value={rosterForm.workload} onChange={e => setRosterForm(f => ({ ...f, workload: Number(e.target.value) }))} />
              </Field>

              <div className="col-span-2 mt-2 pt-3 border-t border-slate-200 dark:border-slate-700">
                <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">HR Employee Link</span>
                <div className="flex gap-2 mb-3">
                  {(['new', 'existing', 'none'] as const).map(m => (
                    <button key={m} onClick={() => setRosterForm(f => ({ ...f, linkMode: m }))} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition ${rosterForm.linkMode === m ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                      {m === 'new' ? 'Create New' : m === 'existing' ? 'Link Existing' : 'No Link'}
                    </button>
                  ))}
                </div>
                {rosterForm.linkMode === 'existing' && (
                  <Field label="Select HR Employee">
                    <select className={inputCls} value={rosterForm.employeeId} onChange={e => setRosterForm(f => ({ ...f, employeeId: e.target.value }))}>
                      <option value="">— Select employee —</option>
                      {availableEmployees.map(emp => (
                        <option key={emp.id} value={emp.id}>{emp.name} — {emp.position || 'Staff'} ({emp.id})</option>
                      ))}
                    </select>
                  </Field>
                )}
                {rosterForm.linkMode === 'new' && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Email"><input className={inputCls} value={rosterForm.email} onChange={e => setRosterForm(f => ({ ...f, email: e.target.value }))} placeholder="name@hotel.com" /></Field>
                    <Field label="Phone"><input className={inputCls} value={rosterForm.phone} onChange={e => setRosterForm(f => ({ ...f, phone: e.target.value }))} placeholder="+1 555 0100" /></Field>
                    <Field label="Hire Date"><input type="date" className={inputCls} value={rosterForm.hireDate} onChange={e => setRosterForm(f => ({ ...f, hireDate: e.target.value }))} /></Field>
                    <Field label="Salary"><input type="number" min={0} className={inputCls} value={rosterForm.salary} onChange={e => setRosterForm(f => ({ ...f, salary: Number(e.target.value) }))} /></Field>
                  </div>
                )}
                {rosterForm.linkMode === 'none' && <p className="text-xs text-slate-400">No HR employee record will be created. You can link later.</p>}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <button onClick={() => setShowRosterModal(false)} className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
              <button onClick={createStaff} disabled={actingOn === 'new'} className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 disabled:opacity-50">
                {actingOn === 'new' ? 'Adding…' : 'Add Staff'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Link employee modal ──────────────────────────────────────── */}
      {linkTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-md border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Link {linkTarget.name} to HR Employee</h2>
              <button onClick={() => { setLinkTarget(null); setLinkEmployeeId(''); }} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
              Select an HR employee record to link with this front office staff member.
            </p>
            <Field label="HR Employee">
              <select className={inputCls} value={linkEmployeeId} onChange={e => setLinkEmployeeId(e.target.value)}>
                <option value="">— Select employee —</option>
                {availableEmployees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.name} — {emp.position || 'Staff'} ({emp.email || emp.phone || emp.id})</option>
                ))}
              </select>
            </Field>
            {availableEmployees.length === 0 && (
              <p className="text-xs text-slate-400 mt-2">No unlinked employees available.</p>
            )}
            <div className="flex justify-end gap-2 pt-4">
              <button onClick={() => { setLinkTarget(null); setLinkEmployeeId(''); }} className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
              <button onClick={linkEmployee} disabled={actingOn === linkTarget.id || !linkEmployeeId} className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 disabled:opacity-50">
                {actingOn === linkTarget.id ? 'Linking…' : 'Link Employee'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm modal ─────────────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-md border border-gray-200 dark:border-slate-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Remove Staff Member</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Remove <span className="font-bold">{deleteTarget.name}</span> ({deleteTarget.role}) from the active front office team? Their HR employee record is preserved.
            </p>
            <div className="flex justify-end gap-2 pt-4">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
              <button onClick={() => deleteTarget && deleteStaff(deleteTarget)} disabled={actingOn === deleteTarget.id} className="px-4 py-2 text-sm font-bold text-white bg-rose-600 rounded-xl hover:bg-rose-700 disabled:opacity-50">
                {actingOn === deleteTarget.id ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Attendance calendar detail modal ──────────────────────────── */}
      {calendarStaff && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setCalendarStaff(null)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden border border-slate-200 dark:border-slate-700 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-700">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-sm font-black text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
                  {calendarStaff.staffName.split(' ').map(n => n[0]).join('')}
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">{calendarStaff.staffName}</h2>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-slate-400 font-mono">{calendarStaff.staffId}</span>
                    {calendarStaff.employeeId && <Badge tone="success" icon={Link2}>HR Linked</Badge>}
                    {calendarStaff.position && <span className="text-[10px] text-slate-500">{calendarStaff.position}</span>}
                  </div>
                </div>
              </div>
              <button onClick={() => setCalendarStaff(null)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition"><X className="w-5 h-5" /></button>
            </div>

            <div className="grid grid-cols-4 gap-3 p-5 border-b border-slate-100 dark:border-slate-700">
              <div className="text-center">
                <div className="text-2xl font-bold text-slate-900 dark:text-white">{calendarStaff.attendanceRate}%</div>
                <div className="text-[10px] font-bold text-slate-400 uppercase">Attendance Rate</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-emerald-600">{calendarStaff.present}</div>
                <div className="text-[10px] font-bold text-slate-400 uppercase">Present</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-slate-900 dark:text-white">{calendarStaff.totalHours.toFixed(0)}h</div>
                <div className="text-[10px] font-bold text-slate-400 uppercase">Total Hours</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-amber-600">{calendarStaff.totalOvertime.toFixed(1)}h</div>
                <div className="text-[10px] font-bold text-slate-400 uppercase">Overtime</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 px-5 py-2 border-b border-slate-100 dark:border-slate-700">
              {[
                ['Present', calendarStaff.present], ['Late', calendarStaff.late], ['Absent', calendarStaff.absent],
                ['On Leave', calendarStaff.onLeave], ['Sick', calendarStaff.sick], ['Half Day', calendarStaff.halfDay],
                ['Day Off', calendarStaff.dayOff], ['Public Holiday', calendarStaff.publicHoliday],
                ['Work From Home', calendarStaff.workFromHome], ['Mission', calendarStaff.mission], ['Training Day', calendarStaff.trainingDay],
              ].filter(([, n]) => (n as number) > 0).map(([label, n]) => (
                <span key={label as string} className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-600 dark:text-slate-300">
                  <span className={`w-2.5 h-2.5 rounded-full ${ATT_STATUS_COLOR[label as string] || 'bg-slate-300'}`} />
                  {label} ({n as number})
                </span>
              ))}
            </div>

            <div className="overflow-y-auto p-5" style={{ maxHeight: '300px' }}>
              <div className="text-[10px] font-black text-slate-400 uppercase mb-3">Attendance History</div>
              <div className="space-y-2">
                {calendarStaff.records.map(r => (
                  <div key={r.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-850 hover:bg-slate-100 dark:hover:bg-slate-800 transition group">
                    <div className={`w-1 h-10 rounded-full ${ATT_STATUS_COLOR[r.status] || 'bg-slate-300'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-900 dark:text-white">{r.attendanceDate}</span>
                        <Badge tone={r.shift === 'Morning' ? 'accent' : r.shift === 'Evening' ? 'info' : 'neutral'}>{r.shift}</Badge>
                        <Badge tone={ATT_STATUS_TONE[r.status] || 'neutral'}>{r.status}</Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-500">
                        {r.checkIn && <span className="flex items-center gap-0.5"><LogIn size={10} /> {new Date(r.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                        {r.checkOut && <span className="flex items-center gap-0.5"><LogOut size={10} /> {new Date(r.checkOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                        {r.hoursWorked > 0 && <span>{r.hoursWorked.toFixed(1)}h</span>}
                        {r.overtimeHours > 0 && <span className="text-amber-500">+{r.overtimeHours.toFixed(1)}h OT</span>}
                        {r.notes && <span className="truncate">· {r.notes}</span>}
                      </div>
                    </div>
                    <div className="inline-flex gap-1 opacity-0 group-hover:opacity-100 transition">
                      <button onClick={() => { setAttEditing(r); setAttForm({ staffId: r.staffId, staffName: r.staffName, shift: r.shift as Shift, status: r.status, checkIn: r.checkIn || '', checkOut: r.checkOut || '', hoursWorked: r.hoursWorked, overtimeHours: r.overtimeHours, notes: r.notes || '' }); setShowAttModal(true); }} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => deleteAttendance(r)} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-between items-center p-4 border-t border-slate-100 dark:border-slate-700">
              {calendarStaff.email && (
                <div className="flex items-center gap-3 text-[10px] text-slate-500">
                  {calendarStaff.email && <span className="flex items-center gap-1"><Mail size={10} /> {calendarStaff.email}</span>}
                  {calendarStaff.phone && <span className="flex items-center gap-1"><Phone size={10} /> {calendarStaff.phone}</span>}
                </div>
              )}
              <button onClick={() => { setCalendarStaff(null); setAttEditing(null); setAttForm({ staffId: calendarStaff.staffId, staffName: calendarStaff.staffName, shift: 'Morning' as Shift, status: 'Present', checkIn: '', checkOut: '', hoursWorked: 0, overtimeHours: 0, notes: '' }); setShowAttModal(true); }} className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 inline-flex items-center gap-1.5">
                <LogIn size={14} /> Check In
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Attendance modal ─────────────────────────────────────────── */}
      {showAttModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-lg border border-gray-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">{attEditing ? `Edit Attendance — ${attEditing.staffName}` : 'Check In Staff'}</h2>
              <button onClick={() => { setShowAttModal(false); setAttEditing(null); }} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {!attEditing && (
                <div className="col-span-2">
                  <Field label="Select Staff Member">
                    <select className={inputCls} value={attForm.staffId} onChange={e => {
                      const s = staff.find(x => x.id === e.target.value);
                      setAttForm(f => ({ ...f, staffId: e.target.value, staffName: s?.name || '', shift: (s?.shift || 'Morning') as Shift }));
                    }}>
                      <option value="">— Select staff —</option>
                      {staff.map(s => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
                    </select>
                  </Field>
                </div>
              )}
              <Field label="Shift">
                <select className={inputCls} value={attForm.shift} onChange={e => setAttForm(f => ({ ...f, shift: e.target.value as Shift }))}>
                  {SHIFTS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Status">
                <select className={inputCls} value={attForm.status} onChange={e => setAttForm(f => ({ ...f, status: e.target.value }))}>
                  {['Present', 'Late', 'Absent', 'On Leave', 'Sick', 'Half Day', 'Day Off', 'Public Holiday', 'Work From Home', 'Mission', 'Training Day'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              {attEditing && (
                <>
                  <Field label="Check-In Time">
                    <input type="datetime-local" className={inputCls} value={attForm.checkIn ? new Date(attForm.checkIn).toISOString().slice(0, 16) : ''} onChange={e => setAttForm(f => ({ ...f, checkIn: e.target.value ? new Date(e.target.value).toISOString() : '' }))} />
                  </Field>
                  <Field label="Check-Out Time">
                    <input type="datetime-local" className={inputCls} value={attForm.checkOut ? new Date(attForm.checkOut).toISOString().slice(0, 16) : ''} onChange={e => setAttForm(f => ({ ...f, checkOut: e.target.value ? new Date(e.target.value).toISOString() : '' }))} />
                  </Field>
                  <Field label="Hours Worked">
                    <input type="number" min={0} step="0.25" className={inputCls} value={attForm.hoursWorked} onChange={e => setAttForm(f => ({ ...f, hoursWorked: Number(e.target.value) }))} />
                  </Field>
                  <Field label="Overtime Hours">
                    <input type="number" min={0} step="0.25" className={inputCls} value={attForm.overtimeHours} onChange={e => setAttForm(f => ({ ...f, overtimeHours: Number(e.target.value) }))} />
                  </Field>
                </>
              )}
              <div className="col-span-2">
                <Field label="Notes">
                  <input className={inputCls} value={attForm.notes} onChange={e => setAttForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes…" />
                </Field>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <button onClick={() => { setShowAttModal(false); setAttEditing(null); }} className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
              <button onClick={saveAttendance} disabled={saving} className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Saving…' : attEditing ? 'Update' : 'Check In'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────
function fmtTime(t: string | null | undefined): string {
  if (!t) return '—';
  return t.length >= 5 ? t.slice(0, 5) : t;
}

// ── Modal for shifts/staffing/training/productivity ────────────────────
interface ModalProps {
  subTab: SubTab;
  editing: { kind: SubTab; row: any } | null;
  employees: Employee[];
  saving: boolean;
  onClose: () => void;
  onSave: (kind: SubTab, payload: any, id?: string) => void;
}

function StaffOperationsModal({ subTab, editing, employees, saving, onClose, onSave }: ModalProps) {
  const row = editing?.row;
  const isEdit = !!row;

  const [name, setName] = useState(row?.name || '');
  const [startTime, setStartTime] = useState(row?.start_time?.slice(0, 5) || '07:00');
  const [endTime, setEndTime] = useState(row?.end_time?.slice(0, 5) || '15:00');
  const [assignedStaff, setAssignedStaff] = useState(row?.assigned_staff ?? 0);
  const [requiredStaff, setRequiredStaff] = useState(row?.required_staff ?? 1);

  const [station, setStation] = useState(row?.station || '');
  const [role, setRole] = useState(row?.role || 'Front Desk Agent');
  const [requiredCount, setRequiredCount] = useState(row?.required_count ?? 1);
  const [assignedCount, setAssignedCount] = useState(row?.assigned_count ?? 0);
  const [shift, setShift] = useState(row?.shift || 'Morning');

  const [course, setCourse] = useState(row?.course || '');
  const [employeeId, setEmployeeId] = useState(row?.employee_id || '');
  const [dueDate, setDueDate] = useState(row?.due_date || '');
  const [trainStatus, setTrainStatus] = useState(row?.status || 'Not Started');

  const [checkIns, setCheckIns] = useState(row?.check_ins ?? 0);
  const [checkOuts, setCheckOuts] = useState(row?.check_outs ?? 0);
  const [guestSatisfaction, setGuestSatisfaction] = useState(row?.guest_satisfaction ?? 0);
  const [upsellRevenue, setUpsellRevenue] = useState(row?.upsell_revenue ?? 0);
  const [avgResponseMin, setAvgResponseMin] = useState(row?.avg_response_min ?? 0);
  const [hours, setHours] = useState(row?.hours ?? 8);
  const [periodDate, setPeriodDate] = useState(row?.period_date || '');

  const submit = () => {
    if (subTab === 'shifts') {
      if (!name) return alert('Enter a shift name');
      onSave('shifts', { name, startTime, endTime, assignedStaff, requiredStaff }, isEdit ? row.id : undefined);
    } else if (subTab === 'staffing') {
      onSave('staffing', { station: station || null, role, requiredCount, assignedCount, shift }, isEdit ? row.id : undefined);
    } else if (subTab === 'training') {
      if (!course) return alert('Course is required');
      onSave('training', { course, employeeId: employeeId || null, dueDate: dueDate || null, status: trainStatus }, isEdit ? row.id : undefined);
    } else if (subTab === 'productivity') {
      onSave('productivity', { employeeId: employeeId || null, checkIns, checkOuts, guestSatisfaction, upsellRevenue, avgResponseMin, hours, periodDate: periodDate || null }, isEdit ? row.id : undefined);
    }
  };

  const titleMap: Record<SubTab, string> = {
    assignments: 'Staff',
    attendance: 'Attendance Record',
    shifts: 'Shift Requirement',
    staffing: 'Staffing Requirement',
    training: 'Training Requirement',
    productivity: 'Productivity Record',
  };

  const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-md border border-gray-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">{isEdit ? 'Edit' : 'New'} {titleMap[subTab]}</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          {/* Shifts */}
          {subTab === 'shifts' && (
            <>
              <div><label className={labelCls}>Shift Name</label><input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Morning Shift" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Start Time</label><input type="time" className={inputCls} value={startTime} onChange={e => setStartTime(e.target.value)} /></div>
                <div><label className={labelCls}>End Time</label><input type="time" className={inputCls} value={endTime} onChange={e => setEndTime(e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Assigned Staff</label><input type="number" min={0} className={inputCls} value={assignedStaff} onChange={e => setAssignedStaff(Number(e.target.value))} /></div>
                <div><label className={labelCls}>Required Staff</label><input type="number" min={0} className={inputCls} value={requiredStaff} onChange={e => setRequiredStaff(Number(e.target.value))} /></div>
              </div>
            </>
          )}

          {/* Staffing */}
          {subTab === 'staffing' && (
            <>
              <div><label className={labelCls}>Station</label>
                <select className={inputCls} value={station} onChange={e => setStation(e.target.value)}>
                  <option value="">Any</option>
                  {STATIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div><label className={labelCls}>Role</label>
                <select className={inputCls} value={role} onChange={e => setRole(e.target.value)}>
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div><label className={labelCls}>Shift</label>
                <select className={inputCls} value={shift} onChange={e => setShift(e.target.value)}>
                  {SHIFTS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Required</label><input type="number" min={0} className={inputCls} value={requiredCount} onChange={e => setRequiredCount(Number(e.target.value))} /></div>
                <div><label className={labelCls}>Assigned</label><input type="number" min={0} className={inputCls} value={assignedCount} onChange={e => setAssignedCount(Number(e.target.value))} /></div>
              </div>
            </>
          )}

          {/* Training */}
          {subTab === 'training' && (
            <>
              <div><label className={labelCls}>Course</label><input className={inputCls} value={course} onChange={e => setCourse(e.target.value)} placeholder="e.g. PMS System Training" /></div>
              <div><label className={labelCls}>Employee</label>
                <select className={inputCls} value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
                  <option value="">Select employee...</option>
                  {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name} — {emp.position || 'Staff'}</option>)}
                </select>
              </div>
              <div><label className={labelCls}>Due Date</label><input type="date" className={inputCls} value={dueDate} onChange={e => setDueDate(e.target.value)} /></div>
              <div><label className={labelCls}>Status</label>
                <select className={inputCls} value={trainStatus} onChange={e => setTrainStatus(e.target.value)}>
                  {TRAIN_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </>
          )}

          {/* Productivity */}
          {subTab === 'productivity' && (
            <>
              <div><label className={labelCls}>Employee</label>
                <select className={inputCls} value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
                  <option value="">Select employee...</option>
                  {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name} — {emp.position || 'Staff'}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Check-Ins</label><input type="number" min={0} className={inputCls} value={checkIns} onChange={e => setCheckIns(Number(e.target.value))} /></div>
                <div><label className={labelCls}>Check-Outs</label><input type="number" min={0} className={inputCls} value={checkOuts} onChange={e => setCheckOuts(Number(e.target.value))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Guest Satisfaction (0-5)</label><input type="number" min={0} max={5} step="0.01" className={inputCls} value={guestSatisfaction} onChange={e => setGuestSatisfaction(Number(e.target.value))} /></div>
                <div><label className={labelCls}>Upsell Revenue ($)</label><input type="number" min={0} step="0.01" className={inputCls} value={upsellRevenue} onChange={e => setUpsellRevenue(Number(e.target.value))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Avg Response (min)</label><input type="number" min={0} step="0.1" className={inputCls} value={avgResponseMin} onChange={e => setAvgResponseMin(Number(e.target.value))} /></div>
                <div><label className={labelCls}>Hours</label><input type="number" min={0} className={inputCls} value={hours} onChange={e => setHours(Number(e.target.value))} /></div>
              </div>
              <div><label className={labelCls}>Period Date</label><input type="date" className={inputCls} value={periodDate} onChange={e => setPeriodDate(e.target.value)} /></div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-3">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
            <button onClick={submit} disabled={saving} className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Saving…' : isEdit ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
