import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, CheckCircle2, DollarSign, Loader2, Plus, RefreshCw, ServerCrash, Settings, TrendingUp, X, XCircle, Zap } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { Badge, PageHeader, SectionCard } from '../FrontOffice/ui';
import { button } from '../FrontOffice/brandTheme';
import { rmsGet, rmsRequest } from '../../services/rmsService';

const API = '/api/rms-portal/dynamic-pricing';


type Strategy = { id: string; code: string; name: string; description: string | null; active: boolean; auto_update: boolean };
type Rule = { id: string; room_type: string; strategy_code: string; condition_type: string; threshold_value: number | null; threshold_label: string | null; adjustment: number; active: boolean };
type Adjustment = { id: string; room_type: string; old_rate: number; new_rate: number; reason: string; created_at: string };

export default function DynamicPricing() {
  const { currentPropertyId } = useERP();
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState<string>('bar');
  const [ruleForm, setRuleForm] = useState<Rule | null | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const json = await rmsGet(API, { propertyId: currentPropertyId });
      setStrategies(json.strategies || []); setRules(json.rules || []); setAdjustments(json.adjustments || []);
    } catch (e: any) { setError(e.message || 'Failed to load dynamic pricing'); }
    finally { setLoading(false); }
  }, [currentPropertyId]);
  useEffect(() => { load(); }, [load]);

  const request = (url: string, method: string, body?: unknown) =>
    rmsRequest(url, { method, body, propertyId: currentPropertyId });

  const toggleStrategy = async (strategy: Strategy) => {
    setBusy(true); setError(null);
    try { await request(`${API}/strategies/${strategy.id}`, 'PUT', { active: !strategy.active }); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const saveRule = async (form: any) => {
    setBusy(true);
    try {
      const id = ruleForm?.id;
      await request(id ? `${API}/rules/${id}` : `${API}/rules`, id ? 'PUT' : 'POST', form);
      setRuleForm(undefined); await load();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const deleteRule = async (id: string) => {
    if (!confirm('Delete this pricing rule?')) return;
    setBusy(true);
    try { await request(`${API}/rules/${id}`, 'DELETE'); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const generate = async () => {
    setBusy(true);
    try { await request(`${API}/generate`, 'POST'); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  const activeStrategies = useMemo(() => strategies.filter(s => s.active).length, [strategies]);
  const activeRules = useMemo(() => rules.filter(r => r.active).length, [rules]);
  const avgLift = useMemo(() => {
    if (!adjustments.length) return 0;
    const total = adjustments.reduce((sum, a) => sum + ((a.new_rate - a.old_rate) / a.old_rate) * 100, 0);
    return Math.round(total / adjustments.length);
  }, [adjustments]);
  const selectedRules = useMemo(() => rules.filter(r => r.strategy_code === selectedStrategy), [rules, selectedStrategy]);

  if (loading && !strategies.length) return <div className="p-6 flex justify-center py-20 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2" />Loading dynamic pricing…</div>;
  if (error && !strategies.length) return <div className="p-6 flex flex-col items-center py-20 text-rose-600"><ServerCrash className="w-10 h-10 mb-3"/><p>{error}</p><button onClick={load} className="mt-4 text-blue-600">Retry</button></div>;

  return <div className="p-6 space-y-6">
    <PageHeader title="Dynamic Pricing" subtitle="Automated pricing strategies and rate adjustments" actions={<button className={button.primary} onClick={generate} disabled={busy}>{busy&&<Loader2 className="w-4 h-4 animate-spin"/>}<RefreshCw className="w-4 h-4"/>Generate Rates</button>} />
    {error && <div className="px-4 py-2 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-600">{error}</div>}
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <StatCard title="Strategies" value={strategies.length} icon={Zap} tone="info" />
      <StatCard title="Active Strategies" value={activeStrategies} icon={CheckCircle2} tone="success" />
      <StatCard title="Active Rules" value={activeRules} icon={TrendingUp} tone="accent" />
      <StatCard title="Avg Lift" value={`${avgLift}%`} icon={DollarSign} tone="warning" />
    </div>

    <SectionCard title="Pricing Strategies" icon={Zap} pad="md">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {strategies.map(s => <button key={s.code} onClick={() => setSelectedStrategy(s.code)} className={`p-4 rounded-lg border-2 text-left transition-all ${selectedStrategy===s.code ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'}`}>
          <div className="flex justify-between mb-2"><h4 className="font-medium text-slate-900 dark:text-white">{s.name}</h4>{s.active ? <CheckCircle2 className="w-4 h-4 text-green-500"/> : <XCircle className="w-4 h-4 text-slate-400"/>}</div>
          <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2">{s.description}</p>
          <div className="mt-3"><Toggle small checked={s.active} onChange={() => toggleStrategy(s)} disabled={busy} label={s.active ? 'Active' : 'Inactive'}/></div>
        </button>)}
      </div>
    </SectionCard>

    <SectionCard title={`${selectedName(strategies, selectedStrategy)} Rules`} icon={Settings} pad="md" actions={<button className={button.primary} onClick={() => setRuleForm(null)} disabled={busy}><Plus className="w-4 h-4"/>Add Rule</button>}>
      <div className="space-y-3">
        {selectedRules.map(r => <div key={r.id} className="p-4 rounded-lg border bg-slate-50 dark:bg-slate-700/50 flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2 mb-1"><h4 className="font-medium text-slate-900 dark:text-white">{r.room_type}</h4><Badge tone={r.active ? 'success' : 'neutral'}>{r.active ? 'Active' : 'Inactive'}</Badge></div>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {r.threshold_value !== null ? `${label(r.condition_type)}: ${r.threshold_value}${suffix(r.condition_type)} • ` : r.threshold_label ? `${r.threshold_label} • ` : ''}
              Adjustment: {r.adjustment > 0 ? '+' : ''}{r.adjustment}%
            </p>
          </div>
          <div className="flex gap-1"><IconButton title="Edit" onClick={() => setRuleForm(r)}><Settings className="w-4 h-4 text-slate-500"/></IconButton><IconButton title="Delete" onClick={() => deleteRule(r.id)} disabled={busy}><XCircle className="w-4 h-4 text-red-600"/></IconButton></div>
        </div>)}
        {!selectedRules.length && <p className="text-center py-8 text-slate-500">No rules for this strategy</p>}
      </div>
    </SectionCard>

    <SectionCard title="Recent Rate Adjustments" icon={Activity} pad="md">
      <div className="space-y-3">
        {adjustments.slice(0,5).map(a => { const change = a.new_rate - a.old_rate; const pct = Math.round((change / a.old_rate) * 100); return <div key={a.id} className="p-4 rounded-lg border bg-slate-50 dark:bg-slate-700/50 flex justify-between items-center">
          <div><div className="flex items-center gap-2 mb-1"><h4 className="font-medium text-slate-900 dark:text-white">{a.room_type}</h4><span className="text-xs text-slate-500">{new Date(a.created_at).toLocaleString()}</span></div><p className="text-sm text-slate-600 dark:text-slate-400">{a.reason}</p></div>
          <div className="text-right"><p className="text-sm text-slate-500 line-through">${a.old_rate}</p><p className="text-lg font-semibold text-slate-900 dark:text-white">${a.new_rate}</p><p className={`text-sm font-medium ${change >= 0 ? 'text-green-600' : 'text-red-600'}`}>{change >= 0 ? '+' : ''}{pct}%</p></div>
        </div>; })}
        {!adjustments.length && <p className="text-center py-8 text-slate-500">No recent adjustments</p>}
      </div>
    </SectionCard>

    {ruleForm !== undefined && <RuleForm rule={ruleForm} strategies={strategies} strategyCode={selectedStrategy} saving={busy} onCancel={() => setRuleForm(undefined)} onSave={saveRule}/>}
  </div>;
}

function selectedName(strategies: Strategy[], code: string) { const s = strategies.find(x => x.code === code); return s ? s.name : code; }
function label(type: string) { if (type === 'occupancy') return 'Min occupancy'; if (type === 'demand') return 'Demand score'; if (type === 'los') return 'Min nights'; if (type === 'event') return 'Event'; return type; }
function suffix(type: string) { return type === 'occupancy' || type === 'demand' ? '%' : (type === 'los' ? ' nights' : ''); }

function IconButton({ title, onClick, disabled, children }: { title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) { return <button title={title} onClick={onClick} disabled={disabled} className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-400 disabled:opacity-50">{children}</button>; }
function Toggle({ checked, onChange, disabled, label, small }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string; small?: boolean }) { return <label className={`flex items-center gap-2 ${small ? 'text-xs' : 'text-sm'} text-slate-600 dark:text-slate-400`}><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} disabled={disabled} className="rounded"/>{label}</label>; }
const fieldClass = "w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white";

function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) { return <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"><div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto"><div className="p-5 border-b flex justify-between items-center"><h3 className="font-semibold text-lg text-slate-900 dark:text-white">{title}</h3><button onClick={onClose}><X className="w-5 h-5 text-slate-500"/></button></div><div className="p-5">{children}</div>{footer && <div className="p-5 border-t flex justify-end gap-3">{footer}</div>}</div></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm font-medium text-slate-700 dark:text-slate-300"><span className="block mb-1">{label}</span>{children}</label>; }

function RuleForm({ rule, strategies, strategyCode, onCancel, onSave, saving }: { rule: Rule | null; strategies: Strategy[]; strategyCode: string; onCancel: () => void; onSave: (f: any) => void; saving: boolean }) {
  const [f, setF] = useState({ room_type: rule?.room_type || '', strategy_code: rule?.strategy_code || strategyCode, condition_type: rule?.condition_type || 'occupancy', threshold_value: rule?.threshold_value ?? '', threshold_label: rule?.threshold_label || '', adjustment: rule?.adjustment ?? 10, active: rule?.active ?? true });
  const set = (k: string, v: any) => setF(p => ({ ...p, [k]: v }));
  const needsValue = ['occupancy','demand','los'].includes(f.condition_type);
  const needsLabel = f.condition_type === 'event';
  return <Modal title={rule ? 'Edit Rule' : 'Add Pricing Rule'} onClose={onCancel} footer={<><button className={button.secondary} onClick={onCancel}>Cancel</button><button className={button.primary} disabled={saving || !f.room_type || !f.strategy_code} onClick={() => onSave(f)}>{saving && <Loader2 className="w-4 h-4 animate-spin"/>}Save</button></>}>
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4"><Field label="Room Type"><input className={fieldClass} value={f.room_type} onChange={e => set('room_type', e.target.value)}/></Field><Field label="Strategy"><select className={fieldClass} value={f.strategy_code} onChange={e => set('strategy_code', e.target.value)}>{strategies.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}</select></Field></div>
      <div className="grid grid-cols-2 gap-4"><Field label="Condition"><select className={fieldClass} value={f.condition_type} onChange={e => set('condition_type', e.target.value)}><option value="occupancy">Occupancy</option><option value="demand">Demand</option><option value="event">Event</option><option value="los">Length of stay</option></select></Field><Field label="Adjustment %"><input type="number" className={fieldClass} value={f.adjustment} onChange={e => set('adjustment', Number(e.target.value))}/></Field></div>
      <div className="grid grid-cols-2 gap-4">{needsValue && <Field label={`Threshold ${label(f.condition_type)}`}><input type="number" className={fieldClass} value={f.threshold_value} onChange={e => set('threshold_value', e.target.value === '' ? null : Number(e.target.value))}/></Field>}{needsLabel && <Field label="Event label"><input className={fieldClass} value={f.threshold_label} onChange={e => set('threshold_label', e.target.value)}/></Field>}</div>
      <Toggle checked={f.active} onChange={v => set('active', v)} label="Active"/>
    </div>
  </Modal>;
}
