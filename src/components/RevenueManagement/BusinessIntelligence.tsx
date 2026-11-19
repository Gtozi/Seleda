import { useCallback, useEffect, useMemo, useState } from 'react';
import { useERP } from '../../context/ERPContext';
import { Activity, BarChart3, Download, Loader2, Plus, ServerCrash, Trash2, TrendingDown, TrendingUp, X } from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { Badge, PageHeader, SectionCard } from '../FrontOffice/ui';
import { button } from '../FrontOffice/brandTheme';
import { rmsGet, rmsRequest } from '../../services/rmsService';

const API = '/api/rms-portal/business-intelligence';


type Metric = 'revenue' | 'occupancy' | 'adr' | 'revpar';
type Period = { id: string; period: string; revenue: number; occupancy: number; adr: number; revpar: number };
type Yoy = { id: string; metric: string; current_value: number; previous_value: number; growth: number };
type Trend = { id: string; trend: string; impact: 'positive' | 'negative'; confidence: number };
type Accuracy = { id: string; period: string; accuracy: number; variance: number };
type HeatCell = { id: string; room_type: string; month: number; intensity: number };

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const isCurrency = (m: string) => m.includes('Revenue') || m.includes('ADR') || m.includes('RevPAR');
const heatColor = (v: number) => v > 75 ? 'bg-green-500' : v > 50 ? 'bg-green-400' : v > 25 ? 'bg-green-300' : 'bg-green-200';

