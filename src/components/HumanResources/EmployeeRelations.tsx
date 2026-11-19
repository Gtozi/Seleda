/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HR Employee Relations — disciplinary actions, grievances, recognition, and
 * surveys.
 *
 * DB-integrated via /api/hr-portal/relations/* routes. Uses tables from
 * migration 429.
 *
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  MessageSquare,
  Award,
  FileText,
  Plus,
  Search,
  Star,
  ThumbsUp,
  Users,
  Pencil,
  Trash2,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge, Card } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';

type Tab = 'disciplinary' | 'grievances' | 'recognition' | 'surveys';

interface DisciplinaryAction {
  id: string;
  employee: string;
  employee_id: string | null;
  score_impact: number | null;
  action_type: string;
  category: string | null;
  action_date: string | null;
  issued_by: string | null;
  description: string | null;
  status: 'Active' | 'Resolved' | 'Expired';
  expiry_date: string | null;
}

interface Employee {
  id: string;
  name: string;
  department: string | null;
  position: string | null;
}

interface Grievance {
  id: string;
  employee: string;
  type: string | null;
  category: string | null;
  grievance_date: string | null;
  description: string | null;
  status: 'Under Investigation' | 'Investigation Complete' | 'Resolved' | 'Escalated';
  assigned_to: string | null;
  priority: 'High' | 'Medium' | 'Low';
}

interface RecognitionProgram {
  id: string;
  name: string;
  program_type: string | null;
  description: string | null;
  current_winner: string | null;
  last_awarded: string | null;
  next_nomination: string | null;
  status: 'Active' | 'Inactive';
}

interface RecentRecognition {
  id: string;
  employee: string;
  award: string | null;
  category: string | null;
  award_date: string | null;
  recognized_by: string | null;
  reason: string | null;
}

interface EmployeeSurvey {
  id: string;
  name: string;
  survey_type: string | null;
  survey_date: string | null;
  response_rate: number | null;
  participants: number | null;
  status: 'Completed' | 'In Progress' | 'Draft';
  overall_score: number | null;
}

interface Stats {
  activeDisciplinary: number;
  openGrievances: number;
  recognitionAwards: number;
  surveyResponse: number;
}

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'disciplinary', label: 'Disciplinary', icon: AlertTriangle },
  { id: 'grievances', label: 'Grievances', icon: MessageSquare },
  { id: 'recognition', label: 'Recognition', icon: Award },
  { id: 'surveys', label: 'Surveys', icon: FileText },
];

const DISCIPLINARY_TONE: Record<string, statusTone.StatusTone> = { 'Written Warning': 'warning', 'Verbal Warning': 'neutral', 'Suspension': 'danger', 'Termination': 'danger' };
const DISCIPLINARY_STATUS_TONE: Record<string, statusTone.StatusTone> = { Active: 'danger', Resolved: 'success', Expired: 'neutral' };
const GRIEVANCE_STATUS_TONE: Record<string, statusTone.StatusTone> = { Resolved: 'success', 'Investigation Complete': 'accent', 'Under Investigation': 'warning', Escalated: 'danger' };
const PRIORITY_TONE: Record<string, statusTone.StatusTone> = { High: 'danger', Medium: 'warning', Low: 'neutral' };
const SURVEY_STATUS_TONE: Record<string, statusTone.StatusTone> = { Completed: 'success', 'In Progress': 'warning', Draft: 'neutral' };

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

const EmployeeRelations = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [activeTab, setActiveTab] = useState<Tab>('disciplinary');
  const [stats, setStats] = useState<Stats>({ activeDisciplinary: 0, openGrievances: 0, recognitionAwards: 0, surveyResponse: 0 });
  const [disciplinary, setDisciplinary] = useState<DisciplinaryAction[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [grievances, setGrievances] = useState<Grievance[]>([]);
  const [programs, setPrograms] = useState<RecognitionProgram[]>([]);
  const [recognition, setRecognition] = useState<RecentRecognition[]>([]);
  const [surveys, setSurveys] = useState<EmployeeSurvey[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<Tab>('disciplinary');
  const [editingId, setEditingId] = useState<string | null>(null);

  const [disciplinaryForm, setDisciplinaryForm] = useState({ employee: '', employeeId: '', scoreImpact: '', actionType: 'Written Warning', category: '', actionDate: '', issuedBy: '', description: '', status: 'Active' as 'Active' | 'Resolved' | 'Expired', expiryDate: '' });
  const [grievanceForm, setGrievanceForm] = useState({ employee: '', type: '', category: '', grievanceDate: '', description: '', assignedTo: '', priority: 'Medium' as 'High' | 'Medium' | 'Low', status: 'Under Investigation' as 'Under Investigation' | 'Investigation Complete' | 'Resolved' | 'Escalated' });
  const [programForm, setProgramForm] = useState({ name: '', programType: '', description: '', currentWinner: '', lastAwarded: '', nextNomination: '', status: 'Active' as 'Active' | 'Inactive' });
  const [recognitionForm, setRecognitionForm] = useState({ employee: '', award: '', category: '', awardDate: '', recognizedBy: '', reason: '' });
  const [surveyForm, setSurveyForm] = useState({ name: '', surveyType: '', surveyDate: '', responseRate: '', participants: '', status: 'In Progress' as 'Completed' | 'In Progress' | 'Draft', overallScore: '' });

  const fetchStats = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/relations/statistics/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setStats(await res.json());
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchDisciplinary = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/relations/disciplinary/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setDisciplinary(((await res.json()) as { disciplinary: DisciplinaryAction[] }).disciplinary || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchGrievances = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/relations/grievances/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setGrievances(((await res.json()) as { grievances: Grievance[] }).grievances || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchPrograms = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/relations/programs/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setPrograms(((await res.json()) as { programs: RecognitionProgram[] }).programs || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchRecognition = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/relations/recognition/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setRecognition(((await res.json()) as { recognition: RecentRecognition[] }).recognition || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchSurveys = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/relations/surveys/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setSurveys(((await res.json()) as { surveys: EmployeeSurvey[] }).surveys || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchEmployees = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/leave/employees/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setEmployees(((await res.json()) as { employees: Employee[] }).employees || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchStats(), fetchDisciplinary(), fetchGrievances(), fetchPrograms(), fetchRecognition(), fetchSurveys(), fetchEmployees()]);
    setLoading(false);
  }, [fetchStats, fetchDisciplinary, fetchGrievances, fetchPrograms, fetchRecognition, fetchSurveys, fetchEmployees]);

  useEffect(() => { if (currentPropertyId) refresh(); }, [currentPropertyId]);

  const openCreate = (type: Tab) => {
    setModalType(type); setEditingId(null);
    if (type === 'disciplinary') setDisciplinaryForm({ employee: '', employeeId: '', scoreImpact: '', actionType: 'Written Warning', category: '', actionDate: new Date().toISOString().slice(0, 10), issuedBy: '', description: '', status: 'Active', expiryDate: '' });
    if (type === 'grievances') setGrievanceForm({ employee: '', type: '', category: '', grievanceDate: new Date().toISOString().slice(0, 10), description: '', assignedTo: '', priority: 'Medium', status: 'Under Investigation' });
    if (type === 'recognition') setProgramForm({ name: '', programType: '', description: '', currentWinner: '', lastAwarded: '', nextNomination: '', status: 'Active' });
    if (type === 'surveys') setSurveyForm({ name: '', surveyType: '', surveyDate: new Date().toISOString().slice(0, 10), responseRate: '', participants: '', status: 'In Progress', overallScore: '' });
    setShowModal(true);
  };

  const openEdit = (type: Tab, item: any) => {
    setModalType(type); setEditingId(item.id);
    if (type === 'disciplinary') setDisciplinaryForm({ employee: item.employee, employeeId: item.employee_id || '', scoreImpact: item.score_impact != null ? String(item.score_impact) : '', actionType: item.action_type, category: item.category || '', actionDate: item.action_date || '', issuedBy: item.issued_by || '', description: item.description || '', status: item.status, expiryDate: item.expiry_date || '' });
    if (type === 'grievances') setGrievanceForm({ employee: item.employee, type: item.type || '', category: item.category || '', grievanceDate: item.grievance_date || '', description: item.description || '', assignedTo: item.assigned_to || '', priority: item.priority, status: item.status });
    if (type === 'recognition') setProgramForm({ name: item.name, programType: item.program_type || '', description: item.description || '', currentWinner: item.current_winner || '', lastAwarded: item.last_awarded || '', nextNomination: item.next_nomination || '', status: item.status });
    if (type === 'surveys') setSurveyForm({ name: item.name, surveyType: item.survey_type || '', surveyDate: item.survey_date || '', responseRate: item.response_rate != null ? String(item.response_rate) : '', participants: item.participants != null ? String(item.participants) : '', status: item.status, overallScore: item.overall_score != null ? String(item.overall_score) : '' });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      let endpoint = '';
      let method: 'POST' | 'PUT' = 'POST';
      let body: any = { propertyId: currentPropertyId };

      if (modalType === 'disciplinary') {
        endpoint = editingId ? `/api/hr-portal/relations/disciplinary/${editingId}` : '/api/hr-portal/relations/disciplinary';
        method = editingId ? 'PUT' : 'POST';
        body = { ...body, employee: disciplinaryForm.employee, employeeId: disciplinaryForm.employeeId, scoreImpact: disciplinaryForm.scoreImpact, actionType: disciplinaryForm.actionType, category: disciplinaryForm.category, actionDate: disciplinaryForm.actionDate, issuedBy: disciplinaryForm.issuedBy, description: disciplinaryForm.description, status: disciplinaryForm.status, expiryDate: disciplinaryForm.expiryDate };
      } else if (modalType === 'grievances') {
        endpoint = editingId ? `/api/hr-portal/relations/grievances/${editingId}` : '/api/hr-portal/relations/grievances';
        method = editingId ? 'PUT' : 'POST';
        body = { ...body, employee: grievanceForm.employee, type: grievanceForm.type, category: grievanceForm.category, grievanceDate: grievanceForm.grievanceDate, description: grievanceForm.description, assignedTo: grievanceForm.assignedTo, priority: grievanceForm.priority, status: grievanceForm.status };
      } else if (modalType === 'recognition') {
        endpoint = editingId ? `/api/hr-portal/relations/programs/${editingId}` : '/api/hr-portal/relations/programs';
        method = editingId ? 'PUT' : 'POST';
        body = { ...body, name: programForm.name, programType: programForm.programType, description: programForm.description, currentWinner: programForm.currentWinner, lastAwarded: programForm.lastAwarded, nextNomination: programForm.nextNomination, status: programForm.status };
      } else if (modalType === 'surveys') {
        endpoint = editingId ? `/api/hr-portal/relations/surveys/${editingId}` : '/api/hr-portal/relations/surveys';
        method = editingId ? 'PUT' : 'POST';
        body = { ...body, name: surveyForm.name, surveyType: surveyForm.surveyType, surveyDate: surveyForm.surveyDate, responseRate: surveyForm.responseRate, participants: surveyForm.participants, status: surveyForm.status, overallScore: surveyForm.overallScore };
      }

      const res = await fetch(endpoint, { method, headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Saved', 'success', 'HR');
      setShowModal(false); refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const saveRecognition = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      const endpoint = editingId ? `/api/hr-portal/relations/recognition/${editingId}` : '/api/hr-portal/relations/recognition';
      const method = editingId ? 'PUT' : 'POST';
      const body = { ...recognitionForm, propertyId: currentPropertyId };
      const res = await fetch(endpoint, { method, headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Recognition saved', 'success', 'HR');
      setShowRecognition(false); refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const [showRecognition, setShowRecognition] = useState(false);

  const handleDelete = async (type: 'disciplinary' | 'grievances' | 'recognition' | 'awards' | 'surveys', id: string) => {
    if (!confirm('Delete this record?')) return;
    setSaving(true);
    const endpoint = type === 'disciplinary' ? `/api/hr-portal/relations/disciplinary/${id}`
      : type === 'grievances' ? `/api/hr-portal/relations/grievances/${id}`
      : type === 'recognition' ? `/api/hr-portal/relations/programs/${id}`
      : type === 'awards' ? `/api/hr-portal/relations/recognition/${id}`
      : `/api/hr-portal/relations/surveys/${id}`;
    try {
      const res = await fetch(endpoint, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Deleted', 'success', 'HR');
      refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const tabLabel = activeTab === 'disciplinary' ? 'New Action' : activeTab === 'grievances' ? 'File Grievance' : activeTab === 'recognition' ? 'Add Program' : 'Create Survey';

  const filteredDisciplinary = useMemo(() => disciplinary.filter((d) => !search || d.employee.toLowerCase().includes(search.toLowerCase()) || d.action_type.toLowerCase().includes(search.toLowerCase())), [disciplinary, search]);
  const filteredGrievances = useMemo(() => grievances.filter((g) => !search || g.employee.toLowerCase().includes(search.toLowerCase()) || (g.type || '').toLowerCase().includes(search.toLowerCase())), [grievances, search]);
  const filteredPrograms = useMemo(() => programs.filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase())), [programs, search]);
  const filteredRecognition = useMemo(() => recognition.filter((r) => !search || r.employee.toLowerCase().includes(search.toLowerCase()) || (r.award || '').toLowerCase().includes(search.toLowerCase())), [recognition, search]);
  const filteredSurveys = useMemo(() => surveys.filter((s) => !search || s.name.toLowerCase().includes(search.toLowerCase())), [surveys, search]);

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Employee Relations" subtitle="Manage disciplinary actions, grievances, recognition, and feedback" icon={Users} />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Users className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">Select a property to view employee relations data.</p>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Employee Relations"
        subtitle="Manage disciplinary actions, grievances, recognition, and feedback"
        icon={Users}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refresh} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={() => openCreate(activeTab)} className={button.primary}><Plus className="w-4 h-4" /> {tabLabel}</button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Active Disciplinary" value={String(stats.activeDisciplinary)} caption="Ongoing actions" icon={AlertTriangle} tone="danger" />
        <StatCard title="Open Grievances" value={String(stats.openGrievances)} caption="Investigating / complete" icon={MessageSquare} tone="warning" />
        <StatCard title="Recognition Awards" value={String(stats.recognitionAwards)} caption="Recent recipients" icon={Award} tone="success" />
        <StatCard title="Survey Response" value={`${stats.surveyResponse}%`} caption="Avg response rate" icon={FileText} tone="accent" />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto">
        {TABS.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${activeTab === tab.id ? 'bg-white dark:bg-slate-700 text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
            <tab.icon size={14} /> {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
        <input type="text" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans" />
      </div>

      {/* Disciplinary */}
      {activeTab === 'disciplinary' && (
        <SectionCard pad="none">
          <div className="p-6 border-b border-slate-50 dark:border-slate-800"><h3 className="text-base font-semibold text-slate-900 dark:text-white">Disciplinary Actions</h3></div>
          {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filteredDisciplinary.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400"><AlertTriangle className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No disciplinary actions found.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Employee</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Type</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Category</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Impact</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Date</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Issued By</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Status</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {filteredDisciplinary.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4 text-sm font-semibold text-slate-900 dark:text-white">{d.employee}</td>
                      <td className="px-6 py-4"><Badge tone={DISCIPLINARY_TONE[d.action_type] ?? 'neutral'}>{d.action_type}</Badge></td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500">{d.category || '—'}</td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500">{d.score_impact != null ? Number(d.score_impact).toFixed(1) : '—'}</td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500">{d.action_date || '—'}</td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500">{d.issued_by || '—'}</td>
                      <td className="px-6 py-4 text-center"><Badge tone={DISCIPLINARY_STATUS_TONE[d.status]}>{d.status}</Badge></td>
                      <td className="px-6 py-4"><div className="flex justify-center gap-2"><button onClick={() => openEdit('disciplinary', d)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button><button onClick={() => handleDelete('disciplinary', d.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* Grievances */}
      {activeTab === 'grievances' && (
        <SectionCard pad="none">
          <div className="p-6 border-b border-slate-50 dark:border-slate-800"><h3 className="text-base font-semibold text-slate-900 dark:text-white">Grievances</h3></div>
          {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filteredGrievances.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400"><MessageSquare className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No grievances found.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Employee</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Type</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Category</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Date</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Assigned To</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Priority</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Status</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {filteredGrievances.map((g) => (
                    <tr key={g.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4 text-sm font-semibold text-slate-900 dark:text-white">{g.employee}</td>
                      <td className="px-6 py-4 text-xs font-bold text-slate-900 dark:text-white">{g.type || '—'}</td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500">{g.category || '—'}</td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500">{g.grievance_date || '—'}</td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500">{g.assigned_to || '—'}</td>
                      <td className="px-6 py-4 text-center"><Badge tone={PRIORITY_TONE[g.priority]}>{g.priority}</Badge></td>
                      <td className="px-6 py-4 text-center"><Badge tone={GRIEVANCE_STATUS_TONE[g.status]}>{g.status}</Badge></td>
                      <td className="px-6 py-4"><div className="flex justify-center gap-2"><button onClick={() => openEdit('grievances', g)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button><button onClick={() => handleDelete('grievances', g.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* Recognition */}
      {activeTab === 'recognition' && (
        <div className="grid lg:grid-cols-2 gap-6">
          <SectionCard>
            <div className="flex items-center justify-between mb-4"><h3 className="text-base font-semibold text-slate-900 dark:text-white">Recognition Programs</h3></div>
            {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filteredPrograms.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400"><Award className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No programs found.</p></div>
            ) : (
              <div className="space-y-4">
                {filteredPrograms.map((p) => (
                  <Card key={p.id} pad="sm">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-amber-100 dark:bg-amber-500/20 rounded-xl flex items-center justify-center">
                          <Award className="text-amber-600 dark:text-amber-400" size={20} />
                        </div>
                        <div>
                          <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{p.name}</h4>
                          <p className="text-xs font-medium text-slate-400">{p.program_type || '—'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge tone={p.status === 'Active' ? 'success' : 'neutral'}>{p.status}</Badge>
                        <button onClick={() => openEdit('recognition', p)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                        <button onClick={() => handleDelete('recognition', p.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                      </div>
                    </div>
                    <p className="text-xs font-medium text-slate-400 mb-2">{p.description}</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div><span className="font-bold text-slate-400">Current Winner:</span><span className="font-semibold text-slate-900 dark:text-white ml-1">{p.current_winner || '—'}</span></div>
                      <div><span className="font-bold text-slate-400">Next Nomination:</span><span className="font-semibold text-slate-900 dark:text-white ml-1">{p.next_nomination || '—'}</span></div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">Recent Recognition</h3>
              <button onClick={() => { setEditingId(null); setRecognitionForm({ employee: '', award: '', category: '', awardDate: '', recognizedBy: '', reason: '' }); setShowRecognition(true); }} className={button.primary + ' text-xs'}><Plus size={14} /> Add</button>
            </div>
            {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filteredRecognition.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400"><Star className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No recent recognition found.</p></div>
            ) : (
              <div className="space-y-4">
                {filteredRecognition.map((r) => (
                  <Card key={r.id} pad="sm">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-8 h-8 bg-amber-100 dark:bg-amber-500/20 rounded-lg flex items-center justify-center">
                        <Star className="text-amber-600 dark:text-amber-400" size={16} />
                      </div>
                      <div className="flex-1">
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{r.employee}</h4>
                        <p className="text-xs font-medium text-slate-400">{r.award || '—'}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-400">{r.award_date || '—'}</span>
                        <button onClick={() => { setEditingId(r.id); setRecognitionForm({ employee: r.employee, award: r.award || '', category: r.category || '', awardDate: r.award_date || '', recognizedBy: r.recognized_by || '', reason: r.reason || '' }); setShowRecognition(true); }} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                        <button onClick={() => handleDelete('awards', r.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                      </div>
                    </div>
                    <p className="text-xs font-medium text-slate-500">{r.reason}</p>
                    <div className="flex items-center gap-1 mt-2">
                      <ThumbsUp size={12} className="text-slate-400" />
                      <span className="text-xs font-medium text-slate-400">Recognized by {r.recognized_by || '—'}</span>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      )}

      {/* Surveys */}
      {activeTab === 'surveys' && (
        <SectionCard pad="none">
          <div className="p-6 border-b border-slate-50 dark:border-slate-800"><h3 className="text-base font-semibold text-slate-900 dark:text-white">Employee Surveys</h3></div>
          {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filteredSurveys.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400"><FileText className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No surveys found.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Survey Name</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Type</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Date</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Response Rate</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Participants</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Score</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Status</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {filteredSurveys.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4 text-sm font-semibold text-slate-900 dark:text-white">{s.name}</td>
                      <td className="px-6 py-4"><Badge tone="neutral">{s.survey_type || '—'}</Badge></td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500">{s.survey_date || '—'}</td>
                      <td className="px-6 py-4 text-center text-sm font-semibold text-slate-900 dark:text-white">{s.response_rate ?? '—'}%</td>
                      <td className="px-6 py-4 text-center text-sm font-semibold text-slate-900 dark:text-white">{s.participants ?? '—'}</td>
                      <td className="px-6 py-4 text-center">
                        {s.overall_score != null ? (
                          <div className="flex items-center justify-center gap-1">
                            <Star className="text-amber-400" size={12} fill="currentColor" />
                            <span className="text-sm font-semibold text-slate-900 dark:text-white">{s.overall_score}</span>
                          </div>
                        ) : <span className="text-xs font-bold text-slate-400">-</span>}
                      </td>
                      <td className="px-6 py-4 text-center"><Badge tone={SURVEY_STATUS_TONE[s.status]}>{s.status}</Badge></td>
                      <td className="px-6 py-4"><div className="flex justify-center gap-2"><button onClick={() => openEdit('surveys', s)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button><button onClick={() => handleDelete('surveys', s.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* Main Modal */}
      <ModalSystem
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onConfirm={handleSave}
        title={editingId ? 'Edit' : 'Add'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        {modalType === 'disciplinary' && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Employee">
              <select
                className={inputCls}
                value={disciplinaryForm.employeeId}
                onChange={(e) => {
                  const emp = employees.find((x) => x.id === e.target.value);
                  setDisciplinaryForm(f => ({ ...f, employeeId: e.target.value, employee: emp ? emp.name : e.target.value }));
                }}
              >
                <option value="">Select employee…</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name} — {e.department || '—'}</option>)}
              </select>
            </Field>
            <Field label="Score Impact"><input type="number" step="0.1" className={inputCls} value={disciplinaryForm.scoreImpact} onChange={(e) => setDisciplinaryForm(f => ({ ...f, scoreImpact: e.target.value }))} /></Field>
            <Field label="Action Type">
              <select className={inputCls} value={disciplinaryForm.actionType} onChange={(e) => setDisciplinaryForm(f => ({ ...f, actionType: e.target.value }))}>
                {['Written Warning', 'Verbal Warning', 'Suspension', 'Termination'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Category"><input className={inputCls} value={disciplinaryForm.category} onChange={(e) => setDisciplinaryForm(f => ({ ...f, category: e.target.value }))} /></Field>
            <Field label="Action Date"><input type="date" className={inputCls} value={disciplinaryForm.actionDate} onChange={(e) => setDisciplinaryForm(f => ({ ...f, actionDate: e.target.value }))} /></Field>
            <Field label="Issued By"><input className={inputCls} value={disciplinaryForm.issuedBy} onChange={(e) => setDisciplinaryForm(f => ({ ...f, issuedBy: e.target.value }))} /></Field>
            <Field label="Expiry Date"><input type="date" className={inputCls} value={disciplinaryForm.expiryDate} onChange={(e) => setDisciplinaryForm(f => ({ ...f, expiryDate: e.target.value }))} /></Field>
            <Field label="Status">
              <select className={inputCls} value={disciplinaryForm.status} onChange={(e) => setDisciplinaryForm(f => ({ ...f, status: e.target.value as any }))}>
                {['Active', 'Resolved', 'Expired'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <div className="col-span-2"><Field label="Description"><textarea className={inputCls} rows={3} value={disciplinaryForm.description} onChange={(e) => setDisciplinaryForm(f => ({ ...f, description: e.target.value }))} /></Field></div>
          </div>
        )}
        {modalType === 'grievances' && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Employee"><input className={inputCls} value={grievanceForm.employee} onChange={(e) => setGrievanceForm(f => ({ ...f, employee: e.target.value }))} /></Field>
            <Field label="Type"><input className={inputCls} value={grievanceForm.type} onChange={(e) => setGrievanceForm(f => ({ ...f, type: e.target.value }))} /></Field>
            <Field label="Category"><input className={inputCls} value={grievanceForm.category} onChange={(e) => setGrievanceForm(f => ({ ...f, category: e.target.value }))} /></Field>
            <Field label="Date"><input type="date" className={inputCls} value={grievanceForm.grievanceDate} onChange={(e) => setGrievanceForm(f => ({ ...f, grievanceDate: e.target.value }))} /></Field>
            <Field label="Assigned To"><input className={inputCls} value={grievanceForm.assignedTo} onChange={(e) => setGrievanceForm(f => ({ ...f, assignedTo: e.target.value }))} /></Field>
            <Field label="Priority">
              <select className={inputCls} value={grievanceForm.priority} onChange={(e) => setGrievanceForm(f => ({ ...f, priority: e.target.value as any }))}>
                {['High', 'Medium', 'Low'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className={inputCls} value={grievanceForm.status} onChange={(e) => setGrievanceForm(f => ({ ...f, status: e.target.value as any }))}>
                {['Under Investigation', 'Investigation Complete', 'Resolved', 'Escalated'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <div className="col-span-2"><Field label="Description"><textarea className={inputCls} rows={3} value={grievanceForm.description} onChange={(e) => setGrievanceForm(f => ({ ...f, description: e.target.value }))} /></Field></div>
          </div>
        )}
        {modalType === 'recognition' && (
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2"><Field label="Name"><input className={inputCls} value={programForm.name} onChange={(e) => setProgramForm(f => ({ ...f, name: e.target.value }))} /></Field></div>
            <Field label="Type"><input className={inputCls} value={programForm.programType} onChange={(e) => setProgramForm(f => ({ ...f, programType: e.target.value }))} /></Field>
            <Field label="Current Winner"><input className={inputCls} value={programForm.currentWinner} onChange={(e) => setProgramForm(f => ({ ...f, currentWinner: e.target.value }))} /></Field>
            <Field label="Last Awarded"><input type="date" className={inputCls} value={programForm.lastAwarded} onChange={(e) => setProgramForm(f => ({ ...f, lastAwarded: e.target.value }))} /></Field>
            <Field label="Next Nomination"><input className={inputCls} value={programForm.nextNomination} onChange={(e) => setProgramForm(f => ({ ...f, nextNomination: e.target.value }))} /></Field>
            <Field label="Status">
              <select className={inputCls} value={programForm.status} onChange={(e) => setProgramForm(f => ({ ...f, status: e.target.value as any }))}>
                {['Active', 'Inactive'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <div className="col-span-2"><Field label="Description"><textarea className={inputCls} rows={3} value={programForm.description} onChange={(e) => setProgramForm(f => ({ ...f, description: e.target.value }))} /></Field></div>
          </div>
        )}
        {modalType === 'surveys' && (
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2"><Field label="Name"><input className={inputCls} value={surveyForm.name} onChange={(e) => setSurveyForm(f => ({ ...f, name: e.target.value }))} /></Field></div>
            <Field label="Type"><input className={inputCls} value={surveyForm.surveyType} onChange={(e) => setSurveyForm(f => ({ ...f, surveyType: e.target.value }))} /></Field>
            <Field label="Date"><input type="date" className={inputCls} value={surveyForm.surveyDate} onChange={(e) => setSurveyForm(f => ({ ...f, surveyDate: e.target.value }))} /></Field>
            <Field label="Response Rate (%)"><input className={inputCls} value={surveyForm.responseRate} onChange={(e) => setSurveyForm(f => ({ ...f, responseRate: e.target.value }))} /></Field>
            <Field label="Participants"><input className={inputCls} value={surveyForm.participants} onChange={(e) => setSurveyForm(f => ({ ...f, participants: e.target.value }))} /></Field>
            <Field label="Overall Score"><input className={inputCls} value={surveyForm.overallScore} onChange={(e) => setSurveyForm(f => ({ ...f, overallScore: e.target.value }))} /></Field>
            <Field label="Status">
              <select className={inputCls} value={surveyForm.status} onChange={(e) => setSurveyForm(f => ({ ...f, status: e.target.value as any }))}>
                {['Completed', 'In Progress', 'Draft'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
        )}
      </ModalSystem>

      {/* Recognition Award Modal */}
      <ModalSystem
        isOpen={showRecognition}
        onClose={() => setShowRecognition(false)}
        onConfirm={saveRecognition}
        title={editingId ? 'Edit Recognition' : 'Add Recognition'}
        variant="form"
        size="md"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Employee"><input className={inputCls} value={recognitionForm.employee} onChange={(e) => setRecognitionForm(f => ({ ...f, employee: e.target.value }))} /></Field>
          <Field label="Award"><input className={inputCls} value={recognitionForm.award} onChange={(e) => setRecognitionForm(f => ({ ...f, award: e.target.value }))} /></Field>
          <Field label="Category"><input className={inputCls} value={recognitionForm.category} onChange={(e) => setRecognitionForm(f => ({ ...f, category: e.target.value }))} /></Field>
          <Field label="Award Date"><input type="date" className={inputCls} value={recognitionForm.awardDate} onChange={(e) => setRecognitionForm(f => ({ ...f, awardDate: e.target.value }))} /></Field>
          <Field label="Recognized By"><input className={inputCls} value={recognitionForm.recognizedBy} onChange={(e) => setRecognitionForm(f => ({ ...f, recognizedBy: e.target.value }))} /></Field>
          <div className="col-span-2"><Field label="Reason"><textarea className={inputCls} rows={3} value={recognitionForm.reason} onChange={(e) => setRecognitionForm(f => ({ ...f, reason: e.target.value }))} /></Field></div>
        </div>
      </ModalSystem>
    </div>
  );
};

export default EmployeeRelations;
