import { useCallback, useEffect, useMemo, useState } from 'react';
import { useERP } from '../../context/ERPContext';
import { BarChart3, Copy, Loader2, Play, Plus, Save, ServerCrash, Trash2, X } from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { Badge, PageHeader, SectionCard } from '../FrontOffice/ui';
import { button } from '../FrontOffice/brandTheme';
import { rmsGet, rmsRequest } from '../../services/rmsService';

const API = '/api/rms-portal/scenario-planning';


type Scenario = { id: string; name: string; scenario_type: string; description: string | null; parameters: Record<string, any>; results: Record<string, any>; status: 'active' | 'draft'; created_at: string };
const typeTone: Record<string, 'info' | 'accent' | 'success' | 'warning' | 'neutral'> = { baseline: 'info', pricing: 'accent', demand: 'success', competitive: 'warning', mixed: 'neutral' };

export default function ScenarioPlanning() {
  const { currentPropertyId } = useERP();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comparisonMode, setComparisonMode] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const selected = scenarios.find(s => s.id === selectedId) || null;

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const json = await rmsGet(API, { propertyId: currentPropertyId });
      setScenarios(json.scenarios || []);
    } catch (e: any) { setError(e.message || 'Failed to load scenarios'); }
    finally { setLoading(false); }
  }, [currentPropertyId]);
  useEffect(() => { load(); }, [load]);

  const request = (url: string, method: string, body?: unknown) =>
    rmsRequest(url, { method, body, propertyId: currentPropertyId });
  const saveScenario = async (f: any) => {
    setBusy(true); setError(null);
    try { await request(API, 'POST', { ...f, propertyId: currentPropertyId }); setShowForm(false); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const updateScenario = async (id: string, updates: any) => {
    setBusy(true); setError(null);
    try { await request(`${API}/${id}`, 'PUT', { ...updates, propertyId: currentPropertyId }); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const duplicate = async (id: string) => {
    setBusy(true); setError(null);
    try { await request(`${API}/${id}/duplicate`, 'POST', { propertyId: currentPropertyId }); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const deleteScenario = async (id: string) => {
    if (!confirm('Delete this scenario?')) return;
    setBusy(true); setError(null);
    try { await request(`${API}/${id}`, 'DELETE', { propertyId: currentPropertyId }); if (selectedId === id) setSelectedId(null); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const runSimulation = async (s: Scenario) => updateScenario(s.id, { status: 'active' });

  const comparisonData = useMemo(() => {
    if (!comparisonMode) return null;
    const baseline = scenarios.find(s => s.scenario_type === 'baseline');
    if (!baseline) return null;
    return scenarios.filter(s => s.id !== baseline.id).map(s => ({
      name: s.name,
      occupancyDiff: Number(s.results?.occupancy || 0) - Number(baseline.results?.occupancy || 0),
      adrDiff: Number(s.results?.adr || 0) - Number(baseline.results?.adr || 0),
      revparDiff: Number(s.results?.revpar || 0) - Number(baseline.results?.revpar || 0),
      revenueDiff: Number(s.results?.revenue || 0) - Number(baseline.results?.revenue || 0),
      profitDiff: Number(s.results?.profit || 0) - Number(baseline.results?.profit || 0),
    }));
  }, [scenarios, comparisonMode]);

  const bestRevenue = useMemo(() => scenarios.reduce((m, s) => Math.max(m, Number(s.results?.revenue || 0)), 0), [scenarios]);
  const bestProfit = useMemo(() => scenarios.reduce((m, s) => Math.max(m, Number(s.results?.profit || 0)), 0), [scenarios]);

  if (loading && !scenarios.length) return <div className="p-6 flex justify-center py-20 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2"/>Loading scenarios…</div>;
  if (error && !scenarios.length) return <div className="p-6 flex flex-col items-center py-20 text-rose-600"><ServerCrash className="w-10 h-10 mb-3"/><p>{error}</p><button onClick={load} className="mt-4 text-blue-600">Retry</button></div>;

  return <div className="p-6 space-y-6">
    <PageHeader title="Scenario Planning" subtitle="Create and compare revenue optimization scenarios" actions={<div className="flex items-center gap-3">
      <button onClick={() => setComparisonMode(!comparisonMode)} className={comparisonMode ? button.primary : button.secondary}><BarChart3 className="w-4 h-4"/>Compare Scenarios</button>
      <button className={button.primary} onClick={() => setShowForm(true)} disabled={busy}><Plus className="w-4 h-4"/>New Scenario</button>
    </div>} />
    {error && <div className="px-4 py-2 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-600">{error}</div>}
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <StatCard title="Total Scenarios" value={scenarios.length} icon={BarChart3} tone="info" />
      <StatCard title="Active" value={scenarios.filter(s => s.status === 'active').length} icon={Play} tone="success" />
      <StatCard title="Best Revenue" value={`$${bestRevenue.toLocaleString()}`} icon={BarChart3} tone="accent" />
      <StatCard title="Best Profit" value={`$${bestProfit.toLocaleString()}`} icon={BarChart3} tone="warning" />
    </div>

    {comparisonMode && comparisonData && <SectionCard title="Scenario Comparison vs Baseline" icon={BarChart3} pad="md">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-200 dark:border-slate-700"><th className="text-left p-3 text-slate-600 dark:text-slate-400">Scenario</th><th className="text-center p-3 text-slate-600 dark:text-slate-400">Occupancy Δ</th><th className="text-center p-3 text-slate-600 dark:text-slate-400">ADR Δ</th><th className="text-center p-3 text-slate-600 dark:text-slate-400">RevPAR Δ</th><th className="text-center p-3 text-slate-600 dark:text-slate-400">Revenue Δ</th><th className="text-center p-3 text-slate-600 dark:text-slate-400">Profit Δ</th></tr></thead>
          <tbody>
            {comparisonData.map((d, i) => <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
              <td className="p-3 font-medium text-slate-900 dark:text-white">{d.name}</td>
              {[d.occupancyDiff, d.adrDiff, d.revparDiff, d.revenueDiff, d.profitDiff].map((v, j) => <td key={j} className="p-3 text-center"><span className={v >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>{v >= 0 ? '+' : ''}{j === 0 ? `${v}%` : `$${v.toLocaleString()}`}</span></td>)}
            </tr>)}
          </tbody>
        </table>
      </div>
    </SectionCard>}

    <SectionCard title="Scenarios" icon={BarChart3} pad="md">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {scenarios.map(s => <div key={s.id} onClick={() => setSelectedId(s.id)} className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${selectedId === s.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'}`}>
          <div className="flex items-start justify-between mb-3"><div className="flex-1"><div className="flex items-center gap-2 mb-1"><h4 className="font-semibold text-slate-900 dark:text-white">{s.name}</h4><Badge tone={typeTone[s.scenario_type] || 'neutral'}>{s.scenario_type}</Badge></div><p className="text-sm text-slate-600 dark:text-slate-400">{s.description}</p></div></div>
          <div className="grid grid-cols-2 gap-2 text-sm mb-3">
            <div><p className="text-slate-600 dark:text-slate-400">Occupancy</p><p className="font-medium text-slate-900 dark:text-white">{s.results?.occupancy}%</p></div>
            <div><p className="text-slate-600 dark:text-slate-400">ADR</p><p className="font-medium text-slate-900 dark:text-white">${s.results?.adr}</p></div>
            <div><p className="text-slate-600 dark:text-slate-400">RevPAR</p><p className="font-medium text-slate-900 dark:text-white">${s.results?.revpar}</p></div>
            <div><p className="text-slate-600 dark:text-slate-400">Revenue</p><p className="font-medium text-green-600 dark:text-green-400">${Number(s.results?.revenue || 0).toLocaleString()}</p></div>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-700">
            <div className="text-xs text-slate-600 dark:text-slate-400">Created: {s.created_at?.slice(0, 10)}</div>
            <div className="flex items-center gap-1">
              <button onClick={e => { e.stopPropagation(); duplicate(s.id); }} disabled={busy} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors"><Copy className="w-4 h-4 text-slate-600 dark:text-slate-400"/></button>
              <button onClick={e => { e.stopPropagation(); deleteScenario(s.id); }} disabled={busy} className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"><Trash2 className="w-4 h-4 text-red-600"/></button>
            </div>
          </div>
        </div>)}
        {!scenarios.length && <p className="col-span-full text-center py-8 text-slate-500">No scenarios</p>}
      </div>
    </SectionCard>

    {selected && <SectionCard title="Scenario Builder" icon={Play} pad="md" actions={<div className="flex items-center gap-2">
      <button className={button.secondary} onClick={() => duplicate(selected.id)} disabled={busy}><Copy className="w-4 h-4"/>Duplicate</button>
      <button className={button.primary} onClick={() => runSimulation(selected)} disabled={busy || selected.status === 'active'}><Play className="w-4 h-4"/>{selected.status === 'active' ? 'Active' : 'Run Simulation'}</button>
    </div>}>
      <ScenarioBuilder scenario={selected} onSave={updateScenario} busy={busy} />
    </SectionCard>}

    {showForm && <ScenarioForm onCancel={() => setShowForm(false)} onSave={saveScenario} saving={busy} />}
  </div>;
}

const fieldClass = "w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white";
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm font-medium text-slate-700 dark:text-slate-300"><span className="block mb-1">{label}</span>{children}</label>; }

function ScenarioBuilder({ scenario, onSave, busy }: { scenario: Scenario; onSave: (id: string, updates: any) => void; busy: boolean }) {
  const [f, setF] = useState({ name: scenario.name, scenario_type: scenario.scenario_type, description: scenario.description || '', rateAdjustment: scenario.parameters?.rateIncrease ?? scenario.parameters?.rateDecrease ?? 0, targetOccupancy: scenario.parameters?.targetOccupancy ?? 78 });
  useEffect(() => setF({ name: scenario.name, scenario_type: scenario.scenario_type, description: scenario.description || '', rateAdjustment: scenario.parameters?.rateIncrease ?? scenario.parameters?.rateDecrease ?? 0, targetOccupancy: scenario.parameters?.targetOccupancy ?? 78 }), [scenario.id]);
  return <div className="space-y-6">
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Field label="Scenario Name"><input className={fieldClass} value={f.name} onChange={e=>setF(p=>({...p,name:e.target.value}))}/></Field>
      <Field label="Scenario Type"><select className={fieldClass} value={f.scenario_type} onChange={e=>setF(p=>({...p,scenario_type:e.target.value}))}><option value="baseline">Baseline</option><option value="pricing">Pricing Strategy</option><option value="demand">Demand Focus</option><option value="competitive">Competitive Response</option><option value="mixed">Mixed Strategy</option></select></Field>
    </div>
    <Field label="Description"><textarea rows={3} className={fieldClass} value={f.description} onChange={e=>setF(p=>({...p,description:e.target.value}))}/></Field>
    <div>
      <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">Parameters</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Rate Adjustment (%)"><input type="number" className={fieldClass} value={f.rateAdjustment} onChange={e=>setF(p=>({...p,rateAdjustment:Number(e.target.value)}))}/></Field>
        <Field label="Target Occupancy (%)"><input type="number" className={fieldClass} value={f.targetOccupancy} onChange={e=>setF(p=>({...p,targetOccupancy:Number(e.target.value)}))}/></Field>
      </div>
    </div>
    <div className="flex justify-end"><button className={button.primary} disabled={busy} onClick={() => onSave(scenario.id, { name: f.name, scenario_type: f.scenario_type, description: f.description, parameters: { ...scenario.parameters, rateIncrease: f.rateAdjustment, targetOccupancy: f.targetOccupancy } })}><Save className="w-4 h-4"/>Save Changes</button></div>
  </div>;
}

function ScenarioForm({ onCancel, onSave, saving }: { onCancel: () => void; onSave: (f: any) => void; saving: boolean }) {
  const [f, setF] = useState({ name: '', scenario_type: 'pricing', description: '', rateAdjustment: 0, targetOccupancy: 78 });
  const set = (k: string, v: any) => setF(p => ({ ...p, [k]: v }));
  const save = () => onSave({ name: f.name, scenario_type: f.scenario_type, description: f.description, parameters: { rateIncrease: f.rateAdjustment, targetOccupancy: f.targetOccupancy } });
  return <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"><div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto"><div className="p-5 border-b flex justify-between items-center"><h3 className="font-semibold text-lg text-slate-900 dark:text-white">New Scenario</h3><button onClick={onCancel} className="text-slate-500"><X className="w-5 h-5"/></button></div><div className="p-5 space-y-4">
    <div className="grid grid-cols-2 gap-4"><Field label="Name"><input className={fieldClass} value={f.name} onChange={e=>set('name',e.target.value)}/></Field><Field label="Type"><select className={fieldClass} value={f.scenario_type} onChange={e=>set('scenario_type',e.target.value)}><option value="baseline">Baseline</option><option value="pricing">Pricing Strategy</option><option value="demand">Demand Focus</option><option value="competitive">Competitive Response</option><option value="mixed">Mixed Strategy</option></select></Field></div>
    <Field label="Description"><textarea rows={3} className={fieldClass} value={f.description} onChange={e=>set('description',e.target.value)}/></Field>
    <div className="grid grid-cols-2 gap-4"><Field label="Rate Adjustment (%)"><input type="number" className={fieldClass} value={f.rateAdjustment} onChange={e=>set('rateAdjustment',Number(e.target.value))}/></Field><Field label="Target Occupancy (%)"><input type="number" className={fieldClass} value={f.targetOccupancy} onChange={e=>set('targetOccupancy',Number(e.target.value))}/></Field></div>
  </div><div className="p-5 border-t flex justify-end gap-3"><button className={button.secondary} onClick={onCancel}>Cancel</button><button className={button.primary} disabled={saving || !f.name} onClick={save}>{saving && <Loader2 className="w-4 h-4 animate-spin"/>}Save</button></div></div></div>;
}
