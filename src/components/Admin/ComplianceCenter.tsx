import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, Shield, Download, Trash2, CheckCircle2,
  AlertTriangle, Clock, FileCheck2, UserX, Loader2,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { adminAuthHeaders } from './shared/ResourceManager';
import { AdminSubTabBar } from './shared/AdminSubTabBar';

interface ConsentLog {
  id: string;
  guest_id: string | null;
  consent_type: string;
  granted: boolean;
  policy_version: string | null;
  timestamp: string;
}

interface RetentionPolicy {
  id: string;
  table_name: string;
  retention_days: number;
  action: string;
  enabled: boolean;
  property_id?: string | null;
}

interface PiiRequest {
  id: string;
  requested_by: string | null;
  target_entity: string;
  status: string;
  exported_at: string | null;
  erased_at: string | null;
  created_at: string;
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'consent', label: 'Consent Logs' },
  { id: 'retention', label: 'Retention Policies' },
  { id: 'requests', label: 'PII Requests' },
] as const;

type TabId = typeof TABS[number]['id'];

const actionTone = (a?: string) =>
  a === 'delete' ? 'danger' as const : a === 'anonymize' ? 'warning' as const : 'info' as const;

const reqTone = (s?: string) =>
  s === 'completed' || s === 'exported' || s === 'erased' ? 'success' as const
  : s === 'failed' || s === 'error' ? 'danger' as const
  : 'warning' as const;

