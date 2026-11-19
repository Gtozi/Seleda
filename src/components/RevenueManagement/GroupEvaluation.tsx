import { useCallback, useEffect, useMemo, useState } from 'react';
import { useERP } from '../../context/ERPContext';
import { AlertTriangle, BarChart3, Bed, Calendar, CheckCircle2, DollarSign, Eye, Loader2, ServerCrash, Settings, TrendingUp, Users, X, XCircle } from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { Badge, PageHeader, SectionCard } from '../FrontOffice/ui';
import { button } from '../FrontOffice/brandTheme';
import { rmsGet, rmsRequest } from '../../services/rmsService';

const API = '/api/rms-portal/group-evaluation';


const ICONS: Record<string, React.ElementType> = { Users, DollarSign, TrendingUp, Bed, Calendar, BarChart3, AlertTriangle, CheckCircle2, XCircle, Settings, Eye };

type InquiryStatus = 'pending' | 'approved' | 'rejected' | 'all';
type GroupInquiry = { id: string; name: string; company: string; contact: string | null; status: 'pending' | 'approved' | 'rejected'; rooms: number; nights: number; check_in: string | null; check_out: string | null; proposed_rate: number; projected_revenue: number; profitability: number; space_utilization: number; recommendation: 'accept' | 'reject' | 'review'; confidence: number; priority: 'high' | 'medium' | 'low' };
type EvalCriteria = { id: string; title: string; description: string | null; weight: number; icon_name: string | null; display_order: number };



