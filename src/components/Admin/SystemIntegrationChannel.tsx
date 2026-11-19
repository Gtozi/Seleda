/**
 * System Integration & Channel Management
 * 1. Channel Manager Sync
 * 2. Hardware Peripherals
 * 3. Local Network Config
 */

import React, { useState, useEffect } from 'react';
import {
  Share2, Wifi, Printer, DoorOpen, Monitor, HardDrive, Globe,
  AlertTriangle, Settings, Activity, RefreshCw, Loader2
} from 'lucide-react';
import { adminAuthHeaders } from './shared/ResourceManager';

type IntegrationTab = 'channel_manager' | 'hardware' | 'network';

const TAB_META: { id: IntegrationTab; label: string; icon: React.ReactNode }[] = [
  { id: 'channel_manager', label: 'Channel Manager Sync', icon: <Share2 size={14} /> },
  { id: 'hardware', label: 'Hardware Peripherals', icon: <Printer size={14} /> },
  { id: 'network', label: 'Local Network', icon: <Wifi size={14} /> },
];

export default function SystemIntegrationChannel() {
  const [activeTab, setActiveTab] = useState<IntegrationTab>('channel_manager');

  return (
    <div className="h-full flex flex-col bg-slate-50">
      <div className="px-6 pt-4 flex justify-center">
        <div className="flex bg-slate-100 p-1 border border-slate-200 rounded-xl">
          {TAB_META.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 flex items-center justify-center gap-2 rounded-lg text-xs font-sans font-bold transition-all ${
                activeTab === t.id ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-600 hover:text-slate-900 bg-white'
              }`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {activeTab === 'channel_manager' && <ChannelManagerModule />}
        {activeTab === 'hardware' && <HardwarePeripheralsModule />}
        {activeTab === 'network' && <LocalNetworkModule />}
      </div>
    </div>
  );
}

interface ChannelConnection {
  id: string;
  channel_name: string;
  channel_code: string;
  channel_type: string;
  sync_interval_minutes?: number;
  last_sync_at?: string | null;
  last_sync_status?: string | null;
  last_sync_error?: string | null;
  rate_parity_enabled?: boolean;
  inventory_sync_enabled?: boolean;
  booking_sync_enabled?: boolean;
  active?: boolean;
  test_mode?: boolean;
}

const SYNC_STATUS_STYLE: Record<string, string> = {
  success: 'bg-emerald-50 text-emerald-600',
  simulated: 'bg-sky-50 text-sky-600',
  partial: 'bg-amber-50 text-amber-600',
  failed: 'bg-rose-50 text-rose-600',
  pending: 'bg-slate-100 text-slate-500',
};

function ChannelManagerModule() {
  const [channels, setChannels] = useState<ChannelConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/channels', { headers: adminAuthHeaders() });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      setChannels(json.channels || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const patch = async (ch: ChannelConnection, field: keyof ChannelConnection, value: any) => {
    setSavingId(ch.id);
    setChannels(prev => prev.map(c => c.id === ch.id ? { ...c, [field]: value } : c));
    try {
      const res = await fetch(`/api/channels/${ch.id}`, {
        method: 'PATCH',
        headers: adminAuthHeaders(),
        body: JSON.stringify({ [field]: value }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Update failed (${res.status})`);
    } catch (e: any) {
      setError(e.message);
      await load();
    } finally {
      setSavingId(null);
    }
  };

  const activeCount = channels.filter(c => c.active).length;
  const syncEnabled = channels.filter(c => c.active && (c.rate_parity_enabled || c.inventory_sync_enabled || c.booking_sync_enabled)).length;
  const lastSync = channels.map(c => c.last_sync_at).filter(Boolean).sort().pop();

  const fmtTime = (iso?: string | null) => {
    if (!iso) return 'Never';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : d.toLocaleString();
  };

  const Toggle = ({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) => (
    <label className="flex items-center gap-2 text-[10px] font-bold text-slate-600 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={onChange} className="rounded" />
      {label}
    </label>
  );

  return (
    <div className="space-y-6 animate-fade-in pt-4 max-w-5xl mx-auto">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: 'Active Channels', value: activeCount, icon: Globe, color: 'indigo' },
          { label: 'Sync Enabled', value: syncEnabled, icon: Share2, color: 'amber' },
          { label: 'Last Sync', value: lastSync ? new Date(lastSync).toLocaleDateString() : '—', icon: Activity, color: 'emerald' },
        ].map((s, i) => (
          <div key={i} className="bg-white border border-slate-200 p-5 rounded-3xl shadow-sm flex items-center gap-4">
            <div className={`p-3 rounded-2xl bg-${s.color}-500/10 text-${s.color}-600`}><s.icon size={20} /></div>
            <div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">{s.label}</span>
              <h4 className="text-xl font-black text-slate-900">{s.value}</h4>
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-50 text-rose-700 text-sm border border-rose-100">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-sans font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Share2 size={18} className="text-violet-500" /> Connected Distribution Channels
          </h2>
          <button onClick={load} disabled={loading} className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-800 disabled:opacity-50" title="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        {loading && channels.length === 0 ? (
          <div className="py-10 text-center text-slate-400 text-sm"><Loader2 className="inline animate-spin" size={18} /></div>
        ) : channels.length === 0 ? (
          <p className="py-10 text-center text-slate-400 text-sm">No channel connections configured.</p>
        ) : (
          <div className="space-y-3">
            {channels.map(ch => (
              <div key={ch.id} className={`flex flex-wrap items-center justify-between gap-3 p-4 border rounded-xl ${ch.active ? 'bg-slate-50 border-slate-200' : 'bg-slate-50/50 border-slate-100 opacity-70'}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2 bg-white rounded-xl border border-slate-200 text-slate-600 shrink-0">
                    <Globe size={16} />
                  </div>
                  <div className="min-w-0">
                    <span className="text-xs font-bold text-slate-900">{ch.channel_name}</span>
                    <span className="text-[10px] text-slate-400 ml-2 font-mono">{ch.channel_code} · {ch.channel_type}</span>
                    {ch.test_mode && <span className="ml-2 px-1.5 py-0.5 rounded text-[8px] font-black uppercase bg-amber-50 text-amber-600">test mode</span>}
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      Last sync: {fmtTime(ch.last_sync_at)}
                      {ch.last_sync_error && <span className="text-rose-500 ml-1">— {ch.last_sync_error}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <Toggle checked={!!ch.rate_parity_enabled} onChange={() => patch(ch, 'rate_parity_enabled', !ch.rate_parity_enabled)} label="Rate Sync" />
                  <Toggle checked={!!ch.inventory_sync_enabled} onChange={() => patch(ch, 'inventory_sync_enabled', !ch.inventory_sync_enabled)} label="Avail. Sync" />
                  <Toggle checked={!!ch.booking_sync_enabled} onChange={() => patch(ch, 'booking_sync_enabled', !ch.booking_sync_enabled)} label="Bookings" />
                  <Toggle checked={!!ch.active} onChange={() => patch(ch, 'active', !ch.active)} label="Active" />
                  <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest ${SYNC_STATUS_STYLE[ch.last_sync_status || 'pending'] || SYNC_STATUS_STYLE.pending}`}>
                    {savingId === ch.id ? 'saving…' : (ch.last_sync_status || 'pending')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
        <h2 className="text-base font-sans font-black text-slate-900 tracking-tight flex items-center gap-2 mb-2">
          <Settings size={18} className="text-indigo-500" /> Connection Details
        </h2>
        <p className="text-xs text-slate-500">
          Channel connections are managed under <span className="font-bold">Admin → Channel Manager</span>, where credentials,
          sync intervals, rate-parity thresholds and room mappings are configured. Rows marked <span className="font-bold">test mode</span> use the simulated adapter and never contact the supplier.
        </p>
      </div>
    </div>
  );
}

function HardwarePeripheralsModule() {
  const [devices] = useState([
    { id: 'doorlock-01', name: 'Main Entrance Encoder', type: 'Door Lock', status: 'online', ip: '192.168.1.101' },
    { id: 'printer-01', name: 'Reception Thermal Printer', type: 'Receipt Printer', status: 'online', ip: '192.168.1.102' },
    { id: 'kds-01', name: 'Kitchen Display System', type: 'KDS', status: 'offline', ip: '192.168.1.103' },
  ]);

  return (
    <div className="space-y-6 animate-fade-in pt-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: 'Online Devices', value: devices.filter(d => d.status === 'online').length, icon: DoorOpen, color: 'emerald' },
          { label: 'Offline', value: devices.filter(d => d.status === 'offline').length, icon: AlertTriangle, color: 'rose' },
          { label: 'Total Mapped', value: devices.length, icon: Printer, color: 'indigo' },
        ].map((s, i) => (
          <div key={i} className="bg-white border border-slate-200 p-5 rounded-3xl shadow-sm flex items-center gap-4">
            <div className={`p-3 rounded-2xl bg-${s.color}-500/10 text-${s.color}-600`}><s.icon size={20} /></div>
            <div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">{s.label}</span>
              <h4 className="text-xl font-black text-slate-900">{s.value}</h4>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
        <h2 className="text-base font-sans font-black text-slate-900 tracking-tight flex items-center gap-2 mb-4">
          <Monitor size={18} className="text-indigo-500" /> Hardware Peripheral Registry
        </h2>
        <div className="space-y-2">
          {devices.map(device => (
            <div key={device.id} className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white rounded-xl border border-slate-200 text-slate-600">
                  {device.type === 'Door Lock' ? <DoorOpen size={16} /> :
                   device.type === 'Receipt Printer' ? <Printer size={16} /> :
                   <Monitor size={16} />}
                </div>
                <div>
                  <span className="text-xs font-bold text-slate-900">{device.name}</span>
                  <span className="text-[10px] text-slate-400 ml-2 font-mono">{device.ip}</span>
                </div>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest ${
                device.status === 'online' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
              }`}>{device.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LocalNetworkModule() {
  const [config, setConfig] = useState({
    backupStoragePath: '/mnt/backup/local',
    enableLocalMirror: true,
    wifiSsid: 'Hotel-Staff-5G',
    wifiPassword: '',
  });

  return (
    <div className="space-y-6 animate-fade-in pt-4 max-w-5xl mx-auto">
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
        <h2 className="text-base font-sans font-black text-slate-900 tracking-tight flex items-center gap-2 mb-4">
          <HardDrive size={18} className="text-indigo-500" /> Local Backup Storage
        </h2>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-mono uppercase text-slate-400 font-bold">Local Backup Path</label>
            <input value={config.backupStoragePath} onChange={e => setConfig(f => ({ ...f, backupStoragePath: e.target.value }))}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono outline-none" />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setConfig(f => ({ ...f, enableLocalMirror: !f.enableLocalMirror }))}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${config.enableLocalMirror ? 'bg-emerald-500' : 'bg-slate-300'}`}>
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${config.enableLocalMirror ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
            <span className="text-sm font-bold text-slate-800">Enable local mirror sync</span>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
        <h2 className="text-base font-sans font-black text-slate-900 tracking-tight flex items-center gap-2 mb-4">
          <Wifi size={18} className="text-violet-500" /> Staff Network Configuration
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="space-y-1.5">
            <label className="text-xs font-mono uppercase text-slate-400 font-bold">WiFi SSID</label>
            <input value={config.wifiSsid} onChange={e => setConfig(f => ({ ...f, wifiSsid: e.target.value }))}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-mono uppercase text-slate-400 font-bold">WiFi Password</label>
            <input type="password" value={config.wifiPassword} onChange={e => setConfig(f => ({ ...f, wifiPassword: e.target.value }))}
              placeholder="••••••••"
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none" />
          </div>
        </div>
      </div>
    </div>
  );
}
