import { useCallback, useEffect, useMemo, useState } from 'react';
import { useERP } from '../../context/ERPContext';
import { Calendar, CheckCircle2, DollarSign, Loader2, Package, Plus, ServerCrash, Settings, Star, Trash2, TrendingUp, Users, X, XCircle } from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard } from '../FrontOffice/ui';
import { button } from '../FrontOffice/brandTheme';
import { rmsGet, rmsRequest } from '../../services/rmsService';

const API = '/api/rms-portal/package-pricing';


type PackageType = 'room' | 'dining' | 'spa' | 'conference' | 'wedding' | 'seasonal';
type Pkg = { id: string; name: string; package_type: PackageType; room_type: string; base_rate: number; package_rate: number; includes: string[]; validity: string; active: boolean; bookings: number; revenue: number };

const packageTypes: { id: PackageType; name: string; icon: React.ElementType }[] = [
  { id: 'room', name: 'Room Packages', icon: Package },
  { id: 'dining', name: 'Dining Packages', icon: Star },
  { id: 'spa', name: 'Spa Packages', icon: Settings },
  { id: 'conference', name: 'Conference Packages', icon: Users },
  { id: 'wedding', name: 'Wedding Packages', icon: Star },
  { id: 'seasonal', name: 'Seasonal Packages', icon: Calendar },
];

