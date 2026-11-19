import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Briefcase, Building, DollarSign, Filter, Globe, Loader2, Package, Phone, ServerCrash, Settings, TrendingDown, TrendingUp, Users } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard } from '../FrontOffice/ui';
import { rmsGet } from '../../services/rmsService';

const API = '/api/rms-portal/channel-performance';

const ICONS: Record<string, React.ElementType> = { Globe, Phone, Users, Building, Briefcase, Package, DollarSign, TrendingUp, TrendingDown, BarChart3, Settings, Filter };

type Channel = { id: string; code: string; name: string; icon_name: string | null; revenue: number; adr: number; conversion: number; acquisition_cost: number; cancellation_rate: number; net_revenue: number; bookings: number; growth: number; active: boolean };



export default function ChannelPerformance() {
  const { currentPropertyId } = useERP();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState('30');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const json = await rmsGet(API, { propertyId: currentPropertyId });
      setChannels(json.channels || []);
    } catch (e: any) { setError(e.message || 'Failed to load channel performance'); }
    finally { setLoading(false); }
  }, [currentPropertyId]);
  useEffect(() => { load(); }, [load]);

  const activeChannels = useMemo(() => channels.filter(c => c.active), [channels]);
  const totalRevenue = useMemo(() => activeChannels.reduce((s, c) => s + Number(c.revenue), 0), [activeChannels]);
  const totalNetRevenue = useMemo(() => activeChannels.reduce((s, c) => s + Number(c.net_revenue), 0), [activeChannels]);
  const totalBookings = useMemo(() => activeChannels.reduce((s, c) => s + Number(c.bookings), 0), [activeChannels]);
  const avgADR = useMemo(() => activeChannels.length ? Math.round(activeChannels.reduce((s, c) => s + Number(c.adr), 0) / activeChannels.length) : 0, [activeChannels]);
  const avgAcquisitionCost = useMemo(() => activeChannels.length ? Math.round(activeChannels.reduce((s, c) => s + Number(c.acquisition_cost), 0) / activeChannels.length) : 0, [activeChannels]);
  const topChannels = useMemo(() => [...activeChannels].sort((a, b) => Number(b.net_revenue) - Number(a.net_revenue)).slice(0, 3), [activeChannels]);

  if (loading && !channels.length) return <div className="p-6 flex justify-center py-20 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2"/>Loading channel performance…</div>;
  if (error && !channels.length) return <div className="p-6 flex flex-col items-center py-20 text-rose-600"><ServerCrash className="w-10 h-10 mb-3"/><p>{error}</p><button onClick={load} className="mt-4 text-blue-600">Retry</button></div>;

  return <div className="p-6 space-y-6">
    <PageHeader title="Channel Performance" subtitle="Analyze revenue and performance by distribution channel" actions={<div className="flex items-center gap-3"><select value={dateRange} onChange={e => setDateRange(e.target.value)} className="px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-700 dark:text-slate-300"><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select><button className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded-lg text-sm font-medium transition-colors"><Filter className="w-4 h-4"/>Filter</button></div>} />
    {error && <div className="px-4 py-2 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-600">{error}</div>}

    <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
      <StatCard title="Total Revenue" value={`$${totalRevenue.toLocaleString()}`} icon={DollarSign} tone="info" />
      <StatCard title="Net Revenue" value={`$${totalNetRevenue.toLocaleString()}`} icon={TrendingUp} tone="success" />
      <StatCard title="Total Bookings" value={totalBookings} icon={Users} tone="accent" />
      <StatCard title="Avg ADR" value={`$${avgADR}`} icon={BarChart3} tone="warning" />
      <StatCard title="Avg Acq. Cost" value={`${avgAcquisitionCost}%`} icon={Settings} tone="danger" />
    </div>

    <SectionCard title="Channel Performance" icon={Globe} pad="md">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {activeChannels.map(channel => { const Icon = (channel.icon_name && ICONS[channel.icon_name]) || Globe; const margin = Math.round(((channel.revenue - channel.net_revenue) / channel.revenue) * 100); return <div key={channel.code} onClick={() => setSelectedChannel(channel.id)} className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${selectedChannel === channel.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'}`}>
          <div className="flex items-center gap-3 mb-3"><div className="p-2 bg-slate-100 dark:bg-slate-700 rounded-lg"><Icon className="w-5 h-5"/></div><div className="flex-1"><h4 className="font-semibold text-slate-900 dark:text-white">{channel.name}</h4><p className={`text-sm ${channel.growth >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{channel.growth >= 0 ? '+' : ''}{channel.growth}% growth</p></div></div>
          <div className="grid grid-cols-2 gap-2 text-sm"><div><p className="text-slate-600 dark:text-slate-400">Revenue</p><p className="font-medium text-slate-900 dark:text-white">${Number(channel.revenue).toLocaleString()}</p></div><div><p className="text-slate-600 dark:text-slate-400">Net Revenue</p><p className="font-medium text-green-600 dark:text-green-400">${Number(channel.net_revenue).toLocaleString()}</p></div><div><p className="text-slate-600 dark:text-slate-400">ADR</p><p className="font-medium text-slate-900 dark:text-white">${channel.adr}</p></div><div><p className="text-slate-600 dark:text-slate-400">Conversion</p><p className="font-medium text-slate-900 dark:text-white">{channel.conversion}%</p></div><div><p className="text-slate-600 dark:text-slate-400">Acq. Cost</p><p className="font-medium text-slate-900 dark:text-white">{channel.acquisition_cost}%</p></div><div><p className="text-slate-600 dark:text-slate-400">Cancel Rate</p><p className="font-medium text-slate-900 dark:text-white">{channel.cancellation_rate}%</p></div></div>
          <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700"><div className="flex justify-between text-xs"><span className="text-slate-600 dark:text-slate-400">Channel Margin</span><span className="font-medium text-slate-900 dark:text-white">{100 - margin}%</span></div></div>
        </div>; })}
      </div>
    </SectionCard>

    <SectionCard title="Top Performing Channels (Net Revenue)" icon={TrendingUp} pad="md">
      <div className="space-y-3">
        {topChannels.map((channel, idx) => { const margin = Math.round(((channel.revenue - channel.net_revenue) / channel.revenue) * 100); return <div key={channel.id} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
          <div className="flex items-center gap-4"><span className="w-8 h-8 flex items-center justify-center bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full text-sm font-bold">{idx + 1}</span><div><h4 className="font-medium text-slate-900 dark:text-white">{channel.name}</h4><p className="text-sm text-slate-600 dark:text-slate-400">{channel.bookings} bookings</p></div></div>
          <div className="flex items-center gap-6"><div className="text-right"><p className="text-sm text-slate-600 dark:text-slate-400">Revenue</p><p className="font-semibold text-slate-900 dark:text-white">${Number(channel.revenue).toLocaleString()}</p></div><div className="text-right"><p className="text-sm text-slate-600 dark:text-slate-400">Net Revenue</p><p className="font-semibold text-green-600 dark:text-green-400">${Number(channel.net_revenue).toLocaleString()}</p></div><div className="text-right"><p className="text-sm text-slate-600 dark:text-slate-400">Margin</p><p className="font-semibold text-slate-900 dark:text-white">{100 - margin}%</p></div><div className="text-right"><p className={`text-sm font-medium ${channel.growth >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{channel.growth >= 0 ? '+' : ''}{channel.growth}%</p></div></div>
        </div>; })}
      </div>
    </SectionCard>
  </div>;
}
