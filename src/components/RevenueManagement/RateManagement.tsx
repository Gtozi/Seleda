import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, CheckCircle2, Copy, DollarSign, Edit, Loader2, Plus, ServerCrash, Star, Trash2, X, XCircle } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { Badge, PageHeader, SectionCard } from '../FrontOffice/ui';
import { button } from '../FrontOffice/brandTheme';
import { rmsGet, rmsRequest } from '../../services/rmsService';

const API = '/api/rms-portal/rate-management';


type RatePlan = { id: string; name: string; code: string; plan_type: string; base_rate: number; currency: string; active: boolean; description: string | null; features: string[] };
type SeasonalRate = { id: string; name: string; start_date: string; end_date: string; adjustment: number; active: boolean };
type WeekendRate = { id: string; room_type: string; weekday_rate: number; weekend_rate: number; active: boolean };

type EditState = { type: 'plan' | 'season' | 'weekend'; data: any };

export default function RateManagement() {
  const { currentPropertyId } = useERP();
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([]);
  const [seasonalRates, setSeasonalRates] = useState<SeasonalRate[]>([]);
  const [weekendRates, setWeekendRates] = useState<WeekendRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<EditState | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const json = await rmsGet(API, { propertyId: currentPropertyId });
      setRatePlans(json.ratePlans || []); setSeasonalRates(json.seasonalRates || []); setWeekendRates(json.weekendRates || []);
    } catch (e: any) { setError(e.message || 'Failed to load rate management'); }
    finally { setLoading(false); }
  }, [currentPropertyId]);
  useEffect(() => { load(); }, [load]);

  const request = (url: string, method: string, body?: unknown) =>
    rmsRequest(url, { method, body, propertyId: currentPropertyId });

  const save = async (payload: any) => {
    if (!edit) return; setBusy(true); setError(null);
    try {
      const id = edit.data?.id;
      const segments: Record<string, string> = { plan: 'plans', season: 'seasonal', weekend: 'weekend' };
      await request(id ? `${API}/${segments[edit.type]}/${id}` : `${API}/${segments[edit.type]}`, id ? 'PUT' : 'POST', payload);
      setEdit(undefined); await load();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const remove = async (type: 'plan' | 'season' | 'weekend', id: string) => {
    if (!confirm('Delete this record?')) return;
    setBusy(true); setError(null);
    try { const segments: Record<string, string> = { plan: 'plans', season: 'seasonal', weekend: 'weekend' }; await request(`${API}/${segments[type]}/${id}`, 'DELETE'); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  const activePlans = useMemo(() => ratePlans.filter(r => r.active).length, [ratePlans]);
  const avgRate = useMemo(() => ratePlans.length ? Math.round(ratePlans.reduce((s, r) => s + Number(r.base_rate), 0) / ratePlans.length) : 0, [ratePlans]);
  const weekendSpread = useMemo(() => weekendRates.length ? Math.round(weekendRates.reduce((s, r) => s + (Number(r.weekend_rate) - Number(r.weekday_rate)), 0) / weekendRates.length) : 0, [weekendRates]);

  if (loading && !ratePlans.length) return <div className="p-6 flex justify-center py-20 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2"/>Loading rate management…</div>;
  if (error && !ratePlans.length) return <div className="p-6 flex flex-col items-center py-20 text-rose-600"><ServerCrash className="w-10 h-10 mb-3"/><p>{error}</p><button onClick={load} className="mt-4 text-blue-600">Retry</button></div>;

  return <div className="p-6 space-y-6">
    <PageHeader title="Rate Management" subtitle="Manage rate plans, seasonal rates, and weekend differentials" actions={<button className={button.primary} onClick={() => setEdit({ type: 'plan', data: null })} disabled={busy}><Plus className="w-4 h-4"/>New Rate Plan</button>} />
    {error && <div className="px-4 py-2 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-600">{error}</div>}
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <StatCard title="Rate Plans" value={ratePlans.length} icon={DollarSign} tone="info" />
      <StatCard title="Active Plans" value={activePlans} icon={CheckCircle2} tone="success" />
      <StatCard title="Avg Base Rate" value={`USD ${avgRate}`} icon={Star} tone="accent" />
      <StatCard title="Weekend Spread" value={`+${weekendSpread}`} icon={Calendar} tone="warning" />
    </div>

    <SectionCard title="Rate Plans" icon={DollarSign} pad="md">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {ratePlans.map(plan => <div key={plan.id} className="p-4 rounded-lg border-2 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 transition-all">
          <div className="flex justify-between mb-2">
            <div><div className="flex items-center gap-2 mb-1"><h4 className="font-semibold text-slate-900 dark:text-white">{plan.name}</h4><Badge tone="neutral">{plan.code}</Badge></div><p className="text-sm text-slate-600 dark:text-slate-400">{plan.description || plan.plan_type}</p></div>
            {plan.active ? <CheckCircle2 className="w-5 h-5 text-green-500"/> : <XCircle className="w-5 h-5 text-slate-400"/>}
          </div>
          <div className="flex justify-between items-end mb-3"><span className="text-sm text-slate-600 dark:text-slate-400">{plan.plan_type}</span><span className="text-lg font-bold text-slate-900 dark:text-white">{plan.currency} {plan.base_rate}</span></div>
          <div className="flex flex-wrap gap-1 mb-3">{(plan.features || []).slice(0, 3).map((f, i) => <span key={i} className="text-xs text-slate-600 dark:text-slate-400">• {f}</span>)}</div>
          <div className="flex gap-1 pt-3 border-t border-slate-200 dark:border-slate-700"><IconButton title="Edit" onClick={() => setEdit({ type: 'plan', data: plan })}><Edit className="w-4 h-4 text-slate-500"/></IconButton><IconButton title="Duplicate" onClick={() => setEdit({ type: 'plan', data: { ...plan, id: '', name: `${plan.name} Copy`, code: `${plan.code}_COPY` } })}><Copy className="w-4 h-4 text-slate-500"/></IconButton><IconButton title="Delete" onClick={() => remove('plan', plan.id)} disabled={busy}><Trash2 className="w-4 h-4 text-red-600"/></IconButton></div>
        </div>)}
      </div>
    </SectionCard>

    <SectionCard title="Seasonal Rates" icon={Calendar} pad="md" actions={<button className={button.primary} onClick={() => setEdit({ type: 'season', data: null })} disabled={busy}><Plus className="w-4 h-4"/>Add Season</button>}>
      <div className="space-y-3">
        {seasonalRates.map(s => <div key={s.id} className="flex justify-between p-4 rounded-lg border bg-slate-50 dark:bg-slate-700/50">
          <div><div className="flex items-center gap-2 mb-1"><h4 className="font-medium text-slate-900 dark:text-white">{s.name}</h4><Badge tone={s.active ? 'success' : 'neutral'}>{s.active ? 'Active' : 'Inactive'}</Badge></div><p className="text-sm text-slate-600 dark:text-slate-400">{s.start_date} → {s.end_date}</p></div>
          <div className="text-right flex flex-col items-end gap-1"><p className={`text-lg font-semibold ${s.adjustment >= 0 ? 'text-green-600' : 'text-red-600'}`}>{s.adjustment >= 0 ? '+' : ''}{s.adjustment}%</p><div className="flex gap-1"><IconButton title="Edit" onClick={() => setEdit({ type: 'season', data: s })}><Edit className="w-4 h-4"/></IconButton><IconButton title="Delete" onClick={() => remove('season', s.id)} disabled={busy}><Trash2 className="w-4 h-4 text-red-600"/></IconButton></div></div>
        </div>)}
        {!seasonalRates.length && <p className="text-center py-8 text-slate-500">No seasonal rates</p>}
      </div>
    </SectionCard>

    <SectionCard title="Weekend Rates" icon={Calendar} pad="md" actions={<button className={button.primary} onClick={() => setEdit({ type: 'weekend', data: null })} disabled={busy}><Plus className="w-4 h-4"/>Configure</button>}>
      <div className="space-y-3">
        {weekendRates.map(w => <div key={w.id} className="flex justify-between p-4 rounded-lg border bg-slate-50 dark:bg-slate-700/50">
          <div><div className="flex items-center gap-2 mb-1"><h4 className="font-medium text-slate-900 dark:text-white">{w.room_type}</h4><Badge tone={w.active ? 'success' : 'neutral'}>{w.active ? 'Active' : 'Inactive'}</Badge></div><div className="flex gap-4 text-sm text-slate-600 dark:text-slate-400"><span>Weekday: ${w.weekday_rate}</span><span>Weekend: ${w.weekend_rate}</span></div></div>
          <div className="text-right flex flex-col items-end gap-1"><p className="text-lg font-semibold text-green-600">+{Math.round(((w.weekend_rate - w.weekday_rate) / w.weekday_rate) * 100)}%</p><div className="flex gap-1"><IconButton title="Edit" onClick={() => setEdit({ type: 'weekend', data: w })}><Edit className="w-4 h-4"/></IconButton><IconButton title="Delete" onClick={() => remove('weekend', w.id)} disabled={busy}><Trash2 className="w-4 h-4 text-red-600"/></IconButton></div></div>
        </div>)}
        {!weekendRates.length && <p className="text-center py-8 text-slate-500">No weekend rates configured</p>}
      </div>
    </SectionCard>

    {edit && <FormModal edit={edit} busy={busy} onCancel={() => setEdit(undefined)} onSave={save} />}
  </div>;
}

function IconButton({ title, onClick, disabled, children }: { title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) { return <button title={title} onClick={onClick} disabled={disabled} className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-400 disabled:opacity-50">{children}</button>; }
const fieldClass = "w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white";
function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) { return <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"><div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto"><div className="p-5 border-b flex justify-between items-center"><h3 className="font-semibold text-lg text-slate-900 dark:text-white">{title}</h3><button onClick={onClose}><X className="w-5 h-5 text-slate-500"/></button></div><div className="p-5">{children}</div>{footer && <div className="p-5 border-t flex justify-end gap-3">{footer}</div>}</div></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm font-medium text-slate-700 dark:text-slate-300"><span className="block mb-1">{label}</span>{children}</label>; }
function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) { return <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400"><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} disabled={disabled} className="rounded"/>{label}</label>; }

function FormModal({ edit, busy, onCancel, onSave }: { edit: EditState; busy: boolean; onCancel: () => void; onSave: (v: any) => void }) {
  const [f, setF] = useState<any>(() => {
    const d = edit.data ?? {};
    if (edit.type === 'plan') return { name: d.name || '', code: d.code || '', plan_type: d.plan_type || 'Standard', base_rate: d.base_rate ?? 0, currency: d.currency || 'USD', active: d.active ?? true, description: d.description || '', features: (d.features || []).join(', ') };
    if (edit.type === 'season') return { name: d.name || '', start_date: d.start_date || '', end_date: d.end_date || '', adjustment: d.adjustment ?? 0, active: d.active ?? true };
    return { room_type: d.room_type || '', weekday_rate: d.weekday_rate ?? 0, weekend_rate: d.weekend_rate ?? 0, active: d.active ?? true };
  });
  const set = (k: string, v: any) => setF((p:any)=>({...p,[k]:v}));
  const titles: Record<string,string> = { plan: 'Rate Plan', season: 'Seasonal Rate', weekend: 'Weekend Rate' };
  const footer = <><button className={button.secondary} onClick={onCancel}>Cancel</button><button className={button.primary} disabled={busy} onClick={() => { const payload = { ...f }; if (edit.type === 'plan') payload.features = (payload.features || '').split(',').map((x:string)=>x.trim()).filter(Boolean); onSave(payload); }}>{busy && <Loader2 className="w-4 h-4 animate-spin"/>}Save</button></>;
  return <Modal title={`${edit.data?.id ? 'Edit' : 'Add'} ${titles[edit.type]}`} onClose={onCancel} footer={footer}>
    <div className="space-y-4">
      {edit.type === 'plan' && <>
        <div className="grid grid-cols-2 gap-4"><Field label="Name"><input className={fieldClass} value={f.name} onChange={e=>set('name',e.target.value)}/></Field><Field label="Code"><input className={fieldClass} value={f.code} onChange={e=>set('code',e.target.value)}/></Field></div>
        <div className="grid grid-cols-2 gap-4"><Field label="Plan Type"><select className={fieldClass} value={f.plan_type} onChange={e=>set('plan_type',e.target.value)}><option>Standard</option><option>Corporate</option><option>Government</option><option>OTA</option><option>Package</option><option>Loyalty</option></select></Field><Field label="Currency"><input className={fieldClass} value={f.currency} onChange={e=>set('currency',e.target.value)}/></Field></div>
        <Field label="Base Rate"><input type="number" className={fieldClass} value={f.base_rate} onChange={e=>set('base_rate',Number(e.target.value))}/></Field>
        <Field label="Description"><input className={fieldClass} value={f.description} onChange={e=>set('description',e.target.value)}/></Field>
        <Field label="Features (comma separated)"><input className={fieldClass} value={f.features} onChange={e=>set('features',e.target.value)}/></Field>
      </>}
      {edit.type === 'season' && <>
        <Field label="Season Name"><input className={fieldClass} value={f.name} onChange={e=>set('name',e.target.value)}/></Field>
        <div className="grid grid-cols-2 gap-4"><Field label="Start Date"><input type="date" className={fieldClass} value={f.start_date} onChange={e=>set('start_date',e.target.value)}/></Field><Field label="End Date"><input type="date" className={fieldClass} value={f.end_date} onChange={e=>set('end_date',e.target.value)}/></Field></div>
        <Field label="Adjustment %"><input type="number" className={fieldClass} value={f.adjustment} onChange={e=>set('adjustment',Number(e.target.value))}/></Field>
      </>}
      {edit.type === 'weekend' && <>
        <Field label="Room Type"><input className={fieldClass} value={f.room_type} onChange={e=>set('room_type',e.target.value)}/></Field>
        <div className="grid grid-cols-2 gap-4"><Field label="Weekday Rate"><input type="number" className={fieldClass} value={f.weekday_rate} onChange={e=>set('weekday_rate',Number(e.target.value))}/></Field><Field label="Weekend Rate"><input type="number" className={fieldClass} value={f.weekend_rate} onChange={e=>set('weekend_rate',Number(e.target.value))}/></Field></div>
      </>}
      <Toggle checked={f.active} onChange={v=>set('active',v)} label="Active"/>
    </div>
  </Modal>;
}
