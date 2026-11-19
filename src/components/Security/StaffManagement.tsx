/**
 * Security Staff Management — /erp/security/staff.
 *
 * Staff availability moved here from the SOC tab and made fully DB-integrated
 * via /api/sec-portal/staff routes (migration 600, sec_staff table).
 *
 * Follows the HK StaffManagementModule / Engineering StaffManagement pattern:
 * PageHeader, StatCard KPIs, SectionCard + DataTable roster, filters,
 * inline quick reassignment, add/edit modal, soft-delete, ERP notifications.
 * Multi-property scoping via useERP().currentPropertyId.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Users, UserCheck, User, Plus, Pencil, Trash2, Search,
  Loader2, ServerCrash, RefreshCw, Shield, Phone, Mail,
  Radio, MapPin, CalendarDays, Clock, GraduationCap, Activity,
  ClipboardCheck, LogIn, LogOut, type LucideIcon,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import {
  fetchSecStaff, createSecStaff, updateSecStaff, deleteSecStaff,
  fetchSecShiftDefs, createSecShiftDef, updateSecShiftDef, deleteSecShiftDef,
  fetchSecCoverage, createSecCoverage, updateSecCoverage, deleteSecCoverage,
  fetchSecTraining, createSecTraining, updateSecTraining, deleteSecTraining,
  fetchSecAttendance, createSecAttendance, updateSecAttendance, deleteSecAttendance,
  fetchSecPerformance, createSecPerformance, updateSecPerformance, deleteSecPerformance,
  type SecStaff, type SecRole, type SecShift, type SecStaffStatus,
  type SecShiftDef, type SecStaffingReq, type SecTraining, type SecTrainingStatus,
  type SecAttendance, type SecAttendanceStatus, type SecPerformance,
} from '../../services/securityService';

// ── Static registries ────────────────────────────────────────────────────

const ROLES: SecRole[] = [
  'Security Officer', 'Security Supervisor', 'Security Manager',
  'Patrol Officer', 'CCTV Operator', 'Access Control Specialist',
];
const SHIFTS: SecShift[] = ['Day', 'Evening', 'Night'];
const STATUSES: SecStaffStatus[] = ['On Duty', 'On Break', 'Off Duty'];
const ATT_STATUSES: SecAttendanceStatus[] = [
  'Present', 'Late', 'Absent', 'On Leave', 'Sick', 'Half Day', 'Day Off', 'Training Day',
];
const TRAINING_STATUSES: SecTrainingStatus[] = ['Scheduled', 'In Progress', 'Completed', 'Expired'];

type SubTab = 'roster' | 'attendance' | 'shifts' | 'coverage' | 'training' | 'performance';
const SUB_TABS: { id: SubTab; label: string; icon: LucideIcon }[] = [
  { id: 'roster', label: 'Roster', icon: Users },
  { id: 'attendance', label: 'Attendance', icon: ClipboardCheck },
  { id: 'shifts', label: 'Shifts', icon: Clock },
  { id: 'coverage', label: 'Coverage', icon: MapPin },
  { id: 'training', label: 'Training', icon: GraduationCap },
  { id: 'performance', label: 'Performance', icon: Activity },
];

const ROLE_TONE: Record<SecRole, StatusTone> = {
  'Security Officer': 'accent',
  'Security Supervisor': 'success',
  'Security Manager': 'info',
  'Patrol Officer': 'warning',
  'CCTV Operator': 'info',
  'Access Control Specialist': 'neutral',
};

const STATUS_DOT: Record<SecStaffStatus, string> = {
  'On Duty': 'bg-emerald-500',
  'On Break': 'bg-amber-500',
  'Off Duty': 'bg-slate-400',
};

const ATT_TONE: Record<SecAttendanceStatus, StatusTone> = {
  Present: 'success', Late: 'warning', Absent: 'danger', 'On Leave': 'info',
  Sick: 'neutral', 'Half Day': 'info', 'Day Off': 'neutral', 'Training Day': 'accent',
};

const TRAINING_TONE: Record<SecTrainingStatus, StatusTone> = {
  Scheduled: 'info', 'In Progress': 'warning', Completed: 'success', Expired: 'danger',
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function scoreTone(score: number): StatusTone {
  if (score >= 85) return 'success';
  if (score >= 70) return 'info';
  return 'warning';
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
            <tr><td colSpan={emptyColSpan} className="px-6 py-8 text-center text-slate-400">No staff found.</td></tr>
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

  const [staff, setStaff] = useState<SecStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'All' | SecRole>('All');
  const [shiftFilter, setShiftFilter] = useState<'All' | SecShift>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | SecStaffStatus>('All');

  // Modals
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [editingStaff, setEditingStaff] = useState<SecStaff | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SecStaff | null>(null);

  const emptyForm = {
    name: '', role: 'Security Officer' as SecRole, shift: 'Day' as SecShift,
    status: 'Off Duty' as SecStaffStatus, location: '', radioChannel: '',
    phone: '', email: '',
  };
  const [form, setForm] = useState({ ...emptyForm });

  // Sub-tabs
  const [subTab, setSubTab] = useState<SubTab>('roster');
  const [shiftDefs, setShiftDefs] = useState<SecShiftDef[]>([]);
  const [coverage, setCoverage] = useState<SecStaffingReq[]>([]);
  const [training, setTraining] = useState<SecTraining[]>([]);
  const [attendance, setAttendance] = useState<SecAttendance[]>([]);
  const [performance, setPerformance] = useState<SecPerformance[]>([]);
  const [attDate, setAttDate] = useState(() => new Date().toISOString().slice(0, 10));

  // Sub-module modals
  const [shiftFormOpen, setShiftFormOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<SecShiftDef | null>(null);
  const [covFormOpen, setCovFormOpen] = useState(false);
  const [editingCov, setEditingCov] = useState<SecStaffingReq | null>(null);
  const [trainFormOpen, setTrainFormOpen] = useState(false);
  const [editingTrain, setEditingTrain] = useState<SecTraining | null>(null);
  const [attFormOpen, setAttFormOpen] = useState(false);
  const [editingAtt, setEditingAtt] = useState<SecAttendance | null>(null);
  const [perfFormOpen, setPerfFormOpen] = useState(false);
  const [editingPerf, setEditingPerf] = useState<SecPerformance | null>(null);
  const [subDelete, setSubDelete] = useState<{ kind: string; id: string; label: string } | null>(null);

  const [shiftForm, setShiftForm] = useState({ name: '', startTime: '07:00', endTime: '15:00', requiredStaff: '1', notes: '' });
  const [covForm, setCovForm] = useState({ post: '', role: 'Security Officer' as SecRole, shift: 'Day' as SecShift, requiredCount: '1', notes: '' });
  const [trainForm, setTrainForm] = useState({ staffId: '', course: '', provider: '', completedAt: '', expiresAt: '', status: 'Scheduled' as SecTrainingStatus, notes: '' });
  const [attForm, setAttForm] = useState({ staffId: '', date: '', shift: 'Day' as SecShift, status: 'Present' as SecAttendanceStatus, checkIn: '', checkOut: '', hoursWorked: '0', overtimeHours: '0', notes: '' });
  const [perfForm, setPerfForm] = useState({ staffId: '', periodDate: '', patrolsCompleted: '0', incidentsResponded: '0', reportsFiled: '0', hours: '0', score: '0', notes: '' });

  // ── Data loading ───────────────────────────────────────────────────────

  const loadStaff = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSecStaff(currentPropertyId);
      setStaff(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load security staff');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  const loadSubModule = useCallback(async (tab: SubTab) => {
    if (tab === 'roster') return;
    setLoading(true);
    try {
      if (tab === 'shifts') setShiftDefs(await fetchSecShiftDefs(currentPropertyId));
      else if (tab === 'coverage') setCoverage(await fetchSecCoverage(currentPropertyId));
      else if (tab === 'training') setTraining(await fetchSecTraining(currentPropertyId));
      else if (tab === 'attendance') setAttendance(await fetchSecAttendance(currentPropertyId, attDate ? { date: attDate } : undefined));
      else if (tab === 'performance') setPerformance(await fetchSecPerformance(currentPropertyId));
    } catch (e: any) {
      addNotification(e?.message || 'Failed to load data', 'warning', 'Security');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, attDate, addNotification]);

  useEffect(() => { loadStaff(); }, [loadStaff]);
  useEffect(() => { loadSubModule(subTab); }, [subTab, loadSubModule]);

  const refreshAll = async () => {
    await Promise.all([loadStaff(), loadSubModule(subTab)]);
    addNotification('Staff data refreshed', 'task', 'Security');
  };

  // ── Derived data ───────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    total: staff.length,
    onDuty: staff.filter(s => s.status === 'On Duty').length,
    onBreak: staff.filter(s => s.status === 'On Break').length,
    offDuty: staff.filter(s => s.status === 'Off Duty').length,
  }), [staff]);

  const filteredStaff = useMemo(() => {
    const q = search.toLowerCase();
    return staff.filter(s => {
      const matchesRole = roleFilter === 'All' || s.role === roleFilter;
      const matchesShift = shiftFilter === 'All' || s.shift === shiftFilter;
      const matchesStatus = statusFilter === 'All' || s.status === statusFilter;
      const matchesSearch = !q ||
        s.name.toLowerCase().includes(q) ||
        s.role.toLowerCase().includes(q) ||
        (s.location?.toLowerCase().includes(q) ?? false) ||
        (s.email?.toLowerCase().includes(q) ?? false);
      return matchesRole && matchesShift && matchesStatus && matchesSearch;
    });
  }, [staff, roleFilter, shiftFilter, statusFilter, search]);

  // ── Mutations ──────────────────────────────────────────────────────────

  const openNew = () => {
    setEditingStaff(null);
    setForm({ ...emptyForm });
    setShowStaffModal(true);
  };

  const openEdit = (s: SecStaff) => {
    setEditingStaff(s);
    setForm({
      name: s.name, role: s.role, shift: s.shift, status: s.status,
      location: s.location || '', radioChannel: s.radio_channel || '',
      phone: s.phone || '', email: s.email || '',
    });
    setShowStaffModal(true);
  };

  const saveStaff = async () => {
    if (!form.name.trim()) {
      addNotification('Name is required', 'warning', 'Security');
      return;
    }
    setSubmitting(true);
    try {
      if (editingStaff) {
        const res = await updateSecStaff(editingStaff.id, {
          name: form.name.trim(), role: form.role, shift: form.shift, status: form.status,
          location: form.location || null, radioChannel: form.radioChannel || null,
          phone: form.phone || null, email: form.email || null,
        });
        setStaff(prev => prev.map(s => (s.id === editingStaff.id ? res.staff : s)));
        addNotification(`${res.staff.name} updated`, 'task', 'Security');
      } else {
        const created = await createSecStaff({
          propertyId: currentPropertyId,
          name: form.name.trim(), role: form.role, shift: form.shift, status: form.status,
          location: form.location || null, radioChannel: form.radioChannel || null,
          phone: form.phone || null, email: form.email || null,
        });
        setStaff(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
        addNotification(`${created.name} added to roster`, 'task', 'Security');
      }
      setShowStaffModal(false);
      setEditingStaff(null);
      setForm({ ...emptyForm });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save staff member', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const quickUpdate = async (id: string, field: 'status' | 'shift' | 'role', value: string) => {
    setActingOn(id);
    try {
      const res = await updateSecStaff(id, { [field]: value } as any);
      setStaff(prev => prev.map(s => (s.id === id ? res.staff : s)));
      addNotification(`${res.staff.name} → ${value}`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Update failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const removeStaff = async () => {
    if (!deleteTarget) return;
    setActingOn(deleteTarget.id);
    try {
      await deleteSecStaff(deleteTarget.id);
      setStaff(prev => prev.filter(s => s.id !== deleteTarget.id));
      addNotification(`${deleteTarget.name} removed from roster`, 'task', 'Security');
      setDeleteTarget(null);
    } catch (e: any) {
      addNotification(e?.message || 'Delete failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  // ── Sub-module mutations ───────────────────────────────────────────────

  const saveShiftDef = async () => {
    if (!shiftForm.name.trim()) { addNotification('Shift name is required', 'warning', 'Security'); return; }
    setSubmitting(true);
    try {
      const payload = { name: shiftForm.name.trim(), startTime: shiftForm.startTime, endTime: shiftForm.endTime, requiredStaff: Number(shiftForm.requiredStaff) || 0, notes: shiftForm.notes || null };
      if (editingShift) await updateSecShiftDef(editingShift.id, payload);
      else await createSecShiftDef({ propertyId: currentPropertyId, ...payload });
      setShiftFormOpen(false); setEditingShift(null);
      setShiftDefs(await fetchSecShiftDefs(currentPropertyId));
      addNotification(editingShift ? 'Shift updated' : 'Shift created', 'task', 'Security');
    } catch (e: any) { addNotification(e?.message || 'Save failed', 'warning', 'Security'); }
    finally { setSubmitting(false); }
  };

  const saveCoverage = async () => {
    if (!covForm.post.trim()) { addNotification('Post is required', 'warning', 'Security'); return; }
    setSubmitting(true);
    try {
      const payload = { post: covForm.post.trim(), role: covForm.role, shift: covForm.shift, requiredCount: Number(covForm.requiredCount) || 0, notes: covForm.notes || null };
      if (editingCov) await updateSecCoverage(editingCov.id, payload);
      else await createSecCoverage({ propertyId: currentPropertyId, ...payload });
      setCovFormOpen(false); setEditingCov(null);
      setCoverage(await fetchSecCoverage(currentPropertyId));
      addNotification(editingCov ? 'Requirement updated' : 'Coverage requirement added', 'task', 'Security');
    } catch (e: any) { addNotification(e?.message || 'Save failed', 'warning', 'Security'); }
    finally { setSubmitting(false); }
  };

  const saveTraining = async () => {
    if (!trainForm.staffId || !trainForm.course.trim()) { addNotification('Staff member and course are required', 'warning', 'Security'); return; }
    setSubmitting(true);
    try {
      const payload = { staffId: trainForm.staffId, course: trainForm.course.trim(), provider: trainForm.provider || null, completedAt: trainForm.completedAt || null, expiresAt: trainForm.expiresAt || null, status: trainForm.status, notes: trainForm.notes || null };
      if (editingTrain) await updateSecTraining(editingTrain.id, payload);
      else await createSecTraining({ propertyId: currentPropertyId, ...payload });
      setTrainFormOpen(false); setEditingTrain(null);
      setTraining(await fetchSecTraining(currentPropertyId));
      addNotification(editingTrain ? 'Training record updated' : 'Training record added', 'task', 'Security');
    } catch (e: any) { addNotification(e?.message || 'Save failed', 'warning', 'Security'); }
    finally { setSubmitting(false); }
  };

  const saveAttendance = async () => {
    if (!attForm.staffId) { addNotification('Staff member is required', 'warning', 'Security'); return; }
    setSubmitting(true);
    try {
      if (editingAtt) {
        await updateSecAttendance(editingAtt.id, {
          date: attForm.date || undefined, shift: attForm.shift, status: attForm.status,
          checkIn: attForm.checkIn || null, checkOut: attForm.checkOut || null,
          hoursWorked: Number(attForm.hoursWorked) || 0, overtimeHours: Number(attForm.overtimeHours) || 0,
          notes: attForm.notes || null,
        });
        addNotification('Attendance record updated', 'task', 'Security');
      } else {
        await createSecAttendance({
          propertyId: currentPropertyId, staffId: attForm.staffId,
          date: attForm.date || undefined, shift: attForm.shift, status: attForm.status,
          checkIn: attForm.checkIn || undefined, notes: attForm.notes || null,
        });
        addNotification('Attendance recorded', 'task', 'Security');
      }
      setAttFormOpen(false); setEditingAtt(null);
      setAttendance(await fetchSecAttendance(currentPropertyId, attDate ? { date: attDate } : undefined));
    } catch (e: any) { addNotification(e?.message || 'Save failed', 'warning', 'Security'); }
    finally { setSubmitting(false); }
  };

  const quickCheckOut = async (rec: SecAttendance) => {
    setActingOn(rec.id);
    try {
      const now = new Date().toISOString();
      const hours = rec.check_in ? Math.max(0, (Date.now() - new Date(rec.check_in).getTime()) / 3600000) : 8;
      await updateSecAttendance(rec.id, { checkOut: now, hoursWorked: Number(hours.toFixed(2)) });
      setAttendance(await fetchSecAttendance(currentPropertyId, attDate ? { date: attDate } : undefined));
      addNotification(`${rec.sec_staff?.name || rec.staff_id} checked out`, 'task', 'Security');
    } catch (e: any) { addNotification(e?.message || 'Check-out failed', 'warning', 'Security'); }
    finally { setActingOn(null); }
  };

  const savePerformance = async () => {
    if (!perfForm.staffId || !perfForm.periodDate) { addNotification('Staff member and period are required', 'warning', 'Security'); return; }
    setSubmitting(true);
    try {
      const payload = {
        periodDate: perfForm.periodDate,
        patrolsCompleted: Number(perfForm.patrolsCompleted) || 0,
        incidentsResponded: Number(perfForm.incidentsResponded) || 0,
        reportsFiled: Number(perfForm.reportsFiled) || 0,
        hours: Number(perfForm.hours) || 0,
        score: Number(perfForm.score) || 0,
        notes: perfForm.notes || null,
      };
      if (editingPerf) await updateSecPerformance(editingPerf.id, payload);
      else await createSecPerformance({ propertyId: currentPropertyId, staffId: perfForm.staffId, ...payload });
      setPerfFormOpen(false); setEditingPerf(null);
      setPerformance(await fetchSecPerformance(currentPropertyId));
      addNotification(editingPerf ? 'Performance record updated' : 'Performance record added', 'task', 'Security');
    } catch (e: any) { addNotification(e?.message || 'Save failed', 'warning', 'Security'); }
    finally { setSubmitting(false); }
  };

  const removeSubRecord = async () => {
    if (!subDelete) return;
    setActingOn(subDelete.id);
    try {
      if (subDelete.kind === 'shift') { await deleteSecShiftDef(subDelete.id); setShiftDefs(await fetchSecShiftDefs(currentPropertyId)); }
      else if (subDelete.kind === 'coverage') { await deleteSecCoverage(subDelete.id); setCoverage(await fetchSecCoverage(currentPropertyId)); }
      else if (subDelete.kind === 'training') { await deleteSecTraining(subDelete.id); setTraining(await fetchSecTraining(currentPropertyId)); }
      else if (subDelete.kind === 'attendance') { await deleteSecAttendance(subDelete.id); setAttendance(await fetchSecAttendance(currentPropertyId, attDate ? { date: attDate } : undefined)); }
      else if (subDelete.kind === 'performance') { await deleteSecPerformance(subDelete.id); setPerformance(await fetchSecPerformance(currentPropertyId)); }
      addNotification(`${subDelete.label} removed`, 'task', 'Security');
      setSubDelete(null);
    } catch (e: any) { addNotification(e?.message || 'Delete failed', 'warning', 'Security'); }
    finally { setActingOn(null); }
  };

  const staffName = (id: string) => staff.find(s => s.id === id)?.name || id;

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Staff Management"
        subtitle="Roster, attendance, shifts, coverage, training and performance"
        icon={Shield}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            {subTab === 'roster' && (
              <button onClick={openNew} className={button.primary}>
                <Plus className="w-4 h-4" /> Add Staff
              </button>
            )}
            {subTab === 'attendance' && (
              <button onClick={() => { setEditingAtt(null); setAttForm({ staffId: '', date: attDate, shift: 'Day', status: 'Present', checkIn: '', checkOut: '', hoursWorked: '0', overtimeHours: '0', notes: '' }); setAttFormOpen(true); }} className={button.primary}>
                <LogIn className="w-4 h-4" /> Check In / Record
              </button>
            )}
            {subTab === 'shifts' && (
              <button onClick={() => { setEditingShift(null); setShiftForm({ name: '', startTime: '07:00', endTime: '15:00', requiredStaff: '1', notes: '' }); setShiftFormOpen(true); }} className={button.primary}>
                <Plus className="w-4 h-4" /> New Shift
              </button>
            )}
            {subTab === 'coverage' && (
              <button onClick={() => { setEditingCov(null); setCovForm({ post: '', role: 'Security Officer', shift: 'Day', requiredCount: '1', notes: '' }); setCovFormOpen(true); }} className={button.primary}>
                <Plus className="w-4 h-4" /> New Requirement
              </button>
            )}
            {subTab === 'training' && (
              <button onClick={() => { setEditingTrain(null); setTrainForm({ staffId: staff[0]?.id || '', course: '', provider: '', completedAt: '', expiresAt: '', status: 'Scheduled', notes: '' }); setTrainFormOpen(true); }} className={button.primary}>
                <Plus className="w-4 h-4" /> Add Training
              </button>
            )}
            {subTab === 'performance' && (
              <button onClick={() => { setEditingPerf(null); setPerfForm({ staffId: staff[0]?.id || '', periodDate: new Date().toISOString().slice(0, 10), patrolsCompleted: '0', incidentsResponded: '0', reportsFiled: '0', hours: '0', score: '0', notes: '' }); setPerfFormOpen(true); }} className={button.primary}>
                <Plus className="w-4 h-4" /> Add Record
              </button>
            )}
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Staff" value={stats.total} icon={Users} tone="accent" />
        <StatCard title="On Duty" value={stats.onDuty} icon={UserCheck} tone="success" />
        <StatCard title="On Break" value={stats.onBreak} icon={CalendarDays} tone="warning" />
        <StatCard title="Off Duty" value={stats.offDuty} icon={Users} tone="neutral" />
      </div>

      {/* Pill sub-tabs */}
      <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/60 p-1 rounded-xl w-fit flex-wrap">
        {SUB_TABS.map(t => {
          const Icon = t.icon;
          const active = subTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => { setSubTab(t.id); setSearch(''); }}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                active
                  ? 'bg-white dark:bg-slate-700 text-[var(--color-accent-operations)] shadow-sm'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={loadStaff} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {/* Filters (roster) */}
      {subTab === 'roster' && (
      <SectionCard pad="md">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, role, location, email…"
              className={inputClass + ' pl-9'}
            />
          </div>
          <select value={roleFilter} onChange={e => setRoleFilter(e.target.value as any)} className="bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-1.5 text-[10px] font-black uppercase text-slate-600 dark:text-slate-300 outline-none cursor-pointer">
            <option value="All">All Roles</option>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={shiftFilter} onChange={e => setShiftFilter(e.target.value as any)} className="bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-1.5 text-[10px] font-black uppercase text-slate-600 dark:text-slate-300 outline-none cursor-pointer">
            <option value="All">All Shifts</option>
            {SHIFTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-1.5 text-[10px] font-black uppercase text-slate-600 dark:text-slate-300 outline-none cursor-pointer">
            <option value="All">All Statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </SectionCard>
      )}

      {/* Roster */}
      {subTab === 'roster' && (
      <SectionCard title="Security Staff Roster" subtitle="Availability · Role · Shift · Post · Radio channel" icon={Shield} tone="accent" pad="none">
        {error ? (
          <div className="flex items-center gap-3 text-[var(--color-danger)] px-6 py-4">
            <ServerCrash size={18} /><span className="text-sm font-bold">{error}</span>
            <button onClick={loadStaff} className="ml-auto text-xs underline">Retry</button>
          </div>
        ) : loading ? <LoadingRow /> : (
          <DataTable
            headers={['Staff Member', 'Role', 'Shift', 'Status', 'Post / Location', 'Radio', 'Contact', '']}
            rows={filteredStaff.map(s => [
              <div className="flex items-center gap-3">
                <div className="relative shrink-0">
                  <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-[11px] font-black text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
                    {s.avatar || s.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-slate-800 ${STATUS_DOT[s.status]}`} />
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-slate-900 dark:text-white truncate">{s.name}</div>
                  <div className="text-[10px] text-slate-400 font-mono">{s.id}</div>
                  <div className="mt-0.5"><Badge tone={ROLE_TONE[s.role]}>{s.role}</Badge></div>
                </div>
              </div>,
              <select value={s.role} onChange={e => quickUpdate(s.id, 'role', e.target.value)} disabled={actingOn === s.id} className="bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-lg px-2 py-1 text-[9px] font-bold text-slate-600 dark:text-slate-300 outline-none cursor-pointer disabled:opacity-50">
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>,
              <select value={s.shift} onChange={e => quickUpdate(s.id, 'shift', e.target.value)} disabled={actingOn === s.id} className="bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-lg px-2 py-1 text-[9px] font-bold text-slate-600 dark:text-slate-300 outline-none cursor-pointer disabled:opacity-50">
                {SHIFTS.map(sh => <option key={sh} value={sh}>{sh}</option>)}
              </select>,
              <select value={s.status} onChange={e => quickUpdate(s.id, 'status', e.target.value)} disabled={actingOn === s.id} className="bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-lg px-2 py-1 text-[9px] font-bold text-slate-600 dark:text-slate-300 outline-none cursor-pointer disabled:opacity-50">
                {STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
              </select>,
              <span className="flex items-center gap-1.5"><MapPin size={12} className="text-slate-400" />{s.location || '—'}</span>,
              <span className="flex items-center gap-1.5"><Radio size={12} className="text-slate-400" />{s.radio_channel || '—'}</span>,
              <div className="space-y-0.5">
                {s.email && <div className="flex items-center gap-1 text-[10px]"><Mail size={10} className="text-slate-400" /> {s.email}</div>}
                {s.phone && <div className="flex items-center gap-1 text-[10px]"><Phone size={10} className="text-slate-400" /> {s.phone}</div>}
                {!s.email && !s.phone && <span className="text-xs text-slate-400">—</span>}
              </div>,
              <div className="inline-flex gap-2">
                <button onClick={() => openEdit(s)} disabled={actingOn === s.id} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit">
                  <Pencil className="w-4 h-4" />
                </button>
                <button onClick={() => setDeleteTarget(s)} disabled={actingOn === s.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Remove">
                  {actingOn === s.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>,
            ])}
            empty={filteredStaff.length === 0}
            emptyColSpan={8}
          />
        )}
      </SectionCard>
      )}

      {/* Attendance */}
      {subTab === 'attendance' && (
        <SectionCard
          title="Daily Attendance"
          subtitle="Check-ins, status, hours and overtime"
          icon={ClipboardCheck}
          tone="accent"
          pad="none"
          actions={
            <input
              type="date"
              value={attDate}
              onChange={e => setAttDate(e.target.value)}
              className={inputClass + ' !w-auto'}
            />
          }
        >
          {loading ? <LoadingRow /> : (
            <DataTable
              headers={['Staff Member', 'Date', 'Shift', 'Check-In', 'Check-Out', 'Hours', 'OT', 'Status', 'Notes', '']}
              rows={attendance.map(r => [
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-[10px] font-black text-indigo-600 dark:text-indigo-400">
                    {(r.sec_staff?.name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="font-medium text-slate-900 dark:text-white text-xs">{r.sec_staff?.name || r.staff_id}</div>
                    <div className="text-[10px] text-slate-400">{r.sec_staff?.role}</div>
                  </div>
                </div>,
                <span className="text-xs">{fmtDate(r.attendance_date)}</span>,
                <Badge tone="neutral">{r.shift}</Badge>,
                <span className="text-xs font-mono">{fmtTime(r.check_in)}</span>,
                r.check_out
                  ? <span className="text-xs font-mono">{fmtTime(r.check_out)}</span>
                  : r.check_in
                    ? <button onClick={() => quickCheckOut(r)} disabled={actingOn === r.id} className={button.secondary + ' !py-1 !px-2 !text-[10px]'}>
                        {actingOn === r.id ? <Loader2 size={11} className="animate-spin" /> : <LogOut size={11} />} Check Out
                      </button>
                    : <span className="text-xs text-slate-400">—</span>,
                <span className="text-xs font-mono">{r.hours_worked}h</span>,
                <span className={`text-xs font-mono ${r.overtime_hours > 0 ? 'text-amber-600 font-bold' : ''}`}>{r.overtime_hours}h</span>,
                <Badge tone={ATT_TONE[r.status]}>{r.status}</Badge>,
                <span className="text-xs text-slate-400 max-w-[160px] truncate block">{r.notes || '—'}</span>,
                <div className="inline-flex gap-2">
                  <button
                    onClick={() => {
                      setEditingAtt(r);
                      setAttForm({
                        staffId: r.staff_id, date: r.attendance_date, shift: r.shift, status: r.status,
                        checkIn: r.check_in ? r.check_in.slice(0, 16) : '',
                        checkOut: r.check_out ? r.check_out.slice(0, 16) : '',
                        hoursWorked: String(r.hours_worked), overtimeHours: String(r.overtime_hours),
                        notes: r.notes || '',
                      });
                      setAttFormOpen(true);
                    }}
                    disabled={actingOn === r.id}
                    className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit"
                  ><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => setSubDelete({ kind: 'attendance', id: r.id, label: `attendance ${r.id}` })} disabled={actingOn === r.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>,
              ])}
              empty={attendance.length === 0}
              emptyColSpan={10}
            />
          )}
        </SectionCard>
      )}

      {/* Shifts */}
      {subTab === 'shifts' && (
        <SectionCard title="Shift Definitions" subtitle="Window · Required vs assigned staffing" icon={Clock} tone="accent" pad="none">
          {loading ? <LoadingRow /> : (
            <DataTable
              headers={['Shift', 'Window', 'Required', 'Assigned', 'Gap', 'Notes', '']}
              rows={shiftDefs.map(d => {
                const gap = d.required_staff - (d.assigned_staff ?? 0);
                return [
                  <div className="font-medium text-slate-900 dark:text-white">{d.name}<div className="text-[10px] text-slate-400 font-mono">{d.id}</div></div>,
                  <span className="text-xs font-mono">{d.start_time} – {d.end_time}</span>,
                  <span className="font-mono text-sm font-bold">{d.required_staff}</span>,
                  <span className="font-mono text-sm">{d.assigned_staff ?? 0}</span>,
                  gap > 0
                    ? <Badge tone="danger">-{gap} short</Badge>
                    : gap < 0
                      ? <Badge tone="info">+{-gap} over</Badge>
                      : <Badge tone="success">Covered</Badge>,
                  <span className="text-xs text-slate-400">{d.notes || '—'}</span>,
                  <div className="inline-flex gap-2">
                    <button onClick={() => { setEditingShift(d); setShiftForm({ name: d.name, startTime: d.start_time, endTime: d.end_time, requiredStaff: String(d.required_staff), notes: d.notes || '' }); setShiftFormOpen(true); }} disabled={actingOn === d.id} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => setSubDelete({ kind: 'shift', id: d.id, label: `shift ${d.name}` })} disabled={actingOn === d.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete"><Trash2 className="w-4 h-4" /></button>
                  </div>,
                ];
              })}
              empty={shiftDefs.length === 0}
              emptyColSpan={7}
            />
          )}
        </SectionCard>
      )}

      {/* Coverage */}
      {subTab === 'coverage' && (
        <SectionCard title="Coverage Requirements" subtitle="Post · Role · Shift · Required vs assigned" icon={MapPin} tone="accent" pad="none">
          {loading ? <LoadingRow /> : (
            <DataTable
              headers={['Post / Zone', 'Role', 'Shift', 'Required', 'Assigned', 'Gap', 'Notes', '']}
              rows={coverage.map(r => {
                const gap = r.required_count - (r.assigned_count ?? 0);
                return [
                  <div className="flex items-center gap-2">
                    <MapPin size={14} className="text-slate-400 shrink-0" />
                    <span className="font-medium text-slate-900 dark:text-white">{r.post}</span>
                  </div>,
                  <Badge tone={ROLE_TONE[r.role]}>{r.role}</Badge>,
                  <Badge tone="neutral">{r.shift}</Badge>,
                  <span className="font-mono text-sm font-bold">{r.required_count}</span>,
                  <span className="font-mono text-sm">{r.assigned_count ?? 0}</span>,
                  gap > 0
                    ? <Badge tone="danger">-{gap} short</Badge>
                    : gap < 0
                      ? <Badge tone="info">+{-gap} over</Badge>
                      : <Badge tone="success">Covered</Badge>,
                  <span className="text-xs text-slate-400">{r.notes || '—'}</span>,
                  <div className="inline-flex gap-2">
                    <button onClick={() => { setEditingCov(r); setCovForm({ post: r.post, role: r.role, shift: r.shift, requiredCount: String(r.required_count), notes: r.notes || '' }); setCovFormOpen(true); }} disabled={actingOn === r.id} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => setSubDelete({ kind: 'coverage', id: r.id, label: `requirement ${r.id}` })} disabled={actingOn === r.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete"><Trash2 className="w-4 h-4" /></button>
                  </div>,
                ];
              })}
              empty={coverage.length === 0}
              emptyColSpan={8}
            />
          )}
        </SectionCard>
      )}

      {/* Training */}
      {subTab === 'training' && (
        <SectionCard title="Training & Certifications" subtitle="Course · Staff · Completion · Expiry" icon={GraduationCap} tone="accent" pad="none">
          {loading ? <LoadingRow /> : (
            <DataTable
              headers={['Course', 'Staff Member', 'Provider', 'Completed', 'Expires', 'Status', 'Notes', '']}
              rows={training.map(t => [
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 dark:text-white">{t.course}</div>
                  <div className="text-[10px] text-slate-400 font-mono">{t.id}</div>
                </div>,
                <span className="text-xs flex items-center gap-1"><User size={11} className="text-slate-400" />{t.sec_staff?.name || staffName(t.staff_id)}</span>,
                <span className="text-xs text-slate-500">{t.provider || '—'}</span>,
                <span className="text-xs">{fmtDate(t.completed_at)}</span>,
                <span className={`text-xs ${t.status === 'Expired' ? 'text-red-600 font-semibold' : ''}`}>{fmtDate(t.expires_at)}</span>,
                <Badge tone={TRAINING_TONE[t.status]}>{t.status}</Badge>,
                <span className="text-xs text-slate-400 max-w-[160px] truncate block">{t.notes || '—'}</span>,
                <div className="inline-flex gap-2">
                  {t.status !== 'Completed' && (
                    <button
                      onClick={async () => {
                        setActingOn(t.id);
                        try {
                          await updateSecTraining(t.id, { status: 'Completed', completedAt: new Date().toISOString().slice(0, 10) });
                          setTraining(await fetchSecTraining(currentPropertyId));
                          addNotification(`${t.course} marked complete`, 'task', 'Security');
                        } catch (e: any) { addNotification(e?.message || 'Update failed', 'warning', 'Security'); }
                        finally { setActingOn(null); }
                      }}
                      disabled={actingOn === t.id}
                      className="p-1 text-slate-400 hover:text-emerald-500" title="Mark Completed"
                    ><ClipboardCheck className="w-4 h-4" /></button>
                  )}
                  <button
                    onClick={() => {
                      setEditingTrain(t);
                      setTrainForm({
                        staffId: t.staff_id, course: t.course, provider: t.provider || '',
                        completedAt: t.completed_at || '', expiresAt: t.expires_at || '',
                        status: t.status, notes: t.notes || '',
                      });
                      setTrainFormOpen(true);
                    }}
                    disabled={actingOn === t.id}
                    className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit"
                  ><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => setSubDelete({ kind: 'training', id: t.id, label: `training ${t.id}` })} disabled={actingOn === t.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete"><Trash2 className="w-4 h-4" /></button>
                </div>,
              ])}
              empty={training.length === 0}
              emptyColSpan={8}
            />
          )}
        </SectionCard>
      )}

      {/* Performance */}
      {subTab === 'performance' && (
        <SectionCard title="Performance Metrics" subtitle="Period · Patrols · Incidents · Reports · Score" icon={Activity} tone="accent" pad="none">
          {loading ? <LoadingRow /> : (
            <DataTable
              headers={['Staff Member', 'Period', 'Patrols', 'Incidents', 'Reports', 'Hours', 'Score', 'Notes', '']}
              rows={performance.map(p => [
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-[10px] font-black text-indigo-600 dark:text-indigo-400">
                    {(p.sec_staff?.name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="font-medium text-slate-900 dark:text-white text-xs">{p.sec_staff?.name || p.staff_id}</div>
                    <div className="text-[10px] text-slate-400">{p.sec_staff?.role}</div>
                  </div>
                </div>,
                <span className="text-xs">{fmtDate(p.period_date)}</span>,
                <span className="font-mono text-sm">{p.patrols_completed}</span>,
                <span className="font-mono text-sm">{p.incidents_responded}</span>,
                <span className="font-mono text-sm">{p.reports_filed}</span>,
                <span className="font-mono text-sm">{p.hours}h</span>,
                <Badge tone={scoreTone(p.score)}>{p.score}</Badge>,
                <span className="text-xs text-slate-400 max-w-[160px] truncate block">{p.notes || '—'}</span>,
                <div className="inline-flex gap-2">
                  <button
                    onClick={() => {
                      setEditingPerf(p);
                      setPerfForm({
                        staffId: p.staff_id, periodDate: p.period_date,
                        patrolsCompleted: String(p.patrols_completed), incidentsResponded: String(p.incidents_responded),
                        reportsFiled: String(p.reports_filed), hours: String(p.hours), score: String(p.score),
                        notes: p.notes || '',
                      });
                      setPerfFormOpen(true);
                    }}
                    disabled={actingOn === p.id}
                    className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit"
                  ><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => setSubDelete({ kind: 'performance', id: p.id, label: `record ${p.id}` })} disabled={actingOn === p.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete"><Trash2 className="w-4 h-4" /></button>
                </div>,
              ])}
              empty={performance.length === 0}
              emptyColSpan={9}
            />
          )}
        </SectionCard>
      )}

      {/* Add / Edit staff modal */}
      <ModalSystem
        isOpen={showStaffModal}
        onClose={() => { setShowStaffModal(false); setEditingStaff(null); }}
        onConfirm={saveStaff}
        title={editingStaff ? `Edit ${editingStaff.name}` : 'Add Security Staff'}
        subtitle={editingStaff ? 'Update roster details' : 'Add a new member to the security roster'}
        variant="form"
        loading={submitting}
        confirmLabel={editingStaff ? 'Save Changes' : 'Add Staff'}
      >
        <div className="space-y-4">
          <Field label="Full Name">
            <input className={inputClass} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. John D." />
          </Field>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Role">
              <select className={inputClass} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as SecRole }))}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="Shift">
              <select className={inputClass} value={form.shift} onChange={e => setForm(f => ({ ...f, shift: e.target.value as SecShift }))}>
                {SHIFTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className={inputClass} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as SecStaffStatus }))}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Post / Location">
              <input className={inputClass} value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Guest Floors" />
            </Field>
            <Field label="Radio Channel">
              <input className={inputClass} value={form.radioChannel} onChange={e => setForm(f => ({ ...f, radioChannel: e.target.value }))} placeholder="e.g. CH-1" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Phone">
              <input className={inputClass} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+251…" />
            </Field>
            <Field label="Email">
              <input className={inputClass} type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="name@seleda.com" />
            </Field>
          </div>
        </div>
      </ModalSystem>

      {/* Shift definition form */}
      <ModalSystem isOpen={shiftFormOpen} onClose={() => { setShiftFormOpen(false); setEditingShift(null); }} title={editingShift ? 'Edit Shift' : 'New Shift'} size="md">
        <div className="p-6 space-y-4">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Shift Name *</label>
            <input className={inputClass} value={shiftForm.name} onChange={e => setShiftForm({ ...shiftForm, name: e.target.value })} placeholder="e.g. Day / Swing / Night" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Start Time</label>
              <input type="time" className={inputClass} value={shiftForm.startTime} onChange={e => setShiftForm({ ...shiftForm, startTime: e.target.value })} />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">End Time</label>
              <input type="time" className={inputClass} value={shiftForm.endTime} onChange={e => setShiftForm({ ...shiftForm, endTime: e.target.value })} />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Required Staff</label>
              <input type="number" min={0} className={inputClass} value={shiftForm.requiredStaff} onChange={e => setShiftForm({ ...shiftForm, requiredStaff: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Notes</label>
            <textarea className={inputClass} rows={2} value={shiftForm.notes} onChange={e => setShiftForm({ ...shiftForm, notes: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button className={button.secondary} onClick={() => { setShiftFormOpen(false); setEditingShift(null); }}>Cancel</button>
            <button className={button.primary} onClick={saveShiftDef} disabled={submitting}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{editingShift ? 'Save Changes' : 'Create Shift'}
            </button>
          </div>
        </div>
      </ModalSystem>

      {/* Coverage requirement form */}
      <ModalSystem isOpen={covFormOpen} onClose={() => { setCovFormOpen(false); setEditingCov(null); }} title={editingCov ? 'Edit Requirement' : 'New Coverage Requirement'} size="md">
        <div className="p-6 space-y-4">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Post / Zone *</label>
            <input className={inputClass} value={covForm.post} onChange={e => setCovForm({ ...covForm, post: e.target.value })} placeholder="e.g. Main Gate, Pool Deck, Lobby" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Role</label>
              <select className={inputClass} value={covForm.role} onChange={e => setCovForm({ ...covForm, role: e.target.value as SecRole })}>
                {ROLES.map(r => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Shift</label>
              <select className={inputClass} value={covForm.shift} onChange={e => setCovForm({ ...covForm, shift: e.target.value as SecShift })}>
                {SHIFTS.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Required Count</label>
              <input type="number" min={0} className={inputClass} value={covForm.requiredCount} onChange={e => setCovForm({ ...covForm, requiredCount: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Notes</label>
            <textarea className={inputClass} rows={2} value={covForm.notes} onChange={e => setCovForm({ ...covForm, notes: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button className={button.secondary} onClick={() => { setCovFormOpen(false); setEditingCov(null); }}>Cancel</button>
            <button className={button.primary} onClick={saveCoverage} disabled={submitting}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{editingCov ? 'Save Changes' : 'Add Requirement'}
            </button>
          </div>
        </div>
      </ModalSystem>

      {/* Training record form */}
      <ModalSystem isOpen={trainFormOpen} onClose={() => { setTrainFormOpen(false); setEditingTrain(null); }} title={editingTrain ? 'Edit Training Record' : 'Add Training Record'} size="md">
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Staff Member *</label>
              <select className={inputClass} value={trainForm.staffId} onChange={e => setTrainForm({ ...trainForm, staffId: e.target.value })}>
                <option value="">Select staff…</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name} — {s.role}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Course / Certification *</label>
              <input className={inputClass} value={trainForm.course} onChange={e => setTrainForm({ ...trainForm, course: e.target.value })} placeholder="e.g. First Aid, CCTV Operation" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Provider</label>
              <input className={inputClass} value={trainForm.provider} onChange={e => setTrainForm({ ...trainForm, provider: e.target.value })} placeholder="e.g. Red Cross, Internal" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Status</label>
              <select className={inputClass} value={trainForm.status} onChange={e => setTrainForm({ ...trainForm, status: e.target.value as SecTrainingStatus })}>
                {TRAINING_STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Completed On</label>
              <input type="date" className={inputClass} value={trainForm.completedAt} onChange={e => setTrainForm({ ...trainForm, completedAt: e.target.value })} />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Expires On</label>
              <input type="date" className={inputClass} value={trainForm.expiresAt} onChange={e => setTrainForm({ ...trainForm, expiresAt: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Notes</label>
            <textarea className={inputClass} rows={2} value={trainForm.notes} onChange={e => setTrainForm({ ...trainForm, notes: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button className={button.secondary} onClick={() => { setTrainFormOpen(false); setEditingTrain(null); }}>Cancel</button>
            <button className={button.primary} onClick={saveTraining} disabled={submitting}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{editingTrain ? 'Save Changes' : 'Add Record'}
            </button>
          </div>
        </div>
      </ModalSystem>

      {/* Attendance form */}
      <ModalSystem isOpen={attFormOpen} onClose={() => { setAttFormOpen(false); setEditingAtt(null); }} title={editingAtt ? 'Edit Attendance' : 'Record Attendance / Check-In'} size="md">
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Staff Member *</label>
              <select className={inputClass} value={attForm.staffId} onChange={e => setAttForm({ ...attForm, staffId: e.target.value })} disabled={!!editingAtt}>
                <option value="">Select staff…</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name} — {s.role}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Date</label>
              <input type="date" className={inputClass} value={attForm.date} onChange={e => setAttForm({ ...attForm, date: e.target.value })} />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Shift</label>
              <select className={inputClass} value={attForm.shift} onChange={e => setAttForm({ ...attForm, shift: e.target.value as SecShift })}>
                {SHIFTS.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Status</label>
              <select className={inputClass} value={attForm.status} onChange={e => setAttForm({ ...attForm, status: e.target.value as SecAttendanceStatus })}>
                {ATT_STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Check-In</label>
              <input type="datetime-local" className={inputClass} value={attForm.checkIn} onChange={e => setAttForm({ ...attForm, checkIn: e.target.value })} />
            </div>
            {editingAtt && (
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Check-Out</label>
                <input type="datetime-local" className={inputClass} value={attForm.checkOut} onChange={e => setAttForm({ ...attForm, checkOut: e.target.value })} />
              </div>
            )}
            {editingAtt && (
              <>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Hours Worked</label>
                  <input type="number" step="0.25" min={0} className={inputClass} value={attForm.hoursWorked} onChange={e => setAttForm({ ...attForm, hoursWorked: e.target.value })} />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Overtime (h)</label>
                  <input type="number" step="0.25" min={0} className={inputClass} value={attForm.overtimeHours} onChange={e => setAttForm({ ...attForm, overtimeHours: e.target.value })} />
                </div>
              </>
            )}
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Notes</label>
            <textarea className={inputClass} rows={2} value={attForm.notes} onChange={e => setAttForm({ ...attForm, notes: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button className={button.secondary} onClick={() => { setAttFormOpen(false); setEditingAtt(null); }}>Cancel</button>
            <button className={button.primary} onClick={saveAttendance} disabled={submitting}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{editingAtt ? 'Save Changes' : 'Record'}
            </button>
          </div>
        </div>
      </ModalSystem>

      {/* Performance form */}
      <ModalSystem isOpen={perfFormOpen} onClose={() => { setPerfFormOpen(false); setEditingPerf(null); }} title={editingPerf ? 'Edit Performance Record' : 'Add Performance Record'} size="md">
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Staff Member *</label>
              <select className={inputClass} value={perfForm.staffId} onChange={e => setPerfForm({ ...perfForm, staffId: e.target.value })} disabled={!!editingPerf}>
                <option value="">Select staff…</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name} — {s.role}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Period Date *</label>
              <input type="date" className={inputClass} value={perfForm.periodDate} onChange={e => setPerfForm({ ...perfForm, periodDate: e.target.value })} />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Patrols Completed</label>
              <input type="number" min={0} className={inputClass} value={perfForm.patrolsCompleted} onChange={e => setPerfForm({ ...perfForm, patrolsCompleted: e.target.value })} />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Incidents Responded</label>
              <input type="number" min={0} className={inputClass} value={perfForm.incidentsResponded} onChange={e => setPerfForm({ ...perfForm, incidentsResponded: e.target.value })} />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Reports Filed</label>
              <input type="number" min={0} className={inputClass} value={perfForm.reportsFiled} onChange={e => setPerfForm({ ...perfForm, reportsFiled: e.target.value })} />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Hours</label>
              <input type="number" step="0.5" min={0} className={inputClass} value={perfForm.hours} onChange={e => setPerfForm({ ...perfForm, hours: e.target.value })} />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Score (0–100)</label>
              <input type="number" min={0} max={100} className={inputClass} value={perfForm.score} onChange={e => setPerfForm({ ...perfForm, score: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Notes</label>
            <textarea className={inputClass} rows={2} value={perfForm.notes} onChange={e => setPerfForm({ ...perfForm, notes: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button className={button.secondary} onClick={() => { setPerfFormOpen(false); setEditingPerf(null); }}>Cancel</button>
            <button className={button.primary} onClick={savePerformance} disabled={submitting}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{editingPerf ? 'Save Changes' : 'Add Record'}
            </button>
          </div>
        </div>
      </ModalSystem>

      {/* Sub-record delete confirm */}
      <ModalSystem
        isOpen={!!subDelete}
        onClose={() => setSubDelete(null)}
        onConfirm={removeSubRecord}
        title="Remove Record"
        subtitle={subDelete ? `Remove ${subDelete.label}? This cannot be undone.` : ''}
        variant="confirm"
        loading={!!subDelete && actingOn === subDelete.id}
        confirmLabel="Remove"
        confirmColor="rose"
      />

      {/* Delete confirm */}
      <ModalSystem
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={removeStaff}
        title="Remove Staff Member"
        subtitle={deleteTarget ? `Remove ${deleteTarget.name} from the security roster?` : ''}
        variant="confirm"
        loading={actingOn === deleteTarget?.id}
        confirmLabel="Remove"
        confirmColor="rose"
      />
    </div>
  );
};

export default StaffManagement;
