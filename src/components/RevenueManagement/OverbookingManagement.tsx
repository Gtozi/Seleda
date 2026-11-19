import { useCallback, useEffect, useMemo, useState } from 'react';
import { useERP } from '../../context/ERPContext';
import { Activity, AlertTriangle, BarChart3, Bed, Loader2, Plus, ServerCrash, Shield, Trash2, TrendingDown, TrendingUp, Users, X } from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { Badge, PageHeader, SectionCard } from '../FrontOffice/ui';
import { button } from '../FrontOffice/brandTheme';
import { rmsGet, rmsRequest } from '../../services/rmsService';

const API = '/api/rms-portal/overbooking-management';


type OverbookLimit = { id: string; room_type: string; total_rooms: number; overbook_limit: number; current_overbook: number; risk_level: 'low' | 'medium' | 'high'; active: boolean };
type WashAnalysis = { id: string; period: string; cancellations: number; no_shows: number; wash_rate: number; expected_wash: number };
type CancellationTrend = { id: string; segment: string; rate: number; trend: 'up' | 'down' | 'stable'; change: number };
type NoshowPrediction = { id: string; date: string; room_type: string; bookings: number; predicted_no_shows: number; confidence: number };
type WalkPartner = { id: string; partner: string; distance: string | null; rate: string | null; agreement: 'active' | 'pending'; active: boolean };
type RiskAssessment = { id: string; date: string; room_type: string; overbook_count: number; risk_level: 'low' | 'medium' | 'high' | 'critical'; factors: string[]; active: boolean };

const riskColors: Record<string, string> = {
  low: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800',
  medium: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
  high: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800',
  critical: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800',
};

