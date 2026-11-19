import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bed, Calendar, Edit, Loader2, Lock, Plus, ServerCrash, Trash2, Unlock, Users, X } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { Badge, PageHeader, SectionCard } from '../FrontOffice/ui';
import { button } from '../FrontOffice/brandTheme';
import { rmsGet, rmsRequest } from '../../services/rmsService';

const API = '/api/rms-portal/inventory-controls';


type RoomType = { id: string; name: string; total_rooms: number; available: number; sold: number; stop_sell: boolean };
type SellLimit = { id: string; room_type: string; channel: string; limit_amount: number; used: number; active: boolean };
type Allotment = { id: string; operator: string; room_type: string; total: number; released: number; expiry: string; active: boolean };
type StopSell = { id: string; room_type: string; start_date: string; end_date: string; reason: string; active: boolean };

type EditState = { type: 'limit' | 'allotment' | 'stop_sell'; data: any } | undefined;

export default function InventoryControls() {
  const { currentPropertyId } = useERP();
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [sellLimits, setSellLimits] = useState<SellLimit[]>([]);
  const [allotments, setAllotments] = useState<Allotment[]>([]);
  const [stopSellDates, setStopSellDates] = useState<StopSell[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedRoomType, setSelectedRoomType] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState>(undefined);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const json = await rmsGet(API, { propertyId: currentPropertyId });
      setRoomTypes(json.roomTypes || []); setSellLimits(json.sellLimits || []); setAllotments(json.allotments || []); setStopSellDates(json.stopSellDates || []);
    } catch (e: any) { setError(e.message || 'Failed to load inventory controls'); }
    finally { setLoading(false); }
  }, [currentPropertyId]);
  useEffect(() => { load(); }, [load]);

  const request = (url: string, method: string, body?: unknown) =>
    rmsRequest(url, { method, body, propertyId: currentPropertyId });

  const toggleStopSellRoom = async (room: RoomType) => {
    setBusy(true); setError(null);
    try { await request(`${API}/rooms/${room.id}`, 'PUT', { stop_sell: !room.stop_sell }); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const save = async (payload: any) => {
    if (!edit) return; setBusy(true); setError(null);
    try {
      const id = edit.data?.id;
      const segments: Record<string, string> = { limit: 'sell-limits', allotment: 'allotments', stop_sell: 'stop-sell' };
      await request(id ? `${API}/${segments[edit.type]}/${id}` : `${API}/${segments[edit.type]}`, id ? 'PUT' : 'POST', payload);
      setEdit(undefined); await load();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const remove = async (type: 'limit' | 'allotment' | 'stop_sell', id: string) => {
    if (!confirm('Delete this record?')) return;
    setBusy(true); setError(null);
    try { const segments: Record<string, string> = { limit: 'sell-limits', allotment: 'allotments', stop_sell: 'stop-sell' }; await request(`${API}/${segments[type]}/${id}`, 'DELETE'); await load(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  const totalRooms = useMemo(() => roomTypes.reduce((s, r) => s + Number(r.total_rooms), 0), [roomTypes]);
  const stopSellCount = useMemo(() => roomTypes.filter(r => r.stop_sell).length, [roomTypes]);
  const activeAllotments = useMemo(() => allotments.filter(a => a.active).length, [allotments]);
  const totalRemaining = useMemo(() => sellLimits.reduce((s, l) => s + (l.limit_amount - l.used), 0), [sellLimits]);

  if (loading && !roomTypes.length) return <div className="p-6 flex justify-center py-20 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2"/>Loading inventory…</div>;
  if (error && !roomTypes.length) return <div className="p-6 flex flex-col items-center py-20 text-rose-600"><ServerCrash className="w-10 h-10 mb-3"/><p>{error}</p><button onClick={load} className="mt-4 text-blue-600">Retry</button></div>;

  return <div className="p-6 space-y-6">
    <PageHeader title="Inventory Controls" subtitle="Manage room inventory, sell limits, allotments and stop sell" />
    {error && <div className="px-4 py-2 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-600">{error}</div>}
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <StatCard title="Total Rooms" value={totalRooms} icon={Bed} tone="info" />
      <StatCard title="Stop Sell" value={stopSellCount} icon={Lock} tone="warning" />
      <StatCard title="Allotments" value={activeAllotments} icon={Users} tone="success" />
      <StatCard title="Remaining Limit" value={totalRemaining} icon={Calendar} tone="accent" />
    </div>

    <SectionCard title="Room Inventory" icon={Bed} pad="md">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {roomTypes.map(room => { const pct = Math.round((room.sold / room.total_rooms) * 100); return <div key={room.id} onClick={() => setSelectedRoomType(room.id)} className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${selectedRoomType === room.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'}`}>
          <div className="flex justify-between mb-3"><div className="flex items-center gap-2"><Bed className="w-5 h-5 text-slate-600 dark:text-slate-400"/><h4 className="font-semibold text-slate-900 dark:text-white">{room.name}</h4></div>{room.stop_sell ? <Lock className="w-5 h-5 text-red-500"/> : <Unlock className="w-5 h-5 text-green-500"/>}</div>
          <div className="space-y-2"><div className="flex justify-between text-sm"><span className="text-slate-600 dark:text-slate-400">Occupancy</span><span className="font-medium text-slate-900 dark:text-white">{pct}%</span></div><div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden"><div className="h-full bg-blue-600 rounded-full" style={{ width: `${pct}%` }}/></div><div className="flex justify-between text-xs text-slate-600 dark:text-slate-400"><span>Available: {room.available}</span><span>Sold: {room.sold}</span></div></div>
          {room.stop_sell && <div className="mt-3 p-2 bg-red-50 dark:bg-red-900/20 rounded-lg"><p className="text-xs text-red-600 dark:text-red-400 font-medium">Stop Sell Active</p></div>}
          <div className="mt-3 flex justify-end"><Toggle label="Stop sell" checked={room.stop_sell} onChange={() => toggleStopSellRoom(room)} disabled={busy}/></div>
        </div>; })}
      </div>
    </SectionCard>

    <SectionCard title="Sell Limits" icon={Calendar} pad="md" actions={<button className={button.primary} onClick={() => setEdit({ type: 'limit', data: null })} disabled={busy}><Plus className="w-4 h-4"/>Add Limit</button>}>
      <div className="space-y-3">
        {sellLimits.map(l => { const pct = Math.round((l.used / l.limit_amount) * 100); return <div key={l.id} className="flex justify-between p-4 rounded-lg border bg-slate-50 dark:bg-slate-700/50">
          <div><div className="flex items-center gap-2 mb-1"><h4 className="font-medium text-slate-900 dark:text-white">{l.room_type}</h4><Badge tone="info">{l.channel}</Badge></div><div className="flex gap-4 text-sm text-slate-600 dark:text-slate-400"><span>Limit: {l.limit_amount}</span><span>Used: {l.used}</span><span className="font-medium text-slate-900 dark:text-white">Remaining: {l.limit_amount - l.used}</span></div></div>
          <div className="flex items-center gap-3"><div className="text-right"><div className="h-2 w-24 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden"><div className={`h-full rounded-full ${pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${pct}%` }}/></div><p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{pct}% used</p></div><IconButton title="Edit" onClick={() => setEdit({ type: 'limit', data: l })}><Edit className="w-4 h-4 text-slate-500"/></IconButton><IconButton title="Delete" onClick={() => remove('limit', l.id)} disabled={busy}><Trash2 className="w-4 h-4 text-red-600"/></IconButton></div>
        </div>; })}
        {!sellLimits.length && <p className="text-center py-8 text-slate-500">No sell limits</p>}
      </div>
    </SectionCard>

    <SectionCard title="Allotments" icon={Users} pad="md" actions={<button className={button.primary} onClick={() => setEdit({ type: 'allotment', data: null })} disabled={busy}><Plus className="w-4 h-4"/>Add Allotment</button>}>
      <div className="space-y-3">
        {allotments.map(a => { const pct = Math.round((a.released / a.total) * 100); return <div key={a.id} className="flex justify-between p-4 rounded-lg border bg-slate-50 dark:bg-slate-700/50">
          <div><div className="flex items-center gap-2 mb-1"><Users className="w-4 h-4 text-slate-600 dark:text-slate-400"/><h4 className="font-medium text-slate-900 dark:text-white">{a.operator}</h4><Badge tone={a.active ? 'success' : 'neutral'}>{a.active ? 'Active' : 'Inactive'}</Badge></div><div className="flex gap-4 text-sm text-slate-600 dark:text-slate-400"><span>{a.room_type}</span><span>Total: {a.total}</span><span>Released: {a.released}</span><span className="font-medium text-slate-900 dark:text-white">Remaining: {a.total - a.released}</span></div></div>
          <div className="flex items-center gap-3"><div className="text-right"><p className="text-xs text-slate-600 dark:text-slate-400">Expires: {a.expiry}</p><div className="h-2 w-24 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden mt-1"><div className="h-full bg-blue-600 rounded-full" style={{ width: `${pct}%` }}/></div></div><IconButton title="Edit" onClick={() => setEdit({ type: 'allotment', data: a })}><Edit className="w-4 h-4 text-slate-500"/></IconButton><IconButton title="Delete" onClick={() => remove('allotment', a.id)} disabled={busy}><Trash2 className="w-4 h-4 text-red-600"/></IconButton></div>
        </div>; })}
        {!allotments.length && <p className="text-center py-8 text-slate-500">No allotments</p>}
      </div>
    </SectionCard>

    <SectionCard title="Stop Sell Dates" icon={AlertTriangle} pad="md" actions={<button className={button.primary} onClick={() => setEdit({ type: 'stop_sell', data: null })} disabled={busy}><Plus className="w-4 h-4"/>Add Stop Sell</button>}>
      <div className="space-y-3">
        {stopSellDates.map(d => <div key={d.id} className="flex justify-between p-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
          <div className="flex items-center gap-3"><Lock className="w-5 h-5 text-red-500"/><div><h4 className="font-medium text-slate-900 dark:text-white">{d.room_type}</h4><p className="text-sm text-slate-600 dark:text-slate-400">{d.start_date} → {d.end_date}</p><p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{d.reason}</p></div></div>
          <div className="flex items-center gap-2"><Toggle label="Active" checked={d.active} onChange={v => request(`${API}/stop-sell/${d.id}`, 'PUT', { active: v }).then(load).catch((e: any) => setError(e.message))} disabled={busy}/><IconButton title="Delete" onClick={() => remove('stop_sell', d.id)} disabled={busy}><Trash2 className="w-4 h-4 text-red-600"/></IconButton></div>
        </div>)}
        {!stopSellDates.length && <p className="text-center py-8 text-slate-500">No stop sell dates</p>}
      </div>
    </SectionCard>

    {edit && <FormModal edit={edit} busy={busy} onCancel={() => setEdit(undefined)} onSave={save} />}
  </div>;
}

function IconButton({ title, onClick, disabled, children }: { title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) { return <button title={title} onClick={onClick} disabled={disabled} className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-400 disabled:opacity-50">{children}</button>; }
const fieldClass = "w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white";
function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) { return <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"><div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto"><div className="p-5 border-b flex justify-between items-center"><h3 className="font-semibold text-lg text-slate-900 dark:text-white">{title}</h3><button onClick={onClose}><X className="w-5 h-5 text-slate-500"/></button></div><div className="p-5">{children}</div>{footer && <div className="p-5 border-t flex justify-end gap-3">{footer}</div>}</div></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm font-medium text-slate-700 dark:text-slate-300"><span className="block mb-1">{label}</span>{children}</label>; }
function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) { return <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400"><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} disabled={disabled} className="rounded"/>{label}</label>; }

function FormModal({ edit, busy, onCancel, onSave }: { edit: EditState; busy: boolean; onCancel: () => void; onSave: (v: any) => void }) {
  const [f, setF] = useState<any>(() => {
    const d = edit?.data ?? {};
    if (edit?.type === 'limit') return { room_type: d.room_type || '', channel: d.channel || '', limit_amount: d.limit_amount ?? 0, used: d.used ?? 0, active: d.active ?? true };
    if (edit?.type === 'allotment') return { operator: d.operator || '', room_type: d.room_type || '', total: d.total ?? 0, released: d.released ?? 0, expiry: d.expiry || '', active: d.active ?? true };
    return { room_type: d.room_type || '', start_date: d.start_date || '', end_date: d.end_date || '', reason: d.reason || '', active: d.active ?? true };
  });
  const set = (k: string, v: any) => setF((p:any)=>({...p,[k]:v}));
  const titles: Record<string,string> = { limit: 'Sell Limit', allotment: 'Allotment', stop_sell: 'Stop Sell' };
  return <Modal title={`${edit?.data?.id ? 'Edit' : 'Add'} ${titles[edit!.type]}`} onClose={onCancel} footer={<><button className={button.secondary} onClick={onCancel}>Cancel</button><button className={button.primary} disabled={busy} onClick={() => onSave(f)}>{busy && <Loader2 className="w-4 h-4 animate-spin"/>}Save</button></>}>
    <div className="space-y-4">
      {edit?.type === 'limit' && <>
        <Field label="Room Type"><input className={fieldClass} value={f.room_type} onChange={e=>set('room_type',e.target.value)}/></Field>
        <Field label="Channel"><input className={fieldClass} value={f.channel} onChange={e=>set('channel',e.target.value)}/></Field>
        <div className="grid grid-cols-2 gap-4"><Field label="Limit"><input type="number" className={fieldClass} value={f.limit_amount} onChange={e=>set('limit_amount',Number(e.target.value))}/></Field><Field label="Used"><input type="number" className={fieldClass} value={f.used} onChange={e=>set('used',Number(e.target.value))}/></Field></div>
      </>}
      {edit?.type === 'allotment' && <>
        <Field label="Operator"><input className={fieldClass} value={f.operator} onChange={e=>set('operator',e.target.value)}/></Field>
        <Field label="Room Type"><input className={fieldClass} value={f.room_type} onChange={e=>set('room_type',e.target.value)}/></Field>
        <div className="grid grid-cols-2 gap-4"><Field label="Total"><input type="number" className={fieldClass} value={f.total} onChange={e=>set('total',Number(e.target.value))}/></Field><Field label="Released"><input type="number" className={fieldClass} value={f.released} onChange={e=>set('released',Number(e.target.value))}/></Field></div>
        <Field label="Expiry"><input type="date" className={fieldClass} value={f.expiry} onChange={e=>set('expiry',e.target.value)}/></Field>
      </>}
      {edit?.type === 'stop_sell' && <>
        <Field label="Room Type"><input className={fieldClass} value={f.room_type} onChange={e=>set('room_type',e.target.value)}/></Field>
        <div className="grid grid-cols-2 gap-4"><Field label="Start"><input type="date" className={fieldClass} value={f.start_date} onChange={e=>set('start_date',e.target.value)}/></Field><Field label="End"><input type="date" className={fieldClass} value={f.end_date} onChange={e=>set('end_date',e.target.value)}/></Field></div>
        <Field label="Reason"><input className={fieldClass} value={f.reason} onChange={e=>set('reason',e.target.value)}/></Field>
      </>}
      <Toggle label="Active" checked={f.active} onChange={v => set('active', v)} disabled={busy}/>
    </div>
  </Modal>;
}
