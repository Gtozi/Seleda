/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Supplier Documents — Supply Chain & Procurement Portal (/erp/procurement/documents).
 * Aligns with unified_supply_chain_procurement_portal.md section 27.
 *
 * Supported documents (spec section 27):
 *   Business License, Tax Certificate, Insurance, Food Safety Certificate,
 *   Quality Certificate, Environmental Certificate, Bank Letter, Contract, NDA,
 *   Other compliance documents
 *
 * Track (spec section 27):
 *   Issue Date, Expiry Date, Document Status, Verification Status
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FileText, Plus, RefreshCw, Loader2, Trash2, CheckCircle2,
  AlertCircle, Search, XCircle, Clock, AlertTriangle, Eye,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchSupplierDocuments, createSupplierDocument, updateSupplierDocument,
  deleteSupplierDocument, fetchSuppliers,
  type SupplierDocument, type Supplier,
} from '../../services/procurementService';

// Spec section 27: Supported document types
const DOC_TYPES = [
  'Business License', 'Tax Certificate', 'Insurance', 'Food Safety Certificate',
  'Quality Certificate', 'Environmental Certificate', 'Bank Letter',
  'Contract', 'NDA', 'Other',
];

const VERIFICATION_TONE: Record<string, any> = {
  Verified: 'success', Pending: 'warning', Rejected: 'danger', Expired: 'neutral',
};

const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

