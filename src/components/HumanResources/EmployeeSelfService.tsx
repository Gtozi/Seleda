/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Employee Self-Service (ESS) — HR > ESS module.
 *
 * DB-integrated via /api/hr-portal/ess/* routes. Reuses existing
 * tables (employees, payslips, staff_attendance, expense_claims) and
 * new tables (hr_leave_balances, hr_leave_requests, hr_training_requests,
 * hr_company_documents) from migration 415.
 *
 * UI follows the F&B / Housekeeping portal pattern: StatCard KPIs,
 * PageHeader, SectionCard, Badge, ModalSystem, brandTheme.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  User,
  Calendar,
  DollarSign,
  FileText,
  Clock,
  GraduationCap,
  FolderOpen,
  CreditCard,
  Settings,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  Loader2,
  Download,
  Search,
  type LucideIcon,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';

type Tab = 'profile' | 'payslips' | 'leave' | 'attendance' | 'expenses' | 'training' | 'documents';

interface Profile {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  department: string | null;
  position: string | null;
  status: string | null;
  employment_type: string | null;
  date_of_birth: string | null;
  gender: string | null;
  nationality: string | null;
  address: string | null;
  hire_date: string | null;
  employee_number: string | null;
  bank_account: string | null;
  pension_number: string | null;
  salary: number | null;
  avatar_initials: string | null;
}

interface Payslip {
  id: string;
  period: string;
  pay_date?: string;
  paid_at?: string;
  gross_pay: number;
  net_pay: number;
  status: string;
}

interface LeaveBalance {
  id: string;
  leave_type: string;
  total_days: number;
  used_days: number;
  remaining: number;
}

interface LeaveRequest {
  id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
  status: string;
}

interface Attendance {
  id: string;
  attendance_date: string;
  check_in: string | null;
  check_out: string | null;
  hours_worked: number;
  status: string;
  shift: string;
}

interface Expense {
  id: string;
  category: string;
  description: string | null;
  amount: number;
  submitted_date: string | null;
  status: string;
}

interface Training {
  id: string;
  course: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
}

interface CompanyDoc {
  id: string;
  name: string;
  type: string;
  document_date: string;
  status: string;
}

interface Stats {
  leaveRemaining: number;
  pendingLeaveRequests: number;
  payslipsAvailable: number;
  pendingTraining: number;
}

const LEAVE_STATUS_TONE: Record<string, StatusTone> = {
  Pending: 'warning',
  Approved: 'success',
  Rejected: 'danger',
  Cancelled: 'neutral',
};

const EXPENSE_STATUS_TONE: Record<string, StatusTone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  paid: 'info',
};

const TRAINING_STATUS_TONE: Record<string, StatusTone> = {
  Pending: 'warning',
  Approved: 'success',
  Rejected: 'danger',
  Completed: 'info',
};

const DOC_STATUS_TONE: Record<string, StatusTone> = {
  Active: 'success',
  Current: 'info',
  Valid: 'success',
  Expired: 'danger',
  Archived: 'neutral',
};

const ATTENDANCE_STATUS_TONE: Record<string, StatusTone> = {
  Present: 'success',
  Late: 'warning',
  Absent: 'danger',
  'On Leave': 'info',
  Sick: 'info',
  'Half Day': 'warning',
};

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'payslips', label: 'Payslips', icon: DollarSign },
  { id: 'leave', label: 'Leave', icon: Calendar },
  { id: 'attendance', label: 'Attendance', icon: Clock },
  { id: 'expenses', label: 'Expenses', icon: CreditCard },
  { id: 'training', label: 'Training', icon: GraduationCap },
  { id: 'documents', label: 'Documents', icon: FolderOpen },
];

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
  return (
    <div className="flex items-center justify-center py-10 text-slate-400">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
    </div>
  );
}

const EmployeeSelfService = () => {
  const { currentPropertyId, userProfile, addNotification } = useERP();
  const employeeId = userProfile?.employeeId || 'EMP-FO-MGR';

  const [activeTab, setActiveTab] = useState<Tab>('profile');

  const [profile, setProfile] = useState<Profile | null>(null);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [training, setTraining] = useState<Training[]>([]);
  const [documents, setDocuments] = useState<CompanyDoc[]>([]);
  const [stats, setStats] = useState<Stats>({ leaveRemaining: 0, pendingLeaveRequests: 0, payslipsAvailable: 0, pendingTraining: 0 });

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState('');

  // Modals
  const [profileEdit, setProfileEdit] = useState(false);
  const [leaveModal, setLeaveModal] = useState<{ mode: 'create' | 'edit'; r: LeaveRequest | null } | null>(null);
  const [expenseModal, setExpenseModal] = useState<{ mode: 'create' | 'edit'; e: Expense | null } | null>(null);
  const [trainingModal, setTrainingModal] = useState<{ mode: 'create' | 'edit'; t: Training | null } | null>(null);
  const [deleteLeave, setDeleteLeave] = useState<LeaveRequest | null>(null);
  const [deleteExpense, setDeleteExpense] = useState<Expense | null>(null);
  const [deleteTraining, setDeleteTraining] = useState<Training | null>(null);

  const [profileForm, setProfileForm] = useState({ phone: '', bankAccount: '', pensionNumber: '', address: '' });
  const [leaveForm, setLeaveForm] = useState({ leaveType: 'Annual', startDate: '', endDate: '', days: 1, reason: '' });
  const [expenseForm, setExpenseForm] = useState({ type: 'Travel', amount: '', date: '', description: '' });
  const [trainingForm, setTrainingForm] = useState({ course: '', startDate: '', endDate: '' });

  const fetchStats = useCallback(async () => {
    if (!currentPropertyId || !employeeId) return;
    try {
      const res = await fetch(`/api/hr-portal/ess/statistics/${currentPropertyId}/${employeeId}`, { headers: authHeaders() });
      if (res.ok) setStats(await res.json());
    } catch { /* non-fatal */ }
  }, [currentPropertyId, employeeId]);

  const fetchProfile = useCallback(async () => {
    if (!currentPropertyId || !employeeId) return;
    try {
      const res = await fetch(`/api/hr-portal/ess/profile/${currentPropertyId}/${employeeId}`, { headers: authHeaders() });
      if (res.ok) {
        const data = (await res.json()) as Profile;
        setProfile(data);
      }
    } catch { /* non-fatal */ }
  }, [currentPropertyId, employeeId]);

  const fetchPayslips = useCallback(async () => {
    if (!currentPropertyId || !employeeId) return;
    try {
      const res = await fetch(`/api/hr-portal/ess/payslips/${currentPropertyId}/${employeeId}`, { headers: authHeaders() });
      if (res.ok) setPayslips(((await res.json()) as { payslips: Payslip[] }).payslips || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId, employeeId]);

  const fetchLeave = useCallback(async () => {
    if (!currentPropertyId || !employeeId) return;
    try {
      const [bRes, rRes] = await Promise.all([
        fetch(`/api/hr-portal/ess/leave-balances/${currentPropertyId}/${employeeId}`, { headers: authHeaders() }),
        fetch(`/api/hr-portal/ess/leave-requests/${currentPropertyId}/${employeeId}`, { headers: authHeaders() }),
      ]);
      if (bRes.ok) setBalances(((await bRes.json()) as { balances: LeaveBalance[] }).balances.map(b => ({ ...b, remaining: Math.max(0, Number(b.total_days) - Number(b.used_days)) })));
      if (rRes.ok) setRequests(((await rRes.json()) as { requests: LeaveRequest[] }).requests || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId, employeeId]);

  const fetchAttendance = useCallback(async () => {
    if (!currentPropertyId || !employeeId) return;
    try {
      const res = await fetch(`/api/hr-portal/ess/attendance/${currentPropertyId}/${employeeId}`, { headers: authHeaders() });
      if (res.ok) setAttendance(((await res.json()) as { attendance: Attendance[] }).attendance || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId, employeeId]);

  const fetchExpenses = useCallback(async () => {
    if (!currentPropertyId || !employeeId) return;
    try {
      const res = await fetch(`/api/hr-portal/ess/expenses/${currentPropertyId}/${employeeId}`, { headers: authHeaders() });
      if (res.ok) setExpenses(((await res.json()) as { expenses: Expense[] }).expenses || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId, employeeId]);

  const fetchTraining = useCallback(async () => {
    if (!currentPropertyId || !employeeId) return;
    try {
      const res = await fetch(`/api/hr-portal/ess/training/${currentPropertyId}/${employeeId}`, { headers: authHeaders() });
      if (res.ok) setTraining(((await res.json()) as { training: Training[] }).training || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId, employeeId]);

  const fetchDocuments = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const qs = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
      const res = await fetch(`/api/hr-portal/ess/documents/${currentPropertyId}${qs}`, { headers: authHeaders() });
      if (res.ok) setDocuments(((await res.json()) as { documents: CompanyDoc[] }).documents || []);
    } catch { /* non-fatal */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId, search]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchStats(), fetchProfile(), fetchPayslips(), fetchLeave(), fetchAttendance(), fetchExpenses(), fetchTraining(), fetchDocuments()]);
    setLoading(false);
  }, [fetchStats, fetchProfile, fetchPayslips, fetchLeave, fetchAttendance, fetchExpenses, fetchTraining, fetchDocuments]);

  useEffect(() => {
    if (currentPropertyId && employeeId) refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId, employeeId]);

  useEffect(() => {
    if (activeTab === 'documents' && currentPropertyId) {
      const t = setTimeout(fetchDocuments, 250);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, activeTab, currentPropertyId]);

  // ── Profile edit ──────────────────────────────────────────────────────
  const openProfileEdit = () => {
    if (!profile) return;
    setProfileForm({
      phone: profile.phone || '',
      bankAccount: profile.bank_account || '',
      pensionNumber: profile.pension_number || '',
      address: profile.address || '',
    });
    setProfileEdit(true);
  };

  const saveProfile = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/ess/profile/${profile.id}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({
          phone: profileForm.phone.trim() || null,
          bank_account: profileForm.bankAccount.trim() || null,
          pension_number: profileForm.pensionNumber.trim() || null,
          address: profileForm.address.trim() || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Profile updated', 'success', 'HR');
      setProfileEdit(false);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update profile', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  // ── Leave request CRUD ────────────────────────────────────────────────
  const openLeaveCreate = () => {
    setLeaveForm({ leaveType: 'Annual', startDate: '', endDate: '', days: 1, reason: '' });
    setLeaveModal({ mode: 'create', r: null });
  };

  const openLeaveEdit = (r: LeaveRequest) => {
    setLeaveForm({ leaveType: r.leave_type, startDate: r.start_date, endDate: r.end_date, days: r.days, reason: r.reason || '' });
    setLeaveModal({ mode: 'edit', r });
  };

  const saveLeave = async () => {
    if (!currentPropertyId || !employeeId) return;
    setSaving(true);
    try {
      const body = {
        propertyId: currentPropertyId,
        employeeId,
        employeeName: profile?.name || employeeId,
        leaveType: leaveForm.leaveType,
        startDate: leaveForm.startDate,
        endDate: leaveForm.endDate,
        days: Number(leaveForm.days),
        reason: leaveForm.reason.trim(),
      };
      const res = await fetch('/api/hr-portal/ess/leave-requests', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Leave requested', 'success', 'HR');
      setLeaveModal(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to request leave', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const updateLeave = async () => {
    if (!leaveModal?.r) return;
    setSaving(true);
    try {
      const body = {
        leaveType: leaveForm.leaveType,
        startDate: leaveForm.startDate,
        endDate: leaveForm.endDate,
        days: Number(leaveForm.days),
        reason: leaveForm.reason.trim(),
      };
      const res = await fetch(`/api/hr-portal/ess/leave-requests/${leaveModal.r.id}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Leave request updated', 'success', 'HR');
      setLeaveModal(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update leave', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteLeave = async () => {
    if (!deleteLeave) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/ess/leave-requests/${deleteLeave.id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Leave request removed', 'success', 'HR');
      setDeleteLeave(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to remove leave request', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  // ── Expense CRUD ──────────────────────────────────────────────────────
  const openExpenseCreate = () => {
    setExpenseForm({ type: 'Travel', amount: '', date: '', description: '' });
    setExpenseModal({ mode: 'create', e: null });
  };

  const openExpenseEdit = (e: Expense) => {
    setExpenseForm({ type: e.category, amount: String(e.amount), date: e.submitted_date || '', description: e.description || '' });
    setExpenseModal({ mode: 'edit', e });
  };

  const saveExpense = async () => {
    if (!currentPropertyId || !employeeId || !expenseForm.amount) return;
    setSaving(true);
    try {
      const body = {
        propertyId: currentPropertyId,
        employeeId,
        employeeName: profile?.name || employeeId,
        type: expenseForm.type,
        amount: Number(expenseForm.amount),
        date: expenseForm.date || new Date().toISOString().slice(0, 10),
        description: expenseForm.description.trim(),
      };
      const res = await fetch('/api/hr-portal/ess/expenses', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Expense claim submitted', 'success', 'HR');
      setExpenseModal(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to submit expense', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const updateExpense = async () => {
    if (!expenseModal?.e) return;
    setSaving(true);
    try {
      const body = {
        type: expenseForm.type,
        amount: Number(expenseForm.amount),
        date: expenseForm.date || null,
        description: expenseForm.description.trim(),
      };
      const res = await fetch(`/api/hr-portal/ess/expenses/${expenseModal.e.id}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Expense claim updated', 'success', 'HR');
      setExpenseModal(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update expense', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteExpense = async () => {
    if (!deleteExpense) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/ess/expenses/${deleteExpense.id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Expense claim removed', 'success', 'HR');
      setDeleteExpense(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to remove expense', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  // ── Training CRUD ─────────────────────────────────────────────────────
  const openTrainingCreate = () => {
    setTrainingForm({ course: '', startDate: '', endDate: '' });
    setTrainingModal({ mode: 'create', t: null });
  };

  const openTrainingEdit = (t: Training) => {
    setTrainingForm({ course: t.course, startDate: t.start_date || '', endDate: t.end_date || '' });
    setTrainingModal({ mode: 'edit', t });
  };

  const saveTraining = async () => {
    if (!currentPropertyId || !employeeId || !trainingForm.course.trim()) return;
    setSaving(true);
    try {
      const body = {
        propertyId: currentPropertyId,
        employeeId,
        employeeName: profile?.name || employeeId,
        course: trainingForm.course.trim(),
        startDate: trainingForm.startDate || null,
        endDate: trainingForm.endDate || null,
      };
      const res = await fetch('/api/hr-portal/ess/training', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Training requested', 'success', 'HR');
      setTrainingModal(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to request training', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const updateTraining = async () => {
    if (!trainingModal?.t) return;
    setSaving(true);
    try {
      const body = {
        course: trainingForm.course.trim(),
        startDate: trainingForm.startDate || null,
        endDate: trainingForm.endDate || null,
      };
      const res = await fetch(`/api/hr-portal/ess/training/${trainingModal.t.id}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Training updated', 'success', 'HR');
      setTrainingModal(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update training', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteTraining = async () => {
    if (!deleteTraining) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/ess/training/${deleteTraining.id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Training request removed', 'success', 'HR');
      setDeleteTraining(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to remove training', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────
  const formatDateTime = (iso: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatCurrency = (n: number) => `$${(Number(n) || 0).toLocaleString()}`;

  const initials = (name: string) => name?.split(' ').filter(Boolean).map((p) => p[0]).join('').slice(0, 2).toUpperCase() || '—';

  const primaryAction = () => {
    if (activeTab === 'leave') return { label: 'Request Leave', onClick: openLeaveCreate };
    if (activeTab === 'expenses') return { label: 'New Claim', onClick: openExpenseCreate };
    if (activeTab === 'training') return { label: 'Request Training', onClick: openTrainingCreate };
    return null;
  };

  const action = primaryAction();

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Employee Self-Service" subtitle="Manage your profile, payslips, leave, and requests" icon={User} />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <User className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">Select a property to view ESS data.</p>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Employee Self-Service"
        subtitle="Manage your profile, payslips, leave, and requests"
        icon={User}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} className={button.ghost}>
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
            {action && (
              <button onClick={action.onClick} className={button.primary}>
                <Plus className="w-4 h-4" /> {action.label}
              </button>
            )}
          </div>
        }
      />

      {/* Employee info card */}
      {profile && (
        <SectionCard>
          <div className="flex items-center gap-6">
            <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-500/20 rounded-xl flex items-center justify-center text-xl font-bold text-indigo-600">
              {profile.avatar_initials || initials(profile.name)}
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">{profile.name}</h2>
              <p className="text-sm text-slate-500">{profile.position || '—'} • {profile.department || '—'}</p>
              <p className="text-xs text-slate-400 mt-1">Employee ID: {profile.employee_number || employeeId}</p>
            </div>
            <div className="text-right">
              <Badge tone={profile.status === 'Active' ? 'success' : 'neutral'}>{profile.status || 'Active'}</Badge>
            </div>
          </div>
        </SectionCard>
      )}

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Leave Remaining" value={stats.leaveRemaining} icon={Calendar} tone="success" />
        <StatCard title="Pending Leave" value={stats.pendingLeaveRequests} icon={Clock} tone="warning" />
        <StatCard title="Payslips Available" value={stats.payslipsAvailable} icon={DollarSign} tone="info" />
        <StatCard title="Pending Training" value={stats.pendingTraining} icon={GraduationCap} tone="accent" />
      </div>

      {/* Search (documents only) */}
      {activeTab === 'documents' && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input
              type="text"
              placeholder="Search documents..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
            />
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-white dark:bg-slate-700 text-indigo-600 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Profile Tab */}
      {activeTab === 'profile' && (
        <div className="grid lg:grid-cols-3 gap-6">
          <SectionCard className="lg:col-span-1">
            <div className="text-center mb-6">
              <div className="w-24 h-24 bg-slate-50 dark:bg-slate-800 rounded-xl mx-auto mb-4 flex items-center justify-center text-3xl font-semibold text-slate-400 ring-4 ring-slate-50/50 dark:ring-slate-800/30">
                {profile ? (profile.avatar_initials || initials(profile.name)) : '—'}
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">{profile?.name}</h3>
              <p className="text-sm text-slate-500">{profile?.position || '—'}</p>
              <div className="flex justify-center gap-2 mt-3">
                <Badge tone={profile?.status === 'Active' ? 'success' : 'neutral'}>{profile?.status || 'Active'}</Badge>
                {profile?.employment_type && <Badge tone="accent">{profile.employment_type}</Badge>}
              </div>
            </div>

            <div className="space-y-4">
              <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                <p className="text-xs font-medium text-slate-500 mb-1">Employee ID</p>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{profile?.employee_number || employeeId}</p>
              </div>
              <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                <p className="text-xs font-medium text-slate-500 mb-1">Department</p>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{profile?.department || '—'}</p>
              </div>
              <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                <p className="text-xs font-medium text-slate-500 mb-1">Hire Date</p>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{profile?.hire_date || '—'}</p>
              </div>
            </div>

            <button onClick={openProfileEdit} className={button.primary + ' w-full mt-6'}>
              <Pencil className="w-4 h-4" /> Update Profile
            </button>
          </SectionCard>

          <div className="lg:col-span-2 space-y-6">
            <SectionCard>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-6">Personal Information</h3>
              <div className="grid md:grid-cols-2 gap-4">
                <div><p className="text-xs font-medium text-slate-500 mb-1">Email</p><p className="text-sm font-semibold text-slate-900 dark:text-white">{profile?.email || '—'}</p></div>
                <div><p className="text-xs font-medium text-slate-500 mb-1">Phone</p><p className="text-sm font-semibold text-slate-900 dark:text-white">{profile?.phone || '—'}</p></div>
                <div><p className="text-xs font-medium text-slate-500 mb-1">Date of Birth</p><p className="text-sm font-semibold text-slate-900 dark:text-white">{profile?.date_of_birth || '—'}</p></div>
                <div><p className="text-xs font-medium text-slate-500 mb-1">Gender</p><p className="text-sm font-semibold text-slate-900 dark:text-white">{profile?.gender || '—'}</p></div>
                <div><p className="text-xs font-medium text-slate-500 mb-1">Nationality</p><p className="text-sm font-semibold text-slate-900 dark:text-white">{profile?.nationality || '—'}</p></div>
                <div className="md:col-span-2"><p className="text-xs font-medium text-slate-500 mb-1">Address</p><p className="text-sm font-semibold text-slate-900 dark:text-white">{profile?.address || '—'}</p></div>
              </div>
            </SectionCard>

            <SectionCard>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-6">Bank Details</h3>
              <div className="grid md:grid-cols-2 gap-4">
                <div><p className="text-xs font-medium text-slate-500 mb-1">Bank Account</p><p className="text-sm font-semibold text-slate-900 dark:text-white">{profile?.bank_account || '—'}</p></div>
                <div><p className="text-xs font-medium text-slate-500 mb-1">Pension Number</p><p className="text-sm font-semibold text-slate-900 dark:text-white">{profile?.pension_number || '—'}</p></div>
                <div><p className="text-xs font-medium text-slate-500 mb-1">Salary</p><p className="text-sm font-semibold text-slate-900 dark:text-white">{profile?.salary ? formatCurrency(profile.salary) : '—'}</p></div>
              </div>
            </SectionCard>
          </div>
        </div>
      )}

      {/* Payslips Tab */}
      {activeTab === 'payslips' && (
        <SectionCard pad="none">
          {loading ? <LoadingRow /> : payslips.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <DollarSign className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No payslips found.</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Period</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Pay Date</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-right">Gross Pay</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-right">Net Pay</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Status</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {payslips.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4 text-sm font-semibold text-slate-900 dark:text-white">{p.period}</td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-500">{p.pay_date || p.paid_at?.slice(0, 10) || '—'}</td>
                    <td className="px-6 py-4 text-right text-sm font-semibold text-slate-900 dark:text-white">{formatCurrency(p.gross_pay)}</td>
                    <td className="px-6 py-4 text-right text-xs font-bold text-emerald-600">{formatCurrency(p.net_pay)}</td>
                    <td className="px-6 py-4 text-center"><Badge tone="success">{p.status}</Badge></td>
                    <td className="px-6 py-4">
                      <div className="flex justify-center gap-2">
                        <button className="p-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg transition">
                          <Download size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      )}

      {/* Leave Tab */}
      {activeTab === 'leave' && (
        <div className="grid lg:grid-cols-3 gap-6">
          <SectionCard className="lg:col-span-1">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-6">Leave Balances</h3>
            {loading ? <LoadingRow /> : (
              <div className="space-y-4">
                {balances.length === 0 ? <p className="text-sm text-slate-400">No balances found.</p> : balances.map((b) => (
                  <div key={b.id} className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-medium text-slate-500">{b.leave_type}</span>
                      <span className="text-sm font-semibold text-slate-900 dark:text-white">{b.remaining} / {b.total_days}</span>
                    </div>
                    <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, (b.total_days ? (b.remaining / b.total_days) * 100 : 0))}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard className="lg:col-span-2" pad="none">
            {loading ? <LoadingRow /> : (
              <>
                <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex items-center justify-between">
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">Leave Requests</h3>
                  <button onClick={openLeaveCreate} className={button.primary + ' text-xs'}><Plus size={14} /> Request Leave</button>
                </div>
                {requests.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                    <Calendar className="w-8 h-8 mb-2 opacity-40" />
                    <p className="text-sm">No leave requests found.</p>
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                        <th className="px-6 py-4 text-xs font-medium text-slate-500">Type</th>
                        <th className="px-6 py-4 text-xs font-medium text-slate-500">Period</th>
                        <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Days</th>
                        <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Status</th>
                        <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                      {requests.map((r) => (
                        <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                          <td className="px-6 py-4 text-sm font-semibold text-slate-900 dark:text-white">{r.leave_type}</td>
                          <td className="px-6 py-4 text-sm font-medium text-slate-500">{r.start_date} - {r.end_date}</td>
                          <td className="px-6 py-4 text-center text-xs font-bold text-slate-900 dark:text-white">{r.days}</td>
                          <td className="px-6 py-4 text-center"><Badge tone={LEAVE_STATUS_TONE[r.status] ?? 'neutral'}>{r.status}</Badge></td>
                          <td className="px-6 py-4">
                            <div className="flex justify-center gap-2">
                              <button onClick={() => openLeaveEdit(r)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                              <button onClick={() => setDeleteLeave(r)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
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
        </div>
      )}

      {/* Attendance Tab */}
      {activeTab === 'attendance' && (
        <SectionCard pad="none">
          {loading ? <LoadingRow /> : attendance.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Clock className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No attendance records found.</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Date</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Check-In</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Check-Out</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Hours</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Shift</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {attendance.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4 text-sm font-semibold text-slate-900 dark:text-white">{a.attendance_date}</td>
                    <td className="px-6 py-4 text-center text-xs font-bold text-slate-900 dark:text-white">{formatDateTime(a.check_in)}</td>
                    <td className="px-6 py-4 text-center text-xs font-bold text-slate-900 dark:text-white">{formatDateTime(a.check_out)}</td>
                    <td className="px-6 py-4 text-center text-xs font-bold text-slate-900 dark:text-white">{a.hours_worked}h</td>
                    <td className="px-6 py-4 text-center text-xs text-slate-500">{a.shift}</td>
                    <td className="px-6 py-4 text-center"><Badge tone={ATTENDANCE_STATUS_TONE[a.status] ?? 'neutral'}>{a.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      )}

      {/* Expenses Tab */}
      {activeTab === 'expenses' && (
        <SectionCard pad="none">
          {loading ? <LoadingRow /> : (
            <>
              <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">Expense Claims</h3>
                <button onClick={openExpenseCreate} className={button.primary + ' text-xs'}><Plus size={14} /> New Claim</button>
              </div>
              {expenses.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <CreditCard className="w-8 h-8 mb-2 opacity-40" />
                  <p className="text-sm">No expense claims found.</p>
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                      <th className="px-6 py-4 text-xs font-medium text-slate-500">Type</th>
                      <th className="px-6 py-4 text-xs font-medium text-slate-500">Description</th>
                      <th className="px-6 py-4 text-xs font-medium text-slate-500">Date</th>
                      <th className="px-6 py-4 text-xs font-medium text-slate-500 text-right">Amount</th>
                      <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Status</th>
                      <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                    {expenses.map((e) => (
                      <tr key={e.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="px-6 py-4 text-sm font-semibold text-slate-900 dark:text-white">{e.category}</td>
                        <td className="px-6 py-4 text-sm font-medium text-slate-500">{e.description || '—'}</td>
                        <td className="px-6 py-4 text-sm font-medium text-slate-500">{e.submitted_date || '—'}</td>
                        <td className="px-6 py-4 text-right text-sm font-semibold text-slate-900 dark:text-white">{formatCurrency(e.amount)}</td>
                        <td className="px-6 py-4 text-center"><Badge tone={EXPENSE_STATUS_TONE[e.status] ?? 'neutral'}>{e.status}</Badge></td>
                        <td className="px-6 py-4">
                          <div className="flex justify-center gap-2">
                            <button onClick={() => openExpenseEdit(e)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                            <button onClick={() => setDeleteExpense(e)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
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

      {/* Training Tab */}
      {activeTab === 'training' && (
        <SectionCard pad="none">
          {loading ? <LoadingRow /> : (
            <>
              <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">Training Requests</h3>
                <button onClick={openTrainingCreate} className={button.primary + ' text-xs'}><Plus size={14} /> Request Training</button>
              </div>
              {training.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <GraduationCap className="w-8 h-8 mb-2 opacity-40" />
                  <p className="text-sm">No training requests found.</p>
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                      <th className="px-6 py-4 text-xs font-medium text-slate-500">Course</th>
                      <th className="px-6 py-4 text-xs font-medium text-slate-500">Start Date</th>
                      <th className="px-6 py-4 text-xs font-medium text-slate-500">End Date</th>
                      <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Status</th>
                      <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                    {training.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="px-6 py-4 text-sm font-semibold text-slate-900 dark:text-white">{t.course}</td>
                        <td className="px-6 py-4 text-sm font-medium text-slate-500">{t.start_date || '—'}</td>
                        <td className="px-6 py-4 text-sm font-medium text-slate-500">{t.end_date || '—'}</td>
                        <td className="px-6 py-4 text-center"><Badge tone={TRAINING_STATUS_TONE[t.status] ?? 'neutral'}>{t.status}</Badge></td>
                        <td className="px-6 py-4">
                          <div className="flex justify-center gap-2">
                            <button onClick={() => openTrainingEdit(t)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                            <button onClick={() => setDeleteTraining(t)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
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

      {/* Documents Tab */}
      {activeTab === 'documents' && (
        <SectionCard pad="none">
          {loading ? <LoadingRow /> : documents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <FolderOpen className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No documents found.</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Document Name</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Type</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Date</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Status</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {documents.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-indigo-50 dark:bg-indigo-500/20 rounded-lg flex items-center justify-center">
                          <FileText className="text-indigo-600 dark:text-indigo-400" size={14} />
                        </div>
                        <span className="text-sm font-semibold text-slate-900 dark:text-white">{d.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4"><Badge tone="neutral">{d.type}</Badge></td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-500">{d.document_date}</td>
                    <td className="px-6 py-4 text-center"><Badge tone={DOC_STATUS_TONE[d.status] ?? 'neutral'}>{d.status}</Badge></td>
                    <td className="px-6 py-4">
                      <div className="flex justify-center gap-2">
                        <button className="p-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg transition"><Download size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      )}

      {/* ── Profile edit modal ───────────────────────────────────────────── */}
      <ModalSystem
        isOpen={profileEdit}
        onClose={() => setProfileEdit(false)}
        onConfirm={saveProfile}
        title="Update Profile"
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Address"><input className={inputCls} value={profileForm.address} onChange={(e) => setProfileForm(f => ({ ...f, address: e.target.value }))} placeholder="e.g. 123 Main Street" /></Field>
          </div>
          <Field label="Phone"><input className={inputCls} value={profileForm.phone} onChange={(e) => setProfileForm(f => ({ ...f, phone: e.target.value }))} placeholder="+1 234 567 890" /></Field>
          <Field label="Bank Account"><input className={inputCls} value={profileForm.bankAccount} onChange={(e) => setProfileForm(f => ({ ...f, bankAccount: e.target.value }))} placeholder="****4567" /></Field>
          <Field label="Pension Number"><input className={inputCls} value={profileForm.pensionNumber} onChange={(e) => setProfileForm(f => ({ ...f, pensionNumber: e.target.value }))} placeholder="****9876" /></Field>
        </div>
      </ModalSystem>

      {/* ── Leave request modal ──────────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!leaveModal}
        onClose={() => setLeaveModal(null)}
        onConfirm={leaveModal?.mode === 'create' ? saveLeave : updateLeave}
        title={leaveModal?.mode === 'create' ? 'Request Leave' : 'Edit Leave Request'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Leave Type">
            <select className={inputCls} value={leaveForm.leaveType} onChange={(e) => setLeaveForm(f => ({ ...f, leaveType: e.target.value }))}>
              <option value="Annual">Annual</option>
              <option value="Sick">Sick</option>
              <option value="Emergency">Emergency</option>
              <option value="Compensatory">Compensatory</option>
              <option value="Maternity">Maternity</option>
              <option value="Paternity">Paternity</option>
              <option value="Unpaid">Unpaid</option>
            </select>
          </Field>
          <Field label="Days"><input type="number" min={1} className={inputCls} value={leaveForm.days} onChange={(e) => setLeaveForm(f => ({ ...f, days: Number(e.target.value) }))} /></Field>
          <Field label="Start Date"><input type="date" className={inputCls} value={leaveForm.startDate} onChange={(e) => setLeaveForm(f => ({ ...f, startDate: e.target.value }))} /></Field>
          <Field label="End Date"><input type="date" className={inputCls} value={leaveForm.endDate} onChange={(e) => setLeaveForm(f => ({ ...f, endDate: e.target.value }))} /></Field>
          <div className="col-span-2">
            <Field label="Reason"><textarea className={inputCls} rows={3} value={leaveForm.reason} onChange={(e) => setLeaveForm(f => ({ ...f, reason: e.target.value }))} placeholder="Reason for leave" /></Field>
          </div>
        </div>
      </ModalSystem>

      {/* ── Leave delete confirm ─────────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!deleteLeave}
        onClose={() => setDeleteLeave(null)}
        onConfirm={confirmDeleteLeave}
        title="Remove Leave Request"
        variant="confirm"
        confirmLabel={saving ? 'Removing…' : 'Remove'}
        confirmColor="rose"
        loading={saving}
      >
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Remove the <span className="font-bold">{deleteLeave?.leave_type}</span> leave request from <span className="font-bold">{deleteLeave?.start_date}</span> to <span className="font-bold">{deleteLeave?.end_date}</span>? This action cannot be undone.
        </p>
      </ModalSystem>

      {/* ── Expense modal ────────────────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!expenseModal}
        onClose={() => setExpenseModal(null)}
        onConfirm={expenseModal?.mode === 'create' ? saveExpense : updateExpense}
        title={expenseModal?.mode === 'create' ? 'New Expense Claim' : 'Edit Expense Claim'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Type">
            <select className={inputCls} value={expenseForm.type} onChange={(e) => setExpenseForm(f => ({ ...f, type: e.target.value }))}>
              <option value="Travel">Travel</option>
              <option value="Meals">Meals</option>
              <option value="Accommodation">Accommodation</option>
              <option value="Supplies">Supplies</option>
              <option value="Other">Other</option>
            </select>
          </Field>
          <Field label="Amount"><input type="number" min={0} className={inputCls} value={expenseForm.amount} onChange={(e) => setExpenseForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" /></Field>
          <div className="col-span-2">
            <Field label="Date"><input type="date" className={inputCls} value={expenseForm.date} onChange={(e) => setExpenseForm(f => ({ ...f, date: e.target.value }))} /></Field>
          </div>
          <div className="col-span-2">
            <Field label="Description"><textarea className={inputCls} rows={3} value={expenseForm.description} onChange={(e) => setExpenseForm(f => ({ ...f, description: e.target.value }))} placeholder="Description" /></Field>
          </div>
        </div>
      </ModalSystem>

      {/* ── Expense delete confirm ───────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!deleteExpense}
        onClose={() => setDeleteExpense(null)}
        onConfirm={confirmDeleteExpense}
        title="Remove Expense Claim"
        variant="confirm"
        confirmLabel={saving ? 'Removing…' : 'Remove'}
        confirmColor="rose"
        loading={saving}
      >
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Remove the <span className="font-bold">{deleteExpense?.category}</span> claim for <span className="font-bold">{formatCurrency(Number(deleteExpense?.amount) || 0)}</span>? This action cannot be undone.
        </p>
      </ModalSystem>

      {/* ── Training modal ───────────────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!trainingModal}
        onClose={() => setTrainingModal(null)}
        onConfirm={trainingModal?.mode === 'create' ? saveTraining : updateTraining}
        title={trainingModal?.mode === 'create' ? 'Request Training' : 'Edit Training Request'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Course"><input className={inputCls} value={trainingForm.course} onChange={(e) => setTrainingForm(f => ({ ...f, course: e.target.value }))} placeholder="e.g. Leadership Excellence" /></Field>
          </div>
          <Field label="Start Date"><input type="date" className={inputCls} value={trainingForm.startDate} onChange={(e) => setTrainingForm(f => ({ ...f, startDate: e.target.value }))} /></Field>
          <Field label="End Date"><input type="date" className={inputCls} value={trainingForm.endDate} onChange={(e) => setTrainingForm(f => ({ ...f, endDate: e.target.value }))} /></Field>
        </div>
      </ModalSystem>

      {/* ── Training delete confirm ──────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!deleteTraining}
        onClose={() => setDeleteTraining(null)}
        onConfirm={confirmDeleteTraining}
        title="Remove Training Request"
        variant="confirm"
        confirmLabel={saving ? 'Removing…' : 'Remove'}
        confirmColor="rose"
        loading={saving}
      >
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Remove the training request for <span className="font-bold">{deleteTraining?.course}</span>? This action cannot be undone.
        </p>
      </ModalSystem>
    </div>
  );
};

export default EmployeeSelfService;
