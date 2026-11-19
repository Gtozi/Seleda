/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Manager Self-Service (MSS) — HR > MSS module.
 *
 * DB-integrated via /api/hr-portal/mss/* routes. Replaces the hardcoded
 * placeholder manager data with live records from hr_manager_approvals,
 * hr_team_roster, hr_performance_reviews, hr_recruitment_requests, and
 * employees (team) tables.
 *
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Users,
  Calendar,
  Clock,
  DollarSign,
  GraduationCap,
  Briefcase,
  CheckCircle2,
  XCircle,
  Plus,
  Search,
  Pencil,
  Trash2,
  RefreshCw,
  Loader2,
  TrendingUp,
  UserCheck,
  MoreVertical,
  type LucideIcon,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';

type Tab = 'approvals' | 'team' | 'schedule' | 'performance' | 'recruitment';

interface Approval {
  id: string;
  employee_id: string;
  employee_name: string;
  type: 'Leave' | 'Overtime' | 'Expense' | 'Training';
  details: string;
  request_date: string;
  priority: 'Low' | 'Normal' | 'High' | 'Urgent';
  status: 'Pending' | 'Approved' | 'Rejected';
}

interface TeamMember {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  department: string | null;
  position: string | null;
  status: string | null;
  employee_number: string | null;
  avatar_initials: string | null;
}

interface Roster {
  id: string;
  employee_id: string;
  employee_name: string;
  department: string;
  roster_date: string;
  shift: 'Morning' | 'Evening' | 'Night' | 'Off';
  role: string;
}

interface Review {
  id: string;
  employee_id: string;
  employee_name: string;
  period: string;
  due_date: string;
  status: 'Pending' | 'In Progress' | 'Completed';
  goals: number;
  completed: number;
  reviewer: string | null;
}

interface Recruitment {
  id: string;
  position: string;
  department: string;
  request_type: 'New Position' | 'Replacement' | 'Expansion';
  priority: 'Low' | 'Normal' | 'High' | 'Urgent';
  status: 'Pending' | 'Approved' | 'Rejected' | 'Filled';
  vacancies: number;
  requested_by: string | null;
}

interface Stats {
  pendingApprovals: number;
  teamMembers: number;
  onLeaveToday: number;
  performanceReviews: number;
}

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'approvals', label: 'Approvals', icon: CheckCircle2 },
  { id: 'team', label: 'My Team', icon: Users },
  { id: 'schedule', label: 'Schedule', icon: Calendar },
  { id: 'performance', label: 'Performance', icon: TrendingUp },
  { id: 'recruitment', label: 'Recruitment', icon: Briefcase },
];

const PRIORITY_TONE: Record<string, StatusTone> = { Low: 'neutral', Normal: 'info', High: 'warning', Urgent: 'danger' };
const APPROVAL_TYPE_TONE: Record<string, StatusTone> = { Leave: 'info', Overtime: 'accent', Expense: 'warning', Training: 'success' };
const REVIEW_STATUS_TONE: Record<string, StatusTone> = { Pending: 'warning', 'In Progress': 'info', Completed: 'success' };
const RECRUIT_STATUS_TONE: Record<string, StatusTone> = { Pending: 'warning', Approved: 'success', Rejected: 'danger', Filled: 'info' };
const RECRUIT_TYPE_TONE: Record<string, StatusTone> = { 'New Position': 'accent', Replacement: 'warning', Expansion: 'success' };

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

const ManagerSelfService = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [activeTab, setActiveTab] = useState<Tab>('approvals');

  const [stats, setStats] = useState<Stats>({ pendingApprovals: 0, teamMembers: 0, onLeaveToday: 0, performanceReviews: 0 });
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [roster, setRoster] = useState<Roster[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [recruitment, setRecruitment] = useState<Recruitment[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  // Modals
  const [recruitModal, setRecruitModal] = useState<{ mode: 'create' | 'edit'; r: Recruitment | null } | null>(null);
  const [reviewModal, setReviewModal] = useState<{ mode: 'create' | 'edit'; r: Review | null } | null>(null);
  const [deleteRecruit, setDeleteRecruit] = useState<Recruitment | null>(null);
  const [deleteReview, setDeleteReview] = useState<Review | null>(null);

  const [recruitForm, setRecruitForm] = useState({ position: '', department: 'Front Office', requestType: 'New Position' as Recruitment['request_type'], priority: 'Normal' as Recruitment['priority'], vacancies: 1, requestedBy: '' });
  const [reviewForm, setReviewForm] = useState({ employeeId: '', employeeName: '', period: 'Q2 2024', dueDate: '', goals: 5, completed: 0, status: 'Pending' as Review['status'], reviewer: '' });

  const fetchStats = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/mss/statistics/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setStats(await res.json());
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchApprovals = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const qs = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
      const res = await fetch(`/api/hr-portal/mss/approvals/${currentPropertyId}${qs}`, { headers: authHeaders() });
      if (res.ok) setApprovals(((await res.json()) as { approvals: Approval[] }).approvals || []);
    } catch { /* non-fatal */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId, search]);

  const fetchTeam = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const qs = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
      const res = await fetch(`/api/hr-portal/mss/team/${currentPropertyId}${qs}`, { headers: authHeaders() });
      if (res.ok) setTeam(((await res.json()) as { team: TeamMember[] }).team || []);
    } catch { /* non-fatal */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId, search]);

  const fetchRoster = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/mss/schedule/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setRoster(((await res.json()) as { roster: Roster[] }).roster || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchReviews = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const qs = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
      const res = await fetch(`/api/hr-portal/mss/performance/${currentPropertyId}${qs}`, { headers: authHeaders() });
      if (res.ok) setReviews(((await res.json()) as { reviews: Review[] }).reviews || []);
    } catch { /* non-fatal */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId, search]);

  const fetchRecruitment = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const qs = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
      const res = await fetch(`/api/hr-portal/mss/recruitment/${currentPropertyId}${qs}`, { headers: authHeaders() });
      if (res.ok) setRecruitment(((await res.json()) as { recruitment: Recruitment[] }).recruitment || []);
    } catch { /* non-fatal */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId, search]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchStats(), fetchApprovals(), fetchTeam(), fetchRoster(), fetchReviews(), fetchRecruitment()]);
    setLoading(false);
  }, [fetchStats, fetchApprovals, fetchTeam, fetchRoster, fetchReviews, fetchRecruitment]);

  useEffect(() => {
    if (currentPropertyId) refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId]);

  useEffect(() => {
    if (!currentPropertyId) return;
    const t = setTimeout(() => {
      fetchApprovals();
      fetchTeam();
      fetchReviews();
      fetchRecruitment();
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, currentPropertyId]);

  // ── Actions ───────────────────────────────────────────────────────────
  const decideApproval = async (a: Approval, status: 'Approved' | 'Rejected') => {
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/mss/approvals/${a.id}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification(`Approval ${status.toLowerCase()}`, status === 'Approved' ? 'success' : 'danger', 'HR');
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update approval', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  // Recruitment CRUD
  const openRecruitCreate = () => {
    setRecruitForm({ position: '', department: 'Front Office', requestType: 'New Position', priority: 'Normal', vacancies: 1, requestedBy: '' });
    setRecruitModal({ mode: 'create', r: null });
  };
  const openRecruitEdit = (r: Recruitment) => {
    setRecruitForm({ position: r.position, department: r.department, requestType: r.request_type, priority: r.priority, vacancies: r.vacancies, requestedBy: r.requested_by || '' });
    setRecruitModal({ mode: 'edit', r });
  };
  const saveRecruit = async () => {
    if (!currentPropertyId || !recruitForm.position.trim() || !recruitForm.department.trim()) return;
    setSaving(true);
    try {
      const body = {
        propertyId: currentPropertyId,
        position: recruitForm.position.trim(),
        department: recruitForm.department,
        requestType: recruitForm.requestType,
        priority: recruitForm.priority,
        vacancies: Number(recruitForm.vacancies),
        requestedBy: recruitForm.requestedBy.trim() || null,
      };
      const res = await fetch('/api/hr-portal/mss/recruitment', { method: 'POST', headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Recruitment request created', 'success', 'HR');
      setRecruitModal(null); refreshAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };
  const updateRecruit = async () => {
    if (!recruitModal?.r) return;
    setSaving(true);
    try {
      const body = {
        position: recruitForm.position.trim(),
        department: recruitForm.department,
        requestType: recruitForm.requestType,
        priority: recruitForm.priority,
        vacancies: Number(recruitForm.vacancies),
      };
      const res = await fetch(`/api/hr-portal/mss/recruitment/${recruitModal.r.id}`, { method: 'PUT', headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Recruitment request updated', 'success', 'HR');
      setRecruitModal(null); refreshAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };
  const confirmDeleteRecruit = async () => {
    if (!deleteRecruit) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/mss/recruitment/${deleteRecruit.id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Recruitment request removed', 'success', 'HR');
      setDeleteRecruit(null); refreshAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  // Review CRUD
  const openReviewCreate = () => {
    setReviewForm({ employeeId: '', employeeName: '', period: 'Q2 2024', dueDate: '', goals: 5, completed: 0, status: 'Pending', reviewer: '' });
    setReviewModal({ mode: 'create', r: null });
  };
  const openReviewEdit = (r: Review) => {
    setReviewForm({ employeeId: r.employee_id, employeeName: r.employee_name, period: r.period, dueDate: r.due_date, goals: r.goals, completed: r.completed, status: r.status, reviewer: r.reviewer || '' });
    setReviewModal({ mode: 'edit', r });
  };
  const saveReview = async () => {
    if (!currentPropertyId || !reviewForm.employeeId.trim() || !reviewForm.period.trim() || !reviewForm.dueDate) return;
    setSaving(true);
    try {
      const body = {
        propertyId: currentPropertyId,
        employeeId: reviewForm.employeeId.trim(),
        employeeName: reviewForm.employeeName.trim() || reviewForm.employeeId.trim(),
        period: reviewForm.period.trim(),
        dueDate: reviewForm.dueDate,
        goals: Number(reviewForm.goals),
        reviewer: reviewForm.reviewer.trim() || null,
      };
      const res = await fetch('/api/hr-portal/mss/performance', { method: 'POST', headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Performance review created', 'success', 'HR');
      setReviewModal(null); refreshAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };
  const updateReview = async () => {
    if (!reviewModal?.r) return;
    setSaving(true);
    try {
      const body = {
        period: reviewForm.period.trim(),
        dueDate: reviewForm.dueDate,
        goals: Number(reviewForm.goals),
        completed: Number(reviewForm.completed),
        status: reviewForm.status,
        reviewer: reviewForm.reviewer.trim() || null,
      };
      const res = await fetch(`/api/hr-portal/mss/performance/${reviewModal.r.id}`, { method: 'PUT', headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Performance review updated', 'success', 'HR');
      setReviewModal(null); refreshAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };
  const confirmDeleteReview = async () => {
    if (!deleteReview) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/mss/performance/${deleteReview.id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Performance review removed', 'success', 'HR');
      setDeleteReview(null); refreshAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const initials = (name: string) => name?.split(' ').filter(Boolean).map((p) => p[0]).join('').slice(0, 2).toUpperCase() || '—';

  const scheduleByDay = useMemo(() => {
    const map: Record<string, Roster[]> = {};
    roster.forEach((r) => { if (!map[r.roster_date]) map[r.roster_date] = []; map[r.roster_date].push(r); });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [roster]);

  const dayName = (iso: string) => {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'long' });
  };

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Manager Self-Service" subtitle="Approve requests, manage team, and drive performance" icon={Users} />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Users className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">Select a property to view MSS data.</p>
          </div>
        </SectionCard>
      </div>
    );
  }

  const action = activeTab === 'recruitment' ? { label: 'New Request', onClick: openRecruitCreate } : activeTab === 'performance' ? { label: 'New Review', onClick: openReviewCreate } : null;

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Manager Self-Service"
        subtitle="Approve requests, manage team, and drive performance"
        icon={Users}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            {action && <button onClick={action.onClick} className={button.primary}><Plus className="w-4 h-4" /> {action.label}</button>}
          </div>
        }
      />

      {/* Stats */}
      <div className={layout.kpiGrid}>
        <StatCard title="Pending Approvals" value={stats.pendingApprovals} icon={Clock} tone="warning" />
        <StatCard title="Team Members" value={stats.teamMembers} icon={Users} tone="accent" />
        <StatCard title="On Leave Today" value={stats.onLeaveToday} icon={UserCheck} tone="success" />
        <StatCard title="Performance Reviews" value={stats.performanceReviews} icon={TrendingUp} tone="info" />
      </div>

      {/* Search for team/approvals/performance/recruitment */}
      {activeTab !== 'schedule' && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input
              type="text"
              placeholder="Search..."
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
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition whitespace-nowrap ${
              activeTab === tab.id ? 'bg-white dark:bg-slate-700 text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <tab.icon size={14} /> {tab.label}
          </button>
        ))}
      </div>

      {/* Approvals */}
      {activeTab === 'approvals' && (
        <SectionCard pad="none">
          {loading ? <LoadingRow /> : approvals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400"><Clock className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No pending approvals.</p></div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Type</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Employee</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Details</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Date</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Priority</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {approvals.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4"><Badge tone={APPROVAL_TYPE_TONE[a.type] ?? 'neutral'}>{a.type}</Badge></td>
                    <td className="px-6 py-4 text-sm font-semibold text-slate-900 dark:text-white">{a.employee_name}</td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-500 max-w-xs truncate">{a.details}</td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-500">{a.request_date}</td>
                    <td className="px-6 py-4 text-center"><Badge tone={PRIORITY_TONE[a.priority] ?? 'neutral'}>{a.priority}</Badge></td>
                    <td className="px-6 py-4">
                      <div className="flex justify-center gap-2">
                        <button onClick={() => decideApproval(a, 'Approved')} disabled={saving} className="p-1.5 bg-emerald-500 text-white rounded-lg hover:shadow-md transition"><CheckCircle2 size={14} /></button>
                        <button onClick={() => decideApproval(a, 'Rejected')} disabled={saving} className="p-1.5 bg-rose-500 text-white rounded-lg hover:shadow-md transition"><XCircle size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      )}

      {/* Team */}
      {activeTab === 'team' && (
        <SectionCard pad="none">
          {loading ? <LoadingRow /> : team.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400"><Users className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No team members found.</p></div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Employee</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Position</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Status</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Department</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {team.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-indigo-50 dark:bg-indigo-500/20 rounded-lg flex items-center justify-center text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                          {m.avatar_initials || initials(m.name)}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">{m.name}</p>
                          <p className="text-xs text-slate-400">{m.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-500">{m.position || '—'}</td>
                    <td className="px-6 py-4 text-center"><Badge tone={m.status === 'Active' ? 'success' : 'neutral'}>{m.status || 'Active'}</Badge></td>
                    <td className="px-6 py-4 text-center text-xs font-medium text-slate-500">{m.department || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      )}

      {/* Schedule */}
      {activeTab === 'schedule' && (
        <SectionCard>
          {loading ? <LoadingRow /> : scheduleByDay.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400"><Calendar className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No roster entries found.</p></div>
          ) : (
            <div className="grid lg:grid-cols-3 gap-6">
              {scheduleByDay.map(([date, shifts]) => (
                <div key={date} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm">
                  <div className="p-4 bg-indigo-600 text-white">
                    <h4 className="text-sm font-semibold">{dayName(date)}</h4>
                    <p className="text-xs opacity-80">{date}</p>
                  </div>
                  <div className="p-4 space-y-3">
                    {shifts.map((s) => (
                      <div key={s.id} className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
                        <div className="flex justify-between items-start mb-2">
                          <span className="text-sm font-semibold text-slate-900 dark:text-white">{s.employee_name}</span>
                          <span className={`text-xs font-medium uppercase ${s.shift === 'Off' ? 'text-amber-600' : 'text-emerald-600'}`}>{s.shift}</span>
                        </div>
                        <p className="text-xs font-medium text-slate-400">{s.role}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* Performance */}
      {activeTab === 'performance' && (
        <SectionCard pad="none">
          {loading ? <LoadingRow /> : (
            <>
              <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">Performance Reviews</h3>
                <button onClick={openReviewCreate} className={button.primary + ' text-xs'}><Plus size={14} /> New Review</button>
              </div>
              {reviews.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400"><TrendingUp className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No performance reviews found.</p></div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                      <th className="px-6 py-4 text-xs font-medium text-slate-500">Employee</th>
                      <th className="px-6 py-4 text-xs font-medium text-slate-500">Period</th>
                      <th className="px-6 py-4 text-xs font-medium text-slate-500">Due Date</th>
                      <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Goals</th>
                      <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Status</th>
                      <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                    {reviews.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="px-6 py-4 text-sm font-semibold text-slate-900 dark:text-white">{r.employee_name}</td>
                        <td className="px-6 py-4 text-sm font-medium text-slate-500">{r.period}</td>
                        <td className="px-6 py-4 text-sm font-medium text-slate-500">{r.due_date}</td>
                        <td className="px-6 py-4 text-center text-sm font-semibold text-slate-900 dark:text-white">{r.completed}/{r.goals}</td>
                        <td className="px-6 py-4 text-center"><Badge tone={REVIEW_STATUS_TONE[r.status] ?? 'neutral'}>{r.status}</Badge></td>
                        <td className="px-6 py-4">
                          <div className="flex justify-center gap-2">
                            <button onClick={() => openReviewEdit(r)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                            <button onClick={() => setDeleteReview(r)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
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

      {/* Recruitment */}
      {activeTab === 'recruitment' && (
        <SectionCard pad="none">
          {loading ? <LoadingRow /> : (
            <>
              <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">Recruitment Requests</h3>
                <button onClick={openRecruitCreate} className={button.primary + ' text-xs'}><Plus size={14} /> New Request</button>
              </div>
              {recruitment.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400"><Briefcase className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No recruitment requests found.</p></div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                      <th className="px-6 py-4 text-xs font-medium text-slate-500">Position</th>
                      <th className="px-6 py-4 text-xs font-medium text-slate-500">Department</th>
                      <th className="px-6 py-4 text-xs font-medium text-slate-500">Type</th>
                      <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Vacancies</th>
                      <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Priority</th>
                      <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Status</th>
                      <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                    {recruitment.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-indigo-50 dark:bg-indigo-500/20 rounded-lg flex items-center justify-center">
                              <Briefcase className="text-indigo-600 dark:text-indigo-400" size={14} />
                            </div>
                            <span className="text-sm font-semibold text-slate-900 dark:text-white">{r.position}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm font-medium text-slate-500">{r.department}</td>
                        <td className="px-6 py-4"><Badge tone={RECRUIT_TYPE_TONE[r.request_type] ?? 'neutral'}>{r.request_type}</Badge></td>
                        <td className="px-6 py-4 text-center text-sm font-semibold text-slate-900 dark:text-white">{r.vacancies}</td>
                        <td className="px-6 py-4 text-center"><Badge tone={PRIORITY_TONE[r.priority] ?? 'neutral'}>{r.priority}</Badge></td>
                        <td className="px-6 py-4 text-center"><Badge tone={RECRUIT_STATUS_TONE[r.status] ?? 'neutral'}>{r.status}</Badge></td>
                        <td className="px-6 py-4">
                          <div className="flex justify-center gap-2">
                            <button onClick={() => openRecruitEdit(r)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                            <button onClick={() => setDeleteRecruit(r)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
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

      {/* Recruitment modal */}
      <ModalSystem
        isOpen={!!recruitModal}
        onClose={() => setRecruitModal(null)}
        onConfirm={recruitModal?.mode === 'create' ? saveRecruit : updateRecruit}
        title={recruitModal?.mode === 'create' ? 'New Recruitment Request' : 'Edit Recruitment Request'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Position"><input className={inputCls} value={recruitForm.position} onChange={(e) => setRecruitForm(f => ({ ...f, position: e.target.value }))} placeholder="e.g. Receptionist" /></Field>
          </div>
          <Field label="Department"><input className={inputCls} value={recruitForm.department} onChange={(e) => setRecruitForm(f => ({ ...f, department: e.target.value }))} placeholder="e.g. Front Office" /></Field>
          <Field label="Vacancies"><input type="number" min={1} className={inputCls} value={recruitForm.vacancies} onChange={(e) => setRecruitForm(f => ({ ...f, vacancies: Number(e.target.value) }))} /></Field>
          <Field label="Type">
            <select className={inputCls} value={recruitForm.requestType} onChange={(e) => setRecruitForm(f => ({ ...f, requestType: e.target.value as Recruitment['request_type'] }))}>
              <option value="New Position">New Position</option>
              <option value="Replacement">Replacement</option>
              <option value="Expansion">Expansion</option>
            </select>
          </Field>
          <Field label="Priority">
            <select className={inputCls} value={recruitForm.priority} onChange={(e) => setRecruitForm(f => ({ ...f, priority: e.target.value as Recruitment['priority'] }))}>
              <option value="Low">Low</option>
              <option value="Normal">Normal</option>
              <option value="High">High</option>
              <option value="Urgent">Urgent</option>
            </select>
          </Field>
        </div>
      </ModalSystem>

      {/* Recruitment delete */}
      <ModalSystem
        isOpen={!!deleteRecruit}
        onClose={() => setDeleteRecruit(null)}
        onConfirm={confirmDeleteRecruit}
        title="Remove Recruitment Request"
        variant="confirm"
        confirmLabel={saving ? 'Removing…' : 'Remove'}
        confirmColor="rose"
        loading={saving}
      >
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Remove the recruitment request for <span className="font-bold">{deleteRecruit?.position}</span>? This action cannot be undone.
        </p>
      </ModalSystem>

      {/* Review modal */}
      <ModalSystem
        isOpen={!!reviewModal}
        onClose={() => setReviewModal(null)}
        onConfirm={reviewModal?.mode === 'create' ? saveReview : updateReview}
        title={reviewModal?.mode === 'create' ? 'New Performance Review' : 'Edit Performance Review'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          {reviewModal?.mode === 'create' && (
            <>
              <Field label="Employee ID"><input className={inputCls} value={reviewForm.employeeId} onChange={(e) => setReviewForm(f => ({ ...f, employeeId: e.target.value }))} placeholder="EMP-XXX" /></Field>
              <Field label="Employee Name"><input className={inputCls} value={reviewForm.employeeName} onChange={(e) => setReviewForm(f => ({ ...f, employeeName: e.target.value }))} placeholder="Full name" /></Field>
            </>
          )}
          <Field label="Period"><input className={inputCls} value={reviewForm.period} onChange={(e) => setReviewForm(f => ({ ...f, period: e.target.value }))} placeholder="Q2 2024" /></Field>
          <Field label="Due Date"><input type="date" className={inputCls} value={reviewForm.dueDate} onChange={(e) => setReviewForm(f => ({ ...f, dueDate: e.target.value }))} /></Field>
          <Field label="Goals"><input type="number" min={0} className={inputCls} value={reviewForm.goals} onChange={(e) => setReviewForm(f => ({ ...f, goals: Number(e.target.value) }))} /></Field>
          <Field label="Completed"><input type="number" min={0} className={inputCls} value={reviewForm.completed} onChange={(e) => setReviewForm(f => ({ ...f, completed: Number(e.target.value) }))} /></Field>
          <Field label="Status">
            <select className={inputCls} value={reviewForm.status} onChange={(e) => setReviewForm(f => ({ ...f, status: e.target.value as Review['status'] }))}>
              <option value="Pending">Pending</option>
              <option value="In Progress">In Progress</option>
              <option value="Completed">Completed</option>
            </select>
          </Field>
          <div className="col-span-2">
            <Field label="Reviewer"><input className={inputCls} value={reviewForm.reviewer} onChange={(e) => setReviewForm(f => ({ ...f, reviewer: e.target.value }))} placeholder="Reviewer name" /></Field>
          </div>
        </div>
      </ModalSystem>

      {/* Review delete */}
      <ModalSystem
        isOpen={!!deleteReview}
        onClose={() => setDeleteReview(null)}
        onConfirm={confirmDeleteReview}
        title="Remove Performance Review"
        variant="confirm"
        confirmLabel={saving ? 'Removing…' : 'Remove'}
        confirmColor="rose"
        loading={saving}
      >
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Remove the performance review for <span className="font-bold">{deleteReview?.employee_name}</span> ({deleteReview?.period})? This action cannot be undone.
        </p>
      </ModalSystem>
    </div>
  );
};

export default ManagerSelfService;
