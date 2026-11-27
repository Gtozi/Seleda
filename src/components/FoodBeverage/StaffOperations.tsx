/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 *
 * F&B Staff Operations module — F&B Portal.
 * Owns Staff Assignment, Outlet Staffing Requirements, Shift Requirements,
 * Training Requirements, and Productivity.
 * Per spec §24 (F&B Staff Operations). HR owns employee master/attendance/payroll.
 *
 * All data is persisted to the database via the /api/fb/staff-operations/* routes
 * (see src/server/routes/fbStaffOperations.routes.ts). The HR employee master is
 * fetched from /api/hr/employees.
 */

import { useMemo, useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  IdCard,
  Users,
  CalendarDays,
  GraduationCap,
  Gauge,
  Plus,
  Pencil,
  Trash2,
  Search,
  Clock,
  X,
  CheckCircle2,
  AlertTriangle,
  Building2,
  Mail,
  Phone,
  Loader2,
  CalendarCheck,
  LogIn,
  LogOut,
  Link2,
  RefreshCw,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';

type SubTab = 'assignments' | 'attendance' | 'staffing' | 'shifts' | 'training' | 'productivity';

interface HREmployee {
  id: string;
  name: string;
  email: string;
  phone: string;
  department: string;
  position: string;
  status: string;
  bank_account?: string;
  pension_number?: string;
}

interface Outlet {
  id: string;
  name: string;
  type: string;
}

// F&B staff roster — mirrors HK's housekeeping_staff shape
interface FBStaff {
  id: string;
  name: string;
  avatar: string;
  role: 'Server' | 'Bartender' | 'Chef' | 'Sous Chef' | 'Host' | 'Busser' | 'Manager';
  shift: 'Morning' | 'Evening' | 'Night';
  outletId: string | null;
  outletName: string | null;
  tablesServed: number;
  avgServiceTimeMin: number;
  inspectionScore: number;
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

interface Assignment {
  id: string;
  employee_id: string;
  outlet_id: string | null;
  role: 'Server' | 'Bartender' | 'Chef' | 'Sous Chef' | 'Host' | 'Busser' | 'Manager';
  shift: 'Morning' | 'Evening' | 'Night';
  date: string;
  status: 'Scheduled' | 'On Duty' | 'Completed' | 'Absent';
  notes?: string | null;
  outlets?: { name: string } | null;
}

interface StaffingRequirement {
  id: string;
  outlet_id: string | null;
  role: string;
  required_count: number;
  assigned_count: number;
  meal_period: 'Breakfast' | 'Lunch' | 'Dinner' | 'All Day';
  outlets?: { name: string } | null;
}

interface Shift {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  outlet_id: string | null;
  assigned_staff: number;
  required_staff: number;
  outlets?: { name: string } | null;
}

interface Training {
  id: string;
  course: string;
  employee_id: string;
  staff_id: string | null;
  outlet_id: string | null;
  due_date: string | null;
  status: 'Not Started' | 'In Progress' | 'Completed' | 'Overdue';
  outlets?: { name: string } | null;
}

interface ProductivityRow {
  id: string;
  employee_id: string;
  staff_id: string | null;
  outlet_id: string | null;
  covers_served: number;
  revenue: number;
  hours: number;
  rev_per_hour: number;
  period_date: string | null;
  outlets?: { name: string } | null;
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

const ATT_STATUS_LIST = ['Present', 'Late', 'Absent', 'On Leave', 'Sick', 'Half Day', 'Day Off', 'Public Holiday', 'Work From Home', 'Mission', 'Training Day'];

const SUB_TABS: { id: SubTab; label: string; icon: typeof IdCard }[] = [
  { id: 'assignments', label: 'Staff Assignment', icon: IdCard },
  { id: 'attendance', label: 'Attendance', icon: CalendarCheck },
  { id: 'staffing', label: 'Outlet Staffing', icon: Users },
  { id: 'shifts', label: 'Shift Requirements', icon: CalendarDays },
  { id: 'training', label: 'Training', icon: GraduationCap },
  { id: 'productivity', label: 'Productivity', icon: Gauge },
];

const ASSIGN_TONE: Record<Assignment['status'], 'info' | 'success' | 'neutral' | 'danger'> = {
  Scheduled: 'info',
  'On Duty': 'success',
  Completed: 'neutral',
  Absent: 'danger',
};

const TRAIN_TONE: Record<Training['status'], 'info' | 'warning' | 'success' | 'danger'> = {
  'Not Started': 'info',
  'In Progress': 'warning',
  Completed: 'success',
  Overdue: 'danger',
};

const ROLES = ['Server', 'Bartender', 'Chef', 'Sous Chef', 'Host', 'Busser', 'Manager'] as const;
const SHIFTS = ['Morning', 'Evening', 'Night'] as const;
const MEAL_PERIODS = ['Breakfast', 'Lunch', 'Dinner', 'All Day'] as const;
const TRAIN_STATUSES = ['Not Started', 'In Progress', 'Completed', 'Overdue'] as const;
const ASSIGN_STATUSES = ['Scheduled', 'On Duty', 'Completed', 'Absent'] as const;

const ROLE_TONE: Record<string, StatusTone> = {
  Server: 'accent', Bartender: 'info', Chef: 'warning',
  'Sous Chef': 'success', Host: 'neutral', Busser: 'neutral', Manager: 'success',
};

const workloadTone = (w: number): StatusTone => (w > 80 ? 'danger' : w > 60 ? 'warning' : 'success');

const API = '/api/fb/staff-operations';

// ── Auth headers ───────────────────────────────────────────────────────
function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

export default function StaffOperations() {
  const { currentPropertyId, addNotification } = useERP();
  const [subTab, setSubTab] = useState<SubTab>('assignments');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<{ kind: SubTab; row: any } | null>(null);

  const [hrEmployees, setHrEmployees] = useState<HREmployee[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [staffing, setStaffing] = useState<StaffingRequirement[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [training, setTraining] = useState<Training[]>([]);
  const [productivity, setProductivity] = useState<ProductivityRow[]>([]);

  // Staff roster state (fb_staff — mirrors HK's housekeeping_staff)
  const [staff, setStaff] = useState<FBStaff[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [shiftFilter, setShiftFilter] = useState<'All' | 'Morning' | 'Evening' | 'Night'>('All');
  const [roleFilter, setRoleFilter] = useState<'All' | string>('All');
  const [availableEmployees, setAvailableEmployees] = useState<AvailableEmployee[]>([]);
  const [linkTarget, setLinkTarget] = useState<FBStaff | null>(null);
  const [linkEmployeeId, setLinkEmployeeId] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<FBStaff | null>(null);
  const [showStaffForm, setShowStaffForm] = useState(false);
  const [staffForm, setStaffForm] = useState({
    name: '', role: 'Server' as FBStaff['role'], shift: 'Morning' as FBStaff['shift'],
    outletId: '', status: 'Active Duty',
    tablesServed: 0, avgServiceTimeMin: 0, inspectionScore: 0, workload: 0,
    linkMode: 'new' as 'new' | 'existing' | 'none',
    employeeId: '',
    email: '', phone: '', hireDate: '', salary: 0,
  });

  // Attendance state
  const [attSummary, setAttSummary] = useState<StaffAttendanceSummary[]>([]);
  const [loadingAttendance, setLoadingAttendance] = useState(true);
  const [attStatusFilter, setAttStatusFilter] = useState<'All' | string>('All');
  const [attEditing, setAttEditing] = useState<AttendanceRecord | null>(null);
  const [showAttModal, setShowAttModal] = useState(false);
  const [attForm, setAttForm] = useState({
    staffId: '', staffName: '', shift: 'Morning' as 'Morning' | 'Evening' | 'Night', status: 'Present',
    checkIn: '', checkOut: '', hoursWorked: 0, overtimeHours: 0, notes: '',
  });
  const [calendarStaff, setCalendarStaff] = useState<StaffAttendanceSummary | null>(null);

  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [loadingOutlets, setLoadingOutlets] = useState(true);
  const [loadingData, setLoadingData] = useState<Record<SubTab, boolean>>({
    assignments: true,
    attendance: true,
    staffing: true,
    shifts: true,
    training: true,
    productivity: true,
  });
  const [saving, setSaving] = useState(false);

  // ── Lookups ──────────────────────────────────────────────────────
  const fetchHREmployees = useCallback(async () => {
    setLoadingEmployees(true);
    try {
      const response = await fetch('/api/hr/employees', { headers: authHeaders(true) });
      if (response.ok) {
        const data = await response.json();
        setHrEmployees(data);
      } else {
        setHrEmployees([]);
        addNotification('No employees found in HR', 'warning', 'F&B');
      }
    } catch (error) {
      addNotification('Failed to fetch HR employees', 'warning', 'F&B');
      setHrEmployees([]);
    } finally {
      setLoadingEmployees(false);
    }
  }, [addNotification]);

  const fetchOutlets = useCallback(async () => {
    setLoadingOutlets(true);
    try {
      const response = await fetch(`${API}/outlets`, { headers: authHeaders(true) });
      if (response.ok) {
        const data = await response.json();
        setOutlets(data);
      } else {
        setOutlets([]);
      }
    } catch (error) {
      setOutlets([]);
    } finally {
      setLoadingOutlets(false);
    }
  }, []);

  useEffect(() => {
    fetchHREmployees();
    fetchOutlets();
  }, [fetchHREmployees, fetchOutlets]);

  // ── Staff roster fetcher (fb_staff) ──────────────────────────────
  const fetchStaff = useCallback(async () => {
    if (!currentPropertyId) { setLoadingStaff(false); return; }
    setLoadingStaff(true); setStaffError(null);
    try {
      const res = await fetch(`${API}/staff/${currentPropertyId}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load staff (${res.status})`);
      const data = await res.json() as { staff: FBStaff[] };
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
      const res = await fetch(`${API}/staff/available-employees/${currentPropertyId}`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json() as { employees: AvailableEmployee[] };
      setAvailableEmployees(data.employees || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  // ── Data fetchers per sub-tab (property-scoped) ───────────────────
  const fetchAssignments = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoadingData(s => ({ ...s, assignments: true }));
    try {
      const r = await fetch(`${API}/assignments/${currentPropertyId}`, { headers: authHeaders(true) });
      if (r.ok) setAssignments(await r.json());
      else addNotification('Failed to load assignments', 'warning', 'F&B');
    } catch {
      addNotification('Failed to load assignments', 'warning', 'F&B');
    } finally {
      setLoadingData(s => ({ ...s, assignments: false }));
    }
  }, [addNotification, currentPropertyId]);

  const fetchStaffing = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoadingData(s => ({ ...s, staffing: true }));
    try {
      const r = await fetch(`${API}/staffing/${currentPropertyId}`, { headers: authHeaders(true) });
      if (r.ok) setStaffing(await r.json());
      else addNotification('Failed to load staffing', 'warning', 'F&B');
    } catch {
      addNotification('Failed to load staffing', 'warning', 'F&B');
    } finally {
      setLoadingData(s => ({ ...s, staffing: false }));
    }
  }, [addNotification, currentPropertyId]);

  const fetchShifts = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoadingData(s => ({ ...s, shifts: true }));
    try {
      const r = await fetch(`${API}/shifts/${currentPropertyId}`, { headers: authHeaders(true) });
      if (r.ok) setShifts(await r.json());
      else addNotification('Failed to load shifts', 'warning', 'F&B');
    } catch {
      addNotification('Failed to load shifts', 'warning', 'F&B');
    } finally {
      setLoadingData(s => ({ ...s, shifts: false }));
    }
  }, [addNotification, currentPropertyId]);

  const fetchTraining = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoadingData(s => ({ ...s, training: true }));
    try {
      const r = await fetch(`${API}/training/${currentPropertyId}`, { headers: authHeaders(true) });
      if (r.ok) setTraining(await r.json());
      else addNotification('Failed to load training', 'warning', 'F&B');
    } catch {
      addNotification('Failed to load training', 'warning', 'F&B');
    } finally {
      setLoadingData(s => ({ ...s, training: false }));
    }
  }, [addNotification, currentPropertyId]);

  const fetchProductivity = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoadingData(s => ({ ...s, productivity: true }));
    try {
      const r = await fetch(`${API}/productivity/${currentPropertyId}`, { headers: authHeaders(true) });
      if (r.ok) setProductivity(await r.json());
      else addNotification('Failed to load productivity', 'warning', 'F&B');
    } catch {
      addNotification('Failed to load productivity', 'warning', 'F&B');
    } finally {
      setLoadingData(s => ({ ...s, productivity: false }));
    }
  }, [addNotification, currentPropertyId]);

  // ── Staff roster CRUD (fb_staff) ──────────────────────────────────
  const saveStaff = useCallback(async () => {
    if (!currentPropertyId) return;
    if (!staffForm.name.trim()) { addNotification('Name is required', 'warning', 'F&B'); return; }
    setSaving(true);
    try {
      const body: Record<string, any> = {
        propertyId: currentPropertyId,
        name: staffForm.name.trim(),
        role: staffForm.role,
        shift: staffForm.shift,
        outletId: staffForm.outletId || null,
        status: staffForm.status,
        tablesServed: Number(staffForm.tablesServed) || 0,
        avgServiceTimeMin: Number(staffForm.avgServiceTimeMin) || 0,
        inspectionScore: Number(staffForm.inspectionScore) || 0,
        workload: Number(staffForm.workload) || 0,
      };
      if (staffForm.linkMode === 'existing' && staffForm.employeeId) {
        body.employeeId = staffForm.employeeId;
      } else if (staffForm.linkMode === 'new') {
        body.email = staffForm.email || undefined;
        body.phone = staffForm.phone || undefined;
        body.hireDate = staffForm.hireDate || undefined;
        body.salary = Number(staffForm.salary) || undefined;
      }
      const res = await fetch(`${API}/staff`, {
        method: 'POST', headers: authHeaders(true), body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to create staff (${res.status})`);
      }
      addNotification(`Staff ${staffForm.name} added`, 'success', 'F&B');
      setShowStaffForm(false);
      setStaffForm({
        name: '', role: 'Server', shift: 'Morning', outletId: '', status: 'Active Duty',
        tablesServed: 0, avgServiceTimeMin: 0, inspectionScore: 0, workload: 0,
        linkMode: 'new', employeeId: '', email: '', phone: '', hireDate: '', salary: 0,
      });
      await fetchStaff();
      await fetchAvailableEmployees();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save staff', 'danger', 'F&B');
    } finally {
      setSaving(false);
    }
  }, [currentPropertyId, staffForm, addNotification, fetchStaff, fetchAvailableEmployees]);

  const updateStaffField = useCallback(async (id: string, patch: Record<string, any>) => {
    setActingOn(id);
    try {
      const res = await fetch(`${API}/staff/${id}`, {
        method: 'PUT', headers: authHeaders(true), body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to update staff (${res.status})`);
      }
      await fetchStaff();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update staff', 'danger', 'F&B');
    } finally {
      setActingOn(null);
    }
  }, [addNotification, fetchStaff]);

  const deleteStaff = useCallback(async (id: string, hard = false) => {
    setActingOn(id);
    try {
      const res = await fetch(`${API}/staff/${id}?hard=${hard}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to delete staff (${res.status})`);
      }
      addNotification('Staff removed', 'success', 'F&B');
      setDeleteTarget(null);
      await fetchStaff();
      await fetchAvailableEmployees();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete staff', 'danger', 'F&B');
    } finally {
      setActingOn(null);
    }
  }, [addNotification, fetchStaff, fetchAvailableEmployees]);

  const linkEmployee = useCallback(async () => {
    if (!linkTarget || !linkEmployeeId) return;
    setActingOn(linkTarget.id);
    try {
      const res = await fetch(`${API}/staff/${linkTarget.id}`, {
        method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ employeeId: linkEmployeeId }),
      });
      if (!res.ok) throw new Error(`Failed to link employee (${res.status})`);
      addNotification(`Linked ${linkTarget.name} to HR employee`, 'success', 'F&B');
      setLinkTarget(null); setLinkEmployeeId('');
      await fetchStaff();
      await fetchAvailableEmployees();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to link employee', 'danger', 'F&B');
    } finally {
      setActingOn(null);
    }
  }, [linkTarget, linkEmployeeId, addNotification, fetchStaff, fetchAvailableEmployees]);

  const unlinkEmployee = useCallback(async (s: FBStaff) => {
    setActingOn(s.id);
    try {
      const res = await fetch(`${API}/staff/${s.id}`, {
        method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ employeeId: null }),
      });
      if (!res.ok) throw new Error(`Failed to unlink (${res.status})`);
      addNotification(`Unlinked ${s.name}`, 'success', 'F&B');
      await fetchStaff();
      await fetchAvailableEmployees();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to unlink', 'danger', 'F&B');
    } finally {
      setActingOn(null);
    }
  }, [addNotification, fetchStaff, fetchAvailableEmployees]);

  // ── Attendance fetcher + CRUD ─────────────────────────────────────
  const fetchAttendance = useCallback(async () => {
    setLoadingAttendance(true);
    try {
      const r = await fetch(`${API}/attendance/summary`, { headers: authHeaders(true) });
      if (!r.ok) throw new Error(`Failed to load attendance (${r.status})`);
      const data = await r.json() as { summary: StaffAttendanceSummary[] };
      setAttSummary(data.summary || []);
    } catch {
      setAttSummary([]);
    } finally {
      setLoadingAttendance(false);
    }
  }, []);

  const saveAttendance = async () => {
    if (!currentPropertyId || !attForm.staffId || !attForm.staffName) {
      addNotification('Employee is required', 'warning', 'F&B');
      return;
    }
    setSaving(true);
    try {
      if (attEditing) {
        const res = await fetch(`${API}/attendance/${attEditing.id}`, {
          method: 'PUT', headers: authHeaders(true),
          body: JSON.stringify({
            status: attForm.status, shift: attForm.shift,
            checkIn: attForm.checkIn || null, checkOut: attForm.checkOut || null,
            hoursWorked: attForm.hoursWorked, overtimeHours: attForm.overtimeHours,
            notes: attForm.notes || null,
          }),
        });
        if (!res.ok) throw new Error('Failed to update attendance');
        addNotification(`${attForm.staffName} attendance updated`, 'success', 'F&B');
      } else {
        const res = await fetch(`${API}/attendance`, {
          method: 'POST', headers: authHeaders(true),
          body: JSON.stringify({
            propertyId: currentPropertyId, staffId: attForm.staffId, staffName: attForm.staffName,
            shift: attForm.shift, status: attForm.status,
            checkIn: attForm.checkIn || null, notes: attForm.notes || null,
          }),
        });
        if (!res.ok) throw new Error('Failed to check in');
        addNotification(`${attForm.staffName} checked in`, 'success', 'F&B');
      }
      setShowAttModal(false); setAttEditing(null);
      setAttForm({ staffId: '', staffName: '', shift: 'Morning', status: 'Present', checkIn: '', checkOut: '', hoursWorked: 0, overtimeHours: 0, notes: '' });
      fetchAttendance();
    } catch (e: any) {
      addNotification(e?.message || 'Attendance save failed', 'warning', 'F&B');
    } finally { setSaving(false); }
  };

  const quickCheckOut = async (rec: AttendanceRecord) => {
    const now = new Date().toISOString();
    const checkInTime = rec.checkIn ? new Date(rec.checkIn) : null;
    const hours = checkInTime ? Math.max(0, (Date.now() - checkInTime.getTime()) / 3600000) : 8;
    try {
      const res = await fetch(`${API}/attendance/${rec.id}`, {
        method: 'PUT', headers: authHeaders(true),
        body: JSON.stringify({ checkOut: now, hoursWorked: Number(hours.toFixed(2)) }),
      });
      if (!res.ok) throw new Error('Failed to check out');
      addNotification(`${rec.staffName} checked out`, 'success', 'F&B');
      fetchAttendance();
    } catch (e: any) {
      addNotification(e?.message || 'Check-out failed', 'warning', 'F&B');
    }
  };

  const deleteAttendance = async (rec: AttendanceRecord) => {
    try {
      const res = await fetch(`${API}/attendance/${rec.id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) throw new Error('Failed to delete');
      addNotification(`${rec.staffName} attendance record deleted`, 'info', 'F&B');
      fetchAttendance();
    } catch (e: any) {
      addNotification(e?.message || 'Delete failed', 'warning', 'F&B');
    }
  };

  // Load the data for the active sub-tab on mount + tab change.
  useEffect(() => {
    if (subTab === 'assignments') { fetchStaff(); fetchAvailableEmployees(); fetchAssignments(); }
    if (subTab === 'attendance') fetchAttendance();
    if (subTab === 'staffing') fetchStaffing();
    if (subTab === 'shifts') fetchShifts();
    if (subTab === 'training') { fetchStaff(); fetchTraining(); }
    if (subTab === 'productivity') { fetchStaff(); fetchProductivity(); }
  }, [subTab, fetchStaff, fetchAvailableEmployees, fetchAssignments, fetchAttendance, fetchStaffing, fetchShifts, fetchTraining, fetchProductivity]);

  const refreshAll = useCallback(() => {
    fetchHREmployees();
    fetchOutlets();
    fetchStaff();
    fetchAvailableEmployees();
    fetchAssignments();
    fetchAttendance();
    fetchStaffing();
    fetchShifts();
    fetchTraining();
    fetchProductivity();
    addNotification('Staff operations refreshed', 'info', 'F&B');
  }, [fetchHREmployees, fetchOutlets, fetchStaff, fetchAvailableEmployees, fetchAssignments, fetchAttendance, fetchStaffing, fetchShifts, fetchTraining, fetchProductivity, addNotification]);

  // ── Helpers ──────────────────────────────────────────────────────
  const getEmployeeName = (employeeId: string) => hrEmployees.find(e => e.id === employeeId)?.name || 'Unknown';
  const getEmployee = (employeeId: string) => hrEmployees.find(e => e.id === employeeId);
  // Resolve a roster staff member by staff_id, falling back to employee_id for legacy rows.
  const getStaffById = (id: string) => staff.find(s => s.id === id);
  const resolveStaffName = (row: { staff_id?: string | null; employee_id: string }) => {
    if (row.staff_id) { const s = getStaffById(row.staff_id); if (s) return s.name; }
    return getEmployeeName(row.employee_id);
  };
  const resolveStaffRole = (row: { staff_id?: string | null; employee_id: string }) => {
    if (row.staff_id) { const s = getStaffById(row.staff_id); if (s) return s.role; }
    return getEmployee(row.employee_id)?.position || '—';
  };

  const stats = useMemo(() => ({
    onDuty: assignments.filter(a => a.status === 'On Duty').length,
    scheduled: assignments.filter(a => a.status === 'Scheduled').length,
    absent: assignments.filter(a => a.status === 'Absent').length,
    understaffed: staffing.filter(s => s.assigned_count < s.required_count).length,
    overdueTraining: training.filter(t => t.status === 'Overdue').length,
    attPresent: attSummary.reduce((s, a) => s + a.present, 0),
    attLate: attSummary.reduce((s, a) => s + a.late, 0),
    attAbsent: attSummary.reduce((s, a) => s + a.absent, 0),
  }), [assignments, staffing, training, attSummary]);

  const filteredAssign = assignments.filter(a =>
    getEmployeeName(a.employee_id).toLowerCase().includes(search.toLowerCase()) ||
    (a.outlets?.name || '').toLowerCase().includes(search.toLowerCase()) ||
    a.role.toLowerCase().includes(search.toLowerCase()));
  const filteredStaffing = staffing.filter(s =>
    (s.outlets?.name || '').toLowerCase().includes(search.toLowerCase()) ||
    s.role.toLowerCase().includes(search.toLowerCase()));
  const filteredShifts = shifts.filter(s =>
    (s.outlets?.name || '').toLowerCase().includes(search.toLowerCase()) ||
    s.name.toLowerCase().includes(search.toLowerCase()));
  const filteredTraining = training.filter(t =>
    resolveStaffName(t).toLowerCase().includes(search.toLowerCase()) ||
    t.course.toLowerCase().includes(search.toLowerCase()));
  const filteredProd = productivity.filter(p =>
    resolveStaffName(p).toLowerCase().includes(search.toLowerCase()) ||
    (p.outlets?.name || '').toLowerCase().includes(search.toLowerCase()));

  // ── Staff roster: filtered by search + shift/role filters ──────────
  const filteredStaff = useMemo(() => {
    const q = search.toLowerCase();
    return staff.filter(s => {
      const matchesSearch = !q ||
        s.name.toLowerCase().includes(q) ||
        s.role.toLowerCase().includes(q) ||
        (s.outletName || '').toLowerCase().includes(q) ||
        (s.email || '').toLowerCase().includes(q);
      const matchesShift = shiftFilter === 'All' || s.shift === shiftFilter;
      const matchesRole = roleFilter === 'All' || s.role === roleFilter;
      return matchesSearch && matchesShift && matchesRole;
    });
  }, [staff, search, shiftFilter, roleFilter]);

  const staffStats = useMemo(() => ({
    total: staff.length,
    onDuty: staff.filter(s => s.status === 'Active Duty').length,
    linked: staff.filter(s => !!s.employeeId).length,
    avgWorkload: staff.length ? Math.round(staff.reduce((sum, s) => sum + s.workload, 0) / staff.length) : 0,
    avgInspection: staff.length ? Math.round(staff.reduce((sum, s) => sum + s.inspectionScore, 0) / staff.length) : 0,
  }), [staff]);

  // ── Assignments: DataTable rows (HK-style cells) ───────────────────
  const selectCls = 'bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-lg px-2 py-1 text-[9px] font-bold text-slate-600 dark:text-slate-300 outline-none cursor-pointer disabled:opacity-50';

  const assignmentRows = useMemo(() => filteredStaff.map(a => [
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-[11px] font-black text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 shrink-0">
        {a.avatar || a.name.split(' ').map(n => n[0]).join('')}
      </div>
      <div className="min-w-0">
        <div className="font-bold text-slate-900 dark:text-white truncate">{a.name}</div>
        <div className="text-[10px] text-slate-400 font-mono">{a.id}</div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <Badge tone={ROLE_TONE[a.role] || 'neutral'}>{a.role}</Badge>
          {a.employeeId ? <Badge tone="success" icon={Link2}>HR</Badge> : (
            <button onClick={() => { setLinkTarget(a); setLinkEmployeeId(''); fetchAvailableEmployees(); }} className="text-[8px] font-bold text-indigo-500 hover:text-indigo-700 uppercase underline">Link HR</button>
          )}
        </div>
      </div>
    </div>,
    <select value={a.shift} onChange={e => updateStaffField(a.id, { shift: e.target.value })} disabled={actingOn === a.id} className={selectCls}>
      {SHIFTS.map(s => <option key={s} value={s}>{s}</option>)}
    </select>,
    <select value={a.role} onChange={e => updateStaffField(a.id, { role: e.target.value })} disabled={actingOn === a.id} className={selectCls}>
      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
    </select>,
    <select value={a.outletId || ''} onChange={e => updateStaffField(a.id, { outletId: e.target.value || null })} disabled={actingOn === a.id} className={selectCls}>
      <option value="">— None —</option>
      {outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>,
    <span className="font-bold text-emerald-600 dark:text-emerald-400">{a.tablesServed}</span>,
    <span>{a.avgServiceTimeMin ? `${a.avgServiceTimeMin}m` : '—'}</span>,
    <span className="font-bold text-purple-600 dark:text-purple-400">{a.inspectionScore ? `${a.inspectionScore}%` : '—'}</span>,
    <div className="w-28">
      <div className="flex items-center justify-between text-[9px] font-mono mb-1">
        <span className="font-black text-slate-700 dark:text-slate-200">{a.workload}%</span>
      </div>
      <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full ${statusTone[workloadTone(a.workload)].dot}`} style={{ width: `${Math.min(a.workload, 100)}%` }} />
      </div>
    </div>,
    a.employeeId ? (
      <div className="space-y-0.5">
        {a.email && <div className="flex items-center gap-1 text-[10px]"><Mail size={10} className="text-slate-400" /> {a.email}</div>}
        {a.phone && <div className="flex items-center gap-1 text-[10px]"><Phone size={10} className="text-slate-400" /> {a.phone}</div>}
        {a.hireDate && <div className="flex items-center gap-1 text-[10px]"><CalendarDays size={10} className="text-slate-400" /> {a.hireDate}</div>}
        {a.salary != null && a.salary > 0 && <div className="flex items-center gap-1 text-[10px]">${Number(a.salary).toLocaleString()}</div>}
      </div>
    ) : <span className="text-xs text-slate-400">Not linked</span>,
    <div className="inline-flex gap-2">
      <button onClick={() => { setLinkTarget(a); setLinkEmployeeId(''); fetchAvailableEmployees(); }} disabled={actingOn === a.id} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Link HR"><Link2 className="w-4 h-4" /></button>
      <button onClick={() => setDeleteTarget(a)} disabled={actingOn === a.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Remove">
        {actingOn === a.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 className="w-4 h-4" />}
      </button>
    </div>,
  ]), [filteredStaff, actingOn, outlets, updateStaffField, fetchAvailableEmployees]);

  // ── Shifts: DataTable rows ─────────────────────────────────────────
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

  // ── Staffing: DataTable rows ───────────────────────────────────────
  const staffingRows = useMemo(() => filteredStaffing.map(s => {
    const gap = s.required_count - s.assigned_count;
    return [
      <span>{s.outlets?.name || '—'}</span>,
      <Badge tone={ROLE_TONE[s.role] || 'neutral'}>{s.role}</Badge>,
      <span>{s.meal_period}</span>,
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

  // ── Training: DataTable rows ───────────────────────────────────────
  const trainingRows = useMemo(() => filteredTraining.map(t => [
    <span className="font-medium text-slate-900 dark:text-white">{t.course}</span>,
    <div className="flex items-center gap-1.5">
      <span>{resolveStaffName(t)}</span>
      {t.staff_id && <Badge tone="accent">Roster</Badge>}
    </div>,
    <span>{t.outlets?.name || '—'}</span>,
    <span>{t.due_date || '—'}</span>,
    <Badge tone={TRAIN_TONE[t.status]}>{t.status}</Badge>,
    <div className="inline-flex gap-2">
      <button onClick={() => { setEditing({ kind: 'training', row: t }); setShowModal(true); }} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]"><Pencil className="w-4 h-4" /></button>
      {t.status !== 'Completed' && (
        <button onClick={() => handleMarkTrainingComplete(t)} className="px-2 py-1 text-xs rounded-lg bg-[var(--color-accent-operations)] text-white">Complete</button>
      )}
      <button onClick={() => handleDelete('training', t.id)} className="p-1 text-slate-400 hover:text-[var(--color-danger)]"><Trash2 className="w-4 h-4" /></button>
    </div>,
  ]), [filteredTraining, staff]);

  // ── Productivity: DataTable rows ───────────────────────────────────
  const prodRows = useMemo(() => filteredProd.map(p => [
    <div className="flex items-center gap-1.5">
      <span className="font-medium text-slate-900 dark:text-white">{resolveStaffName(p)}</span>
      {p.staff_id && <Badge tone="accent">Roster</Badge>}
    </div>,
    <span>{p.outlets?.name || '—'}</span>,
    <span>{p.covers_served}</span>,
    <span>${Number(p.revenue).toLocaleString()}</span>,
    <span>{p.hours}</span>,
    <span className="font-bold text-indigo-600 dark:text-indigo-400">${Number(p.rev_per_hour).toLocaleString()}</span>,
    <span>{p.period_date || '—'}</span>,
    <div className="inline-flex gap-2">
      <button onClick={() => { setEditing({ kind: 'productivity', row: p }); setShowModal(true); }} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]"><Pencil className="w-4 h-4" /></button>
      <button onClick={() => handleDelete('productivity', p.id)} className="p-1 text-slate-400 hover:text-[var(--color-danger)]"><Trash2 className="w-4 h-4" /></button>
    </div>,
  ]), [filteredProd, staff]);

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
        {a.position && <div className="text-[10px] text-slate-500">{a.position}</div>}
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
    a.email ? (
      <div className="space-y-0.5">
        {a.position && <div className="text-[10px] font-bold text-slate-600 dark:text-slate-300">{a.position}</div>}
        {a.email && <div className="flex items-center gap-1 text-[10px]"><Mail size={10} className="text-slate-400" /> {a.email}</div>}
      </div>
    ) : <span className="text-xs text-slate-400">No HR data</span>,
    <div className="inline-flex gap-2">
      <button onClick={() => setCalendarStaff(a)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="View calendar"><CalendarCheck className="w-4 h-4" /></button>
      <button onClick={() => { setAttEditing(null); setAttForm({ staffId: a.staffId, staffName: a.staffName, shift: 'Morning' as 'Morning' | 'Evening' | 'Night', status: 'Present', checkIn: '', checkOut: '', hoursWorked: 0, overtimeHours: 0, notes: '' }); setShowAttModal(true); }} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Check in"><LogIn className="w-4 h-4" /></button>
    </div>,
  ]), [filteredAttSummary]);

  // ── CRUD actions ─────────────────────────────────────────────────
  const apiCall = async (method: string, path: string, body?: any) => {
    const r = await fetch(`${API}${path}`, {
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

  const handleSave = async (kind: SubTab, payload: any, id?: string) => {
    setSaving(true);
    try {
      const path = `/${kind}${id ? `/${id}` : ''}`;
      await apiCall(id ? 'PUT' : 'POST', path, payload);
      addNotification(`${kind} ${id ? 'updated' : 'created'}`, 'success', 'F&B');
      setShowModal(false);
      setEditing(null);
      // Refresh the relevant sub-tab
      if (kind === 'assignments') fetchAssignments();
      if (kind === 'staffing') fetchStaffing();
      if (kind === 'shifts') fetchShifts();
      if (kind === 'training') fetchTraining();
      if (kind === 'productivity') fetchProductivity();
    } catch (e: any) {
      addNotification(e.message || 'Save failed', 'danger', 'F&B');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (kind: SubTab, id: string) => {
    if (!confirm('Delete this record?')) return;
    setSaving(true);
    try {
      await apiCall('DELETE', `/${kind}/${id}`);
      addNotification(`${kind} deleted`, 'info', 'F&B');
      if (kind === 'assignments') setAssignments(a => a.filter(x => x.id !== id));
      if (kind === 'staffing') setStaffing(a => a.filter(x => x.id !== id));
      if (kind === 'shifts') setShifts(a => a.filter(x => x.id !== id));
      if (kind === 'training') setTraining(a => a.filter(x => x.id !== id));
      if (kind === 'productivity') setProductivity(a => a.filter(x => x.id !== id));
    } catch (e: any) {
      addNotification(e.message || 'Delete failed', 'danger', 'F&B');
    } finally {
      setSaving(false);
    }
  };

  const handleMarkTrainingComplete = async (t: Training) => {
    setSaving(true);
    try {
      await apiCall('PUT', `/training/${t.id}`, { status: 'Completed' });
      addNotification(`${t.course} marked complete`, 'success', 'F&B');
      fetchTraining();
    } catch (e: any) {
      addNotification(e.message || 'Update failed', 'danger', 'F&B');
    } finally {
      setSaving(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className={['accent-fb', layout.sectionStack].join(' ')}>
      <PageHeader
        title="F&B Staff Operations"
        subtitle="Staff assignment, outlet staffing, shift requirements, training, and productivity — integrated with HR."
        icon={Users}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} className={button.ghost} disabled={saving} title="Refresh">
              <RefreshCw size={16} />
            </button>
            {subTab === 'assignments' && (
              <button onClick={() => { setStaffForm({ name: '', role: 'Server', shift: 'Morning', outletId: '', status: 'Active Duty', tablesServed: 0, avgServiceTimeMin: 0, inspectionScore: 0, workload: 0, linkMode: 'new', employeeId: '', email: '', phone: '', hireDate: '', salary: 0 }); fetchAvailableEmployees(); setShowStaffForm(true); }} className={button.primary} disabled={saving}>
                <Plus size={16} /> Add Staff
              </button>
            )}
            {subTab !== 'attendance' && subTab !== 'assignments' && (
              <button onClick={() => { setEditing(null); setShowModal(true); }} className={button.primary} disabled={saving}>
                <Plus size={16} /> Add {subTab}
              </button>
            )}
            {subTab === 'attendance' && (
              <button onClick={() => { setAttEditing(null); setAttForm({ staffId: '', staffName: '', shift: 'Morning', status: 'Present', checkIn: '', checkOut: '', hoursWorked: 0, overtimeHours: 0, notes: '' }); setShowAttModal(true); }} className={button.primary} disabled={saving}>
                <LogIn size={16} /> Check In
              </button>
            )}
          </div>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Total Staff" value={staffStats.total} icon={Users} tone="accent" />
        <StatCard title="On Duty" value={staffStats.onDuty} icon={CheckCircle2} tone="success" />
        <StatCard title="Present Today" value={stats.attPresent} icon={CalendarCheck} tone="success" />
        <StatCard title="Late / Absent" value={stats.attLate + stats.attAbsent} icon={AlertTriangle} tone="warning" />
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

      {/* Assignments — now shows the fb_staff roster (mirrors HK Staff Management) */}
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
              <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-1.5 text-[10px] font-black uppercase text-slate-600 dark:text-slate-300 outline-none cursor-pointer">
                <option value="All">All Roles</option>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </SectionCard>

          <SectionCard title="Staff Assignments & Productivity" subtitle="Role · Outlet · Shift · Workload · HR Profile" icon={Users} tone="accent" pad="none">
            {staffError ? (
              <div className="flex items-center gap-3 text-[var(--color-danger)] px-6 py-4">
                <AlertTriangle size={18} /><span className="text-sm font-bold">{staffError}</span>
                <button onClick={fetchStaff} className="ml-auto text-xs underline">Retry</button>
              </div>
            ) : loadingStaff ? <LoadingRow /> : (
              <DataTable
                headers={['Staff', 'Shift', 'Role', 'Outlet', 'Tables', 'Svc Time', 'Inspect', 'Workload', 'HR Profile', '']}
                rows={assignmentRows}
                empty={filteredStaff.length === 0}
                emptyColSpan={10}
              />
            )}
          </SectionCard>
        </>
      )}

      {/* Attendance */}
      {subTab === 'attendance' && (
        <>
          {/* Attendance status filter pills */}
          <SectionCard pad="md">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl gap-1 flex-wrap">
                {['All', ...ATT_STATUS_LIST].map(f => (
                  <button key={f} onClick={() => setAttStatusFilter(f)} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${attStatusFilter === f ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{f}</button>
                ))}
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Staff Attendance Summary" subtitle="One row per employee · Click a row to view calendar detail" icon={CalendarCheck} pad="none">
            {loadingAttendance ? <LoadingRow /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-6 py-3 font-medium">Employee</th>
                      <th className="px-6 py-3 font-medium">Attendance Rate</th>
                      <th className="px-6 py-3 font-medium">Status Breakdown</th>
                      <th className="px-6 py-3 font-medium">Total Hours</th>
                      <th className="px-6 py-3 font-medium">Overtime</th>
                      <th className="px-6 py-3 font-medium">HR Profile</th>
                      <th className="px-6 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                    {filteredAttSummary.map((a, ri) => (
                      <tr key={ri} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                        <td className="px-6 py-3">{attendanceSummaryRows[ri]?.[0]}</td>
                        <td className="px-6 py-3">{attendanceSummaryRows[ri]?.[1]}</td>
                        <td className="px-6 py-3">{attendanceSummaryRows[ri]?.[2]}</td>
                        <td className="px-6 py-3">{attendanceSummaryRows[ri]?.[3]}</td>
                        <td className="px-6 py-3">{attendanceSummaryRows[ri]?.[4]}</td>
                        <td className="px-6 py-3">{attendanceSummaryRows[ri]?.[5]}</td>
                        <td className="px-6 py-3 text-right">{attendanceSummaryRows[ri]?.[6]}</td>
                      </tr>
                    ))}
                    {filteredAttSummary.length === 0 && <EmptyRow colSpan={7} />}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </>
      )}

      {/* Staffing requirements */}
      {subTab === 'staffing' && (
        <SectionCard title="Outlet Staffing Requirements" subtitle="Per-outlet required vs. assigned headcount by meal period" icon={Users} tone="accent" pad="none">
          {loadingData.staffing ? <LoadingRow /> : (
            <DataTable
              headers={['Outlet', 'Role', 'Meal Period', 'Required', 'Assigned', 'Gap', 'Status', '']}
              rows={staffingRows}
              empty={filteredStaffing.length === 0}
              emptyColSpan={8}
            />
          )}
        </SectionCard>
      )}

      {/* Shifts */}
      {subTab === 'shifts' && (
        <SectionCard title="Shift Requirements" subtitle="Shift windows with coverage tracking" icon={CalendarDays} tone="accent" pad="none">
          {loadingData.shifts ? <LoadingRow /> : (
            <DataTable
              headers={['Shift', 'Start', 'End', 'Assigned', 'Required', 'Coverage', '']}
              rows={shiftRows}
              empty={filteredShifts.length === 0}
              emptyColSpan={7}
            />
          )}
        </SectionCard>
      )}

      {/* Training */}
      {subTab === 'training' && (
        <SectionCard title="Training Requirements" subtitle="Course assignments and compliance" icon={GraduationCap} tone="accent" pad="none">
          {loadingData.training ? <LoadingRow /> : (
            <DataTable
              headers={['Course', 'Staff', 'Outlet', 'Due Date', 'Status', '']}
              rows={trainingRows}
              empty={filteredTraining.length === 0}
              emptyColSpan={6}
            />
          )}
        </SectionCard>
      )}

      {/* Productivity */}
      {subTab === 'productivity' && (
        <SectionCard title="Productivity" subtitle="Covers served, revenue, hours, revenue per hour" icon={Gauge} tone="accent" pad="none">
          {loadingData.productivity ? <LoadingRow /> : (
            <DataTable
              headers={['Staff', 'Outlet', 'Covers', 'Revenue', 'Hours', 'Rev/Hr', 'Period', '']}
              rows={prodRows}
              empty={filteredProd.length === 0}
              emptyColSpan={8}
            />
          )}
        </SectionCard>
      )}

      {/* ── Create staff modal (assignments) — ModalSystem + Field ────── */}
      <ModalSystem
        isOpen={showStaffForm}
        onClose={() => setShowStaffForm(false)}
        onConfirm={saveStaff}
        title="Add F&B Staff"
        variant="form"
        confirmLabel={saving ? 'Adding…' : 'Add Staff'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Name">
              <input className={inputCls} value={staffForm.name} onChange={e => setStaffForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Maria S." />
            </Field>
          </div>
          <Field label="Role">
            <select className={inputCls} value={staffForm.role} onChange={e => setStaffForm(f => ({ ...f, role: e.target.value as FBStaff['role'] }))}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Shift">
            <select className={inputCls} value={staffForm.shift} onChange={e => setStaffForm(f => ({ ...f, shift: e.target.value as FBStaff['shift'] }))}>
              {SHIFTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Outlet">
            <select className={inputCls} value={staffForm.outletId} onChange={e => setStaffForm(f => ({ ...f, outletId: e.target.value }))}>
              <option value="">— Unassigned —</option>
              {outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <input className={inputCls} value={staffForm.status} onChange={e => setStaffForm(f => ({ ...f, status: e.target.value }))} placeholder="Active Duty" />
          </Field>
          <Field label="Tables Served">
            <input type="number" min={0} className={inputCls} value={staffForm.tablesServed} onChange={e => setStaffForm(f => ({ ...f, tablesServed: Number(e.target.value) }))} />
          </Field>
          <Field label="Avg Service Time (min)">
            <input type="number" min={0} className={inputCls} value={staffForm.avgServiceTimeMin} onChange={e => setStaffForm(f => ({ ...f, avgServiceTimeMin: Number(e.target.value) }))} />
          </Field>
          <Field label="Inspection Score %">
            <input type="number" min={0} max={100} className={inputCls} value={staffForm.inspectionScore} onChange={e => setStaffForm(f => ({ ...f, inspectionScore: Number(e.target.value) }))} />
          </Field>
          <Field label="Workload %">
            <input type="number" min={0} max={100} className={inputCls} value={staffForm.workload} onChange={e => setStaffForm(f => ({ ...f, workload: Number(e.target.value) }))} />
          </Field>

          <div className="col-span-2 mt-2 pt-3 border-t border-slate-200 dark:border-slate-700">
            <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">HR Employee Link</span>
            <div className="flex gap-2 mb-3">
              {(['new', 'existing', 'none'] as const).map(m => (
                <button key={m} onClick={() => setStaffForm(f => ({ ...f, linkMode: m }))} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition ${staffForm.linkMode === m ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                  {m === 'new' ? 'Create New' : m === 'existing' ? 'Link Existing' : 'No Link'}
                </button>
              ))}
            </div>
            {staffForm.linkMode === 'existing' && (
              <Field label="Select HR Employee">
                <select className={inputCls} value={staffForm.employeeId} onChange={e => setStaffForm(f => ({ ...f, employeeId: e.target.value }))}>
                  <option value="">— Select employee —</option>
                  {availableEmployees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.name} — {emp.position || 'Staff'} ({emp.id})</option>
                  ))}
                </select>
              </Field>
            )}
            {staffForm.linkMode === 'new' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Email"><input className={inputCls} value={staffForm.email} onChange={e => setStaffForm(f => ({ ...f, email: e.target.value }))} placeholder="name@hotel.com" /></Field>
                <Field label="Phone"><input className={inputCls} value={staffForm.phone} onChange={e => setStaffForm(f => ({ ...f, phone: e.target.value }))} placeholder="+1 555 0100" /></Field>
                <Field label="Hire Date"><input type="date" className={inputCls} value={staffForm.hireDate} onChange={e => setStaffForm(f => ({ ...f, hireDate: e.target.value }))} /></Field>
                <Field label="Salary"><input type="number" min={0} className={inputCls} value={staffForm.salary} onChange={e => setStaffForm(f => ({ ...f, salary: Number(e.target.value) }))} /></Field>
              </div>
            )}
            {staffForm.linkMode === 'none' && <p className="text-xs text-slate-400">No HR employee record will be created. You can link later.</p>}
          </div>
        </div>
      </ModalSystem>

      {/* ── Link employee modal ──────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!linkTarget}
        onClose={() => { setLinkTarget(null); setLinkEmployeeId(''); }}
        onConfirm={linkEmployee}
        title={`Link ${linkTarget?.name || ''} to HR Employee`}
        variant="form"
        confirmLabel={actingOn === linkTarget?.id ? 'Linking…' : 'Link Employee'}
        confirmColor="indigo"
        loading={actingOn === linkTarget?.id}
      >
        <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
          Select an HR employee record to link with this F&B staff member.
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
      </ModalSystem>

      {/* ── Delete confirm modal ─────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteStaff(deleteTarget.id)}
        title="Remove Staff Member"
        variant="confirm"
        confirmLabel={actingOn === deleteTarget?.id ? 'Removing…' : 'Remove'}
        confirmColor="rose"
        loading={actingOn === deleteTarget?.id}
      >
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Remove <span className="font-bold">{deleteTarget?.name}</span> ({deleteTarget?.role}) from the active F&B team? Their assignment history and HR employee record are preserved.
        </p>
      </ModalSystem>

      {showModal && (
        <StaffOperationsModal
          subTab={subTab}
          editing={editing}
          hrEmployees={hrEmployees}
          outlets={outlets}
          staff={staff}
          loadingEmployees={loadingEmployees}
          loadingOutlets={loadingOutlets}
          saving={saving}
          onClose={() => { setShowModal(false); setEditing(null); }}
          onSave={handleSave}
        />
      )}

      {/* ── Attendance calendar detail modal ──────────────────────────── */}
      {calendarStaff && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setCalendarStaff(null)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden border border-slate-200 dark:border-slate-700 shadow-2xl" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-700">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-sm font-black text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
                  {calendarStaff.staffName.split(' ').map(n => n[0]).join('')}
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">{calendarStaff.staffName}</h2>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-slate-400 font-mono">{calendarStaff.staffId}</span>
                    {calendarStaff.position && <span className="text-[10px] text-slate-500">{calendarStaff.position}</span>}
                  </div>
                </div>
              </div>
              <button onClick={() => setCalendarStaff(null)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition"><X className="w-5 h-5" /></button>
            </div>

            {/* Summary stats */}
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

            {/* Status legend */}
            <div className="flex flex-wrap gap-2 px-5 py-2 border-b border-slate-100 dark:border-slate-700">
              {([
                ['Present', calendarStaff.present], ['Late', calendarStaff.late], ['Absent', calendarStaff.absent],
                ['On Leave', calendarStaff.onLeave], ['Sick', calendarStaff.sick], ['Half Day', calendarStaff.halfDay],
                ['Day Off', calendarStaff.dayOff], ['Public Holiday', calendarStaff.publicHoliday],
                ['Work From Home', calendarStaff.workFromHome], ['Mission', calendarStaff.mission], ['Training Day', calendarStaff.trainingDay],
              ] as [string, number][]).filter(([, n]) => n > 0).map(([label, n]) => (
                <span key={label} className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-600 dark:text-slate-300">
                  <span className={`w-2.5 h-2.5 rounded-full ${ATT_STATUS_COLOR[label] || 'bg-slate-300'}`} />
                  {label} ({n})
                </span>
              ))}
            </div>

            {/* Records timeline */}
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
                      <button onClick={() => { setAttEditing(r); setAttForm({ staffId: r.staffId, staffName: r.staffName, shift: r.shift as 'Morning' | 'Evening' | 'Night', status: r.status, checkIn: r.checkIn || '', checkOut: r.checkOut || '', hoursWorked: r.hoursWorked, overtimeHours: r.overtimeHours, notes: r.notes || '' }); setShowAttModal(true); }} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => deleteAttendance(r)} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-between items-center p-4 border-t border-slate-100 dark:border-slate-700">
              {calendarStaff.email && (
                <div className="flex items-center gap-3 text-[10px] text-slate-500">
                  {calendarStaff.email && <span className="flex items-center gap-1"><Mail size={10} /> {calendarStaff.email}</span>}
                  {calendarStaff.phone && <span className="flex items-center gap-1"><Phone size={10} /> {calendarStaff.phone}</span>}
                </div>
              )}
              <button onClick={() => { setCalendarStaff(null); setAttEditing(null); setAttForm({ staffId: calendarStaff.staffId, staffName: calendarStaff.staffName, shift: 'Morning', status: 'Present', checkIn: '', checkOut: '', hoursWorked: 0, overtimeHours: 0, notes: '' }); setShowAttModal(true); }} className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 inline-flex items-center gap-1.5">
                <LogIn size={14} /> Check In
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Attendance modal ─────────────────────────────────────────── */}
      <ModalSystem
        isOpen={showAttModal}
        onClose={() => { setShowAttModal(false); setAttEditing(null); }}
        onConfirm={saveAttendance}
        title={attEditing ? `Edit Attendance — ${attEditing.staffName}` : 'Check In Employee'}
        variant="form"
        confirmLabel={saving ? 'Saving…' : attEditing ? 'Update' : 'Check In'}
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          {!attEditing && (
            <div className="col-span-2">
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Select Employee</label>
              <select className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 font-sans" value={attForm.staffId} onChange={e => {
                const emp = hrEmployees.find(x => x.id === e.target.value);
                setAttForm(f => ({ ...f, staffId: e.target.value, staffName: emp?.name || '' }));
              }}>
                <option value="">— Select employee —</option>
                {hrEmployees.filter(e => e.department === 'Food & Beverage').map(e => (
                  <option key={e.id} value={e.id}>{e.name} ({e.position})</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Shift</label>
            <select className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 font-sans" value={attForm.shift} onChange={e => setAttForm(f => ({ ...f, shift: e.target.value as 'Morning' | 'Evening' | 'Night' }))}>
              {SHIFTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Status</label>
            <select className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 font-sans" value={attForm.status} onChange={e => setAttForm(f => ({ ...f, status: e.target.value }))}>
              {ATT_STATUS_LIST.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {attEditing && (
            <>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Check-In Time</label>
                <input type="datetime-local" className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 font-sans" value={attForm.checkIn ? new Date(attForm.checkIn).toISOString().slice(0, 16) : ''} onChange={e => setAttForm(f => ({ ...f, checkIn: e.target.value ? new Date(e.target.value).toISOString() : '' }))} />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Check-Out Time</label>
                <input type="datetime-local" className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 font-sans" value={attForm.checkOut ? new Date(attForm.checkOut).toISOString().slice(0, 16) : ''} onChange={e => setAttForm(f => ({ ...f, checkOut: e.target.value ? new Date(e.target.value).toISOString() : '' }))} />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Hours Worked</label>
                <input type="number" min={0} step="0.25" className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 font-sans" value={attForm.hoursWorked} onChange={e => setAttForm(f => ({ ...f, hoursWorked: Number(e.target.value) }))} />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Overtime Hours</label>
                <input type="number" min={0} step="0.25" className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 font-sans" value={attForm.overtimeHours} onChange={e => setAttForm(f => ({ ...f, overtimeHours: Number(e.target.value) }))} />
              </div>
            </>
          )}
          <div className="col-span-2">
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Notes</label>
            <input className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 font-sans" value={attForm.notes} onChange={e => setAttForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes…" />
          </div>
        </div>
      </ModalSystem>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────
function fmtTime(t: string | null | undefined): string {
  if (!t) return '—';
  // DB returns HH:MM:SS — trim to HH:MM for display.
  return t.length >= 5 ? t.slice(0, 5) : t;
}

// ── Shared UI helpers (aligned with HK StaffManagementModule) ───────
const inputCls = 'w-full px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 font-sans';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
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

function EmptyRow({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-6 py-8 text-center text-slate-400">No records found.</td>
    </tr>
  );
}

// ── Modal ──────────────────────────────────────────────────────────
interface ModalProps {
  subTab: SubTab;
  editing: { kind: SubTab; row: any } | null;
  hrEmployees: HREmployee[];
  outlets: Outlet[];
  staff: FBStaff[];
  loadingEmployees: boolean;
  loadingOutlets: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (kind: SubTab, payload: any, id?: string) => void;
}

function StaffOperationsModal({
  subTab, editing, hrEmployees, outlets, staff, loadingEmployees, loadingOutlets, saving, onClose, onSave,
}: ModalProps) {
  const row = editing?.row;
  const isEdit = !!row;

  // Local form state, initialized from the editing row (if any).
  const [employeeId, setEmployeeId] = useState<string>(row?.employee_id || '');
  const [staffId, setStaffId] = useState<string>(row?.staff_id || '');
  const [outletId, setOutletId] = useState<string>(row?.outlet_id || '');
  const [role, setRole] = useState<string>(row?.role || 'Server');
  const [shift, setShift] = useState<string>(row?.shift || 'Evening');
  const [date, setDate] = useState<string>(row?.date || new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<string>(row?.status || 'Scheduled');
  const [course, setCourse] = useState<string>(row?.course || '');
  const [dueDate, setDueDate] = useState<string>(row?.due_date || '');
  const [requiredCount, setRequiredCount] = useState<number>(row?.required_count ?? 1);
  const [assignedCount, setAssignedCount] = useState<number>(row?.assigned_count ?? 0);
  const [mealPeriod, setMealPeriod] = useState<string>(row?.meal_period || 'Dinner');
  const [shiftName, setShiftName] = useState<string>(row?.name || '');
  const [startTime, setStartTime] = useState<string>(row?.start_time?.slice(0, 5) || '08:00');
  const [endTime, setEndTime] = useState<string>(row?.end_time?.slice(0, 5) || '16:00');
  const [assignedStaff, setAssignedStaff] = useState<number>(row?.assigned_staff ?? 0);
  const [requiredStaff, setRequiredStaff] = useState<number>(row?.required_staff ?? 1);
  const [coversServed, setCoversServed] = useState<number>(row?.covers_served ?? 0);
  const [revenue, setRevenue] = useState<number>(row?.revenue ?? 0);
  const [hours, setHours] = useState<number>(row?.hours ?? 8);

  const selectedEmployee = hrEmployees.find(e => e.id === employeeId) || null;

  const submit = () => {
    if (subTab === 'assignments') {
      if (!employeeId) return alert('Select an employee');
      onSave('assignments', { employee_id: employeeId, outlet_id: outletId || null, role, shift, date, status }, isEdit ? row.id : undefined);
    } else if (subTab === 'staffing') {
      if (!outletId) return alert('Select an outlet');
      onSave('staffing', { outlet_id: outletId, role, required_count: requiredCount, assigned_count: assignedCount, meal_period: mealPeriod }, isEdit ? row.id : undefined);
    } else if (subTab === 'shifts') {
      if (!shiftName) return alert('Enter a shift name');
      onSave('shifts', { name: shiftName, start_time: startTime, end_time: endTime, outlet_id: outletId || null, assigned_staff: assignedStaff, required_staff: requiredStaff }, isEdit ? row.id : undefined);
    } else if (subTab === 'training') {
      if (!course) return alert('Course is required');
      if (!staffId && !employeeId) return alert('Select a staff member or employee');
      onSave('training', { course, staff_id: staffId || null, employee_id: employeeId || null, outlet_id: outletId || null, due_date: dueDate || null, status }, isEdit ? row.id : undefined);
    } else if (subTab === 'productivity') {
      if (!staffId && !employeeId) return alert('Select a staff member or employee');
      const revPerHour = hours > 0 ? Number((revenue / hours).toFixed(2)) : 0;
      onSave('productivity', { staff_id: staffId || null, employee_id: employeeId || null, outlet_id: outletId || null, covers_served: coversServed, revenue, hours, rev_per_hour: revPerHour }, isEdit ? row.id : undefined);
    }
  };

  const titleMap: Record<SubTab, string> = {
    assignments: 'Staff Assignment',
    staffing: 'Outlet Staffing Requirement',
    shifts: 'Shift Requirement',
    training: 'Training Requirement',
    productivity: 'Productivity Record',
  };

  const inputCls = 'w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white';
  const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-md border border-gray-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">{isEdit ? 'Edit' : 'New'} {titleMap[subTab]}</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          {/* Staff roster picker — training, productivity (prefers fb_staff identity) */}
          {(subTab === 'training' || subTab === 'productivity') && (
            <div>
              <label className={labelCls}>F&B Staff (roster)</label>
              <select className={inputCls} value={staffId} onChange={e => { setStaffId(e.target.value); const s = staff.find(x => x.id === e.target.value); if (s && s.employeeId) setEmployeeId(s.employeeId); }}>
                <option value="">Select staff...</option>
                {staff.map(s => (
                  <option key={s.id} value={s.id}>{s.name} - {s.role} ({s.outletName || 'No outlet'})</option>
                ))}
              </select>
              {staffId && staff.find(s => s.id === staffId) && (
                <div className="mt-2 p-2 bg-slate-50 dark:bg-slate-900/40 rounded-lg text-xs">
                  <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400"><Building2 className="w-3 h-3" />{staff.find(s => s.id === staffId)!.role} · {staff.find(s => s.id === staffId)!.outletName || 'No outlet'}</div>
                  {staff.find(s => s.id === staffId)!.email && <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 mt-1"><Mail className="w-3 h-3" />{staff.find(s => s.id === staffId)!.email}</div>}
                </div>
              )}
            </div>
          )}
          {/* HR employee picker — assignments (legacy), training, productivity (fallback) */}
          {(subTab === 'assignments' || subTab === 'training' || subTab === 'productivity') && (
            <div>
              <label className={labelCls}>{subTab === 'assignments' ? 'Employee (from HR)' : 'HR Employee (fallback)'}</label>
              {loadingEmployees ? (
                <div className="text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin inline mr-1" />Loading employees…</div>
              ) : (
                <select className={inputCls} value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
                  <option value="">Select employee...</option>
                  {hrEmployees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.name} - {emp.position}</option>
                  ))}
                </select>
              )}
              {selectedEmployee && (
                <div className="mt-2 p-2 bg-slate-50 dark:bg-slate-900/40 rounded-lg text-xs">
                  <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400"><Mail className="w-3 h-3" />{selectedEmployee.email}</div>
                  <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 mt-1"><Phone className="w-3 h-3" />{selectedEmployee.phone}</div>
                  <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 mt-1"><Building2 className="w-3 h-3" />{selectedEmployee.department} - {selectedEmployee.position}</div>
                </div>
              )}
            </div>
          )}

          {/* Outlet picker — all sub-tabs */}
          <div>
            <label className={labelCls}>Outlet</label>
            {loadingOutlets ? (
              <div className="text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin inline mr-1" />Loading outlets…</div>
            ) : (
              <select className={inputCls} value={outletId} onChange={e => setOutletId(e.target.value)}>
                <option value="">— None —</option>
                {outlets.map(o => (
                  <option key={o.id} value={o.id}>{o.name} ({o.type})</option>
                ))}
              </select>
            )}
          </div>

          {/* Assignments-specific */}
          {subTab === 'assignments' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Role</label>
                  <select className={inputCls} value={role} onChange={e => setRole(e.target.value)}>
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Shift</label>
                  <select className={inputCls} value={shift} onChange={e => setShift(e.target.value)}>
                    {SHIFTS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Date</label>
                  <input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Status</label>
                  <select className={inputCls} value={status} onChange={e => setStatus(e.target.value)}>
                    {ASSIGN_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            </>
          )}

          {/* Staffing-specific */}
          {subTab === 'staffing' && (
            <>
              <div>
                <label className={labelCls}>Role</label>
                <input className={inputCls} value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. Server" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>Required</label>
                  <input type="number" min={0} className={inputCls} value={requiredCount} onChange={e => setRequiredCount(Number(e.target.value))} />
                </div>
                <div>
                  <label className={labelCls}>Assigned</label>
                  <input type="number" min={0} className={inputCls} value={assignedCount} onChange={e => setAssignedCount(Number(e.target.value))} />
                </div>
                <div>
                  <label className={labelCls}>Meal Period</label>
                  <select className={inputCls} value={mealPeriod} onChange={e => setMealPeriod(e.target.value)}>
                    {MEAL_PERIODS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>
            </>
          )}

          {/* Shifts-specific */}
          {subTab === 'shifts' && (
            <>
              <div>
                <label className={labelCls}>Shift Name</label>
                <input className={inputCls} value={shiftName} onChange={e => setShiftName(e.target.value)} placeholder="e.g. Breakfast" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Start Time</label>
                  <input type="time" className={inputCls} value={startTime} onChange={e => setStartTime(e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>End Time</label>
                  <input type="time" className={inputCls} value={endTime} onChange={e => setEndTime(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Assigned Staff</label>
                  <input type="number" min={0} className={inputCls} value={assignedStaff} onChange={e => setAssignedStaff(Number(e.target.value))} />
                </div>
                <div>
                  <label className={labelCls}>Required Staff</label>
                  <input type="number" min={0} className={inputCls} value={requiredStaff} onChange={e => setRequiredStaff(Number(e.target.value))} />
                </div>
              </div>
            </>
          )}

          {/* Training-specific */}
          {subTab === 'training' && (
            <>
              <div>
                <label className={labelCls}>Course</label>
                <input className={inputCls} value={course} onChange={e => setCourse(e.target.value)} placeholder="e.g. Food Safety & HACCP" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Due Date</label>
                  <input type="date" className={inputCls} value={dueDate} onChange={e => setDueDate(e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Status</label>
                  <select className={inputCls} value={status} onChange={e => setStatus(e.target.value)}>
                    {TRAIN_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            </>
          )}

          {/* Productivity-specific */}
          {subTab === 'productivity' && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Covers</label>
                <input type="number" min={0} className={inputCls} value={coversServed} onChange={e => setCoversServed(Number(e.target.value))} />
              </div>
              <div>
                <label className={labelCls}>Revenue</label>
                <input type="number" min={0} className={inputCls} value={revenue} onChange={e => setRevenue(Number(e.target.value))} />
              </div>
              <div>
                <label className={labelCls}>Hours</label>
                <input type="number" min={0} step="0.25" className={inputCls} value={hours} onChange={e => setHours(Number(e.target.value))} />
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button onClick={submit} disabled={saving} className={button.primary}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1 inline" /> : null}
              {isEdit ? 'Save' : 'Create'}
            </button>
            <button onClick={onClose} className={button.secondary} disabled={saving}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
