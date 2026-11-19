/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HR Workflow & Approvals — pending, approved, rejected requests and workflow
 * templates.
 *
 * DB-integrated via /api/hr-portal/workflow/* routes. Uses tables from
 * migration 431.
 *
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CheckCircle2,
  Clock,
  Users,
  DollarSign,
  Briefcase,
  TrendingUp,
  Calendar,
  CreditCard,
  Search,
  MoreVertical,
  FileText,
  Plus,
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

type Tab = 'pending' | 'approved' | 'rejected' | 'history';

interface ApprovalRequest {
  id: string;
  request_type: string;
  category: string | null;
  employee: string;
  department: string | null;
  details: string | null;
  submitted_date: string | null;
  priority: 'High' | 'Normal' | 'Low';
  current_approver: string | null;
  workflow_stage: string | null;
  request_status: 'Pending' | 'Approved' | 'Rejected';
  approved_date: string | null;
  approved_by: string | null;
  comments: string | null;
  rejected_date: string | null;
  rejected_by: string | null;
  reason: string | null;
}

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string | null;
  stages: string[];
  average_duration: string | null;
  is_active: boolean;
}

interface Stats {
  pendingApprovals: number;
  approvedToday: number;
  rejectedToday: number;
  avgApprovalTime: string;
}

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'pending', label: 'Pending', icon: Clock },
  { id: 'approved', label: 'Approved', icon: CheckCircle2 },
  { id: 'rejected', label: 'Rejected', icon: TrendingUp },
  { id: 'history', label: 'Workflows', icon: FileText },
];

const CATEGORY_ICONS: Record<string, any> = {
  Leave: Calendar, Time: Clock, Finance: DollarSign, Compensation: TrendingUp,
  Recruitment: Briefcase, Learning: FileText, default: FileText,
};

const CATEGORY_COLORS: Record<string, string> = {
  Leave: 'text-indigo-500', Time: 'text-amber-500', Finance: 'text-emerald-500',
  Compensation: 'text-purple-500', Recruitment: 'text-blue-500', Learning: 'text-rose-500',
  default: 'text-slate-500',
};

const PRIORITY_TONE: Record<string, statusTone.StatusTone> = { High: 'danger', Normal: 'neutral', Low: 'success' };

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

const WorkflowApprovals = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [activeTab, setActiveTab] = useState<Tab>('pending');
  const [stats, setStats] = useState<Stats>({ pendingApprovals: 0, approvedToday: 0, rejectedToday: 0, avgApprovalTime: '0' });
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<'request' | 'workflow'>('request');
  const [editingId, setEditingId] = useState<string | null>(null);

  const [requestForm, setRequestForm] = useState({
    requestType: '', category: '', employee: '', department: '', details: '',
    submittedDate: new Date().toISOString().slice(0, 10), priority: 'Normal' as 'High' | 'Normal' | 'Low',
    currentApprover: '', workflowStage: '',
  });

  const [workflowForm, setWorkflowForm] = useState({
    name: '', description: '', stages: '', averageDuration: '', isActive: true,
  });

  const fetchStats = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/workflow/statistics/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setStats(await res.json());
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchRequests = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/workflow/requests/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setRequests(((await res.json()) as { requests: ApprovalRequest[] }).requests || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchTemplates = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/workflow/templates/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setTemplates(((await res.json()) as { templates: WorkflowTemplate[] }).templates || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchStats(), fetchRequests(), fetchTemplates()]);
    setLoading(false);
  }, [fetchStats, fetchRequests, fetchTemplates]);

  useEffect(() => { if (currentPropertyId) refresh(); }, [currentPropertyId]);

  const openCreateRequest = () => {
    setModalType('request'); setEditingId(null);
    setRequestForm({
      requestType: '', category: '', employee: '', department: '', details: '',
      submittedDate: new Date().toISOString().slice(0, 10), priority: 'Normal',
      currentApprover: '', workflowStage: '',
    });
    setShowModal(true);
  };

  const openCreateWorkflow = () => {
    setModalType('workflow'); setEditingId(null);
    setWorkflowForm({ name: '', description: '', stages: '', averageDuration: '', isActive: true });
    setShowModal(true);
  };

  const openEditRequest = (r: ApprovalRequest) => {
    setModalType('request'); setEditingId(r.id);
    setRequestForm({
      requestType: r.request_type, category: r.category || '', employee: r.employee,
      department: r.department || '', details: r.details || '',
      submittedDate: r.submitted_date || '', priority: r.priority,
      currentApprover: r.current_approver || '', workflowStage: r.workflow_stage || '',
    });
    setShowModal(true);
  };

  const openEditWorkflow = (w: WorkflowTemplate) => {
    setModalType('workflow'); setEditingId(w.id);
    setWorkflowForm({
      name: w.name, description: w.description || '',
      stages: (w.stages || []).join(', '), averageDuration: w.average_duration || '',
      isActive: w.is_active,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      let endpoint = '';
      let method: 'POST' | 'PUT' = 'POST';
      let body: any = { propertyId: currentPropertyId };

      if (modalType === 'request') {
        endpoint = editingId ? `/api/hr-portal/workflow/requests/${editingId}` : '/api/hr-portal/workflow/requests';
        method = editingId ? 'PUT' : 'POST';
        body = { ...body, ...requestForm, requestType: requestForm.requestType, submittedDate: requestForm.submittedDate };
      } else {
        endpoint = editingId ? `/api/hr-portal/workflow/templates/${editingId}` : '/api/hr-portal/workflow/templates';
        method = editingId ? 'PUT' : 'POST';
        body = { ...body, name: workflowForm.name, description: workflowForm.description, stages: workflowForm.stages.split(',').map(s => s.trim()).filter(Boolean), averageDuration: workflowForm.averageDuration, isActive: workflowForm.isActive };
      }

      const res = await fetch(endpoint, { method, headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Saved', 'success', 'HR');
      setShowModal(false); refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const handleApprove = async (id: string, comments: string) => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/workflow/requests/${id}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({
          requestStatus: 'Approved',
          approvedDate: new Date().toISOString().slice(0, 10),
          approvedBy: 'Current User',
          comments,
        }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Approved', 'success', 'HR');
      refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const handleReject = async (id: string, reason: string) => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/workflow/requests/${id}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({
          requestStatus: 'Rejected',
          rejectedDate: new Date().toISOString().slice(0, 10),
          rejectedBy: 'Current User',
          reason,
        }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Rejected', 'success', 'HR');
      refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const handleDelete = async (type: 'request' | 'workflow', id: string) => {
    if (!confirm('Delete this record?')) return;
    setSaving(true);
    const endpoint = type === 'request' ? `/api/hr-portal/workflow/requests/${id}` : `/api/hr-portal/workflow/templates/${id}`;
    try {
      const res = await fetch(endpoint, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Deleted', 'success', 'HR');
      refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const filteredRequests = useMemo(() => {
    const byStatus = requests.filter((r) => r.request_status.toLowerCase() === activeTab);
    if (!search.trim()) return byStatus;
    const q = search.toLowerCase();
    return byStatus.filter((r) => r.employee.toLowerCase().includes(q) || r.request_type.toLowerCase().includes(q) || (r.details || '').toLowerCase().includes(q));
  }, [requests, activeTab, search]);

  const filteredTemplates = useMemo(() => {
    if (activeTab !== 'history') return [];
    if (!search.trim()) return templates;
    const q = search.toLowerCase();
    return templates.filter((w) => w.name.toLowerCase().includes(q) || (w.description || '').toLowerCase().includes(q));
  }, [templates, activeTab, search]);

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Workflow & Approvals" subtitle="Manage approval workflows and track request status" icon={Users} />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Users className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">Select a property to view workflow data.</p>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Workflow & Approvals"
        subtitle="Manage approval workflows and track request status"
        icon={Users}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refresh} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={activeTab === 'history' ? openCreateWorkflow : openCreateRequest} className={button.primary}><Plus className="w-4 h-4" /> {activeTab === 'history' ? 'Create Workflow' : 'New Request'}</button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Pending Approvals" value={String(stats.pendingApprovals)} caption="Awaiting action" icon={Clock} tone="warning" />
        <StatCard title="Approved Today" value={String(stats.approvedToday)} caption="Requests" icon={CheckCircle2} tone="success" />
        <StatCard title="Rejected Today" value={String(stats.rejectedToday)} caption="Requests" icon={TrendingUp} tone="danger" />
        <StatCard title="Avg. Approval Time" value={`${stats.avgApprovalTime}d`} caption="Workflows" icon={TrendingUp} tone="accent" />
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

      {/* Pending / Approved / Rejected */}
      {activeTab !== 'history' && (
        <SectionCard pad="none">
          <div className="p-6 border-b border-slate-50 dark:border-slate-800">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white capitalize">{activeTab} Requests</h3>
          </div>
          {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filteredRequests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400"><Clock className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No {activeTab} requests found.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Type</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Employee</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Details</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500">Submitted</th>
                    {activeTab === 'pending' && <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Priority</th>}
                    {activeTab === 'pending' && <th className="px-6 py-4 text-xs font-medium text-slate-500">Current Stage</th>}
                    {activeTab === 'approved' && <th className="px-6 py-4 text-xs font-medium text-slate-500">Approved Date</th>}
                    {activeTab === 'approved' && <th className="px-6 py-4 text-xs font-medium text-slate-500">Approved By</th>}
                    {activeTab === 'approved' && <th className="px-6 py-4 text-xs font-medium text-slate-500">Comments</th>}
                    {activeTab === 'rejected' && <th className="px-6 py-4 text-xs font-medium text-slate-500">Rejected Date</th>}
                    {activeTab === 'rejected' && <th className="px-6 py-4 text-xs font-medium text-slate-500">Rejected By</th>}
                    {activeTab === 'rejected' && <th className="px-6 py-4 text-xs font-medium text-slate-500">Reason</th>}
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {filteredRequests.map((r) => {
                    const CategoryIcon = CATEGORY_ICONS[r.category || 'default'] || FileText;
                    const catColor = CATEGORY_COLORS[r.category || 'default'] || 'text-slate-500';
                    return (
                      <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-slate-100 dark:bg-slate-800 ${catColor}`}>
                              <CategoryIcon size={16} />
                            </div>
                            <span className="text-sm font-semibold text-slate-900 dark:text-white">{r.request_type}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div>
                            <span className="text-sm font-semibold text-slate-900 dark:text-white block">{r.employee}</span>
                            <span className="text-xs font-medium text-slate-400">{r.department || '—'}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm font-medium text-slate-500 max-w-xs truncate">{r.details || '—'}</td>
                        <td className="px-6 py-4 text-sm font-medium text-slate-500">{r.submitted_date || '—'}</td>
                        {activeTab === 'pending' && <td className="px-6 py-4 text-center"><Badge tone={PRIORITY_TONE[r.priority]}>{r.priority}</Badge></td>}
                        {activeTab === 'pending' && (
                          <td className="px-6 py-4">
                            <div>
                              <span className="text-sm font-semibold text-slate-900 dark:text-white block">{r.workflow_stage || '—'}</span>
                              <span className="text-xs font-medium text-slate-400">{r.current_approver || '—'}</span>
                            </div>
                          </td>
                        )}
                        {activeTab === 'approved' && (
                          <>
                            <td className="px-6 py-4 text-sm font-medium text-slate-500">{r.approved_date || '—'}</td>
                            <td className="px-6 py-4 text-sm font-medium text-slate-500">{r.approved_by || '—'}</td>
                            <td className="px-6 py-4 text-sm font-medium text-slate-500 max-w-xs truncate">{r.comments || '—'}</td>
                          </>
                        )}
                        {activeTab === 'rejected' && (
                          <>
                            <td className="px-6 py-4 text-sm font-medium text-slate-500">{r.rejected_date || '—'}</td>
                            <td className="px-6 py-4 text-sm font-medium text-slate-500">{r.rejected_by || '—'}</td>
                            <td className="px-6 py-4 text-xs font-bold text-rose-600 max-w-xs truncate">{r.reason || '—'}</td>
                          </>
                        )}
                        <td className="px-6 py-4">
                          <div className="flex justify-center gap-2">
                            {activeTab === 'pending' && (
                              <>
                                <button onClick={() => handleApprove(r.id, 'Approved via ERP')} className="p-1.5 bg-emerald-500 text-white rounded-lg hover:shadow-md transition"><CheckCircle2 size={14} /></button>
                                <button onClick={() => handleReject(r.id, 'Rejected via ERP')} className="p-1.5 bg-rose-500 text-white rounded-lg hover:shadow-md transition"><TrendingUp size={14} /></button>
                              </>
                            )}
                            <button onClick={() => openEditRequest(r)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                            <button onClick={() => handleDelete('request', r.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* Workflows */}
      {activeTab === 'history' && (
        <SectionCard>
          <div className="mb-4"><h3 className="text-base font-semibold text-slate-900 dark:text-white">Workflow Templates</h3></div>
          {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filteredTemplates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400"><FileText className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No workflow templates found.</p></div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTemplates.map((w) => (
                <Card key={w.id} pad="md">
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-500/20 rounded-xl flex items-center justify-center">
                      <FileText className="text-indigo-600 dark:text-indigo-400" size={20} />
                    </div>
                    <Badge tone={w.is_active ? 'success' : 'neutral'}>{w.is_active ? 'Active' : 'Inactive'}</Badge>
                  </div>
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">{w.name}</h4>
                  <p className="text-xs font-medium text-slate-400 mb-3">{w.description || '—'}</p>
                  <div className="flex justify-between text-xs mb-3">
                    <span className="font-bold text-slate-400">Avg. Duration</span>
                    <span className="font-semibold text-slate-900 dark:text-white">{w.average_duration || '—'}</span>
                  </div>
                  <div className="pt-3 border-t border-slate-200 dark:border-slate-700">
                    <p className="text-xs font-medium text-slate-400 mb-2">Workflow Stages</p>
                    <div className="flex flex-wrap gap-1">
                      {(w.stages || []).map((stage, index) => <span key={index} className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded text-xs font-medium uppercase">{stage}</span>)}
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 mt-3">
                    <button onClick={() => openEditWorkflow(w)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                    <button onClick={() => handleDelete('workflow', w.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* Modal */}
      <ModalSystem
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onConfirm={handleSave}
        title={modalType === 'request' ? (editingId ? 'Edit Request' : 'New Request') : (editingId ? 'Edit Workflow' : 'Create Workflow')}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        {modalType === 'request' ? (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Request Type"><input className={inputCls} value={requestForm.requestType} onChange={(e) => setRequestForm(f => ({ ...f, requestType: e.target.value }))} /></Field>
            <Field label="Category"><input className={inputCls} value={requestForm.category} onChange={(e) => setRequestForm(f => ({ ...f, category: e.target.value }))} /></Field>
            <Field label="Employee"><input className={inputCls} value={requestForm.employee} onChange={(e) => setRequestForm(f => ({ ...f, employee: e.target.value }))} /></Field>
            <Field label="Department"><input className={inputCls} value={requestForm.department} onChange={(e) => setRequestForm(f => ({ ...f, department: e.target.value }))} /></Field>
            <Field label="Submitted Date"><input type="date" className={inputCls} value={requestForm.submittedDate} onChange={(e) => setRequestForm(f => ({ ...f, submittedDate: e.target.value }))} /></Field>
            <Field label="Priority">
              <select className={inputCls} value={requestForm.priority} onChange={(e) => setRequestForm(f => ({ ...f, priority: e.target.value as any }))}>
                {['High', 'Normal', 'Low'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Current Stage"><input className={inputCls} value={requestForm.workflowStage} onChange={(e) => setRequestForm(f => ({ ...f, workflowStage: e.target.value }))} /></Field>
            <Field label="Current Approver"><input className={inputCls} value={requestForm.currentApprover} onChange={(e) => setRequestForm(f => ({ ...f, currentApprover: e.target.value }))} /></Field>
            <div className="col-span-2"><Field label="Details"><textarea className={inputCls} rows={3} value={requestForm.details} onChange={(e) => setRequestForm(f => ({ ...f, details: e.target.value }))} /></Field></div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2"><Field label="Name"><input className={inputCls} value={workflowForm.name} onChange={(e) => setWorkflowForm(f => ({ ...f, name: e.target.value }))} /></Field></div>
            <div className="col-span-2"><Field label="Description"><textarea className={inputCls} rows={2} value={workflowForm.description} onChange={(e) => setWorkflowForm(f => ({ ...f, description: e.target.value }))} /></Field></div>
            <Field label="Stages (comma separated)"><input className={inputCls} value={workflowForm.stages} onChange={(e) => setWorkflowForm(f => ({ ...f, stages: e.target.value }))} /></Field>
            <Field label="Average Duration"><input className={inputCls} value={workflowForm.averageDuration} onChange={(e) => setWorkflowForm(f => ({ ...f, averageDuration: e.target.value }))} /></Field>
            <Field label="Status">
              <select className={inputCls} value={String(workflowForm.isActive)} onChange={(e) => setWorkflowForm(f => ({ ...f, isActive: e.target.value === 'true' }))}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </Field>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default WorkflowApprovals;