export default function BusinessIntelligence() {
  const { currentPropertyId } = useERP();
  const [periods, setPeriods] = useState<Period[]>([]);
  const [yoy, setYoy] = useState<Yoy[]>([]);
  const [trends, setTrends] = useState<Trend[]>([]);
  const [accuracy, setAccuracy] = useState<Accuracy[]>([]);
  const [heatMap, setHeatMap] = useState<HeatCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<Metric>('revenue');
  const [showTrendForm, setShowTrendForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const json = await rmsGet(API, { propertyId: currentPropertyId });
      setPeriods(json.periods || []); setYoy(json.yoy || []); setTrends(json.trends || []); setAccuracy(json.accuracy || []); setHeatMap(json.heatMap || []);
    } catch (e: any) { setError(e.message || 'Failed to load analytics'); }
    finally { setLoading(false); }
  }, [currentPropertyId]);
  useEffect(() => { load(); }, [load]);

  const request = (url: string, method: string, body?: unknown) =>
    rmsRequest(url, { method, body, propertyId: currentPropertyId });
  const saveTrend = async (f: any) => {
    setBusy(true); setError(null);
    try { await request(`${API}/trends`, 'POST', { ...f, propertyId: currentPropertyId }); setShowTrendForm(false); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const deleteTrend = async (id: string) => {
    if (!confirm('Delete this trend?')) return;
    setBusy(true); setError(null);
    try { await request(`${API}/trends/${id}`, 'DELETE', { propertyId: currentPropertyId }); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const exportCsv = () => {
    const rows = [['Period','Revenue','Occupancy','ADR','RevPAR'], ...periods.map(p => [p.period, p.revenue, p.occupancy, p.adr, p.revpar])];
    const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'revenue_analytics.csv'; a.click();
  };

  const metricValue = (d: Period) => selectedMetric === 'occupancy' ? Number(d.occupancy) : selectedMetric === 'adr' ? Number(d.adr) : selectedMetric === 'revpar' ? Number(d.revpar) : Number(d.revenue);
  const metricLabel = selectedMetric === 'occupancy' ? 'Occupancy %' : selectedMetric === 'adr' ? 'ADR ($)' : selectedMetric === 'revpar' ? 'RevPAR ($)' : 'Revenue';
  const maxMetric = useMemo(() => Math.max(1, ...periods.map(metricValue)), [periods, selectedMetric]);
  const totals = useMemo(() => ({
    revenue: periods.reduce((s, p) => s + Number(p.revenue || 0), 0),
    avgOcc: periods.length ? Math.round(periods.reduce((s, p) => s + Number(p.occupancy || 0), 0) / periods.length) : 0,
    avgAdr: periods.length ? Math.round(periods.reduce((s, p) => s + Number(p.adr || 0), 0) / periods.length) : 0,
    avgRevpar: periods.length ? Math.round(periods.reduce((s, p) => s + Number(p.revpar || 0), 0) / periods.length) : 0,
  }), [periods]);
  const heatRoomTypes = useMemo(() => [...new Set(heatMap.map(h => h.room_type))], [heatMap]);
  const heatLookup = useMemo(() => { const m: Record<string, number> = {}; heatMap.forEach(h => { m[`${h.room_type}:${h.month}`] = Number(h.intensity); }); return m; }, [heatMap]);

  if (loading && !periods.length) return <div className="p-6 flex justify-center py-20 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2"/>Loading analytics…</div>;
  if (error && !periods.length) return <div className="p-6 flex flex-col items-center py-20 text-rose-600"><ServerCrash className="w-10 h-10 mb-3"/><p>{error}</p><button onClick={load} className="mt-4 text-blue-600">Retry</button></div>;

  return <div className="p-6 space-y-6">
    <PageHeader title="Business Intelligence" subtitle="Revenue analytics and market intelligence" actions={<button className={button.primary} onClick={exportCsv}><Download className="w-4 h-4"/>Export</button>} />
    {error && <div className="px-4 py-2 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-600">{error}</div>}
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <StatCard title="Total Revenue" value={`$${totals.revenue.toLocaleString()}`} icon={BarChart3} tone="success" />
      <StatCard title="Avg Occupancy" value={`${totals.avgOcc}%`} icon={Activity} tone="info" />
      <StatCard title="Avg ADR" value={`$${totals.avgAdr}`} icon={TrendingUp} tone="accent" />
      <StatCard title="Avg RevPAR" value={`$${totals.avgRevpar}`} icon={TrendingUp} tone="warning" />
    </div>

    <SectionCard title="Year-over-Year Comparison" icon={TrendingUp} pad="md">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {yoy.map(item => <div key={item.id} className="p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600">
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">{item.metric}</p>
          <div className="flex items-center justify-between mb-2">
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{isCurrency(item.metric) ? '$' : ''}{Number(item.current_value).toLocaleString()}</p>
            <div className={`flex items-center gap-1 text-sm font-medium ${Number(item.growth) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {Number(item.growth) >= 0 ? <TrendingUp className="w-4 h-4"/> : <TrendingDown className="w-4 h-4"/>}{Math.abs(Number(item.growth))}%
            </div>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">Previous: {isCurrency(item.metric) ? '$' : ''}{Number(item.previous_value).toLocaleString()}</p>
        </div>)}
      </div>
    </SectionCard>

    <SectionCard title={`${metricLabel} Trend`} icon={BarChart3} pad="md" actions={<div className="flex gap-2">{(['revenue','occupancy','adr','revpar'] as Metric[]).map(m => <button key={m} onClick={() => setSelectedMetric(m)} className={`px-3 py-1 rounded text-sm font-medium transition-colors ${selectedMetric === m ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>{m.toUpperCase()}</button>)}</div>}>
      <div className="h-64 flex items-end gap-2">
        {periods.map(d => <div key={d.id} className="flex-1 flex flex-col items-center justify-end h-full">
          <div className="w-full bg-blue-600 rounded-t transition-all hover:bg-blue-700" style={{ height: `${(metricValue(d) / maxMetric) * 100}%` }}/>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">{d.period}</p>
          <p className="text-xs font-medium text-slate-900 dark:text-white">{selectedMetric === 'occupancy' ? `${metricValue(d)}%` : `$${metricValue(d).toLocaleString()}`}</p>
        </div>)}
      </div>
    </SectionCard>

    <SectionCard title="Market Trends" icon={TrendingUp} pad="md" actions={<button className={button.secondary} onClick={() => setShowTrendForm(true)} disabled={busy}><Plus className="w-4 h-4"/>Add Trend</button>}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {trends.map(t => <div key={t.id} className="p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-medium text-slate-900 dark:text-white">{t.trend}</h4>
            <div className="flex items-center gap-2"><Badge tone={t.impact === 'positive' ? 'success' : 'danger'}>{t.impact}</Badge><button onClick={() => deleteTrend(t.id)} disabled={busy} className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded"><Trash2 className="w-3.5 h-3.5 text-red-600"/></button></div>
          </div>
          <div className="flex items-center justify-between"><span className="text-sm text-slate-600 dark:text-slate-400">Confidence</span><span className="font-semibold text-slate-900 dark:text-white">{t.confidence}%</span></div>
        </div>)}
        {!trends.length && <p className="col-span-full text-center py-8 text-slate-500">No market trends</p>}
      </div>
    </SectionCard>

    <SectionCard title="Forecast Accuracy" icon={Activity} pad="md">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {accuracy.map(f => <div key={f.id} className="p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600">
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">{f.period}</p>
          <div className="flex items-center justify-between mb-2"><p className="text-2xl font-bold text-slate-900 dark:text-white">{f.accuracy}%</p><Activity className="w-5 h-5 text-blue-500"/></div>
          <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden"><div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: `${f.accuracy}%` }}/></div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">Variance: ±{f.variance}%</p>
        </div>)}
      </div>
    </SectionCard>

    <SectionCard title="Revenue Heat Map (Room Type vs Month)" icon={BarChart3} pad="md">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-200 dark:border-slate-700"><th className="text-left p-2 text-slate-600 dark:text-slate-400">Room Type</th>{MONTHS.slice(0, 6).map(m => <th key={m} className="text-center p-2 text-slate-600 dark:text-slate-400">{m}</th>)}</tr></thead>
          <tbody>
            {heatRoomTypes.map(rt => <tr key={rt} className="border-b border-slate-100 dark:border-slate-800">
              <td className="p-2 text-slate-900 dark:text-white font-medium">{rt}</td>
              {[1,2,3,4,5,6].map(m => { const v = heatLookup[`${rt}:${m}`] ?? 0; return <td key={m} className="p-2"><div className={`w-full h-8 ${heatColor(v)} rounded flex items-center justify-center text-xs font-medium text-white`}>{Math.round(v)}%</div></td>; })}
            </tr>)}
          </tbody>
        </table>
      </div>
    </SectionCard>

    {showTrendForm && <TrendForm onCancel={() => setShowTrendForm(false)} onSave={saveTrend} saving={busy} />}
  </div>;
}

const fieldClass = "w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white";
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm font-medium text-slate-700 dark:text-slate-300"><span className="block mb-1">{label}</span>{children}</label>; }

function TrendForm({ onCancel, onSave, saving }: { onCancel: () => void; onSave: (f: any) => void; saving: boolean }) {
  const [f, setF] = useState({ trend: '', impact: 'positive', confidence: 50 });
  return <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"><div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-md w-full"><div className="p-5 border-b flex justify-between items-center"><h3 className="font-semibold text-lg text-slate-900 dark:text-white">Add Market Trend</h3><button onClick={onCancel} className="text-slate-500"><X className="w-5 h-5"/></button></div><div className="p-5 space-y-4">
    <Field label="Trend"><input className={fieldClass} value={f.trend} onChange={e=>setF(p=>({...p,trend:e.target.value}))}/></Field>
    <div className="grid grid-cols-2 gap-4"><Field label="Impact"><select className={fieldClass} value={f.impact} onChange={e=>setF(p=>({...p,impact:e.target.value}))}><option value="positive">Positive</option><option value="negative">Negative</option></select></Field><Field label="Confidence %"><input type="number" className={fieldClass} value={f.confidence} onChange={e=>setF(p=>({...p,confidence:Number(e.target.value)}))}/></Field></div>
  </div><div className="p-5 border-t flex justify-end gap-3"><button className={button.secondary} onClick={onCancel}>Cancel</button><button className={button.primary} disabled={saving || !f.trend} onClick={() => onSave(f)}>{saving && <Loader2 className="w-4 h-4 animate-spin"/>}Save</button></div></div></div>;
}
