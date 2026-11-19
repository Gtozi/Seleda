/**
 * Finance — Document Management (backs /erp/finance/documents).
 *
 * DB-integrated via /api/fin-portal (see financePortal.routes.ts).
 * Centralized repository for invoices, receipts, payment vouchers,
 * contracts, bank statements, tax documents, and journal attachments.
 *
 * Uses the shared FrontOffice UI primitives (PageHeader, StatCard, Badge,
 * SectionCard) and the useERP context for currency formatting + notifications,
 * matching the F&B / HK inventory module look & feel.
 */

import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import {
  FileText,
  Download,
  Search,
  Upload,
  Eye,
  Trash2,
  RefreshCw,
  Loader2,
  Plus,
  X,
  MoreVertical,
  Check,
  AlertCircle,
  CheckCircle2,
  Archive,
  Building2,
  Filter,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { useERP } from '../../context/ERPContext';
import {
  fetchDocuments,
  createDocument,
  updateDocument,
  deleteDocument,
  uploadDocumentFile,
  type DocumentFE,
} from '../../services/financePortalService';

const DOC_TYPES = ['Invoice', 'Vendor Invoice', 'Journal Attachment', 'Bank Statement', 'Contract', 'Tax Document', 'Payment Voucher', 'Receipt', 'Other'];
const DOC_STATUSES = ['Pending Review', 'Processed', 'Archived', 'Rejected'];

// Entity types for transaction linking (spec §22)
const ENTITY_OPTIONS = ['Invoice', 'Vendor Invoice', 'Journal Entry', 'Payment', 'Bank Statement', 'Contract', 'Tax Document'];

// Quick-filter buttons for the main document types
const DOC_TYPE_FILTERS = ['Invoice', 'Receipt', 'Payment Voucher', 'Journal Attachment', 'Bank Statement', 'Contract', 'Tax Document'];

const STATUS_COLORS: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  'Pending Review': 'warning',
  Processed: 'success',
  Archived: 'neutral',
  Rejected: 'danger',
};

const TYPE_COLORS: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  Invoice: 'success',
  'Vendor Invoice': 'warning',
  'Journal Attachment': 'info',
  'Bank Statement': 'info',
  Contract: 'neutral',
  'Tax Document': 'danger',
  'Payment Voucher': 'warning',
  Receipt: 'success',
  Other: 'neutral',
};

