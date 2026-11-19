import { useCallback, useEffect, useMemo, useState } from 'react';
import { useERP } from '../../context/ERPContext';
import { AlertTriangle, BarChart3, Calculator, CheckCircle2, DollarSign, Loader2, ServerCrash, TrendingDown, TrendingUp, X, XCircle } from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard } from '../FrontOffice/ui';
import { button } from '../FrontOffice/brandTheme';
import { rmsGet, rmsRequest } from '../../services/rmsService';

const API = '/api/rms-portal/displacement-analysis';


type Scenario = { id: string; name: string; dates: string; rooms: number; nights: number; status: string; revenue_lost: number; revenue_gained: number; opportunity_cost: number; ancillary_revenue: number; total_profitability: number; recommendation: 'accept' | 'reject' | 'review'; confidence: number; active: boolean };
type Formula = { id: string; title: string; formula: string; description: string | null; example: string | null; display_order: number };

const recommendationColors: Record<string, string> = {
  accept: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  reject: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  review: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
};

export default function DisplacementAnalysis() {
  const { currentPropertyId } = useERP();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [formulas, setFormulas] = useState<Formula[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null);
  const [comparisonPeriod, setComparisonPeriod] = useState('30');
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const json = await rmsGet(API, { propertyId: currentPropertyId });
      setScenarios(json.scenarios || []); setFormulas(json.formulas || []);
    } catch (e: any) { setError(e.message || 'Failed to load displacement analysis'); }
    finally { setLoading(false); }
  }, [currentPropertyId]);
  useEffect(() => { load(); }, [load]);

  const request = (url: string, method: string, body?: unknown) =>
    rmsRequest(url, { method, body, propertyId: currentPropertyId });
  const saveScenario = async (form: any) => {
    setBusy(true); setError(null);
    try { await request(`${API}/scenarios`, 'POST', { ...form, propertyId: currentPropertyId }); setShowForm(false); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const deleteScenario = async (id: string) => {
    if (!confirm('Delete this scenario?')) return;
    setBusy(true); setError(null);
    try { await request(`${API}/scenarios/${id}`, 'DELETE', { propertyId: currentPropertyId }); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  const activeScenarios = useMemo(() => scenarios.filter(s => s.active), [scenarios]);
  const totalLost = useMemo(() => activeScenarios.reduce((s, x) => s + Number(x.revenue_lost), 0), [activeScenarios]);
  const totalGained = useMemo(() => activeScenarios.reduce((s, x) => s + Number(x.revenue_gained), 0), [activeScenarios]);
  const totalOpportunity = useMemo(() => activeScenarios.reduce((s, x) => s + Number(x.opportunity_cost), 0), [activeScenarios]);
  const totalAncillary = useMemo(() => activeScenarios.reduce((s, x) => s + Number(x.ancillary_revenue), 0), [activeScenarios]);
  const netProfitability = useMemo(() => activeScenarios.reduce((s, x) => s + Number(x.total_profitability), 0), [activeScenarios]);

  if (loading && !scenarios.length) return <div className="p-6 flex justify-center py-20 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2"/>Loading displacement analysis…</div>;
  if (error && !scenarios.length) return <div className="p-6 flex flex-col items-center py-20 text-rose-600"><ServerCrash className="w-10 h-10 mb-3"/><p>{error}</p><button onClick={load} className="mt-4 text-blue-600">Retry</button></div>;

  return <div className="p-6 space-y-6">
    <PageHeader title="Displacement Analysis" subtitle="Evaluate opportunity cost and profitability of group bookings" actions={<div className="flex items-center gap-3"><select value={comparisonPeriod} onChange={e => setComparisonPeriod(e.target.value)} className="px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-700 dark:text-slate-300"><option value="7">Next 7 days</option><option value="30">Next 30 days</option><option value="90">Next 90 days</option></select><button className={button.primary} onClick={() => setShowForm(true)} disabled={busy}><Calculator className="w-4 h-4"/>Run Analysis</button></div>} />
    {error && <div className="px-4 py-2 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-600">{error}</div>}
    <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
      <StatCard title="Revenue Lost" value={`$${totalLost.toLocaleString()}`} icon={TrendingDown} tone="danger" />
      <StatCard title="Revenue Gained" value={`$${totalGained.toLocaleString()}`} icon={TrendingUp} tone="success" />
      <StatCard title="Opportunity Cost" value={`$${totalOpportunity.toLocaleString()}`} icon={AlertTriangle} tone="warning" />
      <StatCard title="Ancillary Revenue" value={`$${totalAncillary.toLocaleString()}`} icon={DollarSign} tone="info" />
      <StatCard title="Net Profitability" value={`$${netProfitability.toLocaleString()}`} icon={BarChart3} tone={netProfitability >= 0 ? 'success' : 'danger'} />
    </div>

    <SectionCard title="Displacement Scenarios" icon={Calculator} pad="md" actions={<button className={button.secondary} onClick={() => setShowForm(true)} disabled={busy}>+ Add Scenario</button>}>
      <div className="space-y-4">
        {activeScenarios.map(s => <div key={s.id} onClick={() => setSelectedScenario(s.id)} className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${selectedScenario === s.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'}`}>
          <div className="flex items-start justify-between mb-4"><div className="flex-1"><div className="flex items-center gap-2 mb-1"><h4 className="font-semibold text-slate-900 dark:text-white">{s.name}</h4><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${recommendationColors[s.recommendation]}`}>{s.recommendation}</span></div><p className="text-sm text-slate-600 dark:text-slate-400">{s.dates} • {s.rooms} rooms × {s.nights} nights</p></div><div className="text-right"><p className="text-xs text-slate-600 dark:text-slate-400">Confidence</p><p className="text-lg font-bold text-slate-900 dark:text-white">{s.confidence}%</p></div></div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm"><div><p className="text-slate-600 dark:text-slate-400">Revenue Lost</p><p className="font-medium text-red-600 dark:text-red-400">${Number(s.revenue_lost).toLocaleString()}</p></div><div><p className="text-slate-600 dark:text-slate-400">Revenue Gained</p><p className="font-medium text-green-600 dark:text-green-400">${Number(s.revenue_gained).toLocaleString()}</p></div><div><p className="text-slate-600 dark:text-slate-400">Opportunity Cost</p><p className="font-medium text-amber-600 dark:text-amber-400">${Number(s.opportunity_cost).toLocaleString()}</p></div><div><p className="text-slate-600 dark:text-slate-400">Ancillary</p><p className="font-medium text-blue-600 dark:text-blue-400">${Number(s.ancillary_revenue).toLocaleString()}</p></div><div><p className="text-slate-600 dark:text-slate-400">Net Profit</p><p className={`font-medium ${Number(s.total_profitability) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>${Number(s.total_profitability).toLocaleString()}</p></div></div>
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-200 dark:border-slate-700"><div className="flex items-center gap-2">{s.recommendation === 'accept' ? <CheckCircle2 className="w-5 h-5 text-green-500"/> : <XCircle className="w-5 h-5 text-red-500"/>}<span className="text-sm text-slate-600 dark:text-slate-400">{s.recommendation === 'accept' ? 'Accept this group' : 'Reject this group'}</span></div><button onClick={(e)=>{e.stopPropagation();deleteScenario(s.id)}} disabled={busy} className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"><XCircle className="w-4 h-4 text-red-600"/></button></div>
        </div>)}
        {!activeScenarios.length && <p className="text-center py-8 text-slate-500">No displacement scenarios</p>}
      </div>
    </SectionCard>

    <SectionCard title="Displacement Calculation Formula" icon={Calculator} pad="md">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {formulas.map(f => <div key={f.id} className="p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600">
          <h4 className="font-semibold text-slate-900 dark:text-white mb-2">{f.title}</h4>
          <div className="bg-slate-100 dark:bg-slate-800 p-2 rounded mb-2"><code className="text-sm text-blue-600 dark:text-blue-400">{f.formula}</code></div>
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">{f.description}</p>
          <p className="text-xs text-slate-500">Example: {f.example}</p>
        </div>)}
      </div>
    </SectionCard>

    {showForm && <ScenarioForm onCancel={() => setShowForm(false)} onSave={saveScenario} saving={busy} />}
  </div>;
}

const fieldClass = "w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white";
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm font-medium text-slate-700 dark:text-slate-300"><span className="block mb-1">{label}</span>{children}</label>; }
function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) { return <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"><div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto"><div className="p-5 border-b flex justify-between items-center"><h3 className="font-semibold text-lg text-slate-900 dark:text-white">{title}</h3><button onClick={onClose} className="text-slate-500"><X className="w-5 h-5"/></button></div><div className="p-5">{children}</div>{footer && <div className="p-5 border-t flex justify-end gap-3">{footer}</div>}</div></div>; }

function ScenarioForm({ onCancel, onSave, saving }: { onCancel: () => void; onSave: (f: any) => void; saving: boolean }) {
  const [f, setF] = useState({ name: '', dates: '', rooms: 0, nights: 0, revenue_lost: 0, revenue_gained: 0, opportunity_cost: 0, ancillary_revenue: 0, total_profitability: 0, recommendation: 'review', confidence: 0 });
  const set = (k: string, v: any) => setF(p => ({ ...p, [k]: v }));
  return <Modal title="Add Displacement Scenario" onClose={onCancel} footer={<><button className={button.secondary} onClick={onCancel}>Cancel</button><button className={button.primary} disabled={saving || !f.name || !f.dates} onClick={() => onSave(f)}>{saving && <Loader2 className="w-4 h-4 animate-spin"/>}Save</button></>}>
    <div className="space-y-4">
      <Field label="Name"><input className={fieldClass} value={f.name} onChange={e=>set('name',e.target.value)}/></Field>
      <Field label="Dates"><input className={fieldClass} value={f.dates} onChange={e=>set('dates',e.target.value)} placeholder="2024-12-15 to 2024-12-18"/></Field>
      <div className="grid grid-cols-2 gap-4"><Field label="Rooms"><input type="number" className={fieldClass} value={f.rooms} onChange={e=>set('rooms',Number(e.target.value))}/></Field><Field label="Nights"><input type="number" className={fieldClass} value={f.nights} onChange={e=>set('nights',Number(e.target.value))}/></Field></div>
      <div className="grid grid-cols-2 gap-4"><Field label="Revenue Lost"><input type="number" className={fieldClass} value={f.revenue_lost} onChange={e=>set('revenue_lost',Number(e.target.value))}/></Field><Field label="Revenue Gained"><input type="number" className={fieldClass} value={f.revenue_gained} onChange={e=>set('revenue_gained',Number(e.target.value))}/></Field></div>
      <div className="grid grid-cols-2 gap-4"><Field label="Opportunity Cost"><input type="number" className={fieldClass} value={f.opportunity_cost} onChange={e=>set('opportunity_cost',Number(e.target.value))}/></Field><Field label="Ancillary Revenue"><input type="number" className={fieldClass} value={f.ancillary_revenue} onChange={e=>set('ancillary_revenue',Number(e.target.value))}/></Field></div>
      <div className="grid grid-cols-2 gap-4"><Field label="Total Profitability"><input type="number" className={fieldClass} value={f.total_profitability} onChange={e=>set('total_profitability',Number(e.target.value))}/></Field><Field label="Confidence %"><input type="number" className={fieldClass} value={f.confidence} onChange={e=>set('confidence',Number(e.target.value))}/></Field></div>
      <Field label="Recommendation"><select className={fieldClass} value={f.recommendation} onChange={e=>set('recommendation',e.target.value)}><option value="accept">Accept</option><option value="review">Review</option><option value="reject">Reject</option></select></Field>
    </div>
  </Modal>;
}
