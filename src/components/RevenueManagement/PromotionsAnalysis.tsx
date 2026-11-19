import { useCallback, useEffect, useMemo, useState } from 'react';
import { useERP } from '../../context/ERPContext';
import { BarChart3, DollarSign, Edit, Loader2, Percent, Plus, ServerCrash, Tag, Trash2, TrendingUp, Users, X } from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { Badge, PageHeader, SectionCard } from '../FrontOffice/ui';
import { button } from '../FrontOffice/brandTheme';
import { rmsGet, rmsRequest } from '../../services/rmsService';

const API = '/api/rms-portal/promotions-analysis';


type PromoStatus = 'active' | 'scheduled' | 'ended';
type Promo = { id: string; name: string; code: string; promo_type: string; discount: number; status: PromoStatus; start_date: string | null; end_date: string | null; bookings: number; revenue: number; incremental_revenue: number; roi: number; target_segment: string };
type Coupon = { id: string; code: string; usage_count: number; redemptions: number; conversion: number; avg_discount: number };

const statusTone: Record<PromoStatus, 'success' | 'info' | 'neutral'> = { active: 'success', scheduled: 'info', ended: 'neutral' };
const typeTone: Record<string, 'accent' | 'warning' | 'info' | 'success'> = { discount: 'accent', flash: 'warning', loyalty: 'info', group: 'success' };

