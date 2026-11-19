/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tender Management — Supply Chain & Procurement Portal (/erp/procurement/tenders).
 * Aligns with unified_supply_chain_procurement_portal.md section 13 (Sourcing Management).
 *
 * Tenders are a sourcing event type for competitive procurement. The sourcing
 * functions per spec section 13 are: Create sourcing event, Select suppliers,
 * Issue tender, Receive submissions, Evaluate, Award supplier, Create PO.
 *
 * Features:
 * - Full tender header: Number, Title, Department, Officer, Type, Deadline,
 *   Estimated Value, Currency, Description, Terms, Conditions
 * - Tender lines (items being tendered)
 * - Status flow: Draft → Published → Submission Closed → Under Evaluation → Awarded / Cancelled
 * - Submissions view with supplier details and evaluation scores
 * - All 12 spec departments
 * - Sourcing functions reference panel
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Gavel, Plus, RefreshCw, Loader2, Eye, X,
  CheckCircle2, AlertCircle, FileText, Award, Scale, Handshake,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import { fetchTenders, createTender, updateTender, createNegotiationFromTender, type Tender, type TenderStatus } from '../../services/procurementService';

const DEPARTMENTS = [
  'Food & Beverage', 'Kitchen', 'Housekeeping', 'Engineering & Maintenance',
  'Spa & Wellness', 'Banquet & Events', 'Transportation & Fleet',
  'Human Resources', 'Administration', 'Security & Risk', 'IT', 'Other',
] as const;

const TENDER_TYPES = ['Open', 'Restricted', 'Single', 'Emergency'] as const;

const STATUS_TONE: Record<TenderStatus, any> = {
  Draft: 'neutral', Published: 'info', 'Submission Closed': 'warning',
  'Under Evaluation': 'warning', Awarded: 'success', Cancelled: 'danger',
};

const NEXT_STATUS: Record<TenderStatus, TenderStatus[]> = {
  Draft: ['Published', 'Cancelled'],
  Published: ['Submission Closed', 'Cancelled'],
  'Submission Closed': ['Under Evaluation'],
  'Under Evaluation': ['Awarded', 'Cancelled'],
  Awarded: [],
  Cancelled: ['Draft'],
};

const ACTION_LABELS: Record<TenderStatus, string> = {
  Draft: 'Publish',
  Published: 'Close Submissions',
  'Submission Closed': 'Start Evaluation',
  'Under Evaluation': 'Award',
  Awarded: 'Closed',
  Cancelled: 'Reopen',
};

// Source system display labels for department-originated tenders
const SOURCE_LABELS: Record<string, { label: string; tone: 'info' | 'accent' | 'warning' }> = {
  procurement: { label: 'Procurement', tone: 'info' },
  engineering: { label: 'Engineering', tone: 'accent' },
  housekeeping: { label: 'Housekeeping', tone: 'accent' },
  food_beverage: { label: 'F&B', tone: 'accent' },
  inventory: { label: 'Inventory', tone: 'accent' },
};

// Spec section 13: Sourcing functions
const SOURCING_FUNCTIONS = [
  'Create sourcing event', 'Select suppliers', 'Issue tender',
  'Receive submissions', 'Evaluate', 'Award supplier', 'Create purchase order',
];

