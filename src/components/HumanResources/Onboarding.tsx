/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Onboarding — HR > Onboarding module.
 *
 * DB-integrated via /api/hr-portal/onboarding/* routes. Replaces the
 * hardcoded placeholder onboarding, documents, orientation, and probation
 * data with live records from the hr_onboarding_checklists,
 * hr_onboarding_documents, hr_orientation_sessions, and
 * hr_probation_tracking tables (property-scoped).
 *
 * UI follows the F&B / Housekeeping portal pattern: StatCard KPIs,
 * PageHeader, SectionCard, Badge, ModalSystem, brandTheme.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  UserPlus,
  FileText,
  CheckCircle2,
  Clock,
  Plus,
  Search,
  Pencil,
  Trash2,
  RefreshCw,
  Loader2,
  ServerCrash,
  GraduationCap,
  ClipboardCheck,
  Calendar,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';

// ── Types ────────────────────────────────────────────────────────────────
type Tab = 'checklist' | 'documents' | 'orientation' | 'tracking';

interface Checklist {
  id: string;
  property_id: string;
  employee_name: string;
  position: string | null;
  department: string | null;
  start_date: string;
  status: string;
  assigned_to: string | null;
  tasks: { item: string; completed: boolean }[];
  progress: number;
  created_at: string;
  updated_at: string;
}

interface Document {
  id: string;
  property_id: string;
  employee_name: string;
  document_name: string;
  status: 'Pending' | 'Received' | 'Verified' | 'Missing';
  received_date: string | null;
  verified_by: string | null;
  created_at: string;
  updated_at: string;
}

interface Session {
  id: string;
  property_id: string;
  title: string;
  session_date: string;
  session_time: string;
  location: string | null;
  facilitator: string | null;
  attendees: number;
  status: 'Scheduled' | 'Completed' | 'Cancelled';
  created_at: string;
  updated_at: string;
}

interface Probation {
  id: string;
  property_id: string;
  employee_name: string;
  position: string | null;
  start_date: string;
  end_date: string;
  review_date: string | null;
  status: 'Active' | 'Review Due' | 'Completed' | 'Extended';
  supervisor: string | null;
  progress: number;
  created_at: string;
  updated_at: string;
}

interface Stats {
  activeOnboarding: number;
  completedThisMonth: number;
  pendingDocuments: number;
  probationEnding: number;
}

const CHECKLIST_STATUS_TONE: Record<string, StatusTone> = {
  Pending: 'warning',
  'In Progress': 'info',
  Completed: 'success',
  'On Hold': 'neutral',
};

const DOCUMENT_STATUS_TONE: Record<string, StatusTone> = {
  Pending: 'warning',
  Received: 'info',
  Verified: 'success',
  Missing: 'danger',
};

const SESSION_STATUS_TONE: Record<string, StatusTone> = {
  Scheduled: 'info',
  Completed: 'success',
  Cancelled: 'danger',
};

const PROBATION_STATUS_TONE: Record<string, StatusTone> = {
  Active: 'info',
  'Review Due': 'warning',
  Completed: 'success',
  Extended: 'accent',
};

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'checklist', label: 'Checklist', icon: ClipboardCheck },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'orientation', label: 'Orientation', icon: GraduationCap },
  { id: 'tracking', label: 'Probation', icon: Clock },
];

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

// ── Component ────────────────────────────────────────────────────────────
const Onboarding = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [activeTab, setActiveTab] = useState<Tab>('checklist');
  const [search, setSearch] = useState('');

  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [probationList, setProbationList] = useState<Probation[]>([]);
  const [stats, setStats] = useState<Stats>({ activeOnboarding: 0, completedThisMonth: 0, pendingDocuments: 0, probationEnding: 0 });

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Modal state
  const [checklistModal, setChecklistModal] = useState<{ mode: 'create' | 'edit'; checklist: Checklist | null } | null>(null);
  const [deleteChecklist, setDeleteChecklist] = useState<Checklist | null>(null);
  const [documentModal, setDocumentModal] = useState<{ mode: 'create' | 'edit'; doc: Document | null } | null>(null);
  const [deleteDocument, setDeleteDocument] = useState<Document | null>(null);
  const [sessionModal, setSessionModal] = useState<{ mode: 'create' | 'edit'; session: Session | null } | null>(null);
  const [deleteSession, setDeleteSession] = useState<Session | null>(null);
  const [probationModal, setProbationModal] = useState<{ mode: 'create' | 'edit'; probation: Probation | null } | null>(null);
  const [deleteProbation, setDeleteProbation] = useState<Probation | null>(null);

  const emptyChecklistForm = {
    employeeName: '', position: '', department: '', startDate: '', assignedTo: '', status: 'Pending',
    tasks: [
      { item: 'Employment Contract', completed: false },
      { item: 'ID Card Issued', completed: false },
      { item: 'Uniform Assigned', completed: false },
      { item: 'System Access', completed: false },
      { item: 'Orientation Completed', completed: false },
      { item: 'Department Training', completed: false },
    ] as { item: string; completed: boolean }[],
  };
  const [checklistForm, setChecklistForm] = useState({ ...emptyChecklistForm });

  const emptyDocumentForm = { employeeName: '', documentName: '', status: 'Pending' as Document['status'], receivedDate: '', verifiedBy: '' };
  const [documentForm, setDocumentForm] = useState({ ...emptyDocumentForm });

  const emptySessionForm = { title: '', sessionDate: '', sessionTime: '', location: '', facilitator: '', attendees: 0, status: 'Scheduled' as Session['status'] };
  const [sessionForm, setSessionForm] = useState({ ...emptySessionForm });

  const emptyProbationForm = { employeeName: '', position: '', startDate: '', endDate: '', reviewDate: '', status: 'Active' as Probation['status'], supervisor: '' };
  const [probationForm, setProbationForm] = useState({ ...emptyProbationForm });

  // ── Fetchers ──────────────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/onboarding/statistics/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setStats(await res.json());
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchChecklists = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const qs = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
      const res = await fetch(`/api/hr-portal/onboarding/checklists/${currentPropertyId}${qs}`, { headers: authHeaders() });
      if (res.ok) {
        const data = (await res.json()) as { checklists: Checklist[] };
        setChecklists(data.checklists || []);
      }
    } catch { /* non-fatal */ }
  }, [currentPropertyId, search]);

  const fetchDocuments = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const qs = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
      const res = await fetch(`/api/hr-portal/onboarding/documents/${currentPropertyId}${qs}`, { headers: authHeaders() });
      if (res.ok) {
        const data = (await res.json()) as { documents: Document[] };
        setDocuments(data.documents || []);
      }
    } catch { /* non-fatal */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId, search]);

  const fetchSessions = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const qs = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
      const res = await fetch(`/api/hr-portal/onboarding/orientation/${currentPropertyId}${qs}`, { headers: authHeaders() });
      if (res.ok) {
        const data = (await res.json()) as { sessions: Session[] };
        setSessions(data.sessions || []);
      }
    } catch { /* non-fatal */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId, search]);

  const fetchProbation = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const qs = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
      const res = await fetch(`/api/hr-portal/onboarding/probation/${currentPropertyId}${qs}`, { headers: authHeaders() });
      if (res.ok) {
        const data = (await res.json()) as { probation: Probation[] };
        setProbationList(data.probation || []);
      }
    } catch { /* non-fatal */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId, search]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchStats(), fetchChecklists(), fetchDocuments(), fetchSessions(), fetchProbation()]);
    setLoading(false);
  }, [fetchStats, fetchChecklists, fetchDocuments, fetchSessions, fetchProbation]);

  useEffect(() => {
    if (currentPropertyId) refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId]);

  useEffect(() => {
    if (!currentPropertyId) return;
    const t = setTimeout(() => {
      fetchChecklists();
      fetchDocuments();
      fetchSessions();
      fetchProbation();
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, currentPropertyId]);

  // ── Checklist CRUD ───────────────────────────────────────────────────
  const openCreateChecklist = () => {
    setChecklistForm({ ...emptyChecklistForm, startDate: new Date().toISOString().slice(0, 10) });
    setChecklistModal({ mode: 'create', checklist: null });
  };

  const openEditChecklist = (c: Checklist) => {
    setChecklistForm({
      employeeName: c.employee_name,
      position: c.position || '',
      department: c.department || '',
      startDate: c.start_date || '',
      assignedTo: c.assigned_to || '',
      status: c.status,
      tasks: c.tasks || [],
    });
    setChecklistModal({ mode: 'edit', checklist: c });
  };

  const saveChecklist = async () => {
    if (!currentPropertyId || !checklistForm.employeeName.trim()) return;
    setSaving(true);
    try {
      const body = {
        propertyId: currentPropertyId,
        employeeName: checklistForm.employeeName.trim(),
        position: checklistForm.position.trim() || null,
        department: checklistForm.department.trim() || null,
        startDate: checklistForm.startDate || new Date().toISOString().slice(0, 10),
        assignedTo: checklistForm.assignedTo.trim() || null,
        tasks: checklistForm.tasks,
        status: checklistForm.status,
      };
      const res = await fetch('/api/hr-portal/onboarding/checklists', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Onboarding started', 'success', 'HR');
      setChecklistModal(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to start onboarding', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const updateChecklist = async () => {
    if (!checklistModal?.checklist) return;
    setSaving(true);
    try {
      const body = {
        employeeName: checklistForm.employeeName.trim(),
        position: checklistForm.position.trim() || null,
        department: checklistForm.department.trim() || null,
        startDate: checklistForm.startDate,
        assignedTo: checklistForm.assignedTo.trim() || null,
        tasks: checklistForm.tasks,
        status: checklistForm.status,
      };
      const res = await fetch(`/api/hr-portal/onboarding/checklists/${checklistModal.checklist.id}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Onboarding updated', 'success', 'HR');
      setChecklistModal(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update onboarding', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const toggleTask = async (c: Checklist, taskIndex: number, completed: boolean) => {
    try {
      const res = await fetch(`/api/hr-portal/onboarding/checklists/${c.id}/toggle-task`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({ taskIndex, completed }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Task updated', 'success', 'HR');
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update task', 'danger', 'HR');
    }
  };

  const confirmDeleteChecklist = async () => {
    if (!deleteChecklist) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/onboarding/checklists/${deleteChecklist.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Onboarding removed', 'success', 'HR');
      setDeleteChecklist(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to remove onboarding', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  // ── Document CRUD ────────────────────────────────────────────────────
  const openCreateDocument = () => {
    setDocumentForm({ ...emptyDocumentForm });
    setDocumentModal({ mode: 'create', doc: null });
  };

  const openEditDocument = (d: Document) => {
    setDocumentForm({
      employeeName: d.employee_name,
      documentName: d.document_name,
      status: d.status,
      receivedDate: d.received_date || '',
      verifiedBy: d.verified_by || '',
    });
    setDocumentModal({ mode: 'edit', doc: d });
  };

  const saveDocument = async () => {
    if (!currentPropertyId || !documentForm.employeeName.trim() || !documentForm.documentName.trim()) return;
    setSaving(true);
    try {
      const body = {
        propertyId: currentPropertyId,
        employeeName: documentForm.employeeName.trim(),
        documentName: documentForm.documentName.trim(),
        status: documentForm.status,
        receivedDate: documentForm.receivedDate || null,
        verifiedBy: documentForm.verifiedBy.trim() || null,
      };
      const res = await fetch('/api/hr-portal/onboarding/documents', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Document recorded', 'success', 'HR');
      setDocumentModal(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to record document', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const updateDocument = async () => {
    if (!documentModal?.doc) return;
    setSaving(true);
    try {
      const body = {
        employeeName: documentForm.employeeName.trim(),
        documentName: documentForm.documentName.trim(),
        status: documentForm.status,
        receivedDate: documentForm.receivedDate || null,
        verifiedBy: documentForm.verifiedBy.trim() || null,
      };
      const res = await fetch(`/api/hr-portal/onboarding/documents/${documentModal.doc.id}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Document updated', 'success', 'HR');
      setDocumentModal(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update document', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteDocument = async () => {
    if (!deleteDocument) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/onboarding/documents/${deleteDocument.id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Document removed', 'success', 'HR');
      setDeleteDocument(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to remove document', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  // ── Session CRUD ─────────────────────────────────────────────────────
  const openCreateSession = () => {
    setSessionForm({ ...emptySessionForm, sessionDate: new Date().toISOString().slice(0, 10) });
    setSessionModal({ mode: 'create', session: null });
  };

  const openEditSession = (s: Session) => {
    setSessionForm({
      title: s.title,
      sessionDate: s.session_date || '',
      sessionTime: s.session_time || '',
      location: s.location || '',
      facilitator: s.facilitator || '',
      attendees: s.attendees,
      status: s.status,
    });
    setSessionModal({ mode: 'edit', session: s });
  };

  const saveSession = async () => {
    if (!currentPropertyId || !sessionForm.title.trim() || !sessionForm.sessionDate || !sessionForm.sessionTime.trim()) return;
    setSaving(true);
    try {
      const body = {
        propertyId: currentPropertyId,
        title: sessionForm.title.trim(),
        sessionDate: sessionForm.sessionDate,
        sessionTime: sessionForm.sessionTime.trim(),
        location: sessionForm.location.trim() || null,
        facilitator: sessionForm.facilitator.trim() || null,
        attendees: Number(sessionForm.attendees) || 0,
        status: sessionForm.status,
      };
      const res = await fetch('/api/hr-portal/onboarding/orientation', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Orientation scheduled', 'success', 'HR');
      setSessionModal(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to schedule orientation', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const updateSession = async () => {
    if (!sessionModal?.session) return;
    setSaving(true);
    try {
      const body = {
        title: sessionForm.title.trim(),
        sessionDate: sessionForm.sessionDate,
        sessionTime: sessionForm.sessionTime.trim(),
        location: sessionForm.location.trim() || null,
        facilitator: sessionForm.facilitator.trim() || null,
        attendees: Number(sessionForm.attendees) || 0,
        status: sessionForm.status,
      };
      const res = await fetch(`/api/hr-portal/onboarding/orientation/${sessionModal.session.id}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Orientation updated', 'success', 'HR');
      setSessionModal(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update orientation', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteSession = async () => {
    if (!deleteSession) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/onboarding/orientation/${deleteSession.id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Orientation removed', 'success', 'HR');
      setDeleteSession(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to remove orientation', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  // ── Probation CRUD ───────────────────────────────────────────────────
  const openCreateProbation = () => {
    setProbationForm({ ...emptyProbationForm });
    setProbationModal({ mode: 'create', probation: null });
  };

  const openEditProbation = (p: Probation) => {
    setProbationForm({
      employeeName: p.employee_name,
      position: p.position || '',
      startDate: p.start_date || '',
      endDate: p.end_date || '',
      reviewDate: p.review_date || '',
      status: p.status,
      supervisor: p.supervisor || '',
    });
    setProbationModal({ mode: 'edit', probation: p });
  };

  const saveProbation = async () => {
    if (!currentPropertyId || !probationForm.employeeName.trim() || !probationForm.startDate || !probationForm.endDate) return;
    setSaving(true);
    try {
      const body = {
        propertyId: currentPropertyId,
        employeeName: probationForm.employeeName.trim(),
        position: probationForm.position.trim() || null,
        startDate: probationForm.startDate,
        endDate: probationForm.endDate,
        reviewDate: probationForm.reviewDate || null,
        status: probationForm.status,
        supervisor: probationForm.supervisor.trim() || null,
      };
      const res = await fetch('/api/hr-portal/onboarding/probation', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Probation record added', 'success', 'HR');
      setProbationModal(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to add probation record', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const updateProbation = async () => {
    if (!probationModal?.probation) return;
    setSaving(true);
    try {
      const body = {
        employeeName: probationForm.employeeName.trim(),
        position: probationForm.position.trim() || null,
        startDate: probationForm.startDate,
        endDate: probationForm.endDate,
        reviewDate: probationForm.reviewDate || null,
        status: probationForm.status,
        supervisor: probationForm.supervisor.trim() || null,
      };
      const res = await fetch(`/api/hr-portal/onboarding/probation/${probationModal.probation.id}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Probation updated', 'success', 'HR');
      setProbationModal(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update probation', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteProbation = async () => {
    if (!deleteProbation) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/onboarding/probation/${deleteProbation.id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Probation removed', 'success', 'HR');
      setDeleteProbation(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to remove probation', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────
  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Onboarding" subtitle="Manage new employee onboarding, documents, and probation" icon={UserPlus} />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <UserPlus className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">Select a property to view its onboarding data.</p>
          </div>
        </SectionCard>
      </div>
    );
  }

  const actionButton = () => {
    if (activeTab === 'checklist') return { label: 'Start Onboarding', onClick: openCreateChecklist };
    if (activeTab === 'documents') return { label: 'Upload Document', onClick: openCreateDocument };
    if (activeTab === 'orientation') return { label: 'Schedule Orientation', onClick: openCreateSession };
    return { label: 'Add Probation', onClick: openCreateProbation };
  };

  return (
    <div className={layout.sectionStack}>
      {/* Header */}
      <PageHeader
        title="Onboarding"
        subtitle="Manage new employee onboarding, documents, and probation"
        icon={UserPlus}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} className={button.ghost} title="Refresh">
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
            <button onClick={actionButton().onClick} className={button.primary}>
              <Plus className="w-4 h-4" /> {actionButton().label}
            </button>
          </div>
        }
      />

      {/* Stats */}
      <div className={layout.kpiGrid}>
        <StatCard title="Active Onboarding" value={stats.activeOnboarding} icon={UserPlus} tone="accent" />
        <StatCard title="Completed This Month" value={stats.completedThisMonth} icon={CheckCircle2} tone="success" />
        <StatCard title="Pending Documents" value={stats.pendingDocuments} icon={FileText} tone="warning" />
        <StatCard title="Probation Ending" value={stats.probationEnding} icon={Clock} tone="danger" />
      </div>

      {/* Search */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input
            type="text"
            placeholder="Search employee, document, session..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto">
        {TABS.map((tab) => (
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

      {/* Checklist tab */}
      {activeTab === 'checklist' && (
        <SectionCard>
          {loading ? (
            <LoadingRow />
          ) : checklists.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <ClipboardCheck className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No onboarding checklists found. Click "Start Onboarding" to create one.</p>
            </div>
          ) : (
            <div className="p-6 space-y-4">
              {checklists.map((c) => (
                <div key={c.id} className="bg-slate-50 dark:bg-slate-800 rounded-xl p-4 border border-slate-100 dark:border-slate-700">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-500/20 rounded-xl flex items-center justify-center">
                        <UserPlus className="text-indigo-600 dark:text-indigo-400" size={20} />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{c.employee_name}</h4>
                        <p className="text-xs font-medium text-slate-400">{c.position || '—'} • {c.department || '—'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-xs font-medium text-slate-400 uppercase">Progress</p>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">{c.progress}%</p>
                      </div>
                      <Badge tone={CHECKLIST_STATUS_TONE[c.status] ?? 'neutral'}>{c.status}</Badge>
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEditChecklist(c)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition" title="Edit">
                          <Pencil size={14} className="text-slate-400" />
                        </button>
                        <button onClick={() => setDeleteChecklist(c)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition" title="Remove">
                          <Trash2 size={14} className="text-rose-400" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="h-1.5 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden mb-3">
                    <div className="h-full bg-indigo-500" style={{ width: `${c.progress}%` }} />
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {c.tasks.map((t, idx) => (
                      <button
                        key={idx}
                        onClick={() => toggleTask(c, idx, !t.completed)}
                        className="flex items-center gap-2 text-xs text-left"
                      >
                        {t.completed ? (
                          <CheckCircle2 className="text-emerald-500" size={12} />
                        ) : (
                          <div className="w-3 h-3 rounded-full border-2 border-slate-300" />
                        )}
                        <span className={t.completed ? 'text-slate-500 line-through' : 'text-slate-900 dark:text-white font-bold'}>
                          {t.item}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* Documents tab */}
      {activeTab === 'documents' && (
        <SectionCard pad="none">
          {loading ? (
            <LoadingRow />
          ) : documents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <FileText className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No documents found. Click "Upload Document" to create one.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Employee</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Document</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Received Date</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Verified By</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Status</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {documents.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4 text-sm font-semibold text-slate-900 dark:text-white">{d.employee_name}</td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500">{d.document_name}</td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500">{d.received_date || '-'}</td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500">{d.verified_by || '-'}</td>
                      <td className="px-6 py-4 text-center">
                        <Badge tone={DOCUMENT_STATUS_TONE[d.status] ?? 'neutral'}>{d.status}</Badge>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex justify-center gap-2">
                          <button onClick={() => openEditDocument(d)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition" title="Edit">
                            <Pencil size={14} className="text-slate-400" />
                          </button>
                          <button onClick={() => setDeleteDocument(d)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition" title="Remove">
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

      {/* Orientation tab */}
      {activeTab === 'orientation' && (
        <SectionCard>
          {loading ? (
            <LoadingRow />
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <GraduationCap className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No orientation sessions found. Click "Schedule Orientation" to create one.</p>
            </div>
          ) : (
            <div className="p-6 space-y-4">
              {sessions.map((s) => (
                <div key={s.id} className="bg-slate-50 dark:bg-slate-800 rounded-xl p-4 border border-slate-100 dark:border-slate-700">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-500/20 rounded-xl flex items-center justify-center">
                        <GraduationCap className="text-indigo-600 dark:text-indigo-400" size={20} />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{s.title}</h4>
                        <p className="text-xs font-medium text-slate-400">Facilitator: {s.facilitator || '—'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={SESSION_STATUS_TONE[s.status] ?? 'neutral'}>{s.status}</Badge>
                      <button onClick={() => openEditSession(s)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition" title="Edit">
                        <Pencil size={14} className="text-slate-400" />
                      </button>
                      <button onClick={() => setDeleteSession(s)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition" title="Remove">
                        <Trash2 size={14} className="text-rose-400" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="font-bold text-slate-400">Date</span>
                      <p className="font-semibold text-slate-900 dark:text-white">{s.session_date || '—'}</p>
                    </div>
                    <div>
                      <span className="font-bold text-slate-400">Time</span>
                      <p className="font-semibold text-slate-900 dark:text-white">{s.session_time || '—'}</p>
                    </div>
                    <div>
                      <span className="font-bold text-slate-400">Location</span>
                      <p className="font-semibold text-slate-900 dark:text-white">{s.location || '—'}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                    <Users size={12} className="text-slate-400" />
                    <span className="text-xs font-medium text-slate-400">{s.attendees} attendees</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* Probation tab */}
      {activeTab === 'tracking' && (
        <SectionCard pad="none">
          {loading ? (
            <LoadingRow />
          ) : probationList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Clock className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No probation records found. Click "Add Probation" to create one.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Employee</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Position</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Start Date</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">End Date</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Review Date</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Progress</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Status</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {probationList.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4 text-sm font-semibold text-slate-900 dark:text-white">{p.employee_name}</td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500">{p.position || '—'}</td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500">{p.start_date || '—'}</td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500">{p.end_date || '—'}</td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500">{p.review_date || '—'}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-500" style={{ width: `${p.progress}%` }} />
                          </div>
                          <span className="text-sm font-semibold text-slate-900 dark:text-white">{p.progress}%</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <Badge tone={PROBATION_STATUS_TONE[p.status] ?? 'neutral'}>{p.status}</Badge>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex justify-center gap-2">
                          <button onClick={() => openEditProbation(p)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition" title="Edit">
                            <Pencil size={14} className="text-slate-400" />
                          </button>
                          <button onClick={() => setDeleteProbation(p)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition" title="Remove">
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

      {/* ── Checklist modal ───────────────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!checklistModal}
        onClose={() => setChecklistModal(null)}
        onConfirm={checklistModal?.mode === 'create' ? saveChecklist : updateChecklist}
        title={checklistModal?.mode === 'create' ? 'Start Onboarding' : 'Edit Onboarding'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Employee Name">
              <input className={inputCls} value={checklistForm.employeeName} onChange={(e) => setChecklistForm((f) => ({ ...f, employeeName: e.target.value }))} placeholder="e.g. John Doe" />
            </Field>
          </div>
          <Field label="Position">
            <input className={inputCls} value={checklistForm.position} onChange={(e) => setChecklistForm((f) => ({ ...f, position: e.target.value }))} placeholder="e.g. Receptionist" />
          </Field>
          <Field label="Department">
            <input className={inputCls} value={checklistForm.department} onChange={(e) => setChecklistForm((f) => ({ ...f, department: e.target.value }))} placeholder="e.g. Front Office" />
          </Field>
          <Field label="Start Date">
            <input type="date" className={inputCls} value={checklistForm.startDate} onChange={(e) => setChecklistForm((f) => ({ ...f, startDate: e.target.value }))} />
          </Field>
          <Field label="Assigned To">
            <input className={inputCls} value={checklistForm.assignedTo} onChange={(e) => setChecklistForm((f) => ({ ...f, assignedTo: e.target.value }))} placeholder="e.g. Sarah Johnson" />
          </Field>
          <Field label="Status">
            <select className={inputCls} value={checklistForm.status} onChange={(e) => setChecklistForm((f) => ({ ...f, status: e.target.value as Checklist['status'] }))}>
              <option value="Pending">Pending</option>
              <option value="In Progress">In Progress</option>
              <option value="Completed">Completed</option>
              <option value="On Hold">On Hold</option>
            </select>
          </Field>
          <div className="col-span-2">
            <Field label="Checklist Items">
              <div className="space-y-2">
                {checklistForm.tasks.map((t, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={t.completed}
                      onChange={(e) => {
                        const tasks = [...checklistForm.tasks];
                        tasks[idx] = { ...tasks[idx], completed: e.target.checked };
                        setChecklistForm((f) => ({ ...f, tasks }));
                      }}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <input
                      className="flex-1 inputCls"
                      value={t.item}
                      onChange={(e) => {
                        const tasks = [...checklistForm.tasks];
                        tasks[idx] = { ...tasks[idx], item: e.target.value };
                        setChecklistForm((f) => ({ ...f, tasks }));
                      }}
                      placeholder="Checklist item"
                      style={{ padding: '0.35rem 0.75rem', borderRadius: '0.75rem', border: '1px solid #e2e8f0', fontSize: '0.875rem' }}
                    />
                    <button
                      onClick={() => {
                        const tasks = checklistForm.tasks.filter((_, i) => i !== idx);
                        setChecklistForm((f) => ({ ...f, tasks }));
                      }}
                      className="text-rose-400 hover:text-rose-600 text-xs"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setChecklistForm((f) => ({ ...f, tasks: [...f.tasks, { item: '', completed: false }] }))}
                  className="text-xs text-indigo-600 font-medium"
                >
                  + Add Item
                </button>
              </div>
            </Field>
          </div>
        </div>
      </ModalSystem>

      {/* ── Checklist delete confirm ──────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!deleteChecklist}
        onClose={() => setDeleteChecklist(null)}
        onConfirm={confirmDeleteChecklist}
        title="Remove Onboarding Checklist"
        variant="confirm"
        confirmLabel={saving ? 'Removing…' : 'Remove'}
        confirmColor="rose"
        loading={saving}
      >
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Remove the onboarding checklist for <span className="font-bold">{deleteChecklist?.employee_name}</span>? This action cannot be undone.
        </p>
      </ModalSystem>

      {/* ── Document modal ────────────────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!documentModal}
        onClose={() => setDocumentModal(null)}
        onConfirm={documentModal?.mode === 'create' ? saveDocument : updateDocument}
        title={documentModal?.mode === 'create' ? 'Upload Document' : 'Edit Document'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Employee Name">
            <input className={inputCls} value={documentForm.employeeName} onChange={(e) => setDocumentForm((f) => ({ ...f, employeeName: e.target.value }))} placeholder="e.g. John Doe" />
          </Field>
          <Field label="Document Name">
            <input className={inputCls} value={documentForm.documentName} onChange={(e) => setDocumentForm((f) => ({ ...f, documentName: e.target.value }))} placeholder="e.g. Employment Contract" />
          </Field>
          <Field label="Status">
            <select className={inputCls} value={documentForm.status} onChange={(e) => setDocumentForm((f) => ({ ...f, status: e.target.value as Document['status'] }))}>
              <option value="Pending">Pending</option>
              <option value="Received">Received</option>
              <option value="Verified">Verified</option>
              <option value="Missing">Missing</option>
            </select>
          </Field>
          <Field label="Received Date">
            <input type="date" className={inputCls} value={documentForm.receivedDate} onChange={(e) => setDocumentForm((f) => ({ ...f, receivedDate: e.target.value }))} />
          </Field>
          <Field label="Verified By">
            <input className={inputCls} value={documentForm.verifiedBy} onChange={(e) => setDocumentForm((f) => ({ ...f, verifiedBy: e.target.value }))} placeholder="e.g. HR Manager" />
          </Field>
        </div>
      </ModalSystem>

      {/* ── Document delete confirm ───────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!deleteDocument}
        onClose={() => setDeleteDocument(null)}
        onConfirm={confirmDeleteDocument}
        title="Remove Document"
        variant="confirm"
        confirmLabel={saving ? 'Removing…' : 'Remove'}
        confirmColor="rose"
        loading={saving}
      >
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Remove <span className="font-bold">{deleteDocument?.document_name}</span> for <span className="font-bold">{deleteDocument?.employee_name}</span>? This action cannot be undone.
        </p>
      </ModalSystem>

      {/* ── Orientation modal ─────────────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!sessionModal}
        onClose={() => setSessionModal(null)}
        onConfirm={sessionModal?.mode === 'create' ? saveSession : updateSession}
        title={sessionModal?.mode === 'create' ? 'Schedule Orientation' : 'Edit Orientation'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Title">
              <input className={inputCls} value={sessionForm.title} onChange={(e) => setSessionForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Company Orientation" />
            </Field>
          </div>
          <Field label="Date">
            <input type="date" className={inputCls} value={sessionForm.sessionDate} onChange={(e) => setSessionForm((f) => ({ ...f, sessionDate: e.target.value }))} />
          </Field>
          <Field label="Time">
            <input className={inputCls} value={sessionForm.sessionTime} onChange={(e) => setSessionForm((f) => ({ ...f, sessionTime: e.target.value }))} placeholder="e.g. 09:00 - 12:00" />
          </Field>
          <Field label="Location">
            <input className={inputCls} value={sessionForm.location} onChange={(e) => setSessionForm((f) => ({ ...f, location: e.target.value }))} placeholder="e.g. Conference Room A" />
          </Field>
          <Field label="Facilitator">
            <input className={inputCls} value={sessionForm.facilitator} onChange={(e) => setSessionForm((f) => ({ ...f, facilitator: e.target.value }))} placeholder="e.g. HR Manager" />
          </Field>
          <Field label="Attendees">
            <input type="number" min={0} className={inputCls} value={sessionForm.attendees} onChange={(e) => setSessionForm((f) => ({ ...f, attendees: Number(e.target.value) }))} />
          </Field>
          <Field label="Status">
            <select className={inputCls} value={sessionForm.status} onChange={(e) => setSessionForm((f) => ({ ...f, status: e.target.value as Session['status'] }))}>
              <option value="Scheduled">Scheduled</option>
              <option value="Completed">Completed</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </Field>
        </div>
      </ModalSystem>

      {/* ── Orientation delete confirm ────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!deleteSession}
        onClose={() => setDeleteSession(null)}
        onConfirm={confirmDeleteSession}
        title="Remove Orientation"
        variant="confirm"
        confirmLabel={saving ? 'Removing…' : 'Remove'}
        confirmColor="rose"
        loading={saving}
      >
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Remove orientation <span className="font-bold">{deleteSession?.title}</span>? This action cannot be undone.
        </p>
      </ModalSystem>

      {/* ── Probation modal ───────────────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!probationModal}
        onClose={() => setProbationModal(null)}
        onConfirm={probationModal?.mode === 'create' ? saveProbation : updateProbation}
        title={probationModal?.mode === 'create' ? 'Add Probation' : 'Edit Probation'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Employee Name">
              <input className={inputCls} value={probationForm.employeeName} onChange={(e) => setProbationForm((f) => ({ ...f, employeeName: e.target.value }))} placeholder="e.g. John Doe" />
            </Field>
          </div>
          <Field label="Position">
            <input className={inputCls} value={probationForm.position} onChange={(e) => setProbationForm((f) => ({ ...f, position: e.target.value }))} placeholder="e.g. Receptionist" />
          </Field>
          <Field label="Supervisor">
            <input className={inputCls} value={probationForm.supervisor} onChange={(e) => setProbationForm((f) => ({ ...f, supervisor: e.target.value }))} placeholder="e.g. Sarah Johnson" />
          </Field>
          <Field label="Start Date">
            <input type="date" className={inputCls} value={probationForm.startDate} onChange={(e) => setProbationForm((f) => ({ ...f, startDate: e.target.value }))} />
          </Field>
          <Field label="End Date">
            <input type="date" className={inputCls} value={probationForm.endDate} onChange={(e) => setProbationForm((f) => ({ ...f, endDate: e.target.value }))} />
          </Field>
          <Field label="Review Date">
            <input type="date" className={inputCls} value={probationForm.reviewDate} onChange={(e) => setProbationForm((f) => ({ ...f, reviewDate: e.target.value }))} />
          </Field>
          <Field label="Status">
            <select className={inputCls} value={probationForm.status} onChange={(e) => setProbationForm((f) => ({ ...f, status: e.target.value as Probation['status'] }))}>
              <option value="Active">Active</option>
              <option value="Review Due">Review Due</option>
              <option value="Completed">Completed</option>
              <option value="Extended">Extended</option>
            </select>
          </Field>
        </div>
      </ModalSystem>

      {/* ── Probation delete confirm ──────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!deleteProbation}
        onClose={() => setDeleteProbation(null)}
        onConfirm={confirmDeleteProbation}
        title="Remove Probation Record"
        variant="confirm"
        confirmLabel={saving ? 'Removing…' : 'Remove'}
        confirmColor="rose"
        loading={saving}
      >
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Remove probation record for <span className="font-bold">{deleteProbation?.employee_name}</span>? This action cannot be undone.
        </p>
      </ModalSystem>
    </div>
  );
};

export default Onboarding;
