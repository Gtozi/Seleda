/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Recruitment Flow — HR > Recruitment module.
 *
 * DB-integrated via /api/hr-portal/recruitment/* routes. Replaces the
 * hardcoded placeholder vacancy/candidate data with live records from the
 * hr_job_openings and hr_candidates tables (property-scoped).
 *
 * UI follows the F&B / Housekeeping portal pattern: StatCard KPIs,
 * PageHeader, SectionCard, Badge, ModalSystem, brandTheme.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Briefcase,
  UserPlus,
  Calendar,
  BarChart3,
  Search,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  Loader2,
  ServerCrash,
  ArrowUpRight,
  Users,
  Mail,
  Phone,
  Star,
  type LucideIcon,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';

// ── Types ────────────────────────────────────────────────────────────────
interface JobOpening {
  id: string;
  property_id: string;
  title: string;
  department: string | null;
  position_id: string | null;
  priority: 'Low' | 'Medium' | 'High' | 'Emergency';
  status: 'Open' | 'On Hold' | 'Closed' | 'Filled';
  description: string | null;
  posted_at: string;
  created_at: string;
  updated_at: string;
  applicants: number;
  interviews: number;
}

interface Candidate {
  id: string;
  property_id: string;
  job_opening_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  position: string | null;
  department: string | null;
  stage: 'Application Received' | 'Screening' | 'Interview' | 'Assessment' | 'Background Check' | 'Offer' | 'Hired' | 'Rejected';
  rating: number;
  status: 'Active' | 'Hired' | 'Rejected' | 'Withdrew';
  applied_date: string;
  created_at: string;
  updated_at: string;
}

interface Stats {
  activeOpenings: number;
  totalApplications: number;
  interviewsToday: number;
  avgHireCycleDays: number;
}

const PRIORITY_TONE: Record<string, StatusTone> = {
  Low: 'neutral',
  Medium: 'info',
  High: 'warning',
  Emergency: 'danger',
};

const OPENING_STATUS_TONE: Record<string, StatusTone> = {
  Open: 'success',
  'On Hold': 'warning',
  Closed: 'neutral',
  Filled: 'accent',
};

const STAGE_TONE: Record<string, StatusTone> = {
  'Application Received': 'neutral',
  Screening: 'info',
  Interview: 'accent',
  Assessment: 'info',
  'Background Check': 'warning',
  Offer: 'success',
  Hired: 'success',
  Rejected: 'danger',
};

const STAGE_LABEL: Record<string, string> = {
  'Application Received': 'Screening',
  Screening: 'Interviewing',
  Interview: 'Interviewing',
  Assessment: 'Interviewing',
  'Background Check': 'Hiring',
  Offer: 'Offer Sent',
  Hired: 'Hired',
  Rejected: 'Rejected',
};

const STAGES: Candidate['stage'][] = [
  'Application Received', 'Screening', 'Interview', 'Assessment', 'Background Check', 'Offer', 'Hired', 'Rejected',
];

const DEPARTMENTS_FALLBACK = ['Front Office', 'Housekeeping', 'Food & Beverage', 'Engineering'];

// ── Auth headers ─────────────────────────────────────────────────────────
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

function initials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return '1 week ago';
  return `${Math.floor(days / 7)} weeks ago`;
}

// ── Component ────────────────────────────────────────────────────────────
const RecruitmentFlow = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [openings, setOpenings] = useState<JobOpening[]>([]);
  const [shortlisted, setShortlisted] = useState<Candidate[]>([]);
  const [openingCandidates, setOpeningCandidates] = useState<Candidate[]>([]);
  const [stats, setStats] = useState<Stats>({ activeOpenings: 0, totalApplications: 0, interviewsToday: 0, avgHireCycleDays: 0 });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState('');
  const [filterPriority, setFilterPriority] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  // Modal state
  const [openingModal, setOpeningModal] = useState<{ mode: 'create' | 'edit'; opening: JobOpening | null } | null>(null);
  const [deleteOpening, setDeleteOpening] = useState<JobOpening | null>(null);
  const [applicantsOpening, setApplicantsOpening] = useState<JobOpening | null>(null);
  const [candidateModal, setCandidateModal] = useState<{ mode: 'create' | 'edit'; candidate: Candidate | null } | null>(null);
  const [stageTarget, setStageTarget] = useState<Candidate | null>(null);

  const emptyOpeningForm = {
    title: '', department: '', priority: 'Medium', status: 'Open', description: '',
  };
  const [openingForm, setOpeningForm] = useState({ ...emptyOpeningForm });

  const emptyCandidateForm = {
    name: '', email: '', phone: '', location: '', position: '', department: '',
    stage: 'Application Received', rating: 0, status: 'Active', appliedDate: '',
  };
  const [candidateForm, setCandidateForm] = useState({ ...emptyCandidateForm });

  // ── Fetchers ──────────────────────────────────────────────────────────
  const fetchOpenings = useCallback(async () => {
    if (!currentPropertyId) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (filterPriority !== 'all') params.set('priority', filterPriority);
      if (filterStatus !== 'all') params.set('status', filterStatus);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const res = await fetch(`/api/hr-portal/recruitment/openings/${currentPropertyId}${qs}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load openings (${res.status})`);
      const data = (await res.json()) as { openings: JobOpening[] };
      setOpenings(data.openings || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load openings');
      addNotification('Failed to load job openings', 'warning', 'HR');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, search, filterPriority, filterStatus, addNotification]);

  const fetchStats = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/recruitment/statistics/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setStats(await res.json());
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchShortlisted = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/recruitment/shortlisted/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) {
        const data = (await res.json()) as { candidates: Candidate[] };
        setShortlisted(data.candidates || []);
      }
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchApplicants = useCallback(async (openingId: string) => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/recruitment/candidates/${currentPropertyId}?jobOpeningId=${openingId}`, { headers: authHeaders() });
      if (res.ok) {
        const data = (await res.json()) as { candidates: Candidate[] };
        setOpeningCandidates(data.candidates || []);
      }
    } catch (e: any) {
      addNotification('Failed to load applicants', 'warning', 'HR');
    }
  }, [currentPropertyId, addNotification]);

  const refreshAll = useCallback(() => {
    fetchOpenings();
    fetchStats();
    fetchShortlisted();
  }, [fetchOpenings, fetchStats, fetchShortlisted]);

  useEffect(() => {
    if (currentPropertyId) {
      refreshAll();
    } else {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId]);

  useEffect(() => {
    if (!currentPropertyId) return;
    const t = setTimeout(() => fetchOpenings(), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filterPriority, filterStatus, currentPropertyId]);

  // ── Opening CRUD ──────────────────────────────────────────────────────
  const openCreateOpening = () => {
    setOpeningForm({ ...emptyOpeningForm });
    setOpeningModal({ mode: 'create', opening: null });
  };

  const openEditOpening = (o: JobOpening) => {
    setOpeningForm({
      title: o.title,
      department: o.department || '',
      priority: o.priority,
      status: o.status,
      description: o.description || '',
    });
    setOpeningModal({ mode: 'edit', opening: o });
  };

  const saveOpening = async () => {
    if (!currentPropertyId || !openingForm.title.trim()) return;
    setSaving(true);
    try {
      const body = {
        propertyId: currentPropertyId,
        title: openingForm.title.trim(),
        department: openingForm.department.trim() || null,
        priority: openingForm.priority,
        status: openingForm.status,
        description: openingForm.description.trim() || null,
      };
      const res = await fetch('/api/hr-portal/recruitment/openings', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Job opening created', 'success', 'HR');
      setOpeningModal(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create opening', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const updateOpening = async () => {
    if (!openingModal?.opening) return;
    setSaving(true);
    try {
      const body = {
        title: openingForm.title.trim(),
        department: openingForm.department.trim() || null,
        priority: openingForm.priority,
        status: openingForm.status,
        description: openingForm.description.trim() || null,
      };
      const res = await fetch(`/api/hr-portal/recruitment/openings/${openingModal.opening.id}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Job opening updated', 'success', 'HR');
      setOpeningModal(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update opening', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteOpening = async () => {
    if (!deleteOpening) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/recruitment/openings/${deleteOpening.id}?hard=true`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Job opening removed', 'success', 'HR');
      setDeleteOpening(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to remove opening', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  // ── Candidate CRUD ────────────────────────────────────────────────────
  const openCreateCandidate = (opening: JobOpening | null) => {
    setCandidateForm({
      ...emptyCandidateForm,
      position: opening?.title || '',
      department: opening?.department || '',
      appliedDate: new Date().toISOString().slice(0, 10),
    });
    setCandidateModal({ mode: 'create', candidate: null });
  };

  const openEditCandidate = (c: Candidate) => {
    setCandidateForm({
      name: c.name,
      email: c.email || '',
      phone: c.phone || '',
      location: c.location || '',
      position: c.position || '',
      department: c.department || '',
      stage: c.stage,
      rating: Number(c.rating) || 0,
      status: c.status,
      appliedDate: c.applied_date || '',
    });
    setCandidateModal({ mode: 'edit', candidate: c });
  };

  const saveCandidate = async () => {
    if (!currentPropertyId || !candidateForm.name.trim()) return;
    setSaving(true);
    try {
      const body = {
        propertyId: currentPropertyId,
        jobOpeningId: applicantsOpening?.id || null,
        name: candidateForm.name.trim(),
        email: candidateForm.email.trim() || null,
        phone: candidateForm.phone.trim() || null,
        location: candidateForm.location.trim() || null,
        position: candidateForm.position.trim() || null,
        department: candidateForm.department.trim() || null,
        stage: candidateForm.stage,
        rating: Number(candidateForm.rating) || 0,
        status: candidateForm.status,
        appliedDate: candidateForm.appliedDate || new Date().toISOString().slice(0, 10),
      };
      const res = await fetch('/api/hr-portal/recruitment/candidates', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Candidate added', 'success', 'HR');
      setCandidateModal(null);
      if (applicantsOpening) fetchApplicants(applicantsOpening.id);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to add candidate', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const updateCandidate = async () => {
    if (!candidateModal?.candidate) return;
    setSaving(true);
    try {
      const body = {
        name: candidateForm.name.trim(),
        email: candidateForm.email.trim() || null,
        phone: candidateForm.phone.trim() || null,
        location: candidateForm.location.trim() || null,
        position: candidateForm.position.trim() || null,
        department: candidateForm.department.trim() || null,
        stage: candidateForm.stage,
        rating: Number(candidateForm.rating) || 0,
        status: candidateForm.status,
      };
      const res = await fetch(`/api/hr-portal/recruitment/candidates/${candidateModal.candidate.id}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Candidate updated', 'success', 'HR');
      setCandidateModal(null);
      if (applicantsOpening) fetchApplicants(applicantsOpening.id);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update candidate', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const changeStage = async (candidate: Candidate, stage: Candidate['stage']) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/recruitment/candidates/${candidate.id}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({ stage, status: stage === 'Hired' ? 'Hired' : stage === 'Rejected' ? 'Rejected' : candidate.status }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification(`Stage → ${stage}`, 'success', 'HR');
      setStageTarget(null);
      if (applicantsOpening) fetchApplicants(applicantsOpening.id);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update stage', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────
  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Recruitment" subtitle="Manage job openings and candidates" icon={Briefcase} />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Briefcase className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">Select a property to view its recruitment pipeline.</p>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      {/* Header */}
      <PageHeader
        title="Recruitment"
        subtitle="Manage job openings, applicants, and the hiring pipeline"
        icon={Briefcase}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} className={button.ghost} title="Refresh">
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
            <button onClick={openCreateOpening} className={button.primary}>
              <Plus className="w-4 h-4" /> Add Opening
            </button>
          </div>
        }
      />

      {/* Stats */}
      <div className={layout.kpiGrid}>
        <StatCard title="Active Openings" value={stats.activeOpenings} icon={Briefcase} tone="accent" />
        <StatCard title="Total Applications" value={stats.totalApplications} icon={UserPlus} tone="success" />
        <StatCard title="Interviews" value={stats.interviewsToday} icon={Calendar} tone="info" />
        <StatCard title="Avg. Hire Cycle" value={`${stats.avgHireCycleDays} Days`} icon={BarChart3} tone="neutral" />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input
              type="text"
              placeholder="Search openings by title..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs w-64 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
            />
          </div>
          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="all">All Priorities</option>
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
            <option value="Emergency">Emergency</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="all">All Statuses</option>
            <option value="Open">Open</option>
            <option value="On Hold">On Hold</option>
            <option value="Filled">Filled</option>
            <option value="Closed">Closed</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/30 dark:text-rose-300">
          <ServerCrash className="w-5 h-5 shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      <div className="grid lg:grid-cols-12 gap-6">
        {/* Active openings */}
        <div className="lg:col-span-8 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-slate-500">Active Recruitment Pipeline</h3>
            <span className="text-xs font-medium text-slate-400">{openings.length} opening(s)</span>
          </div>

          {loading ? (
            <SectionCard><LoadingRow /></SectionCard>
          ) : openings.length === 0 ? (
            <SectionCard>
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <Briefcase className="w-8 h-8 mb-2 opacity-40" />
                <p className="text-sm">No job openings found. Click "Add Opening" to create one.</p>
              </div>
            </SectionCard>
          ) : (
            openings.map((o) => (
              <div
                key={o.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-6 rounded-xl flex items-center justify-between group hover:border-indigo-200 transition-all"
              >
                <div className="flex items-center gap-5">
                  <div className="w-12 h-12 bg-slate-50 dark:bg-slate-800 rounded-xl flex items-center justify-center text-slate-400">
                    <Briefcase size={20} />
                  </div>
                  <div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white">{o.title}</h4>
                      <Badge tone={PRIORITY_TONE[o.priority] ?? 'neutral'}>{o.priority}</Badge>
                      <Badge tone={OPENING_STATUS_TONE[o.status] ?? 'neutral'}>{o.status}</Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-xs font-medium text-slate-500">
                      <span>{o.department || '—'}</span>
                      <span className="text-slate-200 dark:text-slate-700">•</span>
                      <span>Posted {timeAgo(o.posted_at)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-6 text-right">
                  <div className="hidden sm:block">
                    <span className="text-xs font-medium text-slate-400 uppercase block mb-1">Applications</span>
                    <span className="text-sm font-medium text-slate-900 dark:text-white">{o.applicants}</span>
                  </div>
                  <div className="hidden sm:block">
                    <span className="text-xs font-medium text-slate-400 uppercase block mb-1">Interviews</span>
                    <span className="text-sm font-medium text-indigo-600">{o.interviews}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { setApplicantsOpening(o); fetchApplicants(o.id); }}
                      className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg text-slate-400 hover:bg-indigo-600 hover:text-white transition-all"
                      title="View applicants"
                    >
                      <Users size={16} />
                    </button>
                    <button
                      onClick={() => openEditOpening(o)}
                      className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white transition-all"
                      title="Edit"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={() => setDeleteOpening(o)}
                      className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg text-slate-400 hover:text-rose-500 transition-all"
                      title="Remove"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Recently shortlisted */}
        <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-8 rounded-xl shadow-sm">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-6">Recently Shortlisted</h3>
          <div className="space-y-6">
            {shortlisted.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6">No shortlisted candidates yet.</p>
            ) : (
              shortlisted.map((c) => (
                <div key={c.id} className="flex justify-between items-center group">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center justify-center text-xs font-medium">
                      {initials(c.name)}
                    </div>
                    <div>
                      <h5 className="text-sm font-semibold text-slate-900 dark:text-white">{c.name}</h5>
                      <p className="text-xs font-medium text-slate-400 uppercase">{c.position || '—'}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-medium text-indigo-600 block">{Number(c.rating)}/100</span>
                    <span className="text-xs font-medium text-slate-400 uppercase">{STAGE_LABEL[c.stage] || c.stage}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Opening create/edit modal ─────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!openingModal}
        onClose={() => setOpeningModal(null)}
        onConfirm={openingModal?.mode === 'create' ? saveOpening : updateOpening}
        title={openingModal?.mode === 'create' ? 'Add Job Opening' : 'Edit Job Opening'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Title">
              <input className={inputCls} value={openingForm.title} onChange={(e) => setOpeningForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Front Office Supervisor" />
            </Field>
          </div>
          <Field label="Department">
            <input className={inputCls} value={openingForm.department} onChange={(e) => setOpeningForm((f) => ({ ...f, department: e.target.value }))} placeholder="e.g. Front Office" />
          </Field>
          <Field label="Priority">
            <select className={inputCls} value={openingForm.priority} onChange={(e) => setOpeningForm((f) => ({ ...f, priority: e.target.value as any }))}>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
              <option value="Emergency">Emergency</option>
            </select>
          </Field>
          <Field label="Status">
            <select className={inputCls} value={openingForm.status} onChange={(e) => setOpeningForm((f) => ({ ...f, status: e.target.value as any }))}>
              <option value="Open">Open</option>
              <option value="On Hold">On Hold</option>
              <option value="Filled">Filled</option>
              <option value="Closed">Closed</option>
            </select>
          </Field>
          <div className="col-span-2">
            <Field label="Description">
              <textarea className={inputCls} rows={3} value={openingForm.description} onChange={(e) => setOpeningForm((f) => ({ ...f, description: e.target.value }))} placeholder="Role summary, responsibilities, requirements..." />
            </Field>
          </div>
        </div>
      </ModalSystem>

      {/* ── Opening delete confirm ────────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!deleteOpening}
        onClose={() => setDeleteOpening(null)}
        onConfirm={confirmDeleteOpening}
        title="Remove Job Opening"
        variant="confirm"
        confirmLabel={saving ? 'Removing…' : 'Remove'}
        confirmColor="rose"
        loading={saving}
      >
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Permanently remove <span className="font-bold">{deleteOpening?.title}</span>? All linked candidates will also be deleted. This action cannot be undone.
        </p>
      </ModalSystem>

      {/* ── Applicants modal ───────────────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!applicantsOpening}
        onClose={() => { setApplicantsOpening(null); setOpeningCandidates([]); }}
        title={`Applicants — ${applicantsOpening?.title || ''}`}
        subtitle={applicantsOpening?.department || ''}
        variant="info"
        size="xl"
        showFooter={false}
      >
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => openCreateCandidate(applicantsOpening)} className={button.primary}>
              <Plus className="w-4 h-4" /> Add Candidate
            </button>
          </div>
          {openingCandidates.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">No applicants yet for this opening.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                    <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase">Candidate</th>
                    <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase">Stage</th>
                    <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase text-center">Rating</th>
                    <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase text-center">Status</th>
                    <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {openingCandidates.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center justify-center text-xs font-semibold">
                            {initials(c.name)}
                          </div>
                          <div>
                            <span className="text-xs font-bold text-slate-900 dark:text-white block">{c.name}</span>
                            <span className="text-[10px] text-slate-400">{c.email || '—'}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={STAGE_TONE[c.stage] ?? 'neutral'}>{c.stage}</Badge>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Star className="text-amber-400" size={12} fill="currentColor" />
                          <span className="text-xs font-semibold text-slate-900 dark:text-white">{Number(c.rating)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge tone={c.status === 'Hired' ? 'success' : c.status === 'Rejected' ? 'danger' : 'info'}>{c.status}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-center gap-1">
                          <button
                            onClick={() => setStageTarget(c)}
                            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
                            title="Change stage"
                          >
                            <ArrowUpRight size={14} className="text-slate-400" />
                          </button>
                          <button
                            onClick={() => openEditCandidate(c)}
                            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
                            title="Edit"
                          >
                            <Pencil size={14} className="text-slate-400" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </ModalSystem>

      {/* ── Stage change modal ─────────────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!stageTarget}
        onClose={() => setStageTarget(null)}
        title={`Update Stage — ${stageTarget?.name || ''}`}
        variant="form"
        size="md"
        showFooter={false}
      >
        <div className="grid grid-cols-2 gap-2">
          {STAGES.map((s) => (
            <button
              key={s}
              disabled={saving || stageTarget?.stage === s}
              onClick={() => stageTarget && changeStage(stageTarget, s)}
              className={`px-3 py-2 rounded-xl text-xs font-medium border transition ${
                stageTarget?.stage === s
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-300'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </ModalSystem>

      {/* ── Candidate create/edit modal ────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!candidateModal}
        onClose={() => setCandidateModal(null)}
        onConfirm={candidateModal?.mode === 'create' ? saveCandidate : updateCandidate}
        title={candidateModal?.mode === 'create' ? 'Add Candidate' : 'Edit Candidate'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Full Name">
              <input className={inputCls} value={candidateForm.name} onChange={(e) => setCandidateForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. John Smith" />
            </Field>
          </div>
          <Field label="Email">
            <input className={inputCls} value={candidateForm.email} onChange={(e) => setCandidateForm((f) => ({ ...f, email: e.target.value }))} placeholder="name@email.com" />
          </Field>
          <Field label="Phone">
            <input className={inputCls} value={candidateForm.phone} onChange={(e) => setCandidateForm((f) => ({ ...f, phone: e.target.value }))} placeholder="+1 555 0100" />
          </Field>
          <Field label="Location">
            <input className={inputCls} value={candidateForm.location} onChange={(e) => setCandidateForm((f) => ({ ...f, location: e.target.value }))} placeholder="City, Country" />
          </Field>
          <Field label="Applied Date">
            <input type="date" className={inputCls} value={candidateForm.appliedDate} onChange={(e) => setCandidateForm((f) => ({ ...f, appliedDate: e.target.value }))} />
          </Field>
          <Field label="Position">
            <input className={inputCls} value={candidateForm.position} onChange={(e) => setCandidateForm((f) => ({ ...f, position: e.target.value }))} placeholder="e.g. Receptionist" />
          </Field>
          <Field label="Department">
            <input className={inputCls} value={candidateForm.department} onChange={(e) => setCandidateForm((f) => ({ ...f, department: e.target.value }))} placeholder="e.g. Front Office" />
          </Field>
          <Field label="Stage">
            <select className={inputCls} value={candidateForm.stage} onChange={(e) => setCandidateForm((f) => ({ ...f, stage: e.target.value as any }))}>
              {STAGES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select className={inputCls} value={candidateForm.status} onChange={(e) => setCandidateForm((f) => ({ ...f, status: e.target.value as any }))}>
              <option value="Active">Active</option>
              <option value="Hired">Hired</option>
              <option value="Rejected">Rejected</option>
              <option value="Withdrew">Withdrew</option>
            </select>
          </Field>
          <Field label="Rating (0–100)">
            <input type="number" min={0} max={100} className={inputCls} value={candidateForm.rating} onChange={(e) => setCandidateForm((f) => ({ ...f, rating: Number(e.target.value) }))} />
          </Field>
        </div>
      </ModalSystem>
    </div>
  );
};

export default RecruitmentFlow;