export default function OverbookingManagement() {
  const { currentPropertyId } = useERP();
  const [limits, setLimits] = useState<OverbookLimit[]>([]);
  const [washAnalysis, setWashAnalysis] = useState<WashAnalysis[]>([]);
  const [cancellationTrends, setCancellationTrends] = useState<CancellationTrend[]>([]);
  const [noshowPredictions, setNoshowPredictions] = useState<NoshowPrediction[]>([]);
  const [walkPartners, setWalkPartners] = useState<WalkPartner[]>([]);
  const [riskAssessment, setRiskAssessment] = useState<RiskAssessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedRoomType, setSelectedRoomType] = useState<string | null>(null);
  const [showPartnerForm, setShowPartnerForm] = useState(false);
  const [showRiskForm, setShowRiskForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const json = await rmsGet(API, { propertyId: currentPropertyId });
      setLimits(json.overbookingLimits || []); setWashAnalysis(json.washAnalysis || []); setCancellationTrends(json.cancellationTrends || []);
      setNoshowPredictions(json.noshowPredictions || []); setWalkPartners(json.walkPartners || []); setRiskAssessment(json.riskAssessment || []);
    } catch (e: any) { setError(e.message || 'Failed to load overbooking management'); }
    finally { setLoading(false); }
  }, [currentPropertyId]);
  useEffect(() => { load(); }, [load]);

  const request = (url: string, method: string, body?: unknown) =>
    rmsRequest(url, { method, body, propertyId: currentPropertyId });
  const savePartner = async (form: any) => {
    setBusy(true); setError(null);
    try { await request(`${API}/walk-partners`, 'POST', { ...form, propertyId: currentPropertyId }); setShowPartnerForm(false); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const deletePartner = async (id: string) => {
    if (!confirm('Delete this walk partner?')) return;
    setBusy(true); setError(null);
    try { await request(`${API}/walk-partners/${id}`, 'DELETE', { propertyId: currentPropertyId }); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const saveRisk = async (form: any) => {
    setBusy(true); setError(null);
    try { await request(`${API}/risk-assessment`, 'POST', { ...form, propertyId: currentPropertyId }); setShowRiskForm(false); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const adjustLimit = async (id: string, delta: number) => {
    const limit = limits.find(l => l.id === id);
    if (!limit) return;
    setBusy(true); setError(null);
    try { await request(`${API}/limits/${id}`, 'PUT', { overbook_limit: Math.max(0, limit.overbook_limit + delta), propertyId: currentPropertyId }); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  const totalLimit = useMemo(() => limits.reduce((s, l) => s + l.overbook_limit, 0), [limits]);
  const totalOverbook = useMemo(() => limits.reduce((s, l) => s + l.current_overbook, 0), [limits]);
  const criticalRisks = useMemo(() => riskAssessment.filter(r => r.risk_level === 'critical' || r.risk_level === 'high').length, [riskAssessment]);

  if (loading && !limits.length) return <div className="p-6 flex justify-center py-20 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2"/>Loading overbooking management…</div>;
  if (error && !limits.length) return <div className="p-6 flex flex-col items-center py-20 text-rose-600"><ServerCrash className="w-10 h-10 mb-3"/><p>{error}</p><button onClick={load} className="mt-4 text-blue-600">Retry</button></div>;

  return <div className="p-6 space-y-6">
    <PageHeader title="Overbooking Management" subtitle="Manage overbooking limits, wash analysis, and walk strategy" actions={<div className="flex items-center gap-3"><button className={button.secondary} onClick={() => setShowRiskForm(true)} disabled={busy}><AlertTriangle className="w-4 h-4"/>Add Risk</button><button className={button.primary} onClick={() => setShowPartnerForm(true)} disabled={busy}><Plus className="w-4 h-4"/>Add Partner</button></div>} />
    {error && <div className="px-4 py-2 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-600">{error}</div>}
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <StatCard title="Total Overbook Limit" value={totalLimit} icon={Bed} tone="info" />
      <StatCard title="Current Overbooked" value={totalOverbook} icon={Users} tone="warning" />
      <StatCard title="High/Critical Risks" value={criticalRisks} icon={AlertTriangle} tone="danger" />
      <StatCard title="Wash Rate (30d)" value={`${washAnalysis.find(w=>w.period.includes('30'))?.wash_rate || 0}%`} icon={BarChart3} tone="accent" />
    </div>

    <SectionCard title="Overbooking Limits by Room Type" icon={Bed} pad="md">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {limits.map(limit => { const usage = Math.round((limit.current_overbook / limit.overbook_limit) * 100); return <div key={limit.id} onClick={() => setSelectedRoomType(limit.id)} className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${selectedRoomType === limit.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'}`}>
          <div className="flex justify-between mb-3"><div className="flex items-center gap-2"><Bed className="w-5 h-5 text-slate-600 dark:text-slate-400"/><h4 className="font-semibold text-slate-900 dark:text-white">{limit.room_type}</h4></div><Badge tone={limit.risk_level === 'high' ? 'danger' : limit.risk_level === 'medium' ? 'warning' : 'success'}>{limit.risk_level}</Badge></div>
          <div className="space-y-2"><div className="flex justify-between text-sm"><span className="text-slate-600 dark:text-slate-400">Limit</span><span className="font-medium text-slate-900 dark:text-white">{limit.overbook_limit} rooms</span></div><div className="flex justify-between text-sm"><span className="text-slate-600 dark:text-slate-400">Current</span><span className="font-medium text-slate-900 dark:text-white">{limit.current_overbook} rooms</span></div><div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden"><div className={`h-full rounded-full ${usage >= 80 ? 'bg-red-500' : usage >= 50 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${usage}%` }}/></div><p className="text-xs text-slate-600 dark:text-slate-400">{usage}% of limit used</p></div>
          <div className="mt-3 flex gap-2"><button onClick={(e)=>{e.stopPropagation();adjustLimit(limit.id,-1)}} disabled={busy} className="px-2 py-1 text-xs bg-slate-200 dark:bg-slate-700 rounded">-1</button><button onClick={(e)=>{e.stopPropagation();adjustLimit(limit.id,1)}} disabled={busy} className="px-2 py-1 text-xs bg-slate-200 dark:bg-slate-700 rounded">+1</button></div>
        </div>; })}
      </div>
    </SectionCard>

    <SectionCard title="Wash Analysis (Cancellations + No-Shows)" icon={Activity} pad="md">
      <div className="space-y-3">
        {washAnalysis.map(w => { const variance = w.wash_rate - w.expected_wash; return <div key={w.id} className="flex justify-between p-4 rounded-lg border bg-slate-50 dark:bg-slate-700/50"><div className="flex items-center gap-4"><Activity className="w-5 h-5 text-slate-600 dark:text-slate-400"/><div><h4 className="font-medium text-slate-900 dark:text-white">{w.period}</h4><div className="flex gap-4 text-sm text-slate-600 dark:text-slate-400"><span>Cancellations: {w.cancellations}</span><span>No-Shows: {w.no_shows}</span></div></div></div><div className="flex gap-6 text-right"><div><p className="text-sm text-slate-600 dark:text-slate-400">Wash Rate</p><p className="text-lg font-semibold text-slate-900 dark:text-white">{w.wash_rate}%</p></div><div><p className="text-sm text-slate-600 dark:text-slate-400">Expected</p><p className="text-lg font-semibold text-slate-900 dark:text-white">{w.expected_wash}%</p></div><div><p className="text-sm text-slate-600 dark:text-slate-400">Variance</p><p className={`text-lg font-semibold ${variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>{variance >= 0 ? '+' : ''}{variance}%</p></div></div></div>; })}
      </div>
    </SectionCard>

    <SectionCard title="Cancellation Trends by Segment" icon={TrendingDown} pad="md">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {cancellationTrends.map(t => <div key={t.id} className="p-4 rounded-lg border bg-slate-50 dark:bg-slate-700/50"><h4 className="font-medium text-slate-900 dark:text-white mb-2">{t.segment}</h4><div className="flex justify-between"><div><p className="text-sm text-slate-600 dark:text-slate-400">Cancellation Rate</p><p className="text-lg font-semibold text-slate-900 dark:text-white">{t.rate}%</p></div><div className="flex items-center gap-2">{t.trend === 'up' ? <TrendingUp className="w-4 h-4 text-red-500"/> : t.trend === 'down' ? <TrendingDown className="w-4 h-4 text-green-500"/> : <Activity className="w-4 h-4 text-slate-400"/>}<span className={`text-sm font-medium ${t.change > 0 ? 'text-red-600' : t.change < 0 ? 'text-green-600' : 'text-slate-600'}`}>{t.change > 0 ? '+' : ''}{t.change}%</span></div></div></div>)}
      </div>
    </SectionCard>

    <SectionCard title="No-Show Predictions" icon={Users} pad="md">
      <div className="space-y-3">
        {noshowPredictions.map(p => { const rate = Math.round((p.predicted_no_shows / p.bookings) * 100); return <div key={p.id} className="flex justify-between p-4 rounded-lg border bg-slate-50 dark:bg-slate-700/50"><div className="flex items-center gap-4"><Users className="w-5 h-5 text-slate-600 dark:text-slate-400"/><div><div className="flex items-center gap-2 mb-1"><h4 className="font-medium text-slate-900 dark:text-white">{p.date}</h4><span className="text-sm text-slate-600 dark:text-slate-400">• {p.room_type}</span></div><div className="flex gap-4 text-sm text-slate-600 dark:text-slate-400"><span>Bookings: {p.bookings}</span><span>Predicted No-Shows: {p.predicted_no_shows}</span></div></div></div><div className="flex gap-6 text-right"><div><p className="text-sm text-slate-600 dark:text-slate-400">No-Show Rate</p><p className="text-lg font-semibold text-slate-900 dark:text-white">{rate}%</p></div><div><p className="text-sm text-slate-600 dark:text-slate-400">Confidence</p><p className="text-lg font-semibold text-blue-600">{p.confidence}%</p></div></div></div>; })}
      </div>
    </SectionCard>

    <SectionCard title="Walk Strategy Partners" icon={Shield} pad="md" actions={<button className={button.secondary} onClick={() => setShowPartnerForm(true)} disabled={busy}>+ Add Partner</button>}>
      <div className="space-y-3">
        {walkPartners.map(p => <div key={p.id} className="flex justify-between p-4 rounded-lg border bg-slate-50 dark:bg-slate-700/50"><div className="flex items-center gap-3"><Shield className="w-5 h-5 text-blue-500"/><div><h4 className="font-medium text-slate-900 dark:text-white">{p.partner}</h4><div className="flex gap-4 text-sm text-slate-600 dark:text-slate-400"><span>Distance: {p.distance}</span><span>Rate: {p.rate}</span></div></div></div><div className="flex items-center gap-3"><Badge tone={p.agreement === 'active' ? 'success' : 'warning'}>{p.agreement}</Badge><button onClick={() => deletePartner(p.id)} disabled={busy} className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"><Trash2 className="w-4 h-4 text-red-600"/></button></div></div>)}
      </div>
    </SectionCard>

    <SectionCard title="Risk Assessment" icon={AlertTriangle} pad="md" actions={<button className={button.secondary} onClick={() => setShowRiskForm(true)} disabled={busy}>+ Add Risk</button>}>
      <div className="space-y-3">
        {riskAssessment.map(r => <div key={r.id} className={`p-4 rounded-lg border ${r.risk_level === 'critical' ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' : r.risk_level === 'high' ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800' : 'bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600'}`}>
          <div className="flex justify-between mb-3"><div className="flex items-center gap-3"><AlertTriangle className={`w-5 h-5 ${r.risk_level === 'critical' ? 'text-red-500' : r.risk_level === 'high' ? 'text-orange-500' : 'text-amber-500'}`}/><div><div className="flex items-center gap-2 mb-1"><h4 className="font-medium text-slate-900 dark:text-white">{r.date}</h4><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${riskColors[r.risk_level]} border`}>{r.risk_level}</span></div><p className="text-sm text-slate-600 dark:text-slate-400">{r.room_type} • {r.overbook_count} overbooked</p></div></div></div>
          <div className="space-y-1"><p className="text-xs text-slate-600 dark:text-slate-400">Risk Factors:</p>{r.factors.map((f, i) => <p key={i} className="text-sm text-slate-700 dark:text-slate-300">• {f}</p>)}</div>
        </div>)}
      </div>
    </SectionCard>

    {showPartnerForm && <PartnerForm onCancel={() => setShowPartnerForm(false)} onSave={savePartner} saving={busy} />}
    {showRiskForm && <RiskForm onCancel={() => setShowRiskForm(false)} onSave={saveRisk} saving={busy} />}
  </div>;
}

const fieldClass = "w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white";
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm font-medium text-slate-700 dark:text-slate-300"><span className="block mb-1">{label}</span>{children}</label>; }
function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) { return <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"><div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto"><div className="p-5 border-b flex justify-between items-center"><h3 className="font-semibold text-lg text-slate-900 dark:text-white">{title}</h3><button onClick={onClose} className="text-slate-500"><X className="w-5 h-5"/></button></div><div className="p-5">{children}</div>{footer && <div className="p-5 border-t flex justify-end gap-3">{footer}</div>}</div></div>; }

function PartnerForm({ onCancel, onSave, saving }: { onCancel: () => void; onSave: (f: any) => void; saving: boolean }) {
  const [f, setF] = useState({ partner: '', distance: '', rate: '', agreement: 'pending' });
  const set = (k: string, v: any) => setF(p => ({ ...p, [k]: v }));
  return <Modal title="Add Walk Partner" onClose={onCancel} footer={<><button className={button.secondary} onClick={onCancel}>Cancel</button><button className={button.primary} disabled={saving || !f.partner} onClick={() => onSave(f)}>{saving && <Loader2 className="w-4 h-4 animate-spin"/>}Save</button></>}>
    <div className="space-y-4">
      <Field label="Partner"><input className={fieldClass} value={f.partner} onChange={e=>set('partner',e.target.value)}/></Field>
      <div className="grid grid-cols-2 gap-4"><Field label="Distance"><input className={fieldClass} value={f.distance} onChange={e=>set('distance',e.target.value)}/></Field><Field label="Rate"><input className={fieldClass} value={f.rate} onChange={e=>set('rate',e.target.value)}/></Field></div>
      <Field label="Agreement"><select className={fieldClass} value={f.agreement} onChange={e=>set('agreement',e.target.value)}><option value="pending">Pending</option><option value="active">Active</option></select></Field>
    </div>
  </Modal>;
}

function RiskForm({ onCancel, onSave, saving }: { onCancel: () => void; onSave: (f: any) => void; saving: boolean }) {
  const [f, setF] = useState({ date: '', room_type: 'All', overbook_count: 0, risk_level: 'low', factors: '' });
  const set = (k: string, v: any) => setF(p => ({ ...p, [k]: v }));
  const handleSave = () => onSave({ ...f, factors: f.factors.split(',').map(x => x.trim()).filter(Boolean) });
  return <Modal title="Add Risk Assessment" onClose={onCancel} footer={<><button className={button.secondary} onClick={onCancel}>Cancel</button><button className={button.primary} disabled={saving || !f.date} onClick={handleSave}>{saving && <Loader2 className="w-4 h-4 animate-spin"/>}Save</button></>}>
    <div className="space-y-4">
      <Field label="Date"><input type="date" className={fieldClass} value={f.date} onChange={e=>set('date',e.target.value)}/></Field>
      <div className="grid grid-cols-2 gap-4"><Field label="Room Type"><input className={fieldClass} value={f.room_type} onChange={e=>set('room_type',e.target.value)}/></Field><Field label="Overbook Count"><input type="number" className={fieldClass} value={f.overbook_count} onChange={e=>set('overbook_count',Number(e.target.value))}/></Field></div>
      <Field label="Risk Level"><select className={fieldClass} value={f.risk_level} onChange={e=>set('risk_level',e.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></Field>
      <Field label="Risk Factors (comma-separated)"><input className={fieldClass} value={f.factors} onChange={e=>set('factors',e.target.value)} placeholder="Holiday period, High demand"/></Field>
    </div>
  </Modal>;
}