const TenderManagement: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [viewing, setViewing] = useState<Tender | null>(null);
  const [form, setForm] = useState({
    department: 'Administration',
    procurementOfficer: '',
    title: '',
    description: '',
    submissionDeadline: '',
    estimatedValue: 0,
    tenderType: 'Open' as typeof TENDER_TYPES[number],
    terms: '',
    conditions: '',
    lines: [{ itemName: '', specification: '', quantity: 1, unitOfMeasure: 'ea', requiredDeliveryDate: '' }],
  });

  const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTenders({ propertyId: currentPropertyId || undefined });
      setTenders(data.tenders);
    } catch (e: any) {
      setError(e?.message || 'Failed to load tenders');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const submitCreate = async () => {
    if (!form.title || !form.procurementOfficer || !form.submissionDeadline) {
      addNotification('Title, procurement officer, and submission deadline are required', 'warning', 'Procurement');
      return;
    }
    setSubmitting(true);
    try {
      const { tender } = await createTender({
        propertyId: currentPropertyId || undefined,
        department: form.department,
        procurementOfficer: form.procurementOfficer,
        title: form.title,
        description: form.description,
        submissionDeadline: form.submissionDeadline,
        estimatedValue: form.estimatedValue,
        tenderType: form.tenderType,
        terms: form.terms,
        conditions: form.conditions,
        lines: form.lines.filter(l => l.itemName),
      });
      setTenders((prev) => [tender, ...prev]);
      addNotification(`Tender ${tender.tender_number} created`, 'task', 'Procurement');
      setShowForm(false);
      setForm({ department: 'Administration', procurementOfficer: '', title: '', description: '', submissionDeadline: '', estimatedValue: 0, tenderType: 'Open', terms: '', conditions: '', lines: [{ itemName: '', specification: '', quantity: 1, unitOfMeasure: 'ea', requiredDeliveryDate: '' }] });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create tender', 'warning', 'Procurement');
    } finally {
      setSubmitting(false);
    }
  };

  const changeStatus = async (id: string, status: TenderStatus) => {
    setActingOn(id);
    try {
      const { tender } = await updateTender(id, { status });
      setTenders((prev) => prev.map((t) => (t.id === id ? tender : t)));
      addNotification(`Tender → ${status}`, 'task', 'Procurement');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update tender', 'warning', 'Procurement');
    } finally {
      setActingOn(null);
    }
  };

  const startNegotiation = async (tender: Tender, submission: { supplier_id: string; total_amount: number }) => {
    setActingOn(tender.id);
    try {
      const { negotiation } = await createNegotiationFromTender(tender, submission.supplier_id, submission.total_amount);
      addNotification(`Negotiation ${negotiation.negotiation_number} created from Tender ${tender.tender_number}`, 'task', 'Procurement');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create negotiation', 'warning', 'Procurement');
    } finally {
      setActingOn(null);
    }
  };

  const counts = {
    draft: tenders.filter((t) => t.status === 'Draft').length,
    published: tenders.filter((t) => t.status === 'Published').length,
    evaluation: tenders.filter((t) => t.status === 'Submission Closed' || t.status === 'Under Evaluation').length,
    awarded: tenders.filter((t) => t.status === 'Awarded').length,
  };

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Tender Management"
        subtitle="Competitive procurement through formal tender processes."
        icon={Gavel}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button onClick={() => setShowForm(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> New Tender
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
        <StatCard title="Draft" value={counts.draft} icon={Gavel} tone="neutral" />
        <StatCard title="Published" value={counts.published} icon={FileText} tone="info" />
        <StatCard title="Under Evaluation" value={counts.evaluation} icon={Scale} tone="warning" />
        <StatCard title="Awarded" value={counts.awarded} icon={Award} tone="success" />
      </div>

      {/* Sourcing Functions (spec section 13) */}
      <SectionCard title="Sourcing Functions" subtitle="Per specification section 13" icon={CheckCircle2} pad="md">
        <div className="flex flex-wrap items-center gap-2">
          {SOURCING_FUNCTIONS.map((fn, i, arr) => (
            <React.Fragment key={fn}>
              <div className="px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-300 bg-white dark:bg-slate-800">
                {fn}
              </div>
              {i < arr.length - 1 && <span className="text-gray-400">→</span>}
            </React.Fragment>
          ))}
        </div>
      </SectionCard>

      {/* Tenders List */}
      <SectionCard title="Tenders" subtitle={`${tenders.length} tender${tenders.length !== 1 ? 's' : ''}`} pad="none">
        {loading ? (
          <div className="p-12 text-center"><Loader2 className="w-8 h-8 animate-spin text-indigo-600 mx-auto" /></div>
        ) : tenders.length === 0 ? (
          <div className="p-12 text-center text-gray-500 dark:text-gray-400">
            <Gavel className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No tenders found</p>
            <p className="text-xs mt-1">Click "New Tender" to create one.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {tenders.map((t) => (
              <div key={t.id} className="px-6 py-4 flex items-center justify-between gap-4 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors group">
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  <Badge tone={STATUS_TONE[t.status]}>{t.status}</Badge>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{t.tender_number}</p>
                      {t.source_system && t.source_system !== 'procurement' && SOURCE_LABELS[t.source_system] && (
                        <Badge tone={SOURCE_LABELS[t.source_system].tone}>{SOURCE_LABELS[t.source_system].label}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{t.title} · {t.department}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 truncate">Deadline: {t.submission_deadline}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {t.estimated_value != null && <p className="text-sm font-mono text-gray-900 dark:text-white tabular-nums">{t.estimated_value.toLocaleString()} {t.currency}</p>}
                  {NEXT_STATUS[t.status]?.map((status) => (
                    <button
                      key={status}
                      onClick={() => changeStatus(t.id, status)}
                      disabled={actingOn === t.id}
                      className="text-xs bg-indigo-600 text-white px-3 py-1 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {ACTION_LABELS[status]}
                    </button>
                  ))}
                  <button onClick={() => setViewing(t)} className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
                    View
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Create Modal */}
      <ModalSystem isOpen={showForm} onClose={() => setShowForm(false)} title="New Tender" size="xl" loading={submitting} confirmLabel="Create" onConfirm={submitCreate}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">Title *</label>
            <input className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Tender title" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Department</label>
              <select className={inputClass} value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Procurement Officer *</label>
              <input className={inputClass} value={form.procurementOfficer} onChange={(e) => setForm({ ...form, procurementOfficer: e.target.value })} placeholder="Officer name" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Submission Deadline *</label>
              <input type="datetime-local" className={inputClass} value={form.submissionDeadline} onChange={(e) => setForm({ ...form, submissionDeadline: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Estimated Value</label>
              <input type="number" className={inputClass} value={form.estimatedValue} onChange={(e) => setForm({ ...form, estimatedValue: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Tender Type</label>
              <select className={inputClass} value={form.tenderType} onChange={(e) => setForm({ ...form, tenderType: e.target.value as any })}>
                {TENDER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">Description</label>
            <textarea className={inputClass} rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Tender description" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Terms</label>
              <textarea className={inputClass} rows={2} value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} placeholder="Tender terms" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Conditions</label>
              <textarea className={inputClass} rows={2} value={form.conditions} onChange={(e) => setForm({ ...form, conditions: e.target.value })} placeholder="Tender conditions" />
            </div>
          </div>

          {/* Tender Lines */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-bold text-gray-500">Tender Lines</label>
              <button onClick={() => setForm({ ...form, lines: [...form.lines, { itemName: '', specification: '', quantity: 1, unitOfMeasure: 'ea', requiredDeliveryDate: '' }] })} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add Line
              </button>
            </div>
            {form.lines.map((line, idx) => (
              <div key={idx} className="p-3 bg-gray-50 dark:bg-slate-800 rounded-xl space-y-2 mb-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-gray-500">Line {idx + 1}</span>
                  {form.lines.length > 1 && (
                    <button onClick={() => setForm({ ...form, lines: form.lines.filter((_, i) => i !== idx) })} className="text-xs text-red-600 hover:underline flex items-center gap-1">
                      <X className="w-3 h-3" /> Remove
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input className={inputClass} placeholder="Item name" value={line.itemName} onChange={(e) => {
                    const newLines = [...form.lines];
                    newLines[idx] = { ...newLines[idx], itemName: e.target.value };
                    setForm({ ...form, lines: newLines });
                  }} />
                  <input className={inputClass} placeholder="Specification" value={line.specification} onChange={(e) => {
                    const newLines = [...form.lines];
                    newLines[idx] = { ...newLines[idx], specification: e.target.value };
                    setForm({ ...form, lines: newLines });
                  }} />
                  <input type="number" className={inputClass} placeholder="Quantity" value={line.quantity} onChange={(e) => {
                    const newLines = [...form.lines];
                    newLines[idx] = { ...newLines[idx], quantity: parseFloat(e.target.value) || 0 };
                    setForm({ ...form, lines: newLines });
                  }} />
                  <input className={inputClass} placeholder="Unit" value={line.unitOfMeasure} onChange={(e) => {
                    const newLines = [...form.lines];
                    newLines[idx] = { ...newLines[idx], unitOfMeasure: e.target.value };
                    setForm({ ...form, lines: newLines });
                  }} />
                  <input type="date" className={inputClass} placeholder="Required delivery date" value={line.requiredDeliveryDate} onChange={(e) => {
                    const newLines = [...form.lines];
                    newLines[idx] = { ...newLines[idx], requiredDeliveryDate: e.target.value };
                    setForm({ ...form, lines: newLines });
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </ModalSystem>

      {/* View Detail Modal */}
      {viewing && (
        <ModalSystem isOpen={!!viewing} onClose={() => setViewing(null)} title="Tender Details" size="lg" showFooter={false}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500 uppercase">Tender Number</p>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.tender_number}</p>
                  {viewing.source_system && viewing.source_system !== 'procurement' && SOURCE_LABELS[viewing.source_system] && (
                    <Badge tone={SOURCE_LABELS[viewing.source_system].tone}>{SOURCE_LABELS[viewing.source_system].label}</Badge>
                  )}
                </div>
              </div>
              <div><p className="text-xs text-gray-500 uppercase">Status</p><Badge tone={STATUS_TONE[viewing.status]}>{viewing.status}</Badge></div>
              <div><p className="text-xs text-gray-500 uppercase">Title</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.title}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Department</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.department}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Procurement Officer</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.procurement_officer}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Tender Type</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.tender_type}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Submission Deadline</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.submission_deadline}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Estimated Value</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.estimated_value?.toLocaleString() || '—'} {viewing.currency}</p></div>
            </div>
            {viewing.description && (
              <div><p className="text-xs text-gray-500 uppercase mb-1">Description</p><p className="text-sm text-gray-700 dark:text-gray-300">{viewing.description}</p></div>
            )}
            {viewing.terms && (
              <div><p className="text-xs text-gray-500 uppercase mb-1">Terms</p><p className="text-sm text-gray-700 dark:text-gray-300">{viewing.terms}</p></div>
            )}
            {viewing.conditions && (
              <div><p className="text-xs text-gray-500 uppercase mb-1">Conditions</p><p className="text-sm text-gray-700 dark:text-gray-300">{viewing.conditions}</p></div>
            )}

            {/* Tender Lines */}
            {viewing.proc_tender_lines && viewing.proc_tender_lines.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 uppercase mb-2">Tender Lines</p>
                <div className="border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-slate-800">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-bold text-gray-500">#</th>
                        <th className="px-4 py-2 text-left text-xs font-bold text-gray-500">Item</th>
                        <th className="px-4 py-2 text-right text-xs font-bold text-gray-500">Qty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                      {viewing.proc_tender_lines.map((line, i) => (
                        <tr key={line.id || i}>
                          <td className="px-4 py-2 text-gray-500">{line.line_number || i + 1}</td>
                          <td className="px-4 py-2 font-medium text-gray-900 dark:text-white">{line.item_name || line.description}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{line.quantity} {line.unit_of_measure}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Submissions */}
            {viewing.proc_tender_submissions && viewing.proc_tender_submissions.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 uppercase mb-2">Submissions</p>
                <div className="space-y-2">
                  {viewing.proc_tender_submissions.map((s) => (
                    <div key={s.id} className="p-3 border border-gray-200 dark:border-slate-700 rounded-xl flex justify-between items-center">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{s.proc_suppliers?.legal_name || s.supplier_id}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Score: {s.evaluation_score || 'N/A'} · Lead time: {s.lead_time || '—'} days · {s.payment_terms || '—'}</p>
                      </div>
                      <div className="text-right flex items-center gap-3">
                        <div>
                          <p className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">{s.total_amount?.toLocaleString() || '—'} {s.currency}</p>
                          <Badge tone={s.status === 'Selected' ? 'success' : s.status === 'Rejected' ? 'danger' : 'neutral'}>{s.status}</Badge>
                        </div>
                        {(viewing.status === 'Submission Closed' || viewing.status === 'Under Evaluation') && s.status !== 'Rejected' && (
                          <button
                            onClick={() => startNegotiation(viewing, s)}
                            disabled={actingOn === viewing.id}
                            className="text-xs bg-purple-600 text-white px-3 py-1 rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1"
                            title="Start negotiation with this supplier"
                          >
                            <Handshake className="w-3 h-3" /> Negotiate
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Award action */}
            {viewing.status === 'Under Evaluation' && (
              <button onClick={() => { changeStatus(viewing.id, 'Awarded'); setViewing(null); }} className={button.primary + ' w-full'}>
                <Award className="w-4 h-4" /> Award Tender
              </button>
            )}
          </div>
        </ModalSystem>
      )}
    </div>
  );
};

export default TenderManagement;
