import { useCallback, useEffect, useMemo, useState } from 'react';
import { useERP } from '../../context/ERPContext';
import { Activity, Building2, CheckCircle2, Clock, Edit, Globe, Link, Loader2, Plus, RefreshCw, Search, ServerCrash, Trash2, X, XCircle } from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { Badge, PageHeader, SectionCard } from '../FrontOffice/ui';
import { button, type StatusTone } from '../FrontOffice/brandTheme';
import { rmsGet, rmsRequest } from '../../services/rmsService';

const API = '/api/rms-portal/channels';


type Channel = {
  id: string; channel_name: string; channel_code: string; channel_type: string; api_endpoint: string; api_version: string | null;
  sync_interval_minutes: number; last_sync_at: string | null; last_sync_status: string; last_sync_error: string | null;
  rate_parity_enabled: boolean; rate_parity_threshold: number; inventory_sync_enabled: boolean; booking_sync_enabled: boolean;
  active: boolean; test_mode: boolean; has_credentials?: boolean; room_mappings: Mapping[];
};
type Mapping = { id: string; our_room_type_id: string; channel_room_code: string; channel_room_name: string | null; quality_score: number; rate_multiplier: number; inventory_multiplier: number; active: boolean; sync_enabled: boolean };
type RoomType = { id: string; name: string };
type SyncLog = { id: string; channel_id: string; sync_type: string; sync_start: string; sync_end: string | null; records_processed: number; records_successful: number; records_failed: number; status: string; error_summary: unknown };

const statusTone: Record<string, StatusTone> = { success: 'success', failed: 'danger', never: 'neutral', running: 'warning', simulated: 'warning', partial: 'warning' };
const typeTone: Record<string, StatusTone> = { ota: 'info', gds: 'accent', bedbank: 'success', metasearch: 'warning' };

