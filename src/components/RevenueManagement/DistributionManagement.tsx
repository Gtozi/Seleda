import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Globe, Loader2, Lock, RefreshCw, ServerCrash, Settings, Trash2, Unlock, X, XCircle } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard } from '../FrontOffice/ui';
import { button } from '../FrontOffice/brandTheme';
import { rmsGet, rmsRequest } from '../../services/rmsService';

const API = '/api/rms-portal/distribution-management';


const formatTimestamp = (ts: string | null | undefined, fallback = '—'): string => {
  if (!ts) return fallback;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const diff = Date.now() - d.getTime();
  if (diff < 0) return d.toLocaleString();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return d.toLocaleString();
};

type DistChannel = { id: string; code: string; name: string; status: 'connected' | 'disconnected'; last_sync: string | null; availability_sync: boolean; rate_sync: boolean; booking_sync: boolean; parity_status: 'ok' | 'violation' | 'unknown'; active: boolean };
type ParityIssue = { id: string; channel: string; room_type: string; our_rate: number; channel_rate: number; diff_percent: number; status: 'violation' | 'warning'; active: boolean };
type DistRule = { id: string; channel: string; room_type: string; allocation: number; restriction: string; active: boolean };
type SyncSchedule = { id: string; sync_type: string; frequency: string; last_run: string | null; next_run: string | null; active: boolean };

