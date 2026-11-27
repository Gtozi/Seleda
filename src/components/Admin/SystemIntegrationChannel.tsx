/**
 * System Integration & Channel Management
 * Channel Manager Sync
 */

import { useState, useEffect } from 'react';
import { Share2, Globe, AlertTriangle, Settings, Activity, RefreshCw, Loader2 } from 'lucide-react';
import { adminAuthHeaders } from './shared/ResourceManager';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button } from '../FrontOffice/brandTheme';

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

const SYNC_TONE: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  success: 'success',
  simulated: 'info',
  partial: 'warning',
  failed: 'danger',
  pending: 'neutral',
};

export default function SystemIntegrationChannel({ embedded }: { embedded?: boolean } = {}) {
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
    <label className="flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-300 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={onChange} className="rounded border-gray-300 dark:border-slate-600" />
      {label}
    </label>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      {embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-500 dark:text-gray-400">Manage OTA & GDS channel sync, rate parity, inventory availability, and booking feeds</p>
          <button onClick={load} disabled={loading} className={button.secondary}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      ) : (
        <PageHeader
          title="Integration Hub"
          subtitle="Manage OTA & GDS channel sync, rate parity, inventory availability, and booking feeds"
          icon={Share2}
          actions={
            <button onClick={load} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          }
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Active Channels" value={activeCount} icon={Globe} tone="accent" />
        <StatCard title="Sync Enabled" value={syncEnabled} icon={Share2} tone="warning" />
        <StatCard title="Last Sync" value={lastSync ? new Date(lastSync).toLocaleDateString() : '—'} icon={Activity} tone="success" />
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 text-sm border border-rose-200 dark:border-rose-800">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      <SectionCard
        title="Connected Distribution Channels"
        subtitle={`${channels.length} channel${channels.length !== 1 ? 's' : ''} configured`}
        icon={Share2}
        tone="accent"
      >
        {loading && channels.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm"><Loader2 className="inline animate-spin" size={18} /></div>
        ) : channels.length === 0 ? (
          <p className="py-10 text-center text-gray-400 text-sm">No channel connections configured.</p>
        ) : (
          <div className="space-y-3">
            {channels.map(ch => (
              <div
                key={ch.id}
                className={`flex flex-wrap items-center justify-between gap-3 p-4 border border-gray-200 dark:border-slate-700 rounded-xl ${
                  ch.active ? 'bg-slate-50 dark:bg-slate-900/40' : 'bg-slate-50/50 dark:bg-slate-900/20 opacity-70'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 shrink-0">
                    <Globe size={16} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-gray-900 dark:text-white">{ch.channel_name}</span>
                      <span className="text-xs text-gray-400 font-mono">{ch.channel_code} · {ch.channel_type}</span>
                      {ch.test_mode && <Badge tone="warning">Test Mode</Badge>}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Last sync: {fmtTime(ch.last_sync_at)}
                      {ch.last_sync_error && <span className="text-rose-500 ml-1">— {ch.last_sync_error}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                  <Toggle checked={!!ch.rate_parity_enabled} onChange={() => patch(ch, 'rate_parity_enabled', !ch.rate_parity_enabled)} label="Rate Sync" />
                  <Toggle checked={!!ch.inventory_sync_enabled} onChange={() => patch(ch, 'inventory_sync_enabled', !ch.inventory_sync_enabled)} label="Avail. Sync" />
                  <Toggle checked={!!ch.booking_sync_enabled} onChange={() => patch(ch, 'booking_sync_enabled', !ch.booking_sync_enabled)} label="Bookings" />
                  <Toggle checked={!!ch.active} onChange={() => patch(ch, 'active', !ch.active)} label="Active" />
                  <Badge tone={SYNC_TONE[ch.last_sync_status || 'pending'] || 'neutral'}>
                    {savingId === ch.id ? 'saving…' : (ch.last_sync_status || 'pending')}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Connection Details" icon={Settings} tone="info">
        <p className="text-xs text-gray-600 dark:text-gray-400">
          Channel connections are managed under <span className="font-bold text-gray-900 dark:text-white">Admin → Channel Manager</span>, where credentials,
          sync intervals, rate-parity thresholds and room mappings are configured. Rows marked <span className="font-bold text-gray-900 dark:text-white">Test Mode</span> use the simulated adapter and never contact the supplier.
        </p>
      </SectionCard>
    </div>
  );
}
