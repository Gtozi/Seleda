import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, RefreshCw, Users, Building2, Plane, Briefcase,
  Crown, Target, Layers, X,
} from 'lucide-react';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import StatCard from '../FrontOffice/StatCard';
import { button, layout } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import { ModalSystem } from '../Shared/ModalSystem';
import { DataTable, Column } from '../Shared/DataTable';
import { fetchSegmentMembers, createSegmentMember, type SegmentMember } from '../../services/salesService';

const SEGMENTS = [
  { id: 'corporate', name: 'Corporate Clients', icon: Building2, color: 'indigo', tone: 'info' },
  { id: 'leisure', name: 'Leisure Travelers', icon: Users, color: 'emerald', tone: 'success' },
  { id: 'group', name: 'Group Bookings', icon: Layers, color: 'amber', tone: 'warning' },
  { id: 'travel-agent', name: 'Travel Agents', icon: Plane, color: 'purple', tone: 'accent' },
  { id: 'loyalty', name: 'Loyalty Members', icon: Crown, color: 'rose', tone: 'danger' },
  { id: 'event', name: 'Event Organizers', icon: Briefcase, color: 'cyan', tone: 'info' },
];

const VALUE_TONE: Record<string, string> = {
  High: 'success',
  Medium: 'warning',
  Low: 'neutral',
};

const EMPTY_FORM = {
  name: '',
  segment: 'Corporate Clients',
  totalSpend: 0,
  lastStay: '',
  frequency: 'Occasional',
  valueTier: 'Medium',
};

