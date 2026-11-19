import { useCallback, useEffect, useMemo, useState } from 'react';
import { useERP } from '../../context/ERPContext';
import { AlertTriangle, Calendar, CheckCircle2, Clock, Loader2, Lock, Plus, ServerCrash, Settings, Trash2, Unlock, X, XCircle } from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard } from '../FrontOffice/ui';
import { button } from '../FrontOffice/brandTheme';
import { rmsGet, rmsRequest } from '../../services/rmsService';

const API = '/api/rms-portal/restrictions-management';


type RestrictionType = 'los' | 'cta' | 'ctd' | 'stopsell' | 'rate' | 'booking';
type Restriction = { id: string; restriction_type: RestrictionType; room_type: string; dates: string; min_nights: number | null; max_nights: number | null; reason: string | null; min_rate: number | null; max_rate: number | null; min_advance: number | null; max_advance: number | null; active: boolean };
type Alert = { id: string; alert_type: 'warning' | 'info' | 'error'; message: string; date_range: string | null; active: boolean };

const restrictionLabels: Record<RestrictionType, string> = {
  los: 'Length of Stay (MinLOS/MaxLOS)',
  cta: 'Closed to Arrival (CTA)',
  ctd: 'Closed to Departure (CTD)',
  stopsell: 'Stop Sell',
  rate: 'Rate Restrictions',
  booking: 'Booking Windows',
};