const formatFileSize = (bytes: number): string => {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const DocumentManagement = () => {
  const { addNotification, currentPropertyId } = useERP();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);

  const [documents, setDocuments] = useState<DocumentFE[]>([]);

  // Modals
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState<DocumentFE | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form
  const [form, setForm] = useState({
    documentNumber: '',
    name: '',
    type: 'Invoice',
    category: 'Accounts Receivable',
    entity: '',
    referenceNumber: '',
    fileSize: 0,
    mimeType: 'application/pdf',
    fileUrl: '',
    notes: '',
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // ── Data loading ──────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pid = currentPropertyId || undefined;
      const docs = await fetchDocuments({ propertyId: pid }).catch(() => [] as DocumentFE[]);
      setDocuments(docs);
    } catch (e: any) {
      setError(e?.message || 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Derived data ──────────────────────────────────────────────────────
  const filteredDocuments = useMemo(() =>
    documents.filter(d => {
      const matchesSearch =
        d.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (d.entity || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (d.document_number || '').toLowerCase().includes(searchTerm.toLowerCase());
      const matchesType = typeFilter === 'all' || d.type === typeFilter;
      const matchesStatus = statusFilter === 'all' || d.status === statusFilter;
      return matchesSearch && matchesType && matchesStatus;
    }), [documents, searchTerm, typeFilter, statusFilter]);

  // ── Stats ─────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = documents.length;
    const processed = documents.filter(d => d.status === 'Processed').length;
    const pending = documents.filter(d => d.status === 'Pending Review').length;
    const archived = documents.filter(d => d.status === 'Archived').length;
    const totalSize = documents.reduce((s, d) => s + Number(d.file_size || 0), 0);
    return { total, processed, pending, archived, totalSize };
  }, [documents]);

  // ── Action handlers ───────────────────────────────────────────────────
  const handleStatus = async (id: string, status: string) => {
    setActionMenuId(null);
    try {
      await updateDocument(id, { status });
      await loadAll();
      addNotification(`Document status updated to ${status}.`, 'success', 'Documents');
    } catch (e: any) { addNotification(e?.message || 'Failed to update', 'error', 'Documents'); }
  };

  const handleDelete = async (id: string) => {
    setActionMenuId(null);
    try {
      await deleteDocument(id);
      await loadAll();
      addNotification('Document deleted.', 'warning', 'Documents');
    } catch (e: any) { addNotification(e?.message || 'Failed to delete', 'error', 'Documents'); }
  };

  const handleCreate = async () => {
    setSubmitting(true);
    try {
      if (!form.name) { addNotification('Document name is required.', 'warning', 'Documents'); setSubmitting(false); return; }
      let fileUrl: string | undefined = form.fileUrl || undefined;
      let filePath: string | undefined;
      // Upload file to storage if a file was selected
      if (selectedFile) {
        addNotification('Uploading file to storage...', 'info', 'Documents');
        const uploadResult = await uploadDocumentFile(selectedFile);
        fileUrl = uploadResult.fileUrl;
        filePath = uploadResult.filePath;
      }
      await createDocument({ ...form, fileUrl, filePath, propertyId: currentPropertyId || undefined });
      await loadAll();
      setShowUploadModal(false);
      setForm({ documentNumber: '', name: '', type: 'Invoice', category: 'Accounts Receivable', entity: '', referenceNumber: '', fileSize: 0, mimeType: 'application/pdf', fileUrl: '', notes: '' });
      setSelectedFile(null);
      addNotification('Document uploaded and record created.', 'success', 'Documents');
    } catch (e: any) { addNotification(e?.message || 'Failed to create', 'error', 'Documents'); }
    finally { setSubmitting(false); }
  };

  // Handle file selection — auto-populate name, size, and MIME type
  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) { setSelectedFile(null); return; }
    setSelectedFile(file);
    setForm(prev => ({
      ...prev,
      name: prev.name || file.name,
      fileSize: file.size,
      mimeType: file.type || 'application/octet-stream',
    }));
  };

  // ── Shared UI helpers ─────────────────────────────────────────────────
  const th = 'px-4 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest';
  const td = 'px-4 py-3.5 text-sm text-slate-700 dark:text-slate-300';
  const tdR = 'px-4 py-3.5 text-sm text-right text-slate-700 dark:text-slate-300';
  const tdC = 'px-4 py-3.5 text-sm text-center text-slate-700 dark:text-slate-300';
  const inputCls = 'w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all';

  const Modal = ({ open, onClose, title, children, onSubmit, submitLabel }: {
    open: boolean; onClose: () => void; title: string; children: ReactNode;
    onSubmit?: () => void; submitLabel?: string;
  }) => {
    if (!open) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-700">
            <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">{title}</h3>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"><X size={16} /></button>
          </div>
          <div className="p-5 space-y-4">{children}</div>
          {onSubmit && (
            <div className="flex justify-end gap-3 p-5 border-t border-slate-200 dark:border-slate-700">
              <button onClick={onClose} className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors">Cancel</button>
              <button onClick={onSubmit} disabled={submitting}
                className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase tracking-tight hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center gap-2">
                {submitting && <Loader2 size={14} className="animate-spin" />} {submitLabel || 'Submit'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const FormField = ({ label, children }: { label: string; children: ReactNode }) => (
    <div>
      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">{label}</label>
      {children}
    </div>
  );

  const ActionMenu = ({ doc }: { doc: DocumentFE }) => (
    <div className="relative">
      <button onClick={() => setActionMenuId(actionMenuId === doc.id ? null : doc.id)}
        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors">
        <MoreVertical size={14} />
      </button>
      {actionMenuId === doc.id && (
        <div className="absolute right-0 top-8 z-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-1 min-w-[160px]">
          {DOC_STATUSES.filter(s => s !== doc.status).map(s => (
            <button key={s} onClick={() => handleStatus(doc.id, s)}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
              <Check size={14} /> Set {s}
            </button>
          ))}
          <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
          <button onClick={() => { setActionMenuId(null); setShowDetailModal(doc); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
            <Eye size={14} /> View Details
          </button>
          <button onClick={() => handleDelete(doc.id)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
            <Trash2 size={14} /> Delete
          </button>
        </div>
      )}
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 font-sans animate-fade-in">
      <PageHeader
        title="Document Management"
        subtitle="Centralized repository for invoices, receipts, payment vouchers, and financial documents"
        icon={FileText}
        actions={
          <button onClick={loadAll} className="p-2.5 border dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-400 transition-colors" title="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        }
      />

      {/* Stat cards — above filters */}
      {!loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Total Documents" value={stats.total} icon={FileText} tone="info" />
          <StatCard title="Processed" value={stats.processed} icon={CheckCircle2} tone="success" />
          <StatCard title="Pending Review" value={stats.pending} icon={AlertCircle} tone="warning" />
          <StatCard title="Total Size" value={formatFileSize(stats.totalSize)} icon={Building2} tone="neutral" />
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input
            type="text"
            placeholder="Search by name, entity, or doc #..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className={inputCls + ' pl-10'}
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-slate-400" />
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className={inputCls + ' min-w-[140px]'}>
            <option value="all">All Types</option>
            {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={inputCls + ' min-w-[140px]'}>
            <option value="all">All Statuses</option>
            {DOC_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex-1" />
        <button onClick={() => setShowUploadModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">
          <Upload size={14} /> Upload Document
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
          <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
          <span className="text-sm text-red-700 dark:text-red-400">{error}</span>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
        </div>
      )}

      {/* Documents table */}
      {!loading && (
        <>
        {/* Document type quick-filter buttons */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setTypeFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition flex items-center gap-1.5 ${
              typeFilter === 'all' ? 'bg-slate-950 text-white' : 'text-slate-400 hover:bg-slate-50 bg-white border border-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:hover:bg-slate-700'
            }`}
          >
            All Types
            <span className={`px-1.5 py-0.5 rounded-full text-[8px] ${typeFilter === 'all' ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-700 text-slate-500'}`}>{documents.length}</span>
          </button>
          {DOC_TYPE_FILTERS.map(t => {
            const count = documents.filter(d => d.type === t).length;
            return (
              <button
                key={t}
                onClick={() => setTypeFilter(typeFilter === t ? 'all' : t)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition flex items-center gap-1.5 ${
                  typeFilter === t ? 'bg-slate-950 text-white' : 'text-slate-400 hover:bg-slate-50 bg-white border border-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:hover:bg-slate-700'
                }`}
              >
                {t}
                {count > 0 && (
                  <span className={`px-1.5 py-0.5 rounded-full text-[8px] ${typeFilter === t ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-700 text-slate-500'}`}>{count}</span>
                )}
              </button>
            );
          })}
        </div>

        <SectionCard title="Financial Documents" subtitle={`${filteredDocuments.length} document${filteredDocuments.length !== 1 ? 's' : ''}`} icon={FileText}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800">
                  <th className={th}>Document Name</th>
                  <th className={th}>Type</th>
                  <th className={th}>Category</th>
                  <th className={th}>Entity</th>
                  <th className={th}>Uploaded By</th>
                  <th className={th}>Date</th>
                  <th className={th}>Size</th>
                  <th className={th}>Status</th>
                  <th className={th + ' text-right'}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredDocuments.map(doc => (
                  <tr key={doc.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className={td}>
                      <div className="flex items-center gap-2">
                        <FileText size={14} className="text-indigo-600 flex-shrink-0" />
                        <div>
                          <span className="text-xs font-bold text-slate-900 dark:text-white">{doc.name}</span>
                          {doc.document_number && <span className="block text-[10px] font-mono text-slate-400">{doc.document_number}</span>}
                        </div>
                      </div>
                    </td>
                    <td className={td}><Badge tone={TYPE_COLORS[doc.type] || 'neutral'}>{doc.type}</Badge></td>
                    <td className={td}><span className="text-xs">{doc.category}</span></td>
                    <td className={td}><span className="text-xs font-medium text-slate-900 dark:text-white">{doc.entity || '—'}</span></td>
                    <td className={td}><span className="text-xs text-slate-500">{doc.uploaded_by || '—'}</span></td>
                    <td className={td}><span className="text-xs text-slate-500">{doc.created_at ? new Date(doc.created_at).toLocaleDateString() : '—'}</span></td>
                    <td className={td}><span className="text-xs font-mono text-slate-600 dark:text-slate-400">{formatFileSize(Number(doc.file_size))}</span></td>
                    <td className={tdC}><Badge tone={STATUS_COLORS[doc.status] || 'neutral'}>{doc.status}</Badge></td>
                    <td className={tdR}>
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => setShowDetailModal(doc)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition" title="View">
                          <Eye size={14} className="text-slate-600 dark:text-slate-400" />
                        </button>
                        {doc.file_url && (
                          <a href={doc.file_url} target="_blank" rel="noreferrer" className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition" title="Download">
                            <Download size={14} className="text-slate-600 dark:text-slate-400" />
                          </a>
                        )}
                        <ActionMenu doc={doc} />
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredDocuments.length === 0 && (
                  <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-slate-400">No documents found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
        </>
      )}

      {/* Upload Modal */}
      <Modal open={showUploadModal} onClose={() => setShowUploadModal(false)} title="Register Document" onSubmit={handleCreate} submitLabel="Register">
        {/* File upload — auto-populates name, size, and MIME type */}
        <FormField label="File">
          <label className="flex items-center justify-center gap-2 w-full bg-slate-50 dark:bg-slate-800 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl px-3 py-4 text-sm text-slate-500 hover:border-indigo-400 hover:bg-indigo-50/30 dark:hover:bg-indigo-900/10 cursor-pointer transition-all">
            <Upload size={16} className="text-indigo-600" />
            <span className="font-bold">{selectedFile ? 'Choose a different file' : 'Click to upload a file'}</span>
            <input type="file" className="hidden" onChange={handleFileSelect} />
          </label>
        </FormField>
        {selectedFile && (
          <div className="flex items-center gap-3 p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl">
            <FileText size={16} className="text-indigo-600 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="block text-xs font-bold text-slate-900 dark:text-white truncate">{selectedFile.name}</span>
              <span className="block text-[10px] font-mono text-slate-500">{formatFileSize(selectedFile.size)} · {selectedFile.type || 'unknown'}</span>
            </div>
            <button type="button" onClick={() => { setSelectedFile(null); setForm(prev => ({ ...prev, fileSize: 0, mimeType: 'application/pdf' })); }}
              className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 transition-colors" title="Remove file">
              <X size={14} />
            </button>
          </div>
        )}
        <FormField label="Document # (optional)">
          <input className={inputCls} value={form.documentNumber} onChange={e => setForm({ ...form, documentNumber: e.target.value })} placeholder="DOC-009" />
        </FormField>
        <FormField label="Document Name">
          <input className={inputCls} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Invoice_2024_009.pdf" />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Type">
            <select className={inputCls} value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
              {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </FormField>
          <FormField label="Category">
            <input className={inputCls} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="Accounts Receivable" />
          </FormField>
        </div>
        {/* Transaction linking — entity dropdown + reference number */}
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Linked Entity">
            <select className={inputCls} value={form.entity} onChange={e => setForm({ ...form, entity: e.target.value })}>
              <option value="">— None —</option>
              {ENTITY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </FormField>
          <FormField label="Reference #">
            <input className={inputCls} value={form.referenceNumber} onChange={e => setForm({ ...form, referenceNumber: e.target.value })} placeholder="e.g. INV-2024-009" disabled={!form.entity} />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="File Size (bytes)">
            <input type="number" className={inputCls} value={form.fileSize || ''} onChange={e => setForm({ ...form, fileSize: Number(e.target.value) })} />
          </FormField>
          <FormField label="MIME Type">
            <input className={inputCls} value={form.mimeType} onChange={e => setForm({ ...form, mimeType: e.target.value })} placeholder="application/pdf" />
          </FormField>
        </div>
        <FormField label="Notes (optional)">
          <textarea className={inputCls} rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Document notes..." />
        </FormField>
      </Modal>

      {/* Detail Modal */}
      {showDetailModal && (
        <Modal open={!!showDetailModal} onClose={() => setShowDetailModal(null)} title={showDetailModal.name}>
          {/* Document preview — images via <img>, PDFs via <embed>, others via download link */}
          {(() => {
            const url = showDetailModal.file_url;
            const mime = (showDetailModal.mime_type || '').toLowerCase();
            const isImage = mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(showDetailModal.name || url || '');
            const isPdf = mime === 'application/pdf' || /\.pdf$/i.test(showDetailModal.name || url || '');
            if (!url) {
              return (
                <div className="flex flex-col items-center justify-center gap-2 p-8 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-center">
                  <FileText size={24} className="text-slate-300" />
                  <span className="text-xs font-bold text-slate-400">Preview not available</span>
                </div>
              );
            }
            if (isImage) {
              return (
                <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-slate-50 dark:bg-slate-800">
                  <img src={url} alt={showDetailModal.name} className="w-full max-h-[320px] object-contain" />
                </div>
              );
            }
            if (isPdf) {
              return (
                <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-slate-50 dark:bg-slate-800">
                  <embed src={url} type="application/pdf" className="w-full h-[320px]" />
                </div>
              );
            }
            return (
              <div className="flex items-center justify-between gap-3 p-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText size={16} className="text-indigo-600 flex-shrink-0" />
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate">Preview not supported for this file type</span>
                </div>
                <a href={url} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 transition-all flex-shrink-0">
                  <Download size={12} /> Download
                </a>
              </div>
            );
          })()}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Document #</span>
              <span className="text-sm font-mono text-indigo-500">{showDetailModal.document_number || '—'}</span>
            </div>
            <div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Type</span>
              <Badge tone={TYPE_COLORS[showDetailModal.type] || 'neutral'}>{showDetailModal.type}</Badge>
            </div>
            <div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Category</span>
              <span className="text-sm font-bold text-slate-900 dark:text-white">{showDetailModal.category}</span>
            </div>
            <div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Entity</span>
              <span className="text-sm font-bold text-slate-900 dark:text-white">{showDetailModal.entity || '—'}</span>
            </div>
            <div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">File Size</span>
              <span className="text-sm font-mono text-slate-600 dark:text-slate-400">{formatFileSize(Number(showDetailModal.file_size))}</span>
            </div>
            <div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">MIME Type</span>
              <span className="text-sm font-mono text-slate-600 dark:text-slate-400">{showDetailModal.mime_type || '—'}</span>
            </div>
            <div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Uploaded By</span>
              <span className="text-sm font-bold text-slate-900 dark:text-white">{showDetailModal.uploaded_by || '—'}</span>
            </div>
            <div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Upload Date</span>
              <span className="text-sm font-bold text-slate-900 dark:text-white">{showDetailModal.created_at ? new Date(showDetailModal.created_at).toLocaleString() : '—'}</span>
            </div>
            <div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Reviewed By</span>
              <span className="text-sm font-bold text-slate-900 dark:text-white">{showDetailModal.reviewed_by || '—'}</span>
            </div>
            <div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Status</span>
              <Badge tone={STATUS_COLORS[showDetailModal.status] || 'neutral'}>{showDetailModal.status}</Badge>
            </div>
          </div>
          {showDetailModal.notes && (
            <div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Notes</span>
              <p className="text-sm text-slate-700 dark:text-slate-300">{showDetailModal.notes}</p>
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowDetailModal(null)} className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors">Close</button>
            {showDetailModal.file_url && (
              <a href={showDetailModal.file_url} target="_blank" rel="noreferrer"
                className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase tracking-tight hover:bg-indigo-700 transition-all flex items-center gap-2">
                <Download size={14} /> Download
              </a>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};

export default DocumentManagement;
