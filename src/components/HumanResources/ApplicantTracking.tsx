/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Applicant Tracking (ATS) — HR > ATS module.
 *
 * DB-integrated via /api/hr-portal/ats/* routes. Replaces the hardcoded
 * placeholder pipeline, candidates, interviews, and offers data with live
 * records from the hr_candidates, hr_interviews, and hr_offers tables
 * (property-scoped).
 *
 * UI follows the F&B / Housekeeping portal pattern: StatCard KPIs,
 * PageHeader, SectionCard, Badge, ModalSystem, brandTheme.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Users,
  Calendar,
  FileText,
  CheckCircle2,
  Plus,
  Search,
  Mail,
  Phone,
  Star,
  ChevronRight,
  RefreshCw,
  Loader2,
  ServerCrash,
  Pencil,
  Trash2,
  Briefcase,
  type LucideIcon,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';

// ── Types ────────────────────────────────────────────────────────────────
type Tab = 'pipeline' | 'candidates' | 'interviews' | 'offers';

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
  stage: string;
  rating: number;
  status: string;
  applied_date: string;
}

interface Interview {
  id: string;
  property_id: string;
  candidate_id: string | null;
  candidate_name: string;
  position: string | null;
  type: 'HR Interview' | 'Technical Interview' | 'Practical Assessment' | 'Final Interview' | 'Phone Screen';
  scheduled_date: string;
  scheduled_time: string;
  interviewer: string | null;
  location: string | null;
  status: 'Scheduled' | 'Completed' | 'Cancelled' | 'No Show';
  notes: string | null;
}

interface Offer {
  id: string;
  property_id: string;
  candidate_id: string | null;
  candidate_name: string;
  position: string | null;
  department: string | null;
  salary: number;
  start_date: string | null;
  status: 'Pending' | 'Accepted' | 'Declined' | 'Withdrawn';
  sent_date: string;
  response_date: string | null;
}

interface Stats {
  totalCandidates: number;
  activeInterviews: number;
  offersSent: number;
  hiredThisMonth: number;
}

interface PipelineStage {
  stage: string;
  count: number;
  color: string;
}

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

const INTERVIEW_STATUS_TONE: Record<string, StatusTone> = {
  Scheduled: 'info',
  Completed: 'success',
  Cancelled: 'neutral',
  'No Show': 'danger',
};

const OFFER_STATUS_TONE: Record<string, StatusTone> = {
  Pending: 'warning',
  Accepted: 'success',
  Declined: 'danger',
  Withdrawn: 'neutral',
};

const CANDIDATE_STATUS_TONE: Record<string, StatusTone> = {
  Active: 'info',
  Hired: 'success',
  Rejected: 'danger',
  Withdrew: 'neutral',
};

const INTERVIEW_TYPES = ['HR Interview', 'Technical Interview', 'Practical Assessment', 'Final Interview', 'Phone Screen'] as const;
const INTERVIEW_STATUSES = ['Scheduled', 'Completed', 'Cancelled', 'No Show'] as const;
const OFFER_STATUSES = ['Pending', 'Accepted', 'Declined', 'Withdrawn'] as const;

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

// ── Component ────────────────────────────────────────────────────────────
const ApplicantTracking = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [activeTab, setActiveTab] = useState<Tab>('pipeline');

  const [pipeline, setPipeline] = useState<PipelineStage[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [stats, setStats] = useState<Stats>({ totalCandidates: 0, activeInterviews: 0, offersSent: 0, hiredThisMonth: 0 });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState('');

  // Modal state
  const [interviewModal, setInterviewModal] = useState<{ mode: 'create' | 'edit'; interview: Interview | null } | null>(null);
  const [deleteInterview, setDeleteInterview] = useState<Interview | null>(null);
  const [offerModal, setOfferModal] = useState<{ mode: 'create' | 'edit'; offer: Offer | null } | null>(null);
  const [deleteOffer, setDeleteOffer] = useState<Offer | null>(null);

  const emptyInterviewForm = {
    candidateName: '', position: '', type: 'HR Interview' as Interview['type'],
    scheduledDate: '', scheduledTime: '', interviewer: '', location: '', status: 'Scheduled' as Interview['status'], notes: '',
  };
  const [interviewForm, setInterviewForm] = useState({ ...emptyInterviewForm });

  const emptyOfferForm = {
    candidateName: '', position: '', department: '', salary: 0,
    startDate: '', status: 'Pending' as Offer['status'], sentDate: '', responseDate: '',
  };
  const [offerForm, setOfferForm] = useState({ ...emptyOfferForm });

  // ── Fetchers ──────────────────────────────────────────────────────────
  const fetchPipeline = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/ats/pipeline/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) {
        const data = (await res.json()) as { pipeline: PipelineStage[] };
        setPipeline(data.pipeline || []);
      }
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchCandidates = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const qs = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
      const res = await fetch(`/api/hr-portal/ats/candidates/${currentPropertyId}${qs}`, { headers: authHeaders() });
      if (res.ok) {
        const data = (await res.json()) as { candidates: Candidate[] };
        setCandidates(data.candidates || []);
      }
    } catch (e: any) {
      addNotification('Failed to load candidates', 'warning', 'HR');
    }
  }, [currentPropertyId, search, addNotification]);

  const fetchInterviews = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const qs = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
      const res = await fetch(`/api/hr-portal/ats/interviews/${currentPropertyId}${qs}`, { headers: authHeaders() });
      if (res.ok) {
        const data = (await res.json()) as { interviews: Interview[] };
        setInterviews(data.interviews || []);
      }
    } catch (e: any) {
      addNotification('Failed to load interviews', 'warning', 'HR');
    }
  }, [currentPropertyId, search, addNotification]);

  const fetchOffers = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const qs = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
      const res = await fetch(`/api/hr-portal/ats/offers/${currentPropertyId}${qs}`, { headers: authHeaders() });
      if (res.ok) {
        const data = (await res.json()) as { offers: Offer[] };
        setOffers(data.offers || []);
      }
    } catch (e: any) {
      addNotification('Failed to load offers', 'warning', 'HR');
    }
  }, [currentPropertyId, search, addNotification]);

  const fetchStats = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/ats/statistics/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setStats(await res.json());
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const refreshAll = useCallback(() => {
    setLoading(true);
    Promise.all([fetchPipeline(), fetchCandidates(), fetchInterviews(), fetchOffers(), fetchStats()])
      .finally(() => setLoading(false));
  }, [fetchPipeline, fetchCandidates, fetchInterviews, fetchOffers, fetchStats]);

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
    const t = setTimeout(() => {
      fetchCandidates();
      fetchInterviews();
      fetchOffers();
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, currentPropertyId]);

  // ── Interview CRUD ───────────────────────────────────────────────────
  const openCreateInterview = () => {
    setInterviewForm({ ...emptyInterviewForm, scheduledDate: new Date().toISOString().slice(0, 10) });
    setInterviewModal({ mode: 'create', interview: null });
  };

  const openEditInterview = (i: Interview) => {
    setInterviewForm({
      candidateName: i.candidate_name,
      position: i.position || '',
      type: i.type,
      scheduledDate: i.scheduled_date || '',
      scheduledTime: i.scheduled_time || '',
      interviewer: i.interviewer || '',
      location: i.location || '',
      status: i.status,
      notes: i.notes || '',
    });
    setInterviewModal({ mode: 'edit', interview: i });
  };

  const saveInterview = async () => {
    if (!currentPropertyId || !interviewForm.candidateName.trim() || !interviewForm.scheduledDate || !interviewForm.scheduledTime.trim()) return;
    setSaving(true);
    try {
      const body = {
        propertyId: currentPropertyId,
        candidateName: interviewForm.candidateName.trim(),
        position: interviewForm.position.trim() || null,
        type: interviewForm.type,
        scheduledDate: interviewForm.scheduledDate,
        scheduledTime: interviewForm.scheduledTime.trim(),
        interviewer: interviewForm.interviewer.trim() || null,
        location: interviewForm.location.trim() || null,
        status: interviewForm.status,
        notes: interviewForm.notes.trim() || null,
      };
      const res = await fetch('/api/hr-portal/ats/interviews', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Interview scheduled', 'success', 'HR');
      setInterviewModal(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to schedule interview', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const updateInterview = async () => {
    if (!interviewModal?.interview) return;
    setSaving(true);
    try {
      const body = {
        candidateName: interviewForm.candidateName.trim(),
        position: interviewForm.position.trim() || null,
        type: interviewForm.type,
        scheduledDate: interviewForm.scheduledDate,
        scheduledTime: interviewForm.scheduledTime.trim(),
        interviewer: interviewForm.interviewer.trim() || null,
        location: interviewForm.location.trim() || null,
        status: interviewForm.status,
        notes: interviewForm.notes.trim() || null,
      };
      const res = await fetch(`/api/hr-portal/ats/interviews/${interviewModal.interview.id}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Interview updated', 'success', 'HR');
      setInterviewModal(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update interview', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteInterview = async () => {
    if (!deleteInterview) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/ats/interviews/${deleteInterview.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Interview removed', 'success', 'HR');
      setDeleteInterview(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to remove interview', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  // ── Offer CRUD ───────────────────────────────────────────────────────
  const openCreateOffer = () => {
    setOfferForm({
      ...emptyOfferForm,
      sentDate: new Date().toISOString().slice(0, 10),
      startDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    });
    setOfferModal({ mode: 'create', offer: null });
  };

  const openEditOffer = (o: Offer) => {
    setOfferForm({
      candidateName: o.candidate_name,
      position: o.position || '',
      department: o.department || '',
      salary: Number(o.salary) || 0,
      startDate: o.start_date || '',
      status: o.status,
      sentDate: o.sent_date || '',
      responseDate: o.response_date || '',
    });
    setOfferModal({ mode: 'edit', offer: o });
  };

  const saveOffer = async () => {
    if (!currentPropertyId || !offerForm.candidateName.trim()) return;
    setSaving(true);
    try {
      const body = {
        propertyId: currentPropertyId,
        candidateName: offerForm.candidateName.trim(),
        position: offerForm.position.trim() || null,
        department: offerForm.department.trim() || null,
        salary: Number(offerForm.salary) || 0,
        startDate: offerForm.startDate || null,
        status: offerForm.status,
        sentDate: offerForm.sentDate || new Date().toISOString().slice(0, 10),
        responseDate: offerForm.responseDate || null,
      };
      const res = await fetch('/api/hr-portal/ats/offers', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Offer sent', 'success', 'HR');
      setOfferModal(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to send offer', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const updateOffer = async () => {
    if (!offerModal?.offer) return;
    setSaving(true);
    try {
      const body = {
        candidateName: offerForm.candidateName.trim(),
        position: offerForm.position.trim() || null,
        department: offerForm.department.trim() || null,
        salary: Number(offerForm.salary) || 0,
        startDate: offerForm.startDate || null,
        status: offerForm.status,
        sentDate: offerForm.sentDate,
        responseDate: offerForm.responseDate || null,
      };
      const res = await fetch(`/api/hr-portal/ats/offers/${offerModal.offer.id}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Offer updated', 'success', 'HR');
      setOfferModal(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update offer', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteOffer = async () => {
    if (!deleteOffer) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/ats/offers/${deleteOffer.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Offer removed', 'success', 'HR');
      setDeleteOffer(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to remove offer', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────
  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Applicant Tracking (ATS)" subtitle="Manage candidates, interviews, and offers" icon={Users} />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Users className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">Select a property to view its applicant pipeline.</p>
          </div>
        </SectionCard>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; icon: LucideIcon }[] = [
    { id: 'pipeline', label: 'Pipeline', icon: ChevronRight },
    { id: 'candidates', label: 'Candidates', icon: Users },
    { id: 'interviews', label: 'Interviews', icon: Calendar },
    { id: 'offers', label: 'Offers', icon: FileText },
  ];

  return (
    <div className={layout.sectionStack}>
      {/* Header */}
      <PageHeader
        title="Applicant Tracking (ATS)"
        subtitle="Manage candidates, interviews, and the hiring workflow"
        icon={Users}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} className={button.ghost} title="Refresh">
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
            {activeTab === 'interviews' && (
              <button onClick={openCreateInterview} className={button.primary}>
                <Plus className="w-4 h-4" /> Schedule Interview
              </button>
            )}
            {activeTab === 'offers' && (
              <button onClick={openCreateOffer} className={button.primary}>
                <Plus className="w-4 h-4" /> Send Offer
              </button>
            )}
          </div>
        }
      />

      {/* Stats */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Candidates" value={stats.totalCandidates} icon={Users} tone="accent" />
        <StatCard title="Active Interviews" value={stats.activeInterviews} icon={Calendar} tone="info" />
        <StatCard title="Offers Sent" value={stats.offersSent} icon={FileText} tone="success" />
        <StatCard title="Hired This Month" value={stats.hiredThisMonth} icon={CheckCircle2} tone="neutral" />
      </div>

      {/* Search */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input
            type="text"
            placeholder="Search candidates, interviews, offers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-white dark:bg-slate-700 text-indigo-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/30 dark:text-rose-300">
          <ServerCrash className="w-5 h-5 shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* Pipeline tab */}
      {activeTab === 'pipeline' && (
        <SectionCard>
          <div className="p-6 border-b border-slate-50 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Hiring Pipeline</h3>
          </div>
          <div className="p-6">
            {loading ? (
              <LoadingRow />
            ) : pipeline.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">No candidates in the pipeline yet.</p>
            ) : (
              <div className="flex items-center gap-4 overflow-x-auto pb-4">
                {pipeline.map((stage, index) => (
                  <div key={stage.stage} className="flex-shrink-0 w-48">
                    <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-4 border border-slate-100 dark:border-slate-700">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-slate-400 uppercase">{stage.stage}</span>
                        <div className={`w-2 h-2 rounded-full ${stage.color}`} />
                      </div>
                      <p className="text-2xl font-semibold text-slate-900 dark:text-white">{stage.count}</p>
                      <p className="text-xs font-medium text-slate-400">candidates</p>
                    </div>
                    {index < pipeline.length - 1 && (
                      <ChevronRight className="mx-2 text-slate-300" size={20} />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </SectionCard>
      )}

      {/* Candidates tab */}
      {activeTab === 'candidates' && (
        <SectionCard pad="none">
          {loading ? (
            <LoadingRow />
          ) : candidates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Users className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No candidates found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Candidate</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Position</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Stage</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Applied</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Rating</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {candidates.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4">
                        <div>
                          <span className="text-sm font-semibold text-slate-900 dark:text-white block">{c.name}</span>
                          {c.email && (
                            <div className="flex items-center gap-2 mt-1">
                              <Mail size={10} className="text-slate-400" />
                              <span className="text-xs font-medium text-slate-400">{c.email}</span>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div>
                          <span className="text-xs font-bold text-slate-900 dark:text-white block">{c.position || '—'}</span>
                          <span className="text-xs font-medium text-slate-400">{c.department || '—'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <Badge tone={STAGE_TONE[c.stage] ?? 'neutral'}>{c.stage}</Badge>
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500">{c.applied_date || '—'}</td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Star className="text-amber-400" size={12} fill="currentColor" />
                          <span className="text-sm font-semibold text-slate-900 dark:text-white">{Number(c.rating)}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <Badge tone={CANDIDATE_STATUS_TONE[c.status] ?? 'neutral'}>{c.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* Interviews tab */}
      {activeTab === 'interviews' && (
        <SectionCard>
          {loading ? (
            <LoadingRow />
          ) : interviews.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Calendar className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No interviews scheduled. Click "Schedule Interview" to create one.</p>
            </div>
          ) : (
            <div className="p-6 space-y-4">
              {interviews.map((i) => (
                <div key={i.id} className="bg-slate-50 dark:bg-slate-800 rounded-xl p-4 border border-slate-100 dark:border-slate-700 group">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-500/20 rounded-xl flex items-center justify-center">
                        <Calendar className="text-indigo-600 dark:text-indigo-400" size={20} />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{i.candidate_name}</h4>
                        <p className="text-xs font-medium text-slate-400">{i.position || '—'} • {i.type}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={INTERVIEW_STATUS_TONE[i.status] ?? 'neutral'}>{i.status}</Badge>
                      <button
                        onClick={() => openEditInterview(i)}
                        className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition"
                        title="Edit"
                      >
                        <Pencil size={14} className="text-slate-400" />
                      </button>
                      <button
                        onClick={() => setDeleteInterview(i)}
                        className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"
                        title="Remove"
                      >
                        <Trash2 size={14} className="text-rose-400" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="font-bold text-slate-400">Date</span>
                      <p className="font-semibold text-slate-900 dark:text-white">{i.scheduled_date || '—'}</p>
                    </div>
                    <div>
                      <span className="font-bold text-slate-400">Time</span>
                      <p className="font-semibold text-slate-900 dark:text-white">{i.scheduled_time || '—'}</p>
                    </div>
                    <div>
                      <span className="font-bold text-slate-400">Location</span>
                      <p className="font-semibold text-slate-900 dark:text-white">{i.location || '—'}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                    <Users size={12} className="text-slate-400" />
                    <span className="text-xs font-medium text-slate-400">Interviewer: {i.interviewer || '—'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* Offers tab */}
      {activeTab === 'offers' && (
        <SectionCard pad="none">
          {loading ? (
            <LoadingRow />
          ) : offers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <FileText className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No offers sent yet. Click "Send Offer" to create one.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Candidate</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Position</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Salary</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Start Date</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Sent Date</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Status</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {offers.map((o) => (
                    <tr key={o.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4">
                        <span className="text-sm font-semibold text-slate-900 dark:text-white">{o.candidate_name}</span>
                      </td>
                      <td className="px-6 py-4">
                        <div>
                          <span className="text-xs font-bold text-slate-900 dark:text-white block">{o.position || '—'}</span>
                          <span className="text-xs font-medium text-slate-400">{o.department || '—'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-xs font-bold text-slate-900 dark:text-white">${Number(o.salary).toLocaleString()}</td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500">{o.start_date || '—'}</td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500">{o.sent_date || '—'}</td>
                      <td className="px-6 py-4 text-center">
                        <Badge tone={OFFER_STATUS_TONE[o.status] ?? 'neutral'}>{o.status}</Badge>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex justify-center gap-2">
                          <button
                            onClick={() => openEditOffer(o)}
                            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
                            title="Edit"
                          >
                            <Pencil size={14} className="text-slate-400" />
                          </button>
                          <button
                            onClick={() => setDeleteOffer(o)}
                            className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"
                            title="Remove"
                          >
                            <Trash2 size={14} className="text-rose-400" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* ── Interview create/edit modal ──────────────────────────────────── */}
      <ModalSystem
        isOpen={!!interviewModal}
        onClose={() => setInterviewModal(null)}
        onConfirm={interviewModal?.mode === 'create' ? saveInterview : updateInterview}
        title={interviewModal?.mode === 'create' ? 'Schedule Interview' : 'Edit Interview'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Candidate Name">
              <input className={inputCls} value={interviewForm.candidateName} onChange={(e) => setInterviewForm((f) => ({ ...f, candidateName: e.target.value }))} placeholder="e.g. John Smith" />
            </Field>
          </div>
          <Field label="Position">
            <input className={inputCls} value={interviewForm.position} onChange={(e) => setInterviewForm((f) => ({ ...f, position: e.target.value }))} placeholder="e.g. Front Office Supervisor" />
          </Field>
          <Field label="Type">
            <select className={inputCls} value={interviewForm.type} onChange={(e) => setInterviewForm((f) => ({ ...f, type: e.target.value as Interview['type'] }))}>
              {INTERVIEW_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <input type="date" className={inputCls} value={interviewForm.scheduledDate} onChange={(e) => setInterviewForm((f) => ({ ...f, scheduledDate: e.target.value }))} />
          </Field>
          <Field label="Time">
            <input className={inputCls} value={interviewForm.scheduledTime} onChange={(e) => setInterviewForm((f) => ({ ...f, scheduledTime: e.target.value }))} placeholder="e.g. 10:00 - 11:00" />
          </Field>
          <Field label="Interviewer">
            <input className={inputCls} value={interviewForm.interviewer} onChange={(e) => setInterviewForm((f) => ({ ...f, interviewer: e.target.value }))} placeholder="e.g. Sarah Johnson" />
          </Field>
          <Field label="Location">
            <input className={inputCls} value={interviewForm.location} onChange={(e) => setInterviewForm((f) => ({ ...f, location: e.target.value }))} placeholder="e.g. Conference Room A" />
          </Field>
          <Field label="Status">
            <select className={inputCls} value={interviewForm.status} onChange={(e) => setInterviewForm((f) => ({ ...f, status: e.target.value as Interview['status'] }))}>
              {INTERVIEW_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
          <div className="col-span-2">
            <Field label="Notes">
              <textarea className={inputCls} rows={2} value={interviewForm.notes} onChange={(e) => setInterviewForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Optional notes..." />
            </Field>
          </div>
        </div>
      </ModalSystem>

      {/* ── Interview delete confirm ──────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!deleteInterview}
        onClose={() => setDeleteInterview(null)}
        onConfirm={confirmDeleteInterview}
        title="Remove Interview"
        variant="confirm"
        confirmLabel={saving ? 'Removing…' : 'Remove'}
        confirmColor="rose"
        loading={saving}
      >
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Remove the interview with <span className="font-bold">{deleteInterview?.candidate_name}</span>? This action cannot be undone.
        </p>
      </ModalSystem>

      {/* ── Offer create/edit modal ───────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!offerModal}
        onClose={() => setOfferModal(null)}
        onConfirm={offerModal?.mode === 'create' ? saveOffer : updateOffer}
        title={offerModal?.mode === 'create' ? 'Send Offer' : 'Edit Offer'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Candidate Name">
              <input className={inputCls} value={offerForm.candidateName} onChange={(e) => setOfferForm((f) => ({ ...f, candidateName: e.target.value }))} placeholder="e.g. Carlos Ray" />
            </Field>
          </div>
          <Field label="Position">
            <input className={inputCls} value={offerForm.position} onChange={(e) => setOfferForm((f) => ({ ...f, position: e.target.value }))} placeholder="e.g. Senior Sous Chef" />
          </Field>
          <Field label="Department">
            <input className={inputCls} value={offerForm.department} onChange={(e) => setOfferForm((f) => ({ ...f, department: e.target.value }))} placeholder="e.g. Food & Beverage" />
          </Field>
          <Field label="Salary (annual)">
            <input type="number" min={0} className={inputCls} value={offerForm.salary} onChange={(e) => setOfferForm((f) => ({ ...f, salary: Number(e.target.value) }))} />
          </Field>
          <Field label="Start Date">
            <input type="date" className={inputCls} value={offerForm.startDate} onChange={(e) => setOfferForm((f) => ({ ...f, startDate: e.target.value }))} />
          </Field>
          <Field label="Sent Date">
            <input type="date" className={inputCls} value={offerForm.sentDate} onChange={(e) => setOfferForm((f) => ({ ...f, sentDate: e.target.value }))} />
          </Field>
          <Field label="Response Date">
            <input type="date" className={inputCls} value={offerForm.responseDate} onChange={(e) => setOfferForm((f) => ({ ...f, responseDate: e.target.value }))} />
          </Field>
          <Field label="Status">
            <select className={inputCls} value={offerForm.status} onChange={(e) => setOfferForm((f) => ({ ...f, status: e.target.value as Offer['status'] }))}>
              {OFFER_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
        </div>
      </ModalSystem>

      {/* ── Offer delete confirm ─────────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!deleteOffer}
        onClose={() => setDeleteOffer(null)}
        onConfirm={confirmDeleteOffer}
        title="Remove Offer"
        variant="confirm"
        confirmLabel={saving ? 'Removing…' : 'Remove'}
        confirmColor="rose"
        loading={saving}
      >
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Remove the offer for <span className="font-bold">{deleteOffer?.candidate_name}</span>? This action cannot be undone.
        </p>
      </ModalSystem>
    </div>
  );
};

export default ApplicantTracking;