const alertTypeConfig: Record<string, { icon: React.ElementType; color: string; iconColor: string }> = {
  warning: { icon: AlertTriangle, color: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800', iconColor: 'text-amber-500' },
  info: { icon: Clock, color: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800', iconColor: 'text-blue-500' },
  error: { icon: Lock, color: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800', iconColor: 'text-red-500' },
};

export default function RestrictionsManagement() {
  const { currentPropertyId } = useERP();
  const [restrictions, setRestrictions] = useState<Restriction[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedRestriction, setSelectedRestriction] = useState<string | null>(null);
  const [restrictionType, setRestrictionType] = useState<RestrictionType>('los');
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const json = await rmsGet(API, { propertyId: currentPropertyId });
      setRestrictions(json.restrictions || []); setAlerts(json.alerts || []);
    } catch (e: any) { setError(e.message || 'Failed to load restrictions'); }
    finally { setLoading(false); }
  }, [currentPropertyId]);
  useEffect(() => { load(); }, [load]);

  const request = (url: string, method: string, body?: unknown) =>
    rmsRequest(url, { method, body, propertyId: currentPropertyId });
  const saveRestriction = async (form: any) => {
    setBusy(true); setError(null);
    try { await request(`${API}/restrictions`, 'POST', { ...form, propertyId: currentPropertyId }); setShowForm(false); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const toggleRestriction = async (r: Restriction) => {
    setBusy(true); setError(null);
    try { await request(`${API}/restrictions/${r.id}`, 'PUT', { active: !r.active, propertyId: currentPropertyId }); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const deleteRestriction = async (id: string) => {
    if (!confirm('Delete this restriction?')) return;
    setBusy(true); setError(null);
    try { await request(`${API}/restrictions/${id}`, 'DELETE', { propertyId: currentPropertyId }); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const deleteAlert = async (id: string) => {
    if (!confirm('Delete this alert?')) return;
    setBusy(true); setError(null);
    try { await request(`${API}/alerts/${id}`, 'DELETE', { propertyId: currentPropertyId }); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  const filtered = useMemo(() => restrictions.filter(r => r.restriction_type === restrictionType), [restrictions, restrictionType]);
  const activeCount = useMemo(() => restrictions.filter(r => r.active).length, [restrictions]);
  const activeAlerts = useMemo(() => alerts.filter(a => a.active), [alerts]);

  if (loading && !restrictions.length) return <div className="p-6 flex justify-center py-20 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2"/>Loading restrictions…</div>;
  if (error && !restrictions.length) return <div className="p-6 flex flex-col items-center py-20 text-rose-600"><ServerCrash className="w-10 h-10 mb-3"/><p>{error}</p><button onClick={load} className="mt-4 text-blue-600">Retry</button></div>;

  return <div className="p-6 space-y-6">
    <PageHeader title="Restrictions Management" subtitle="Manage stay restrictions and booking controls" actions={<button className={button.primary} onClick={() => setShowForm(true)} disabled={busy}><Plus className="w-4 h-4"/>Add Restriction</button>} />
    {error && <div className="px-4 py-2 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-600">{error}</div>}
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <StatCard title="Total Restrictions" value={restrictions.length} icon={Lock} tone="info" />
      <StatCard title="Active Restrictions" value={activeCount} icon={CheckCircle2} tone="success" />
      <StatCard title="Active Alerts" value={activeAlerts.length} icon={AlertTriangle} tone="warning" />
      <StatCard title="Restriction Types" value={Object.keys(restrictionLabels).length} icon={Settings} tone="accent" />
    </div>

    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4">
      <div className="flex gap-2 overflow-x-auto">
        {Object.entries(restrictionLabels).map(([key, label]) => <button key={key} onClick={() => setRestrictionType(key as RestrictionType)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${restrictionType === key ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>{label}</button>)}
      </div>
    </div>

    <SectionCard title={restrictionLabels[restrictionType]} icon={Calendar} pad="md">
      <div className="space-y-3">
        {filtered.map(r => <div key={r.id} onClick={() => setSelectedRestriction(r.id)} className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${selectedRestriction === r.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'}`}>
          <div className="flex items-start justify-between mb-3"><div className="flex-1"><div className="flex items-center gap-2 mb-1"><h4 className="font-medium text-slate-900 dark:text-white">{r.room_type}</h4>{r.active ? <CheckCircle2 className="w-4 h-4 text-green-500"/> : <XCircle className="w-4 h-4 text-slate-400"/>}</div><p className="text-sm text-slate-600 dark:text-slate-400">{r.dates}</p></div><div className="flex items-center gap-2"><button onClick={(e)=>{e.stopPropagation();toggleRestriction(r)}} disabled={busy} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors">{r.active ? <Lock className="w-4 h-4 text-slate-600"/> : <Unlock className="w-4 h-4 text-slate-600"/>}</button><button onClick={(e)=>{e.stopPropagation();deleteRestriction(r.id)}} disabled={busy} className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"><Trash2 className="w-4 h-4 text-red-600"/></button></div></div>
          <div className="text-sm text-slate-600 dark:text-slate-400">
            {r.restriction_type === 'los' && <span>Min: {r.min_nights} nights • Max: {r.max_nights} nights</span>}
            {(r.restriction_type === 'cta' || r.restriction_type === 'ctd' || r.restriction_type === 'stopsell') && <span>Reason: {r.reason}</span>}
            {r.restriction_type === 'rate' && <span>Min: ${r.min_rate} • Max: ${r.max_rate}</span>}
            {r.restriction_type === 'booking' && <span>Min: {r.min_advance} days • Max: {r.max_advance} days</span>}
          </div>
        </div>)}
        {!filtered.length && <p className="text-center py-8 text-slate-500">No {restrictionLabels[restrictionType]} restrictions</p>}
      </div>
    </SectionCard>

    <SectionCard title="Active Restriction Alerts" icon={AlertTriangle} pad="md">
      <div className="space-y-3">
        {activeAlerts.map(alert => { const config = alertTypeConfig[alert.alert_type] || alertTypeConfig.info; const Icon = config.icon; return <div key={alert.id} className={`flex items-center gap-3 p-4 rounded-lg border ${config.color}`}><Icon className={`w-5 h-5 ${config.iconColor}`}/><div className="flex-1"><p className="font-medium text-slate-900 dark:text-white">{alert.message}</p><p className="text-sm text-slate-600 dark:text-slate-400">{alert.date_range}</p></div><button onClick={() => deleteAlert(alert.id)} disabled={busy} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors"><Trash2 className="w-4 h-4 text-red-600"/></button></div>; })}
        {!activeAlerts.length && <p className="text-center py-8 text-slate-500">No active alerts</p>}
      </div>
    </SectionCard>

    {showForm && <RestrictionForm onCancel={() => setShowForm(false)} onSave={saveRestriction} saving={busy} />}
  </div>;
}

const fieldClass = "w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white";
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm font-medium text-slate-700 dark:text-slate-300"><span className="block mb-1">{label}</span>{children}</label>; }
function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) { return <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"><div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto"><div className="p-5 border-b flex justify-between items-center"><h3 className="font-semibold text-lg text-slate-900 dark:text-white">{title}</h3><button onClick={onClose} className="text-slate-500"><X className="w-5 h-5"/></button></div><div className="p-5">{children}</div>{footer && <div className="p-5 border-t flex justify-end gap-3">{footer}</div>}</div></div>; }

function RestrictionForm({ onCancel, onSave, saving }: { onCancel: () => void; onSave: (f: any) => void; saving: boolean }) {
  const [f, setF] = useState({ restriction_type: 'los' as RestrictionType, room_type: '', dates: 'All dates', min_nights: 0, max_nights: 0, reason: '', min_rate: 0, max_rate: 0, min_advance: 0, max_advance: 0, active: true });
  const set = (k: string, v: any) => setF(p => ({ ...p, [k]: v }));
  return <Modal title="Add Restriction" onClose={onCancel} footer={<><button className={button.secondary} onClick={onCancel}>Cancel</button><button className={button.primary} disabled={saving || !f.room_type} onClick={() => onSave(f)}>{saving && <Loader2 className="w-4 h-4 animate-spin"/>}Save</button></>}>
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4"><Field label="Type"><select className={fieldClass} value={f.restriction_type} onChange={e=>set('restriction_type',e.target.value as RestrictionType)}>{Object.entries(restrictionLabels).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></Field><Field label="Room Type"><input className={fieldClass} value={f.room_type} onChange={e=>set('room_type',e.target.value)}/></Field></div>
      <Field label="Dates"><input className={fieldClass} value={f.dates} onChange={e=>set('dates',e.target.value)}/></Field>
      {f.restriction_type === 'los' && <div className="grid grid-cols-2 gap-4"><Field label="Min Nights"><input type="number" className={fieldClass} value={f.min_nights} onChange={e=>set('min_nights',Number(e.target.value))}/></Field><Field label="Max Nights"><input type="number" className={fieldClass} value={f.max_nights} onChange={e=>set('max_nights',Number(e.target.value))}/></Field></div>}
      {(f.restriction_type === 'cta' || f.restriction_type === 'ctd' || f.restriction_type === 'stopsell') && <Field label="Reason"><input className={fieldClass} value={f.reason} onChange={e=>set('reason',e.target.value)}/></Field>}
      {f.restriction_type === 'rate' && <div className="grid grid-cols-2 gap-4"><Field label="Min Rate"><input type="number" className={fieldClass} value={f.min_rate} onChange={e=>set('min_rate',Number(e.target.value))}/></Field><Field label="Max Rate"><input type="number" className={fieldClass} value={f.max_rate} onChange={e=>set('max_rate',Number(e.target.value))}/></Field></div>}
      {f.restriction_type === 'booking' && <div className="grid grid-cols-2 gap-4"><Field label="Min Advance (days)"><input type="number" className={fieldClass} value={f.min_advance} onChange={e=>set('min_advance',Number(e.target.value))}/></Field><Field label="Max Advance (days)"><input type="number" className={fieldClass} value={f.max_advance} onChange={e=>set('max_advance',Number(e.target.value))}/></Field></div>}
      <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400"><input type="checkbox" checked={f.active} onChange={e=>set('active',e.target.checked)} className="rounded"/>Active</label>
    </div>
  </Modal>;
}
