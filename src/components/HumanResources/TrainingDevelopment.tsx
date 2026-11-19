/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HR Training & Development — enterprise learning calendar and certification
 * compliance.
 *
 * DB-integrated via /api/hr-portal/training/* routes. Uses tables from
 * migration 426.
 *
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  GraduationCap,
  BookOpen,
  Calendar,
  Trophy,
  Plus,
  Pencil,
  Trash2,
  Search,
  CheckCircle2,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge, Card } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';

interface TrainingSession {
  id: string;
  title: string;
  type: string;
  staff_count: number;
  session_date: string | null;
  status: string;
}

interface Certification {
  id: string;
  label: string;
  status_text: string;
  rate: number | null;
  target: number | null;
  color: string | null;
}

interface Stats {
  coursesActive: number;
  coursesCompleted: number;
  staffCertified: number;
  certificationsDue: number;
  skillsIndex: string;
  sessionCount: number;
  certCount: number;
}

const STATUS_TONE: Record<string, statusTone.StatusTone> = {
  Upcoming: 'warning',
  Open: 'success',
  Full: 'danger',
  Completed: 'accent',
  Cancelled: 'neutral',
};

const CERT_COLOR_TONE: Record<string, statusTone.StatusTone> = {
  emerald: 'success',
  rose: 'danger',
  indigo: 'accent',
  amber: 'warning',
  blue: 'info',
};

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

const TrainingDevelopment = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [stats, setStats] = useState<Stats>({ coursesActive: 0, coursesCompleted: 0, staffCertified: 0, certificationsDue: 0, skillsIndex: '0.0/5', sessionCount: 0, certCount: 0 });
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [certifications, setCertifications] = useState<Certification[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  const [showSessionModal, setShowSessionModal] = useState(false);
  const [sessionForm, setSessionForm] = useState({ title: '', type: 'Soft Skills', staffCount: 0, sessionDate: '', status: 'Upcoming' });
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);

  const [showCertModal, setShowCertModal] = useState(false);
  const [certForm, setCertForm] = useState({ label: '', statusText: '', rate: '', target: '', color: 'emerald' });
  const [editingCertId, setEditingCertId] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/training/statistics/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setStats(await res.json());
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchSessions = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'All') params.append('status', statusFilter);
      const res = await fetch(`/api/hr-portal/training/sessions/${currentPropertyId}?${params.toString()}`, { headers: authHeaders() });
      if (res.ok) setSessions(((await res.json()) as { sessions: TrainingSession[] }).sessions || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId, statusFilter]);

  const fetchCertifications = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/training/certifications/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setCertifications(((await res.json()) as { certifications: Certification[] }).certifications || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchStats(), fetchSessions(), fetchCertifications()]);
    setLoading(false);
  }, [fetchStats, fetchSessions, fetchCertifications]);

  useEffect(() => { if (currentPropertyId) refresh(); }, [currentPropertyId]);
  useEffect(() => { if (currentPropertyId) { fetchSessions(); fetchStats(); } }, [statusFilter]);

  const filteredSessions = useMemo(() => {
    if (!search.trim()) return sessions;
    const q = search.toLowerCase();
    return sessions.filter((s) => s.title.toLowerCase().includes(q) || s.type.toLowerCase().includes(q) || s.status.toLowerCase().includes(q));
  }, [sessions, search]);

  const openCreateSession = () => {
    setEditingSessionId(null);
    setSessionForm({ title: '', type: 'Soft Skills', staffCount: 0, sessionDate: new Date().toISOString().slice(0, 10), status: 'Upcoming' });
    setShowSessionModal(true);
  };

  const openEditSession = (s: TrainingSession) => {
    setEditingSessionId(s.id);
    setSessionForm({ title: s.title, type: s.type, staffCount: Number(s.staff_count), sessionDate: s.session_date || '', status: s.status });
    setShowSessionModal(true);
  };

  const saveSession = async () => {
    if (!currentPropertyId || !sessionForm.title || !sessionForm.type) return;
    setSaving(true);
    try {
      const body = { propertyId: currentPropertyId, title: sessionForm.title, type: sessionForm.type, staffCount: sessionForm.staffCount, sessionDate: sessionForm.sessionDate, status: sessionForm.status };
      const endpoint = editingSessionId ? `/api/hr-portal/training/sessions/${editingSessionId}` : '/api/hr-portal/training/sessions';
      const method = editingSessionId ? 'PUT' : 'POST';
      const res = await fetch(endpoint, { method, headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Session saved', 'success', 'HR');
      setShowSessionModal(false); refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const deleteSession = async (id: string) => {
    if (!confirm('Delete this session?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/training/sessions/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Deleted', 'success', 'HR');
      refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const openCreateCert = () => {
    setEditingCertId(null);
    setCertForm({ label: '', statusText: '', rate: '', target: '', color: 'emerald' });
    setShowCertModal(true);
  };

  const openEditCert = (c: Certification) => {
    setEditingCertId(c.id);
    setCertForm({ label: c.label, statusText: c.status_text, rate: c.rate != null ? String(c.rate) : '', target: c.target != null ? String(c.target) : '', color: c.color || 'emerald' });
    setShowCertModal(true);
  };

  const saveCert = async () => {
    if (!currentPropertyId || !certForm.label || !certForm.statusText) return;
    setSaving(true);
    try {
      const body = { propertyId: currentPropertyId, label: certForm.label, statusText: certForm.statusText, rate: certForm.rate, target: certForm.target, color: certForm.color };
      const endpoint = editingCertId ? `/api/hr-portal/training/certifications/${editingCertId}` : '/api/hr-portal/training/certifications';
      const method = editingCertId ? 'PUT' : 'POST';
      const res = await fetch(endpoint, { method, headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Certification saved', 'success', 'HR');
      setShowCertModal(false); refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const deleteCert = async (id: string) => {
    if (!confirm('Delete this certification?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/training/certifications/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Deleted', 'success', 'HR');
      refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    const date = new Date(d);
    return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
  };

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Training & Development" subtitle="Manage learning calendar and certification compliance" icon={GraduationCap} />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <GraduationCap className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">Select a property to view training data.</p>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Training & Development"
        subtitle="Manage learning calendar and certification compliance"
        icon={GraduationCap}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refresh} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={openCreateSession} className={button.primary}><Plus className="w-4 h-4" /> Create Session</button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Courses Active" value={String(stats.coursesActive)} caption="Last 30 days" icon={BookOpen} tone="accent" />
        <StatCard title="Staff Certified" value={String(stats.staffCertified)} caption="Total growth" icon={GraduationCap} tone="success" />
        <StatCard title="Certifications Due" value={String(stats.certificationsDue)} caption="Action required" icon={Calendar} tone="danger" />
        <StatCard title="Skills Index" value={stats.skillsIndex} caption="Benchmarked" icon={Trophy} tone="warning" />
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        {/* Learning Calendar */}
        <SectionCard className="lg:col-span-8" pad="none">
          <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex flex-col md:flex-row md:items-center gap-4 justify-between">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Enterprise Learning Calendar</h3>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                <input type="text" placeholder="Search sessions..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-48 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans" />
              </div>
              <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2">
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-transparent text-xs text-slate-700 dark:text-slate-300 outline-none">
                  {['All', 'Upcoming', 'Open', 'Full', 'Completed', 'Cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </div>

          {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filteredSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <BookOpen className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No training sessions found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Training Subject</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Category</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Attendees</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Scheduled</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Status</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {filteredSessions.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4 text-sm font-semibold text-slate-900 dark:text-white">{s.title}</td>
                      <td className="px-6 py-4 text-center"><Badge tone="neutral">{s.type}</Badge></td>
                      <td className="px-6 py-4 text-center text-sm font-medium text-slate-900 dark:text-white">{s.staff_count} staff</td>
                      <td className="px-6 py-4 text-center font-mono text-xs font-bold text-slate-600">{formatDate(s.session_date)}</td>
                      <td className="px-6 py-4 text-center"><Badge tone={STATUS_TONE[s.status] ?? 'neutral'}>{s.status}</Badge></td>
                      <td className="px-6 py-4">
                        <div className="flex justify-center gap-2">
                          <button onClick={() => openEditSession(s)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                          <button onClick={() => deleteSession(s.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        {/* Certification Compliance */}
        <SectionCard className="lg:col-span-4" pad="md">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Certification Compliance</h3>
            <button onClick={openCreateCert} className={button.primary + ' text-xs'}><Plus size={14} /> Add</button>
          </div>
          {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : certifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <CheckCircle2 className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No certifications found.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {certifications.map((c) => {
                const tone = CERT_COLOR_TONE[c.color || ''] ?? 'neutral';
                const isCompliant = c.rate != null && c.target != null && c.rate >= c.target;
                return (
                  <Card key={c.id} pad="sm">
                    <div className="flex justify-between items-center group cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 p-2 rounded-xl transition-all">
                      <div>
                        <h5 className="text-xs font-medium text-slate-900 dark:text-white uppercase">{c.label}</h5>
                        <Badge tone={tone}>{c.status_text}</Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 size={16} className={isCompliant ? 'text-emerald-500' : 'text-slate-300'} />
                        <button onClick={() => openEditCert(c)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                        <button onClick={() => deleteCert(c.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                      </div>
                    </div>
                  </Card>
                );
              })}
              <button className="w-full mt-4 py-3 bg-slate-900 dark:bg-white text-white dark:text-slate-950 rounded-xl text-sm font-medium hover:opacity-90 transition">Learning Center Access</button>
            </div>
          )}
        </SectionCard>
      </div>

      {/* Session Modal */}
      <ModalSystem
        isOpen={showSessionModal}
        onClose={() => setShowSessionModal(false)}
        onConfirm={saveSession}
        title={editingSessionId ? 'Edit Training Session' : 'Create Training Session'}
        variant="form"
        size="md"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><Field label="Title"><input className={inputCls} value={sessionForm.title} onChange={(e) => setSessionForm(f => ({ ...f, title: e.target.value }))} /></Field></div>
          <Field label="Category"><input className={inputCls} value={sessionForm.type} onChange={(e) => setSessionForm(f => ({ ...f, type: e.target.value }))} /></Field>
          <Field label="Attendees"><input type="number" className={inputCls} value={sessionForm.staffCount} onChange={(e) => setSessionForm(f => ({ ...f, staffCount: Number(e.target.value) }))} /></Field>
          <Field label="Scheduled Date"><input type="date" className={inputCls} value={sessionForm.sessionDate} onChange={(e) => setSessionForm(f => ({ ...f, sessionDate: e.target.value }))} /></Field>
          <Field label="Status">
            <select className={inputCls} value={sessionForm.status} onChange={(e) => setSessionForm(f => ({ ...f, status: e.target.value }))}>
              {['Upcoming', 'Open', 'Full', 'Completed', 'Cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
      </ModalSystem>

      {/* Certification Modal */}
      <ModalSystem
        isOpen={showCertModal}
        onClose={() => setShowCertModal(false)}
        onConfirm={saveCert}
        title={editingCertId ? 'Edit Certification' : 'Add Certification'}
        variant="form"
        size="md"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><Field label="Label"><input className={inputCls} value={certForm.label} onChange={(e) => setCertForm(f => ({ ...f, label: e.target.value }))} /></Field></div>
          <Field label="Status Text"><input className={inputCls} value={certForm.statusText} onChange={(e) => setCertForm(f => ({ ...f, statusText: e.target.value }))} /></Field>
          <Field label="Color">
            <select className={inputCls} value={certForm.color} onChange={(e) => setCertForm(f => ({ ...f, color: e.target.value }))}>
              {['emerald', 'rose', 'indigo', 'amber', 'blue'].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Rate (%)"><input type="number" className={inputCls} value={certForm.rate} onChange={(e) => setCertForm(f => ({ ...f, rate: e.target.value }))} /></Field>
          <Field label="Target (%)"><input type="number" className={inputCls} value={certForm.target} onChange={(e) => setCertForm(f => ({ ...f, target: e.target.value }))} /></Field>
        </div>
      </ModalSystem>
    </div>
  );
};

export default TrainingDevelopment;