export default function ChannelManager() {
  const { currentPropertyId } = useERP();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [history, setHistory] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [channelForm, setChannelForm] = useState<Channel | null | undefined>(undefined);
  const [mappingChannel, setMappingChannel] = useState<Channel | null>(null);
  const [mappingForm, setMappingForm] = useState<Mapping | null | undefined>(undefined);
  const [showHistory, setShowHistory] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const json = await rmsGet(API, { propertyId: currentPropertyId });
      setChannels(json.channels || []); setRoomTypes(json.roomTypes || []); setHistory(json.syncHistory || []);
      if (mappingChannel) setMappingChannel((json.channels || []).find((c: Channel) => c.id === mappingChannel.id) || null);
    } catch (e: any) { setError(e.message || 'Failed to load channels'); }
    finally { setLoading(false); }
  }, [mappingChannel?.id, currentPropertyId]);
  useEffect(() => { load(); }, [load]);

  const request = (url: string, method: string, body?: unknown) =>
    rmsRequest(url, { method, body, propertyId: currentPropertyId });
  const run = async (id: string, action: () => Promise<void>) => {
    setBusy(prev => new Set(prev).add(id)); setError(null); setNotice(null);
    try { await action(); await load(); } catch (e: any) { setError(e.message || 'Action failed'); }
    finally { setBusy(prev => { const n = new Set(prev); n.delete(id); return n; }); }
  };
  const saveChannel = async (form: any) => {
    const editing = channelForm?.id;
    await run(editing || 'new', async () => { await request(editing ? `${API}/${editing}` : API, editing ? 'PUT' : 'POST', { ...form, propertyId: currentPropertyId }); setChannelForm(undefined); });
  };
  const removeChannel = (c: Channel) => { if (confirm(`Delete ${c.channel_name} and its mappings?`)) run(c.id, () => request(`${API}/${c.id}`, 'DELETE', { propertyId: currentPropertyId })); };
  const patchChannel = (c: Channel, patch: Partial<Channel>) => run(c.id, () => request(`${API}/${c.id}`, 'PUT', { ...patch, propertyId: currentPropertyId }));
  const sync = (c: Channel) => run(c.id, async () => {
    const result = await request(`${API}/${c.id}/sync`, 'POST', { propertyId: currentPropertyId });
    setNotice(result.simulated
      ? `${c.channel_name}: simulated sync — no live endpoint contacted (test mode or missing credentials)`
      : result.status === 'partial'
        ? `${c.channel_name}: partial sync — ${result.failed} record(s) failed`
        : null);
  });
  const test = (c: Channel) => run(c.id, async () => {
    const result = await request(`${API}/${c.id}/test`, 'POST', { propertyId: currentPropertyId });
    setNotice(result.success ? `${c.channel_name}: connection OK` : `${c.channel_name}: ${result.error || 'connection failed'}`);
  });
  const saveMapping = async (form: any) => {
    if (!mappingChannel) return;
    const id = mappingForm?.id;
    await run(id || 'mapping', async () => { await request(id ? `${API}/${mappingChannel.id}/mappings/${id}` : `${API}/${mappingChannel.id}/mappings`, id ? 'PUT' : 'POST', { ...form, propertyId: currentPropertyId }); setMappingForm(undefined); });
  };
  const removeMapping = (m: Mapping) => mappingChannel && confirm('Delete this room mapping?') && run(m.id, () => request(`${API}/${mappingChannel.id}/mappings/${m.id}`, 'DELETE', { propertyId: currentPropertyId }));

  const filtered = useMemo(() => channels.filter(c => `${c.channel_name} ${c.channel_code}`.toLowerCase().includes(search.toLowerCase())), [channels, search]);
  const stats = useMemo(() => ({ active: channels.filter(c => c.active).length, mappings: channels.reduce((n, c) => n + c.room_mappings.length, 0), failed: channels.filter(c => c.last_sync_status === 'failed').length }), [channels]);

  if (loading && !channels.length) return <div className="p-6 flex justify-center py-20 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2" />Loading channels…</div>;
  if (error && !channels.length) return <div className="p-6 flex flex-col items-center py-20 text-rose-600"><ServerCrash className="w-10 h-10 mb-3"/><p>{error}</p><button onClick={load} className="mt-4 text-blue-600">Retry</button></div>;

  return <div className="p-6 space-y-6">
    <PageHeader title="Channel Manager" subtitle="Manage OTA, GDS and distribution channel synchronization" actions={<><button className={button.secondary} onClick={() => setShowHistory(true)}><Activity className="w-4 h-4"/>Sync Status</button><button className={button.primary} onClick={() => setChannelForm(null)}><Plus className="w-4 h-4"/>Add Channel</button></>} />
    {error && <div className="px-4 py-2 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-600">{error}</div>}
    {notice && <div className="px-4 py-2 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-700">{notice}</div>}
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <StatCard title="Channels" value={channels.length} icon={Globe} tone="info" />
      <StatCard title="Active" value={stats.active} icon={CheckCircle2} tone="success" />
      <StatCard title="Room Mappings" value={stats.mappings} icon={Link} tone="accent" />
      <StatCard title="Failed Syncs" value={stats.failed} icon={XCircle} tone="danger" />
    </div>
    <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400"/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search channels…" className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"/></div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{filtered.map(c => <SectionCard key={c.id} pad="md">
      <div className="flex items-start justify-between mb-4"><div className="flex gap-3"><div className="w-11 h-11 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center"><Globe className="w-6 h-6 text-slate-500"/></div><div><div className="flex gap-2 items-center"><h3 className="font-semibold text-slate-900 dark:text-white">{c.channel_name}</h3>{c.test_mode && <Badge tone="warning">Test</Badge>}{!c.test_mode && !c.has_credentials && <Badge tone="danger">No credentials</Badge>}</div><p className="text-sm text-slate-500">{c.channel_code}</p></div></div><div className="flex gap-1"><IconButton title="Test connection" onClick={() => test(c)}><CheckCircle2 className="w-5 h-5"/></IconButton><IconButton title="Sync" onClick={() => sync(c)}><RefreshCw className={`w-5 h-5 ${busy.has(c.id) ? 'animate-spin' : ''}`}/></IconButton><IconButton title="Mappings" onClick={() => setMappingChannel(c)}><Link className="w-5 h-5"/></IconButton><IconButton title="Edit" onClick={() => setChannelForm(c)}><Edit className="w-5 h-5 text-blue-600"/></IconButton><IconButton title="Delete" onClick={() => removeChannel(c)}><Trash2 className="w-5 h-5 text-red-600"/></IconButton></div></div>
      <div className="flex justify-between items-center mb-3"><Badge tone={typeTone[c.channel_type] || 'neutral'}>{c.channel_type.toUpperCase()}</Badge><div className="flex items-center gap-2"><Badge tone={statusTone[c.last_sync_status] || 'neutral'}>{c.last_sync_status}</Badge><span className="text-xs text-slate-500">{c.last_sync_at ? new Date(c.last_sync_at).toLocaleString() : 'Never synced'}</span></div></div>
      {c.last_sync_error && <div className="mb-3 p-2 rounded bg-red-50 text-sm text-red-700 flex gap-2"><XCircle className="w-4 h-4 mt-0.5"/>{c.last_sync_error}</div>}
      <div className="grid grid-cols-3 text-sm text-slate-600 dark:text-slate-400 mb-4"><span><Clock className="inline w-4 h-4 mr-1"/>{c.sync_interval_minutes}m</span><span><Building2 className="inline w-4 h-4 mr-1"/>{c.room_mappings.length} rooms</span><span>Parity {c.rate_parity_enabled ? 'On' : 'Off'}</span></div>
      <div className="pt-4 border-t border-slate-200 dark:border-slate-700 flex flex-wrap gap-4 items-center"><Toggle label="Inventory" checked={c.inventory_sync_enabled} onChange={v => patchChannel(c,{inventory_sync_enabled:v})}/><Toggle label="Bookings" checked={c.booking_sync_enabled} onChange={v => patchChannel(c,{booking_sync_enabled:v})}/><button onClick={() => patchChannel(c,{active:!c.active})} className="ml-auto"><Badge tone={c.active ? 'success':'neutral'}>{c.active ? 'Active':'Inactive'}</Badge></button></div>
    </SectionCard>)}</div>
    {!filtered.length && <div className="text-center py-12 text-slate-500"><Globe className="w-12 h-12 mx-auto mb-3"/>No channels found</div>}
    {channelForm !== undefined && <ChannelForm channel={channelForm} saving={busy.size > 0} onCancel={() => setChannelForm(undefined)} onSave={saveChannel}/>} 
    {mappingChannel && <MappingModal channel={mappingChannel} roomTypes={roomTypes} busy={busy} onClose={() => setMappingChannel(null)} onAdd={() => setMappingForm(null)} onEdit={setMappingForm} onDelete={removeMapping}/>} 
    {mappingForm !== undefined && mappingChannel && <MappingForm mapping={mappingForm} roomTypes={roomTypes} saving={busy.size > 0} onCancel={() => setMappingForm(undefined)} onSave={saveMapping}/>} 
    {showHistory && <HistoryModal logs={history} channels={channels} onClose={() => setShowHistory(false)}/>} 
  </div>;
}