const CustomerSegmentation: React.FC = () => {
  const { addNotification, formatAmount } = useERP();

  const [members, setMembers] = useState<SegmentMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSegment, setActiveSegment] = useState<string>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMembers(await fetchSegmentMembers(activeSegment !== 'all' ? SEGMENTS.find((s) => s.id === activeSegment)?.name : undefined));
    } catch (err: any) {
      setError(err.message || 'Failed to load segments');
      addNotification('Failed to load segments', 'error', 'Sales');
    } finally {
      setLoading(false);
    }
  }, [activeSegment, addNotification]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreate = async () => {
    if (!form.name.trim()) {
      setError('Customer name is required');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createSegmentMember(form);
      addNotification('Segment member added', 'success', 'Sales');
      setShowAddModal(false);
      setForm(EMPTY_FORM);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to add segment member');
      addNotification('Failed to add segment member', 'error', 'Sales');
    } finally {
      setSaving(false);
    }
  };

  const segmentStats = useMemo(() => {
    const map: Record<string, { count: number; revenue: number }> = {};
    SEGMENTS.forEach((s) => { map[s.name] = { count: 0, revenue: 0 }; });
    members.forEach((m) => {
      if (map[m.segment]) {
        map[m.segment].count += 1;
        map[m.segment].revenue += Number(m.total_spend || 0);
      }
    });
    return map;
  }, [members]);

  const valueTierCounts = useMemo(() => {
    const map: Record<string, number> = { High: 0, Medium: 0, Low: 0 };
    members.forEach((m) => { if (m.value_tier) map[m.value_tier] = (map[m.value_tier] || 0) + 1; });
    return map;
  }, [members]);

  const columns: Column<SegmentMember>[] = [
    {
      key: 'name',
      label: 'Customer',
      sortable: true,
      sortAccessor: (m) => m.name,
      render: (m) => <span className="text-sm font-semibold text-gray-900 dark:text-white">{m.name}</span>,
    },
    {
      key: 'segment',
      label: 'Segment',
      align: 'center',
      sortable: true,
      sortAccessor: (m) => m.segment,
      render: (m) => <Badge tone="info">{m.segment}</Badge>,
    },
    {
      key: 'total_spend',
      label: 'Total Spend',
      align: 'right',
      sortable: true,
      sortAccessor: (m) => m.total_spend,
      render: (m) => <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{formatAmount(m.total_spend)}</span>,
    },
    {
      key: 'frequency',
      label: 'Frequency',
      align: 'center',
      sortable: true,
      sortAccessor: (m) => m.frequency || '',
      render: (m) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{m.frequency || '—'}</span>,
    },
    {
      key: 'value_tier',
      label: 'Value Tier',
      align: 'center',
      sortable: true,
      sortAccessor: (m) => m.value_tier || '',
      render: (m) => <Badge tone={(VALUE_TONE[m.value_tier || ''] || 'neutral') as any}>{m.value_tier || '—'}</Badge>,
    },
    {
      key: 'last_stay',
      label: 'Last Stay',
      align: 'center',
      sortable: true,
      sortAccessor: (m) => m.last_stay || '',
      render: (m) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{m.last_stay || '—'}</span>,
    },
  ];

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Customer Segmentation"
        subtitle="Customer grouping, behavioral analysis, value tiers, and targeted marketing segments · DB-synced"
        icon={Users}
        actions={
          <>
            <button onClick={loadData} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={() => { setForm(EMPTY_FORM); setShowAddModal(true); setError(null); }} className={button.primary}>
              <Plus size={16} /> Add Member
            </button>
          </>
        }
      />

      {error && !showAddModal && (
        <div className="p-4 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-2xl flex items-center justify-between">
          <p className="text-sm font-semibold text-rose-700 dark:text-rose-400">{error}</p>
          <button onClick={loadData} disabled={loading} className={[button.secondary, 'flex items-center gap-2'].join(' ')}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Retry
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {SEGMENTS.map((seg) => {
          const stats = segmentStats[seg.name] || { count: 0, revenue: 0 };
          const Icon = seg.icon;
          const selected = activeSegment === seg.id;
          return (
            <button
              key={seg.id}
              onClick={() => setActiveSegment(selected ? 'all' : seg.id)}
              className={`text-left p-5 rounded-[28px] border transition ${selected ? 'border-[var(--color-accent-operations)] ring-2 ring-[var(--color-accent-operations)]/20' : 'border-slate-200 dark:border-slate-800 hover:border-slate-300'} bg-white dark:bg-slate-900`}
            >
              <div className={`p-2 w-fit rounded-xl bg-${seg.color}-50 text-${seg.color}-600 mb-3`}><Icon size={16} /></div>
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">{seg.name}</p>
              <h3 className="text-xl font-black text-slate-900 dark:text-white">{stats.count}</h3>
              <p className="text-[10px] font-bold text-emerald-600 mt-1">{formatAmount(stats.revenue)}</p>
            </button>
          );
        })}
      </div>

      <div className={layout.kpiGrid}>
        <StatCard title="High Value" value={valueTierCounts.High.toString()} icon={Target} tone="success" />
        <StatCard title="Medium Value" value={valueTierCounts.Medium.toString()} icon={Target} tone="warning" />
        <StatCard title="Low Value" value={valueTierCounts.Low.toString()} icon={Target} tone="neutral" />
        <StatCard title="Total Members" value={members.length.toLocaleString()} icon={Users} tone="info" />
      </div>

      {activeSegment !== 'all' && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Filtered by:</span>
          <span className="px-3 py-1.5 bg-[var(--color-accent-operations)] text-white rounded-xl text-[10px] font-black uppercase tracking-widest">{SEGMENTS.find((s) => s.id === activeSegment)?.name}</span>
          <button onClick={() => setActiveSegment('all')} className="p-1.5 text-slate-400 hover:text-rose-500 transition"><X size={12} /></button>
        </div>
      )}

      <SectionCard title="Segment Members" subtitle="Customers by segment, spend, and value tier">
        <div className="p-6">
          <DataTable
            columns={columns}
            data={members}
            rowKey={(row) => row.id}
            sortable
            filterable
            filterPlaceholder="Search customers..."
            filterKeys={['name', 'segment', 'value_tier', 'frequency']}
            emptyMessage="No segmented customers found."
            containerClassName="!rounded-2xl !shadow-none border-slate-200 dark:border-slate-700"
          />
        </div>
      </SectionCard>

      <ModalSystem
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setError(null); }}
        onConfirm={handleCreate}
        title="Add Segment Member"
        subtitle="Assign a customer to a marketing segment"
        confirmLabel="Add Member"
        cancelLabel="Cancel"
        confirmColor="emerald"
        showFooter
        loading={saving}
        size="md"
      >
        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-xl text-sm text-rose-700 dark:text-rose-400">
              {error}
            </div>
          )}

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Customer Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Segment</label>
              <select value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]">
                {SEGMENTS.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Value Tier</label>
              <select value={form.valueTier} onChange={(e) => setForm({ ...form, valueTier: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]">
                {['High', 'Medium', 'Low'].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Total Spend ($)</label>
              <input type="number" value={form.totalSpend} onChange={(e) => setForm({ ...form, totalSpend: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Frequency</label>
              <select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]">
                {['Frequent', 'Regular', 'Occasional', 'Annual'].map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Last Stay</label>
            <input type="date" value={form.lastStay} onChange={(e) => setForm({ ...form, lastStay: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>
        </div>
      </ModalSystem>
    </div>
  );
};

export default CustomerSegmentation;
