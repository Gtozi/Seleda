import { useCallback, useEffect, useMemo, useState } from 'react';
import { useERP } from '../../context/ERPContext';
import { AlertTriangle, Bed, Brain, CheckCircle2, Clock, DollarSign, Globe, Loader2, Plus, ServerCrash, Tag, Trash2, TrendingUp, X, XCircle, Zap } from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { Badge, PageHeader, SectionCard } from '../FrontOffice/ui';
import { button } from '../FrontOffice/brandTheme';
import { rmsGet, rmsRequest } from '../../services/rmsService';

const API = '/api/rms-portal/ai-recommendations';


type Category = 'all' | 'pricing' | 'inventory' | 'distribution' | 'promotional';
type Rec = { id: string; rec_type: string; priority: 'high' | 'medium' | 'low'; title: string; description: string | null; room_type: string | null; channel: string | null; details: Record<string, any>; potential_revenue: number; confidence: number; timeframe: string | null; status: 'pending' | 'applied' | 'dismissed'; reason: string | null };
type Insight = { id: string; title: string; description: string | null; icon: string; color: 'green' | 'amber' | 'blue' | 'purple' };

const categoryIcons: Record<string, React.ElementType> = { pricing: DollarSign, inventory: Bed, distribution: Globe, promotional: Tag };
const priorityTone: Record<string, 'danger' | 'warning' | 'success'> = { high: 'danger', medium: 'warning', low: 'success' };
const insightIcons: Record<string, React.ElementType> = { trending_up: TrendingUp, alert: AlertTriangle, globe: Globe, zap: Zap };
const insightColors: Record<string, string> = {
  green: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
  amber: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800',
  blue: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
  purple: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800',
};

const detailLabel = (r: Rec) => {
  const d = r.details || {};
  if (d.currentRate !== undefined) return `Rate: $${d.currentRate} → $${d.recommendedRate}`;
  if (d.currentAllocation !== undefined) return `Allocation: ${d.currentAllocation} → ${d.recommendedAllocation}`;
  if (d.currentStatus !== undefined) return `Status: ${d.currentStatus} → ${d.recommendedStatus}`;
  if (d.currentOccupancy !== undefined) return `Occupancy: ${d.currentOccupancy}% → ${d.targetOccupancy}%`;
  if (d.currentWeekendRate !== undefined) return `Weekend: $${d.currentWeekendRate} → $${d.recommendedWeekendRate}`;
  if (d.currentLimit !== undefined) return `Limit: ${d.currentLimit} → ${d.recommendedLimit}`;
  return null;
};

