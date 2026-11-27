/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Technician & Staff Management — Engineering Portal
 * (/erp/maintenance/staff).
 *
 * DB-integrated via /api/eng-portal/technicians/* routes. Mimics the HK
 * Staff Management pattern (StaffManagementModule.tsx) but adapted for
 * engineering roles (Electrician, Plumber, HVAC, General, Supervisor, etc.).
 *
 * Six sub-tabs: Assignments, Attendance, Shifts, Staffing, Training, Productivity.
 * Uses PageHeader, SectionCard, StatCard, Badge, ModalSystem, brandTheme.
 * Multi-property scoping via useERP(). ERP notifications on all mutations.
 * Table style follows the HK StaffManagementModule DataTable pattern.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Users, IdCard, CalendarDays, GraduationCap, Gauge, Plus, Pencil, Trash2,
  Search, X, CheckCircle2, AlertTriangle, Loader2, ServerCrash, RefreshCw,
  Phone, Mail, Clock, Wrench,
  CalendarCheck, LogIn, LogOut, Link2, Briefcase, ClipboardList, type LucideIcon,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import {
  fetchTechnicians, createTechnician, updateTechnician, deleteTechnician,
  fetchTechShifts, createTechShift, updateTechShift, deleteTechShift,
  fetchTechStaffing, createTechStaffing, updateTechStaffing, deleteTechStaffing,
  fetchTechTraining, createTechTraining, updateTechTraining, deleteTechTraining,
  fetchTechProductivity, createTechProductivity, updateTechProductivity, deleteTechProductivity,
  fetchTechAttendanceSummary, checkInTechAttendance,
  updateTechAttendance, deleteTechAttendance,
  fetchAvailableEmployees,
  fetchWorkOrders,
  type Technician, type TechRole, type TechShift, type TechStatus,
  type TechShiftReq, type TechStaffingReq, type TechTraining,
  type TechProductivity, type TrainingStatus,
  type TechAttendanceRecord, type TechAttendanceSummary, type AttendanceStatus,
  type AvailableEmployee, type WorkOrder,
} from '../../services/engineeringService';

// ── Static registries ────────────────────────────────────────────────────
type SubTab = 'assignments' | 'attendance' | 'shifts' | 'staffing' | 'training' | 'productivity';

const SUB_TABS: { id: SubTab; label: string; icon: LucideIcon }[] = [
  { id: 'assignments',  label: 'Assignments',   icon: IdCard },
  { id: 'attendance',   label: 'Attendance',    icon: CalendarCheck },
  { id: 'shifts',       label: 'Shifts',        icon: CalendarDays },
  { id: 'staffing',     label: 'Staffing',      icon: Users },
  { id: 'training',     label: 'Training',      icon: GraduationCap },
  { id: 'productivity', label: 'Productivity',  icon: Gauge },
];

const ROLES: TechRole[] = [
  'Electrician', 'Plumber', 'HVAC Technician', 'General Technician',
  'Supervisor', 'Locksmith', 'AV / IT Technician', 'External Contractor',
];
const SHIFTS: TechShift[] = ['Morning', 'Evening', 'Night'];
const STATUSES: TechStatus[] = ['Available', 'On Task', 'Off Duty', 'Emergency'];
const TRAIN_STATUSES: TrainingStatus[] = ['Not Started', 'In Progress', 'Completed', 'Overdue'];
const ZONES = ['Zone A', 'Zone B', 'Zone C'];

const ROLE_TONE: Record<TechRole, StatusTone> = {
  'Electrician': 'accent',
  'Plumber': 'info',
  'HVAC Technician': 'warning',
  'General Technician': 'neutral',
  'Supervisor': 'success',
  'Locksmith': 'info',
  'AV / IT Technician': 'accent',
  'External Contractor': 'neutral',
};

const STATUS_TONE: Record<TechStatus, StatusTone> = {
  'Available': 'success',
  'On Task': 'warning',
  'Off Duty': 'neutral',
  'Emergency': 'danger',
};

const STATUS_DOT: Record<TechStatus, string> = {
  'Available': 'bg-emerald-500',
  'On Task': 'bg-amber-500',
  'Off Duty': 'bg-slate-400',
  'Emergency': 'bg-rose-500',
};

const TRAIN_TONE: Record<TrainingStatus, StatusTone> = {
  'Not Started': 'info',
  'In Progress': 'warning',
  'Completed': 'success',
  'Overdue': 'danger',
};

const ATT_STATUSES: AttendanceStatus[] = [
  'Present', 'Late', 'Absent', 'On Leave', 'Sick', 'Half Day',
  'Day Off', 'Public Holiday', 'Work From Home', 'Mission', 'Training Day',
];

const ATT_STATUS_TONE: Record<AttendanceStatus, StatusTone> = {
  'Present': 'success', 'Late': 'warning', 'Absent': 'danger',
  'On Leave': 'info', 'Sick': 'neutral', 'Half Day': 'info',
  'Day Off': 'neutral', 'Public Holiday': 'accent',
  'Work From Home': 'info', 'Mission': 'warning', 'Training Day': 'info',
};

const ATT_STATUS_DOT: Record<AttendanceStatus, string> = {
  'Present': 'bg-emerald-500', 'Late': 'bg-amber-500', 'Absent': 'bg-rose-500',
  'On Leave': 'bg-blue-500', 'Sick': 'bg-slate-400', 'Half Day': 'bg-cyan-500',
  'Day Off': 'bg-slate-300', 'Public Holiday': 'bg-indigo-500',
  'Work From Home': 'bg-teal-500', 'Mission': 'bg-orange-500', 'Training Day': 'bg-violet-500',
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

// ── UI helpers ───────────────────────────────────────────────────────────
const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtTime(t: string | null | undefined): string {
  if (!t) return '—';
  return t.length >= 5 ? t.slice(0, 5) : t;
}

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

// ── Component ────────────────────────────────────────────────────────────
const StaffManagement: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [subTab, setSubTab] = useState<SubTab>('assignments');
  const [search, setSearch] = useState('');

  // Data
  const [techs, setTechs] = useState<Technician[]>([]);
  const [shifts, setShifts] = useState<TechShiftReq[]>([]);
  const [staffing, setStaffing] = useState<TechStaffingReq[]>([]);
  const [training, setTraining] = useState<TechTraining[]>([]);
  const [productivity, setProductivity] = useState<TechProductivity[]>([]);

  // Attendance
  const [attSummary, setAttSummary] = useState<TechAttendanceSummary[]>([]);
  const [attStatusFilter, setAttStatusFilter] = useState<'All' | AttendanceStatus>('All');
  const [calendarStaff, setCalendarStaff] = useState<TechAttendanceSummary | null>(null);
  const [showAttModal, setShowAttModal] = useState(false);
  const [editingAtt, setEditingAtt] = useState<TechAttendanceRecord | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  // Modals
  const [showTechModal, setShowTechModal] = useState(false);
  const [editingTech, setEditingTech] = useState<Technician | null>(null);
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [editingShift, setEditingShift] = useState<TechShiftReq | null>(null);
  const [showStaffingModal, setShowStaffingModal] = useState(false);
  const [editingStaffing, setEditingStaffing] = useState<TechStaffingReq | null>(null);
  const [showTrainingModal, setShowTrainingModal] = useState(false);
  const [editingTraining, setEditingTraining] = useState<TechTraining | null>(null);
  const [showProdModal, setShowProdModal] = useState(false);
  const [editingProd, setEditingProd] = useState<TechProductivity | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Detail modal
  const [detailTech, setDetailTech] = useState<Technician | null>(null);

  // Filters
  const [roleFilter, setRoleFilter] = useState<'All' | TechRole>('All');
  const [shiftFilter, setShiftFilter] = useState<'All' | TechShift>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | TechStatus>('All');

  // Forms
  const emptyTechForm = {
    name: '', role: 'General Technician' as TechRole, shift: 'Morning' as TechShift,
    status: 'Available' as TechStatus, zone: 'Zone A', phone: '', email: '',
    hireDate: '', jobsCompleted: '0', avgResponseMin: '0', workload: '0',
    skills: '',
    // HR integration
    linkMode: 'none' as 'new' | 'existing' | 'none',
    employeeId: '', salary: '0',
  };
  const [techForm, setTechForm] = useState({ ...emptyTechForm });

  // HR employee linking
  const [availableEmployees, setAvailableEmployees] = useState<AvailableEmployee[]>([]);
  const [linkTarget, setLinkTarget] = useState<Technician | null>(null);
  const [linkEmployeeId, setLinkEmployeeId] = useState('');

  const emptyShiftForm = {
    name: '', shift: 'Morning' as TechShift, startTime: '06:00', endTime: '14:00',
    assignedStaff: '0', requiredStaff: '1',
  };
  const [shiftForm, setShiftForm] = useState({ ...emptyShiftForm });

  const emptyStaffingForm = {
    role: 'Electrician' as TechRole, zone: 'Zone A', shift: 'Morning' as TechShift,
    requiredCount: '1', assignedCount: '0',
  };
  const [staffingForm, setStaffingForm] = useState({ ...emptyStaffingForm });

  const emptyTrainingForm = {
    technicianId: '', course: '', dueDate: '', status: 'Not Started' as TrainingStatus,
  };
  const [trainingForm, setTrainingForm] = useState({ ...emptyTrainingForm });

  const emptyProdForm = {
    technicianId: '', jobsCompleted: '0', hours: '0', avgResponseMin: '0',
    productivityScore: '0', periodDate: new Date().toISOString().slice(0, 10),
  };
  const [prodForm, setProdForm] = useState({ ...emptyProdForm });

  const emptyAttForm = {
    staffId: '', staffName: '', shift: 'Morning' as TechShift, status: 'Present' as AttendanceStatus,
    checkIn: '', checkOut: '', hoursWorked: '0', overtimeHours: '0', notes: '',
    attendanceDate: new Date().toISOString().slice(0, 10),
  };
  const [attForm, setAttForm] = useState({ ...emptyAttForm });

  // Task integration (similar to HK pattern)
  const [taskCounts, setTaskCounts] = useState<Record<string, { total: number; pending: number; inProgress: number; completed: number }>>({});
  const [taskModalTech, setTaskModalTech] = useState<Technician | null>(null);
  const [techTasks, setTechTasks] = useState<WorkOrder[]>([]);
  const [loadingTechTasks, setLoadingTechTasks] = useState(false);

  // ── Loaders ────────────────────────────────────────────────────────────
  const loadTechs = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await fetchTechnicians({ propertyId: currentPropertyId || undefined });
      setTechs(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load technicians');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  const loadShifts = useCallback(async () => {
    try {
      const data = await fetchTechShifts({ propertyId: currentPropertyId || undefined });
      setShifts(data);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to load shifts', 'warning', 'Maintenance');
    }
  }, [currentPropertyId, addNotification]);

  const loadStaffing = useCallback(async () => {
    try {
      const data = await fetchTechStaffing({ propertyId: currentPropertyId || undefined });
      setStaffing(data);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to load staffing', 'warning', 'Maintenance');
    }
  }, [currentPropertyId, addNotification]);

  const loadTraining = useCallback(async () => {
    try {
      const data = await fetchTechTraining({ propertyId: currentPropertyId || undefined });
      setTraining(data);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to load training', 'warning', 'Maintenance');
    }
  }, [currentPropertyId, addNotification]);

  const loadProductivity = useCallback(async () => {
    try {
      const data = await fetchTechProductivity({ propertyId: currentPropertyId || undefined });
      setProductivity(data);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to load productivity', 'warning', 'Maintenance');
    }
  }, [currentPropertyId, addNotification]);

  const loadAttSummary = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoading(true); setError(null);
    try {
      const data = await fetchTechAttendanceSummary(currentPropertyId);
      setAttSummary(data.summary || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load attendance summary');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  const loadAvailableEmployees = useCallback(async () => {
    try {
      const data = await fetchAvailableEmployees(currentPropertyId || undefined);
      setAvailableEmployees(data.employees || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  // Fetch task counts per technician (links Staff Management ↔ Work Order Management)
  const loadTaskCounts = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const data = await fetchWorkOrders({ propertyId: currentPropertyId });
      const counts: Record<string, { total: number; pending: number; inProgress: number; completed: number }> = {};
      data.forEach(wo => {
        if (wo.assigned_to) {
          if (!counts[wo.assigned_to]) {
            counts[wo.assigned_to] = { total: 0, pending: 0, inProgress: 0, completed: 0 };
          }
          counts[wo.assigned_to].total++;
          if (wo.status === 'Open' || wo.status === 'Assigned') counts[wo.assigned_to].pending++;
          else if (wo.status === 'In Progress') counts[wo.assigned_to].inProgress++;
          else if (wo.status === 'Completed' || wo.status === 'Verified' || wo.status === 'Closed') counts[wo.assigned_to].completed++;
        }
      });
      setTaskCounts(counts);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  // Fetch work orders for a specific technician (for the task detail modal)
  const loadTechTasks = useCallback(async (techId: string) => {
    if (!currentPropertyId) return;
    setLoadingTechTasks(true);
    try {
      const data = await fetchWorkOrders({ propertyId: currentPropertyId });
      const techWOs = data.filter(wo => wo.assigned_to === techId);
      setTechTasks(techWOs);
    } catch { /* non-fatal */ }
    finally { setLoadingTechTasks(false); }
  }, [currentPropertyId]);

  const openTaskModal = useCallback(async (t: Technician) => {
    setTaskModalTech(t);
    setTechTasks([]);
    await loadTechTasks(t.id);
  }, [loadTechTasks]);

  useEffect(() => {
    if (subTab === 'assignments') { loadTechs(); loadTaskCounts(); }
    if (subTab === 'attendance') loadAttSummary();
    if (subTab === 'shifts') loadShifts();
    if (subTab === 'staffing') loadStaffing();
    if (subTab === 'training') loadTraining();
    if (subTab === 'productivity') loadProductivity();
  }, [subTab, loadTechs, loadTaskCounts, loadAttSummary, loadShifts, loadStaffing, loadTraining, loadProductivity]);

  const refreshAll = useCallback(() => {
    loadTechs(); loadTaskCounts(); loadAttSummary(); loadShifts(); loadStaffing(); loadTraining(); loadProductivity();
    addNotification('Technician operations refreshed', 'task', 'Maintenance');
  }, [loadTechs, loadTaskCounts, loadAttSummary, loadShifts, loadStaffing, loadTraining, loadProductivity, addNotification]);

  // ── Derived ────────────────────────────────────────────────────────────
  const filteredTechs = useMemo(() => {
    return techs.filter(t => {
      if (roleFilter !== 'All' && t.role !== roleFilter) return false;
      if (shiftFilter !== 'All' && t.shift !== shiftFilter) return false;
      if (statusFilter !== 'All' && t.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!t.name.toLowerCase().includes(q) && !t.role.toLowerCase().includes(q) && !(t.zone || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [techs, roleFilter, shiftFilter, statusFilter, search]);

  // ── Attendance: filtered summary rows (one per technician) ──────────
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

  const stats = useMemo(() => ({
    total: techs.length,
    available: techs.filter(t => t.status === 'Available').length,
    onTask: techs.filter(t => t.status === 'On Task').length,
    offDuty: techs.filter(t => t.status === 'Off Duty').length,
    avgResponse: techs.length ? Math.round(techs.reduce((s, t) => s + t.avg_response_min, 0) / techs.length) : 0,
    totalJobs: techs.reduce((s, t) => s + t.jobs_completed, 0),
  }), [techs]);

  const techName = (id: string | null) => techs.find(t => t.id === id)?.name || '—';

  // ── Technician CRUD ────────────────────────────────────────────────────
  const openNewTech = () => {
    setEditingTech(null);
    setTechForm({ ...emptyTechForm });
    loadAvailableEmployees();
    setShowTechModal(true);
  };

  const openEditTech = (t: Technician) => {
    setEditingTech(t);
    setTechForm({
      name: t.name, role: t.role, shift: t.shift, status: t.status,
      zone: t.zone || 'Zone A', phone: t.phone || '', email: t.email || '',
      hireDate: t.hire_date || '', jobsCompleted: String(t.jobs_completed),
      avgResponseMin: String(t.avg_response_min), workload: String(t.workload),
      skills: (t.skills || []).join(', '),
      linkMode: t.employee_id ? 'existing' : 'none',
      employeeId: t.employee_id || '',
      salary: t.hrSalary != null ? String(t.hrSalary) : '0',
    });
    setShowTechModal(true);
    setMenuOpen(null);
  };

  const submitTech = async () => {
    if (!techForm.name.trim()) return;
    setSubmitting(true);
    try {
      const skillsArr = techForm.skills.split(',').map(s => s.trim()).filter(Boolean);
      const payload: any = {
        propertyId: currentPropertyId || undefined,
        name: techForm.name.trim(), role: techForm.role, shift: techForm.shift,
        status: techForm.status, zone: techForm.zone, phone: techForm.phone || undefined,
        email: techForm.email || undefined, hireDate: techForm.hireDate || undefined,
        jobsCompleted: parseInt(techForm.jobsCompleted) || 0,
        avgResponseMin: parseInt(techForm.avgResponseMin) || 0,
        workload: parseInt(techForm.workload) || 0,
        skills: skillsArr.length ? skillsArr : undefined,
      };
      // HR integration
      if (techForm.linkMode === 'existing' && techForm.employeeId) {
        payload.employeeId = techForm.employeeId;
      } else if (techForm.linkMode === 'new' && (techForm.email || techForm.phone || techForm.hireDate || techForm.salary)) {
        payload.salary = parseFloat(techForm.salary) || 0;
      }
      if (editingTech) {
        const { technician } = await updateTechnician(editingTech.id, payload);
        setTechs(prev => prev.map(t => (t.id === editingTech.id ? technician : t)));
        addNotification(`${technician.name} updated`, 'task', 'Maintenance');
      } else {
        const technician = await createTechnician(payload);
        setTechs(prev => [...prev, technician]);
        addNotification(`${technician.name} added to roster`, 'task', 'Maintenance');
      }
      setShowTechModal(false);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save technician', 'warning', 'Maintenance');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Link employee ─────────────────────────────────────────────────────
  const openLinkModal = async (t: Technician) => {
    setLinkTarget(t);
    setLinkEmployeeId('');
    setMenuOpen(null);
    await loadAvailableEmployees();
  };

  const linkEmployee = async () => {
    if (!linkTarget || !linkEmployeeId) return;
    setActingOn(linkTarget.id);
    try {
      const { technician } = await updateTechnician(linkTarget.id, { employeeId: linkEmployeeId });
      setTechs(prev => prev.map(t => (t.id === linkTarget.id ? technician : t)));
      addNotification(`${technician.name} linked to HR employee`, 'task', 'Maintenance');
      setLinkTarget(null);
      setLinkEmployeeId('');
    } catch (e: any) {
      addNotification(e?.message || 'Link failed', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const unlinkEmployee = async (t: Technician) => {
    setActingOn(t.id);
    setMenuOpen(null);
    try {
      const { technician } = await updateTechnician(t.id, { employeeId: null });
      setTechs(prev => prev.map(x => (x.id === t.id ? technician : x)));
      addNotification(`${t.name} unlinked from HR`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Unlink failed', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const quickStatusChange = async (t: Technician, status: TechStatus) => {
    setActingOn(t.id);
    setMenuOpen(null);
    try {
      const { technician } = await updateTechnician(t.id, { status });
      setTechs(prev => prev.map(x => (x.id === t.id ? technician : x)));
      addNotification(`${t.name} → ${status}`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Status update failed', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const removeTech = async (id: string) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      await deleteTechnician(id);
      setTechs(prev => prev.filter(t => t.id !== id));
      addNotification('Technician removed', 'task', 'Maintenance');
      setDetailTech(null);
    } catch (e: any) {
      addNotification(e?.message || 'Delete failed', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  // Inline reassignment (similar to HK pattern)
  const quickReassign = async (id: string, field: 'shift' | 'status' | 'zone' | 'role', value: string) => {
    setActingOn(id);
    try {
      const body: Record<string, unknown> = { [field]: value };
      const { technician } = await updateTechnician(id, body);
      setTechs(prev => prev.map(t => (t.id === id ? technician : t)));
      addNotification(`${technician.name} reassigned (${field})`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Reassign failed', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  // ── Shift CRUD ─────────────────────────────────────────────────────────
  const openNewShift = () => {
    setEditingShift(null);
    setShiftForm({ ...emptyShiftForm });
    setShowShiftModal(true);
  };

  const openEditShift = (s: TechShiftReq) => {
    setEditingShift(s);
    setShiftForm({
      name: s.name, shift: s.shift, startTime: s.start_time, endTime: s.end_time,
      assignedStaff: String(s.assigned_staff), requiredStaff: String(s.required_staff),
    });
    setShowShiftModal(true);
  };

  const submitShift = async () => {
    if (!shiftForm.name.trim()) return;
    setSubmitting(true);
    try {
      const payload = {
        propertyId: currentPropertyId || undefined,
        name: shiftForm.name.trim(), shift: shiftForm.shift,
        startTime: shiftForm.startTime, endTime: shiftForm.endTime,
        assignedStaff: parseInt(shiftForm.assignedStaff) || 0,
        requiredStaff: parseInt(shiftForm.requiredStaff) || 1,
      };
      if (editingShift) {
        const { shift } = await updateTechShift(editingShift.id, payload);
        setShifts(prev => prev.map(s => (s.id === editingShift.id ? shift : s)));
        addNotification(`Shift "${shift.name}" updated`, 'task', 'Maintenance');
      } else {
        const shift = await createTechShift(payload);
        setShifts(prev => [...prev, shift]);
        addNotification(`Shift "${shift.name}" created`, 'task', 'Maintenance');
      }
      setShowShiftModal(false);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save shift', 'warning', 'Maintenance');
    } finally {
      setSubmitting(false);
    }
  };

  const removeShift = async (id: string) => {
    setActingOn(id);
    try {
      await deleteTechShift(id);
      setShifts(prev => prev.filter(s => s.id !== id));
      addNotification('Shift deleted', 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Delete failed', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  // ── Staffing CRUD ──────────────────────────────────────────────────────
  const openNewStaffing = () => {
    setEditingStaffing(null);
    setStaffingForm({ ...emptyStaffingForm });
    setShowStaffingModal(true);
  };

  const openEditStaffing = (s: TechStaffingReq) => {
    setEditingStaffing(s);
    setStaffingForm({
      role: s.role as TechRole, zone: s.zone || 'Zone A', shift: s.shift,
      requiredCount: String(s.required_count), assignedCount: String(s.assigned_count),
    });
    setShowStaffingModal(true);
  };

  const submitStaffing = async () => {
    setSubmitting(true);
    try {
      const payload = {
        propertyId: currentPropertyId || undefined,
        role: staffingForm.role, zone: staffingForm.zone, shift: staffingForm.shift,
        requiredCount: parseInt(staffingForm.requiredCount) || 1,
        assignedCount: parseInt(staffingForm.assignedCount) || 0,
      };
      if (editingStaffing) {
        const { staffing } = await updateTechStaffing(editingStaffing.id, payload);
        setStaffing(prev => prev.map(s => (s.id === editingStaffing.id ? staffing : s)));
        addNotification('Staffing requirement updated', 'task', 'Maintenance');
      } else {
        const staffing = await createTechStaffing(payload);
        setStaffing(prev => [...prev, staffing]);
        addNotification('Staffing requirement created', 'task', 'Maintenance');
      }
      setShowStaffingModal(false);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save staffing', 'warning', 'Maintenance');
    } finally {
      setSubmitting(false);
    }
  };

  const removeStaffing = async (id: string) => {
    setActingOn(id);
    try {
      await deleteTechStaffing(id);
      setStaffing(prev => prev.filter(s => s.id !== id));
      addNotification('Staffing requirement deleted', 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Delete failed', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  // ── Training CRUD ──────────────────────────────────────────────────────
  const openNewTraining = () => {
    setEditingTraining(null);
    setTrainingForm({ ...emptyTrainingForm });
    setShowTrainingModal(true);
  };

  const openEditTraining = (t: TechTraining) => {
    setEditingTraining(t);
    setTrainingForm({
      technicianId: t.technician_id || '', course: t.course,
      dueDate: t.due_date || '', status: t.status,
    });
    setShowTrainingModal(true);
  };

  const submitTraining = async () => {
    if (!trainingForm.course.trim()) return;
    setSubmitting(true);
    try {
      const payload = {
        propertyId: currentPropertyId || undefined,
        technicianId: trainingForm.technicianId || undefined,
        course: trainingForm.course.trim(),
        dueDate: trainingForm.dueDate || undefined,
        status: trainingForm.status,
      };
      if (editingTraining) {
        const { training } = await updateTechTraining(editingTraining.id, payload);
        setTraining(prev => prev.map(t => (t.id === editingTraining.id ? training : t)));
        addNotification('Training record updated', 'task', 'Maintenance');
      } else {
        const training = await createTechTraining(payload);
        setTraining(prev => [...prev, training]);
        addNotification('Training record created', 'task', 'Maintenance');
      }
      setShowTrainingModal(false);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save training', 'warning', 'Maintenance');
    } finally {
      setSubmitting(false);
    }
  };

  const removeTraining = async (id: string) => {
    setActingOn(id);
    try {
      await deleteTechTraining(id);
      setTraining(prev => prev.filter(t => t.id !== id));
      addNotification('Training record deleted', 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Delete failed', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  // ── Productivity CRUD ──────────────────────────────────────────────────
  const openNewProd = () => {
    setEditingProd(null);
    setProdForm({ ...emptyProdForm });
    setShowProdModal(true);
  };

  const openEditProd = (p: TechProductivity) => {
    setEditingProd(p);
    setProdForm({
      technicianId: p.technician_id || '',
      jobsCompleted: String(p.jobs_completed),
      hours: String(p.hours),
      avgResponseMin: String(p.avg_response_min),
      productivityScore: String(p.productivity_score),
      periodDate: p.period_date || new Date().toISOString().slice(0, 10),
    });
    setShowProdModal(true);
  };

  const submitProd = async () => {
    setSubmitting(true);
    try {
      const payload = {
        propertyId: currentPropertyId || undefined,
        technicianId: prodForm.technicianId || undefined,
        jobsCompleted: parseInt(prodForm.jobsCompleted) || 0,
        hours: parseFloat(prodForm.hours) || 0,
        avgResponseMin: parseInt(prodForm.avgResponseMin) || 0,
        productivityScore: parseInt(prodForm.productivityScore) || 0,
        periodDate: prodForm.periodDate || undefined,
      };
      if (editingProd) {
        const { productivity } = await updateTechProductivity(editingProd.id, payload);
        setProductivity(prev => prev.map(p => (p.id === editingProd.id ? productivity : p)));
        addNotification('Productivity record updated', 'task', 'Maintenance');
      } else {
        const productivity = await createTechProductivity(payload);
        setProductivity(prev => [...prev, productivity]);
        addNotification('Productivity record created', 'task', 'Maintenance');
      }
      setShowProdModal(false);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save productivity', 'warning', 'Maintenance');
    } finally {
      setSubmitting(false);
    }
  };

  const removeProd = async (id: string) => {
    setActingOn(id);
    try {
      await deleteTechProductivity(id);
      setProductivity(prev => prev.filter(p => p.id !== id));
      addNotification('Productivity record deleted', 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Delete failed', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  // ── Attendance CRUD ──────────────────────────────────────────────────
  const openNewAtt = () => {
    setEditingAtt(null);
    setAttForm({ ...emptyAttForm, attendanceDate: new Date().toISOString().slice(0, 10) });
    setShowAttModal(true);
  };

  const openEditAtt = (rec: TechAttendanceRecord) => {
    setEditingAtt(rec);
    setAttForm({
      staffId: rec.staffId, staffName: rec.staffName, shift: rec.shift,
      status: rec.status,
      checkIn: rec.checkIn ? rec.checkIn.slice(0, 16) : '',
      checkOut: rec.checkOut ? rec.checkOut.slice(0, 16) : '',
      hoursWorked: String(rec.hoursWorked), overtimeHours: String(rec.overtimeHours),
      notes: rec.notes || '', attendanceDate: rec.attendanceDate,
    });
    setShowAttModal(true);
  };

  const submitAtt = async () => {
    if (!attForm.staffId || !attForm.staffName || !currentPropertyId) {
      addNotification('Technician is required', 'warning', 'Maintenance');
      return;
    }
    setSubmitting(true);
    try {
      if (editingAtt) {
        await updateTechAttendance(editingAtt.id, {
          status: attForm.status, shift: attForm.shift,
          checkIn: attForm.checkIn ? new Date(attForm.checkIn).toISOString() : undefined,
          checkOut: attForm.checkOut ? new Date(attForm.checkOut).toISOString() : undefined,
          hoursWorked: parseFloat(attForm.hoursWorked) || 0,
          overtimeHours: parseFloat(attForm.overtimeHours) || 0,
          notes: attForm.notes || undefined,
        });
        addNotification(`${attForm.staffName} attendance updated`, 'task', 'Maintenance');
      } else {
        await checkInTechAttendance({
          propertyId: currentPropertyId,
          staffId: attForm.staffId, staffName: attForm.staffName,
          shift: attForm.shift, status: attForm.status,
          checkIn: attForm.checkIn ? new Date(attForm.checkIn).toISOString() : undefined,
          notes: attForm.notes || undefined,
          attendanceDate: attForm.attendanceDate,
        });
        addNotification(`${attForm.staffName} checked in`, 'task', 'Maintenance');
      }
      setShowAttModal(false);
      loadAttSummary();
    } catch (e: any) {
      addNotification(e?.message || 'Attendance save failed', 'warning', 'Maintenance');
    } finally {
      setSubmitting(false);
    }
  };

  const quickCheckOut = async (rec: TechAttendanceRecord) => {
    setActingOn(rec.id);
    try {
      const checkInTime = rec.checkIn ? new Date(rec.checkIn) : null;
      const hours = checkInTime ? Math.max(0, (Date.now() - checkInTime.getTime()) / 3600000) : 8;
      await updateTechAttendance(rec.id, {
        checkOut: new Date().toISOString(),
        hoursWorked: Number(hours.toFixed(2)),
      });
      addNotification(`${rec.staffName} checked out`, 'task', 'Maintenance');
      loadAttSummary();
    } catch (e: any) {
      addNotification(e?.message || 'Check-out failed', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const removeAtt = async (id: string) => {
    setActingOn(id);
    try {
      await deleteTechAttendance(id);
      addNotification('Attendance record deleted', 'task', 'Maintenance');
      loadAttSummary();
      addNotification('Attendance record deleted', 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Delete failed', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Technician & Staff Management"
        subtitle="Tracking specialists across active repair lines"
        icon={Wrench}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            {subTab === 'assignments' && <button onClick={openNewTech} className={button.primary}><Plus className="w-4 h-4" /> Add Technician</button>}
            {subTab === 'shifts' && <button onClick={openNewShift} className={button.primary}><Plus className="w-4 h-4" /> New Shift</button>}
            {subTab === 'staffing' && <button onClick={openNewStaffing} className={button.primary}><Plus className="w-4 h-4" /> New Requirement</button>}
            {subTab === 'training' && <button onClick={openNewTraining} className={button.primary}><Plus className="w-4 h-4" /> Assign Training</button>}
            {subTab === 'attendance' && <button onClick={openNewAtt} className={button.primary}><LogIn className="w-4 h-4" /> Check In</button>}
            {subTab === 'productivity' && <button onClick={openNewProd} className={button.primary}><Plus className="w-4 h-4" /> Log Productivity</button>}
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Technicians" value={stats.total} icon={Users} tone="accent" />
        <StatCard title="Available" value={stats.available} icon={CheckCircle2} tone="success" />
        <StatCard title="On Task" value={stats.onTask} icon={Wrench} tone="warning" />
        <StatCard title="Avg Response" value={`${stats.avgResponse}m`} icon={Clock} tone="info" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={loadTechs} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {/* Sub-tab navigation */}
      <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto">
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
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

      {/* ══ Assignments sub-tab ══════════════════════════════════════════ */}
      {subTab === 'assignments' && (
        <>
          {/* Extra filters for assignments */}
          <SectionCard pad="md">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl gap-1">
                {(['All', ...SHIFTS] as const).map(f => (
                  <button key={f} onClick={() => setShiftFilter(f as any)} className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${shiftFilter === f ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{f}</button>
                ))}
              </div>
              <select value={roleFilter} onChange={e => setRoleFilter(e.target.value as any)} className="bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-1.5 text-[10px] font-black uppercase text-slate-600 dark:text-slate-300 outline-none cursor-pointer">
                <option value="All">All Roles</option>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-1.5 text-[10px] font-black uppercase text-slate-600 dark:text-slate-300 outline-none cursor-pointer">
                <option value="All">All Statuses</option>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </SectionCard>

          <SectionCard title="Technician Assignments & Productivity" subtitle="Role · Shift · Zone · Status · Workload · HR Profile" icon={Wrench} tone="accent" pad="none">
            {error ? (
              <div className="flex items-center gap-3 text-[var(--color-danger)] px-6 py-4">
                <ServerCrash size={18} /><span className="text-sm font-bold">{error}</span>
                <button onClick={loadTechs} className="ml-auto text-xs underline">Retry</button>
              </div>
            ) : loading ? <LoadingRow /> : (
              <DataTable
                headers={['Technician', 'Role', 'Shift', 'Zone', 'Status', 'Jobs', 'Avg Response', 'Workload', 'Tasks', 'HR Profile', '']}
                rows={filteredTechs.map(t => [
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-[11px] font-black text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 shrink-0">
                      {t.avatar || t.name.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900 dark:text-white truncate">{t.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{t.id}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Badge tone={ROLE_TONE[t.role]}>{t.role}</Badge>
                        {t.employee_id ? <Badge tone="success" icon={Link2}>HR</Badge> : (
                          <button onClick={() => openLinkModal(t)} className="text-[8px] font-bold text-indigo-500 hover:text-indigo-700 uppercase underline">Link HR</button>
                        )}
                      </div>
                    </div>
                  </div>,
                  <select value={t.role} onChange={e => quickReassign(t.id, 'role', e.target.value)} disabled={actingOn === t.id} className="bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-lg px-2 py-1 text-[9px] font-bold text-slate-600 dark:text-slate-300 outline-none cursor-pointer disabled:opacity-50">
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>,
                  <select value={t.shift} onChange={e => quickReassign(t.id, 'shift', e.target.value)} disabled={actingOn === t.id} className="bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-lg px-2 py-1 text-[9px] font-bold text-slate-600 dark:text-slate-300 outline-none cursor-pointer disabled:opacity-50">
                    {SHIFTS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>,
                  <select value={t.zone || 'Zone A'} onChange={e => quickReassign(t.id, 'zone', e.target.value)} disabled={actingOn === t.id} className="bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-lg px-2 py-1 text-[9px] font-bold text-slate-600 dark:text-slate-300 outline-none cursor-pointer disabled:opacity-50">
                    {ZONES.map(z => <option key={z} value={z}>{z}</option>)}
                  </select>,
                  <select value={t.status} onChange={e => quickReassign(t.id, 'status', e.target.value)} disabled={actingOn === t.id} className="bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-lg px-2 py-1 text-[9px] font-bold text-slate-600 dark:text-slate-300 outline-none cursor-pointer disabled:opacity-50">
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>,
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">{t.jobs_completed}</span>,
                  <span className="font-bold text-amber-600 dark:text-amber-400">{t.avg_response_min}m</span>,
                  <div className="w-28">
                    <div className="flex items-center justify-between text-[9px] font-mono mb-1">
                      <span className="font-black text-slate-700 dark:text-slate-200">{t.workload}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div className={`h-full ${statusTone[workloadTone(t.workload)].dot}`} style={{ width: `${t.workload}%` }} />
                    </div>
                  </div>,
                  (() => {
                    const tc = taskCounts[t.id];
                    if (!tc || tc.total === 0) return <span className="text-xs text-slate-400">No tasks</span>;
                    return (
                      <button onClick={() => openTaskModal(t)} className="flex flex-col items-start gap-0.5 group" title="View assigned work orders">
                        <span className="font-bold text-slate-900 dark:text-white group-hover:text-indigo-600">{tc.total} WOs</span>
                        <div className="flex gap-1 text-[9px] font-mono">
                          <span className="text-slate-500">{tc.pending}P</span>
                          <span className="text-blue-500">{tc.inProgress}I</span>
                          <span className="text-emerald-500">{tc.completed}C</span>
                        </div>
                      </button>
                    );
                  })(),
                  t.employee_id ? (
                    <div className="space-y-0.5">
                      {t.hrEmail && <div className="flex items-center gap-1 text-[10px]"><Mail size={10} className="text-slate-400" /> {t.hrEmail}</div>}
                      {t.hrPhone && <div className="flex items-center gap-1 text-[10px]"><Phone size={10} className="text-slate-400" /> {t.hrPhone}</div>}
                      {t.hrHireDate && <div className="flex items-center gap-1 text-[10px]"><CalendarDays size={10} className="text-slate-400" /> {fmtDate(t.hrHireDate)}</div>}
                      {t.hrSalary != null && t.hrSalary > 0 && <div className="flex items-center gap-1 text-[10px]">${Number(t.hrSalary).toLocaleString()}</div>}
                    </div>
                  ) : <span className="text-xs text-slate-400">Not linked</span>,
                  <div className="inline-flex gap-2">
                    <button onClick={() => openLinkModal(t)} disabled={actingOn === t.id} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Link HR"><Link2 className="w-4 h-4" /></button>
                    <button onClick={() => removeTech(t.id)} disabled={actingOn === t.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Remove">
                      {actingOn === t.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>,
                ])}
                empty={filteredTechs.length === 0}
                emptyColSpan={11}
              />
            )}
          </SectionCard>
        </>
      )}

      {/* ══ Attendance sub-tab ════════════════════════════════════════════ */}
      {subTab === 'attendance' && (
        <>
          {/* Attendance filters — HK style */}
          <SectionCard pad="md">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl gap-1 flex-wrap">
                {['All', 'Present', 'Late', 'Absent', 'On Leave', 'Sick', 'Day Off', 'Public Holiday', 'Half Day', 'Work From Home', 'Mission', 'Training Day'].map(f => (
                  <button key={f} onClick={() => setAttStatusFilter(f as any)} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${attStatusFilter === f ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{f}</button>
                ))}
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Technician Attendance Summary" subtitle="One row per technician · Click a row to view calendar detail" icon={CalendarCheck} tone="accent" pad="none">
            {loading ? <LoadingRow /> : (
              <DataTable
                headers={['Technician', 'Attendance Rate', 'Status Breakdown', 'Total Hours', 'Overtime', 'HR Profile', '']}
                rows={filteredAttSummary.map(a => [
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
                      <div className="text-[10px] font-bold text-slate-600 dark:text-slate-300">Engineering</div>
                    </div>
                  ) : <span className="text-xs text-slate-400">Not linked</span>,
                  <div className="inline-flex gap-2">
                    <button onClick={() => setCalendarStaff(a)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="View calendar"><CalendarCheck className="w-4 h-4" /></button>
                    <button onClick={() => { setEditingAtt(null); setAttForm(f => ({ ...f, staffId: a.staffId, staffName: a.staffName, shift: a.records[0]?.shift || 'Morning' as TechShift, status: 'Present' as AttendanceStatus, checkIn: '', checkOut: '', hoursWorked: '0', overtimeHours: '0', notes: '', attendanceDate: new Date().toISOString().slice(0, 10) })); setShowAttModal(true); }} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Check in"><LogIn className="w-4 h-4" /></button>
                  </div>,
                ])}
                empty={filteredAttSummary.length === 0}
                emptyColSpan={7}
              />
            )}
          </SectionCard>
        </>
      )}

      {/* ══ Shifts sub-tab ═══════════════════════════════════════════════ */}
      {subTab === 'shifts' && (
        <SectionCard title="Shift Requirements" subtitle="Required vs assigned staffing per shift" icon={CalendarDays} pad="none" bodyClassName="divide-y divide-gray-100 dark:divide-slate-700">
          {shifts.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">No shift requirements defined.</div>
          ) : shifts.map(s => {
            const gap = s.required_staff - s.assigned_staff;
            return (
              <div key={s.id} className="p-4 flex items-center gap-4">
                <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800">
                  <CalendarDays className="w-4 h-4 text-gray-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900 dark:text-white">{s.name}</p>
                  <p className="text-xs text-gray-500">{s.shift} · {s.start_time}–{s.end_time}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-black text-gray-900 dark:text-white">{s.assigned_staff}/{s.required_staff}</p>
                  {gap > 0 ? (
                    <Badge tone="danger">{gap} short</Badge>
                  ) : (
                    <Badge tone="success">Covered</Badge>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => openEditShift(s)} className={button.ghost + ' p-1.5'}><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => removeShift(s.id)} disabled={actingOn === s.id} className={button.ghost + ' p-1.5 text-red-600 disabled:opacity-50'}>
                    {actingOn === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            );
          })}
        </SectionCard>
      )}

      {/* ══ Staffing sub-tab ══════════════════════════════════════════════ */}
      {subTab === 'staffing' && (
        <SectionCard title="Staffing Requirements" subtitle="Role-based staffing targets per zone/shift" icon={Users} pad="none" bodyClassName="divide-y divide-gray-100 dark:divide-slate-700">
          {staffing.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">No staffing requirements defined.</div>
          ) : staffing.map(s => {
            const gap = s.required_count - s.assigned_count;
            return (
              <div key={s.id} className="p-4 flex items-center gap-4">
                <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800">
                  <Users className="w-4 h-4 text-gray-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900 dark:text-white">{s.role}</p>
                  <p className="text-xs text-gray-500">{s.zone || '—'} · {s.shift}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-black text-gray-900 dark:text-white">{s.assigned_count}/{s.required_count}</p>
                  {gap > 0 ? <Badge tone="danger">{gap} short</Badge> : <Badge tone="success">Met</Badge>}
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => openEditStaffing(s)} className={button.ghost + ' p-1.5'}><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => removeStaffing(s.id)} disabled={actingOn === s.id} className={button.ghost + ' p-1.5 text-red-600 disabled:opacity-50'}>
                    {actingOn === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            );
          })}
        </SectionCard>
      )}

      {/* ══ Training sub-tab ══════════════════════════════════════════════ */}
      {subTab === 'training' && (
        <SectionCard title="Training Records" subtitle="Certifications and skill development" icon={GraduationCap} pad="none" bodyClassName="divide-y divide-gray-100 dark:divide-slate-700">
          {training.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">No training records.</div>
          ) : training.map(t => (
            <div key={t.id} className="p-4 flex items-center gap-4">
              <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800">
                <GraduationCap className="w-4 h-4 text-gray-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 dark:text-white">{t.course}</p>
                <p className="text-xs text-gray-500">
                  {techName(t.technician_id)} · Due {fmtDate(t.due_date)}
                </p>
              </div>
              <Badge tone={TRAIN_TONE[t.status]}>{t.status}</Badge>
              <div className="flex items-center gap-1">
                <button onClick={() => openEditTraining(t)} className={button.ghost + ' p-1.5'}><Pencil className="w-4 h-4" /></button>
                <button onClick={() => removeTraining(t.id)} disabled={actingOn === t.id} className={button.ghost + ' p-1.5 text-red-600 disabled:opacity-50'}>
                  {actingOn === t.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>
            </div>
          ))}
        </SectionCard>
      )}

      {/* ══ Productivity sub-tab ══════════════════════════════════════════ */}
      {subTab === 'productivity' && (
        <SectionCard title="Productivity Metrics" subtitle="Jobs, hours, response time, and score" icon={Gauge} pad="none" bodyClassName="divide-y divide-gray-100 dark:divide-slate-700">
          {productivity.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">No productivity records.</div>
          ) : productivity.map(p => (
            <div key={p.id} className="p-4 flex items-center gap-4">
              <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800">
                <Gauge className="w-4 h-4 text-gray-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 dark:text-white">{techName(p.technician_id)}</p>
                <p className="text-xs text-gray-500">
                  {p.jobs_completed} jobs · {p.hours}h · {p.avg_response_min}m resp · {fmtDate(p.period_date)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-lg font-black text-gray-900 dark:text-white">{p.productivity_score}</p>
                <p className="text-[10px] text-gray-500 font-bold uppercase">Score</p>
              </div>
              <Badge tone={workloadTone(100 - p.productivity_score)}>{p.productivity_score >= 90 ? 'Excellent' : p.productivity_score >= 75 ? 'Good' : p.productivity_score >= 60 ? 'Fair' : 'Poor'}</Badge>
              <div className="flex items-center gap-1">
                <button onClick={() => openEditProd(p)} className={button.ghost + ' p-1.5'}><Pencil className="w-4 h-4" /></button>
                <button onClick={() => removeProd(p.id)} disabled={actingOn === p.id} className={button.ghost + ' p-1.5 text-red-600 disabled:opacity-50'}>
                  {actingOn === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>
            </div>
          ))}
        </SectionCard>
      )}

      {/* ── Technician modal ────────────────────────────────────────────── */}
      <ModalSystem
        isOpen={showTechModal}
        onClose={() => (submitting ? undefined : setShowTechModal(false))}
        title={editingTech ? 'Edit Technician' : 'Add Technician'}
        subtitle={editingTech ? editingTech.name : 'Register a new technician'}
        variant="form"
        size="lg"
        loading={submitting}
        confirmLabel={submitting ? 'Saving…' : 'Save'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitTech}
        showFooter
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name">
              <input value={techForm.name} onChange={e => setTechForm(f => ({ ...f, name: e.target.value }))} placeholder="Full name" className={inputClass} />
            </Field>
            <Field label="Role">
              <select value={techForm.role} onChange={e => setTechForm(f => ({ ...f, role: e.target.value as TechRole }))} className={inputClass}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="Shift">
              <select value={techForm.shift} onChange={e => setTechForm(f => ({ ...f, shift: e.target.value as TechShift }))} className={inputClass}>
                {SHIFTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select value={techForm.status} onChange={e => setTechForm(f => ({ ...f, status: e.target.value as TechStatus }))} className={inputClass}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Zone">
              <select value={techForm.zone} onChange={e => setTechForm(f => ({ ...f, zone: e.target.value }))} className={inputClass}>
                {ZONES.map(z => <option key={z} value={z}>{z}</option>)}
              </select>
            </Field>
            <Field label="Hire Date">
              <input type="date" value={techForm.hireDate} onChange={e => setTechForm(f => ({ ...f, hireDate: e.target.value }))} className={inputClass} />
            </Field>
            <Field label="Phone">
              <input value={techForm.phone} onChange={e => setTechForm(f => ({ ...f, phone: e.target.value }))} placeholder="+251…" className={inputClass} />
            </Field>
            <Field label="Email">
              <input value={techForm.email} onChange={e => setTechForm(f => ({ ...f, email: e.target.value }))} placeholder="name@seleda.com" className={inputClass} />
            </Field>
            <Field label="Jobs Completed">
              <input type="number" value={techForm.jobsCompleted} onChange={e => setTechForm(f => ({ ...f, jobsCompleted: e.target.value }))} className={inputClass} />
            </Field>
            <Field label="Avg Response (min)">
              <input type="number" value={techForm.avgResponseMin} onChange={e => setTechForm(f => ({ ...f, avgResponseMin: e.target.value }))} className={inputClass} />
            </Field>
            <Field label="Workload (%)">
              <input type="number" min="0" max="100" value={techForm.workload} onChange={e => setTechForm(f => ({ ...f, workload: e.target.value }))} className={inputClass} />
            </Field>
          </div>
          <Field label="Skills (comma-separated)">
            <input value={techForm.skills} onChange={e => setTechForm(f => ({ ...f, skills: e.target.value }))} placeholder="Plumbing, Welding, Pipe Fitting" className={inputClass} />
          </Field>

          {/* HR Employee Link */}
          {!editingTech && (
            <div className="pt-3 border-t border-gray-200 dark:border-slate-700">
              <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">HR Employee Link</span>
              <div className="flex gap-2 mb-3">
                {(['new', 'existing', 'none'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setTechForm(f => ({ ...f, linkMode: m }))}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition ${techForm.linkMode === m ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}
                  >
                    {m === 'new' ? 'Create New' : m === 'existing' ? 'Link Existing' : 'No Link'}
                  </button>
                ))}
              </div>
              {techForm.linkMode === 'existing' && (
                <Field label="Select HR Employee">
                  <select value={techForm.employeeId} onChange={e => setTechForm(f => ({ ...f, employeeId: e.target.value }))} className={inputClass}>
                    <option value="">— Select employee —</option>
                    {availableEmployees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.name} — {emp.position || 'Staff'} ({emp.id})</option>
                    ))}
                  </select>
                </Field>
              )}
              {techForm.linkMode === 'new' && (
                <Field label="Salary">
                  <input type="number" min="0" value={techForm.salary} onChange={e => setTechForm(f => ({ ...f, salary: e.target.value }))} className={inputClass} />
                </Field>
              )}
              {techForm.linkMode === 'none' && <p className="text-xs text-slate-400">No HR employee record will be created. You can link later.</p>}
            </div>
          )}
        </div>
      </ModalSystem>

      {/* ── Technician detail modal ─────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!detailTech}
        onClose={() => setDetailTech(null)}
        title={detailTech?.name || 'Technician'}
        subtitle={detailTech?.role}
        variant="info"
        size="md"
        showFooter={false}
      >
        {detailTech && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[detailTech.status]}>{detailTech.status}</Badge>
              <Badge tone={ROLE_TONE[detailTech.role]}>{detailTech.role}</Badge>
              <Badge tone="neutral">{detailTech.shift}</Badge>
              {detailTech.zone && <Badge tone="neutral">{detailTech.zone}</Badge>}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase">Jobs</p>
                <p className="text-sm font-black text-gray-900 dark:text-white">{detailTech.jobs_completed}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase">Avg Resp</p>
                <p className="text-sm font-black text-gray-900 dark:text-white">{detailTech.avg_response_min}m</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase">Workload</p>
                <p className="text-sm font-black text-gray-900 dark:text-white">{detailTech.workload}%</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase">Hired</p>
                <p className="text-sm font-black text-gray-900 dark:text-white">{fmtDate(detailTech.hire_date)}</p>
              </div>
            </div>
            {(detailTech.phone || detailTech.email) && (
              <div className="flex items-center gap-4 pt-2 border-t border-gray-100 dark:border-slate-700">
                {detailTech.phone && <span className="text-xs text-gray-500 flex items-center gap-1"><Phone className="w-3 h-3" /> {detailTech.phone}</span>}
                {detailTech.email && <span className="text-xs text-gray-500 flex items-center gap-1"><Mail className="w-3 h-3" /> {detailTech.email}</span>}
              </div>
            )}
            {(detailTech.skills || []).length > 0 && (
              <div className="pt-2 border-t border-gray-100 dark:border-slate-700">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Skills</p>
                <div className="flex flex-wrap gap-1.5">
                  {(detailTech.skills || []).map(s => (
                    <span key={s} className="text-xs px-2 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-bold">{s}</span>
                  ))}
                </div>
              </div>
            )}
            {/* HR Employee Info */}
            <div className="pt-2 border-t border-gray-100 dark:border-slate-700">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1">
                  <Briefcase className="w-3 h-3" /> HR Employee
                </p>
                {detailTech.employee_id ? (
                  <Badge tone="success">Linked</Badge>
                ) : (
                  <button onClick={() => openLinkModal(detailTech)} className="text-[10px] font-bold text-indigo-600 hover:underline">
                    Link Employee
                  </button>
                )}
              </div>
              {detailTech.employee_id ? (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-gray-500 font-bold">Department:</span> <span className="text-gray-900 dark:text-white">{detailTech.hrDepartment || 'Engineering'}</span></div>
                  <div><span className="text-gray-500 font-bold">Position:</span> <span className="text-gray-900 dark:text-white">{detailTech.hrPosition || detailTech.role}</span></div>
                  {detailTech.hrEmail && <div><span className="text-gray-500 font-bold">Email:</span> <span className="text-gray-900 dark:text-white">{detailTech.hrEmail}</span></div>}
                  {detailTech.hrPhone && <div><span className="text-gray-500 font-bold">Phone:</span> <span className="text-gray-900 dark:text-white">{detailTech.hrPhone}</span></div>}
                  {detailTech.hrHireDate && <div><span className="text-gray-500 font-bold">Hired:</span> <span className="text-gray-900 dark:text-white">{fmtDate(detailTech.hrHireDate)}</span></div>}
                  {detailTech.hrSalary != null && <div><span className="text-gray-500 font-bold">Salary:</span> <span className="text-gray-900 dark:text-white">{Number(detailTech.hrSalary).toLocaleString()}</span></div>}
                </div>
              ) : (
                <p className="text-xs text-slate-400">Not linked to an HR employee record.</p>
              )}
            </div>
            <div className="flex items-center gap-2 pt-2 border-t border-gray-100 dark:border-slate-700">
              <button onClick={() => openEditTech(detailTech)} className={button.secondary + ' ml-auto'}>
                <Pencil className="w-4 h-4 inline mr-1" /> Edit
              </button>
              <button onClick={() => removeTech(detailTech.id)} disabled={actingOn === detailTech.id} className={button.ghost + ' text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50'}>
                <Trash2 className="w-4 h-4 inline mr-1" /> Delete
              </button>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* ── Link employee modal ─────────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!linkTarget}
        onClose={() => { if (!actingOn) { setLinkTarget(null); setLinkEmployeeId(''); } }}
        title={`Link ${linkTarget?.name || ''} to HR Employee`}
        subtitle="Select an HR employee record to link"
        variant="form"
        size="md"
        loading={actingOn === linkTarget?.id}
        confirmLabel={actingOn === linkTarget?.id ? 'Linking…' : 'Link Employee'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={linkEmployee}
        showFooter
      >
        <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
          Select an HR employee record from the Engineering department to link with this technician.
        </p>
        <Field label="HR Employee">
          <select value={linkEmployeeId} onChange={e => setLinkEmployeeId(e.target.value)} className={inputClass}>
            <option value="">— Select employee —</option>
            {availableEmployees.map(emp => (
              <option key={emp.id} value={emp.id}>{emp.name} — {emp.position || 'Staff'} ({emp.email || emp.phone || emp.id})</option>
            ))}
          </select>
        </Field>
        {availableEmployees.length === 0 && (
          <p className="text-xs text-slate-400 mt-2">No unlinked Engineering employees available. Create the technician with "Create New" HR link mode, or add employees in the HR portal first.</p>
        )}
      </ModalSystem>

      {/* ── Shift modal ─────────────────────────────────────────────────── */}
      <ModalSystem
        isOpen={showShiftModal}
        onClose={() => (submitting ? undefined : setShowShiftModal(false))}
        title={editingShift ? 'Edit Shift' : 'New Shift Requirement'}
        subtitle={editingShift ? editingShift.name : 'Define a shift requirement'}
        variant="form"
        size="md"
        loading={submitting}
        confirmLabel={submitting ? 'Saving…' : 'Save'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitShift}
        showFooter
      >
        <div className="space-y-4">
          <Field label="Shift Name">
            <input value={shiftForm.name} onChange={e => setShiftForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Morning Shift" className={inputClass} />
          </Field>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Shift">
              <select value={shiftForm.shift} onChange={e => setShiftForm(f => ({ ...f, shift: e.target.value as TechShift }))} className={inputClass}>
                {SHIFTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Start Time">
              <input type="time" value={shiftForm.startTime} onChange={e => setShiftForm(f => ({ ...f, startTime: e.target.value }))} className={inputClass} />
            </Field>
            <Field label="End Time">
              <input type="time" value={shiftForm.endTime} onChange={e => setShiftForm(f => ({ ...f, endTime: e.target.value }))} className={inputClass} />
            </Field>
            <Field label="Assigned Staff">
              <input type="number" min="0" value={shiftForm.assignedStaff} onChange={e => setShiftForm(f => ({ ...f, assignedStaff: e.target.value }))} className={inputClass} />
            </Field>
            <Field label="Required Staff">
              <input type="number" min="1" value={shiftForm.requiredStaff} onChange={e => setShiftForm(f => ({ ...f, requiredStaff: e.target.value }))} className={inputClass} />
            </Field>
          </div>
        </div>
      </ModalSystem>

      {/* ── Staffing modal ──────────────────────────────────────────────── */}
      <ModalSystem
        isOpen={showStaffingModal}
        onClose={() => (submitting ? undefined : setShowStaffingModal(false))}
        title={editingStaffing ? 'Edit Staffing Requirement' : 'New Staffing Requirement'}
        subtitle="Role-based staffing target"
        variant="form"
        size="md"
        loading={submitting}
        confirmLabel={submitting ? 'Saving…' : 'Save'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitStaffing}
        showFooter
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Role">
              <select value={staffingForm.role} onChange={e => setStaffingForm(f => ({ ...f, role: e.target.value as TechRole }))} className={inputClass}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="Zone">
              <select value={staffingForm.zone} onChange={e => setStaffingForm(f => ({ ...f, zone: e.target.value }))} className={inputClass}>
                {ZONES.map(z => <option key={z} value={z}>{z}</option>)}
              </select>
            </Field>
            <Field label="Shift">
              <select value={staffingForm.shift} onChange={e => setStaffingForm(f => ({ ...f, shift: e.target.value as TechShift }))} className={inputClass}>
                {SHIFTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Required Count">
              <input type="number" min="1" value={staffingForm.requiredCount} onChange={e => setStaffingForm(f => ({ ...f, requiredCount: e.target.value }))} className={inputClass} />
            </Field>
            <Field label="Assigned Count">
              <input type="number" min="0" value={staffingForm.assignedCount} onChange={e => setStaffingForm(f => ({ ...f, assignedCount: e.target.value }))} className={inputClass} />
            </Field>
          </div>
        </div>
      </ModalSystem>

      {/* ── Training modal ──────────────────────────────────────────────── */}
      <ModalSystem
        isOpen={showTrainingModal}
        onClose={() => (submitting ? undefined : setShowTrainingModal(false))}
        title={editingTraining ? 'Edit Training Record' : 'Assign Training'}
        subtitle="Certification or skill development"
        variant="form"
        size="md"
        loading={submitting}
        confirmLabel={submitting ? 'Saving…' : 'Save'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitTraining}
        showFooter
      >
        <div className="space-y-4">
          <Field label="Technician">
            <select value={trainingForm.technicianId} onChange={e => setTrainingForm(f => ({ ...f, technicianId: e.target.value }))} className={inputClass}>
              <option value="">— Unassigned —</option>
              {techs.map(t => <option key={t.id} value={t.id}>{t.name} ({t.role})</option>)}
            </select>
          </Field>
          <Field label="Course">
            <input value={trainingForm.course} onChange={e => setTrainingForm(f => ({ ...f, course: e.target.value }))} placeholder="e.g. Advanced Pipe Welding" className={inputClass} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Due Date">
              <input type="date" value={trainingForm.dueDate} onChange={e => setTrainingForm(f => ({ ...f, dueDate: e.target.value }))} className={inputClass} />
            </Field>
            <Field label="Status">
              <select value={trainingForm.status} onChange={e => setTrainingForm(f => ({ ...f, status: e.target.value as TrainingStatus }))} className={inputClass}>
                {TRAIN_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
        </div>
      </ModalSystem>

      {/* ── Productivity modal ──────────────────────────────────────────── */}
      <ModalSystem
        isOpen={showProdModal}
        onClose={() => (submitting ? undefined : setShowProdModal(false))}
        title={editingProd ? 'Edit Productivity Record' : 'Log Productivity'}
        subtitle="Jobs, hours, response time, and score"
        variant="form"
        size="md"
        loading={submitting}
        confirmLabel={submitting ? 'Saving…' : 'Save'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitProd}
        showFooter
      >
        <div className="space-y-4">
          <Field label="Technician">
            <select value={prodForm.technicianId} onChange={e => setProdForm(f => ({ ...f, technicianId: e.target.value }))} className={inputClass}>
              <option value="">— Unassigned —</option>
              {techs.map(t => <option key={t.id} value={t.id}>{t.name} ({t.role})</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Jobs Completed">
              <input type="number" min="0" value={prodForm.jobsCompleted} onChange={e => setProdForm(f => ({ ...f, jobsCompleted: e.target.value }))} className={inputClass} />
            </Field>
            <Field label="Hours">
              <input type="number" step="0.1" min="0" value={prodForm.hours} onChange={e => setProdForm(f => ({ ...f, hours: e.target.value }))} className={inputClass} />
            </Field>
            <Field label="Avg Response (min)">
              <input type="number" min="0" value={prodForm.avgResponseMin} onChange={e => setProdForm(f => ({ ...f, avgResponseMin: e.target.value }))} className={inputClass} />
            </Field>
            <Field label="Productivity Score (0–100)">
              <input type="number" min="0" max="100" value={prodForm.productivityScore} onChange={e => setProdForm(f => ({ ...f, productivityScore: e.target.value }))} className={inputClass} />
            </Field>
            <Field label="Period Date">
              <input type="date" value={prodForm.periodDate} onChange={e => setProdForm(f => ({ ...f, periodDate: e.target.value }))} className={inputClass} />
            </Field>
          </div>
        </div>
      </ModalSystem>

      {/* ── Attendance modal ───────────────────────────────────────────── */}
      <ModalSystem
        isOpen={showAttModal}
        onClose={() => (submitting ? undefined : setShowAttModal(false))}
        title={editingAtt ? 'Edit Attendance' : 'Check In Technician'}
        subtitle={editingAtt ? editingAtt.staffName : 'Record a check-in'}
        variant="form"
        size="md"
        loading={submitting}
        confirmLabel={submitting ? 'Saving…' : 'Save'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitAtt}
        showFooter
      >
        <div className="space-y-4">
          <Field label="Technician">
            <select
              value={attForm.staffId}
              onChange={e => {
                const t = techs.find(x => x.id === e.target.value);
                setAttForm(f => ({ ...f, staffId: e.target.value, staffName: t?.name || '', shift: t?.shift || f.shift }));
              }}
              disabled={!!editingAtt}
              className={inputClass + ' disabled:opacity-60'}
            >
              <option value="">— Select technician —</option>
              {techs.map(t => <option key={t.id} value={t.id}>{t.name} ({t.role})</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Shift">
              <select value={attForm.shift} onChange={e => setAttForm(f => ({ ...f, shift: e.target.value as TechShift }))} className={inputClass}>
                {SHIFTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select value={attForm.status} onChange={e => setAttForm(f => ({ ...f, status: e.target.value as AttendanceStatus }))} className={inputClass}>
                {ATT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Check In">
              <input type="datetime-local" value={attForm.checkIn} onChange={e => setAttForm(f => ({ ...f, checkIn: e.target.value }))} className={inputClass} />
            </Field>
            <Field label="Check Out">
              <input type="datetime-local" value={attForm.checkOut} onChange={e => setAttForm(f => ({ ...f, checkOut: e.target.value }))} className={inputClass} />
            </Field>
            <Field label="Hours Worked">
              <input type="number" step="0.01" min="0" value={attForm.hoursWorked} onChange={e => setAttForm(f => ({ ...f, hoursWorked: e.target.value }))} className={inputClass} />
            </Field>
            <Field label="Overtime Hours">
              <input type="number" step="0.01" min="0" value={attForm.overtimeHours} onChange={e => setAttForm(f => ({ ...f, overtimeHours: e.target.value }))} className={inputClass} />
            </Field>
            {!editingAtt && (
              <Field label="Attendance Date">
                <input type="date" value={attForm.attendanceDate} onChange={e => setAttForm(f => ({ ...f, attendanceDate: e.target.value }))} className={inputClass} />
              </Field>
            )}
          </div>
          <Field label="Notes (optional)">
            <textarea value={attForm.notes} onChange={e => setAttForm(f => ({ ...f, notes: e.target.value }))} rows={2} className={inputClass} />
          </Field>
        </div>
      </ModalSystem>

      {/* ── Attendance calendar detail modal ────────────────────────────── */}
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
                    {calendarStaff.employeeId && <Badge tone="success" icon={Link2}>HR Linked</Badge>}
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
              {[
                ['Present', calendarStaff.present], ['Late', calendarStaff.late], ['Absent', calendarStaff.absent],
                ['On Leave', calendarStaff.onLeave], ['Sick', calendarStaff.sick], ['Half Day', calendarStaff.halfDay],
                ['Day Off', calendarStaff.dayOff], ['Public Holiday', calendarStaff.publicHoliday],
                ['Work From Home', calendarStaff.workFromHome], ['Mission', calendarStaff.mission], ['Training Day', calendarStaff.trainingDay],
              ].filter(([, n]) => (n as number) > 0).map(([label, n]) => (
                <span key={label as string} className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-600 dark:text-slate-300">
                  <span className={`w-2.5 h-2.5 rounded-full ${ATT_STATUS_DOT[label as AttendanceStatus] || 'bg-slate-300'}`} />
                  {label} ({n as number})
                </span>
              ))}
            </div>

            {/* Records timeline */}
            <div className="overflow-y-auto p-5" style={{ maxHeight: '300px' }}>
              <div className="text-[10px] font-black text-slate-400 uppercase mb-3">Attendance History</div>
              <div className="space-y-2">
                {calendarStaff.records.map(r => (
                  <div key={r.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-850 hover:bg-slate-100 dark:hover:bg-slate-800 transition group">
                    <div className={`w-1 h-10 rounded-full ${ATT_STATUS_DOT[r.status]}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-900 dark:text-white">{r.attendanceDate}</span>
                        <Badge tone={r.shift === 'Morning' ? 'accent' : r.shift === 'Evening' ? 'info' : 'neutral'}>{r.shift}</Badge>
                        <Badge tone={ATT_STATUS_TONE[r.status]}>{r.status}</Badge>
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
                      <button onClick={() => { openEditAtt(r); setCalendarStaff(null); }} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => { removeAtt(r.id); }} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-between items-center p-4 border-t border-slate-100 dark:border-slate-700">
              <div className="text-[10px] text-slate-500">
                {calendarStaff.employeeId && <Badge tone="success" icon={Link2}>HR Linked</Badge>}
              </div>
              <button onClick={() => { setCalendarStaff(null); openNewAtt(); setAttForm(f => ({ ...f, staffId: calendarStaff.staffId, staffName: calendarStaff.staffName, shift: calendarStaff.records[0]?.shift || 'Morning' as TechShift })); }} className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 inline-flex items-center gap-1.5">
                <LogIn size={14} /> Check In
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Task detail modal (Work Orders) ────────────────────────────────── */}
      <ModalSystem
        isOpen={!!taskModalTech}
        onClose={() => { setTaskModalTech(null); setTechTasks([]); }}
        title={taskModalTech ? `${taskModalTech.name} — Assigned Work Orders` : 'Assigned Work Orders'}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {loadingTechTasks ? (
          <div className="flex items-center justify-center py-8 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading work orders…
          </div>
        ) : techTasks.length === 0 ? (
          <div className="text-center py-8">
            <ClipboardList className="w-10 h-10 mx-auto text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">No work orders assigned to this technician.</p>
            <p className="text-xs text-slate-400 mt-1">Assign work orders from the Work Order Management console.</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {techTasks.map(wo => {
              const woStatusTone: StatusTone = wo.status === 'Completed' || wo.status === 'Verified' || wo.status === 'Closed' ? 'success'
                : wo.status === 'In Progress' ? 'info'
                : wo.status === 'Waiting for Parts' || wo.status === 'Waiting for Vendor' ? 'warning'
                : 'neutral';
              const woPriorityTone: StatusTone = wo.priority === 'Critical' ? 'danger'
                : wo.priority === 'High' ? 'warning'
                : wo.priority === 'Medium' ? 'info' : 'neutral';
              return (
                <div key={wo.id} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-sm text-slate-900 dark:text-white">{wo.wo_number || wo.id}</span>
                      <Badge tone={woPriorityTone}>{wo.priority}</Badge>
                    </div>
                    <div className="text-xs text-slate-500 flex items-center gap-3">
                      <span>📍 {wo.fixed_assets?.location || wo.room_number || '—'}</span>
                      <span>📅 {wo.created_date ? fmtDate(wo.created_date) : '—'}</span>
                      {wo.type && <span className="text-[10px] uppercase font-bold text-slate-400">{wo.type}</span>}
                    </div>
                    {wo.description && <p className="text-xs text-slate-400 mt-1 truncate">{wo.description}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge tone={woStatusTone}>{wo.status}</Badge>
                    {wo.labor_hours > 0 && <span className="text-[10px] font-mono text-slate-400">{wo.labor_hours}h</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default StaffManagement;
