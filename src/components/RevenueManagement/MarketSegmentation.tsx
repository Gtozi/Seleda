import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Bed, Briefcase, Building, DollarSign, Globe, Loader2, Package, Phone, Plane, Plus, ServerCrash, Star, TrendingUp, Users, X, Zap } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard } from '../FrontOffice/ui';
import { button } from '../FrontOffice/brandTheme';
import { rmsGet, rmsRequest } from '../../services/rmsService';

const API = '/api/rms-portal/market-segmentation';


const ICONS: Record<string, React.ElementType> = { Users, Briefcase, Building, Plane, Package, Globe, Phone, Star, DollarSign, TrendingUp, BarChart3, Bed, Zap };

type ViewMode = 'revenue' | 'adr' | 'revpar' | 'occupancy' | 'profitability';
type Segment = { id: string; code: string; name: string; icon_name: string | null; revenue: number; adr: number; revpar: number; occupancy: number; profitability: number; growth: number; color: string; active: boolean };

const colorClasses: Record<string, string> = {
  blue: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
  green: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
  purple: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
  orange: 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400',
  red: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
  amber: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
  cyan: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400',
  emerald: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
  yellow: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400',
};

export default function MarketSegmentation() {
  const { currentPropertyId } = useERP();
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedSegment, setSelectedSegment] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('revenue');
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const json = await rmsGet(API, { propertyId: currentPropertyId });
      setSegments(json.segments || []);
    } catch (e: any) { setError(e.message || 'Failed to load market segmentation'); }
    finally { setLoading(false); }
  }, [currentPropertyId]);
  useEffect(() => { load(); }, [load]);

  const request = (url: string, method: string, body?: unknown) =>
    rmsRequest(url, { method, body, propertyId: currentPropertyId });
  const save = async (form: any) => {
    setBusy(true); setError(null);
    try { await request(API, 'POST', form); setShowForm(false); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  const activeSegments = useMemo(() => segments.filter(s => s.active), [segments]);
  const totalRevenue = useMemo(() => activeSegments.reduce((sum, s) => sum + Number(s.revenue), 0), [activeSegments]);
  const avgAdr = useMemo(() => activeSegments.length ? Math.round(activeSegments.reduce((sum, s) => sum + Number(s.adr), 0) / activeSegments.length) : 0, [activeSegments]);
  const avgOccupancy = useMemo(() => activeSegments.length ? Math.round(activeSegments.reduce((sum, s) => sum + Number(s.occupancy), 0) / activeSegments.length) : 0, [activeSegments]);
  const segmentMix = useMemo(() => activeSegments.map(s => ({ name: s.name, percentage: totalRevenue ? Math.round((Number(s.revenue) / totalRevenue) * 100) : 0, color: s.color })), [activeSegments, totalRevenue]);
  const topPerformers = useMemo(() => [...activeSegments].sort((a, b) => Number(b.revenue) - Number(a.revenue)).slice(0, 3), [activeSegments]);

  if (loading && !segments.length) return <div className="p-6 flex justify-center py-20 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2"/>Loading market segmentation…</div>;
  if (error && !segments.length) return <div className="p-6 flex flex-col items-center py-20 text-rose-600"><ServerCrash className="w-10 h-10 mb-3"/><p>{error}</p><button onClick={load} className="mt-4 text-blue-600">Retry</button></div>;

  return <div className="p-6 space-y-6">
    <PageHeader title="Market Segmentation" subtitle="Analyze performance by market segment" actions={<button className={button.primary} onClick={() => setShowForm(true)} disabled={busy}><Plus className="w-4 h-4"/>Add Segment</button>} />
    {error && <div className="px-4 py-2 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-600">{error}</div>}
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <StatCard title="Total Revenue" value={`$${totalRevenue.toLocaleString()}`} icon={DollarSign} tone="info" />
      <StatCard title="Average ADR" value={`$${avgAdr}`} icon={BarChart3} tone="success" />
      <StatCard title="Avg Occupancy" value={`${avgOccupancy}%`} icon={Bed} tone="accent" />
    </div>

    <div className="flex justify-end"><select value={viewMode} onChange={e => setViewMode(e.target.value as ViewMode)} className="px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-700 dark:text-slate-300"><option value="revenue">Revenue View</option><option value="adr">ADR View</option><option value="revpar">RevPAR View</option><option value="occupancy">Occupancy View</option><option value="profitability">Profitability View</option></select></div>

    <SectionCard title="Market Segments" icon={Users} pad="md">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {activeSegments.map(segment => { const Icon = (segment.icon_name && ICONS[segment.icon_name]) || Users; const primary = getValue(segment, viewMode); return <div key={segment.code} onClick={() => setSelectedSegment(segment.id)} className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${selectedSegment === segment.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'}`}>
          <div className="flex items-center gap-3 mb-3"><div className={`p-2 rounded-lg ${colorClasses[segment.color] || 'bg-slate-100 dark:bg-slate-700'}`}><Icon className="w-5 h-5"/></div><div className="flex-1"><h4 className="font-semibold text-slate-900 dark:text-white">{segment.name}</h4><p className={`text-sm ${segment.growth >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{segment.growth >= 0 ? '+' : ''}{segment.growth}% growth</p></div></div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white mb-2">{primary}</div>
          <div className="grid grid-cols-2 gap-2 text-sm"><div><p className="text-slate-600 dark:text-slate-400">Revenue</p><p className="font-medium text-slate-900 dark:text-white">${Number(segment.revenue).toLocaleString()}</p></div><div><p className="text-slate-600 dark:text-slate-400">ADR</p><p className="font-medium text-slate-900 dark:text-white">${segment.adr}</p></div><div><p className="text-slate-600 dark:text-slate-400">RevPAR</p><p className="font-medium text-slate-900 dark:text-white">${segment.revpar}</p></div><div><p className="text-slate-600 dark:text-slate-400">Profitability</p><p className="font-medium text-slate-900 dark:text-white">{segment.profitability}%</p></div></div>
        </div>; })}
      </div>
    </SectionCard>

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <SectionCard title="Revenue Mix by Segment" icon={BarChart3} pad="md">
        <div className="space-y-3">{segmentMix.map(item => <div key={item.name} className="flex items-center gap-3"><span className="w-32 text-sm text-slate-600 dark:text-slate-400">{item.name}</span><div className="flex-1 h-4 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all ${colorClasses[item.color] ? colorClasses[item.color].replace('text-', 'bg-').split(' ')[0] : 'bg-blue-600'}`} style={{ width: `${item.percentage}%` }}/></div><span className="w-12 text-sm font-medium text-slate-900 dark:text-white text-right">{item.percentage}%</span></div>)}</div>
      </SectionCard>
      <SectionCard title="Top Performing Segments" icon={TrendingUp} pad="md">
        <div className="space-y-3">{topPerformers.map((segment, idx) => <div key={segment.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg"><div className="flex items-center gap-3"><span className="w-6 h-6 flex items-center justify-center bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full text-sm font-bold">{idx + 1}</span><span className="font-medium text-slate-900 dark:text-white">{segment.name}</span></div><div className="text-right"><p className="font-semibold text-slate-900 dark:text-white">${Number(segment.revenue).toLocaleString()}</p><p className={`text-sm ${segment.growth >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{segment.growth >= 0 ? '+' : ''}{segment.growth}%</p></div></div>)}</div>
      </SectionCard>
    </div>

    {showForm && <SegmentForm onCancel={() => setShowForm(false)} onSave={save} saving={busy} />}
  </div>;
}

function getValue(segment: Segment, viewMode: ViewMode) {
  switch (viewMode) {
    case 'revenue': return `$${Number(segment.revenue).toLocaleString()}`;
    case 'adr': return `$${segment.adr}`;
    case 'revpar': return `$${segment.revpar}`;
    case 'occupancy': return `${segment.occupancy}%`;
    case 'profitability': return `${segment.profitability}%`;
  }
}

const fieldClass = "w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white";
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm font-medium text-slate-700 dark:text-slate-300"><span className="block mb-1">{label}</span>{children}</label>; }
function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) { return <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"><div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto"><div className="p-5 border-b flex justify-between items-center"><h3 className="font-semibold text-lg text-slate-900 dark:text-white">{title}</h3><button onClick={onClose} className="text-slate-500"><X className="w-5 h-5"/></button></div><div className="p-5">{children}</div>{footer && <div className="p-5 border-t flex justify-end gap-3">{footer}</div>}</div></div>; }

function SegmentForm({ onCancel, onSave, saving }: { onCancel: () => void; onSave: (f: any) => void; saving: boolean }) {
  const [f, setF] = useState({ code: '', name: '', icon_name: 'Users', revenue: 0, adr: 0, revpar: 0, occupancy: 0, profitability: 0, growth: 0, color: 'blue', active: true });
  const set = (k: string, v: any) => setF(p => ({ ...p, [k]: v }));
  return <Modal title="Add Segment" onClose={onCancel} footer={<><button className={button.secondary} onClick={onCancel}>Cancel</button><button className={button.primary} disabled={saving || !f.code || !f.name} onClick={() => onSave(f)}>{saving && <Loader2 className="w-4 h-4 animate-spin"/>}Save</button></>}>
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4"><Field label="Code"><input className={fieldClass} value={f.code} onChange={e=>set('code',e.target.value)}/></Field><Field label="Name"><input className={fieldClass} value={f.name} onChange={e=>set('name',e.target.value)}/></Field></div>
      <div className="grid grid-cols-2 gap-4"><Field label="Icon"><select className={fieldClass} value={f.icon_name} onChange={e=>set('icon_name',e.target.value)}>{Object.keys(ICONS).map(k => <option key={k} value={k}>{k}</option>)}</select></Field><Field label="Color"><select className={fieldClass} value={f.color} onChange={e=>set('color',e.target.value)}>{Object.keys(colorClasses).map(c => <option key={c} value={c}>{c}</option>)}</select></Field></div>
      <div className="grid grid-cols-3 gap-4"><Field label="Revenue"><input type="number" className={fieldClass} value={f.revenue} onChange={e=>set('revenue',Number(e.target.value))}/></Field><Field label="ADR"><input type="number" className={fieldClass} value={f.adr} onChange={e=>set('adr',Number(e.target.value))}/></Field><Field label="RevPAR"><input type="number" className={fieldClass} value={f.revpar} onChange={e=>set('revpar',Number(e.target.value))}/></Field></div>
      <div className="grid grid-cols-3 gap-4"><Field label="Occupancy %"><input type="number" className={fieldClass} value={f.occupancy} onChange={e=>set('occupancy',Number(e.target.value))}/></Field><Field label="Profitability %"><input type="number" className={fieldClass} value={f.profitability} onChange={e=>set('profitability',Number(e.target.value))}/></Field><Field label="Growth %"><input type="number" className={fieldClass} value={f.growth} onChange={e=>set('growth',Number(e.target.value))}/></Field></div>
      <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400"><input type="checkbox" checked={f.active} onChange={e=>set('active',e.target.checked)} className="rounded"/>Active</label>
    </div>
  </Modal>;
}
