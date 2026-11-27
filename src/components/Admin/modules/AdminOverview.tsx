import React, { useCallback, useEffect, useState } from 'react';
import {
  Users, Shield, Building2, Network, ToggleRight, Cpu, KeyRound,
  CreditCard, Activity, AlertTriangle, DatabaseBackup, Clock, RefreshCw,
  Loader2, LayoutDashboard,
  type LucideIcon,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard } from '../../FrontOffice/ui';
import { button } from '../../FrontOffice/brandTheme';
import { adminAuthHeaders } from '../shared/ResourceManager';

type Stat = { label: string; value: string; icon: LucideIcon; tone?: 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' };

const AdminOverview: React.FC = () => {
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/control/overview', { headers: adminAuthHeaders() });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      setData(json);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const n = (v: number | null | undefined) => (v === null || v === undefined ? '—' : String(v));

  const groups: { title: string; tone: 'accent' | 'info' | 'success' | 'warning'; stats: Stat[] }[] = data ? [
    { title: 'Identity & Access', tone: 'accent', stats: [
      { label: 'Active Users', value: n(data.activeUsers), icon: Users, tone: 'accent' },
      { label: 'Total Users', value: n(data.users), icon: Users, tone: 'neutral' },
      { label: 'Custom Roles', value: n(data.roles), icon: Shield, tone: 'info' },
      { label: 'Active Licences', value: n(data.licensesActive), icon: KeyRound, tone: 'success' },
    ] },
    { title: 'Organisation', tone: 'info', stats: [
      { label: 'Properties', value: n(data.properties), icon: Building2, tone: 'accent' },
      { label: 'Organisations', value: n(data.organizations), icon: Network, tone: 'neutral' },
      { label: 'Active Departments', value: n(data.departments), icon: Network, tone: 'info' },
    ] },
    { title: 'Platform', tone: 'success', stats: [
      { label: 'Feature Flags On', value: `${n(data.featureFlags?.enabled)} / ${n(data.featureFlags?.total)}`, icon: ToggleRight, tone: 'success' },
      { label: 'Devices Online', value: `${n(data.devices?.online)} / ${n(data.devices?.total)}`, icon: Cpu, tone: 'info' },
      { label: 'Payment Gateways', value: n(data.paymentGatewaysEnabled), icon: CreditCard, tone: 'warning' },
    ] },
    { title: 'Operations (24h)', tone: 'warning', stats: [
      { label: 'Audit Events', value: n(data.auditEvents24h), icon: Activity, tone: 'accent' },
      { label: 'Failed / Denied', value: n(data.failedEvents24h), icon: AlertTriangle, tone: (data.failedEvents24h ?? 0) > 0 ? 'danger' : 'success' },
      { label: 'Backups', value: n(data.backups), icon: DatabaseBackup, tone: 'info' },
      { label: 'Scheduled Jobs', value: n(data.scheduledJobs), icon: Clock, tone: 'neutral' },
    ] },
  ] : [];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Executive Dashboard"
        subtitle="Live system administration overview across identity, organisation, platform, and operations"
        icon={LayoutDashboard}
        actions={
          <button onClick={load} disabled={loading} className={button.secondary}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        }
      />

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 text-sm">
          <AlertTriangle size={16} /> {error}
        </div>
      )}
      {loading && !data && (
        <div className="py-16 text-center text-slate-400"><Loader2 className="inline animate-spin" /></div>
      )}

      {groups.map(g => (
        <SectionCard key={g.title} title={g.title} icon={LayoutDashboard} tone={g.tone} pad="none">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-5">
            {g.stats.map(s => (
              <StatCard key={s.label} title={s.label} value={s.value} icon={s.icon} tone={s.tone} />
            ))}
          </div>
        </SectionCard>
      ))}

      {data && (
        <p className="text-[11px] text-slate-400">Updated {new Date(data.generatedAt).toLocaleString()}</p>
      )}
    </div>
  );
};

export default AdminOverview;
