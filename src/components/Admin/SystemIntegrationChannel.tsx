/**
 * System Integration & Channel Management
 * Channel Manager Sync
 */

import { useState, useEffect } from 'react';
import {
  Share2, Globe, AlertTriangle, Settings, Activity, RefreshCw, Loader2
} from 'lucide-react';
import { adminAuthHeaders } from './shared/ResourceManager';

export default function SystemIntegrationChannel() {
  return (
    <div className="h-full flex flex-col bg-slate-50">
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <ChannelManagerModule />
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
          { label: 'Active Channels', value: activeCount, icon: Globe, cls: 'bg-indigo-500/10 text-indigo-600' },
          { label: 'Sync Enabled', value: syncEnabled, icon: Share2, cls: 'bg-amber-500/10 text-amber-600' },
          { label: 'Last Sync', value: lastSync ? new Date(lastSync).toLocaleDateString() : '—', icon: Activity, cls: 'bg-emerald-500/10 text-emerald-600' },
        ].map((s, i) => (
          <div key={i} className="bg-white border border-slate-200 p-5 rounded-3xl shadow-sm flex items-center gap-4">
            <div className={`p-3 rounded-2xl ${s.cls}`}><s.icon size={20} /></div>
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
