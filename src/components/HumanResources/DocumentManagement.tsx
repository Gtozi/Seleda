/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HR Document Management — contracts, personal documents, certifications, and
 * payroll records.
 *
 * DB-integrated via /api/hr-portal/documents/* routes. Uses the hr_documents
 * table from migration 430.
 *
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  FileText,
  Upload,
  Search,
  FolderOpen,
  Shield,
  Calendar,
  AlertCircle,
  Pencil,
  Trash2,
  Loader2,
  RefreshCw,
  Plus,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';

type Tab = 'contracts' | 'personal' | 'certifications' | 'payroll';

interface HRDocument {
  id: string;
  doc_type: 'contract' | 'personal' | 'certification' | 'payroll';
  employee: string | null;
  document_name: string;
  category: string | null;
  document_number: string | null;
  start_date: string | null;
  end_date: string | null;
  issued_date: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  generated_date: string | null;
  version: string | null;
  status: string;
  last_updated: string | null;
  period: string | null;
  issuing_organization: string | null;
  file_url: string | null;
}

interface Stats {
  totalDocuments: number;
  expiringSoon: number;
  expired: number;
  thisMonth: number;
}

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'contracts', label: 'Contracts', icon: FileText },
  { id: 'personal', label: 'Personal Docs', icon: FolderOpen },
  { id: 'certifications', label: 'Certifications', icon: Shield },
  { id: 'payroll', label: 'Payroll Docs', icon: Calendar },
];

const DOC_STATUS_TONE: Record<string, statusTone.StatusTone> = {
  'Active': 'success', 'Renewed': 'accent', 'Valid': 'success', 'Expiring Soon': 'warning',
  'Expired': 'danger', 'Available': 'success', 'Archived': 'neutral',
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

const DocumentManagement = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [activeTab, setActiveTab] = useState<Tab>('contracts');
  const [stats, setStats] = useState<Stats>({ totalDocuments: 0, expiringSoon: 0, expired: 0, thisMonth: 0 });
  const [documents, setDocuments] = useState<HRDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [form, setForm] = useState<Record<string, any>>({
    employee: '', documentName: '', category: '', documentNumber: '',
    startDate: '', endDate: '', issuedDate: '', issueDate: '', expiryDate: '',
    generatedDate: '', version: '', status: 'Active', period: '',
    issuingOrganization: '', fileUrl: '',
  });

  const fetchStats = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/documents/statistics/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setStats(await res.json());
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchDocuments = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/documents/${activeTab}/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setDocuments(((await res.json()) as { documents: HRDocument[] }).documents || []);
    } catch { /* non-fatal */ }
  }, [currentPropertyId, activeTab]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchStats(), fetchDocuments()]);
    setLoading(false);
  }, [fetchStats, fetchDocuments]);

  useEffect(() => { if (currentPropertyId) refresh(); }, [currentPropertyId, activeTab]);

  const openCreate = () => {
    setEditingId(null);
    setForm({
      employee: '', documentName: '', category: '', documentNumber: '',
      startDate: '', endDate: '', issuedDate: '', issueDate: '', expiryDate: '',
      generatedDate: '', version: '', status: 'Active', period: '',
      issuingOrganization: '', fileUrl: '',
    });
    setShowModal(true);
  };

  const openEdit = (doc: HRDocument) => {
    setEditingId(doc.id);
    setForm({
      employee: doc.employee || '', documentName: doc.document_name, category: doc.category || '',
      documentNumber: doc.document_number || '', startDate: doc.start_date || '',
      endDate: doc.end_date || '', issuedDate: doc.issued_date || '',
      issueDate: doc.issue_date || '', expiryDate: doc.expiry_date || '',
      generatedDate: doc.generated_date || '', version: doc.version || '',
      status: doc.status, period: doc.period || '',
      issuingOrganization: doc.issuing_organization || '', fileUrl: doc.file_url || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      const endpoint = editingId ? `/api/hr-portal/documents/${editingId}` : '/api/hr-portal/documents/';
      const method = editingId ? 'PUT' : 'POST';
      const body = {
        propertyId: currentPropertyId,
        docType: activeTab,
        employee: form.employee,
        documentName: form.documentName,
        category: form.category,
        documentNumber: form.documentNumber,
        startDate: form.startDate,
        endDate: form.endDate,
        issuedDate: form.issuedDate,
        issueDate: form.issueDate,
        expiryDate: form.expiryDate,
        generatedDate: form.generatedDate,
        version: form.version,
        status: form.status,
        period: form.period,
        issuingOrganization: form.issuingOrganization,
        fileUrl: form.fileUrl,
      };

      const res = await fetch(endpoint, { method, headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Saved', 'success', 'HR');
      setShowModal(false); refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this document?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/documents/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Deleted', 'success', 'HR');
      refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return documents;
    const q = search.toLowerCase();
    return documents.filter((d) =>
      d.document_name.toLowerCase().includes(q) ||
      (d.employee || '').toLowerCase().includes(q) ||
      (d.category || '').toLowerCase().includes(q) ||
      (d.document_number || '').toLowerCase().includes(q)
    );
  }, [documents, search]);

  const tabLabel = activeTab === 'contracts' ? 'New Contract' : activeTab === 'personal' ? 'New Document' : activeTab === 'certifications' ? 'Add Certification' : 'Generate Report';

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Document Management" subtitle="Manage contracts, personal documents, certifications, and payroll records" icon={FileText} />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <FileText className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">Select a property to view documents.</p>
          </div>
        </SectionCard>
      </div>
    );
  }

  const columns = activeTab === 'contracts' ? [
    { key: 'employee', label: 'Employee' },
    { key: 'document_name', label: 'Type' },
    { key: 'start_date', label: 'Start Date' },
    { key: 'end_date', label: 'End Date' },
    { key: 'version', label: 'Version' },
  ] : activeTab === 'personal' ? [
    { key: 'employee', label: 'Employee' },
    { key: 'document_name', label: 'Type' },
    { key: 'document_number', label: 'Document Number' },
    { key: 'issued_date', label: 'Issue Date' },
    { key: 'expiry_date', label: 'Expiry Date' },
  ] : activeTab === 'certifications' ? [
    { key: 'employee', label: 'Employee' },
    { key: 'document_name', label: 'Certification' },
    { key: 'issuing_organization', label: 'Issuing Org' },
    { key: 'issue_date', label: 'Issue Date' },
    { key: 'expiry_date', label: 'Expiry Date' },
  ] : [
    { key: 'employee', label: 'Employee' },
    { key: 'document_name', label: 'Type' },
    { key: 'period', label: 'Period' },
    { key: 'generated_date', label: 'Generated' },
    { key: 'category', label: 'Category' },
  ];

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Document Management"
        subtitle="Manage contracts, personal documents, certifications, and payroll records"
        icon={FileText}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refresh} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={openCreate} className={button.primary}><Plus className="w-4 h-4" /> {tabLabel}</button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Documents" value={String(stats.totalDocuments)} caption="In system" icon={FileText} tone="accent" />
        <StatCard title="Expiring Soon" value={String(stats.expiringSoon)} caption="Within 30 days" icon={AlertCircle} tone="warning" />
        <StatCard title="Expired" value={String(stats.expired)} caption="Needs action" icon={Shield} tone="danger" />
        <StatCard title="This Month" value={String(stats.thisMonth)} caption="Added recently" icon={Calendar} tone="success" />
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
        <input type="text" placeholder="Search documents..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans" />
      </div>

      {/* Table */}
      <SectionCard pad="none">
        <div className="p-6 border-b border-slate-50 dark:border-slate-800">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            {activeTab === 'contracts' ? 'Employment Contracts' : activeTab === 'personal' ? 'Personal Documents' : activeTab === 'certifications' ? 'Certifications' : 'Payroll Documents'}
          </h3>
        </div>
        {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <FileText className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-sm">No documents found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                  {columns.map((c) => <th key={c.key} className="px-6 py-4 text-xs font-medium text-slate-500">{c.label}</th>)}
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Status</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {filtered.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    {columns.map((c) => (
                      <td key={c.key} className="px-6 py-4 text-sm font-medium text-slate-500">
                        {c.key === 'document_name' ? <span className="text-slate-900 dark:text-white font-semibold">{d[c.key as keyof HRDocument]}</span> : d[c.key as keyof HRDocument] || '—'}
                      </td>
                    ))}
                    <td className="px-6 py-4 text-center"><Badge tone={DOC_STATUS_TONE[d.status] ?? 'neutral'}>{d.status}</Badge></td>
                    <td className="px-6 py-4">
                      <div className="flex justify-center gap-2">
                        {d.file_url ? <a href={d.file_url} target="_blank" rel="noopener noreferrer" className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Upload className="w-4 h-4 text-slate-400" /></a> : null}
                        <button onClick={() => openEdit(d)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                        <button onClick={() => handleDelete(d.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Modal */}
      <ModalSystem
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onConfirm={handleSave}
        title={editingId ? 'Edit Document' : 'Add Document'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          {activeTab !== 'payroll' && (
            <Field label="Employee"><input className={inputCls} value={form.employee} onChange={(e) => setForm(f => ({ ...f, employee: e.target.value }))} /></Field>
          )}
          <div className={activeTab === 'payroll' ? 'col-span-2' : ''}><Field label="Document Name"><input className={inputCls} value={form.documentName} onChange={(e) => setForm(f => ({ ...f, documentName: e.target.value }))} /></Field></div>
          <Field label="Category"><input className={inputCls} value={form.category} onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))} /></Field>

          {activeTab === 'contracts' && (
            <>
              <Field label="Start Date"><input type="date" className={inputCls} value={form.startDate} onChange={(e) => setForm(f => ({ ...f, startDate: e.target.value }))} /></Field>
              <Field label="End Date"><input type="date" className={inputCls} value={form.endDate} onChange={(e) => setForm(f => ({ ...f, endDate: e.target.value }))} /></Field>
              <Field label="Version"><input className={inputCls} value={form.version} onChange={(e) => setForm(f => ({ ...f, version: e.target.value }))} /></Field>
            </>
          )}

          {activeTab === 'personal' && (
            <>
              <Field label="Document Number"><input className={inputCls} value={form.documentNumber} onChange={(e) => setForm(f => ({ ...f, documentNumber: e.target.value }))} /></Field>
              <Field label="Issue Date"><input type="date" className={inputCls} value={form.issuedDate} onChange={(e) => setForm(f => ({ ...f, issuedDate: e.target.value }))} /></Field>
              <Field label="Expiry Date"><input type="date" className={inputCls} value={form.expiryDate} onChange={(e) => setForm(f => ({ ...f, expiryDate: e.target.value }))} /></Field>
            </>
          )}

          {activeTab === 'certifications' && (
            <>
              <Field label="Issuing Organization"><input className={inputCls} value={form.issuingOrganization} onChange={(e) => setForm(f => ({ ...f, issuingOrganization: e.target.value }))} /></Field>
              <Field label="Issue Date"><input type="date" className={inputCls} value={form.issueDate} onChange={(e) => setForm(f => ({ ...f, issueDate: e.target.value }))} /></Field>
              <Field label="Expiry Date"><input type="date" className={inputCls} value={form.expiryDate} onChange={(e) => setForm(f => ({ ...f, expiryDate: e.target.value }))} /></Field>
            </>
          )}

          {activeTab === 'payroll' && (
            <>
              <Field label="Period"><input className={inputCls} value={form.period} onChange={(e) => setForm(f => ({ ...f, period: e.target.value }))} /></Field>
              <Field label="Generated Date"><input type="date" className={inputCls} value={form.generatedDate} onChange={(e) => setForm(f => ({ ...f, generatedDate: e.target.value }))} /></Field>
            </>
          )}

          <Field label="Status">
            <select className={inputCls} value={form.status} onChange={(e) => setForm(f => ({ ...f, status: e.target.value }))}>
              {['Active', 'Renewed', 'Valid', 'Expiring Soon', 'Expired', 'Available', 'Archived'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>

          <div className="col-span-2"><Field label="File URL"><input className={inputCls} value={form.fileUrl} onChange={(e) => setForm(f => ({ ...f, fileUrl: e.target.value }))} /></Field></div>
        </div>
      </ModalSystem>
    </div>
  );
};

export default DocumentManagement;