const isExpiringSoon = (expiryDate: string) => {
  if (!expiryDate) return false;
  const days = (new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return days >= 0 && days <= 30;
};

const isExpired = (expiryDate: string) => {
  if (!expiryDate) return false;
  return new Date(expiryDate).getTime() < Date.now();
};

const SupplierDocumentsModule: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [documents, setDocuments] = useState<SupplierDocument[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [viewing, setViewing] = useState<SupplierDocument | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('All');
  const [verificationFilter, setVerificationFilter] = useState<string>('All');
  const [form, setForm] = useState({ supplierId: '', documentType: 'Business License', documentName: '', documentUrl: '', issueDate: '', expiryDate: '', notes: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [docData, supData] = await Promise.all([
        fetchSupplierDocuments(),
        fetchSuppliers({ propertyId: currentPropertyId || undefined }),
      ]);
      setDocuments(docData.documents);
      setSuppliers(supData.suppliers);
    } catch (e: any) {
      setError(e?.message || 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    return documents.filter((d) => {
      if (typeFilter !== 'All' && d.document_type !== typeFilter) return false;
      if (verificationFilter !== 'All' && d.verification_status !== verificationFilter) return false;
      const q = search.trim().toLowerCase();
      return !q || (d.document_name || '').toLowerCase().includes(q) || (d.proc_suppliers?.legal_name || '').toLowerCase().includes(q) || (d.document_type || '').toLowerCase().includes(q);
    });
  }, [documents, search, typeFilter, verificationFilter]);

  const submitCreate = async () => {
    if (!form.supplierId || !form.documentType || !form.documentName) {
      addNotification('Supplier, document type, and name are required', 'warning', 'Procurement');
      return;
    }
    setSubmitting(true);
    try {
      const { document } = await createSupplierDocument({
        supplierId: form.supplierId, documentType: form.documentType, documentName: form.documentName,
        documentUrl: form.documentUrl || undefined, issueDate: form.issueDate || undefined,
        expiryDate: form.expiryDate || undefined, notes: form.notes,
      });
      setDocuments((prev) => [document, ...prev]);
      addNotification('Document added', 'task', 'Procurement');
      setShowForm(false);
      setForm({ supplierId: '', documentType: 'Business License', documentName: '', documentUrl: '', issueDate: '', expiryDate: '', notes: '' });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to add document', 'warning', 'Procurement');
    } finally {
      setSubmitting(false);
    }
  };

  const verify = async (id: string) => {
    setActingOn(id);
    try {
      const { document } = await updateSupplierDocument(id, { verificationStatus: 'Verified' });
      setDocuments((prev) => prev.map((d) => (d.id === id ? document : d)));
      addNotification('Document verified', 'task', 'Procurement');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to verify', 'warning', 'Procurement');
    } finally {
      setActingOn(null);
    }
  };

  const reject = async (id: string) => {
    setActingOn(id);
    try {
      const { document } = await updateSupplierDocument(id, { verificationStatus: 'Rejected' });
      setDocuments((prev) => prev.map((d) => (d.id === id ? document : d)));
      addNotification('Document rejected', 'warning', 'Procurement');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to reject', 'warning', 'Procurement');
    } finally {
      setActingOn(null);
    }
  };

  const remove = async (id: string) => {
    setActingOn(id);
    try {
      await deleteSupplierDocument(id);
      setDocuments((prev) => prev.filter((d) => d.id !== id));
      addNotification('Document deleted', 'warning', 'Procurement');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete', 'warning', 'Procurement');
    } finally {
      setActingOn(null);
    }
  };

  const counts = {
    total: documents.length,
    verified: documents.filter((d) => d.verification_status === 'Verified').length,
    pending: documents.filter((d) => d.verification_status === 'Pending').length,
    expiringSoon: documents.filter((d) => isExpiringSoon(d.expiry_date)).length,
    expired: documents.filter((d) => isExpired(d.expiry_date)).length,
  };

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Supplier Documents"
        subtitle="Document management with verification per specification section 27."
        icon={FileText}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button onClick={() => setShowForm(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> Add Document
            </button>
          </div>
        }
      />

      {error && (
        <SectionCard tone="danger" pad="md">
          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        </SectionCard>
      )}

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Documents" value={counts.total} icon={FileText} tone="info" />
        <StatCard title="Verified" value={counts.verified} icon={CheckCircle2} tone="success" />
        <StatCard title="Pending Verification" value={counts.pending} icon={Clock} tone="warning" />
        <StatCard title="Expiring/Expired" value={counts.expiringSoon + counts.expired} icon={AlertTriangle} tone="danger" />
      </div>

      {/* Filters */}
      <SectionCard pad="md">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input className={inputClass + ' pl-10'} placeholder="Search by document name, supplier, type..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className={inputClass + ' max-w-[180px]'} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="All">All Types</option>
            {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className={inputClass + ' max-w-[160px]'} value={verificationFilter} onChange={(e) => setVerificationFilter(e.target.value)}>
            <option value="All">All Status</option>
            <option value="Verified">Verified</option>
            <option value="Pending">Pending</option>
            <option value="Rejected">Rejected</option>
            <option value="Expired">Expired</option>
          </select>
        </div>
      </SectionCard>

      {/* Documents List */}
      <SectionCard title="Documents" subtitle={`${filtered.length} document${filtered.length !== 1 ? 's' : ''}`} pad="none">
        {loading ? (
          <div className="flex items-center justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-gray-500 dark:text-gray-400">
            <FileText className="w-12 h-12 mb-3 opacity-50" />
            <p className="text-sm">No documents found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {filtered.map((d) => (
              <div key={d.id} className="px-6 py-4 flex items-center justify-between gap-4 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  <Badge tone={VERIFICATION_TONE[d.verification_status] || 'neutral'}>{d.verification_status}</Badge>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{d.document_name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{d.proc_suppliers?.legal_name || d.supplier_id} · {d.document_type}</p>
                    {d.expiry_date && (
                      <p className={`text-xs ${isExpired(d.expiry_date) ? 'text-red-500' : isExpiringSoon(d.expiry_date) ? 'text-amber-500' : 'text-gray-400'}`}>
                        {isExpired(d.expiry_date) ? 'Expired: ' : isExpiringSoon(d.expiry_date) ? 'Expiring soon: ' : 'Expires: '}{d.expiry_date}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => setViewing(d)} className="p-1.5 text-gray-400 hover:text-indigo-600 transition" title="View">
                    <Eye className="w-4 h-4" />
                  </button>
                  {d.verification_status === 'Pending' && (
                    <>
                      <button onClick={() => verify(d.id)} disabled={actingOn === d.id} className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50">Verify</button>
                      <button onClick={() => reject(d.id)} disabled={actingOn === d.id} className="text-xs bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-100 disabled:opacity-50">Reject</button>
                    </>
                  )}
                  <button onClick={() => remove(d.id)} disabled={actingOn === d.id} className="p-1.5 text-red-400 hover:text-red-600 disabled:opacity-50" title="Delete">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Create Modal */}
      <ModalSystem isOpen={showForm} onClose={() => setShowForm(false)} title="Add Document" size="lg" loading={submitting} confirmLabel="Add" onConfirm={submitCreate}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">Supplier *</label>
            <select className={inputClass} value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
              <option value="">Select supplier...</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.legal_name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Document Type *</label>
              <select className={inputClass} value={form.documentType} onChange={(e) => setForm({ ...form, documentType: e.target.value })}>
                {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Document Name *</label>
              <input className={inputClass} value={form.documentName} onChange={(e) => setForm({ ...form, documentName: e.target.value })} placeholder="Document name" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Issue Date</label>
              <input type="date" className={inputClass} value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Expiry Date</label>
              <input type="date" className={inputClass} value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">Document URL</label>
            <input className={inputClass} value={form.documentUrl} onChange={(e) => setForm({ ...form, documentUrl: e.target.value })} placeholder="https://..." />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">Notes</label>
            <textarea className={inputClass} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Document notes" />
          </div>
        </div>
      </ModalSystem>

      {/* View Detail Modal */}
      {viewing && (
        <ModalSystem isOpen={!!viewing} onClose={() => setViewing(null)} title="Document Details" size="md" showFooter={false}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-xs text-gray-500 uppercase">Document Name</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.document_name}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Verification</p><Badge tone={VERIFICATION_TONE[viewing.verification_status] || 'neutral'}>{viewing.verification_status}</Badge></div>
              <div><p className="text-xs text-gray-500 uppercase">Supplier</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.proc_suppliers?.legal_name || viewing.supplier_id}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Type</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.document_type}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Issue Date</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.issue_date || '—'}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Expiry Date</p><p className={`text-sm font-medium ${isExpired(viewing.expiry_date) ? 'text-red-500' : isExpiringSoon(viewing.expiry_date) ? 'text-amber-500' : 'text-gray-900 dark:text-white'}`}>{viewing.expiry_date || '—'}</p></div>
            </div>
            {viewing.document_url && (
              <div>
                <p className="text-xs text-gray-500 uppercase mb-1">Document URL</p>
                <a href={viewing.document_url} target="_blank" rel="noopener noreferrer" className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline break-all">{viewing.document_url}</a>
              </div>
            )}
            {viewing.notes && <div><p className="text-xs text-gray-500 uppercase mb-1">Notes</p><p className="text-sm text-gray-700 dark:text-gray-300">{viewing.notes}</p></div>}
            <div className="flex gap-2 pt-4 border-t border-gray-200 dark:border-slate-700">
              {viewing.verification_status === 'Pending' && (
                <>
                  <button onClick={() => { verify(viewing.id); setViewing(null); }} disabled={actingOn === viewing.id} className={button.primary}>Verify</button>
                  <button onClick={() => { reject(viewing.id); setViewing(null); }} disabled={actingOn === viewing.id} className="text-sm bg-red-600 text-white px-4 py-2 rounded-xl hover:bg-red-700">Reject</button>
                </>
              )}
              <button onClick={() => { remove(viewing.id); setViewing(null); }} disabled={actingOn === viewing.id} className="text-sm bg-gray-100 text-red-600 dark:bg-slate-700 dark:text-red-400 px-4 py-2 rounded-xl hover:bg-gray-200 ml-auto">
                <Trash2 className="w-4 h-4 inline mr-1" /> Delete
              </button>
            </div>
          </div>
        </ModalSystem>
      )}
    </div>
  );
};

export default SupplierDocumentsModule;