function IconButton({ title, onClick, children }: { title:string; onClick:()=>void; children:React.ReactNode }) { return <button title={title} onClick={onClick} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400">{children}</button>; }
function Toggle({label,checked,onChange}:{label:string;checked:boolean;onChange:(v:boolean)=>void}) { return <label className="flex gap-2 items-center text-sm text-slate-600 dark:text-slate-400"><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)} className="rounded"/>{label}</label>; }
const fieldClass="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white";
function Modal({title,onClose,children,footer}:{title:string;onClose:()=>void;children:React.ReactNode;footer?:React.ReactNode}) { return <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"><div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto"><div className="p-5 border-b flex justify-between"><h3 className="font-semibold text-lg">{title}</h3><button onClick={onClose}><X className="w-5 h-5"/></button></div><div className="p-5">{children}</div>{footer && <div className="p-5 border-t flex justify-end gap-3">{footer}</div>}</div></div>; }

const toChannelPayload = (f: any) => {
  const { api_key, api_secret, token, username, password, hotel_code, ...rest } = f;
  const credentials = Object.fromEntries(Object.entries({ api_key, api_secret, token, username, password, hotel_code }).filter(([, v]) => v !== ''));
  return { ...rest, credentials };
};

function ChannelForm({channel,onCancel,onSave,saving}:{channel:Channel|null;onCancel:()=>void;onSave:(f:any)=>void;saving:boolean}) {
 const [f,setF]=useState({channel_name:channel?.channel_name||'',channel_code:channel?.channel_code||'',channel_type:channel?.channel_type||'ota',api_endpoint:channel?.api_endpoint||'',api_version:channel?.api_version||'1.0',sync_interval_minutes:channel?.sync_interval_minutes||30,rate_parity_threshold:channel?.rate_parity_threshold||5,rate_parity_enabled:channel?.rate_parity_enabled??true,inventory_sync_enabled:channel?.inventory_sync_enabled??true,booking_sync_enabled:channel?.booking_sync_enabled??true,active:channel?.active??true,test_mode:channel?.test_mode??false,api_key:'',api_secret:'',token:'',username:'',password:'',hotel_code:''}); const set=(k:string,v:any)=>setF(p=>({...p,[k]:v}));
 return <Modal title={channel?'Edit Channel':'Add Channel'} onClose={onCancel} footer={<><button className={button.secondary} onClick={onCancel}>Cancel</button><button className={button.primary} disabled={saving||!f.channel_name||!f.channel_code||!f.api_endpoint} onClick={()=>onSave(toChannelPayload(f))}>{saving&&<Loader2 className="w-4 h-4 animate-spin"/>}Save</button></>}><div className="space-y-4"><div className="grid grid-cols-2 gap-4"><Field label="Name"><input className={fieldClass} value={f.channel_name} onChange={e=>set('channel_name',e.target.value)}/></Field><Field label="Code"><input className={fieldClass} value={f.channel_code} onChange={e=>set('channel_code',e.target.value)}/></Field></div><div className="grid grid-cols-2 gap-4"><Field label="Type"><select className={fieldClass} value={f.channel_type} onChange={e=>set('channel_type',e.target.value)}><option value="ota">OTA</option><option value="gds">GDS</option><option value="bedbank">Bedbank</option><option value="metasearch">Metasearch</option></select></Field><Field label="API Version"><input className={fieldClass} value={f.api_version} onChange={e=>set('api_version',e.target.value)}/></Field></div><Field label="API Endpoint"><input className={fieldClass} value={f.api_endpoint} onChange={e=>set('api_endpoint',e.target.value)}/></Field><div className="grid grid-cols-2 gap-4"><Field label="Sync interval (minutes)"><input type="number" className={fieldClass} value={f.sync_interval_minutes} onChange={e=>set('sync_interval_minutes',Number(e.target.value))}/></Field><Field label="Parity threshold (%)"><input type="number" className={fieldClass} value={f.rate_parity_threshold} onChange={e=>set('rate_parity_threshold',Number(e.target.value))}/></Field></div><div className="border border-slate-200 dark:border-slate-600 rounded-lg p-3 space-y-3"><p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">API Credentials — {channel ? 'leave blank to keep existing' : 'required for live sync'}</p><div className="grid grid-cols-2 gap-4"><Field label="API Key"><input type="password" autoComplete="new-password" className={fieldClass} value={f.api_key} onChange={e=>set('api_key',e.target.value)}/></Field><Field label="API Secret"><input type="password" autoComplete="new-password" className={fieldClass} value={f.api_secret} onChange={e=>set('api_secret',e.target.value)}/></Field></div><div className="grid grid-cols-2 gap-4"><Field label="Username"><input autoComplete="off" className={fieldClass} value={f.username} onChange={e=>set('username',e.target.value)}/></Field><Field label="Password"><input type="password" autoComplete="new-password" className={fieldClass} value={f.password} onChange={e=>set('password',e.target.value)}/></Field></div><div className="grid grid-cols-2 gap-4"><Field label="Access Token"><input type="password" autoComplete="new-password" className={fieldClass} value={f.token} onChange={e=>set('token',e.target.value)}/></Field><Field label="Hotel Code"><input className={fieldClass} value={f.hotel_code} onChange={e=>set('hotel_code',e.target.value)} placeholder="Property code at the channel"/></Field></div></div><div className="flex flex-wrap gap-4"><Toggle label="Rate parity" checked={f.rate_parity_enabled} onChange={v=>set('rate_parity_enabled',v)}/><Toggle label="Inventory sync" checked={f.inventory_sync_enabled} onChange={v=>set('inventory_sync_enabled',v)}/><Toggle label="Booking sync" checked={f.booking_sync_enabled} onChange={v=>set('booking_sync_enabled',v)}/><Toggle label="Test mode" checked={f.test_mode} onChange={v=>set('test_mode',v)}/></div></div></Modal>;
}
function Field({label,children}:{label:string;children:React.ReactNode}) { return <label className="block text-sm font-medium text-slate-700 dark:text-slate-300"><span className="block mb-1">{label}</span>{children}</label>; }