export default function DistributionManagement() {
  const { currentPropertyId } = useERP();
  const [channels, setChannels] = useState<DistChannel[]>([]);
  const [parityIssues, setParityIssues] = useState<ParityIssue[]>([]);
  const [rules, setRules] = useState<DistRule[]>([]);
  const [syncSchedule, setSyncSchedule] = useState<SyncSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [showRuleForm, setShowRuleForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const json = await rmsGet(API, { propertyId: currentPropertyId });
      setChannels(json.channels || []); setParityIssues(json.parityIssues || []); setRules(json.rules || []); setSyncSchedule(json.syncSchedule || []);
    } catch (e: any) { setError(e.message || 'Failed to load distribution management'); }
    finally { setLoading(false); }
  }, [currentPropertyId]);
  useEffect(() => { load(); }, [load]);

  const request = (url: string, method: string, body?: unknown) =>
    rmsRequest(url, { method, body, propertyId: currentPropertyId });

  const toggleChannel = async (channel: DistChannel, field: 'availability_sync' | 'rate_sync' | 'booking_sync') => {
    setBusy(true); setError(null);
    try { await request(`${API}/channels/${channel.id}`, 'PUT', { [field]: !channel[field] }); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const saveRule = async (form: any) => {
    setBusy(true); setError(null);
    try { await request(`${API}/rules`, 'POST', form); setShowRuleForm(false); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const deleteRule = async (id: string) => {
    if (!confirm('Delete this distribution rule?')) return;
    setBusy(true); setError(null);
    try { await request(`${API}/rules/${id}`, 'DELETE'); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const syncAll = async () => {
    setBusy(true); setError(null);
    try { await request(`${API}/sync-all`, 'POST'); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  const connected = useMemo(() => channels.filter(c => c.status === 'connected').length, [channels]);
  const violations = useMemo(() => parityIssues.filter(p => p.status === 'violation' && p.active).length, [parityIssues]);
  const activeRules = useMemo(() => rules.filter(r => r.active).length, [rules]);
  const connectedPercent = useMemo(() => channels.length ? Math.round((connected / channels.length) * 100) : 0, [channels.length, connected]);

  if (loading && !channels.length) return <div className="p-6 flex justify-center py-20 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2"/>Loading distribution…</div>;
  if (error && !channels.length) return <div className="p-6 flex flex-col items-center py-20 text-rose-600"><ServerCrash className="w-10 h-10 mb-3"/><p>{error}</p><button onClick={load} className="mt-4 text-blue-600">Retry</button></div>;

  return <div className="p-6 space-y-6">
    <PageHeader title="Distribution Management" subtitle="Manage channel distribution, rate parity, and sync settings" actions={<button className={button.primary} onClick={syncAll} disabled={busy}>{busy&&<Loader2 className="w-4 h-4 animate-spin"/>}<RefreshCw className="w-4 h-4"/>Sync All</button>} />
    {error && <div className="px-4 py-2 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-600">{error}</div>}
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <StatCard title="Connected Channels" value={connected} icon={Globe} tone="info" />
      <StatCard title="Parity Violations" value={violations} icon={AlertTriangle} tone="danger" />
      <StatCard title="Active Rules" value={activeRules} icon={Settings} tone="warning" />
      <StatCard title="Connection Rate" value={`${connectedPercent}%`} icon={CheckCircle2} tone="success" />
    </div>

    <SectionCard title="Channel Connection Status" icon={Globe} pad="md">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {channels.map(channel => <div key={channel.code} onClick={() => setSelectedChannel(channel.id)} className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${selectedChannel === channel.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'}`}>
          <div className="flex justify-between mb-3"><div className="flex items-center gap-2"><Globe className="w-5 h-5 text-slate-600 dark:text-slate-400"/><h4 className="font-semibold text-slate-900 dark:text-white">{channel.name}</h4></div>{channel.status === 'connected' ? <CheckCircle2 className="w-5 h-5 text-green-500"/> : <XCircle className="w-5 h-5 text-red-500"/>}</div>
          <div className="space-y-2 text-sm"><div className="flex justify-between"><span className="text-slate-600 dark:text-slate-400">Status</span><span className={`font-medium ${channel.status === 'connected' ? 'text-green-600' : 'text-red-600'}`}>{channel.status}</span></div><div className="flex justify-between"><span className="text-slate-600 dark:text-slate-400">Last Sync</span><span className="text-slate-900 dark:text-white">{formatTimestamp(channel.last_sync, 'Never')}</span></div><div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-1">
            {(['availability_sync','rate_sync','booking_sync'] as const).map(f => <div key={f} className="flex items-center gap-2">{channel[f] ? <CheckCircle2 className="w-4 h-4 text-green-500"/> : <XCircle className="w-4 h-4 text-slate-400"/>}<span className="text-slate-600 dark:text-slate-400">{f.replace('_sync','').replace('_',' ')}</span></div>)}
          </div></div>
          {channel.parity_status === 'violation' && <div className="mt-3 p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg"><div className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-500"/><span className="text-xs text-amber-600 dark:text-amber-400 font-medium">Parity Violation</span></div></div>}
          <div className="mt-3 flex justify-end"><Toggle label="Availability" checked={channel.availability_sync} onChange={() => toggleChannel(channel, 'availability_sync')} disabled={busy}/></div>
        </div>)}
      </div>
    </SectionCard>

    <SectionCard title="Rate Parity Monitoring" icon={AlertTriangle} pad="md" actions={<span className="text-sm text-slate-600 dark:text-slate-400">{violations} violations</span>}>
      <div className="space-y-3">
        {parityIssues.filter(p=>p.active).map(issue => <div key={issue.id} className={`flex justify-between p-4 rounded-lg border ${issue.status === 'violation' ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'}`}>
          <div className="flex items-center gap-3"><AlertTriangle className={`w-5 h-5 ${issue.status === 'violation' ? 'text-red-500' : 'text-amber-500'}`}/><div><div className="flex items-center gap-2 mb-1"><h4 className="font-medium text-slate-900 dark:text-white">{issue.channel}</h4><span className="text-sm text-slate-600 dark:text-slate-400">• {issue.room_type}</span></div><div className="flex gap-4 text-sm text-slate-600 dark:text-slate-400"><span>Our rate: ${issue.our_rate}</span><span>Channel: ${issue.channel_rate}</span></div></div></div>
          <div className="text-right"><p className={`text-lg font-semibold ${issue.status === 'violation' ? 'text-red-600' : 'text-amber-600'}`}>{issue.diff_percent > 0 ? '+' : ''}{issue.diff_percent}%</p><p className="text-xs text-slate-600 dark:text-slate-400">difference</p></div>
        </div>)}
        {!parityIssues.filter(p=>p.active).length && <p className="text-center py-8 text-slate-500">No parity issues</p>}
      </div>
    </SectionCard>

    <SectionCard title="Distribution Rules" icon={Settings} pad="md" actions={<button className={button.primary} onClick={() => setShowRuleForm(true)} disabled={busy}><Settings className="w-4 h-4"/>Add Rule</button>}>
      <div className="space-y-3">
        {rules.map(rule => <div key={rule.id} className="flex justify-between p-4 rounded-lg border bg-slate-50 dark:bg-slate-700/50">
          <div className="flex items-center gap-3">{rule.active ? <Unlock className="w-5 h-5 text-green-500"/> : <Lock className="w-5 h-5 text-slate-400"/>}<div><div className="flex items-center gap-2 mb-1"><h4 className="font-medium text-slate-900 dark:text-white">{rule.channel}</h4><span className="text-sm text-slate-600 dark:text-slate-400">• {rule.room_type}</span></div><div className="flex gap-4 text-sm text-slate-600 dark:text-slate-400"><span>Allocation: {rule.allocation}%</span><span>Restriction: {rule.restriction}</span></div></div></div>
          <div className="flex items-center gap-2"><Toggle label="Active" checked={rule.active} onChange={v => request(`${API}/rules/${rule.id}`, 'PUT', { active: v }).then(load).catch((e: any) => setError(e.message))} disabled={busy}/><IconButton title="Delete" onClick={() => deleteRule(rule.id)} disabled={busy}><Trash2 className="w-4 h-4 text-red-600"/></IconButton></div>
        </div>)}
        {!rules.length && <p className="text-center py-8 text-slate-500">No distribution rules</p>}
      </div>
    </SectionCard>

    <SectionCard title="Sync Schedule" icon={RefreshCw} pad="md">
      <div className="space-y-3">
        {syncSchedule.map(s => <div key={s.id} className="flex justify-between p-4 rounded-lg border bg-slate-50 dark:bg-slate-700/50">
          <div className="flex items-center gap-3"><RefreshCw className="w-5 h-5 text-blue-500"/><div><h4 className="font-medium text-slate-900 dark:text-white">{s.sync_type}</h4><p className="text-sm text-slate-600 dark:text-slate-400">Frequency: {s.frequency}</p></div></div>
          <div className="flex items-center gap-6 text-sm"><div><p className="text-slate-600 dark:text-slate-400">Last Run</p><p className="font-medium text-slate-900 dark:text-white">{formatTimestamp(s.last_run, 'Never')}</p></div><div><p className="text-slate-600 dark:text-slate-400">Next Run</p><p className="font-medium text-slate-900 dark:text-white">{formatTimestamp(s.next_run, '—')}</p></div></div>
        </div>)}
      </div>
    </SectionCard>

    {showRuleForm && <RuleForm onCancel={() => setShowRuleForm(false)} onSave={saveRule} saving={busy} />}
  </div>;
}

function IconButton({ title, onClick, disabled, children }: { title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) { return <button title={title} onClick={onClick} disabled={disabled} className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-400 disabled:opacity-50">{children}</button>; }
const fieldClass = "w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white";
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm font-medium text-slate-700 dark:text-slate-300"><span className="block mb-1">{label}</span>{children}</label>; }
function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) { return <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"><div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto"><div className="p-5 border-b flex justify-between items-center"><h3 className="font-semibold text-lg text-slate-900 dark:text-white">{title}</h3><button onClick={onClose} className="text-slate-500"><X className="w-5 h-5"/></button></div><div className="p-5">{children}</div>{footer && <div className="p-5 border-t flex justify-end gap-3">{footer}</div>}</div></div>; }
function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) { return <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400"><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} disabled={disabled} className="rounded"/>{label}</label>; }

function RuleForm({ onCancel, onSave, saving }: { onCancel: () => void; onSave: (f: any) => void; saving: boolean }) {
  const [f, setF] = useState({ channel: '', room_type: '', allocation: 0, restriction: 'None', active: true });
  const set = (k: string, v: any) => setF(p => ({ ...p, [k]: v }));
  return <Modal title="Add Distribution Rule" onClose={onCancel} footer={<><button className={button.secondary} onClick={onCancel}>Cancel</button><button className={button.primary} disabled={saving || !f.channel || !f.room_type} onClick={() => onSave(f)}>{saving && <Loader2 className="w-4 h-4 animate-spin"/>}Save</button></>}>
    <div className="space-y-4">
      <Field label="Channel"><input className={fieldClass} value={f.channel} onChange={e=>set('channel',e.target.value)}/></Field>
      <Field label="Room Type"><input className={fieldClass} value={f.room_type} onChange={e=>set('room_type',e.target.value)}/></Field>
      <div className="grid grid-cols-2 gap-4"><Field label="Allocation %"><input type="number" className={fieldClass} value={f.allocation} onChange={e=>set('allocation',Number(e.target.value))}/></Field><Field label="Restriction"><input className={fieldClass} value={f.restriction} onChange={e=>set('restriction',e.target.value)}/></Field></div>
      <Toggle label="Active" checked={f.active} onChange={v=>set('active',v)} disabled={saving}/>
    </div>
  </Modal>;
}
