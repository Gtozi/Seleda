import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, BarChart3, Bed, Calendar, CheckCircle2, DollarSign, Loader2, Plus, ServerCrash, Settings, Target, Trash2, TrendingUp, Zap } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { Badge, PageHeader, SectionCard } from '../FrontOffice/ui';
import { button } from '../FrontOffice/brandTheme';
import { rmsGet, rmsRequest } from '../../services/rmsService';

const API = '/api/rms-portal/yield-management';


const ICONS: Record<string, React.ElementType> = { Bed, DollarSign, TrendingUp, BarChart3, Calendar, Zap, Target, Settings, ArrowUpRight, ArrowDownRight };

type OptimizationType = { id: string; code: string; name: string; description: string | null; icon_name: string | null; active: boolean };
type YieldMetric = { id: string; metric_name: string; current_value: number; target_value: number; trend: 'up' | 'down' };
type Opportunity = { id: string; opportunity_type: string; room_type: string; suggestion: string; potential_revenue: number; confidence: number; applied: boolean };
type Scenario = { id: string; name: string; occupancy: number; adr: number; revpar: number; revenue: number; active: boolean };

export default function YieldManagement() {
  const { currentPropertyId } = useERP();
  const [optimizationTypes, setOptimizationTypes] = useState<OptimizationType[]>([]);
  const [yieldMetrics, setYieldMetrics] = useState<YieldMetric[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedOptimization, setSelectedOptimization] = useState<string>('occupancy');
  const [showScenarioForm, setShowScenarioForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const json = await rmsGet(API, { propertyId: currentPropertyId });
      setOptimizationTypes(json.optimizationTypes || []); setYieldMetrics(json.yieldMetrics || []); setOpportunities(json.opportunities || []); setScenarios(json.scenarios || []);
    } catch (e: any) { setError(e.message || 'Failed to load yield management'); }
    finally { setLoading(false); }
  }, [currentPropertyId]);
  useEffect(() => { load(); }, [load]);

  const request = (url: string, method: string, body?: unknown) =>
    rmsRequest(url, { method, body, propertyId: currentPropertyId });

  const applyOpportunity = async (id: string) => {
    setBusy(true); setError(null);
    try { await request(`${API}/opportunities/${id}/apply`, 'PUT'); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const deleteOpportunity = async (id: string) => {
    if (!confirm('Delete this opportunity?')) return;
    setBusy(true); setError(null);
    try { await request(`${API}/opportunities/${id}`, 'DELETE'); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const createScenario = async (form: any) => {
    setBusy(true); setError(null);
    try { await request(`${API}/scenarios`, 'POST', form); setShowScenarioForm(false); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  const avgGap = useMemo(() => yieldMetrics.length ? Math.round(yieldMetrics.reduce((s, m) => s + ((m.target_value - m.current_value) / m.target_value * 100), 0) / yieldMetrics.length) : 0, [yieldMetrics]);
  const totalPotential = useMemo(() => opportunities.filter(o => !o.applied).reduce((s, o) => s + Number(o.potential_revenue), 0), [opportunities]);
  const activeScenarios = useMemo(() => scenarios.filter(s => s.active).length, [scenarios]);

  if (loading && !optimizationTypes.length) return <div className="p-6 flex justify-center py-20 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2"/>Loading yield management…</div>;
  if (error && !optimizationTypes.length) return <div className="p-6 flex flex-col items-center py-20 text-rose-600"><ServerCrash className="w-10 h-10 mb-3"/><p>{error}</p><button onClick={load} className="mt-4 text-blue-600">Retry</button></div>;

  return <div className="p-6 space-y-6">
    <PageHeader title="Yield Management" subtitle="Optimize occupancy, ADR, and revenue performance" actions={<button className={button.primary} onClick={() => setShowScenarioForm(true)} disabled={busy}><Plus className="w-4 h-4"/>Add Scenario</button>} />
    {error && <div className="px-4 py-2 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-600">{error}</div>}
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <StatCard title="Optimizations" value={optimizationTypes.filter(o=>o.active).length} icon={Target} tone="info" />
      <StatCard title="Avg Gap" value={`${avgGap}%`} icon={TrendingUp} tone="warning" />
      <StatCard title="Potential Revenue" value={`$${totalPotential}`} icon={DollarSign} tone="success" />
      <StatCard title="Scenarios" value={activeScenarios} icon={BarChart3} tone="accent" />
    </div>

    <SectionCard title="Optimization Focus" icon={Target} pad="md">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {optimizationTypes.map(opt => { const Icon = (opt.icon_name && ICONS[opt.icon_name]) || Target; return <button key={opt.code} onClick={() => setSelectedOptimization(opt.code)} className={`p-4 rounded-lg border-2 text-left transition-all ${selectedOptimization===opt.code ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'}`}>
          <div className="flex items-center gap-3 mb-2"><div className={`p-2 rounded-lg ${selectedOptimization===opt.code ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-slate-100 dark:bg-slate-700'}`}><Icon className="w-5 h-5"/></div><h4 className="font-semibold text-slate-900 dark:text-white">{opt.name}</h4></div>
          <p className="text-sm text-slate-600 dark:text-slate-400">{opt.description}</p>
        </button>; })}
      </div>
    </SectionCard>

    <SectionCard title="Yield Metrics vs Targets" icon={TrendingUp} pad="md">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {yieldMetrics.map(m => { const pct = Math.min(100, Math.round((m.current_value / m.target_value) * 100)); const gapPct = Math.round(((m.target_value - m.current_value) / m.target_value) * 100); return <div key={m.id} className="p-4 rounded-lg border bg-slate-50 dark:bg-slate-700/50">
          <div className="flex justify-between mb-2"><h4 className="font-medium text-slate-900 dark:text-white">{m.metric_name}</h4>{m.trend === 'up' ? <ArrowUpRight className="w-4 h-4 text-green-500"/> : <ArrowDownRight className="w-4 h-4 text-red-500"/>}</div>
          <div className="space-y-1"><div className="flex justify-between text-sm"><span className="text-slate-600 dark:text-slate-400">Current</span><span className="font-medium text-slate-900 dark:text-white">{m.current_value}</span></div><div className="flex justify-between text-sm"><span className="text-slate-600 dark:text-slate-400">Target</span><span className="font-medium text-slate-900 dark:text-white">{m.target_value}</span></div><div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden mt-2"><div className="h-full bg-blue-600 rounded-full" style={{ width: `${pct}%` }}/></div><p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{gapPct}% gap to target</p></div>
        </div>; })}
      </div>
    </SectionCard>

    <SectionCard title="Optimization Opportunities" icon={Zap} pad="md">
      <div className="space-y-3">
        {opportunities.map(o => <div key={o.id} className={`flex justify-between p-4 rounded-lg border ${o.applied ? 'bg-green-50 dark:bg-green-900/10' : 'bg-slate-50 dark:bg-slate-700/50'}`}>
          <div><div className="flex items-center gap-2 mb-1"><Badge tone={o.applied ? 'success' : 'info'}>{o.opportunity_type}</Badge><h4 className="font-medium text-slate-900 dark:text-white">{o.room_type}</h4></div><p className="text-sm text-slate-600 dark:text-slate-400">{o.suggestion}</p></div>
          <div className="flex items-center gap-4"><div className="text-right"><p className="text-sm text-slate-600 dark:text-slate-400">Potential</p><p className="text-lg font-semibold text-green-600 dark:text-green-400">+${o.potential_revenue}</p></div><div className="text-right"><p className="text-sm text-slate-600 dark:text-slate-400">Confidence</p><p className="text-lg font-semibold text-slate-900 dark:text-white">{o.confidence}%</p></div>
            {!o.applied ? <IconButton title="Apply" onClick={() => applyOpportunity(o.id)} disabled={busy}><CheckCircle2 className="w-5 h-5 text-green-600"/></IconButton> : <span className="text-sm text-green-600 font-medium px-2">Applied</span>}
            <IconButton title="Delete" onClick={() => deleteOpportunity(o.id)} disabled={busy}><Trash2 className="w-5 h-5 text-red-600"/></IconButton>
          </div>
        </div>)}
        {!opportunities.length && <p className="text-center py-8 text-slate-500">No opportunities</p>}
      </div>
    </SectionCard>

    <SectionCard title="Yield Scenarios" icon={BarChart3} pad="md">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {scenarios.map(s => <div key={s.id} className={`p-4 rounded-lg border ${s.active ? 'bg-slate-50 dark:bg-slate-700/50' : 'opacity-60 bg-slate-100 dark:bg-slate-800'}`}>
          <div className="flex justify-between items-start mb-3"><h4 className="font-semibold text-slate-900 dark:text-white">{s.name}</h4><Badge tone={s.active ? 'success' : 'neutral'}>{s.active ? 'Active' : 'Inactive'}</Badge></div>
          <div className="space-y-2"><div className="flex justify-between text-sm"><span className="text-slate-600 dark:text-slate-400">Occupancy</span><span className="font-medium text-slate-900 dark:text-white">{s.occupancy}%</span></div><div className="flex justify-between text-sm"><span className="text-slate-600 dark:text-slate-400">ADR</span><span className="font-medium text-slate-900 dark:text-white">${s.adr}</span></div><div className="flex justify-between text-sm"><span className="text-slate-600 dark:text-slate-400">RevPAR</span><span className="font-medium text-slate-900 dark:text-white">${s.revpar}</span></div><div className="pt-2 border-t border-slate-200 dark:border-slate-600 flex justify-between"><span className="text-sm text-slate-600 dark:text-slate-400">Revenue</span><span className="text-lg font-bold text-slate-900 dark:text-white">${Number(s.revenue).toLocaleString()}</span></div></div>
        </div>)}
        {!scenarios.length && <p className="text-center py-8 text-slate-500">No scenarios</p>}
      </div>
    </SectionCard>

    {showScenarioForm && <ScenarioForm onCancel={() => setShowScenarioForm(false)} onSave={createScenario} saving={busy} />}
  </div>;
}

function IconButton({ title, onClick, disabled, children }: { title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) { return <button title={title} onClick={onClick} disabled={disabled} className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-400 disabled:opacity-50">{children}</button>; }
const fieldClass = "w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white";
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm font-medium text-slate-700 dark:text-slate-300"><span className="block mb-1">{label}</span>{children}</label>; }
function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) { return <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"><div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto"><div className="p-5 border-b flex justify-between items-center"><h3 className="font-semibold text-lg text-slate-900 dark:text-white">{title}</h3><button onClick={onClose} className="text-slate-500"><Settings className="w-5 h-5"/></button></div><div className="p-5">{children}</div>{footer && <div className="p-5 border-t flex justify-end gap-3">{footer}</div>}</div></div>; }

function ScenarioForm({ onCancel, onSave, saving }: { onCancel: () => void; onSave: (f: any) => void; saving: boolean }) {
  const [f, setF] = useState({ name: '', occupancy: 0, adr: 0, revpar: 0, revenue: 0, active: true });
  const set = (k: string, v: any) => setF(p => ({ ...p, [k]: v }));
  return <Modal title="Add Scenario" onClose={onCancel} footer={<><button className={button.secondary} onClick={onCancel}>Cancel</button><button className={button.primary} disabled={saving || !f.name} onClick={() => onSave(f)}>{saving && <Loader2 className="w-4 h-4 animate-spin"/>}Save</button></>}>
    <div className="space-y-4">
      <Field label="Scenario Name"><input className={fieldClass} value={f.name} onChange={e=>set('name',e.target.value)}/></Field>
      <div className="grid grid-cols-2 gap-4"><Field label="Occupancy %"><input type="number" className={fieldClass} value={f.occupancy} onChange={e=>set('occupancy',Number(e.target.value))}/></Field><Field label="ADR"><input type="number" className={fieldClass} value={f.adr} onChange={e=>set('adr',Number(e.target.value))}/></Field></div>
      <div className="grid grid-cols-2 gap-4"><Field label="RevPAR"><input type="number" className={fieldClass} value={f.revpar} onChange={e=>set('revpar',Number(e.target.value))}/></Field><Field label="Revenue"><input type="number" className={fieldClass} value={f.revenue} onChange={e=>set('revenue',Number(e.target.value))}/></Field></div>
      <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400"><input type="checkbox" checked={f.active} onChange={e=>set('active',e.target.checked)} className="rounded"/>Active</label>
    </div>
  </Modal>;
}