const ComplianceCenter: React.FC<{ embedded?: boolean }> = ({ embedded }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('overview');
  const [consentLogs, setConsentLogs] = useState<ConsentLog[]>([]);
  const [policies, setPolicies] = useState<RetentionPolicy[]>([]);
  const [exports, setExports] = useState<PiiRequest[]>([]);
  const [erasures, setErasures] = useState<PiiRequest[]>([]);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showEraseModal, setShowEraseModal] = useState(false);
  const [targetEntity, setTargetEntity] = useState('');
  const [exportResult, setExportResult] = useState<any>(null);
  const [editPolicy, setEditPolicy] = useState<RetentionPolicy | null>(null);
  const [policyForm, setPolicyForm] = useState({ retentionDays: 365, action: 'archive', enabled: true });
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const api = async (path: string, opts: RequestInit = {}) => {
    const res = await fetch(`/api/admin${path}`, { headers: adminAuthHeaders(), ...opts });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
    return data;
  };

  const loadData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [consentRes, retentionRes, reqRes] = await Promise.all([
        api('/compliance/consent-logs').catch(() => ({ logs: [] })),
        api('/compliance/retention-policies').catch(() => ({ policies: [] })),
        api('/compliance/requests').catch(() => ({ exports: [], erasures: [] })),
      ]);
      setConsentLogs(consentRes.logs || []);
      setPolicies(retentionRes.policies || []);
      setExports(reqRes.exports || []);
      setErasures(reqRes.erasures || []);
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleExport = async () => {
    setBusy('export');
    try {
      const data = await api('/compliance/pii-export', { method: 'POST', body: JSON.stringify({ targetEntity }) });
      if (data.success) {
        setExportResult(data.data);
        notify('PII export completed');
        loadData();
      } else { setError(data.error || 'Export failed'); }
    } catch (err: any) { setError(err.message); }
    finally { setBusy(null); }
  };

  const handleErase = async () => {
    setBusy('erase');
    try {
      const data = await api('/compliance/pii-erasure', { method: 'POST', body: JSON.stringify({ targetEntity }) });
      if (data.success) { setShowEraseModal(false); setTargetEntity(''); notify('PII erasure completed'); loadData(); }
      else { setError(data.error || 'Erasure failed'); }
    } catch (err: any) { setError(err.message); }
    finally { setBusy(null); }
  };

  const handleSavePolicy = async () => {
    if (!editPolicy) return;
    setBusy('policy');
    try {
      await api(`/compliance/retention-policies/${editPolicy.id}`, {
        method: 'PATCH', body: JSON.stringify(policyForm),
      });
      setEditPolicy(null); notify('Retention policy updated'); loadData();
    } catch (err: any) { setError(err.message); }
    finally { setBusy(null); }
  };

  const cards = [
    { title: 'Consent Records', value: consentLogs.length, icon: FileCheck2, tone: 'success' as const },
    { title: 'Active Policies', value: policies.filter(p => p.enabled).length, icon: Shield, tone: 'warning' as const },
    { title: 'PII Exports', value: exports.length, icon: Download, tone: 'info' as const },
    { title: 'PII Erasures', value: erasures.length, icon: UserX, tone: 'danger' as const },
  ];

  const actionButtons = (
    <>
      <button onClick={loadData} disabled={loading} className={button.secondary}>
        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
      </button>
      <button onClick={() => { setTargetEntity(''); setExportResult(null); setShowExportModal(true); }} className={button.primary}>
        <Download size={16} /> PII Export
      </button>
      <button onClick={() => { setTargetEntity(''); setShowEraseModal(true); }} className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-medium text-sm transition disabled:opacity-50">
        <Trash2 size={16} /> PII Erasure
      </button>
    </>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      {embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-500 dark:text-gray-400">GDPR tooling — consent management, PII export/erasure, and data retention</p>
          <div className="flex items-center gap-2 shrink-0">{actionButtons}</div>
        </div>
      ) : (
        <PageHeader
          title="Compliance Center"
          subtitle="GDPR tooling — consent management, PII export/erasure, and data retention"
          icon={Shield}
          actions={actionButtons}
        />
      )}

      {error && (
        <div className="p-4 rounded-xl text-sm font-bold flex items-center gap-2 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-100 dark:border-rose-500/20">
          <AlertTriangle size={16} /> {error}
        </div>
      )}
      {toast && (
        <div className={`p-4 rounded-xl text-sm font-bold flex items-center gap-2 border ${
          toast.type === 'success'
            ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-100 dark:border-emerald-500/20'
            : 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-100 dark:border-rose-500/20'
        }`}>
          {toast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />} {toast.msg}
        </div>
      )}

      {/* Tabs */}
      <div>
        <AdminSubTabBar tabs={TABS} activeTab={tab} onChange={setTab} />
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map(c => <StatCard key={c.title} title={c.title} value={c.value} icon={c.icon} tone={c.tone} />)}
        </div>
      )}

      {/* Consent Logs */}
      {tab === 'consent' && (
        <SectionCard title="Consent Logs" subtitle={`${consentLogs.length} records`} icon={FileCheck2} tone="success" pad="none">
          <ConsentTable logs={consentLogs} loading={loading} />
        </SectionCard>
      )}

      {/* Retention Policies */}
      {tab === 'retention' && (
        <SectionCard title="Retention Policies" subtitle={`${policies.filter(p => p.enabled).length} of ${policies.length} enabled`} icon={Clock} tone="warning" pad="none">
          <RetentionTable policies={policies} loading={loading} onEdit={(p) => { setEditPolicy(p); setPolicyForm({ retentionDays: p.retention_days, action: p.action, enabled: p.enabled }); }} />
        </SectionCard>
      )}

      {/* PII Requests */}
      {tab === 'requests' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SectionCard title="Export Requests" subtitle={`${exports.length} records`} icon={Download} tone="info" pad="none">
            <RequestTable rows={exports} loading={loading} kind="export" />
          </SectionCard>
          <SectionCard title="Erasure Requests" subtitle={`${erasures.length} records`} icon={UserX} tone="danger" pad="none">
            <RequestTable rows={erasures} loading={loading} kind="erasure" />
          </SectionCard>
        </div>
      )}

      {/* Export Modal */}
      <ModalSystem isOpen={showExportModal} onClose={() => setShowExportModal(false)} title="PII Export" subtitle="Export all data for a guest entity (GDPR right to access)" variant="form" size="lg" showFooter={false}>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Guest ID</label>
            <input value={targetEntity} onChange={e => setTargetEntity(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Enter guest UUID" />
          </div>
          {exportResult && (
            <div className="bg-slate-50 dark:bg-slate-950 rounded-2xl p-4 max-h-64 overflow-y-auto">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Exported Data</p>
              <pre className="text-[9px] font-mono text-slate-600 dark:text-slate-400 whitespace-pre-wrap">{JSON.stringify(exportResult, null, 2)}</pre>
            </div>
          )}
        </div>
        <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3 bg-slate-50 dark:bg-slate-950">
          <button onClick={() => setShowExportModal(false)} className={button.secondary}>Close</button>
          <button onClick={handleExport} disabled={!targetEntity.trim() || busy === 'export'} className={button.primary}>
            {busy === 'export' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Export Data
          </button>
        </div>
      </ModalSystem>

      {/* Erasure Modal */}
      <ModalSystem isOpen={showEraseModal} onClose={() => setShowEraseModal(false)} title="PII Erasure" subtitle="Anonymize guest PII data (GDPR right to erasure)" variant="form" size="md" showFooter={false}>
        <div className="p-6 space-y-4">
          <div className="p-4 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/20 rounded-2xl flex items-start gap-3">
            <AlertTriangle size={18} className="text-rose-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-black text-rose-600 dark:text-rose-400">Warning: This action is irreversible</p>
              <p className="text-[10px] font-bold text-rose-500 mt-1">All PII fields (name, email, phone, address, passport, nationality) will be anonymized. Financial records are retained for legal compliance.</p>
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Guest ID</label>
            <input value={targetEntity} onChange={e => setTargetEntity(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-rose-500" placeholder="Enter guest UUID" />
          </div>
        </div>
        <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3 bg-slate-50 dark:bg-slate-950">
          <button onClick={() => setShowEraseModal(false)} className={button.secondary}>Cancel</button>
          <button onClick={handleErase} disabled={!targetEntity.trim() || busy === 'erase'}
            className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-2xl bg-rose-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-rose-700 transition disabled:opacity-50">
            {busy === 'erase' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Erase PII
          </button>
        </div>
      </ModalSystem>

      {/* Policy Edit Modal */}
      <ModalSystem isOpen={!!editPolicy} onClose={() => setEditPolicy(null)} title="Edit Retention Policy" subtitle={editPolicy?.table_name} variant="form" size="sm" showFooter={false}>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Retention (days)</label>
            <input type="number" value={policyForm.retentionDays} onChange={e => setPolicyForm({ ...policyForm, retentionDays: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Action</label>
            <select value={policyForm.action} onChange={e => setPolicyForm({ ...policyForm, action: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="archive">Archive</option><option value="delete">Delete</option><option value="anonymize">Anonymize</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Enabled</label>
            <select value={String(policyForm.enabled)} onChange={e => setPolicyForm({ ...policyForm, enabled: e.target.value === 'true' })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="true">Active</option><option value="false">Disabled</option>
            </select>
          </div>
        </div>
        <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3 bg-slate-50 dark:bg-slate-950">
          <button onClick={() => setEditPolicy(null)} className={button.secondary}>Cancel</button>
          <button onClick={handleSavePolicy} disabled={busy === 'policy'} className={button.primary}>
            {busy === 'policy' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Save
          </button>
        </div>
      </ModalSystem>
    </div>
  );
};

// ── Table components ──────────────────────────────────────────────

const th = 'px-5 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400';
const td = 'px-5 py-3 text-sm';

function ConsentTable({ logs, loading }: { logs: ConsentLog[]; loading: boolean }) {
  if (logs.length === 0) return <div className="p-8 text-center text-sm text-gray-400">{loading ? 'Loading…' : 'No consent logs recorded.'}</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="border-b border-gray-200 dark:border-slate-700">
          <tr>
            <th className={th}>Guest</th><th className={th}>Type</th><th className={th}>Granted</th>
            <th className={th}>Policy</th><th className={th}>Timestamp</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
          {logs.map(l => (
            <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
              <td className={`${td} font-mono text-xs text-gray-500 dark:text-gray-400`}>{l.guest_id?.slice(0, 12) || '—'}</td>
              <td className={td}><span className="text-sm font-bold text-gray-800 dark:text-gray-200">{l.consent_type}</span></td>
              <td className={td}>{l.granted ? <Badge tone="success"><CheckCircle2 size={11} /> Granted</Badge> : <Badge tone="danger"><AlertTriangle size={11} /> Denied</Badge>}</td>
              <td className={td}><span className="text-xs font-bold text-gray-500">{l.policy_version || '—'}</span></td>
              <td className={td}><span className="text-xs text-gray-500 dark:text-gray-400">{new Date(l.timestamp).toLocaleString()}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RetentionTable({ policies, loading, onEdit }: { policies: RetentionPolicy[]; loading: boolean; onEdit: (p: RetentionPolicy) => void }) {
  if (policies.length === 0) return <div className="p-8 text-center text-sm text-gray-400">{loading ? 'Loading…' : 'No retention policies configured.'}</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="border-b border-gray-200 dark:border-slate-700">
          <tr>
            <th className={th}>Table</th><th className={th}>Retention</th><th className={th}>Action</th><th className={th}>Status</th><th className={th}></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
          {policies.map(p => (
            <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
              <td className={td}><span className="font-mono text-xs font-bold text-gray-800 dark:text-gray-200">{p.table_name}</span></td>
              <td className={td}><span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{p.retention_days} days</span></td>
              <td className={td}><Badge tone={actionTone(p.action)}>{p.action}</Badge></td>
              <td className={td}><Badge tone={p.enabled ? 'success' : 'neutral'}>{p.enabled ? 'Active' : 'Disabled'}</Badge></td>
              <td className={`${td} text-right`}>
                <button onClick={() => onEdit(p)} className={button.ghost}>Edit</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RequestTable({ rows, loading, kind }: { rows: PiiRequest[]; loading: boolean; kind: 'export' | 'erasure' }) {
  if (rows.length === 0) return <div className="p-8 text-center text-sm text-gray-400">{loading ? 'Loading…' : `No ${kind} requests.`}</div>;
  const ts = kind === 'export' ? 'exported_at' : 'erased_at';
  return (
    <div className="divide-y divide-gray-100 dark:divide-slate-700 max-h-96 overflow-y-auto">
      {rows.map(r => (
        <div key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-gray-900 dark:text-white font-mono">{r.target_entity?.slice(0, 12)}</span>
              <Badge tone={reqTone(r.status)}>{r.status}</Badge>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">requested {new Date(r.created_at).toLocaleString()}</div>
          </div>
          <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">{r[ts] ? new Date(r[ts]!).toLocaleString() : '—'}</span>
        </div>
      ))}
    </div>
  );
}

export default ComplianceCenter;