function MappingModal({channel,roomTypes,busy,onClose,onAdd,onEdit,onDelete}:{channel:Channel;roomTypes:RoomType[];busy:Set<string>;onClose:()=>void;onAdd:()=>void;onEdit:(m:Mapping)=>void;onDelete:(m:Mapping)=>void}) { return <Modal title={`Room Mappings — ${channel.channel_name}`} onClose={onClose} footer={<><button className={button.secondary} onClick={onClose}>Close</button><button className={button.primary} onClick={onAdd}><Plus className="w-4 h-4"/>Add Mapping</button></>}><div className="space-y-3">{channel.room_mappings.map(m=><div key={m.id} className="p-4 rounded-lg border bg-slate-50 dark:bg-slate-700/50 flex justify-between"><div><p className="font-medium">{roomTypes.find(r=>r.id===m.our_room_type_id)?.name||m.our_room_type_id} → {m.channel_room_name||m.channel_room_code}</p><p className="text-sm text-slate-500">{m.channel_room_code} · Rate ×{m.rate_multiplier} · Inventory ×{m.inventory_multiplier}</p></div><div><IconButton title="Edit" onClick={()=>onEdit(m)}><Edit className="w-4 h-4 text-blue-600"/></IconButton><IconButton title="Delete" onClick={()=>onDelete(m)}><Trash2 className={`w-4 h-4 text-red-600 ${busy.has(m.id)?'opacity-50':''}`}/></IconButton></div></div>)}{!channel.room_mappings.length&&<p className="text-center py-8 text-slate-500">No room mappings configured</p>}</div></Modal>; }
function MappingForm({mapping,roomTypes,onCancel,onSave,saving}:{mapping:Mapping|null;roomTypes:RoomType[];onCancel:()=>void;onSave:(f:any)=>void;saving:boolean}) { const [f,setF]=useState({our_room_type_id:mapping?.our_room_type_id||'',channel_room_code:mapping?.channel_room_code||'',channel_room_name:mapping?.channel_room_name||'',quality_score:mapping?.quality_score||1,rate_multiplier:mapping?.rate_multiplier||1,inventory_multiplier:mapping?.inventory_multiplier||1,active:mapping?.active??true,sync_enabled:mapping?.sync_enabled??true}); const set=(k:string,v:any)=>setF(p=>({...p,[k]:v})); return <Modal title={mapping?'Edit Mapping':'Add Mapping'} onClose={onCancel} footer={<><button className={button.secondary} onClick={onCancel}>Cancel</button><button className={button.primary} disabled={saving||!f.our_room_type_id||!f.channel_room_code} onClick={()=>onSave(f)}>Save</button></>}><div className="space-y-4"><Field label="Our Room Type"><select className={fieldClass} value={f.our_room_type_id} onChange={e=>set('our_room_type_id',e.target.value)}><option value="">Select…</option>{roomTypes.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></Field><div className="grid grid-cols-2 gap-4"><Field label="Channel Room Code"><input className={fieldClass} value={f.channel_room_code} onChange={e=>set('channel_room_code',e.target.value)}/></Field><Field label="Channel Room Name"><input className={fieldClass} value={f.channel_room_name} onChange={e=>set('channel_room_name',e.target.value)}/></Field></div><div className="grid grid-cols-3 gap-4"><Field label="Quality"><input type="number" step="0.01" className={fieldClass} value={f.quality_score} onChange={e=>set('quality_score',Number(e.target.value))}/></Field><Field label="Rate multiplier"><input type="number" step="0.01" className={fieldClass} value={f.rate_multiplier} onChange={e=>set('rate_multiplier',Number(e.target.value))}/></Field><Field label="Inventory multiplier"><input type="number" step="0.01" className={fieldClass} value={f.inventory_multiplier} onChange={e=>set('inventory_multiplier',Number(e.target.value))}/></Field></div><Toggle label="Sync enabled" checked={f.sync_enabled} onChange={v=>set('sync_enabled',v)}/></div></Modal>; }
function HistoryModal({logs,channels,onClose}:{logs:SyncLog[];channels:Channel[];onClose:()=>void}) { return <Modal title="Recent Sync Activity" onClose={onClose} footer={<button className={button.secondary} onClick={onClose}>Close</button>}><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-slate-500"><th className="py-2">Channel</th><th>Type</th><th>Status</th><th>Records</th><th>Started</th></tr></thead><tbody>{logs.map(l=><tr key={l.id} className="border-b"><td className="py-3">{channels.find(c=>c.id===l.channel_id)?.channel_name||'Unknown'}</td><td>{l.sync_type}</td><td><Badge tone={statusTone[l.status]||'neutral'}>{l.status}</Badge></td><td>{l.records_successful}/{l.records_processed}</td><td>{new Date(l.sync_start).toLocaleString()}</td></tr>)}</tbody></table>{!logs.length&&<p className="text-center py-8 text-slate-500">No sync activity</p>}</div></Modal>; }