export default function AIRecommendations() {
  const { currentPropertyId } = useERP();
  const [recommendations, setRecommendations] = useState<Rec[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [autoApply, setAutoApply] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Category>('all');
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const json = await rmsGet(API, { propertyId: currentPropertyId });
      setRecommendations(json.recommendations || []); setInsights(json.insights || []);
    } catch (e: any) { setError(e.message || 'Failed to load recommendations'); }
    finally { setLoading(false); }
  }, [currentPropertyId]);
  useEffect(() => { load(); }, [load]);

  const request = (url: string, method: string, body?: unknown) =>
    rmsRequest(url, { method, body, propertyId: currentPropertyId });
  const setStatus = async (id: string, status: 'applied' | 'dismissed') => {
    setBusy(true); setError(null);
    try { await request(`${API}/${id}/status`, 'PUT', { status, propertyId: currentPropertyId }); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const applyAll = async () => {
    setBusy(true); setError(null);
    try { await request(`${API}/apply-all`, 'POST', { propertyId: currentPropertyId }); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const saveRec = async (f: any) => {
    setBusy(true); setError(null);
    try { await request(API, 'POST', { ...f, propertyId: currentPropertyId }); setShowForm(false); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const deleteRec = async (id: string) => {
    if (!confirm('Delete this recommendation?')) return;
    setBusy(true); setError(null);
    try { await request(`${API}/${id}`, 'DELETE', { propertyId: currentPropertyId }); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  const filtered = useMemo(() => selectedCategory === 'all' ? recommendations : recommendations.filter(r => r.rec_type === selectedCategory), [recommendations, selectedCategory]);
  const metrics = useMemo(() => ({
    totalPotential: recommendations.filter(r => r.status === 'pending').reduce((s, r) => s + Number(r.potential_revenue || 0), 0),
    highPriority: recommendations.filter(r => r.priority === 'high' && r.status === 'pending').length,
    avgConfidence: recommendations.length ? Math.round(recommendations.reduce((s, r) => s + Number(r.confidence || 0), 0) / recommendations.length) : 0,
    pending: recommendations.filter(r => r.status === 'pending').length,
  }), [recommendations]);

  if (loading && !recommendations.length) return <div className="p-6 flex justify-center py-20 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2"/>Loading recommendations…</div>;
  if (error && !recommendations.length) return <div className="p-6 flex flex-col items-center py-20 text-rose-600"><ServerCrash className="w-10 h-10 mb-3"/><p>{error}</p><button onClick={load} className="mt-4 text-blue-600">Retry</button></div>;

  return <div className="p-6 space-y-6">
    <PageHeader title="AI Recommendations" subtitle="AI-powered revenue optimization suggestions" actions={<div className="flex items-center gap-3">
      <div className="flex items-center gap-2"><span className="text-sm text-slate-600 dark:text-slate-400">Auto-apply</span><button onClick={() => setAutoApply(!autoApply)} className={`relative w-12 h-6 rounded-full transition-colors ${autoApply ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}`}><span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${autoApply ? 'translate-x-6' : ''}`}/></button></div>
      <button className={button.primary} onClick={() => setShowForm(true)} disabled={busy}><Plus className="w-4 h-4"/>New</button>
    </div>} />
    {error && <div className="px-4 py-2 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-600">{error}</div>}
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <StatCard title="Total Potential Revenue" value={`$${metrics.totalPotential.toLocaleString()}`} icon={DollarSign} tone="success" />
      <StatCard title="High Priority" value={metrics.highPriority} icon={AlertTriangle} tone="danger" />
      <StatCard title="Avg Confidence" value={`${metrics.avgConfidence}%`} icon={Brain} tone="info" />
      <StatCard title="Pending Actions" value={metrics.pending} icon={Clock} tone="warning" />
    </div>

    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4">
      <div className="flex gap-2 overflow-x-auto">
        {(['all','pricing','inventory','distribution','promotional'] as Category[]).map(c => { const Icon = c !== 'all' ? categoryIcons[c] : Brain; return <button key={c} onClick={() => setSelectedCategory(c)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${selectedCategory === c ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}><Icon className="w-4 h-4"/>{c.charAt(0).toUpperCase() + c.slice(1)}</button>; })}
      </div>
    </div>

    <SectionCard title="Recommendations" icon={Brain} pad="md" actions={<button className="text-sm text-blue-600 hover:text-blue-700 font-medium" onClick={applyAll} disabled={busy || !metrics.pending}>Apply All</button>}>
      <div className="space-y-4">
        {filtered.map(r => { const Icon = categoryIcons[r.rec_type] || Brain; const detail = detailLabel(r); return <div key={r.id} className="p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-start gap-3 flex-1">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg"><Icon className="w-5 h-5 text-blue-600 dark:text-blue-400"/></div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1"><h4 className="font-semibold text-slate-900 dark:text-white">{r.title}</h4><Badge tone={priorityTone[r.priority] || 'neutral'}>{r.priority}</Badge>{r.status !== 'pending' && <Badge tone={r.status === 'applied' ? 'success' : 'neutral'}>{r.status}</Badge>}</div>
                <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">{r.description}</p>
                <div className="flex items-center gap-4 text-xs text-slate-600 dark:text-slate-400 flex-wrap">
                  <span>{r.room_type || r.channel}</span>{detail && <><span>•</span><span>{detail}</span></>}<span>•</span><span>{r.timeframe}</span><span>•</span><span>Confidence: {r.confidence}%</span>
                </div>
              </div>
            </div>
            <div className="text-right ml-4"><p className="text-sm text-slate-600 dark:text-slate-400">Potential Revenue</p><p className="text-lg font-bold text-green-600 dark:text-green-400">+${Number(r.potential_revenue).toLocaleString()}</p></div>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-700">
            <p className="text-xs text-slate-600 dark:text-slate-400">Reason: {r.reason}</p>
            <div className="flex items-center gap-2">
              {r.status === 'pending' && <><button onClick={() => setStatus(r.id, 'applied')} disabled={busy} className="p-2 hover:bg-green-100 dark:hover:bg-green-900/30 rounded-lg transition-colors" title="Apply"><CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400"/></button><button onClick={() => setStatus(r.id, 'dismissed')} disabled={busy} className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors" title="Dismiss"><XCircle className="w-5 h-5 text-red-600 dark:text-red-400"/></button></>}
              <button onClick={() => deleteRec(r.id)} disabled={busy} className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors" title="Delete"><Trash2 className="w-5 h-5 text-red-600 dark:text-red-400"/></button>
            </div>
          </div>
        </div>; })}
        {!filtered.length && <p className="text-center py-8 text-slate-500">No recommendations</p>}
      </div>
    </SectionCard>

    <SectionCard title="AI Insights" icon={Brain} pad="md">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {insights.map(i => { const Icon = insightIcons[i.icon] || Zap; return <div key={i.id} className={`p-4 rounded-lg border ${insightColors[i.color] || insightColors.blue}`}>
          <div className="flex items-center gap-3 mb-2"><div className="p-2 bg-white dark:bg-slate-800 rounded-lg"><Icon className="w-5 h-5"/></div><h4 className="font-semibold text-slate-900 dark:text-white">{i.title}</h4></div>
          <p className="text-sm text-slate-600 dark:text-slate-400">{i.description}</p>
        </div>; })}
        {!insights.length && <p className="col-span-full text-center py-8 text-slate-500">No insights</p>}
      </div>
    </SectionCard>

    {showForm && <RecForm onCancel={() => setShowForm(false)} onSave={saveRec} saving={busy} />}
  </div>;
}

const fieldClass = "w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white";
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm font-medium text-slate-700 dark:text-slate-300"><span className="block mb-1">{label}</span>{children}</label>; }

function RecForm({ onCancel, onSave, saving }: { onCancel: () => void; onSave: (f: any) => void; saving: boolean }) {
  const [f, setF] = useState({ rec_type: 'pricing', priority: 'medium', title: '', description: '', room_type: '', potential_revenue: 0, confidence: 75, timeframe: '', reason: '' });
  const set = (k: string, v: any) => setF(p => ({ ...p, [k]: v }));
  return <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"><div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto"><div className="p-5 border-b flex justify-between items-center"><h3 className="font-semibold text-lg text-slate-900 dark:text-white">New Recommendation</h3><button onClick={onCancel} className="text-slate-500"><X className="w-5 h-5"/></button></div><div className="p-5 space-y-4">
    <div className="grid grid-cols-3 gap-4"><Field label="Type"><select className={fieldClass} value={f.rec_type} onChange={e=>set('rec_type',e.target.value)}><option value="pricing">Pricing</option><option value="inventory">Inventory</option><option value="distribution">Distribution</option><option value="promotional">Promotional</option></select></Field><Field label="Priority"><select className={fieldClass} value={f.priority} onChange={e=>set('priority',e.target.value)}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></Field><Field label="Confidence %"><input type="number" className={fieldClass} value={f.confidence} onChange={e=>set('confidence',Number(e.target.value))}/></Field></div>
    <Field label="Title"><input className={fieldClass} value={f.title} onChange={e=>set('title',e.target.value)}/></Field>
    <Field label="Description"><textarea className={fieldClass} value={f.description} onChange={e=>set('description',e.target.value)}/></Field>
    <div className="grid grid-cols-3 gap-4"><Field label="Room Type"><input className={fieldClass} value={f.room_type} onChange={e=>set('room_type',e.target.value)}/></Field><Field label="Potential Revenue"><input type="number" className={fieldClass} value={f.potential_revenue} onChange={e=>set('potential_revenue',Number(e.target.value))}/></Field><Field label="Timeframe"><input className={fieldClass} value={f.timeframe} onChange={e=>set('timeframe',e.target.value)}/></Field></div>
    <Field label="Reason"><input className={fieldClass} value={f.reason} onChange={e=>set('reason',e.target.value)}/></Field>
  </div><div className="p-5 border-t flex justify-end gap-3"><button className={button.secondary} onClick={onCancel}>Cancel</button><button className={button.primary} disabled={saving || !f.title} onClick={() => onSave(f)}>{saving && <Loader2 className="w-4 h-4 animate-spin"/>}Save</button></div></div></div>;
}