export default function GroupEvaluation() {
  const { currentPropertyId } = useERP();
  const [inquiries, setInquiries] = useState<GroupInquiry[]>([]);
  const [criteria, setCriteria] = useState<EvalCriteria[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedInquiry, setSelectedInquiry] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<InquiryStatus>('pending');
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const json = await rmsGet(API, { propertyId: currentPropertyId });
      setInquiries(json.inquiries || []); setCriteria(json.criteria || []);
    } catch (e: any) { setError(e.message || 'Failed to load group evaluation'); }
    finally { setLoading(false); }
  }, [currentPropertyId]);
  useEffect(() => { load(); }, [load]);

  const request = (url: string, method: string, body?: unknown) =>
    rmsRequest(url, { method, body, propertyId: currentPropertyId });
  const updateStatus = async (id: string, status: 'pending' | 'approved' | 'rejected') => {
    setBusy(true); setError(null);
    try { await request(`${API}/inquiries/${id}/status`, 'PUT', { status, propertyId: currentPropertyId }); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const deleteInquiry = async (id: string) => {
    if (!confirm('Delete this inquiry?')) return;
    setBusy(true); setError(null);
    try { await request(`${API}/inquiries/${id}`, 'DELETE', { propertyId: currentPropertyId }); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const saveInquiry = async (form: any) => {
    setBusy(true); setError(null);
    try { await request(`${API}/inquiries`, 'POST', { ...form, propertyId: currentPropertyId }); setShowForm(false); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  const filtered = useMemo(() => viewMode === 'all' ? inquiries : inquiries.filter(i => i.status === viewMode), [inquiries, viewMode]);
  const pending = useMemo(() => inquiries.filter(i => i.status === 'pending'), [inquiries]);
  const totalProjected = useMemo(() => pending.reduce((s, i) => s + Number(i.projected_revenue), 0), [pending]);
  const avgProfitability = useMemo(() => pending.length ? Math.round(pending.reduce((s, i) => s + Number(i.profitability), 0) / pending.length) : 0, [pending]);
  const totalRooms = useMemo(() => pending.reduce((s, i) => s + i.rooms, 0), [pending]);

  if (loading && !inquiries.length) return <div className="p-6 flex justify-center py-20 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2"/>Loading group evaluation…</div>;
  if (error && !inquiries.length) return <div className="p-6 flex flex-col items-center py-20 text-rose-600"><ServerCrash className="w-10 h-10 mb-3"/><p>{error}</p><button onClick={load} className="mt-4 text-blue-600">Retry</button></div>;

  return <div className="p-6 space-y-6">
    <PageHeader title="Group Evaluation" subtitle="Analyze group inquiries and acceptance recommendations" actions={<div className="flex items-center gap-3"><select value={viewMode} onChange={e => setViewMode(e.target.value as InquiryStatus)} className="px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-700 dark:text-slate-300"><option value="all">All Inquiries</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select><button className={button.primary} onClick={() => setShowForm(true)} disabled={busy}><Users className="w-4 h-4"/>New Inquiry</button></div>} />
    {error && <div className="px-4 py-2 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-600">{error}</div>}
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <StatCard title="Pending Inquiries" value={pending.length} icon={Users} tone="info" />
      <StatCard title="Projected Revenue" value={`$${totalProjected.toLocaleString()}`} icon={DollarSign} tone="success" />
      <StatCard title="Avg Profitability" value={`${avgProfitability}%`} icon={TrendingUp} tone="warning" />
      <StatCard title="Total Rooms" value={totalRooms} icon={Bed} tone="accent" />
    </div>

    <SectionCard title="Group Inquiries" icon={Users} pad="md">
      <div className="space-y-3">
        {filtered.map(inquiry => <div key={inquiry.id} onClick={() => setSelectedInquiry(inquiry.id)} className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${selectedInquiry === inquiry.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'}`}>
          <div className="flex items-start justify-between mb-3"><div className="flex-1"><div className="flex items-center gap-2 mb-1"><h4 className="font-semibold text-slate-900 dark:text-white">{inquiry.name}</h4><Badge tone={inquiry.priority === 'high' ? 'danger' : inquiry.priority === 'medium' ? 'warning' : 'success'}>{inquiry.priority}</Badge><Badge tone={inquiry.recommendation === 'accept' ? 'success' : inquiry.recommendation === 'reject' ? 'danger' : 'warning'}>{inquiry.recommendation}</Badge><Badge tone={inquiry.status === 'approved' ? 'success' : inquiry.status === 'rejected' ? 'danger' : 'warning'}>{inquiry.status}</Badge></div><p className="text-sm text-slate-600 dark:text-slate-400">{inquiry.company} {inquiry.contact && `• ${inquiry.contact}`}</p></div><div className="text-right"><p className="text-xs text-slate-600 dark:text-slate-400">Confidence</p><p className="text-lg font-bold text-slate-900 dark:text-white">{inquiry.confidence}%</p></div></div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm"><div><p className="text-slate-600 dark:text-slate-400">Rooms</p><p className="font-medium text-slate-900 dark:text-white">{inquiry.rooms}</p></div><div><p className="text-slate-600 dark:text-slate-400">Nights</p><p className="font-medium text-slate-900 dark:text-white">{inquiry.nights}</p></div><div><p className="text-slate-600 dark:text-slate-400">Rate</p><p className="font-medium text-slate-900 dark:text-white">${inquiry.proposed_rate}</p></div><div><p className="text-slate-600 dark:text-slate-400">Revenue</p><p className="font-medium text-green-600 dark:text-green-400">${Number(inquiry.projected_revenue).toLocaleString()}</p></div></div>
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-200 dark:border-slate-700"><div className="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-400"><span>{inquiry.check_in} → {inquiry.check_out}</span><span>Profit: {inquiry.profitability}%</span><span>Space: {inquiry.space_utilization}%</span></div>
            {inquiry.status === 'pending' && <div className="flex items-center gap-2"><button onClick={(e)=>{e.stopPropagation();updateStatus(inquiry.id,'approved')}} disabled={busy} className="p-2 hover:bg-green-100 dark:hover:bg-green-900/30 rounded-lg transition-colors" title="Approve"><CheckCircle2 className="w-5 h-5 text-green-600"/></button><button onClick={(e)=>{e.stopPropagation();updateStatus(inquiry.id,'rejected')}} disabled={busy} className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors" title="Reject"><XCircle className="w-5 h-5 text-red-600"/></button><button onClick={(e)=>{e.stopPropagation();deleteInquiry(inquiry.id)}} disabled={busy} className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors" title="Delete"><XCircle className="w-5 h-5 text-red-600"/></button></div>}
            {inquiry.status !== 'pending' && <span className={`text-sm font-medium ${inquiry.status==='approved'?'text-green-600':'text-red-600'}`}>{inquiry.status}</span>}
          </div>
        </div>)}
        {!filtered.length && <p className="text-center py-8 text-slate-500">No inquiries</p>}
      </div>
    </SectionCard>

    <SectionCard title="Evaluation Criteria" icon={Settings} pad="md">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {criteria.map(c => { const Icon = (c.icon_name && ICONS[c.icon_name]) || Settings; return <div key={c.id} className="p-4 rounded-lg border bg-slate-50 dark:bg-slate-700/50"><div className="flex items-center gap-3 mb-2"><div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg"><Icon className="w-5 h-5 text-blue-600 dark:text-blue-400"/></div><div className="flex-1"><h4 className="font-medium text-slate-900 dark:text-white">{c.title}</h4><p className="text-xs text-slate-600 dark:text-slate-400">{c.description}</p></div></div><div className="flex justify-between"><span className="text-sm text-slate-600 dark:text-slate-400">Weight</span><span className="font-semibold text-blue-600 dark:text-blue-400">{c.weight}%</span></div></div>; })}
      </div>
    </SectionCard>

    {showForm && <InquiryForm onCancel={() => setShowForm(false)} onSave={saveInquiry} saving={busy} />}
  </div>;
}

const fieldClass = "w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white";
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm font-medium text-slate-700 dark:text-slate-300"><span className="block mb-1">{label}</span>{children}</label>; }
function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) { return <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"><div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto"><div className="p-5 border-b flex justify-between items-center"><h3 className="font-semibold text-lg text-slate-900 dark:text-white">{title}</h3><button onClick={onClose} className="text-slate-500"><X className="w-5 h-5"/></button></div><div className="p-5">{children}</div>{footer && <div className="p-5 border-t flex justify-end gap-3">{footer}</div>}</div></div>; }

function InquiryForm({ onCancel, onSave, saving }: { onCancel: () => void; onSave: (f: any) => void; saving: boolean }) {
  const [f, setF] = useState({ name: '', company: '', contact: '', rooms: 0, nights: 0, check_in: '', check_out: '', proposed_rate: 0, projected_revenue: 0, profitability: 0, space_utilization: 0, recommendation: 'review', confidence: 0, priority: 'medium' });
  const set = (k: string, v: any) => setF(p => ({ ...p, [k]: v }));
  return <Modal title="New Group Inquiry" onClose={onCancel} footer={<><button className={button.secondary} onClick={onCancel}>Cancel</button><button className={button.primary} disabled={saving || !f.name || !f.company} onClick={() => onSave(f)}>{saving && <Loader2 className="w-4 h-4 animate-spin"/>}Save</button></>}>
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4"><Field label="Name"><input className={fieldClass} value={f.name} onChange={e=>set('name',e.target.value)}/></Field><Field label="Company"><input className={fieldClass} value={f.company} onChange={e=>set('company',e.target.value)}/></Field></div>
      <div className="grid grid-cols-2 gap-4"><Field label="Contact"><input className={fieldClass} value={f.contact} onChange={e=>set('contact',e.target.value)}/></Field><Field label="Priority"><select className={fieldClass} value={f.priority} onChange={e=>set('priority',e.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></Field></div>
      <div className="grid grid-cols-3 gap-4"><Field label="Rooms"><input type="number" className={fieldClass} value={f.rooms} onChange={e=>set('rooms',Number(e.target.value))}/></Field><Field label="Nights"><input type="number" className={fieldClass} value={f.nights} onChange={e=>set('nights',Number(e.target.value))}/></Field><Field label="Proposed Rate"><input type="number" className={fieldClass} value={f.proposed_rate} onChange={e=>set('proposed_rate',Number(e.target.value))}/></Field></div>
      <div className="grid grid-cols-2 gap-4"><Field label="Check-in"><input type="date" className={fieldClass} value={f.check_in} onChange={e=>set('check_in',e.target.value)}/></Field><Field label="Check-out"><input type="date" className={fieldClass} value={f.check_out} onChange={e=>set('check_out',e.target.value)}/></Field></div>
      <div className="grid grid-cols-3 gap-4"><Field label="Revenue"><input type="number" className={fieldClass} value={f.projected_revenue} onChange={e=>set('projected_revenue',Number(e.target.value))}/></Field><Field label="Profitability %"><input type="number" className={fieldClass} value={f.profitability} onChange={e=>set('profitability',Number(e.target.value))}/></Field><Field label="Space %"><input type="number" className={fieldClass} value={f.space_utilization} onChange={e=>set('space_utilization',Number(e.target.value))}/></Field></div>
      <div className="grid grid-cols-2 gap-4"><Field label="Recommendation"><select className={fieldClass} value={f.recommendation} onChange={e=>set('recommendation',e.target.value)}><option value="accept">Accept</option><option value="review">Review</option><option value="reject">Reject</option></select></Field><Field label="Confidence %"><input type="number" className={fieldClass} value={f.confidence} onChange={e=>set('confidence',Number(e.target.value))}/></Field></div>
    </div>
  </Modal>;
}