export default function PackagePricing() {
  const { currentPropertyId } = useERP();
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
  const [packageType, setPackageType] = useState<PackageType>('room');
  const [form, setForm] = useState<Pkg | 'new' | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const json = await rmsGet(API, { propertyId: currentPropertyId });
      setPackages(json.packages || []);
    } catch (e: any) { setError(e.message || 'Failed to load packages'); }
    finally { setLoading(false); }
  }, [currentPropertyId]);
  useEffect(() => { load(); }, [load]);

  const request = (url: string, method: string, body?: unknown) =>
    rmsRequest(url, { method, body, propertyId: currentPropertyId });
  const savePackage = async (f: any, editing?: Pkg) => {
    setBusy(true); setError(null);
    try { await request(editing ? `${API}/${editing.id}` : API, editing ? 'PUT' : 'POST', { ...f, propertyId: currentPropertyId }); setForm(null); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const togglePackage = async (p: Pkg) => {
    setBusy(true); setError(null);
    try { await request(`${API}/${p.id}`, 'PUT', { active: !p.active, propertyId: currentPropertyId }); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const deletePackage = async (id: string) => {
    if (!confirm('Delete this package?')) return;
    setBusy(true); setError(null);
    try { await request(`${API}/${id}`, 'DELETE', { propertyId: currentPropertyId }); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  const filtered = useMemo(() => packages.filter(p => p.package_type === packageType), [packages, packageType]);
  const metrics = useMemo(() => {
    const totalRevenue = packages.reduce((s, p) => s + Number(p.revenue || 0), 0);
    const totalBookings = packages.reduce((s, p) => s + Number(p.bookings || 0), 0);
    const avgUpsell = packages.length ? Math.round(packages.reduce((s, p) => s + (Number(p.package_rate) - Number(p.base_rate)), 0) / packages.length) : 0;
    const activePackages = packages.filter(p => p.active).length;
    return { totalRevenue, totalBookings, avgUpsell, activePackages };
  }, [packages]);
  const topPackages = useMemo(() => [...packages].sort((a, b) => Number(b.revenue) - Number(a.revenue)).slice(0, 5), [packages]);

  if (loading && !packages.length) return <div className="p-6 flex justify-center py-20 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2"/>Loading packages…</div>;
  if (error && !packages.length) return <div className="p-6 flex flex-col items-center py-20 text-rose-600"><ServerCrash className="w-10 h-10 mb-3"/><p>{error}</p><button onClick={load} className="mt-4 text-blue-600">Retry</button></div>;

  return <div className="p-6 space-y-6">
    <PageHeader title="Package Pricing" subtitle="Manage room, dining, spa, and event packages" actions={<button className={button.primary} onClick={() => setForm('new')} disabled={busy}><Plus className="w-4 h-4"/>New Package</button>} />
    {error && <div className="px-4 py-2 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-600">{error}</div>}
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <StatCard title="Total Revenue" value={`$${metrics.totalRevenue.toLocaleString()}`} icon={DollarSign} tone="success" />
      <StatCard title="Total Bookings" value={metrics.totalBookings} icon={Users} tone="info" />
      <StatCard title="Avg Upsell" value={`$${metrics.avgUpsell}`} icon={TrendingUp} tone="accent" />
      <StatCard title="Active Packages" value={metrics.activePackages} icon={Package} tone="warning" />
    </div>

    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4">
      <div className="flex gap-2 overflow-x-auto">
        {packageTypes.map(t => { const Icon = t.icon; return <button key={t.id} onClick={() => setPackageType(t.id)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${packageType === t.id ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}><Icon className="w-4 h-4"/>{t.name}</button>; })}
      </div>
    </div>

    <SectionCard title={packageTypes.find(t => t.id === packageType)?.name || 'Packages'} icon={Package} pad="md">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(pkg => {
          const upsell = Number(pkg.package_rate) - Number(pkg.base_rate);
          const upsellPercent = Number(pkg.base_rate) > 0 ? Math.round((upsell / Number(pkg.base_rate)) * 100) : 0;
          return <div key={pkg.id} onClick={() => setSelectedPackage(pkg.id)} className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${selectedPackage === pkg.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'}`}>
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1"><div className="flex items-center gap-2 mb-1"><h4 className="font-semibold text-slate-900 dark:text-white">{pkg.name}</h4>{pkg.active ? <CheckCircle2 className="w-4 h-4 text-green-500"/> : <XCircle className="w-4 h-4 text-slate-400"/>}</div><p className="text-sm text-slate-600 dark:text-slate-400">{pkg.room_type}</p></div>
            </div>
            <div className="space-y-2 mb-3">
              <div className="flex justify-between text-sm"><span className="text-slate-600 dark:text-slate-400">Base Rate</span><span className="font-medium text-slate-900 dark:text-white">${pkg.base_rate}</span></div>
              <div className="flex justify-between text-sm"><span className="text-slate-600 dark:text-slate-400">Package Rate</span><span className="font-medium text-green-600 dark:text-green-400">${pkg.package_rate}</span></div>
              <div className="flex justify-between text-sm"><span className="text-slate-600 dark:text-slate-400">Upsell</span><span className={`font-medium ${upsell > 0 ? 'text-green-600 dark:text-green-400' : 'text-slate-600 dark:text-slate-400'}`}>{upsell >= 0 ? '+' : ''}${upsell} ({upsellPercent}%)</span></div>
            </div>
            <div className="mb-3"><p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Includes:</p><div className="flex flex-wrap gap-1">{(pkg.includes || []).slice(0, 3).map((item, i) => <span key={i} className="text-xs text-slate-700 dark:text-slate-300">• {item}</span>)}{(pkg.includes || []).length > 3 && <span className="text-xs text-slate-500 dark:text-slate-400">+{pkg.includes.length - 3} more</span>}</div></div>
            <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-700">
              <div className="text-xs text-slate-600 dark:text-slate-400">{pkg.validity}</div>
              <div className="flex items-center gap-1">
                <button onClick={e => { e.stopPropagation(); setForm(pkg); }} disabled={busy} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors"><Calendar className="w-4 h-4 text-slate-600 dark:text-slate-400"/></button>
                <button onClick={e => { e.stopPropagation(); togglePackage(pkg); }} disabled={busy} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors">{pkg.active ? <XCircle className="w-4 h-4 text-slate-600"/> : <CheckCircle2 className="w-4 h-4 text-green-600"/>}</button>
                <button onClick={e => { e.stopPropagation(); deletePackage(pkg.id); }} disabled={busy} className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"><Trash2 className="w-4 h-4 text-red-600"/></button>
              </div>
            </div>
          </div>;
        })}
        {!filtered.length && <p className="col-span-full text-center py-8 text-slate-500">No {packageTypes.find(t => t.id === packageType)?.name.toLowerCase()}</p>}
      </div>
    </SectionCard>

    <SectionCard title="Top Performing Packages" icon={TrendingUp} pad="md">
      <div className="space-y-3">
        {topPackages.map((pkg, i) => <div key={pkg.id} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
          <div className="flex items-center gap-4"><span className="w-8 h-8 flex items-center justify-center bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full text-sm font-bold">{i + 1}</span><div><h4 className="font-medium text-slate-900 dark:text-white">{pkg.name}</h4><p className="text-sm text-slate-600 dark:text-slate-400">{pkg.package_type} • {pkg.bookings} bookings</p></div></div>
          <p className="font-semibold text-green-600 dark:text-green-400">${Number(pkg.revenue).toLocaleString()}</p>
        </div>)}
        {!topPackages.length && <p className="text-center py-8 text-slate-500">No packages yet</p>}
      </div>
    </SectionCard>

    {form && <PackageForm pkg={form === 'new' ? undefined : form} onCancel={() => setForm(null)} onSave={savePackage} saving={busy} />}
  </div>;
}

const fieldClass = "w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white";
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm font-medium text-slate-700 dark:text-slate-300"><span className="block mb-1">{label}</span>{children}</label>; }
function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) { return <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"><div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto"><div className="p-5 border-b flex justify-between items-center"><h3 className="font-semibold text-lg text-slate-900 dark:text-white">{title}</h3><button onClick={onClose} className="text-slate-500"><X className="w-5 h-5"/></button></div><div className="p-5">{children}</div>{footer && <div className="p-5 border-t flex justify-end gap-3">{footer}</div>}</div></div>; }

function PackageForm({ pkg, onCancel, onSave, saving }: { pkg?: Pkg; onCancel: () => void; onSave: (f: any, editing?: Pkg) => void; saving: boolean }) {
  const [f, setF] = useState({
    name: pkg?.name || '', package_type: pkg?.package_type || 'room' as PackageType, room_type: pkg?.room_type || '',
    base_rate: pkg?.base_rate || 0, package_rate: pkg?.package_rate || 0,
    includes: (pkg?.includes || []).join(', '), validity: pkg?.validity || 'All year', active: pkg?.active ?? true,
  });
  const set = (k: string, v: any) => setF(p => ({ ...p, [k]: v }));
  const save = () => onSave({ ...f, includes: f.includes.split(',').map(s => s.trim()).filter(Boolean) }, pkg);
  return <Modal title={pkg ? 'Edit Package' : 'New Package'} onClose={onCancel} footer={<><button className={button.secondary} onClick={onCancel}>Cancel</button><button className={button.primary} disabled={saving || !f.name} onClick={save}>{saving && <Loader2 className="w-4 h-4 animate-spin"/>}Save</button></>}>
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4"><Field label="Name"><input className={fieldClass} value={f.name} onChange={e=>set('name',e.target.value)}/></Field><Field label="Type"><select className={fieldClass} value={f.package_type} onChange={e=>set('package_type',e.target.value as PackageType)}>{packageTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field></div>
      <div className="grid grid-cols-2 gap-4"><Field label="Room Type"><input className={fieldClass} value={f.room_type} onChange={e=>set('room_type',e.target.value)} placeholder="All Room Types"/></Field><Field label="Validity"><input className={fieldClass} value={f.validity} onChange={e=>set('validity',e.target.value)}/></Field></div>
      <div className="grid grid-cols-2 gap-4"><Field label="Base Rate"><input type="number" className={fieldClass} value={f.base_rate} onChange={e=>set('base_rate',Number(e.target.value))}/></Field><Field label="Package Rate"><input type="number" className={fieldClass} value={f.package_rate} onChange={e=>set('package_rate',Number(e.target.value))}/></Field></div>
      <Field label="Includes (comma separated)"><input className={fieldClass} value={f.includes} onChange={e=>set('includes',e.target.value)} placeholder="Breakfast, Late checkout, …"/></Field>
      <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400"><input type="checkbox" checked={f.active} onChange={e=>set('active',e.target.checked)} className="rounded"/>Active</label>
    </div>
  </Modal>;
}