export default function PromotionsAnalysis() {
  const { currentPropertyId } = useERP();
  const [promotions, setPromotions] = useState<Promo[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedPromotion, setSelectedPromotion] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'all' | PromoStatus>('active');
  const [form, setForm] = useState<Promo | 'new' | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const json = await rmsGet(API, { propertyId: currentPropertyId });
      setPromotions(json.promotions || []); setCoupons(json.coupons || []);
    } catch (e: any) { setError(e.message || 'Failed to load promotions'); }
    finally { setLoading(false); }
  }, [currentPropertyId]);
  useEffect(() => { load(); }, [load]);

  const request = (url: string, method: string, body?: unknown) =>
    rmsRequest(url, { method, body, propertyId: currentPropertyId });
  const savePromo = async (f: any, editing?: Promo) => {
    setBusy(true); setError(null);
    try { await request(editing ? `${API}/${editing.id}` : API, editing ? 'PUT' : 'POST', { ...f, propertyId: currentPropertyId }); setForm(null); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const deletePromo = async (id: string) => {
    if (!confirm('Delete this promotion?')) return;
    setBusy(true); setError(null);
    try { await request(`${API}/${id}`, 'DELETE', { propertyId: currentPropertyId }); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  const filtered = useMemo(() => viewMode === 'all' ? promotions : promotions.filter(p => p.status === viewMode), [promotions, viewMode]);
  const metrics = useMemo(() => {
    const active = promotions.filter(p => p.status === 'active');
    return {
      totalRevenue: active.reduce((s, p) => s + Number(p.revenue || 0), 0),
      totalIncremental: active.reduce((s, p) => s + Number(p.incremental_revenue || 0), 0),
      avgROI: active.length ? Math.round(active.reduce((s, p) => s + Number(p.roi || 0), 0) / active.length) : 0,
      totalBookings: active.reduce((s, p) => s + Number(p.bookings || 0), 0),
    };
  }, [promotions]);
  const activePromos = useMemo(() => promotions.filter(p => p.status === 'active'), [promotions]);

  if (loading && !promotions.length) return <div className="p-6 flex justify-center py-20 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2"/>Loading promotions…</div>;
  if (error && !promotions.length) return <div className="p-6 flex flex-col items-center py-20 text-rose-600"><ServerCrash className="w-10 h-10 mb-3"/><p>{error}</p><button onClick={load} className="mt-4 text-blue-600">Retry</button></div>;

  return <div className="p-6 space-y-6">
    <PageHeader title="Promotions Analysis" subtitle="Analyze promotion performance and ROI" actions={<div className="flex items-center gap-3"><select value={viewMode} onChange={e => setViewMode(e.target.value as any)} className="px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-sm"><option value="all">All Promotions</option><option value="active">Active</option><option value="scheduled">Scheduled</option><option value="ended">Ended</option></select><button className={button.primary} onClick={() => setForm('new')} disabled={busy}><Plus className="w-4 h-4"/>New Promotion</button></div>} />
    {error && <div className="px-4 py-2 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-600">{error}</div>}
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <StatCard title="Total Revenue" value={`$${metrics.totalRevenue.toLocaleString()}`} icon={DollarSign} tone="success" />
      <StatCard title="Incremental Revenue" value={`$${metrics.totalIncremental.toLocaleString()}`} icon={TrendingUp} tone="info" />
      <StatCard title="Average ROI" value={`${metrics.avgROI}%`} icon={Percent} tone="accent" />
      <StatCard title="Total Bookings" value={metrics.totalBookings} icon={Users} tone="warning" />
    </div>

    <SectionCard title="Promotions" icon={Tag} pad="md">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(p => <div key={p.id} onClick={() => setSelectedPromotion(p.id)} className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${selectedPromotion === p.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'}`}>
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1"><h4 className="font-semibold text-slate-900 dark:text-white">{p.name}</h4><Badge tone={statusTone[p.status]}>{p.status}</Badge></div>
              <div className="flex items-center gap-2 mb-1"><span className="text-sm text-slate-600 dark:text-slate-400">{p.code}</span><Badge tone={typeTone[p.promo_type] || 'neutral'}>{p.promo_type}</Badge></div>
              <p className="text-xs text-slate-600 dark:text-slate-400">{p.start_date} → {p.end_date}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm mb-3">
            <div><p className="text-slate-600 dark:text-slate-400">Discount</p><p className="font-medium text-slate-900 dark:text-white">{p.discount}%</p></div>
            <div><p className="text-slate-600 dark:text-slate-400">Bookings</p><p className="font-medium text-slate-900 dark:text-white">{p.bookings}</p></div>
            <div><p className="text-slate-600 dark:text-slate-400">Revenue</p><p className="font-medium text-green-600 dark:text-green-400">${Number(p.revenue).toLocaleString()}</p></div>
            <div><p className="text-slate-600 dark:text-slate-400">ROI</p><p className="font-medium text-blue-600 dark:text-blue-400">{p.roi}%</p></div>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-700">
            <div className="text-xs text-slate-600 dark:text-slate-400">Target: {p.target_segment}</div>
            <div className="flex items-center gap-1">
              <button onClick={e => { e.stopPropagation(); setForm(p); }} disabled={busy} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors"><Edit className="w-4 h-4 text-slate-600 dark:text-slate-400"/></button>
              <button onClick={e => { e.stopPropagation(); deletePromo(p.id); }} disabled={busy} className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"><Trash2 className="w-4 h-4 text-red-600"/></button>
            </div>
          </div>
        </div>)}
        {!filtered.length && <p className="col-span-full text-center py-8 text-slate-500">No {viewMode === 'all' ? '' : viewMode + ' '}promotions</p>}
      </div>
    </SectionCard>

    <SectionCard title="Coupon Performance" icon={Tag} pad="md">
      <div className="space-y-3">
        {coupons.map(c => <div key={c.id} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600">
          <div className="flex items-center gap-3"><Tag className="w-5 h-5 text-slate-600 dark:text-slate-400"/><div><h4 className="font-medium text-slate-900 dark:text-white">{c.code}</h4><div className="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-400"><span>Usage: {c.usage_count}</span><span>Redemptions: {c.redemptions}</span></div></div></div>
          <div className="flex items-center gap-6">
            <div className="text-right"><p className="text-sm text-slate-600 dark:text-slate-400">Conversion</p><p className="text-lg font-semibold text-green-600 dark:text-green-400">{c.conversion}%</p></div>
            <div className="text-right"><p className="text-sm text-slate-600 dark:text-slate-400">Avg Discount</p><p className="text-lg font-semibold text-slate-900 dark:text-white">${c.avg_discount}</p></div>
          </div>
        </div>)}
        {!coupons.length && <p className="text-center py-8 text-slate-500">No coupon data</p>}
      </div>
    </SectionCard>

    <SectionCard title="Campaign Revenue Breakdown" icon={BarChart3} pad="md">
      <div className="space-y-3">
        {activePromos.map(p => {
          const incrementalPercent = Number(p.revenue) > 0 ? Math.round((Number(p.incremental_revenue) / Number(p.revenue)) * 100) : 0;
          return <div key={p.id} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
            <div className="flex items-center gap-4"><BarChart3 className="w-5 h-5 text-slate-600 dark:text-slate-400"/><div><h4 className="font-medium text-slate-900 dark:text-white">{p.name}</h4><p className="text-sm text-slate-600 dark:text-slate-400">{p.bookings} bookings</p></div></div>
            <div className="flex items-center gap-6">
              <div className="text-right"><p className="text-sm text-slate-600 dark:text-slate-400">Total Revenue</p><p className="font-semibold text-slate-900 dark:text-white">${Number(p.revenue).toLocaleString()}</p></div>
              <div className="text-right"><p className="text-sm text-slate-600 dark:text-slate-400">Incremental</p><p className="font-semibold text-green-600 dark:text-green-400">${Number(p.incremental_revenue).toLocaleString()}</p></div>
              <div className="text-right"><p className="text-sm text-slate-600 dark:text-slate-400">Incremental %</p><p className="font-semibold text-blue-600 dark:text-blue-400">{incrementalPercent}%</p></div>
            </div>
          </div>;
        })}
        {!activePromos.length && <p className="text-center py-8 text-slate-500">No active campaigns</p>}
      </div>
    </SectionCard>

    {form && <PromoForm promo={form === 'new' ? undefined : form} onCancel={() => setForm(null)} onSave={savePromo} saving={busy} />}
  </div>;
}

const fieldClass = "w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white";
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm font-medium text-slate-700 dark:text-slate-300"><span className="block mb-1">{label}</span>{children}</label>; }
function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) { return <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"><div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto"><div className="p-5 border-b flex justify-between items-center"><h3 className="font-semibold text-lg text-slate-900 dark:text-white">{title}</h3><button onClick={onClose} className="text-slate-500"><X className="w-5 h-5"/></button></div><div className="p-5">{children}</div>{footer && <div className="p-5 border-t flex justify-end gap-3">{footer}</div>}</div></div>; }

function PromoForm({ promo, onCancel, onSave, saving }: { promo?: Promo; onCancel: () => void; onSave: (f: any, editing?: Promo) => void; saving: boolean }) {
  const [f, setF] = useState({
    name: promo?.name || '', code: promo?.code || '', promo_type: promo?.promo_type || 'discount', discount: promo?.discount || 0,
    status: promo?.status || 'active' as PromoStatus, start_date: promo?.start_date || '', end_date: promo?.end_date || '',
    target_segment: promo?.target_segment || 'all',
  });
  const set = (k: string, v: any) => setF(p => ({ ...p, [k]: v }));
  return <Modal title={promo ? 'Edit Promotion' : 'New Promotion'} onClose={onCancel} footer={<><button className={button.secondary} onClick={onCancel}>Cancel</button><button className={button.primary} disabled={saving || !f.name || !f.code} onClick={() => onSave(f, promo)}>{saving && <Loader2 className="w-4 h-4 animate-spin"/>}Save</button></>}>
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4"><Field label="Name"><input className={fieldClass} value={f.name} onChange={e=>set('name',e.target.value)}/></Field><Field label="Code"><input className={fieldClass} value={f.code} onChange={e=>set('code',e.target.value)}/></Field></div>
      <div className="grid grid-cols-3 gap-4"><Field label="Type"><select className={fieldClass} value={f.promo_type} onChange={e=>set('promo_type',e.target.value)}><option value="discount">Discount</option><option value="flash">Flash Sale</option><option value="loyalty">Loyalty</option><option value="group">Group</option></select></Field><Field label="Discount %"><input type="number" className={fieldClass} value={f.discount} onChange={e=>set('discount',Number(e.target.value))}/></Field><Field label="Status"><select className={fieldClass} value={f.status} onChange={e=>set('status',e.target.value as PromoStatus)}><option value="active">Active</option><option value="scheduled">Scheduled</option><option value="ended">Ended</option></select></Field></div>
      <div className="grid grid-cols-3 gap-4"><Field label="Start Date"><input type="date" className={fieldClass} value={f.start_date} onChange={e=>set('start_date',e.target.value)}/></Field><Field label="End Date"><input type="date" className={fieldClass} value={f.end_date} onChange={e=>set('end_date',e.target.value)}/></Field><Field label="Target Segment"><select className={fieldClass} value={f.target_segment} onChange={e=>set('target_segment',e.target.value)}><option value="all">All</option><option value="leisure">Leisure</option><option value="corporate">Corporate</option><option value="loyalty">Loyalty</option><option value="group">Group</option></select></Field></div>
    </div>
  </Modal>;
}
