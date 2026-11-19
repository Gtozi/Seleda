/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HR Health & Safety — incidents, safety training, medical exams, PPE and
 * risk assessments.
 *
 * DB-integrated via /api/hr-portal/health/* routes. Uses tables from
 * migration 428.
 *
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Shield,
  AlertTriangle,
  Heart,
  ClipboardCheck,
  HardHat,
  Plus,
  Search,
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

type Tab = 'incidents' | 'training' | 'examinations' | 'ppe';

interface Incident {
  id: string;
  type: string;
  severity: 'Minor' | 'Moderate' | 'Major' | 'Critical';
  location: string | null;
  incident_date: string | null;
  employee: string | null;
  description: string | null;
  status: 'Investigating' | 'Closed' | 'Open';
  days_lost: number;
}

interface SafetyTraining {
  id: string;
  name: string;
  training_type: string;
  category: string | null;
  duration: string | null;
  frequency: string | null;
  last_completed: string | null;
  next_due: string | null;
  completion_rate: number;
  total_employees: number;
  status: string;
}

interface MedicalExam {
  id: string;
  employee: string;
  exam_type: string | null;
  exam_date: string | null;
  result: string | null;
  next_exam: string | null;
  status: 'Valid' | 'Review Required' | 'Expired';
}

interface PPE {
  id: string;
  item: string;
  category: string | null;
  total_issued: number;
  in_use: number;
  needs_replacement: number;
  last_inspection: string | null;
  status: string;
}

interface RiskAssessment {
  id: string;
  area: string;
  hazard_level: 'Low' | 'Medium' | 'High';
  last_assessment: string | null;
  next_assessment: string | null;
  status: 'Valid' | 'Review Required';
  controls: number;
}

interface Stats {
  ytdIncidents: number;
  daysLost: number;
  trainingCompliance: number;
  medicalValid: number;
}

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'incidents', label: 'Incidents', icon: AlertTriangle },
  { id: 'training', label: 'Safety Training', icon: ClipboardCheck },
  { id: 'examinations', label: 'Medical Exams', icon: Heart },
  { id: 'ppe', label: 'PPE & Risk', icon: HardHat },
];

const SEVERITY_TONE: Record<string, statusTone.StatusTone> = { Minor: 'success', Moderate: 'warning', Major: 'danger', Critical: 'danger' };
const INCIDENT_STATUS_TONE: Record<string, statusTone.StatusTone> = { Closed: 'success', Investigating: 'warning', Open: 'danger' };
const EXAM_STATUS_TONE: Record<string, statusTone.StatusTone> = { Valid: 'success', 'Review Required': 'warning', Expired: 'danger' };
const HAZARD_TONE: Record<string, statusTone.StatusTone> = { Low: 'success', Medium: 'warning', High: 'danger' };
const PPE_STATUS_TONE: Record<string, statusTone.StatusTone> = { Good: 'success', Fair: 'warning', 'Low Stock': 'warning', 'Out of Stock': 'danger' };
const MOBILITY_TONE: Record<string, statusTone.StatusTone> = { InProgress: 'warning', Approved: 'accent', Completed: 'success' };

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

const HealthSafety = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [activeTab, setActiveTab] = useState<Tab>('incidents');
  const [stats, setStats] = useState<Stats>({ ytdIncidents: 0, daysLost: 0, trainingCompliance: 0, medicalValid: 0 });
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [training, setTraining] = useState<SafetyTraining[]>([]);
  const [exams, setExams] = useState<MedicalExam[]>([]);
  const [ppe, setPpe] = useState<PPE[]>([]);
  const [risks, setRisks] = useState<RiskAssessment[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<Tab>('incidents');
  const [editingId, setEditingId] = useState<string | null>(null);

  const [incidentForm, setIncidentForm] = useState({ type: '', severity: 'Minor', location: '', incidentDate: '', employee: '', description: '', status: 'Investigating', daysLost: 0 });
  const [trainingForm, setTrainingForm] = useState({ name: '', trainingType: 'Mandatory', category: '', duration: '', frequency: '', lastCompleted: '', nextDue: '', completionRate: 0, totalEmployees: 0, status: 'Active' });
  const [examForm, setExamForm] = useState({ employee: '', examType: '', examDate: '', result: '', nextExam: '', status: 'Valid' });
  const [ppeForm, setPpeForm] = useState({ item: '', category: '', totalIssued: 0, inUse: 0, needsReplacement: 0, lastInspection: '', status: 'Good' });
  const [riskForm, setRiskForm] = useState({ area: '', hazardLevel: 'Low' as 'Low' | 'Medium' | 'High', lastAssessment: '', nextAssessment: '', status: 'Valid' as 'Valid' | 'Review Required', controls: 0 });

  const fetchStats = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/health/statistics/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setStats(await res.json());
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchIncidents = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/health/incidents/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setIncidents(((await res.json()) as { incidents: Incident[] }).incidents || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchTraining = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/health/training/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setTraining(((await res.json()) as { training: SafetyTraining[] }).training || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchExams = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/health/exams/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setExams(((await res.json()) as { exams: MedicalExam[] }).exams || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchPpe = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/health/ppe/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setPpe(((await res.json()) as { ppe: PPE[] }).ppe || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchRisks = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/health/risk/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setRisks(((await res.json()) as { risks: RiskAssessment[] }).risks || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchStats(), fetchIncidents(), fetchTraining(), fetchExams(), fetchPpe(), fetchRisks()]);
    setLoading(false);
  }, [fetchStats, fetchIncidents, fetchTraining, fetchExams, fetchPpe, fetchRisks]);

  useEffect(() => { if (currentPropertyId) refresh(); }, [currentPropertyId]);

  const openCreate = (type: Tab) => {
    setModalType(type); setEditingId(null);
    if (type === 'incidents') setIncidentForm({ type: '', severity: 'Minor', location: '', incidentDate: new Date().toISOString().slice(0, 10), employee: '', description: '', status: 'Investigating', daysLost: 0 });
    if (type === 'training') setTrainingForm({ name: '', trainingType: 'Mandatory', category: '', duration: '', frequency: '', lastCompleted: '', nextDue: '', completionRate: 0, totalEmployees: 0, status: 'Active' });
    if (type === 'examinations') setExamForm({ employee: '', examType: '', examDate: '', result: '', nextExam: '', status: 'Valid' });
    if (type === 'ppe') setPpeForm({ item: '', category: '', totalIssued: 0, inUse: 0, needsReplacement: 0, lastInspection: '', status: 'Good' });
    setShowModal(true);
  };

  const openEdit = (type: Tab, item: any) => {
    setModalType(type); setEditingId(item.id);
    if (type === 'incidents') setIncidentForm({ type: item.type, severity: item.severity, location: item.location || '', incidentDate: item.incident_date || '', employee: item.employee || '', description: item.description || '', status: item.status, daysLost: Number(item.days_lost) });
    if (type === 'training') setTrainingForm({ name: item.name, trainingType: item.training_type, category: item.category || '', duration: item.duration || '', frequency: item.frequency || '', lastCompleted: item.last_completed || '', nextDue: item.next_due || '', completionRate: Number(item.completion_rate), totalEmployees: Number(item.total_employees), status: item.status });
    if (type === 'examinations') setExamForm({ employee: item.employee, examType: item.exam_type || '', examDate: item.exam_date || '', result: item.result || '', nextExam: item.next_exam || '', status: item.status });
    if (type === 'ppe') setPpeForm({ item: item.item, category: item.category || '', totalIssued: Number(item.total_issued), inUse: Number(item.in_use), needsReplacement: Number(item.needs_replacement), lastInspection: item.last_inspection || '', status: item.status });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      let endpoint = '';
      let method: 'POST' | 'PUT' = 'POST';
      let body: any = { propertyId: currentPropertyId };

      if (modalType === 'incidents') {
        endpoint = editingId ? `/api/hr-portal/health/incidents/${editingId}` : '/api/hr-portal/health/incidents';
        method = editingId ? 'PUT' : 'POST';
        body = { ...body, ...incidentForm, incidentDate: incidentForm.incidentDate };
      } else if (modalType === 'training') {
        endpoint = editingId ? `/api/hr-portal/health/training/${editingId}` : '/api/hr-portal/health/training';
        method = editingId ? 'PUT' : 'POST';
        body = { ...body, ...trainingForm, trainingType: trainingForm.trainingType, lastCompleted: trainingForm.lastCompleted, nextDue: trainingForm.nextDue, completionRate: trainingForm.completionRate, totalEmployees: trainingForm.totalEmployees };
      } else if (modalType === 'examinations') {
        endpoint = editingId ? `/api/hr-portal/health/exams/${editingId}` : '/api/hr-portal/health/exams';
        method = editingId ? 'PUT' : 'POST';
        body = { ...body, ...examForm, examType: examForm.examType, examDate: examForm.examDate, nextExam: examForm.nextExam };
      } else if (modalType === 'ppe') {
        endpoint = editingId ? `/api/hr-portal/health/ppe/${editingId}` : '/api/hr-portal/health/ppe';
        method = editingId ? 'PUT' : 'POST';
        body = { ...body, ...ppeForm, totalIssued: ppeForm.totalIssued, inUse: ppeForm.inUse, needsReplacement: ppeForm.needsReplacement, lastInspection: ppeForm.lastInspection };
      }

      const res = await fetch(endpoint, { method, headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Saved', 'success', 'HR');
      setShowModal(false); refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const saveRisk = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      const endpoint = editingId ? `/api/hr-portal/health/risk/${editingId}` : '/api/hr-portal/health/risk';
      const method = editingId ? 'PUT' : 'POST';
      const body = { propertyId: currentPropertyId, ...riskForm };
      const res = await fetch(endpoint, { method, headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Risk saved', 'success', 'HR');
      setShowRisk(false); refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const [showRisk, setShowRisk] = useState(false);

  const handleDelete = async (type: 'incidents' | 'training' | 'examinations' | 'ppe' | 'risk', id: string) => {
    if (!confirm('Delete this record?')) return;
    setSaving(true);
    const endpoint = type === 'incidents' ? `/api/hr-portal/health/incidents/${id}`
      : type === 'training' ? `/api/hr-portal/health/training/${id}`
      : type === 'examinations' ? `/api/hr-portal/health/exams/${id}`
      : type === 'ppe' ? `/api/hr-portal/health/ppe/${id}`
      : `/api/hr-portal/health/risk/${id}`;
    try {
      const res = await fetch(endpoint, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Deleted', 'success', 'HR');
      refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const tabLabel = activeTab === 'incidents' ? 'Report Incident' : activeTab === 'training' ? 'Add Training' : activeTab === 'examinations' ? 'Schedule Exam' : 'Add PPE';

  const filteredIncidents = useMemo(() => incidents.filter((i) => !search || i.type.toLowerCase().includes(search.toLowerCase()) || (i.employee || '').toLowerCase().includes(search.toLowerCase())), [incidents, search]);
  const filteredTraining = useMemo(() => training.filter((t) => !search || t.name.toLowerCase().includes(search.toLowerCase()) || (t.category || '').toLowerCase().includes(search.toLowerCase())), [training, search]);
  const filteredExams = useMemo(() => exams.filter((e) => !search || e.employee.toLowerCase().includes(search.toLowerCase()) || (e.exam_type || '').toLowerCase().includes(search.toLowerCase())), [exams, search]);
  const filteredPpe = useMemo(() => ppe.filter((p) => !search || p.item.toLowerCase().includes(search.toLowerCase()) || (p.category || '').toLowerCase().includes(search.toLowerCase())), [ppe, search]);
  const filteredRisks = useMemo(() => risks.filter((r) => !search || r.area.toLowerCase().includes(search.toLowerCase())), [risks, search]);

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Health & Safety" subtitle="Manage incidents, training, examinations, and safety compliance" icon={Shield} />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Shield className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">Select a property to view health & safety data.</p>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Health & Safety"
        subtitle="Manage incidents, training, examinations, and safety compliance"
        icon={Shield}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refresh} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={() => openCreate(activeTab)} className={button.primary}><Plus className="w-4 h-4" /> {tabLabel}</button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Incidents (YTD)" value={String(stats.ytdIncidents)} caption="Reported" icon={AlertTriangle} tone="danger" />
        <StatCard title="Days Lost" value={String(stats.daysLost)} caption="Due to incidents" icon={ClipboardCheck} tone="warning" />
        <StatCard title="Training Compliance" value={`${stats.trainingCompliance}%`} caption="Active programs" icon={Heart} tone="success" />
        <StatCard title="Medical Valid" value={String(stats.medicalValid)} caption="Current exams" icon={Heart} tone="accent" />
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

      {/* Incidents */}
      {activeTab === 'incidents' && (
        <SectionCard pad="none">
          <div className="p-6 border-b border-slate-50 dark:border-slate-800"><h3 className="text-base font-semibold text-slate-900 dark:text-white">Incident Reports</h3></div>
          {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filteredIncidents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400"><AlertTriangle className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No incidents found.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Type</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Severity</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Location</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Employee</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Date</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Days Lost</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Status</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {filteredIncidents.map((i) => (
                    <tr key={i.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4 text-sm font-semibold text-slate-900 dark:text-white">{i.type}</td>
                      <td className="px-6 py-4"><Badge tone={SEVERITY_TONE[i.severity]}>{i.severity}</Badge></td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500">{i.location || '—'}</td>
                      <td className="px-6 py-4 text-xs font-bold text-slate-900 dark:text-white">{i.employee || '—'}</td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500">{i.incident_date || '—'}</td>
                      <td className="px-6 py-4 text-center text-xs font-bold text-slate-900 dark:text-white">{i.days_lost}</td>
                      <td className="px-6 py-4 text-center"><Badge tone={INCIDENT_STATUS_TONE[i.status]}>{i.status}</Badge></td>
                      <td className="px-6 py-4">
                        <div className="flex justify-center gap-2">
                          <button onClick={() => openEdit('incidents', i)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                          <button onClick={() => handleDelete('incidents', i.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
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

      {/* Training */}
      {activeTab === 'training' && (
        <SectionCard>
          <div className="mb-4"><h3 className="text-base font-semibold text-slate-900 dark:text-white">Safety Training Programs</h3></div>
          {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filteredTraining.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400"><ClipboardCheck className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No training programs found.</p></div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTraining.map((t) => (
                <Card key={t.id} pad="md">
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-500/20 rounded-xl flex items-center justify-center">
                      <Shield className="text-emerald-600 dark:text-emerald-400" size={20} />
                    </div>
                    <Badge tone={t.training_type === 'Mandatory' ? 'danger' : 'accent'}>{t.training_type}</Badge>
                  </div>
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">{t.name}</h4>
                  <p className="text-xs font-medium text-slate-400 mb-3">{t.category || '—'} · {t.duration || '—'}</p>
                  <div className="space-y-2 mb-3 text-xs">
                    <div className="flex justify-between"><span className="font-bold text-slate-400">Frequency</span><span className="font-semibold text-slate-900 dark:text-white">{t.frequency || '—'}</span></div>
                    <div className="flex justify-between"><span className="font-bold text-slate-400">Next Due</span><span className="font-semibold text-slate-900 dark:text-white">{t.next_due || '—'}</span></div>
                  </div>
                  <div className="pt-3 border-t border-slate-200 dark:border-slate-700">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs font-medium text-slate-400">Completion</span>
                      <span className="text-sm font-semibold text-slate-900 dark:text-white">{t.completion_rate}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden mb-1">
                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${t.completion_rate}%` }} />
                    </div>
                    <p className="text-xs font-medium text-slate-400">{t.total_employees} employees</p>
                  </div>
                  <div className="flex justify-end gap-2 mt-3">
                    <button onClick={() => openEdit('training', t)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                    <button onClick={() => handleDelete('training', t.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* Exams */}
      {activeTab === 'examinations' && (
        <SectionCard pad="none">
          <div className="p-6 border-b border-slate-50 dark:border-slate-800"><h3 className="text-base font-semibold text-slate-900 dark:text-white">Medical Examinations</h3></div>
          {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filteredExams.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400"><Heart className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No medical exams found.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Employee</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Type</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Last Exam</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Next Exam</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Result</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Status</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {filteredExams.map((e) => (
                    <tr key={e.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4 text-sm font-semibold text-slate-900 dark:text-white">{e.employee}</td>
                      <td className="px-6 py-4"><Badge tone="neutral">{e.exam_type || '—'}</Badge></td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500">{e.exam_date || '—'}</td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-500">{e.next_exam || '—'}</td>
                      <td className="px-6 py-4 text-xs font-bold text-slate-900 dark:text-white">{e.result || '—'}</td>
                      <td className="px-6 py-4 text-center"><Badge tone={EXAM_STATUS_TONE[e.status]}>{e.status}</Badge></td>
                      <td className="px-6 py-4"><div className="flex justify-center gap-2"><button onClick={() => openEdit('examinations', e)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button><button onClick={() => handleDelete('examinations', e.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* PPE & Risk */}
      {activeTab === 'ppe' && (
        <div className="grid lg:grid-cols-2 gap-6">
          <SectionCard>
            <div className="flex items-center justify-between mb-4"><h3 className="text-base font-semibold text-slate-900 dark:text-white">PPE Tracking</h3></div>
            {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filteredPpe.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400"><HardHat className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No PPE records found.</p></div>
            ) : (
              <div className="space-y-4">
                {filteredPpe.map((p) => (
                  <Card key={p.id} pad="sm">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-amber-100 dark:bg-amber-500/20 rounded-xl flex items-center justify-center">
                          <HardHat className="text-amber-600 dark:text-amber-400" size={20} />
                        </div>
                        <div>
                          <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{p.item}</h4>
                          <p className="text-xs font-medium text-slate-400">{p.category || '—'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge tone={PPE_STATUS_TONE[p.status]}>{p.status}</Badge>
                        <button onClick={() => openEdit('ppe', p)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                        <button onClick={() => handleDelete('ppe', p.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-xs">
                      <div><p className="text-xs font-medium text-slate-400 uppercase">Issued</p><p className="text-sm font-semibold text-slate-900 dark:text-white">{p.total_issued}</p></div>
                      <div><p className="text-xs font-medium text-slate-400 uppercase">In Use</p><p className="text-sm font-semibold text-slate-900 dark:text-white">{p.in_use}</p></div>
                      <div><p className="text-xs font-medium text-slate-400 uppercase">Replace</p><p className="text-sm font-semibold text-amber-600">{p.needs_replacement}</p></div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">Risk Assessments</h3>
              <button onClick={() => { setEditingId(null); setRiskForm({ area: '', hazardLevel: 'Low', lastAssessment: '', nextAssessment: '', status: 'Valid', controls: 0 }); setShowRisk(true); }} className={button.primary + ' text-xs'}><Plus size={14} /> New</button>
            </div>
            {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filteredRisks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400"><AlertTriangle className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No risk assessments found.</p></div>
            ) : (
              <div className="space-y-4">
                {filteredRisks.map((r) => (
                  <Card key={r.id} pad="sm">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${r.hazard_level === 'High' ? 'bg-rose-100 dark:bg-rose-500/20' : r.hazard_level === 'Medium' ? 'bg-amber-100 dark:bg-amber-500/20' : 'bg-emerald-100 dark:bg-emerald-500/20'}`}>
                          <AlertTriangle className={`${r.hazard_level === 'High' ? 'text-rose-600 dark:text-rose-400' : r.hazard_level === 'Medium' ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`} size={20} />
                        </div>
                        <div>
                          <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{r.area}</h4>
                          <p className="text-xs font-medium text-slate-400">{r.controls} controls in place</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge tone={HAZARD_TONE[r.hazard_level]}>{r.hazard_level}</Badge>
                        <button onClick={() => { setEditingId(r.id); setRiskForm({ area: r.area, hazardLevel: r.hazard_level, lastAssessment: r.last_assessment || '', nextAssessment: r.next_assessment || '', status: r.status, controls: r.controls }); setShowRisk(true); }} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                        <button onClick={() => handleDelete('risk', r.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                      </div>
                    </div>
                    <div className="flex justify-between text-xs"><span className="font-bold text-slate-400">Last Assessment</span><span className="font-semibold text-slate-900 dark:text-white">{r.last_assessment || '—'}</span></div>
                    <div className="flex justify-between text-[10px] mt-1"><span className="font-bold text-slate-400">Next Assessment</span><span className="font-semibold text-slate-900 dark:text-white">{r.next_assessment || '—'}</span></div>
                  </Card>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      )}

      {/* Main Modal */}
      <ModalSystem
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onConfirm={handleSave}
        title={editingId ? 'Edit' : 'Add'} variant="form" size="lg" confirmLabel={saving ? 'Saving…' : 'Save'} confirmColor="indigo" loading={saving}
      >
        {modalType === 'incidents' && (
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2"><Field label="Type"><input className={inputCls} value={incidentForm.type} onChange={(e) => setIncidentForm(f => ({ ...f, type: e.target.value }))} /></Field></div>
            <Field label="Severity">
              <select className={inputCls} value={incidentForm.severity} onChange={(e) => setIncidentForm(f => ({ ...f, severity: e.target.value as any }))}>
                {['Minor', 'Moderate', 'Major', 'Critical'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Location"><input className={inputCls} value={incidentForm.location} onChange={(e) => setIncidentForm(f => ({ ...f, location: e.target.value }))} /></Field>
            <Field label="Incident Date"><input type="date" className={inputCls} value={incidentForm.incidentDate} onChange={(e) => setIncidentForm(f => ({ ...f, incidentDate: e.target.value }))} /></Field>
            <Field label="Employee"><input className={inputCls} value={incidentForm.employee} onChange={(e) => setIncidentForm(f => ({ ...f, employee: e.target.value }))} /></Field>
            <Field label="Days Lost"><input type="number" className={inputCls} value={incidentForm.daysLost} onChange={(e) => setIncidentForm(f => ({ ...f, daysLost: Number(e.target.value) }))} /></Field>
            <Field label="Status">
              <select className={inputCls} value={incidentForm.status} onChange={(e) => setIncidentForm(f => ({ ...f, status: e.target.value as any }))}>
                {['Investigating', 'Closed', 'Open'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <div className="col-span-2"><Field label="Description"><textarea className={inputCls} rows={3} value={incidentForm.description} onChange={(e) => setIncidentForm(f => ({ ...f, description: e.target.value }))} /></Field></div>
          </div>
        )}
        {modalType === 'training' && (
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2"><Field label="Name"><input className={inputCls} value={trainingForm.name} onChange={(e) => setTrainingForm(f => ({ ...f, name: e.target.value }))} /></Field></div>
            <Field label="Type">
              <select className={inputCls} value={trainingForm.trainingType} onChange={(e) => setTrainingForm(f => ({ ...f, trainingType: e.target.value }))}>
                {['Mandatory', 'Role-Specific'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Category"><input className={inputCls} value={trainingForm.category} onChange={(e) => setTrainingForm(f => ({ ...f, category: e.target.value }))} /></Field>
            <Field label="Duration"><input className={inputCls} value={trainingForm.duration} onChange={(e) => setTrainingForm(f => ({ ...f, duration: e.target.value }))} /></Field>
            <Field label="Frequency"><input className={inputCls} value={trainingForm.frequency} onChange={(e) => setTrainingForm(f => ({ ...f, frequency: e.target.value }))} /></Field>
            <Field label="Last Completed"><input type="date" className={inputCls} value={trainingForm.lastCompleted} onChange={(e) => setTrainingForm(f => ({ ...f, lastCompleted: e.target.value }))} /></Field>
            <Field label="Next Due"><input type="date" className={inputCls} value={trainingForm.nextDue} onChange={(e) => setTrainingForm(f => ({ ...f, nextDue: e.target.value }))} /></Field>
            <Field label="Completion Rate"><input type="number" className={inputCls} value={trainingForm.completionRate} onChange={(e) => setTrainingForm(f => ({ ...f, completionRate: Number(e.target.value) }))} /></Field>
            <Field label="Total Employees"><input type="number" className={inputCls} value={trainingForm.totalEmployees} onChange={(e) => setTrainingForm(f => ({ ...f, totalEmployees: Number(e.target.value) }))} /></Field>
          </div>
        )}
        {modalType === 'examinations' && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Employee"><input className={inputCls} value={examForm.employee} onChange={(e) => setExamForm(f => ({ ...f, employee: e.target.value }))} /></Field>
            <Field label="Type"><input className={inputCls} value={examForm.examType} onChange={(e) => setExamForm(f => ({ ...f, examType: e.target.value }))} /></Field>
            <Field label="Last Exam"><input type="date" className={inputCls} value={examForm.examDate} onChange={(e) => setExamForm(f => ({ ...f, examDate: e.target.value }))} /></Field>
            <Field label="Next Exam"><input type="date" className={inputCls} value={examForm.nextExam} onChange={(e) => setExamForm(f => ({ ...f, nextExam: e.target.value }))} /></Field>
            <Field label="Result"><input className={inputCls} value={examForm.result} onChange={(e) => setExamForm(f => ({ ...f, result: e.target.value }))} /></Field>
            <Field label="Status">
              <select className={inputCls} value={examForm.status} onChange={(e) => setExamForm(f => ({ ...f, status: e.target.value as any }))}>
                {['Valid', 'Review Required', 'Expired'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
        )}
        {modalType === 'ppe' && (
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2"><Field label="Item"><input className={inputCls} value={ppeForm.item} onChange={(e) => setPpeForm(f => ({ ...f, item: e.target.value }))} /></Field></div>
            <Field label="Category"><input className={inputCls} value={ppeForm.category} onChange={(e) => setPpeForm(f => ({ ...f, category: e.target.value }))} /></Field>
            <Field label="Total Issued"><input type="number" className={inputCls} value={ppeForm.totalIssued} onChange={(e) => setPpeForm(f => ({ ...f, totalIssued: Number(e.target.value) }))} /></Field>
            <Field label="In Use"><input type="number" className={inputCls} value={ppeForm.inUse} onChange={(e) => setPpeForm(f => ({ ...f, inUse: Number(e.target.value) }))} /></Field>
            <Field label="Needs Replacement"><input type="number" className={inputCls} value={ppeForm.needsReplacement} onChange={(e) => setPpeForm(f => ({ ...f, needsReplacement: Number(e.target.value) }))} /></Field>
            <Field label="Last Inspection"><input type="date" className={inputCls} value={ppeForm.lastInspection} onChange={(e) => setPpeForm(f => ({ ...f, lastInspection: e.target.value }))} /></Field>
            <Field label="Status">
              <select className={inputCls} value={ppeForm.status} onChange={(e) => setPpeForm(f => ({ ...f, status: e.target.value }))}>
                {['Good', 'Fair', 'Low Stock', 'Out of Stock'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
        )}
      </ModalSystem>

      {/* Risk Modal */}
      <ModalSystem
        isOpen={showRisk}
        onClose={() => setShowRisk(false)}
        onConfirm={saveRisk}
        title={editingId ? 'Edit Risk Assessment' : 'New Risk Assessment'}
        variant="form"
        size="md"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><Field label="Area"><input className={inputCls} value={riskForm.area} onChange={(e) => setRiskForm(f => ({ ...f, area: e.target.value }))} /></Field></div>
          <Field label="Hazard Level">
            <select className={inputCls} value={riskForm.hazardLevel} onChange={(e) => setRiskForm(f => ({ ...f, hazardLevel: e.target.value as any }))}>
              {['Low', 'Medium', 'High'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className={inputCls} value={riskForm.status} onChange={(e) => setRiskForm(f => ({ ...f, status: e.target.value as any }))}>
              {['Valid', 'Review Required'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Controls"><input type="number" className={inputCls} value={riskForm.controls} onChange={(e) => setRiskForm(f => ({ ...f, controls: Number(e.target.value) }))} /></Field>
          <Field label="Last Assessment"><input type="date" className={inputCls} value={riskForm.lastAssessment} onChange={(e) => setRiskForm(f => ({ ...f, lastAssessment: e.target.value }))} /></Field>
          <Field label="Next Assessment"><input type="date" className={inputCls} value={riskForm.nextAssessment} onChange={(e) => setRiskForm(f => ({ ...f, nextAssessment: e.target.value }))} /></Field>
        </div>
      </ModalSystem>
    </div>
  );
};

export default HealthSafety;
