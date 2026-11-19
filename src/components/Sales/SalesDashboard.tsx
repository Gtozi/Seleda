import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  TrendingUp, Target, Award, DollarSign, Users, BarChart3,
  Mail, MousePointerClick, Megaphone, Heart, Star, Crown,
  RefreshCw, Activity, Building2, Briefcase, LayoutDashboard,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area, PieChart, Pie, Cell,
} from 'recharts';
import { useERP } from '../../context/ERPContext';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import StatCard from '../FrontOffice/StatCard';
import {
  fetchSalesAnalytics, fetchLeads, fetchCorporateAccounts, fetchSalesDashboard,
  refreshSalesDashboard, type SalesDashboardWidget,
} from '../../services/salesService';

const ICONS: Record<string, any> = {
  TrendingUp, Target, Award, DollarSign, Users, BarChart3,
  Mail, MousePointerClick, Megaphone, Heart, Star, Crown,
  Activity, Building2, Briefcase, RefreshCw, LayoutDashboard,
};

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

function parseChange(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const m = value.match(/([+-]?\d+(?:\.\d+)?)/);
  if (!m) return undefined;
  const num = parseFloat(m[1]);
  return Number.isNaN(num) ? undefined : num;
}

const SalesDashboard: React.FC = () => {
  const { addNotification } = useERP();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [leads, setLeads] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [widgets, setWidgets] = useState<SalesDashboardWidget[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Refresh dashboard KPIs from real data (best-effort, non-blocking)
      refreshSalesDashboard().catch(() => {});
      const [a, l, c, w] = await Promise.all([
        fetchSalesAnalytics().catch(() => null),
        fetchLeads().catch(() => []),
        fetchCorporateAccounts().catch(() => []),
        fetchSalesDashboard().catch(() => []),
      ]);
      setAnalytics(a);
      setLeads(l);
      setAccounts(c);
      setWidgets(w);
      // Show a soft error if all data sources failed
      if (!a && l.length === 0 && c.length === 0 && w.length === 0) {
        setError('Unable to load dashboard data. Check your connection and try again.');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load dashboard data');
      addNotification('Failed to load dashboard data', 'warning', 'Sales');
    } finally {
      setLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { loadData(); }, [loadData]);

  const totalLeads = analytics?.totalLeads ?? leads.length;
  const wonLeads = analytics?.wonLeads ?? leads.filter((l: any) => l.stage === 'Won').length;
  const pipelineValue = analytics?.totalPipelineValue ?? leads.reduce((s: number, l: any) => s + Number(l.opportunity_value || 0), 0);

  const widgetsByCategory = useMemo(() => {
    const map: Record<string, SalesDashboardWidget[]> = { sales: [], marketing: [], crm: [] };
    for (const w of widgets) {
      const cat = w.category?.toLowerCase() || 'sales';
      if (map[cat]) map[cat].push(w);
    }
    Object.values(map).forEach(arr => arr.sort((a, b) => a.sequence - b.sequence));
    return map;
  }, [widgets]);

  const trendWidget = useMemo(() => widgets.find(w => w.widget_type === 'trend' && w.title === 'Revenue Trend'), [widgets]);
  const segmentWidget = useMemo(() => widgets.find(w => w.widget_type === 'segment' && w.title === 'Customer Segments'), [widgets]);

  const revenueTrendData = useMemo(() => trendWidget?.metadata?.data || [], [trendWidget]);
  const customerTypeData = useMemo(() => segmentWidget?.metadata?.data || [], [segmentWidget]);

  const pipelineData = useMemo(() => [
    { stage: 'Prospect', count: leads.filter((l: any) => l.stage === 'Prospect').length || 0, value: 0 },
    { stage: 'Qualified', count: leads.filter((l: any) => l.stage === 'Qualified').length || 0, value: 0 },
    { stage: 'Proposal', count: leads.filter((l: any) => l.stage === 'Proposal').length || 0, value: 0 },
    { stage: 'Negotiation', count: leads.filter((l: any) => l.stage === 'Negotiation').length || 0, value: 0 },
    { stage: 'Won', count: wonLeads, value: 0 },
    { stage: 'Lost', count: leads.filter((l: any) => l.stage === 'Lost').length || 0, value: 0 },
  ], [leads, wonLeads]);

  const recentLeads = leads.slice(0, 5);

  const renderKpiSection = (title: string, _icon: any, category: string) => (
    <div key={category}>
      <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">{title}</h3>
      <div className={layout.kpiGrid}>
        {widgetsByCategory[category].map(w => {
          const Icon = ICONS[w.metadata?.icon] || Target;
          const tone = w.metadata?.tone || 'accent';
          const change = parseChange(w.change_value);
          return (
            <StatCard
              key={w.id}
              title={w.title}
              value={w.value || '—'}
              icon={Icon}
              tone={tone}
              change={change}
            />
          );
        })}
      </div>
    </div>
  );

  return (
    <div className={['accent-sales', layout.sectionStack].join(' ')}>
      <PageHeader
        title="Sales, Marketing & CRM Dashboard"
        subtitle="Unified KPIs across sales pipeline, marketing performance, and customer relationship management"
        icon={LayoutDashboard}
        actions={
          <button onClick={loadData} disabled={loading} className={[button.secondary, 'flex items-center gap-2'].join(' ')}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        }
      />

      {error && !loading && (
        <div className="p-4 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-2xl flex items-center justify-between">
          <p className="text-sm font-semibold text-rose-700 dark:text-rose-400">{error}</p>
          <button onClick={loadData} className={[button.secondary, 'flex items-center gap-2'].join(' ')}>
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      )}

      {loading && widgets.length === 0 ? (
        <SectionCard title="Loading…" icon={RefreshCw} tone="accent">
          <div className="px-6 py-12 text-center text-slate-500"><RefreshCw className="w-5 h-5 animate-spin inline-block mr-2" /> Loading dashboard…</div>
        </SectionCard>
      ) : (
        <>
          {renderKpiSection('Sales KPIs', TrendingUp, 'sales')}
          {renderKpiSection('Marketing KPIs', Megaphone, 'marketing')}
          {renderKpiSection('CRM KPIs', Heart, 'crm')}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SectionCard title="Sales Pipeline by Stage" subtitle="Lead distribution across pipeline stages" icon={Target} tone="info">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={pipelineData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="stage" tick={{ fontSize: 11, fontWeight: 500 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                  <Bar dataKey="count" fill="#6366f1" radius={[8, 8, 0, 0]} name="Leads" />
                </BarChart>
              </ResponsiveContainer>
            </SectionCard>

            <SectionCard title="Revenue Trend" subtitle="Corporate, group, and event revenue over time" icon={TrendingUp} tone="success">
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={revenueTrendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${fmt(v / 1000)}k`} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} formatter={(v: number) => [`$${fmt(v)}`, '']} />
                  <Area type="monotone" dataKey="corporate" stackId="1" stroke="#6366f1" fill="#6366f120" name="Corporate" />
                  <Area type="monotone" dataKey="group" stackId="1" stroke="#10b981" fill="#10b98120" name="Group" />
                  <Area type="monotone" dataKey="events" stackId="1" stroke="#f59e0b" fill="#f59e0b20" name="Events" />
                </AreaChart>
              </ResponsiveContainer>
            </SectionCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <SectionCard title="Customer Segments" subtitle="Revenue distribution by customer type" icon={Users} tone="accent">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={customerTypeData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} innerRadius={40}>
                    {customerTypeData.map((entry: any, i: number) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-2">
                {customerTypeData.map((c: any) => (
                  <div key={c.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{c.name}</span>
                    </div>
                    <span className="text-xs font-bold text-slate-900 dark:text-white">{c.value}%</span>
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Recent Leads" subtitle="Latest entries in the sales pipeline" icon={Briefcase} tone="info" className="lg:col-span-2">
              <div className="space-y-2">
                {recentLeads.length > 0 ? recentLeads.map((lead: any) => (
                  <div key={lead.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600"><Briefcase size={14} /></div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">{lead.lead_name}</p>
                        <p className="text-xs text-slate-500">{lead.company || '—'} · {lead.source}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-emerald-600">${fmt(Number(lead.opportunity_value || 0))}</span>
                      <Badge tone={lead.stage === 'Won' ? 'success' : lead.stage === 'Lost' ? 'danger' : lead.stage === 'Negotiation' ? 'warning' : 'info'}>{lead.stage}</Badge>
                    </div>
                  </div>
                )) : (
                  <div className="text-center py-8">
                    <Target size={32} className="mx-auto text-slate-300 mb-2" />
                    <p className="text-sm text-slate-500">No leads yet. Create your first lead to see it here.</p>
                  </div>
                )}
              </div>
            </SectionCard>
          </div>
        </>
      )}
    </div>
  );
};

export default SalesDashboard;
